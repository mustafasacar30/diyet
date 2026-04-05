"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { AlertCircle } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, GripVertical, Plus, X, RotateCcw, Move } from "lucide-react"
import { MealTypesEditor, SlotConfig as MealSlotConfig } from "@/components/planner/meal-types-editor"

import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { resolvePlannerScope, resolveTeamScopeContextFromAuth } from "@/lib/team-scope"

interface SettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSettingsChanged?: () => void
    patientId?: string // Optional patient ID for scoped settings
    programTemplateId?: string | null // Program template for fallback
    activeWeekId?: string // Active week ID for slot config sync
    defaultTab?: string // Tab to open by default
    hideRevertButton?: boolean // If true, hides the "Varsayılan Ayarlara Dön" button
    slotsOnly?: boolean // If true, hides the tab navigation and only allows interacting with the slots tab
    forcedMode?: 'global' | 'team'
}

const defaultCriteria = [
    { id: "allergen", weight: 500, label: "Alerjen Kontrolü" },
    { id: "diet_type", weight: 100, label: "Diyet Tipine Uyum" },
    { id: "med_interactions", weight: 90, label: "İlaç Etkileşimi (Negatif)" },
    { id: "macro_targets", weight: 100, label: "Makro Hedef Uyumu" },
    { id: "disliked_food", weight: 80, label: "Sevilmeyen Yemekten Kaçınma" },
    { id: "seasonality", weight: 60, label: "Mevsimsellik" },
    { id: "micronutrients", weight: 50, label: "Mikro Besin Zenginliği" },
    { id: "liked_food", weight: 40, label: "Sevilen Yemek Önceliği" },
    { id: "variety", weight: 30, label: "Çeşitlilik (Tekrar Önleme)" }
]

const defaultMacroPriorities = { protein: 5, carb: 5, fat: 5 }

const defaultPortionSettings = {
    global_min: 0.5,
    global_max: 2.0,
    step_value: 0.5,
    max_adjusted_items_per_day: 5,
    max_calorie_percentage: 50, // Default 50%
    strategies: {
        macro_convergence: false,
        max_limit_protection: true
    },
    scalable_units: [] as string[],
    macro_tolerances: {
        protein: { min: 80, max: 120 },
        carb: { min: 80, max: 120 },
        fat: { min: 80, max: 120 },
        calories: { min: 90, max: 110 }
    }
}

const defaultSlotConfigs: MealSlotConfig[] = [
    { name: 'KAHVALTI', min_items: 1, max_items: 4 },
    { name: 'ÖĞLEN', min_items: 2, max_items: 6 },
    { name: 'AKŞAM', min_items: 2, max_items: 6 },
    { name: 'ARA ÖĞÜN', min_items: 1, max_items: 3 },
]

// â”€â”€â”€ SOURCE BADGE LABELS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SOURCE_BADGE: Record<string, { label: string, className: string }> = {
    patient: { label: 'Hasta', className: 'bg-green-100 text-green-700 border-green-200' },
    program: { label: 'Program', className: 'bg-blue-100 text-blue-700 border-blue-200' },
    team: { label: 'Takım', className: 'bg-violet-100 text-violet-700 border-violet-200' },
    global: { label: 'Global', className: 'bg-gray-100 text-gray-600 border-gray-200' },
}

