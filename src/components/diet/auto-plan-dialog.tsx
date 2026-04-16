import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import React, { useMemo, useState, useEffect, useRef } from "react"
import { Pencil, Check, Wand2, Lock, Unlock, Scale, ChevronUp, ChevronDown, RotateCcw, Sparkles } from "lucide-react"
import { FoodEditDialog } from "@/components/diet/food-sidebar"
import { SettingsDialog } from "@/components/planner/settings-dialog"
import { PatientRulesDialog } from "@/components/planner/patient-rules-dialog"
import { supabase } from "@/lib/supabase"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"
import { applyTeamFoodOverrides, upsertTeamFoodOverride } from "@/lib/team-food-overrides"
import { saveFoodMicronutrientsByScope } from "@/lib/team-food-micronutrient-overrides"
import { FOOD_ROLES, LEGACY_ROLE_LABELS } from "@/lib/constants/food-roles"
import { Planner } from "@/lib/planner/engine3"
import { BalanceConfirmModal, BalanceChange } from "@/components/diet/balance-confirm-modal"

function MacroBar({ label, actual, target, unit = 'g', minTolerance = 80, maxTolerance = 120 }: { label: string, actual: number, target: number, unit?: string, minTolerance?: number, maxTolerance?: number }) {
    const percentage = target > 0 ? Math.min((actual / target) * 100, 150) : 0
    const isOver = actual > target * (maxTolerance / 100)
    const isUnder = actual < target * (minTolerance / 100)

    return (
        <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-600">{label}</span>
            <span className={isOver ? 'text-red-600 font-medium' : isUnder ? 'text-yellow-600' : 'text-green-600 font-medium'}>
                {Math.round(actual)}/{target}{unit}
            </span>
            <div className="w-12 h-1 bg-slate-200 rounded-full overflow-hidden">
                <div
                    className={`h-full ${isOver ? 'bg-red-500' : isUnder ? 'bg-yellow-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                />
            </div>
        </div>
    )
}

const ROLE_LABELS = LEGACY_ROLE_LABELS

// Render order: Soup -> Main -> Salad -> Side -> Bread -> Others
const ROLE_ORDER = [...FOOD_ROLES.map(r => r.value), 'corba']

const ROLE_COLORS: Record<string, string> = {
    'mainDish': 'text-blue-700 bg-blue-50 border-blue-200',
    'sideDish': 'text-slate-600 bg-slate-50 border-slate-200',
    'salad': 'text-green-700 bg-green-50 border-green-200',
    'bread': 'text-amber-700 bg-amber-50 border-amber-200',
    'soup': 'text-orange-700 bg-orange-50 border-orange-200',
    'corba': 'text-orange-700 bg-orange-50 border-orange-200', // Legacy
    'dessert': 'text-pink-700 bg-pink-50 border-pink-200',
    'fruit': 'text-lime-700 bg-lime-50 border-lime-200',
    'snack': 'text-purple-700 bg-purple-50 border-purple-200',
    'drink': 'text-sky-700 bg-sky-50 border-sky-200',
    'supplement': 'text-indigo-700 bg-indigo-50 border-indigo-200',
}

const RULE_BOUND_SOURCE_TYPES = new Set([
    'rule',
    'rule_preferred',
    'nutritional_rule',
    'fixed',
    'required_role',
    'optional_round_robin',
    'freq_flex_add'
])

const SOURCE_TYPE_FALLBACK_LABELS: Record<string, string> = {
    rule: 'Kural',
    rule_preferred: 'Kural (Tercihli)',
    nutritional_rule: 'Nutritional Kural',
    fixed: 'Sabit Kural',
    required_role: 'Zorunlu Rol',
    optional_round_robin: 'Opsiyonel Rol',
    freq_flex_add: 'Frekans Kuralı'
}

const RULE_CHIP_COLOR_CLASSES = [
    'text-blue-700 bg-blue-50 border-blue-200',
    'text-emerald-700 bg-emerald-50 border-emerald-200',
    'text-amber-700 bg-amber-50 border-amber-200',
    'text-rose-700 bg-rose-50 border-rose-200',
    'text-indigo-700 bg-indigo-50 border-indigo-200',
    'text-cyan-700 bg-cyan-50 border-cyan-200',
    'text-fuchsia-700 bg-fuchsia-50 border-fuchsia-200',
    'text-orange-700 bg-orange-50 border-orange-200',
]

function hashString(value: string): number {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

function getRuleChipColorClass(ruleKey: string): string {
    const idx = hashString(ruleKey) % RULE_CHIP_COLOR_CLASSES.length
    return RULE_CHIP_COLOR_CLASSES[idx]
}

function extractRuleNameHint(fullLabel: string, sourceType: string): string | null {
    if (!fullLabel) return null
    if (sourceType === 'fixed') return null

    if (fullLabel.includes(':')) {
        const right = fullLabel.split(':').slice(1).join(':').trim()
        if (right) return right
    }

    const normalized = fullLabel.trim()
    return normalized.length > 0 ? normalized : null
}

type MealRuleSourceChip = {
    key: string
    label: string
    fullLabel: string
    ruleId: string | null
    ruleNameHint: string | null
    isEditable: boolean
}

function getMealRuleSources(meal: any): MealRuleSourceChip[] {
    const src = meal?.source
    if (!src || typeof src !== 'object') return []

    const sourceType = typeof src.type === 'string' ? src.type : ''
    const ruleText = typeof src.rule === 'string' ? src.rule.trim() : ''
    const ruleId = typeof src.rule_id === 'string' && src.rule_id.trim() ? src.rule_id : null
    const lockRuleText = typeof src.lock_rule === 'string' ? src.lock_rule.trim() : ''
    const lockRuleId = typeof src.lock_rule_id === 'string' && src.lock_rule_id.trim() ? src.lock_rule_id : null
    const chips: MealRuleSourceChip[] = []

    const hasMainRule = Boolean(ruleId) || Boolean(ruleText) || RULE_BOUND_SOURCE_TYPES.has(sourceType)
    if (hasMainRule) {
        const fullLabel = ruleText || SOURCE_TYPE_FALLBACK_LABELS[sourceType] || 'Kural'
        const label = fullLabel.length > 30 ? `${fullLabel.slice(0, 29)}...` : fullLabel
        const ruleNameHint = extractRuleNameHint(fullLabel, sourceType)
        chips.push({
            key: `rule:${ruleId || fullLabel}`,
            label,
            fullLabel,
            ruleId,
            ruleNameHint,
            isEditable: Boolean(ruleId || ruleNameHint)
        })
    }

    const hasLockRule = Boolean(lockRuleId) || Boolean(lockRuleText)
    if (hasLockRule) {
        const fullLabel = `Kilit: ${lockRuleText || 'Tutarlılık'}`
        const label = fullLabel.length > 30 ? `${fullLabel.slice(0, 29)}...` : fullLabel
        chips.push({
            key: `lock:${lockRuleId || fullLabel}`,
            label,
            fullLabel,
            ruleId: lockRuleId,
            ruleNameHint: lockRuleText || 'Kilit kuralı',
            isEditable: Boolean(lockRuleId || lockRuleText)
        })
    }

    // Deduplicate if the same label/id is injected more than once.
    const seen = new Set<string>()
    return chips.filter((chip) => {
        const key = `${chip.ruleId || ''}|${chip.fullLabel}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}



// SAFE HELPER FOR COMPATIBILITY BADGE
function renderCompatibilityBadge(meal: any, slotMeals: any[]) {
    try {
        if (!meal?.food || !slotMeals) return null

        // Resolve slotMainDish from the parent scope's slotMeals
        const slotMainDish = slotMeals.find((m: any) =>
            m.food?.role === 'mainDish' ||
            (typeof m.food?.role === 'string' && m.food.role.toLowerCase().includes('ana yemek'))
        )?.food

        if (slotMainDish && meal.food && slotMainDish.id !== meal.food.id) {
            // Strict array checks
            const targetTags = Array.isArray(slotMainDish.compatibility_tags) ? slotMainDish.compatibility_tags : []
            const myTags = Array.isArray(meal.food.tags) ? meal.food.tags : []

            if (!targetTags.length || !myTags.length) return null

            const match = targetTags.find((t: any) =>
                typeof t === 'string' &&
                myTags.some((mt: any) => typeof mt === 'string' && mt.trim().toLowerCase() === t.trim().toLowerCase())
            )

            if (match) {
                return (
                    <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-medium bg-yellow-200 text-yellow-800 border border-yellow-300 leading-none" title="Ana yemekle uyumlu">
                        ({match})
                    </span>
                )
            }
        }
    } catch (e) {
        // Silent fail
        return null
    }
    return null
}

import { useScalableUnits, getScaledFoodName } from "@/lib/planner/portion-scaler"

interface AutoPlanDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    plan: any
    onConfirm: (plan: any) => void
    loading?: boolean
    mealTypes?: string[] // Optional for sorting
    onRegenerate?: (macroAdjustments?: Record<string, number>) => void
    patientId?: string // Added patientId
    programTemplateId?: string | null // Program template for fallback
    activeWeekId?: string // Active week for slot config sync
    onMealTypesChanged?: () => void // Callback when meal types are saved in SettingsDialog
    userId?: string // For Planner instantiation
}

export function AutoPlanDialog({ open, onOpenChange, plan, onConfirm, loading, mealTypes, onRegenerate, patientId, programTemplateId, activeWeekId, onMealTypesChanged, userId }: AutoPlanDialogProps) {
    const DIALOG_MARGIN = 12
    const OPEN_VERTICAL_OFFSET = 48
    const MIN_DIALOG_WIDTH = 760
    const MIN_DIALOG_HEIGHT = 560
    const clampDialogSize = (size: { width: number, height: number }) => {
        if (typeof window === 'undefined') return size
        const maxWidth = Math.max(320, window.innerWidth - (DIALOG_MARGIN * 2))
        const maxHeight = Math.max(320, window.innerHeight - (DIALOG_MARGIN * 2))
        const minWidth = Math.min(MIN_DIALOG_WIDTH, maxWidth)
        const minHeight = Math.min(MIN_DIALOG_HEIGHT, maxHeight)
        return {
            width: Math.max(minWidth, Math.min(maxWidth, size.width)),
            height: Math.max(minHeight, Math.min(maxHeight, size.height))
        }
    }

    const getInitialDialogSize = () => {
        return clampDialogSize({ width: 860, height: 740 })
    }

    const [editFood, setEditFood] = useState<any>(null)
    const [foodDialogOpen, setFoodDialogOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [rulesOpen, setRulesOpen] = useState(false)
    const [focusedRuleId, setFocusedRuleId] = useState<string | null>(null)
    const [focusedRuleName, setFocusedRuleName] = useState<string | null>(null)
    const [localPlan, setLocalPlan] = useState<any>(null)
    const scalableUnits = useScalableUnits()
    // Cumulative macro adjustments: { protein: 2, carb: -1, fat: 0 } means protein +20%, carb -10%
    const [macroAdjustments, setMacroAdjustments] = useState<Record<string, number>>({ protein: 0, carb: 0, fat: 0 })
    const [isBalancing, setIsBalancing] = useState(false)
    const [isFlavorTuning, setIsFlavorTuning] = useState(false)
    const [flavorModal, setFlavorModal] = useState<{
        isOpen: boolean
        title: string
        changes: BalanceChange[]
        initialTotals: { calories: number; protein: number; fat: number; carbs: number }
        targetMacros: { calories: number; protein: number; fat: number; carbs: number }
        resolve: ((approvedChanges: BalanceChange[] | null) => void) | null
    }>({
        isOpen: false,
        title: '',
        changes: [],
        initialTotals: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        targetMacros: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        resolve: null
    })
    const [dialogSize, setDialogSize] = useState(getInitialDialogSize)
    const [dialogPosition, setDialogPosition] = useState({ x: DIALOG_MARGIN, y: DIALOG_MARGIN })
    const [isDragging, setIsDragging] = useState(false)
    const [isResizing, setIsResizing] = useState(false)
    const resizeStartRef = useRef<{ x: number, y: number, width: number, height: number } | null>(null)
    const dragStartRef = useRef<{ x: number, y: number, startPositionX: number, startPositionY: number } | null>(null)

    // Sync local plan with prop plan when it changes or dialog opens
    useEffect(() => {
        if (plan) {
            setLocalPlan(JSON.parse(JSON.stringify(plan))) // Deep copy to avoid mutating prop
        }
    }, [plan, open])

    const getPositionBounds = (size: { width: number, height: number }) => {
        if (typeof window === 'undefined') {
            return {
                minX: DIALOG_MARGIN,
                maxX: DIALOG_MARGIN,
                minY: DIALOG_MARGIN,
                maxY: DIALOG_MARGIN
            }
        }
        const maxX = Math.max(DIALOG_MARGIN, window.innerWidth - size.width - DIALOG_MARGIN)
        const maxY = Math.max(DIALOG_MARGIN, window.innerHeight - size.height - DIALOG_MARGIN)
        return { minX: DIALOG_MARGIN, maxX, minY: DIALOG_MARGIN, maxY }
    }

    const clampPosition = (position: { x: number, y: number }, size: { width: number, height: number } = dialogSize) => {
        const bounds = getPositionBounds(size)
        return {
            x: Math.max(bounds.minX, Math.min(position.x, bounds.maxX)),
            y: Math.max(bounds.minY, Math.min(position.y, bounds.maxY))
        }
    }

    const getCenteredPosition = (size: { width: number, height: number }) => {
        if (typeof window === 'undefined') return { x: DIALOG_MARGIN, y: DIALOG_MARGIN }
        const centerX = Math.round((window.innerWidth - size.width) / 2)
        const centerY = Math.round((window.innerHeight - size.height) / 2) + OPEN_VERTICAL_OFFSET
        return clampPosition({ x: centerX, y: centerY }, size)
    }

    useEffect(() => {
        if (!open || typeof window === 'undefined') return
        const nextSize = getInitialDialogSize()
        setDialogSize(nextSize)
        setDialogPosition(getCenteredPosition(nextSize))
    }, [open])

    useEffect(() => {
        if (!open || typeof window === 'undefined') return
        setDialogPosition(prev => clampPosition(prev, dialogSize))
    }, [dialogSize, open])

    useEffect(() => {
        if (!open || typeof window === 'undefined') return

        const handleWindowResize = () => {
            setDialogSize(prevSize => {
                const nextSize = clampDialogSize(prevSize)
                setDialogPosition(prevPos => {
                    const anchored = clampPosition(prevPos, nextSize)
                    return anchored
                })
                return nextSize
            })
        }

        window.addEventListener('resize', handleWindowResize)
        return () => window.removeEventListener('resize', handleWindowResize)
    }, [open])

    useEffect(() => {
        if (!isDragging || typeof window === 'undefined') return

        const handleMove = (event: MouseEvent) => {
            if (!dragStartRef.current) return
            const rawX = dragStartRef.current.startPositionX + (event.clientX - dragStartRef.current.x)
            const rawY = dragStartRef.current.startPositionY + (event.clientY - dragStartRef.current.y)
            setDialogPosition(clampPosition({ x: rawX, y: rawY }))
        }

        const handleUp = () => {
            setIsDragging(false)
            dragStartRef.current = null
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }

        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'move'
        window.addEventListener('mousemove', handleMove)
        window.addEventListener('mouseup', handleUp)

        return () => {
            window.removeEventListener('mousemove', handleMove)
            window.removeEventListener('mouseup', handleUp)
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }
    }, [isDragging, dialogSize.width, dialogSize.height])

    useEffect(() => {
        if (!isResizing || typeof window === 'undefined') return

        const handleMove = (event: MouseEvent) => {
            if (!resizeStartRef.current) return
            const dx = event.clientX - resizeStartRef.current.x
            const dy = event.clientY - resizeStartRef.current.y
            const maxWidth = Math.max(320, window.innerWidth - (DIALOG_MARGIN * 2))
            const maxHeight = Math.max(320, window.innerHeight - (DIALOG_MARGIN * 2))
            const minWidth = Math.min(MIN_DIALOG_WIDTH, maxWidth)
            const minHeight = Math.min(MIN_DIALOG_HEIGHT, maxHeight)
            const nextWidth = Math.min(maxWidth, Math.max(minWidth, resizeStartRef.current.width + dx))
            const nextHeight = Math.min(maxHeight, Math.max(minHeight, resizeStartRef.current.height + dy))
            const nextSize = { width: nextWidth, height: nextHeight }
            setDialogSize(nextSize)
            setDialogPosition(prev => clampPosition(prev, nextSize))
        }

        const handleUp = () => {
            setIsResizing(false)
            resizeStartRef.current = null
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }

        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'se-resize'
        window.addEventListener('mousemove', handleMove)
        window.addEventListener('mouseup', handleUp)

        return () => {
            window.removeEventListener('mousemove', handleMove)
            window.removeEventListener('mouseup', handleUp)
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }
    }, [isResizing])

    function handleResizeStart(event: React.MouseEvent<HTMLDivElement>) {
        event.preventDefault()
        event.stopPropagation()
        resizeStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            width: dialogSize.width,
            height: dialogSize.height
        }
        setIsResizing(true)
    }

    function handleDragStart(event: React.MouseEvent<HTMLElement>) {
        if (isResizing) return
        const target = event.target as HTMLElement | null
        if (target?.closest('button, input, select, textarea, a, [data-no-drag="true"]')) return

        event.preventDefault()
        dragStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            startPositionX: safeDialogPosition.x,
            startPositionY: safeDialogPosition.y
        }
        setIsDragging(true)
    }

    function openRulesFromMeal(ruleId?: string | null, ruleName?: string | null) {
        setFocusedRuleId(ruleId || null)
        setFocusedRuleName(ruleName || null)
        setRulesOpen(true)
    }

    function recenterDialog() {
        const nextSize = clampDialogSize(dialogSize)
        setDialogSize(nextSize)
        setDialogPosition(getCenteredPosition(nextSize))
    }

    const safeDialogPosition = clampPosition(dialogPosition)

    // Helper to calc total calories of Plan
    // MOVED DOWN AFTER NULL CHECK


    const safePlan = localPlan || { meals: [], targetMacros: {} }
    // Get unique slots from plan, BUT sort them by mealTypes if provided
    const unsortedSlots = Array.from(new Set((safePlan.meals || []).map((m: any) => m.slot))) as string[]
    const allSlots = mealTypes
        ? unsortedSlots.sort((a, b) => {
            const idxA = mealTypes.indexOf(a)
            const idxB = mealTypes.indexOf(b)
            // If both found, sort by index. If one not found, put it at end.
            if (idxA !== -1 && idxB !== -1) return idxA - idxB
            if (idxA !== -1) return -1
            if (idxB !== -1) return 1
            return 0
        })
        : unsortedSlots
    const target = safePlan.targetMacros || { calories: 1800, protein: 90, carbs: 180, fat: 60 }

    const weeklyStats = useMemo(() => {
        if (!localPlan) return { dayMacros: [], avg: { calories: 0, protein: 0, carbs: 0, fat: 0 } }
        const dayMacros: any[] = []
        for (let i = 1; i <= 7; i++) {
            const dayMeals = localPlan.meals.filter((m: any) => m.day === i)
            dayMacros.push({
                calories: dayMeals.reduce((sum: number, m: any) => sum + (m.food.calories || 0) * (m.portion_multiplier || 1), 0),
                protein: dayMeals.reduce((sum: number, m: any) => sum + (m.food.protein || 0) * (m.portion_multiplier || 1), 0),
                carbs: dayMeals.reduce((sum: number, m: any) => sum + (m.food.carbs || 0) * (m.portion_multiplier || 1), 0),
                fat: dayMeals.reduce((sum: number, m: any) => sum + (m.food.fat || 0) * (m.portion_multiplier || 1), 0)
            })
        }
        const avg = {
            calories: Math.round(dayMacros.reduce((sum, d) => sum + d.calories, 0) / 7),
            protein: Math.round(dayMacros.reduce((sum, d) => sum + d.protein, 0) / 7),
            carbs: Math.round(dayMacros.reduce((sum, d) => sum + d.carbs, 0) / 7),
            fat: Math.round(dayMacros.reduce((sum, d) => sum + d.fat, 0) / 7)
        }
        return { dayMacros, avg }
    }, [localPlan])

    if (!localPlan) return null

    // Helper to calc total calories of Plan
    const planTotal = localPlan.meals.reduce((acc: any, m: any) => ({
        calories: acc.calories + (m.calories || m.food.calories || 0) * (m.portion_multiplier || 1),
        protein: acc.protein + (m.protein || m.food.protein || 0) * (m.portion_multiplier || 1),
        carbs: acc.carbs + (m.carbs || m.food.carbs || 0) * (m.portion_multiplier || 1),
        fat: acc.fat + (m.fat || m.food.fat || 0) * (m.portion_multiplier || 1),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 })

    const tolerances = localPlan.settings?.portion_settings?.macro_tolerances || {
        protein: { min: 80, max: 120 },
        carb: { min: 80, max: 120 },
        fat: { min: 80, max: 120 },
        calories: { min: 90, max: 110 }
    }

    // CACHE PLANNER INSTANCE
    const plannerRef = useRef<Planner | null>(null)
    const initPromiseRef = useRef<Promise<Planner> | null>(null)

    useEffect(() => {
        plannerRef.current = null
        initPromiseRef.current = null
    }, [patientId, userId])

    async function getPlanner() {
        if (!patientId || !userId) throw new Error("Missing patientId or userId")
        if (plannerRef.current) return plannerRef.current
        if (initPromiseRef.current) return initPromiseRef.current

        const newPlanner = new Planner(patientId, userId)
        initPromiseRef.current = newPlanner.init().then(() => {
            plannerRef.current = newPlanner
            return newPlanner
        })
        return initPromiseRef.current
    }

    const showFlavorModal = (
        title: string,
        changes: BalanceChange[],
        initialTotals: { calories: number; protein: number; fat: number; carbs: number },
        targetMacros: { calories: number; protein: number; fat: number; carbs: number }
    ): Promise<BalanceChange[] | null> => {
        return new Promise((resolve) => {
            setFlavorModal({
                isOpen: true,
                title,
                changes,
                initialTotals,
                targetMacros,
                resolve
            })
        })
    }

    // SMART BALANCE using Planner engine
    async function handleSmartBalance(mode: 'weekly' | 'daily' = 'weekly', targetDay?: number) {
        if (!localPlan?.meals?.length || !patientId || !userId) {
            alert('Dengeleme için hasta ve kullanıcı bilgisi gerekli.')
            return
        }
        if (isFlavorTuning) return
        setIsBalancing(true)
        try {
            const planner = await getPlanner()
            const { plan: balanced, changes } = await planner.balancePlan(localPlan, mode, targetDay)
            if (changes.length === 0) {
                alert('Değişiklik gerekmiyor veya yapılabilecek değişiklik yok.\nTüm makrolar tolerans aralığında veya porsiyonlar sınırda.')
            } else {
                setLocalPlan(balanced)
                alert(`${changes.length} değişiklik yapıldı:\n\n${changes.join('\n')}`)
            }
        } catch (err) {
            console.error('[SmartBalance] Error:', err)
            alert('Dengeleme sırasında hata oluştu.')
        } finally {
            setIsBalancing(false)
        }
    }

    // FLAVOR TUNE (Gurme / Lezzet Ayari) using Planner engine
    async function handleFlavorTune(mode: 'weekly' | 'daily' = 'weekly', targetDay?: number) {
        if (!localPlan?.meals?.length || !patientId || !userId) {
            alert('Lezzet ayari icin hasta ve kullanici bilgisi gerekli.')
            return
        }
        if (isBalancing) return
        setIsFlavorTuning(true)
        try {
            const planner = await getPlanner()
            const { plan: tunedPlan, changes } = await planner.applyFlavorTune(localPlan, mode, targetDay)
            if (changes.length === 0) {
                alert('Lezzet ayari icin uygun degisiklik bulunamadi.')
            } else {
                const inScope = (m: any) => (mode === 'daily' && targetDay ? m.day === targetDay : true)
                const sourceMeals = (localPlan.meals || []).filter(inScope)
                const nextMeals = (tunedPlan.meals || []).filter(inScope)

                const calcTotals = (meals: any[]) => meals.reduce((acc, meal) => {
                    const mult = Number(meal.portion_multiplier) || 1
                    acc.calories += (Number(meal.food?.calories) || 0) * mult
                    acc.protein += (Number(meal.food?.protein) || 0) * mult
                    acc.carbs += (Number(meal.food?.carbs) || 0) * mult
                    acc.fat += (Number(meal.food?.fat) || 0) * mult
                    return acc
                }, { calories: 0, protein: 0, carbs: 0, fat: 0 })

                const slotKey = (meal: any) => `${meal.day}_${meal.slot}`
                const byOriginal = new Map<string, any[]>()
                const byNext = new Map<string, any[]>()
                sourceMeals.forEach((m: any) => {
                    const key = slotKey(m)
                    if (!byOriginal.has(key)) byOriginal.set(key, [])
                    byOriginal.get(key)!.push(m)
                })
                nextMeals.forEach((m: any) => {
                    const key = slotKey(m)
                    if (!byNext.has(key)) byNext.set(key, [])
                    byNext.get(key)!.push(m)
                })

                const allKeys = new Set<string>([...Array.from(byOriginal.keys()), ...Array.from(byNext.keys())])
                const modalChanges: BalanceChange[] = []
                let i = 0
                for (const key of allKeys) {
                    const originals = [...(byOriginal.get(key) || [])]
                    const tuned = [...(byNext.get(key) || [])]
                    const originalByFood = new Map<string, any[]>()
                    originals.forEach((m: any) => {
                        const foodId = String(m.food?.id || '')
                        if (!originalByFood.has(foodId)) originalByFood.set(foodId, [])
                        originalByFood.get(foodId)!.push(m)
                    })

                    const usedOriginal = new Set<any>()
                    const usedTuned = new Set<any>()

                    for (const tunedMeal of tuned) {
                        const queue = originalByFood.get(String(tunedMeal.food?.id || ''))
                        const exact = queue?.shift()
                        if (!exact) continue
                        usedOriginal.add(exact)
                        usedTuned.add(tunedMeal)
                        const oldMult = Number(exact.portion_multiplier) || 1
                        const newMult = Number(tunedMeal.portion_multiplier) || 1
                        if (Math.abs(newMult - oldMult) <= 0.01) continue
                        const dMult = newMult - oldMult
                        modalChanges.push({
                            id: `flavor_portion_${i++}`,
                            type: 'portion',
                            foodId: exact.food?.id,
                            foodName: tunedMeal.food?.name || exact.food?.name || 'Bilinmeyen',
                            detail: `Porsiyon: x${oldMult} → x${newMult}`,
                            day: exact.day,
                            dayName: exact.dayName,
                            slotName: exact.slot,
                            newMultiplier: newMult,
                            diffCals: (Number(exact.food?.calories) || 0) * dMult,
                            diffProt: (Number(exact.food?.protein) || 0) * dMult,
                            diffFat: (Number(exact.food?.fat) || 0) * dMult,
                            diffCarbs: (Number(exact.food?.carbs) || 0) * dMult
                        })
                    }

                    const leftOriginal = originals.filter((m: any) => !usedOriginal.has(m))
                    const leftTuned = tuned.filter((m: any) => !usedTuned.has(m))
                    const originalPool = [...leftOriginal]
                    for (const tunedMeal of leftTuned) {
                        const idx = originalPool.findIndex((m: any) => m.food?.role && tunedMeal.food?.role && m.food.role === tunedMeal.food.role)
                        const original = originalPool[idx >= 0 ? idx : 0]
                        if (!original) {
                            const mult = Number(tunedMeal.portion_multiplier) || 1
                            modalChanges.push({
                                id: `flavor_add_${i++}`,
                                type: 'add',
                                foodName: tunedMeal.food?.name || 'Yeni Öğe',
                                detail: `${tunedMeal.slot} öğününe eklenecek`,
                                day: tunedMeal.day,
                                dayName: tunedMeal.dayName,
                                slotName: tunedMeal.slot,
                                newFood: tunedMeal.food,
                                newMultiplier: mult,
                                diffCals: (Number(tunedMeal.food?.calories) || 0) * mult,
                                diffProt: (Number(tunedMeal.food?.protein) || 0) * mult,
                                diffFat: (Number(tunedMeal.food?.fat) || 0) * mult,
                                diffCarbs: (Number(tunedMeal.food?.carbs) || 0) * mult
                            })
                            continue
                        }
                        originalPool.splice(idx >= 0 ? idx : 0, 1)
                        const oldMult = Number(original.portion_multiplier) || 1
                        const newMult = Number(tunedMeal.portion_multiplier) || 1
                        modalChanges.push({
                            id: `flavor_swap_${i++}`,
                            type: 'swap',
                            foodId: original.food?.id,
                            foodName: `${original.food?.name || 'Bilinmeyen'} → ${tunedMeal.food?.name || 'Bilinmeyen'}`,
                            detail: `${original.slot} öğününde lezzet değişimi`,
                            day: original.day,
                            dayName: original.dayName,
                            slotName: original.slot,
                            newFood: tunedMeal.food,
                            newMultiplier: newMult,
                            diffCals: ((Number(tunedMeal.food?.calories) || 0) * newMult) - ((Number(original.food?.calories) || 0) * oldMult),
                            diffProt: ((Number(tunedMeal.food?.protein) || 0) * newMult) - ((Number(original.food?.protein) || 0) * oldMult),
                            diffFat: ((Number(tunedMeal.food?.fat) || 0) * newMult) - ((Number(original.food?.fat) || 0) * oldMult),
                            diffCarbs: ((Number(tunedMeal.food?.carbs) || 0) * newMult) - ((Number(original.food?.carbs) || 0) * oldMult)
                        })
                    }
                    originalPool.forEach((original: any) => {
                        const oldMult = Number(original.portion_multiplier) || 1
                        modalChanges.push({
                            id: `flavor_remove_${i++}`,
                            type: 'remove',
                            foodId: original.food?.id,
                            foodName: original.food?.name || 'Bilinmeyen',
                            detail: `${original.slot} öğününden çıkarılacak`,
                            day: original.day,
                            dayName: original.dayName,
                            slotName: original.slot,
                            diffCals: -((Number(original.food?.calories) || 0) * oldMult),
                            diffProt: -((Number(original.food?.protein) || 0) * oldMult),
                            diffFat: -((Number(original.food?.fat) || 0) * oldMult),
                            diffCarbs: -((Number(original.food?.carbs) || 0) * oldMult)
                        })
                    })
                }

                if (modalChanges.length === 0) {
                    alert('Lezzet ayari icin uygulanabilir degisiklik bulunamadi.')
                    return
                }

                const dayCount = mode === 'weekly' ? 7 : 1
                const approved = await showFlavorModal(
                    mode === 'weekly' ? 'Haftalık Lezzet Ayarı' : `Gün ${targetDay || ''} Lezzet Ayarı`,
                    modalChanges,
                    calcTotals(sourceMeals),
                    {
                        calories: target.calories * dayCount,
                        protein: target.protein * dayCount,
                        carbs: target.carbs * dayCount,
                        fat: target.fat * dayCount
                    }
                )

                if (!approved || approved.length === 0) return

                const meals = [...(localPlan.meals || [])]
                const findMealIndex = (day: number, slot: string, foodId?: string) =>
                    meals.findIndex((m: any) => m.day === day && m.slot === slot && (!foodId || m.food?.id === foodId))

                for (const change of approved) {
                    const day = change.day || 1
                    const slot = change.slotName || ''
                    if (change.type === 'portion' && change.newMultiplier !== undefined) {
                        const idx = findMealIndex(day, slot, change.foodId)
                        if (idx >= 0) meals[idx] = { ...meals[idx], portion_multiplier: change.newMultiplier }
                    } else if (change.type === 'swap' && change.newFood) {
                        const idx = findMealIndex(day, slot, change.foodId)
                        if (idx >= 0) {
                            meals[idx] = {
                                ...meals[idx],
                                food: change.newFood,
                                portion_multiplier: change.newMultiplier || 1
                            }
                        }
                    } else if (change.type === 'add' && change.newFood) {
                        meals.push({
                            day,
                            dayName: change.dayName || `Gün ${day}`,
                            slot,
                            food: change.newFood,
                            portion_multiplier: change.newMultiplier || 1
                        })
                    } else if (change.type === 'remove') {
                        const idx = findMealIndex(day, slot, change.foodId)
                        if (idx >= 0) meals.splice(idx, 1)
                    }
                }

                setLocalPlan((prev: any) => ({ ...prev, meals }))
                alert(`${approved.length} lezzet değişikliği uygulandı.`)
            }
        } catch (err) {
            console.error('[FlavorTune] Error:', err)
            alert('Lezzet ayari sirasinda hata olustu.')
        } finally {
            setIsFlavorTuning(false)
        }
    }

    // CUMULATIVE MACRO ADJUSTMENT (%10 per click)
    function adjustMacro(macro: string, direction: 'up' | 'down') {
        setMacroAdjustments(prev => ({
            ...prev,
            [macro]: (prev[macro] || 0) + (direction === 'up' ? 1 : -1)
        }))
    }
    function resetMacroAdjustments() {
        setMacroAdjustments({ protein: 0, carb: 0, fat: 0 })
    }
    const hasAnyAdjustment = Object.values(macroAdjustments).some(v => v !== 0)

    // Compute adjusted targets for display
    const adjustedTarget = {
        protein: Math.round(target.protein * (1 + (macroAdjustments.protein || 0) * 0.1)),
        carbs: Math.round(target.carbs * (1 + (macroAdjustments.carb || 0) * 0.1)),
        fat: Math.round(target.fat * (1 + (macroAdjustments.fat || 0) * 0.1)),
        calories: 0
    }
    adjustedTarget.calories = adjustedTarget.protein * 4 + adjustedTarget.carbs * 4 + adjustedTarget.fat * 9

    function handleRegenerateWithAdjustments() {
        if (onRegenerate) {
            const adjustments: Record<string, number> = {}
            if (macroAdjustments.protein) adjustments.protein = 1 + macroAdjustments.protein * 0.1
            if (macroAdjustments.carb) adjustments.carb = 1 + macroAdjustments.carb * 0.1
            if (macroAdjustments.fat) adjustments.fat = 1 + macroAdjustments.fat * 0.1
            onRegenerate(Object.keys(adjustments).length > 0 ? adjustments : undefined)
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    className="!max-w-none !translate-x-0 !translate-y-0 flex flex-col p-0 overflow-hidden"
                    style={{
                        width: `${dialogSize.width}px`,
                        height: `${dialogSize.height}px`,
                        left: `${safeDialogPosition.x}px`,
                        top: `${safeDialogPosition.y}px`,
                        transform: 'none',
                        maxWidth: 'calc(100vw - 24px)',
                        maxHeight: 'calc(100vh - 24px)'
                    }}
                >
                    {/* Header - Fixed */}
                    <DialogHeader
                        onMouseDown={handleDragStart}
                        className="px-4 pt-4 pb-3 border-b shrink-0 bg-white flex flex-col space-y-3 cursor-move"
                    >
                        {/* Top Row: Title + Button */}
                        <div className="flex flex-row items-start justify-between w-full">
                            <div className="flex flex-col gap-1">
                                <DialogTitle className="text-base">Otomatik Plan Önizleme</DialogTitle>
                                <DialogDescription className="text-xs">Kurallara göre oluşturuldu</DialogDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Macro Adjustment Toggles - Cumulative +/-10% */}
                                <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg px-1.5 py-0.5">
                                    {(['protein', 'carb', 'fat'] as const).map(macro => {
                                        const label = macro === 'protein' ? 'P' : macro === 'carb' ? 'K' : 'Y'
                                        const count = macroAdjustments[macro] || 0
                                        return (
                                            <div key={macro} className="flex flex-col items-center mx-0.5">
                                                <button
                                                    onClick={() => adjustMacro(macro, 'up')}
                                                    className="h-4 w-6 flex items-center justify-center rounded-t text-[8px] transition-colors hover:bg-green-100 text-slate-400 hover:text-green-600"
                                                    title={`${label} +%10`}
                                                >
                                                    <ChevronUp size={10} />
                                                </button>
                                                <div className="flex items-center gap-0.5">
                                                    <span className="text-[9px] font-bold text-slate-500 w-3 text-center">{label}</span>
                                                    {count !== 0 && (
                                                        <span className={`text-[8px] font-bold leading-none ${count > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                            {count > 0 ? '+' : ''}{count * 10}%
                                                        </span>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => adjustMacro(macro, 'down')}
                                                    className="h-4 w-6 flex items-center justify-center rounded-b text-[8px] transition-colors hover:bg-red-100 text-slate-400 hover:text-red-600"
                                                    title={`${label} -%10`}
                                                >
                                                    <ChevronDown size={10} />
                                                </button>
                                            </div>
                                        )
                                    })}
                                    {hasAnyAdjustment && (
                                        <button
                                            onClick={resetMacroAdjustments}
                                            className="ml-0.5 p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                            title="Sıfırla"
                                        >
                                            <RotateCcw size={10} />
                                        </button>
                                    )}
                                </div>

                                {/* Weekly Balance Button */}
                                <Button variant="outline" size="sm" onClick={() => handleSmartBalance('weekly')} disabled={isBalancing || isFlavorTuning} className="h-8 gap-1 text-xs" title="Haftalık Akıllı Dengele">
                                    <Scale size={14} className={isBalancing ? 'animate-spin text-slate-400' : 'text-emerald-600'} />
                                    {isBalancing ? 'Dengeleniyor...' : 'Dengele'}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleFlavorTune('weekly')}
                                    disabled={isBalancing || isFlavorTuning}
                                    className="h-8 gap-1 text-xs"
                                    title="Haftalik Lezzet Ayari"
                                >
                                    <Sparkles size={14} className={isFlavorTuning ? 'animate-spin text-slate-400' : 'text-violet-600'} />
                                    {isFlavorTuning ? 'Lezzetleniyor...' : 'Lezzet Ayari'}
                                </Button>

                                {/* Regenerate Button */}
                                {onRegenerate && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleRegenerateWithAdjustments}
                                        disabled={loading}
                                        className="h-8 gap-2"
                                    >
                                        <Wand2 size={14} className={loading ? "animate-spin" : "text-purple-600"} />
                                        {loading ? "Oluşturuluyor..." : "Tekrar Oluştur"}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* Compact Macro Summary - Shows adjusted targets when modified */}
                        <div className="flex flex-row items-center gap-4 text-xs w-full overflow-x-auto no-scrollbar">
                            <MacroBar label="Kal" actual={weeklyStats.avg.calories} target={hasAnyAdjustment ? adjustedTarget.calories : target.calories} unit="" minTolerance={tolerances.calories?.min} maxTolerance={tolerances.calories?.max} />
                            <MacroBar label="P" actual={weeklyStats.avg.protein} target={hasAnyAdjustment ? adjustedTarget.protein : target.protein} minTolerance={tolerances.protein?.min} maxTolerance={tolerances.protein?.max} />
                            <MacroBar label="K" actual={weeklyStats.avg.carbs} target={hasAnyAdjustment ? adjustedTarget.carbs : target.carbs} minTolerance={tolerances.carb?.min} maxTolerance={tolerances.carb?.max} />
                            <MacroBar label="Y" actual={weeklyStats.avg.fat} target={hasAnyAdjustment ? adjustedTarget.fat : target.fat} minTolerance={tolerances.fat?.min} maxTolerance={tolerances.fat?.max} />
                        </div>
                    </DialogHeader>

                    <Tabs defaultValue="preview" className="flex-1 flex flex-col overflow-hidden">
                        <div className="px-4 pt-2 border-b bg-slate-50">
                            <TabsList className="grid w-full grid-cols-2 h-8">
                                <TabsTrigger value="preview" className="text-xs">Önizleme</TabsTrigger>
                                <TabsTrigger value="report" className="text-xs">Karar Raporu</TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="preview" className="flex-1 overflow-auto space-y-4 mt-0 bg-slate-50/50">
                            {localPlan && weeklyStats && Array.from({ length: 7 }).map((_, i) => {
                                const dayNum = i + 1
                                const dayMeals = (localPlan.meals || []).filter((m: any) => m.day === dayNum)
                                const dayName = dayMeals[0]?.dayName || `Gün ${dayNum} `
                                const dayActual = weeklyStats.dayMacros?.[i] || { calories: 0, protein: 0, carbs: 0, fat: 0 }
                                const isOver = dayActual.calories > target.calories * ((tolerances.calories?.max ?? 110) / 100)
                                const isUnder = dayActual.calories < target.calories * ((tolerances.calories?.min ?? 90) / 100)

                                return (
                                    <div key={dayNum} className="border rounded-lg overflow-hidden">
                                        {/* Day Header */}
                                        <div className="bg-slate-100 px-3 py-2 flex items-center justify-between">
                                            <span className="font-semibold text-slate-800">{dayName}</span>
                                            <div className="flex items-center gap-2 text-[10px]">
                                                <span className={`px-1.5 py-0.5 rounded ${isOver ? 'bg-red-100 text-red-700' : isUnder ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'} `}>
                                                    {dayActual.calories} kcal
                                                </span>
                                                <span className="text-slate-400">P:{dayActual.protein}g K:{dayActual.carbs}g Y:{dayActual.fat}g</span>
                                                <button
                                                    onClick={() => handleSmartBalance('daily', dayNum)}
                                                    disabled={isBalancing || isFlavorTuning}
                                                    className="p-0.5 rounded hover:bg-emerald-100 text-emerald-600 transition-colors disabled:opacity-50"
                                                    title={`Gün ${dayNum} Dengele`}
                                                >
                                                    <Scale size={12} />
                                                </button>
                                                <button
                                                    onClick={() => handleFlavorTune('daily', dayNum)}
                                                    disabled={isBalancing || isFlavorTuning}
                                                    className="p-0.5 rounded hover:bg-violet-100 text-violet-600 transition-colors disabled:opacity-50"
                                                    title={`Gun ${dayNum} Lezzet Ayari`}
                                                >
                                                    <Sparkles size={12} className={isFlavorTuning ? 'animate-spin' : ''} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Slots stacked vertically */}
                                        <div className="divide-y">
                                            {allSlots.map(slot => {
                                                const slotMeals = dayMeals.filter((m: any) => m.slot === slot)
                                                if (slotMeals.length === 0) return null

                                                const slotCalories = slotMeals.reduce((sum: number, m: any) => {
                                                    const cal = m.food.calories || 0
                                                    let mult = m.portion_multiplier
                                                    if (typeof mult !== 'number' || isNaN(mult)) mult = 1
                                                    return sum + (cal * mult)
                                                }, 0)

                                                return (
                                                    <div key={slot} className="px-3 py-2 bg-white">
                                                        {/* Slot Header */}
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className="text-xs font-medium text-slate-600 uppercase">{slot}</span>
                                                            <span className="text-[10px] text-slate-400">{slotCalories} kcal</span>
                                                        </div>

                                                        {/* Foods in this slot - sorted by role order */}
                                                        <div className="space-y-0.5">
                                                            {[...slotMeals].sort((a: any, b: any) => {
                                                                const roleA = a.food?.role || ''
                                                                const roleB = b.food?.role || ''
                                                                const orderA = ROLE_ORDER.indexOf(roleA)
                                                                const orderB = ROLE_ORDER.indexOf(roleB)
                                                                return (orderA === -1 ? 99 : orderA) - (orderB === -1 ? 99 : orderB)
                                                            }).map((meal: any, idx: number) => {
                                                                if (!meal.food) return null

                                                                const isFixed = meal.food.portion_fixed === true || (
                                                                    meal.food.min_quantity !== null &&
                                                                    meal.food.max_quantity !== null &&
                                                                    meal.food.min_quantity === meal.food.max_quantity
                                                                )

                                                                // Safe multiplier access
                                                                let currentMult = meal.portion_multiplier
                                                                if (typeof currentMult !== 'number' || isNaN(currentMult)) currentMult = 1

                                                                const isChanged = currentMult !== 1
                                                                const adjustedCal = Math.round((meal.food.calories || 0) * currentMult)
                                                                const ruleSources = getMealRuleSources(meal)

                                                                return (
                                                                    <div key={idx} className="flex items-center gap-2 text-[11px] group">
                                                                        {/* PORTION CONTROL COLUMN */}
                                                                        <div className="shrink-0 w-14">
                                                                            {(() => {
                                                                                if (isFixed) {
                                                                                    return (
                                                                                        <div className="text-[10px] text-slate-300 text-center font-mono">
                                                                                            x{currentMult}
                                                                                        </div>
                                                                                    )
                                                                                }

                                                                                // Generate Options
                                                                                const min = meal.food.min_quantity ?? 0.5
                                                                                const max = meal.food.max_quantity ?? 3.0
                                                                                const step = meal.food.step ?? 0.5
                                                                                const options: number[] = []

                                                                                let current = min
                                                                                const safeStep = step <= 0 ? 0.5 : step

                                                                                while (current <= max + 0.001) {
                                                                                    options.push(parseFloat(current.toFixed(2)))
                                                                                    current += safeStep
                                                                                }

                                                                                if (!options.includes(currentMult)) {
                                                                                    options.push(currentMult)
                                                                                    options.sort((a, b) => a - b)
                                                                                }

                                                                                return (
                                                                                    <select
                                                                                        className={`h-5 w-full text-[10px] rounded border px-0 appearance-none cursor-pointer outline-none transition-colors text-center
                                                                                            ${isChanged
                                                                                                ? 'bg-red-50 text-red-600 border-red-200 font-bold'
                                                                                                : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
                                                                                            }`}
                                                                                        value={currentMult}
                                                                                        onChange={(e) => {
                                                                                            const newVal = parseFloat(e.target.value)
                                                                                            setLocalPlan((prev: any) => ({
                                                                                                ...prev,
                                                                                                meals: prev.meals.map((m: any) => {
                                                                                                    if (m.day === dayNum && m.slot === slot && m.food.id === meal.food.id) {
                                                                                                        return { ...m, portion_multiplier: newVal }
                                                                                                    }
                                                                                                    return m
                                                                                                })
                                                                                            }))
                                                                                        }}
                                                                                    >
                                                                                        {options.map((val) => (
                                                                                            <option key={val} value={val}>x{val}</option>
                                                                                        ))}
                                                                                    </select>
                                                                                )
                                                                            })()}
                                                                        </div>

                                                                        <button
                                                                            onClick={() => {
                                                                                setLocalPlan((prev: any) => ({
                                                                                    ...prev,
                                                                                    meals: prev.meals.map((m: any) => {
                                                                                        if (m.day === dayNum && m.slot === slot && m.food.id === meal.food.id) {
                                                                                            return { ...m, isLocked: !m.isLocked }
                                                                                        }
                                                                                        return m
                                                                                    })
                                                                                }))
                                                                            }}
                                                                            className={`h-5 w-5 flex items-center justify-center rounded mr-1 ${meal.isLocked ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'}`}
                                                                            title={meal.isLocked ? "Kilidi Kaldır" : "Kilitle (Bu seçim korunsun)"}
                                                                        >
                                                                            {meal.isLocked ? <Lock size={10} /> : <Unlock size={10} />}
                                                                        </button>

                                                                        <button
                                                                            onClick={() => {
                                                                                setEditFood(meal.food)
                                                                                setFoodDialogOpen(true)
                                                                            }}
                                                                            className="h-5 w-5 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded"
                                                                        >
                                                                            <Pencil size={10} />
                                                                        </button>

                                                                        {(() => {
                                                                            const roleLabel = ROLE_LABELS[meal.food.role] || meal.food.role || '?'
                                                                            const roleColor = ROLE_COLORS[meal.food.role] || 'text-slate-500 bg-slate-50 border-slate-200'
                                                                            return (
                                                                                <span className={`px-1 rounded border text-[9px] ${roleColor}`}>
                                                                                    {roleLabel}
                                                                                </span>
                                                                            )
                                                                        })()}

                                                                        <span className="flex-1 truncate text-slate-700 ml-1" title={meal.food.name}>
                                                                            {getScaledFoodName(meal.food.name, currentMult, scalableUnits)}
                                                                            {meal.food.unit && <span className="text-slate-400 ml-1 text-[9px]">({meal.food.unit})</span>}
                                                                            {renderCompatibilityBadge(meal, slotMeals)}
                                                                        </span>

                                                                        <div className="shrink-0 ml-2 flex items-center gap-1">
                                                                            {ruleSources.length > 0 && (
                                                                                <div className="w-56 max-w-[220px] flex flex-wrap items-center justify-end gap-1">
                                                                                    {ruleSources.map((ruleSource) => (
                                                                                        <React.Fragment key={ruleSource.key}>
                                                                                            <span
                                                                                                className={`px-1.5 py-0.5 rounded border text-[9px] truncate max-w-[170px] ${getRuleChipColorClass(ruleSource.ruleId || ruleSource.fullLabel)}`}
                                                                                                title={ruleSource.fullLabel}
                                                                                            >
                                                                                                {ruleSource.label}
                                                                                            </span>
                                                                                            {patientId && ruleSource.isEditable && (
                                                                                                <button
                                                                                                    onClick={() => openRulesFromMeal(ruleSource.ruleId, ruleSource.ruleNameHint)}
                                                                                                    className="h-5 w-5 shrink-0 flex items-center justify-center rounded text-violet-500 hover:text-violet-700 hover:bg-violet-100"
                                                                                                    title="Bu kuralı düzenle"
                                                                                                >
                                                                                                    <Pencil size={10} />
                                                                                                </button>
                                                                                            )}
                                                                                        </React.Fragment>
                                                                                    ))}
                                                                                </div>
                                                                            )}

                                                                            {/* Adjusted Calories */}
                                                                            <span className={`text-[10px] tabular-nums ${isChanged ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                                                                                {adjustedCal} kcal
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </TabsContent>

                        <TabsContent value="report" className="flex-1 min-h-0 overflow-hidden mt-0 flex flex-col">
                            <div className="flex-1 overflow-y-auto p-4">
                                {plan?.logs && plan.logs.length > 0 ? (
                                    <div className="space-y-1 font-mono text-xs">
                                        {plan.logs.map((log: any, idx: number) => (
                                            <div key={idx} className={`flex gap - 2 py - 1 border - b border - slate - 100 ${log.event === 'error' ? 'bg-red-50 text-red-800' :
                                                log.event === 'reject' ? 'text-orange-600' :
                                                    log.event === 'select' ? 'text-green-700' : 'text-slate-600'
                                                } `}>
                                                <span className="w-24 shrink-0 font-semibold text-slate-400">
                                                    {log.day === 0 ? 'GENEL' : `G${log.day} ${log.slot?.substring(0, 3)} `}
                                                </span>
                                                <span className="uppercase font-bold shrink-0 w-16 text-[10px] pt-0.5">
                                                    {log.event}
                                                </span>
                                                <div className="flex-1 break-words">
                                                    <span>{log.reason}</span>
                                                    {log.food && <span className="font-bold ml-1">[{log.food}]</span>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-slate-400">
                                        Rapor kaydı bulunamadı.
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    </Tabs>

                    {/* Footer - Fixed */}
                    <DialogFooter className="px-4 pt-3 pb-8 sm:pb-3 border-t bg-white shrink-0 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setSettingsOpen(true)}
                                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 hover:bg-slate-100 px-2 py-1 rounded transition-colors"
                            >
                                Ayarlar
                            </button>
                            <button
                                onClick={recenterDialog}
                                className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 hover:bg-slate-100 px-2 py-1 rounded transition-colors hidden sm:flex"
                            >
                                ⤢ Ortala
                            </button>
                            {patientId && (
                                <button
                                    onClick={() => {
                                        setFocusedRuleId(null)
                                        setFocusedRuleName(null)
                                        setRulesOpen(true)
                                    }}
                                    className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 hover:bg-slate-100 px-2 py-1 rounded transition-colors"
                                >
                                    Kurallar
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
                            <Button onClick={() => onConfirm(localPlan)} disabled={loading} className="bg-green-600 hover:bg-green-700">
                                {loading ? 'Kaydediliyor...' : 'Planı Uygula'}
                            </Button>
                        </div>
                    </DialogFooter>

                    {/* Bottom-right resize handle (mouse drag) */}
                    <div
                        onMouseDown={handleResizeStart}
                        className="absolute right-0 bottom-0 h-5 w-5 cursor-se-resize z-30 group hidden sm:block"
                        title="Boyutlandır"
                    >
                        <div className="absolute right-1 bottom-1 h-3 w-3 border-r-2 border-b-2 border-slate-300 group-hover:border-slate-500" />
                    </div>
                </DialogContent >
            </Dialog >

            {/* Food Edit Dialog */}
            {
                foodDialogOpen && editFood && (
                    <FoodEditDialog
                        isOpen={foodDialogOpen}
                        onClose={() => setFoodDialogOpen(false)}
                        food={editFood}
                        onUpdate={() => {
                            // Refetch or update context if needed
                        }}
                        onSave={async (data) => {
                            // Separate micronutrients array (not a column in 'foods' table)
                            const { micronutrients, ...foodsPayload } = data
                            const baseFoodId = editFood.base_food_id || editFood.id
                            const { userId, teamOwnerId } = await resolveTeamScopeContextFromAuth()

                            let savedFood: any = null
                            let error: any = null

                            if (teamOwnerId && userId) {
                                const { error: overrideError } = await upsertTeamFoodOverride({
                                    teamOwnerId,
                                    baseFoodId,
                                    createdBy: userId,
                                    updates: foodsPayload
                                })

                                if (overrideError) {
                                    error = overrideError
                                } else {
                                    const { data: baseFood, error: baseFoodError } = await supabase
                                        .from('foods')
                                        .select('*')
                                        .eq('id', baseFoodId)
                                        .single()

                                    if (baseFoodError) {
                                        error = baseFoodError
                                    } else {
                                        const [effectiveFood] = await applyTeamFoodOverrides(baseFood ? [baseFood] : [], teamOwnerId)
                                        savedFood = effectiveFood || baseFood
                                    }
                                }
                            } else {
                                const result = await supabase
                                    .from('foods')
                                    .update(foodsPayload)
                                    .eq('id', baseFoodId)
                                    .select()
                                    .single()

                                savedFood = result.data
                                error = result.error
                            }

                            if (error) {
                                console.error("Error saving food:", error)
                                throw error // Pass error up to FoodEditDialog alert
                            }

                            if (Array.isArray(micronutrients)) {
                                const { error: microError } = await saveFoodMicronutrientsByScope({
                                    baseFoodId,
                                    teamOwnerId,
                                    micronutrients,
                                    createdBy: userId
                                })
                                if (microError) throw microError
                            }

                            setFoodDialogOpen(false)
                            return savedFood
                        }}
                    />
                )
            }

            {/* Planner Settings Dialog */}
            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                onSettingsChanged={() => {
                    // Notify parent that meal types may have changed
                    onMealTypesChanged?.()
                }}
                patientId={patientId}
                programTemplateId={programTemplateId}
                activeWeekId={activeWeekId}
            />

            {/* Patient Rules Dialog */}
            {patientId && (
                <PatientRulesDialog
                    open={rulesOpen}
                    onOpenChange={(nextOpen) => {
                        setRulesOpen(nextOpen)
                        if (!nextOpen) {
                            setFocusedRuleId(null)
                            setFocusedRuleName(null)
                        }
                    }}
                    patientId={patientId}
                    programTemplateId={programTemplateId}
                    focusRuleId={focusedRuleId}
                    focusRuleName={focusedRuleName}
                    onRulesChanged={() => {
                        // Optionally trigger regenerate
                    }}
                />
            )}
            <BalanceConfirmModal
                isOpen={flavorModal.isOpen}
                title={flavorModal.title}
                changes={flavorModal.changes}
                initialTotals={flavorModal.initialTotals}
                targetMacros={flavorModal.targetMacros}
                defaultSelectAll={true}
                onClose={() => {
                    flavorModal.resolve?.(null)
                    setFlavorModal(prev => ({ ...prev, isOpen: false }))
                }}
                onConfirm={(approvedChanges) => {
                    flavorModal.resolve?.(approvedChanges)
                    setFlavorModal(prev => ({ ...prev, isOpen: false }))
                }}
            />
        </>
    )
}