const SourceBadge = ({ source }: { source?: 'global' | 'team' | 'program' | 'patient' | string }) => {
    if (!source) return null;
    const badge = SOURCE_BADGE[source];
    if (!badge) return null;
    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold shrink-0 ml-2 ${badge.className}`}>
            {badge.label}
        </span>
    )
}

// â”€â”€â”€ HELPER COMPONENT FOR FOOD SCORE ROW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FoodScoreRow = ({ foodId, name, initialScore, onScoreChange, onRemove, source, inherited, onToggle }: {
    foodId: string, name: string, initialScore: number,
    onScoreChange?: (val: number) => void, onRemove?: () => void,
    source?: 'global' | 'team' | 'program' | 'patient',
    inherited?: boolean,
    onToggle?: (enabled: boolean) => void
}) => {
    const [localScore, setLocalScore] = useState(initialScore)

    // Sync external changes (e.g., if revert is clicked or parent loads new data)
    useEffect(() => {
        setLocalScore(initialScore)
    }, [initialScore])

    const badge = source ? SOURCE_BADGE[source] : null
    const isEditable = !inherited

    return (
        <div className={`flex items-center gap-2 rounded border px-2 py-1.5 ${inherited ? 'bg-slate-50/70 opacity-75' : 'bg-white'}`}>
            {badge && (
                <span className={`text-[8px] px-1.5 py-0.5 rounded border font-semibold shrink-0 ${badge.className}`}>
                    {badge.label}
                </span>
            )}
            <span className="text-xs flex-1 truncate" title={foodId}>{name}</span>
            {onToggle && (
                <label className="flex items-center gap-1 shrink-0 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={!inherited}
                        onChange={e => onToggle(e.target.checked)}
                        className="rounded h-3 w-3"
                    />
                    <span className="text-[9px] text-slate-500">Aktif</span>
                </label>
            )}
            <input
                type="range" min={0} max={10} step={1}
                value={localScore}
                onChange={e => isEditable && setLocalScore(Number(e.target.value))}
                onMouseUp={() => isEditable && onScoreChange?.(localScore)}
                onTouchEnd={() => isEditable && onScoreChange?.(localScore)}
                className={`w-24 h-1.5 ${isEditable ? 'accent-blue-600' : 'accent-gray-400'}`}
                disabled={!isEditable}
            />
            <span className={`text-xs font-bold w-5 text-center ${localScore === 0 ? 'text-red-600' : localScore <= 3 ? 'text-orange-500' : localScore >= 8 ? 'text-green-600' : 'text-slate-700'}`}>
                {localScore}
            </span>
            {onRemove && (
                <button
                    onClick={onRemove}
                    className="text-red-400 hover:text-red-600 px-1"
                    title="Kaldır"
                            >×</button>
            )}
        </div>
    )
}

// â”€â”€â”€ MAIN COMPONENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function SettingsDialog({ open, onOpenChange, onSettingsChanged, patientId, programTemplateId, activeWeekId, defaultTab, hideRevertButton, slotsOnly, forcedMode }: SettingsDialogProps) {
    const [loading, setLoading] = useState(false)
    const [items, setItems] = useState(defaultCriteria)
    const [exemptTags, setExemptTags] = useState<string[]>([])
    const [nameExemptWords, setNameExemptWords] = useState<string[]>([])
    const [newTag, setNewTag] = useState("")
    const [newNameExemptWord, setNewNameExemptWord] = useState("")
    const [settingsId, setSettingsId] = useState<string | null>(null)
    const [enableNameSimilarity, setEnableNameSimilarity] = useState(false)
    const [varietyPreference, setVarietyPreference] = useState<'balanced' | 'max_variety' | 'stability'>('balanced')
    const [varietyMode, setVarietyMode] = useState<'cooldown' | 'score_only' | 'hybrid' | 'off'>('hybrid')
    const [cooldownStrength, setCooldownStrength] = useState(5)
    const [likedBoost, setLikedBoost] = useState(3000)
    const [maxWeeklyDefault, setMaxWeeklyDefault] = useState(3)
    const [foodScoreOverrides, setFoodScoreOverrides] = useState<Record<string, number>>({})
    const [foodScoreNames, setFoodScoreNames] = useState<Record<string, string>>({})
    const [overrideSearch, setOverrideSearch] = useState('')
    const [overrideFoods, setOverrideFoods] = useState<any[]>([])
    const [overrideSort, setOverrideSort] = useState<'desc' | 'asc'>('desc')
    // Per-food-ID source tracking for inheritance display
    const [foodScoreSources, setFoodScoreSources] = useState<Record<string, 'global' | 'team' | 'program' | 'patient'>>({})
    // Inherited scores from upper layers (not in current scope) â€” shown with toggles
    const [inheritedScores, setInheritedScores] = useState<Record<string, { score: number, source: 'global' | 'team' | 'program' }>>({})
    const [macroPriorities, setMacroPriorities] = useState(defaultMacroPriorities)

    // Tracks where each setting was inherited from: 'global', 'program', 'patient'
    const [fieldSources, setFieldSources] = useState<Record<string, 'global' | 'team' | 'program' | 'patient'>>({})
    const [activeScope, setActiveScope] = useState<'global' | 'team' | 'program' | 'patient'>('global')
    const [layerRows, setLayerRows] = useState<Partial<Record<'global' | 'team' | 'program' | 'patient', any>>>({})
    const [parentEffectiveValues, setParentEffectiveValues] = useState<Record<string, any>>({})
    const [hasVarietyExemptColumn, setHasVarietyExemptColumn] = useState<boolean>(true)

    // Portion Settings State
    const [portionSettings, setPortionSettings] = useState(defaultPortionSettings)
    const [newUnit, setNewUnit] = useState("")

    // Meal Types / Slot Config - stored as array matching MealTypesEditor format
    const [mealTypesConfig, setMealTypesConfig] = useState<MealSlotConfig[]>(defaultSlotConfigs)
    const [mealTypesKey, setMealTypesKey] = useState(0) // Force re-mount MealTypesEditor on open

    const [varietyExemptWords, setVarietyExemptWords] = useState<string[]>([])
    const [newVarietyExemptWord, setNewVarietyExemptWord] = useState("")
    const nameExemptWordsRef = useRef<string[]>([])
    const varietyExemptWordsRef = useRef<string[]>([])

    useEffect(() => {
        nameExemptWordsRef.current = nameExemptWords
    }, [nameExemptWords])

    useEffect(() => {
        varietyExemptWordsRef.current = varietyExemptWords
    }, [varietyExemptWords])

    // â”€â”€ DRAG FUNCTIONALITY â”€â”€
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
    const isDragging = useRef(false)
    const dragStart = useRef({ x: 0, y: 0 })
    const dialogRef = useRef<HTMLDivElement>(null)

    const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
        // Only drag from header area, not from buttons/inputs inside it
        if ((e.target as HTMLElement).closest('button, input, select, [role="tablist"]')) return
        isDragging.current = true
        dragStart.current = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y }
        e.preventDefault()
    }, [dragOffset])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return
            setDragOffset({
                x: e.clientX - dragStart.current.x,
                y: e.clientY - dragStart.current.y
            })
        }
        const handleMouseUp = () => { isDragging.current = false }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [])

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const resolveEffectiveScopeContext = useCallback(async () => {
        let ctx = await resolveTeamScopeContextFromAuth()

        const canForceTeamModeForAdminDoctor =
            forcedMode === 'team' &&
            ctx.role === 'doctor' &&
            ctx.canUseGlobal &&
            !!ctx.userId

        if (canForceTeamModeForAdminDoctor && ctx.userId) {
            ctx = {
                ...ctx,
                canUseGlobal: false,
                teamOwnerId: ctx.userId
            }
        }

        return ctx
    }, [forcedMode])

    useEffect(() => {
        if (open) {
            setDragOffset({ x: 0, y: 0 }) // Reset position when dialog opens
            setMealTypesKey(prev => prev + 1) // Increment key to force MealTypesEditor re-mount
            fetchSettings()
        }
    }, [open, activeWeekId, forcedMode])

    const toComparableValue = (value: any): any => {
        if (value === undefined) return null
        if (value === null) return null
        if (Array.isArray(value)) return value.map(toComparableValue)
        if (typeof value === 'object') {
            return Object.keys(value)
                .sort()
                .reduce((acc: Record<string, any>, key) => {
                    acc[key] = toComparableValue(value[key])
                    return acc
                }, {})
        }
        return value
    }

    const areValuesEquivalent = (left: any, right: any) => {
        return JSON.stringify(toComparableValue(left)) === JSON.stringify(toComparableValue(right))
    }

    const getRowVarietyExemptWords = (row: any): string[] | null => {
        if (!row) return null
        if (Array.isArray(row.variety_exempt_words)) return row.variety_exempt_words
        if (Array.isArray(row?.portion_settings?.variety_exempt_words)) return row.portion_settings.variety_exempt_words
        return null
    }

    const getFieldValueFromRow = (row: any, field: string): any => {
        if (field === 'variety_exempt_words') {
            return getRowVarietyExemptWords(row)
        }
        return row?.[field]
    }

    async function fetchSettings() {
        setLoading(true)
        let mergedData: any = {}
        let sources: Record<string, 'global' | 'team' | 'program' | 'patient'> = {}
        let finalSettingsId: string | null = null
        const fetchedLayerRows: Partial<Record<'global' | 'team' | 'program' | 'patient', any>> = {}

        try {
            // Probe whether the variety_exempt_words column exists.
            // If the column is missing, Supabase returns a 400 — we catch that silently.
            let varietyColumnAvailable = false
            try {
                const { error: varietyColumnCheckError } = await supabase
                    .from('planner_settings')
                    .select('variety_exempt_words')
                    .limit(1)
                varietyColumnAvailable = !varietyColumnCheckError
            } catch {
                // Network or unexpected error — assume column not available
            }
            setHasVarietyExemptColumn(varietyColumnAvailable)

            const scopeCtx = await resolveEffectiveScopeContext()
            const currentScope = resolvePlannerScope(patientId, programTemplateId, {
                role: scopeCtx.role,
                canUseGlobal: scopeCtx.canUseGlobal,
                teamOwnerId: scopeCtx.teamOwnerId
            })
            setActiveScope(currentScope)

            const scopedTeamOwnerId = (scopeCtx.teamOwnerId && !scopeCtx.canUseGlobal)
                ? scopeCtx.teamOwnerId
                : null

            const mergeLayer = (row: any, layer: 'global' | 'team' | 'program' | 'patient') => {
                if (!row) return
                Object.keys(row).forEach((key) => {
                    if (row[key] !== null) {
                        mergedData[key] = row[key]
                        sources[key] = layer
                    }
                })

                const varietyWords = getRowVarietyExemptWords(row)
                if (varietyWords !== null) {
                    mergedData.variety_exempt_words = varietyWords
                    sources.variety_exempt_words = layer
                }
            }

            const pickLatest = (rows: any[] | null | undefined) => (rows && rows.length > 0 ? rows[0] : null)

            const { data: globalRows } = await supabase
                .from('planner_settings')
                .select('*')
                .eq('scope', 'global')
                .order('updated_at', { ascending: false })
                .limit(1)
            const globalSettings = pickLatest(globalRows)
            if (globalSettings) {
                fetchedLayerRows.global = globalSettings
                mergeLayer(globalSettings, 'global')
                if (currentScope === 'global') finalSettingsId = globalSettings.id
            }

            let teamSettings: any = null
            if (scopedTeamOwnerId) {
                const { data: teamRows } = await supabase
                    .from('planner_settings')
                    .select('*')
                    .eq('scope', 'team')
                    .eq('team_owner_id', scopedTeamOwnerId)
                    .order('updated_at', { ascending: false })
                    .limit(1)
                teamSettings = pickLatest(teamRows)
                if (teamSettings) {
                    fetchedLayerRows.team = teamSettings
                    mergeLayer(teamSettings, 'team')
                    if (currentScope === 'team') finalSettingsId = teamSettings.id
                }
            }

            let programSettings: any = null
            if (programTemplateId) {
                let programQuery = supabase
                    .from('planner_settings')
                    .select('*')
                    .eq('scope', 'program')
                    .eq('program_template_id', programTemplateId)

                if (scopedTeamOwnerId) {
                    programQuery = programQuery.eq('team_owner_id', scopedTeamOwnerId)
                } else {
                    programQuery = programQuery.is('team_owner_id', null)
                }

                const { data: programRows } = await programQuery
                    .order('updated_at', { ascending: false })
                    .limit(1)
                programSettings = pickLatest(programRows)
                if (programSettings) {
                    fetchedLayerRows.program = programSettings
                    mergeLayer(programSettings, 'program')
                    if (currentScope === 'program') finalSettingsId = programSettings.id
                }
            }

            let patientSettings: any = null
            if (patientId) {
                let patientQuery = supabase
                    .from('planner_settings')
                    .select('*')
                    .eq('scope', 'patient')
                    .eq('patient_id', patientId)

                if (scopedTeamOwnerId) {
                    patientQuery = patientQuery.eq('team_owner_id', scopedTeamOwnerId)
                } else {
                    patientQuery = patientQuery.is('team_owner_id', null)
                }

                const { data: patientRows } = await patientQuery
                    .order('updated_at', { ascending: false })
                    .limit(1)
                patientSettings = pickLatest(patientRows)
                if (patientSettings) {
                    fetchedLayerRows.patient = patientSettings
                    mergeLayer(patientSettings, 'patient')
                    if (currentScope === 'patient') finalSettingsId = patientSettings.id
                }
            }

            const parentMerged: Record<string, any> = {}
            const mergeParentLayer = (row: any) => {
                if (!row) return
                Object.keys(row).forEach((key) => {
                    if (row[key] !== null) {
                        parentMerged[key] = row[key]
                    }
                })

                const varietyWords = getRowVarietyExemptWords(row)
                if (varietyWords !== null) {
                    parentMerged.variety_exempt_words = varietyWords
                }
            }

            if (currentScope === 'team') {
                mergeParentLayer(globalSettings)
            } else if (currentScope === 'program') {
                mergeParentLayer(globalSettings)
                mergeParentLayer(teamSettings)
            } else if (currentScope === 'patient') {
                mergeParentLayer(globalSettings)
                mergeParentLayer(teamSettings)
                mergeParentLayer(programSettings)
            }

            setSettingsId(finalSettingsId)
            setFieldSources(sources)
            setLayerRows(fetchedLayerRows)
            setParentEffectiveValues(parentMerged)

            const data = Object.keys(mergedData).length > 0 ? mergedData : null

            if (data) {
                // Reset all state to defaults before hydrating
                setItems(defaultCriteria)
                setExemptTags([])
                setEnableNameSimilarity(false)
                setNameExemptWords([])
                setVarietyPreference('balanced')
                setVarietyMode('hybrid')
                setCooldownStrength(5)
                setLikedBoost(3000)
                setMaxWeeklyDefault(3)
                setVarietyExemptWords([])
                setFoodScoreOverrides({})
                setFoodScoreNames({})
                setMacroPriorities(defaultMacroPriorities)
                setPortionSettings(defaultPortionSettings)
                setMealTypesConfig(defaultSlotConfigs)

                // 1. Process Weights
                if (data.weights) {
                    let loadedWeights = data.weights

                    if (!Array.isArray(loadedWeights)) {
                        // Legacy object format
                        const newItems = defaultCriteria.map(def => ({
                            ...def,
                            weight: (loadedWeights as any)[def.id] ?? def.weight
                        }))
                        setItems(newItems)
                    } else {
                        // Array format
                        const hydratedItems = (loadedWeights as any[]).map(w => {
                            const def = defaultCriteria.find(d => d.id === w.id)
                            return {
                                id: w.id,
                                weight: w.weight,
                                label: def?.label || w.id
                            }
                        })

                        // Add missing defaults
                        defaultCriteria.forEach(def => {
                            if (!hydratedItems.find(h => h.id === def.id)) {
                                hydratedItems.push(def)
                            }
                        })
                        setItems(hydratedItems)
                    }
                } else {
                    setItems(defaultCriteria)
                }

                // 2. Process Exempt Tags
                if (data.exempt_tags && Array.isArray(data.exempt_tags)) {
                    setExemptTags(data.exempt_tags)
                }

                // 2.1 Process Name Similarity
                setEnableNameSimilarity(data.enable_name_similarity_check || false)
                setNameExemptWords(data.name_similarity_exempt_words || [])

                // 2.2 Process Variety Preference
                if (data.variety_preference) setVarietyPreference(data.variety_preference)
                if (data.variety_mode) setVarietyMode(data.variety_mode)
                if (data.cooldown_strength != null) setCooldownStrength(data.cooldown_strength)
                if (data.liked_boost != null) setLikedBoost(data.liked_boost)
                if (data.max_weekly_default != null) setMaxWeeklyDefault(data.max_weekly_default)
                if (Array.isArray(data.variety_exempt_words)) {
                    setVarietyExemptWords(data.variety_exempt_words)
                } else if (Array.isArray(data?.portion_settings?.variety_exempt_words)) {
                    setVarietyExemptWords(data.portion_settings.variety_exempt_words)
                } else {
                    setVarietyExemptWords([])
                }

                // Per-food-ID inheritance merge for food_score_overrides
                const globalOverrides: Record<string, number> = globalSettings?.food_score_overrides || {}
                const teamOverrides: Record<string, number> = teamSettings?.food_score_overrides || {}
                const programOverrides: Record<string, number> = programSettings?.food_score_overrides || {}
                const patientOverrides: Record<string, number> = patientSettings?.food_score_overrides || {}

                let ownOverrides: Record<string, number> = {}
                const inherited: Record<string, { score: number, source: 'global' | 'team' | 'program' }> = {}
                const perFoodSources: Record<string, 'global' | 'team' | 'program' | 'patient'> = {}

                if (currentScope === 'global') {
                    ownOverrides = { ...globalOverrides }
                    Object.keys(ownOverrides).forEach(id => { perFoodSources[id] = 'global' })
                } else if (currentScope === 'team') {
                    ownOverrides = { ...teamOverrides }
                    Object.keys(ownOverrides).forEach(id => { perFoodSources[id] = 'team' })
                    Object.entries(globalOverrides).forEach(([id, score]) => {
                        if (!(id in ownOverrides)) {
                            inherited[id] = { score, source: 'global' }
                        }
                    })
                } else if (currentScope === 'program') {
                    ownOverrides = { ...programOverrides }
                    Object.keys(ownOverrides).forEach(id => { perFoodSources[id] = 'program' })

                    Object.entries(teamOverrides).forEach(([id, score]) => {
                        if (!(id in ownOverrides)) {
                            inherited[id] = { score, source: 'team' }
                        }
                    })
                    Object.entries(globalOverrides).forEach(([id, score]) => {
                        if (!(id in ownOverrides) && !(id in inherited)) {
                            inherited[id] = { score, source: 'global' }
                        }
                    })
                } else {
                    // patient scope
                    ownOverrides = { ...patientOverrides }
                    Object.keys(ownOverrides).forEach(id => { perFoodSources[id] = 'patient' })

                    Object.entries(programOverrides).forEach(([id, score]) => {
                        if (!(id in ownOverrides)) {
                            inherited[id] = { score, source: 'program' }
                        }
                    })
                    Object.entries(teamOverrides).forEach(([id, score]) => {
                        if (!(id in ownOverrides) && !(id in inherited)) {
                            inherited[id] = { score, source: 'team' }
                        }
                    })
                    Object.entries(globalOverrides).forEach(([id, score]) => {
                        if (!(id in ownOverrides) && !(id in inherited)) {
                            inherited[id] = { score, source: 'global' }
                        }
                    })
                }

                setFoodScoreOverrides(ownOverrides)
                setFoodScoreSources(perFoodSources)
                setInheritedScores(inherited)

                // Load food names for all referenced food IDs
                const allIds = [...new Set([...Object.keys(ownOverrides), ...Object.keys(inherited)])]
                if (allIds.length > 0) {
                    const { data: foods } = await supabase.from('foods').select('id, name').in('id', allIds)
                    if (foods) {
                        const nameMap: Record<string, string> = {}
                        foods.forEach((f: any) => { nameMap[f.id] = f.name })
                        setFoodScoreNames(nameMap)
                    }
                }

                // 2.3 Process Macro Priorities
                if (data.macro_priorities) {
                    setMacroPriorities(data.macro_priorities)
                } else {
                    setMacroPriorities({ protein: 5, carb: 5, fat: 5 })
                }

                // 3. Process Portion Settings
                if (data.portion_settings) {
                    setPortionSettings({
                        global_min: data.portion_settings.global_min ?? 0.5,
                        global_max: data.portion_settings.global_max ?? 2.0,
                        step_value: data.portion_settings.step_value ?? 0.5,
                        max_adjusted_items_per_day: data.portion_settings.max_adjusted_items_per_day ?? 5,
                        max_calorie_percentage: data.portion_settings.max_calorie_percentage ?? 50,
                        strategies: {
                            macro_convergence: data.portion_settings.strategies?.macro_convergence ?? false,
                            max_limit_protection: data.portion_settings.strategies?.max_limit_protection ?? true
                        },
                        scalable_units: data.portion_settings.scalable_units ?? [],
                        macro_tolerances: data.portion_settings.macro_tolerances ?? defaultPortionSettings.macro_tolerances
                    })
                }

                // 4. Set Meal Types (Slot Config)
                if (data.slot_config && Array.isArray(data.slot_config)) {
                    setMealTypesConfig(data.slot_config as MealSlotConfig[])
                }
            } else {
                // No settings yet
                setItems(defaultCriteria)
                setExemptTags([])
                setVarietyExemptWords([])
            }
        } catch (e) {
            console.error("Fetch Error:", e)
        }

        setLoading(false)
    }
    // Exempt Tag Handlers
    function handleAddTag() {
        if (!newTag.trim()) return
        const tag = newTag.trim().toLowerCase()
        if (!exemptTags.includes(tag)) {
            setExemptTags([...exemptTags, tag])
        }
        setNewTag("")
    }

    function handleRemoveTag(tagToRemove: string) {
        setExemptTags(exemptTags.filter(t => t !== tagToRemove))
    }

    // Name Exempt Word Handlers
    function handleAddNameExemptWord() {
        if (!newNameExemptWord.trim()) return
        const word = newNameExemptWord.trim().toLowerCase() // Store lowercase for easy comparison
        if (!nameExemptWords.includes(word)) {
            setNameExemptWords([...nameExemptWords, word])
        }
        setNewNameExemptWord("")
    }

    function handleRemoveNameExemptWord(wordToRemove: string) {
        setNameExemptWords(nameExemptWords.filter(w => w !== wordToRemove))
    }

    // Scalable Units Handlers
    function handleAddUnit() {
        if (!newUnit.trim()) return
        const unit = newUnit.trim().toLowerCase()
        const currentUnits = portionSettings.scalable_units || []
        if (!currentUnits.includes(unit)) {
            setPortionSettings(prev => ({ ...prev, scalable_units: [...currentUnits, unit] }))
        }
        setNewUnit("")
    }

    function handleRemoveUnit(unitToRemove: string) {
        setPortionSettings(prev => ({
            ...prev,
            scalable_units: (prev.scalable_units || []).filter(u => u !== unitToRemove)
        }))
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleAddTag()
        }
    }

    // Replaced by MealTypesEditor embedded component

    async function handleRevertToProgram() {
        const scopeCtx = await resolveEffectiveScopeContext()
        const hasTeamParent = !!scopeCtx.teamOwnerId && !scopeCtx.canUseGlobal
        const targetLabel = programTemplateId
            ? 'program ayarlarına'
            : hasTeamParent
                ? 'takım ayarlarına'
                : 'global ayarlara'

        if (!confirm(`Kişiselleştirmeleri iptal edip ${targetLabel} dönmek istediğinize emin misiniz?`)) return

        setLoading(true)
        if (settingsId && patientId) {
            await supabase.from('planner_settings').delete().eq('id', settingsId)
        }

        // After deleting, refetch settings to inherit from parent layer.
        await fetchSettings()
        setLoading(false)
    }

    async function handleSave() {
        setLoading(true)
        const user = (await supabase.auth.getUser()).data.user

        if (!user) {
            alert("Oturum açmanız gerekiyor.")
            setLoading(false)
            return
        }

        // 1. Save slot config to diet_weeks if activeWeekId is provided
        if (activeWeekId) {
            const mealNames = mealTypesConfig.map(c => c.name)
            await supabase
                .from('diet_weeks')
                .update({
                    meal_types: mealNames,
                    slot_configs: mealTypesConfig
                })
                .eq('id', activeWeekId)
        }

        // 2. Continue with planner_settings save (for other settings like weights, portions, etc.)
        const payloadWeights = items.map(i => ({ id: i.id, weight: i.weight }))
        const pendingNameWord = newNameExemptWord.trim().toLowerCase()
        const normalizedNameExemptWords = Array.from(
            new Set(
                [...nameExemptWordsRef.current, ...(pendingNameWord ? [pendingNameWord] : [])]
                    .map((word) => word.trim().toLowerCase())
                    .filter(Boolean)
            )
        )
        const pendingVarietyWord = newVarietyExemptWord.trim().toLowerCase()
        const normalizedVarietyExemptWords = Array.from(
            new Set(
                [...varietyExemptWordsRef.current, ...(pendingVarietyWord ? [pendingVarietyWord] : [])]
                    .map((word) => word.trim().toLowerCase())
                    .filter(Boolean)
            )
        )
        const payloadPortionSettings = {
            ...portionSettings,
            // Fallback persistence for deployments where variety_exempt_words column is missing.
            variety_exempt_words: normalizedVarietyExemptWords
        }

        const scopeCtx = await resolveEffectiveScopeContext()
        const currentScope = resolvePlannerScope(patientId, programTemplateId, {
            role: scopeCtx.role,
            canUseGlobal: scopeCtx.canUseGlobal,
            teamOwnerId: scopeCtx.teamOwnerId
        })
        const scopedTeamOwnerId = (scopeCtx.teamOwnerId && !scopeCtx.canUseGlobal)
            ? scopeCtx.teamOwnerId
            : null

        const payload: any = {
            user_id: user.id,
            scope: currentScope,
            team_owner_id: (currentScope === 'team' || currentScope === 'program' || currentScope === 'patient')
                ? scopedTeamOwnerId
                : null,
            patient_id: currentScope === 'patient' ? patientId : null,
            program_template_id: currentScope === 'program' ? programTemplateId : null,
            weights: payloadWeights,
            exempt_tags: exemptTags,
            portion_settings: payloadPortionSettings,
            // Save slot_config to planner_settings ALWAYS, ignoring activeWeekId conditionals, to ensure the profile is the source of truth
            slot_config: mealTypesConfig,
            enable_name_similarity_check: enableNameSimilarity,
            name_similarity_exempt_words: normalizedNameExemptWords,
            variety_preference: varietyPreference,
            variety_mode: varietyMode,
            cooldown_strength: cooldownStrength,
            liked_boost: likedBoost,
            max_weekly_default: maxWeeklyDefault,
            food_score_overrides: foodScoreOverrides,
            macro_priorities: macroPriorities
        }
        if (hasVarietyExemptColumn) {
            payload.variety_exempt_words = normalizedVarietyExemptWords
        }

        let targetSettingsId = settingsId

        if (!targetSettingsId) {
            let existingQuery = supabase
                .from('planner_settings')
                .select('id')
                .eq('scope', currentScope)

            if (currentScope === 'team' || currentScope === 'program' || currentScope === 'patient') {
                if (scopedTeamOwnerId) {
                    existingQuery = existingQuery.eq('team_owner_id', scopedTeamOwnerId)
                } else {
                    existingQuery = existingQuery.is('team_owner_id', null)
                }
            }

            if (currentScope === 'program') {
                existingQuery = existingQuery.eq('program_template_id', programTemplateId)
            }
            if (currentScope === 'patient') {
                existingQuery = existingQuery.eq('patient_id', patientId)
            }

            const { data: existingRows } = await existingQuery
                .order('updated_at', { ascending: false })
                .limit(1)

            targetSettingsId = existingRows?.[0]?.id || null
        }

        if (targetSettingsId) {
            const updatePayload: any = {
                scope: currentScope,
                team_owner_id: (currentScope === 'team' || currentScope === 'program' || currentScope === 'patient')
                    ? scopedTeamOwnerId
                    : null,
                patient_id: currentScope === 'patient' ? patientId : null,
                program_template_id: currentScope === 'program' ? programTemplateId : null,
                weights: payloadWeights,
                exempt_tags: exemptTags,
                portion_settings: payloadPortionSettings,
                slot_config: mealTypesConfig, // Always update slot config
                enable_name_similarity_check: enableNameSimilarity,
                name_similarity_exempt_words: normalizedNameExemptWords,
                variety_preference: varietyPreference,
                variety_mode: varietyMode,
                cooldown_strength: cooldownStrength,
                liked_boost: likedBoost,
                max_weekly_default: maxWeeklyDefault,
                food_score_overrides: foodScoreOverrides,
                macro_priorities: macroPriorities
            }
            if (hasVarietyExemptColumn) {
                updatePayload.variety_exempt_words = normalizedVarietyExemptWords
            }
            console.log("Updating Planner Settings:", updatePayload);
            const { error } = await supabase
                .from('planner_settings')
                .update(updatePayload)
                .eq('id', targetSettingsId);

            if (error) {
                console.error("Error updating planner settings:", error);
                throw error;
            }
        } else {
            console.log("Inserting Planner Settings:", payload);
            const { data: insertedRows, error } = await supabase
                .from('planner_settings')
                .insert(payload)
                .select('id');

            if (error) {
                console.error("Error inserting planner settings:", error);
                throw error;
            }

            if (insertedRows?.[0]?.id) {
                setSettingsId(insertedRows[0].id)
            }
        }

        // 3. IF we have an activeWeekId, also update matching week to ensure UI refresh
        // This maintains the bidirectional sync: Profile (Settings) <-> Active Week
        if (activeWeekId) {
            const newMealTypes = mealTypesConfig.map(c => c.name)
            await supabase
                .from('diet_weeks')
                .update({
                    meal_types: newMealTypes,
                    slot_configs: mealTypesConfig
                })
                .eq('id', activeWeekId)
        }

        onSettingsChanged?.()
        setLoading(false)
        onOpenChange(false)
    }

    function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;

        if (active.id !== over?.id) {
            setItems((items) => {
                const oldIndex = items.findIndex(i => i.id === active.id);
                const newIndex = items.findIndex(i => i.id === over?.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    }

    const updateWeight = (id: string, val: number) => {
        setItems(prev => prev.map(item => item.id === id ? { ...item, weight: val } : item))
    }

    // Helper component to render contextual Revert Button
    const RevertButton = ({ field }: { field: string | string[] }) => {
        const fields = Array.isArray(field) ? field : [field]
        const currentRow = layerRows[activeScope]
        const label =
            activeScope === 'team'
                ? "Bu Bölümü Global'e Dön"
                : activeScope === 'global'
                    ? "Bu Bölümü Üst Katmana Dön"
                    : "Bu Bölümü Üst Katmana Dön"
        const icon = <RotateCcw size={14} className="mr-1" />

        const hasAnyLocalValue = fields.some((f) => currentRow?.[f] !== null && currentRow?.[f] !== undefined)
        const hasMeaningfulOverride = fields.some((f) => {
            const localValue = getFieldValueFromRow(currentRow, f)
            if (localValue === null || localValue === undefined) return false
            const parentValue = parentEffectiveValues[f]
            if (
                Array.isArray(localValue) &&
                localValue.length === 0 &&
                (parentValue === null || parentValue === undefined || (Array.isArray(parentValue) && parentValue.length === 0))
            ) {
                return false
            }
            return !areValuesEquivalent(localValue, parentValue)
        })
        const hasAnyLocalValueNormalized = fields.some((f) => {
            const localValue = getFieldValueFromRow(currentRow, f)
            const parentValue = parentEffectiveValues[f]
            if (
                Array.isArray(localValue) &&
                localValue.length === 0 &&
                (parentValue === null || parentValue === undefined || (Array.isArray(parentValue) && parentValue.length === 0))
            ) {
                return false
            }
            return localValue !== null && localValue !== undefined
        })

        let disabledReason: string | null = null
        if (activeScope === 'global') {
            disabledReason = 'Global katmanda üst katman bulunmuyor'
        } else if (!settingsId) {
            disabledReason = 'Bu katmanda kayıt yok, üst katman mirası aktif'
        } else if (!hasAnyLocalValueNormalized) {
            disabledReason = activeScope === 'team'
                ? "Bu alan için global miras zaten aktif"
                : 'Bu alan bu katmanda özelleştirilmemiş'
        } else if (!hasMeaningfulOverride) {
            disabledReason = 'Bu alan zaten üst katmanla aynı'
        }

        const isDisabled = loading || !!disabledReason
        const activeReason = !isDisabled
            ? (() => {
                if (fields.length === 1 && fields[0] === 'variety_exempt_words') {
                    const localValue = getFieldValueFromRow(currentRow, 'variety_exempt_words')
                    const parentValue = parentEffectiveValues['variety_exempt_words']
                    const localCount = Array.isArray(localValue) ? localValue.length : 0
                    const parentCount = Array.isArray(parentValue) ? parentValue.length : 0
                    if (localCount === 0 && parentCount > 0) {
                        return `Bu katmanda istisna listesi bos. Ust katmanda ${parentCount} kelime var.`
                    }
                    return `Bu katmanda ${localCount} kelime kayitli ve ust katmandan farkli.`
                }
                return 'Bu bolumde ust katmandan farkli yerel ayar var.'
            })()
            : null

        return (
            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    if (!isDisabled) resetToGlobal(fields)
                }}
                disabled={isDisabled}
                title={disabledReason || activeReason || label}
                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 ml-4 border-orange-200 flex-shrink-0 min-w-max disabled:text-gray-400 disabled:border-gray-200 disabled:hover:bg-transparent"
            >
                {icon} {label}
            </Button>
        )
    }

    const resetToGlobal = async (fields: string | string[]) => {
        if (!settingsId) return

        if (!confirm("Bu ayarı üst katmandan miras alacak şekilde sıfırlamak istediğinize emin misiniz?")) return

        const fieldArray = Array.isArray(fields) ? fields : [fields]
        const updatePayload: Record<string, any> = {}
        fieldArray.forEach(f => {
            updatePayload[f] = null
        })

        if (fieldArray.includes('variety_exempt_words')) {
            const currentScopeRow = layerRows[activeScope]
            const currentScopePortion = (currentScopeRow?.portion_settings && typeof currentScopeRow.portion_settings === 'object')
                ? currentScopeRow.portion_settings
                : null

            if (currentScopePortion && Object.prototype.hasOwnProperty.call(currentScopePortion, 'variety_exempt_words')) {
                const { variety_exempt_words: _ignored, ...restPortion } = currentScopePortion
                updatePayload.portion_settings = restPortion
            }
        }

        try {
            const { error } = await supabase
                .from('planner_settings')
                .update(updatePayload)
                .eq('id', settingsId)

            if (error) throw error
            fetchSettings() // Reload to resolve inherited parent value
        } catch (e: any) {
            alert("Sıfırlama hatası: " + e.message)
        }
    }

    const handleToleranceChange = (macro: 'protein' | 'carb' | 'fat' | 'calories', bound: 'min' | 'max', val: string) => {
        const numVal = parseInt(val) || 0
        setPortionSettings(prev => {
            const currentTolerances = prev.macro_tolerances || defaultPortionSettings.macro_tolerances
            return {
                ...prev,
                macro_tolerances: {
                    ...currentTolerances,
                    [macro]: {
                        ...currentTolerances[macro],
                        [bound]: numVal
                    }
                }
            }
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                ref={dialogRef}
                className="max-w-5xl w-[95vw] sm:w-[90vw] max-h-[85vh] !top-[5%] !bottom-auto !left-0 !right-0 mx-auto !translate-y-0 !translate-x-0 flex flex-col p-0 gap-0"
                style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
            >
                {/* Draggable Header */}
                <div
                    onMouseDown={handleDragMouseDown}
                    className="px-6 py-4 border-b shrink-0 cursor-grab active:cursor-grabbing select-none flex items-start gap-3"
                >
                    <Move size={16} className="text-slate-400 mt-1 shrink-0" />
                    <DialogHeader className="flex-1">
                        <DialogTitle>Planlayıcı Ayarları</DialogTitle>
                        <DialogDescription>
                            Otomatik planlayıcının karar mekanizmasını buradan yapılandırabilirsiniz.
                        </DialogDescription>
                    </DialogHeader>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">

                    <Tabs defaultValue={defaultTab || "general"} className="w-full">
                        {!slotsOnly && (
                            <TabsList className="grid grid-cols-3 sm:grid-cols-4 w-full gap-1 mb-6 bg-slate-100 p-1 rounded-lg h-auto">
                                <TabsTrigger value="general" className="text-xs sm:text-sm">Genel</TabsTrigger>
                                <TabsTrigger value="slots" className="text-xs sm:text-sm">Öğün Şablonu</TabsTrigger>
                                <TabsTrigger value="weights" className="text-xs sm:text-sm">Puanlama</TabsTrigger>
                                <TabsTrigger value="scores" className="text-xs sm:text-sm">Yemek Skorları</TabsTrigger>
                                <TabsTrigger value="exempt" className="text-xs sm:text-sm">Muafiyet</TabsTrigger>
                                <TabsTrigger value="portion" className="text-xs sm:text-sm">Porsiyon</TabsTrigger>
                                <TabsTrigger value="macros" className="text-xs sm:text-sm">Nutritional</TabsTrigger>
                            </TabsList>
                        )}

                        {/* TAB SLOTS: SLOT CONFIGURATION - Using shared MealTypesEditor component */}
                        <TabsContent value="slots" className="py-4 space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <div className="bg-slate-50 p-3 rounded-md text-sm text-muted-foreground flex-1 flex items-center justify-between">
                                    <div>
                                        Günlük öğün isimlerini, hangi öğünde kaç kaptan (çeşit) yemek çıkacağını belirleyin.
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-slate-700">Ayar Kaynağı:</span>
                                        <SourceBadge source={fieldSources.slot_config} />
                                    </div>
                                </div>
                                <RevertButton field="slot_config" />
                            </div>
                            <MealTypesEditor
                                key={mealTypesKey}
                                mealTypes={mealTypesConfig.map(c => c.name)}
                                slotConfigs={mealTypesConfig}
                                onSave={() => { }}
                                onCancel={() => { }}
                                onChange={setMealTypesConfig}
                                showFooter={false}
                            />
                        </TabsContent>

                        {/* TAB MACROS: MACRO PRIORITIES */}
                        <TabsContent value="macros" className="py-4 space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <div className="bg-slate-50 p-3 rounded-md text-sm text-muted-foreground flex-1 flex items-center justify-between">
                                    <div>
                                        Bu ekrandan, hangi makro besine öncelik verileceğini belirleyebilirsiniz.
                                        <br />
                                        <strong>0 (Düşük) - 10 (Yüksek)</strong> arası puan verin. Puanı yüksek olan hedefin tutturulması daha kritiktir.
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-slate-700">Ayar Kaynağı:</span>
                                        <SourceBadge source={fieldSources.macro_priorities} />
                                    </div>
                                </div>
                                <RevertButton field="macro_priorities" />
                            </div>

                            <div className="space-y-6 p-4 border rounded-lg bg-slate-50">
                                {/* Calories Tolerance */}
                                <div className="space-y-3 bg-white p-3 border rounded shadow-sm">
                                    <div className="flex justify-between items-center mb-1">
                                        <Label className="text-base font-semibold text-gray-700">Kalori Hedefi Toleransı</Label>
                                    </div>
                                    <p className="text-xs text-slate-500 mb-2">Otomatik plan için günlük kalori hedefinin alt ve üst limitlerini belirleyin. Örneğin Karbonhidrat için alt sınırı %0 yaparak düşmesine izin verebilirsiniz.</p>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Alt Sınır (Örn: %90)</Label>
                                            <Input type="number" min={0} max={200} className="h-7 text-xs" value={portionSettings.macro_tolerances?.calories?.min ?? 90} onChange={e => handleToleranceChange('calories', 'min', e.target.value)} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Üst Sınır (Örn: %110)</Label>
                                            <Input type="number" min={0} max={300} className="h-7 text-xs" value={portionSettings.macro_tolerances?.calories?.max ?? 110} onChange={e => handleToleranceChange('calories', 'max', e.target.value)} />
                                        </div>
                                    </div>
                                </div>
                                <div className="h-px bg-slate-200" />
                                {/* Protein */}
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-base font-semibold text-blue-700">Protein Önceliği</Label>
                                        <span className="text-sm font-mono bg-white border px-2 py-1 rounded shadow-sm">
                                            Puan: {macroPriorities.protein}
                                        </span>
                                    </div>
                                    <Slider
                                        value={[macroPriorities.protein]}
                                        min={0}
                                        max={10}
                                        step={1}
                                        onValueChange={(vals) => setMacroPriorities(prev => ({ ...prev, protein: vals[0] }))}
                                        className="w-full"
                                    />
                                    <div className="grid grid-cols-2 gap-4 mt-2 bg-white p-2 rounded border">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Alt Sınır (%)</Label>
                                            <Input type="number" min={0} max={200} className="h-7 text-xs" value={portionSettings.macro_tolerances?.protein?.min ?? 80} onChange={e => handleToleranceChange('protein', 'min', e.target.value)} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Üst Sınır (%)</Label>
                                            <Input type="number" min={0} max={300} className="h-7 text-xs" value={portionSettings.macro_tolerances?.protein?.max ?? 120} onChange={e => handleToleranceChange('protein', 'max', e.target.value)} />
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Örn: Sporcular için yüksek tutulabilir.
                                    </p>
                                </div>

                                <div className="h-px bg-slate-200" />

                                {/* Carb */}
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-base font-semibold text-green-700">Karbonhidrat Önceliği</Label>
                                        <span className="text-sm font-mono bg-white border px-2 py-1 rounded shadow-sm">
                                            Puan: {macroPriorities.carb}
                                        </span>
                                    </div>
                                    <Slider
                                        value={[macroPriorities.carb]}
                                        min={0}
                                        max={10}
                                        step={1}
                                        onValueChange={(vals) => setMacroPriorities(prev => ({ ...prev, carb: vals[0] }))}
                                        className="w-full"
                                    />
                                    <div className="grid grid-cols-2 gap-4 mt-2 bg-white p-2 rounded border">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Alt Sınır (%)</Label>
                                            <Input type="number" min={0} max={200} className="h-7 text-xs" value={portionSettings.macro_tolerances?.carb?.min ?? 80} onChange={e => handleToleranceChange('carb', 'min', e.target.value)} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Üst Sınır (%)</Label>
                                            <Input type="number" min={0} max={300} className="h-7 text-xs" value={portionSettings.macro_tolerances?.carb?.max ?? 120} onChange={e => handleToleranceChange('carb', 'max', e.target.value)} />
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Örn: Keto veya Low Carb diyetlerde hassasiyet için artırılabilir.
                                    </p>
                                </div>

                                <div className="h-px bg-slate-200" />

                                {/* Fat */}
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-base font-semibold text-yellow-600">Yağ Önceliği</Label>
                                        <span className="text-sm font-mono bg-white border px-2 py-1 rounded shadow-sm">
                                            Puan: {macroPriorities.fat}
                                        </span>
                                    </div>
                                    <Slider
                                        value={[macroPriorities.fat]}
                                        min={0}
                                        max={10}
                                        step={1}
                                        onValueChange={(vals) => setMacroPriorities(prev => ({ ...prev, fat: vals[0] }))}
                                        className="w-full"
                                    />
                                    <div className="grid grid-cols-2 gap-4 mt-2 bg-white p-2 rounded border">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Alt Sınır (%)</Label>
                                            <Input type="number" min={0} max={200} className="h-7 text-xs" value={portionSettings.macro_tolerances?.fat?.min ?? 80} onChange={e => handleToleranceChange('fat', 'min', e.target.value)} />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] text-slate-500">Üst Sınır (%)</Label>
                                            <Input type="number" min={0} max={300} className="h-7 text-xs" value={portionSettings.macro_tolerances?.fat?.max ?? 120} onChange={e => handleToleranceChange('fat', 'max', e.target.value)} />
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Örn: Ketojenik diyette yağ hedefinin tutması önemlidir.
                                    </p>
                                </div>
                            </div>
                        </TabsContent>

                        {/* TAB 0: GENERAL */}
                        <TabsContent value="general" className="py-4 space-y-4">
                            <div className="space-y-4 border rounded-lg p-4 bg-slate-50">
                                <div className="flex flex-row items-start justify-between rounded-lg">
                                    <div className="space-y-0.5 max-w-[80%]">
                                        <div className="flex justify-between items-center mb-1">
                                            <Label className="text-base">İsim Benzerliği Kontrolü</Label>
                                            <RevertButton field={['enable_name_similarity_check', 'name_similarity_exempt_words']} />
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            Aynı kelimeleri içeren yemeklerin aynı öğüne gelmesini engeller.
                                            <br />
                                            <span className="italic opacity-80">(Örn: "Muffin" ve "Börek" değil, "Kabaklı Muffin" vs "Sade Muffin")</span>
                                        </p>
                                    </div>
                                    <Switch
                                        checked={enableNameSimilarity}
                                        onCheckedChange={setEnableNameSimilarity}
                                    />
                                </div>

                                {/* Name Exemption Words */}
                                {enableNameSimilarity && (
                                    <div className="mt-4 pt-4 border-t space-y-3">
                                        <Label className="text-sm font-medium">İstisna Kelimeler (Yoksayılacaklar)</Label>
                                        <p className="text-xs text-slate-500">
                                            Benzerlik kontrolünde bu kelimeler dikkate alınmaz. (Örn: "soslu", "ızgara", "fırın")
                                        </p>
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder="Kelime ekle (örn: soslu)"
                                                value={newNameExemptWord}
                                                onChange={e => setNewNameExemptWord(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddNameExemptWord()}
                                                className="h-9"
                                            />
                                            <Button onClick={handleAddNameExemptWord} size="icon" variant="secondary" className="h-9 w-9">
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {nameExemptWords.map(word => (
                                                <Badge key={word} variant="outline" className="bg-white hover:bg-slate-50 gap-1 font-normal text-slate-600">
                                                    {word}
                                                    <button onClick={() => handleRemoveNameExemptWord(word)} className="ml-1 hover:text-red-500 rounded-full">
                                                        <X size={12} />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="bg-blue-50 p-3 rounded text-xs text-blue-700 flex gap-2">
                                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                                <p>
                                    Bu özellik, etiketlerden bağımsız olarak yemek isimlerini analiz eder. İsminde 4 karakterden uzun ortak kelime geçen yemekler aynı öğüne eklenmez.
                                </p>
                            </div>

                            {/* Variety Control Section */}
                            <div className="space-y-4 border rounded-lg p-4 bg-slate-50 mt-4">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-2">
                                        <Label className="text-base">Çeşitlilik Kontrol Sistemi</Label>
                                        <p className="text-xs text-slate-500">
                                            Yemek tekrarını ve çeşitliliği kontrol eden 3 katmanlı sistem.
                                        </p>
                                    </div>
                                    <RevertButton field={['variety_mode', 'variety_preference', 'cooldown_strength', 'liked_boost', 'max_weekly_default']} />
                                </div>

                                {/* Variety Mode Selector */}
                                <div className="grid grid-cols-4 gap-2">
                                    {[
                                        { id: 'hybrid' as const, label: 'Hibrit', desc: 'Soğutma + Hard limit (Önerilen)', color: 'blue' },
                                        { id: 'cooldown' as const, label: 'Soğutma', desc: 'Üstel ceza bazlı', color: 'purple' },
                                        { id: 'score_only' as const, label: 'Skor', desc: 'Sadece skor bazlı', color: 'green' },
                                        { id: 'off' as const, label: 'Kapalı', desc: 'Eski basit sistem', color: 'gray' },
                                    ].map(mode => (
                                        <div
                                            key={mode.id}
                                            className={`cursor-pointer border rounded-md p-2 hover:bg-white transition-colors text-center ${varietyMode === mode.id ? `bg-white border-${mode.color}-500 ring-1 ring-${mode.color}-500` : 'bg-transparent'}`}
                                            onClick={() => setVarietyMode(mode.id)}
                                        >
                                            <div className="font-semibold text-xs mb-0.5">{mode.label}</div>
                                            <div className="text-[9px] text-slate-500">{mode.desc}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Parameters (only show when mode is not 'off') */}
                                {varietyMode !== 'off' && (
                                    <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                                        <div>
                                            <Label className="text-xs">Soğutma Gücü (1-10)</Label>
                                            <div className="flex items-center gap-2 mt-1">
                                                <input
                                                    type="range" min={1} max={10} step={1}
                                                    value={cooldownStrength}
                                                    onChange={e => setCooldownStrength(Number(e.target.value))}
                                                    className="flex-1 h-2 accent-blue-600"
                                                />
                                                <span className="text-sm font-mono w-6 text-center">{cooldownStrength}</span>
                                            </div>
                                            <p className="text-[9px] text-slate-400 mt-0.5">Yüksek = daha az tekrar</p>
                                        </div>
                                        <div>
                                            <Label className="text-xs">Sevilen Yemek Bonusu</Label>
                                            <input
                                                type="number" min={0} max={10000} step={500}
                                                value={likedBoost}
                                                onChange={e => setLikedBoost(Number(e.target.value))}
                                                className="w-full h-8 text-sm border rounded px-2 mt-1"
                                            />
                                            <p className="text-[9px] text-slate-400 mt-0.5">0=bonus yok, 3000=varsayılan</p>
                                        </div>
                                        <div>
                                            <Label className="text-xs">Haftalık Maks. Tekrar</Label>
                                            <input
                                                type="number" min={1} max={7} step={1}
                                                value={maxWeeklyDefault}
                                                onChange={e => setMaxWeeklyDefault(Number(e.target.value))}
                                                className="w-full h-8 text-sm border rounded px-2 mt-1"
                                            />
                                            <p className="text-[9px] text-slate-400 mt-0.5">Varsayılan: yemek başına max tekrar/hafta</p>
                                        </div>
                                    </div>
                                )}

                                {/* Variety Exemption Words */}
                                <div className="mt-4 pt-4 border-t space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-sm font-medium">İstisna Kelimeler (Yoksayılacaklar)</Label>
                                        <RevertButton field="variety_exempt_words" />
                                    </div>
                                    <p className="text-xs text-slate-500">
                                        Çeşitlilik ve ardışık gün kontrolünde bu kelimeler dikkate alınmaz. (Örn: "salatası", "çorbası", "ekmeği")
                                    </p>
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="Kelime ekle (örn: çorbası)"
                                            value={newVarietyExemptWord}
                                            onChange={e => setNewVarietyExemptWord(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const word = newVarietyExemptWord.trim().toLowerCase()
                                                    if (word && !varietyExemptWords.includes(word)) {
                                                        setVarietyExemptWords([...varietyExemptWords, word])
                                                        setNewVarietyExemptWord("")
                                                    }
                                                }
                                            }}
                                            className="h-9"
                                        />
                                        <Button onClick={() => {
                                            const word = newVarietyExemptWord.trim().toLowerCase()
                                            if (word && !varietyExemptWords.includes(word)) {
                                                setVarietyExemptWords([...varietyExemptWords, word])
                                                setNewVarietyExemptWord("")
                                            }
                                        }} size="icon" variant="secondary" className="h-9 w-9">
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {varietyExemptWords.map(word => (
                                            <Badge key={word} variant="outline" className="bg-white hover:bg-slate-50 gap-1 font-normal text-slate-600">
                                                {word}
                                                <button onClick={() => setVarietyExemptWords(prev => prev.filter(w => w !== word))} className="ml-1 hover:text-red-500 rounded-full">
                                                    <X size={12} />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                </div>

                                {/* Legacy Variety Preference (for 'off' mode backward compat) */}
                                {varietyMode === 'off' && (
                                    <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                                        {[
                                            { id: 'max_variety' as const, label: 'Maksimum Çeşitlilik', desc: 'Tekrarı en aza indirir' },
                                            { id: 'balanced' as const, label: 'Dengeli', desc: 'Varsayılan denge' },
                                            { id: 'stability' as const, label: 'Kararlılık', desc: 'Tanıdık yemekler daha sık' },
                                        ].map(pref => (
                                            <div
                                                key={pref.id}
                                                className={`cursor-pointer border rounded-md p-2 hover:bg-white transition-colors ${varietyPreference === pref.id ? 'bg-white border-blue-500 ring-1 ring-blue-500' : 'bg-transparent'}`}
                                                onClick={() => setVarietyPreference(pref.id)}
                                            >
                                                <div className="font-semibold text-xs mb-0.5">{pref.label}</div>
                                                <div className="text-[9px] text-slate-500">{pref.desc}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        {/* NEW TAB: FOOD SCORES */}
                        <TabsContent value="scores" className="py-4 space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <div className="bg-slate-50 p-3 rounded-md text-sm text-muted-foreground flex-1">
                                    Bu {activeScope === 'patient' ? 'hasta' : activeScope === 'program' ? 'program' : activeScope === 'team' ? 'takım' : 'global'} için yemek öncelik skorlarını özelleştirin.
                                    Alt katmanlar üst katmandaki atanmış skorları miras alır.
                                </div>
                                <RevertButton field="food_score_overrides" />
                            </div>

                            {/* Food Score Overrides Section */}
                            <div className="space-y-3 border rounded-lg p-4 bg-white mt-4 shadow-sm">
                                <div className="space-y-1">
                                    <Label className="text-base">Özel Skor Atamaları</Label>
                                    <p className="text-xs text-slate-500">
                                        Aradığınız yemeği bularak 1-10 arası özel öncelik skoru belirleyin.
                                    </p>
                                </div>

                                {/* Search to add overrides */}
                                <div className="relative">
                                    <input
                                        placeholder="Yemek ara... (2+ karakter)"
                                        value={overrideSearch}
                                        onChange={async e => {
                                            const val = e.target.value
                                            setOverrideSearch(val)
                                            if (val.length >= 2) {
                                                const words = val.trim().split(/\s+/).filter(w => w.length > 0)
                                                let query = supabase.from('foods').select('id, name, priority_score, category, role')
                                                words.forEach(w => { query = query.ilike('name', `%${w}%`) })

                                                const { data } = await query.limit(10)
                                                setOverrideFoods(data || [])
                                            } else {
                                                setOverrideFoods([])
                                            }
                                        }}
                                        className="w-full h-8 text-xs border rounded px-2"
                                    />
                                    {overrideFoods.length > 0 && overrideSearch.length >= 2 && (
                                        <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border rounded shadow-lg max-h-40 overflow-y-auto">
                                            {overrideFoods.map(f => {
                                                const hasOverride = f.id in foodScoreOverrides
                                                return (
                                                    <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 text-xs border-b last:border-0">
                                                        <span className="flex-1 truncate">{f.name}</span>
                                                        <span className="text-[9px] text-slate-400">{f.category}</span>
                                                        <span className="text-[9px] text-slate-400">Skor:{f.priority_score ?? 5}</span>
                                                        {hasOverride ? (
                                                                    <span className="text-[9px] text-green-600 shrink-0">✓ Atandı</span>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    setFoodScoreOverrides({ ...foodScoreOverrides, [f.id]: f.priority_score ?? 5 })
                                                                    setFoodScoreNames({ ...foodScoreNames, [f.id]: f.name })
                                                                    setOverrideSearch('')
                                                                    setOverrideFoods([])
                                                                }}
                                                                className="px-1.5 py-0.5 rounded text-[9px] bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-200 shrink-0"
                                                            >
                                                                + Skor Ata
                                                            </button>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Current scope overrides list */}
                                {Object.keys(foodScoreOverrides).length > 0 ? (
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto mt-2">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-[9px] text-slate-500">
                                                Bu {activeScope === 'patient' ? 'hastaya' : activeScope === 'program' ? 'programa' : activeScope === 'team' ? 'takıma' : 'globale'} ait skorlar
                                            </span>
                                            <button
                                                onClick={() => setOverrideSort(s => s === 'desc' ? 'asc' : 'desc')}
                                                className="text-[10px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
                                            >
                                                Sıralama: {overrideSort === 'desc' ? 'Skor (Azalan) ↓' : 'Skor (Artan) ↑'}
                                            </button>
                                        </div>
                                        {Object.entries(foodScoreOverrides)
                                            .sort((a, b) => overrideSort === 'desc' ? b[1] - a[1] : a[1] - b[1])
                                            .map(([foodId, score]) => (
                                                <FoodScoreRow
                                                    key={foodId}
                                                    foodId={foodId}
                                                    name={foodScoreNames[foodId] || foodId.slice(0, 8) + '...'}
                                                    initialScore={score}
                                                    source={foodScoreSources[foodId]}
                                                    onScoreChange={(newScore) => setFoodScoreOverrides({ ...foodScoreOverrides, [foodId]: newScore })}
                                                    onRemove={() => {
                                                        const nextOverrides = { ...foodScoreOverrides }
                                                        delete nextOverrides[foodId]
                                                        setFoodScoreOverrides(nextOverrides)
                                                        // If it was inherited, put it back in inherited list
                                                        const srcData = foodScoreSources[foodId]
                                                        const nextSources = { ...foodScoreSources }
                                                        delete nextSources[foodId]
                                                        setFoodScoreSources(nextSources)
                                                    }}
                                                />
                                            ))}
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-slate-400 italic">Henüz özel skor atanmış yemek yok. Aramaktan ekleyebilirsiniz.</p>
                                )}

                                {/* Inherited scores from upper layers */}
                                {Object.keys(inheritedScores).length > 0 && (
                                    <div className="mt-4 border-t pt-3">
                                        <div className="flex items-center gap-2 mb-2">
                                        <span className="text-xs font-semibold text-slate-600">Miras Gelen Skorlar</span>
                                            <span className="text-[9px] text-slate-400">
                                                ({Object.keys(inheritedScores).length} yemek)
                                            </span>
                                        </div>
                                        <p className="text-[9px] text-slate-400 mb-2">
                                            Üst katmandan gelen skorlar. &quot;Aktif&quot; tikini işaretlerseniz bu katmana kopyalanır.
                                        </p>
                                        <div className="space-y-1 max-h-40 overflow-y-auto">
                                            {Object.entries(inheritedScores)
                                                .sort((a, b) => b[1].score - a[1].score)
                                                .map(([foodId, { score, source }]) => (
                                                    <FoodScoreRow
                                                        key={`inherited-${foodId}`}
                                                        foodId={foodId}
                                                        name={foodScoreNames[foodId] || foodId.slice(0, 8) + '...'}
                                                        initialScore={score}
                                                        source={source}
                                                        inherited={true}
                                                        onToggle={(enabled) => {
                                                            if (enabled) {
                                                                // Copy to current scope's overrides
                                                                setFoodScoreOverrides(prev => ({ ...prev, [foodId]: score }))
                                                                setFoodScoreSources(prev => ({
                                                                    ...prev,
                                                                    [foodId]: activeScope
                                                                }))
                                                                // Remove from inherited
                                                                setInheritedScores(prev => {
                                                                    const next = { ...prev }
                                                                    delete next[foodId]
                                                                    return next
                                                                })
                                                            }
                                                        }}
                                                    />
                                                ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        {/* TAB 1: WEIGHTS */}
                        <TabsContent value="weights" className="py-4 space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <div className="bg-slate-50 p-3 rounded-md text-sm text-muted-foreground flex-1 flex items-center justify-between">
                                    <div>
                                        Kriterleri önem sırasına göre <strong>sürükleyip bırakın</strong>. En üstteki en baskın olandır.
                                        Yanındaki puan barı ile etki gücünü ayarlayın.
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-slate-700">Ayar Kaynağı:</span>
                                        <SourceBadge source={fieldSources.weights} />
                                    </div>
                                </div>
                                <RevertButton field="weights" />
                            </div>

                            {loading && !settingsId && (
                                <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>
                            )}

                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleDragEnd}
                            >
                                <SortableContext
                                    items={items.map(i => i.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="space-y-2">
                                        {items.map((item, index) => (
                                            <SortableCriterion
                                                key={item.id}
                                                id={item.id}
                                                item={item}
                                                index={index}
                                                onWeightChange={updateWeight}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </TabsContent>

                        {/* TAB 2: EXEMPT TAGS */}
                        <TabsContent value="exempt" className="py-4 space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <div className="bg-slate-50 p-3 rounded-md text-sm text-muted-foreground flex-1 flex items-center justify-between">
                                    <div>
                                        Bu listedeki kelimeler, "Yemek İçi Etiket Çakışması" kontrolünden muaf tutulur.
                                        Yani, bu etikete sahip iki yemek aynı öğünde bulunabilir.
                                        <br />Örn: <em>protein, sebze, peynir...</em>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-slate-700">Ayar Kaynağı:</span>
                                        <SourceBadge source={fieldSources.exempt_tags} />
                                    </div>
                                </div>
                                <RevertButton field="exempt_tags" />
                            </div>

                            <div className="flex gap-2">
                                <Input
                                    placeholder="Muaf kelime yazın (örn: peynir)"
                                    value={newTag}
                                    onChange={e => setNewTag(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                />
                                <Button onClick={handleAddTag} size="icon">
                                    <Plus className="h-4 w-4" />
                                </Button>
                            </div>

                            <div className="flex flex-wrap gap-2 min-h-[100px] content-start">
                                {exemptTags.map(tag => (
                                    <Badge key={tag} variant="secondary" className="pl-2 pr-1 py-1 flex items-center gap-1 text-sm">
                                        {tag}
                                        <button
                                            onClick={() => handleRemoveTag(tag)}
                                            className="hover:bg-slate-200 rounded-full p-0.5 transition-colors"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </Badge>
                                ))}
                                {exemptTags.length === 0 && (
                                    <span className="text-sm text-muted-foreground italic p-2">Henüz muaf kelime eklenmemiş.</span>
                                )}
                            </div>
                        </TabsContent>

                        {/* TAB 3: PORTION SETTINGS */}
                        <TabsContent value="portion" className="py-4 space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <div className="bg-slate-50 p-3 rounded-md text-sm text-muted-foreground flex-1 flex items-center justify-between">
                                    <div>
                                        Otomatik planda yemeklerin porsiyonlarının nasıl ayarlanacağını (katsayı) belirleyin.
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold text-slate-700">Ayar Kaynağı:</span>
                                        <SourceBadge source={fieldSources.portion_settings} />
                                    </div>
                                </div>
                                <RevertButton field="portion_settings" />
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="space-y-2">
                                    <Label>Min. Katsayı</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        min="0.1"
                                        value={portionSettings.global_min}
                                        onChange={e => setPortionSettings(prev => ({ ...prev, global_min: parseFloat(e.target.value) }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Maks. Katsayı</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        min="1.0"
                                        value={portionSettings.global_max}
                                        onChange={e => setPortionSettings(prev => ({ ...prev, global_max: parseFloat(e.target.value) }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Adım Değeri</Label>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        min="0.1"
                                        value={portionSettings.step_value}
                                        onChange={e => setPortionSettings(prev => ({ ...prev, step_value: parseFloat(e.target.value) }))}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Günlük Değişen Yemek Limiti</Label>
                                    <Input
                                        type="number"
                                        min={1}
                                        max={20}
                                        step={1}
                                        value={portionSettings.max_adjusted_items_per_day ?? 5}
                                        onChange={(e) => setPortionSettings(s => ({ ...s, max_adjusted_items_per_day: parseInt(e.target.value) }))}
                                    />
                                    <p className="text-[10px] text-slate-400">
                                        Günde en fazla kaç farklı yemeğin porsiyonu otomatik değiştirilsin?
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label>Tek Öğün Maks. Kalori Payı (%)</Label>
                                    <Input
                                        type="number"
                                        min={10}
                                        max={100}
                                        step={5}
                                        value={portionSettings.max_calorie_percentage ?? 50}
                                        onChange={(e) => setPortionSettings(s => ({ ...s, max_calorie_percentage: parseFloat(e.target.value) }))}
                                    />
                                    <p className="text-[10px] text-slate-400">
                                        Bir yemeğin kalorisi, günlük hedefin % kaçını aşarsa porsiyonu küçültülsün? (Örn: %40)
                                    </p>
                                </div>
                            </div>

                            {/* SCALABLE UNITS SECTION */}
                            <div className="space-y-4 border p-4 rounded-lg bg-orange-50/50">
                                <Label className="text-base font-semibold">Ölçeklenebilir Birimler</Label>
                                <p className="text-xs text-muted-foreground">
                                    Porsiyon katsayısı değiştiğinde, yemek ismindeki rakamların da otomatik güncellenmesi için birim kelimeleri girin.
                                    <br />Örn: <em>gram, gr, ml, adet...</em>
                                </p>

                                <div className="flex gap-2">
                                    <Input
                                        placeholder="Birim yazın (örn: gram)"
                                        value={newUnit}
                                        onChange={e => setNewUnit(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                handleAddUnit()
                                            }
                                        }}
                                    />
                                    <Button onClick={handleAddUnit} size="icon" variant="secondary">
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </div>

                                <div className="flex flex-wrap gap-2 min-h-[50px] content-start">
                                    {(portionSettings.scalable_units || []).map(unit => (
                                        <Badge key={unit} variant="outline" className="pl-2 pr-1 py-1 flex items-center gap-1 text-sm bg-white border-orange-200 text-orange-800">
                                            {unit}
                                            <button
                                                onClick={() => handleRemoveUnit(unit)}
                                                className="hover:bg-orange-100 rounded-full p-0.5 transition-colors"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </Badge>
                                    ))}
                                    {(!portionSettings.scalable_units || portionSettings.scalable_units.length === 0) && (
                                        <span className="text-sm text-muted-foreground italic p-2">Tanımlı birim yok. Porsiyon ifadeleri (Yarım, Çift vb.) kullanılacak.</span>
                                    )}
                                </div>
                            </div>

                            {/* STRATEGIES SECTION */}
                            <div className="space-y-4 border p-4 rounded-lg">
                                <Label className="text-base font-semibold">Stratejiler</Label>

                                <div className="flex items-start space-x-2">
                                    <Checkbox
                                        id="strat_macro"
                                        checked={portionSettings.strategies.macro_convergence}
                                        onCheckedChange={(c) => setPortionSettings(prev => ({ ...prev, strategies: { ...prev.strategies, macro_convergence: c === true } }))}
                                    />
                                    <div className="grid gap-1.5 leading-none">
                                        <Label htmlFor="strat_macro" className="cursor-pointer">
                                            Kalori Hedefime Yaklaştır (Macro Convergence)
                                        </Label>
                                        <span className="text-xs text-muted-foreground">
                                            Eğer günlük kalori hedefinin altındaysa, porsiyonları otomatik artırarak hedefi tutturmaya çalışır.
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-start space-x-2">
                                    <Checkbox
                                        id="strat_limit"
                                        checked={portionSettings.strategies.max_limit_protection}
                                        onCheckedChange={(c) => setPortionSettings(prev => ({ ...prev, strategies: { ...prev.strategies, max_limit_protection: c === true } }))}
                                    />
                                    <div className="grid gap-1.5 leading-none">
                                        <Label htmlFor="strat_limit" className="cursor-pointer">
                                            Aşımı Engelle (Max Limit Protection)
                                        </Label>
                                        <span className="text-xs text-muted-foreground">
                                            Eğer günlük kalori hedefini aşıyorsa, porsiyonları kısarak (min. sınıra kadar) dengelemeye çalışır.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs >

                    <DialogFooter className="mt-4 gap-2 border-t pt-4">
                        {/* Revert Button - Only shown if exploring patient settings NOT from patient UI (hideRevertButton handles this) */}
                        {!hideRevertButton && patientId && settingsId && (
                            <Button
                                variant="destructive"
                                onClick={handleRevertToProgram}
                                disabled={loading}
                                className="mr-auto"
                            >
                                {programTemplateId
                                    ? "Programa Özel Ayarlara Dön"
                                    : (Object.values(fieldSources).some((source) => source === 'team')
                                        ? "Takım Ayarlarına Dön"
                                        : "Global Ayarlara Dön")}
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                            İptal
                        </Button>
                        <Button onClick={handleSave} disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Kaydet
                        </Button>
                    </DialogFooter>
                </div> {/* End Scrollable Content */}
            </DialogContent >
        </Dialog >
    )
}

function SortableCriterion({ id, item, index, onWeightChange }: any) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-4 bg-white border p-3 rounded-md shadow-sm z-10 relative">
            <div {...attributes} {...listeners} className="cursor-grab text-gray-400 hover:text-gray-600">
                <GripVertical size={20} />
            </div>

            <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                    <Label className="font-semibold text-sm">
                        {index + 1}. {item.label}
                    </Label>
                    <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">
                        Puan: {item.weight}
                    </span>
                </div>
                <Slider
                    value={[item.weight]}
                    max={item.id === 'allergen' ? 1000 : 100}
                    step={5}
                    onValueChange={(vals) => onWeightChange(item.id, vals[0])}
                    className="w-full"
                />
            </div>
        </div>
    )
}






