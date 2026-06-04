"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
// import { ScrollArea } from "@/components/ui/scroll-area" 
import { Loader2, Plus, Trash2, Eye, Pencil, RotateCcw, Upload, Download, AlertCircle, GripVertical, Copy, Undo2, ArchiveRestore } from "lucide-react"
import { RuleDialog } from "./rule-dialog"
import { PlanningRule } from "@/types/planner"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"

// Sentinel rule name used to signal "use global rules, skip program/team inheritance"
const USE_GLOBAL_SENTINEL = '__use_global__'
type RuleScopeKey = 'global' | 'team' | 'program' | 'patient'

const RULE_TYPE_LABELS: Record<string, string> = {
    frequency: 'Sıklık / Limit',
    affinity: 'Uyum / Eşleşme',
    consistency: 'Tutarlılık / Kilit',
    fixed_meal: 'Sabit Öğün',
    nutritional: 'Makro Kuralı',
    rotation: 'Rotasyon',
    or_group: 'VEYA Grubu',
    preference: 'Tercih'
}

function getRuleTypeLabel(type?: string | null) {
    if (!type) return 'Kural'
    return RULE_TYPE_LABELS[type] || type
}

function getScopeLabel(scope: RuleScopeKey) {
    if (scope === 'patient') return 'Hasta'
    if (scope === 'program') return 'Program'
    if (scope === 'team') return 'Takım'
    return 'Global'
}

function getScopeBadgeClass(scope: RuleScopeKey) {
    if (scope === 'patient') return 'bg-amber-50 text-amber-700 border-amber-200'
    if (scope === 'program') return 'bg-indigo-50 text-indigo-700 border-indigo-200'
    if (scope === 'team') return 'bg-violet-50 text-violet-700 border-violet-200'
    return 'bg-blue-50 text-blue-700 border-blue-200'
}

interface PatientRulesDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    patientId: string
    programTemplateId?: string | null
    focusRuleId?: string | null
    focusRuleName?: string | null
    onRulesChanged?: () => void
}

export function PatientRulesDialog({ open, onOpenChange, patientId, programTemplateId, focusRuleId, focusRuleName, onRulesChanged }: PatientRulesDialogProps) {
    const DIALOG_MARGIN = 12
    const OPEN_VERTICAL_OFFSET = 24
    const MIN_DIALOG_WIDTH = 760
    const MIN_DIALOG_HEIGHT = 560
    const DEFAULT_DIALOG_WIDTH = 1100
    const DEFAULT_DIALOG_HEIGHT = 880

    const clampDialogSize = useCallback((size: { width: number, height: number }) => {
        if (typeof window === 'undefined') return size
        const maxWidth = Math.max(360, window.innerWidth - (DIALOG_MARGIN * 2))
        const maxHeight = Math.max(360, window.innerHeight - (DIALOG_MARGIN * 2))
        const minWidth = Math.min(MIN_DIALOG_WIDTH, maxWidth)
        const minHeight = Math.min(MIN_DIALOG_HEIGHT, maxHeight)
        return {
            width: Math.max(minWidth, Math.min(maxWidth, size.width)),
            height: Math.max(minHeight, Math.min(maxHeight, size.height))
        }
    }, [])

    const getPositionBounds = useCallback((size: { width: number, height: number }) => {
        if (typeof window === 'undefined') {
            return { minX: DIALOG_MARGIN, maxX: DIALOG_MARGIN, minY: DIALOG_MARGIN, maxY: DIALOG_MARGIN }
        }
        return {
            minX: DIALOG_MARGIN,
            maxX: Math.max(DIALOG_MARGIN, window.innerWidth - size.width - DIALOG_MARGIN),
            minY: DIALOG_MARGIN,
            maxY: Math.max(DIALOG_MARGIN, window.innerHeight - size.height - DIALOG_MARGIN)
        }
    }, [])

    const clampPosition = useCallback((position: { x: number, y: number }, size: { width: number, height: number }) => {
        const bounds = getPositionBounds(size)
        return {
            x: Math.max(bounds.minX, Math.min(position.x, bounds.maxX)),
            y: Math.max(bounds.minY, Math.min(position.y, bounds.maxY))
        }
    }, [getPositionBounds])

    const getCenteredPosition = useCallback((size: { width: number, height: number }) => {
        if (typeof window === 'undefined') return { x: DIALOG_MARGIN, y: DIALOG_MARGIN }
        const centerX = Math.round((window.innerWidth - size.width) / 2)
        const centerY = Math.round((window.innerHeight - size.height) / 2) + OPEN_VERTICAL_OFFSET
        return clampPosition({ x: centerX, y: centerY }, size)
    }, [clampPosition])

    const normalizeRuleName = (value?: string | null) => (value || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[^a-z0-9ğıüşöçİĞÜŞÖÇ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

    const scoreRuleNameMatch = (ruleName?: string | null, targetName?: string | null) => {
        const a = normalizeRuleName(ruleName)
        const b = normalizeRuleName(targetName)
        if (!a || !b) return 0
        if (a === b) return 4
        if (a.includes(b)) return 3
        if (b.includes(a)) return 2

        const aParts = new Set(a.split(' ').filter(Boolean))
        const bParts = new Set(b.split(' ').filter(Boolean))
        let common = 0
        aParts.forEach(part => {
            if (bParts.has(part)) common++
        })
        if (common >= 2) return 1
        return 0
    }

    const [loading, setLoading] = useState(false)
    const [showDeleted, setShowDeleted] = useState(false)
    const [globalRules, setGlobalRules] = useState<PlanningRule[]>([])
    const [teamRules, setTeamRules] = useState<PlanningRule[]>([])
    const [programRules, setProgramRules] = useState<PlanningRule[]>([])
    const [patientRules, setPatientRules] = useState<PlanningRule[]>([])
    const [hasPatientRules, setHasPatientRules] = useState(false)
    const [hasGlobalSentinel, setHasGlobalSentinel] = useState(false)
    const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
    const [editingRule, setEditingRule] = useState<PlanningRule | null>(null)
    const [prefillRule, setPrefillRule] = useState<PlanningRule | null>(null)
    const [lastFocusKey, setLastFocusKey] = useState<string | null>(null)
    const [teamOwnerId, setTeamOwnerId] = useState<string | null>(null)
    const [isTeamScopedContext, setIsTeamScopedContext] = useState(false)
    const [patientDisplayName, setPatientDisplayName] = useState<string>('hasta')
    const importInputRef = useRef<HTMLInputElement | null>(null)
    const [importModeDialogOpen, setImportModeDialogOpen] = useState(false)
    const [pendingImportedRules, setPendingImportedRules] = useState<any[] | null>(null)
    const [pendingImportFileName, setPendingImportFileName] = useState('')
    const [copyDialogOpen, setCopyDialogOpen] = useState(false)
    const [copyTargetPatientId, setCopyTargetPatientId] = useState<string>('')
    const [copyTargetPatients, setCopyTargetPatients] = useState<Array<{ id: string, full_name: string }>>([])
    const [copyTargetsLoading, setCopyTargetsLoading] = useState(false)
    const [dialogSize, setDialogSize] = useState<{ width: number, height: number }>({
        width: DEFAULT_DIALOG_WIDTH,
        height: DEFAULT_DIALOG_HEIGHT
    })
    const [dialogPosition, setDialogPosition] = useState({ x: DIALOG_MARGIN, y: DIALOG_MARGIN })
    const [isDraggingDialog, setIsDraggingDialog] = useState(false)
    const [isResizingDialog, setIsResizingDialog] = useState(false)
    const dragStartRef = useRef<{ x: number, y: number, startPositionX: number, startPositionY: number } | null>(null)
    const resizeStartRef = useRef<{ x: number, y: number, width: number, height: number } | null>(null)

    const applyCurrentTeamFilter = useCallback((query: any) => {
        if (isTeamScopedContext && teamOwnerId) {
            return query.eq('team_owner_id', teamOwnerId)
        }
        return query.is('team_owner_id', null)
    }, [isTeamScopedContext, teamOwnerId])

    const fetchRules = useCallback(async (silent: boolean = false) => {
        if (!silent) setLoading(true)
        try {
            const { userId, role, canUseGlobal, teamOwnerId: resolvedTeamOwnerId } = await resolveTeamScopeContextFromAuth()
            const hasTeamScopedRole = role === 'doctor' || role === 'dietitian'
            const effectiveTeamOwnerId = hasTeamScopedRole
                ? ((role === 'doctor' && canUseGlobal && userId) ? userId : resolvedTeamOwnerId)
                : null

            setIsTeamScopedContext(!!effectiveTeamOwnerId)
            setTeamOwnerId(effectiveTeamOwnerId || null)

            const applyScopedTeamFilter = (query: any) => {
                if (effectiveTeamOwnerId) {
                    return query.eq('team_owner_id', effectiveTeamOwnerId)
                }
                return query.is('team_owner_id', null)
            }

            // Fetch global rules
            const { data: gRules } = await supabase
                .from('planning_rules')
                .select('*')
                .or('scope.is.null,scope.eq.global')
                .order('sort_order', { ascending: true })
                .order('priority', { ascending: false })

            const resolvedGlobalRules = (gRules || []) as unknown as PlanningRule[]
            setGlobalRules(resolvedGlobalRules)

            // Fetch team base rules (if team context exists)
            let resolvedTeamRules: PlanningRule[] = []
            if (effectiveTeamOwnerId) {
                const { data: tRules } = await supabase
                    .from('planning_rules')
                    .select('*')
                    .eq('scope', 'team')
                    .eq('team_owner_id', effectiveTeamOwnerId)
                    .order('sort_order', { ascending: true })
                    .order('priority', { ascending: false })
                resolvedTeamRules = (tRules || []) as unknown as PlanningRule[]
            }
            setTeamRules(resolvedTeamRules)

            // Fetch program-specific rules (if patient has a program)
            let resolvedProgramRules: PlanningRule[] = []
            if (programTemplateId) {
                const { data: progRules } = await applyScopedTeamFilter(
                    supabase
                        .from('planning_rules')
                        .select('*')
                        .eq('scope', 'program')
                        .eq('program_template_id', programTemplateId)
                )
                    .order('sort_order', { ascending: true })
                    .order('priority', { ascending: false })
                resolvedProgramRules = (progRules || []) as unknown as PlanningRule[]
            }
            setProgramRules(resolvedProgramRules)

            // Fetch patient-specific rules
            const { data: pRules } = await applyScopedTeamFilter(
                supabase
                    .from('planning_rules')
                    .select('*')
                    .eq('scope', 'patient')
                    .eq('patient_id', patientId)
            )
                .order('sort_order', { ascending: true })
                .order('priority', { ascending: false })

            const resolvedPatientRules = (pRules || []) as unknown as PlanningRule[]
            const sentinelFound = resolvedPatientRules.some(r => r.name === USE_GLOBAL_SENTINEL)
            setHasGlobalSentinel(sentinelFound)
            // Filter out sentinel from visible patient rules
            const visiblePatientRules = resolvedPatientRules.filter(r => r.name !== USE_GLOBAL_SENTINEL)
            setPatientRules(visiblePatientRules)
            setHasPatientRules(visiblePatientRules.length > 0 || sentinelFound)
        } catch (e) {
            console.error("Error fetching rules:", e)
        }
        if (!silent) setLoading(false)
    }, [patientId, programTemplateId])

    useEffect(() => {
        if (open && patientId) {
            fetchRules()
        }
    }, [open, patientId, fetchRules])

    const safeDialogPosition = clampPosition(dialogPosition, dialogSize)

    useEffect(() => {
        if (!open || typeof window === 'undefined') return
        const nextSize = clampDialogSize({ width: DEFAULT_DIALOG_WIDTH, height: DEFAULT_DIALOG_HEIGHT })
        setDialogSize(nextSize)
        setDialogPosition(getCenteredPosition(nextSize))
    }, [open, clampDialogSize, getCenteredPosition])

    useEffect(() => {
        if (!open || typeof window === 'undefined') return
        const handleWindowResize = () => {
            setDialogSize((prevSize) => {
                const nextSize = clampDialogSize(prevSize)
                setDialogPosition((prevPosition) => clampPosition(prevPosition, nextSize))
                return nextSize
            })
        }
        window.addEventListener('resize', handleWindowResize)
        return () => window.removeEventListener('resize', handleWindowResize)
    }, [open, clampDialogSize, clampPosition])

    useEffect(() => {
        if (!isDraggingDialog || typeof window === 'undefined') return

        const handleMove = (event: MouseEvent) => {
            if (!dragStartRef.current) return
            const rawX = dragStartRef.current.startPositionX + (event.clientX - dragStartRef.current.x)
            const rawY = dragStartRef.current.startPositionY + (event.clientY - dragStartRef.current.y)
            setDialogPosition(clampPosition({ x: rawX, y: rawY }, dialogSize))
        }

        const handleUp = () => {
            setIsDraggingDialog(false)
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
    }, [isDraggingDialog, clampPosition, dialogSize])

    useEffect(() => {
        if (!isResizingDialog || typeof window === 'undefined') return

        const handleMove = (event: MouseEvent) => {
            if (!resizeStartRef.current) return
            const dx = event.clientX - resizeStartRef.current.x
            const dy = event.clientY - resizeStartRef.current.y
            const nextSize = clampDialogSize({
                width: resizeStartRef.current.width + dx,
                height: resizeStartRef.current.height + dy
            })
            setDialogSize(nextSize)
            setDialogPosition((prev) => clampPosition(prev, nextSize))
        }

        const handleUp = () => {
            setIsResizingDialog(false)
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
    }, [isResizingDialog, clampDialogSize, clampPosition])

    function handleDialogDragStart(event: any) {
        if (isResizingDialog) return
        const target = event.target as HTMLElement | null
        if (target?.closest('button, input, select, textarea, a, [data-no-drag="true"]')) return
        event.preventDefault()
        dragStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            startPositionX: safeDialogPosition.x,
            startPositionY: safeDialogPosition.y
        }
        setIsDraggingDialog(true)
    }

    function handleDialogResizeStart(event: any) {
        event.preventDefault()
        event.stopPropagation()
        resizeStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            width: dialogSize.width,
            height: dialogSize.height
        }
        setIsResizingDialog(true)
    }

    useEffect(() => {
        if (!open || !patientId) return

        let cancelled = false
        ;(async () => {
            try {
                const { data: patientRow } = await supabase
                    .from('patients')
                    .select('full_name')
                    .eq('id', patientId)
                    .maybeSingle()

                if (cancelled) return
                const full = String(patientRow?.full_name || '').trim()
                setPatientDisplayName(full || 'hasta')
            } catch {
                if (!cancelled) setPatientDisplayName('hasta')
            }
        })()

        return () => {
            cancelled = true
        }
    }, [open, patientId])

    useEffect(() => {
        if (!open) {
            setLastFocusKey(null)
            return
        }

        const normalizedFocusRuleName = typeof focusRuleName === 'string' ? focusRuleName.trim() : ''
        const focusKey = focusRuleId ? `id:${focusRuleId}` : normalizedFocusRuleName ? `name:${normalizedFocusRuleName}` : null
        if (!focusKey || focusKey === lastFocusKey) return

        let cancelled = false

        async function openFocusedRule() {
            setLoading(true)
            try {
                let rawRule: PlanningRule | null = null

                if (focusRuleId) {
                    const { data: byId, error: byIdError } = await supabase
                        .from('planning_rules')
                        .select('*')
                        .eq('id', focusRuleId)
                        .maybeSingle()
                    if (!byIdError && byId) {
                        rawRule = byId as PlanningRule
                    }
                }

                if (!rawRule && normalizedFocusRuleName) {
                    const candidates = Array.from(
                        new Set(
                            [normalizedFocusRuleName, normalizedFocusRuleName.includes(':') ? normalizedFocusRuleName.split(':').slice(1).join(':').trim() : '']
                                .map(v => v.trim())
                                .filter(Boolean)
                        )
                    )

                    if (candidates.length > 0) {
                        const { data: patRules } = await applyCurrentTeamFilter(
                            supabase
                                .from('planning_rules')
                                .select('*')
                                .eq('scope', 'patient')
                                .eq('patient_id', patientId)
                                .in('name', candidates)
                        ).limit(1)
                        if (patRules && patRules.length > 0) {
                            rawRule = patRules[0] as PlanningRule
                        }
                    }

                    if (!rawRule && candidates.length > 0 && programTemplateId) {
                        const { data: progRules } = await applyCurrentTeamFilter(
                            supabase
                                .from('planning_rules')
                                .select('*')
                                .eq('scope', 'program')
                                .eq('program_template_id', programTemplateId)
                                .in('name', candidates)
                        ).limit(1)
                        if (progRules && progRules.length > 0) {
                            rawRule = progRules[0] as PlanningRule
                        }
                    }

                    if (!rawRule && candidates.length > 0 && isTeamScopedContext && teamOwnerId) {
                        const { data: teamBaseRules } = await applyCurrentTeamFilter(
                            supabase
                                .from('planning_rules')
                                .select('*')
                                .eq('scope', 'team')
                                .in('name', candidates)
                        ).limit(1)
                        if (teamBaseRules && teamBaseRules.length > 0) {
                            rawRule = teamBaseRules[0] as PlanningRule
                        }
                    }

                    if (!rawRule && candidates.length > 0) {
                        const { data: globalScoped } = await supabase
                            .from('planning_rules')
                            .select('*')
                            .eq('scope', 'global')
                            .in('name', candidates)
                            .limit(1)
                        if (globalScoped && globalScoped.length > 0) {
                            rawRule = globalScoped[0] as PlanningRule
                        } else {
                            const { data: globalNull } = await supabase
                                .from('planning_rules')
                                .select('*')
                                .is('scope', null)
                                .in('name', candidates)
                                .limit(1)
                            if (globalNull && globalNull.length > 0) {
                                rawRule = globalNull[0] as PlanningRule
                            }
                        }
                    }

                    // Fallback: fuzzy match by normalized name if exact name lookup misses.
                    if (!rawRule && candidates.length > 0) {
                        const [patientScan, programScan, teamScan, globalScan, globalNullScan] = await Promise.all([
                            applyCurrentTeamFilter(
                                supabase
                                    .from('planning_rules')
                                    .select('*')
                                    .eq('scope', 'patient')
                                    .eq('patient_id', patientId)
                            ),
                            programTemplateId
                                ? applyCurrentTeamFilter(
                                    supabase
                                        .from('planning_rules')
                                        .select('*')
                                        .eq('scope', 'program')
                                        .eq('program_template_id', programTemplateId)
                                )
                                : Promise.resolve({ data: [], error: null } as any),
                            (isTeamScopedContext && teamOwnerId)
                                ? applyCurrentTeamFilter(
                                    supabase
                                        .from('planning_rules')
                                        .select('*')
                                        .eq('scope', 'team')
                                )
                                : Promise.resolve({ data: [], error: null } as any),
                            supabase
                                .from('planning_rules')
                                .select('*')
                                .eq('scope', 'global'),
                            supabase
                                .from('planning_rules')
                                .select('*')
                                .is('scope', null)
                        ])

                        const pool = [
                            ...(patientScan.data || []),
                            ...(programScan.data || []),
                            ...(teamScan.data || []),
                            ...(globalScan.data || []),
                            ...(globalNullScan.data || [])
                        ] as PlanningRule[]

                        let bestRule: PlanningRule | null = null
                        let bestScore = 0
                        for (const candidateRule of pool) {
                            const score = Math.max(...candidates.map(name => scoreRuleNameMatch(candidateRule?.name, name)))
                            if (score > bestScore) {
                                bestScore = score
                                bestRule = candidateRule
                            }
                        }
                        if (bestRule && bestScore > 0) {
                            rawRule = bestRule
                        }
                    }
                }

                if (!rawRule) {
                    if (focusRuleId === 'system_smart_balance') {
                        alert('Bu yiyecek "Akıllı Dengeleme" (Smart Balance) tarafından haftalık hedefi tamamlamak için eklenmiştir. Değiştirilemez.')
                    } else if (focusRuleId?.startsWith('system_')) {
                        alert('Bu yiyecek motor tarafından makro hedeflerini dengelemek (Protein/Yağ Dolgusu) için eklenmiştir. Değiştirilemez.')
                    } else {
                        alert('İlgili kural bulunamadı. Kurallar listesinden manuel açabilirsiniz.')
                    }
                    return
                }

                if (rawRule.scope === 'patient' && rawRule.patient_id === patientId) {
                    setPrefillRule(null)
                    setEditingRule(rawRule)
                } else {
                    const { data: existingClone } = await applyCurrentTeamFilter(
                        supabase
                            .from('planning_rules')
                            .select('*')
                            .eq('scope', 'patient')
                            .eq('patient_id', patientId)
                            .eq('source_rule_id', rawRule.id as string)
                    ).maybeSingle()

                    if (existingClone) {
                        setPrefillRule(null)
                        setEditingRule(existingClone as PlanningRule)
                    } else {
                        setPrefillRule(rawRule)
                        setEditingRule(null)
                    }
                }

                if (cancelled) return
                setRuleDialogOpen(true)
                setLastFocusKey(focusKey)
                await fetchRules(true)
                onRulesChanged?.()
            } catch (e) {
                console.error("Error opening focused rule:", e)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        openFocusedRule()
        return () => {
            cancelled = true
        }
    }, [open, focusRuleId, focusRuleName, lastFocusKey, patientId, programTemplateId, hasPatientRules, fetchRules, onRulesChanged, applyCurrentTeamFilter])

    // Determine the base rules to show (program > team > global)
    // Sparse Override Merged Rules Calculation
    
        const allRules = [...globalRules, ...teamRules, ...programRules, ...patientRules]
    const getRootId = (rule: PlanningRule, rules: PlanningRule[]): string => {
        let current = rule
        let visited = new Set<string>()
        
        // IMPLICIT MATCHING: For old legacy rules that were copied without source_rule_id
        if (!current.source_rule_id && (current.scope === 'patient' || current.scope === 'program')) {
            const implicitParent = rules.find(r => 
                r.id !== current.id && 
                (r.scope === 'global' || r.scope === 'team') && 
                r.name === current.name && 
                r.rule_type === current.rule_type
            )
            if (implicitParent) {
                return implicitParent.id
            }
        }

        while (current.source_rule_id && !visited.has(current.id)) {
            visited.add(current.id)
            const parent = rules.find(r => r.id === current.source_rule_id)
            if (parent) {
                current = parent
            } else {
                // BROKEN LINK HEALING:
                // If a middle layer (e.g. Program override) was hard-deleted, the source_rule_id points to a ghost.
                // We heal the chain by matching the rule's name and type to a Global or Team rule.
                const fallbackParent = rules.find(r => 
                    r.id !== current.id && 
                    (r.scope === 'global' || r.scope === 'team') && 
                    r.name === current.name && 
                    r.rule_type === current.rule_type
                )
                if (fallbackParent) {
                    current = fallbackParent
                } else {
                    return current.source_rule_id
                }
            }
        }
        return current.id
    }
const mergedRulesMap = new Map<string, PlanningRule>()
    
    // 1. Base: Global Rules
    globalRules.forEach(r => mergedRulesMap.set(getRootId(r, allRules), r))
    
    // 2. Override with Team Rules
    teamRules.forEach(r => mergedRulesMap.set(getRootId(r, allRules), r))
    
    // 3. Override with Program Rules
    programRules.forEach(r => mergedRulesMap.set(getRootId(r, allRules), r))
    
    // 4. Override with Patient Rules
    patientRules.forEach(r => mergedRulesMap.set(getRootId(r, allRules), r))
    
    const mergedRules = Array.from(mergedRulesMap.values())
        .filter(r => {
            const def = r.definition as any
            if (!showDeleted && def && def._is_deleted === true) return false
            return true
        })
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        
    const hasExplicitProgramRules = programRules.length > 0
    const hasExplicitTeamRules = teamRules.length > 0
    const isProgramInherited = programRules.length > 0
    const isTeamInherited = programRules.length === 0 && teamRules.length > 0
    const canMutateRules = true
    const inheritedLabel = isProgramInherited ? 'Program' : isTeamInherited ? 'Takım' : 'Global'
    // hasPatientRules is no longer used as a strict barrier
    const baseRules = mergedRules

    const getActiveScopeForRule = useCallback((rule: PlanningRule): RuleScopeKey => {
        const rawScope = ((rule as any).scope_source || (rule as any).scope || '') as string
        if (rawScope === 'patient' || rawScope === 'program' || rawScope === 'team' || rawScope === 'global') {
            return rawScope
        }
        if (!hasPatientRules && isProgramInherited) return 'program'
        if (!hasPatientRules && isTeamInherited) return 'team'
        return 'global'
    }, [hasPatientRules, isProgramInherited, isTeamInherited])

    const getInheritanceChain = useCallback((rule: PlanningRule): RuleScopeKey[] => {
        let chain: RuleScopeKey[] = [(rule.scope as RuleScopeKey)]
        let current = rule
        let visited = new Set<string>()

        while (current.source_rule_id && !visited.has(current.id)) {
            visited.add(current.id)
            const parent = allRules.find(r => r.id === current.source_rule_id)
            if (parent) {
                if (parent.scope !== current.scope) {
                    chain.push(parent.scope as RuleScopeKey)
                }
                current = parent
            } else {
                // Try implicit healing
                const implicitParent = allRules.find(r => 
                    r.id !== current.id && 
                    (r.scope === 'global' || r.scope === 'team') && 
                    r.name === current.name && 
                    r.rule_type === current.rule_type
                )
                if (implicitParent && implicitParent.scope !== current.scope) {
                    chain.push(implicitParent.scope as RuleScopeKey)
                    current = implicitParent
                } else {
                    break
                }
            }
        }
        
        // Implicit match for null source_rule_id
        if (!current.source_rule_id && (current.scope === 'patient' || current.scope === 'program')) {
            const implicitParent = allRules.find(r => 
                r.id !== current.id && 
                (r.scope === 'global' || r.scope === 'team') && 
                r.name === current.name && 
                r.rule_type === current.rule_type
            )
            if (implicitParent && !visited.has(implicitParent.id) && implicitParent.scope !== current.scope) {
                chain.push(implicitParent.scope as RuleScopeKey)
            }
        }
        
        return chain.reverse()
    }, [allRules])



    // Restore a deleted or overridden rule (removes the patient-scoped row)
    async function handleRestoreOriginal(rule: PlanningRule) {
        if (!confirm(`"${rule.name}" kuralını orijinale (üst katmana) döndürmek istediğinize emin misiniz?`)) return
        setLoading(true)
        try {
            await supabase
                .from('planning_rules')
                .delete()
                .eq('id', rule.id)
            await fetchRules(true)
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error restoring rule:", e)
        }
        setLoading(false)
    }

    // Toggle rule
    async function handleToggleActive(rule: PlanningRule) {
        const nextActive = !rule.is_active

        // Optimistic UI
        if (rule.scope === 'patient') {
            setPatientRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_active: nextActive } : r))
        } else {
            setPatientRules(prev => [...prev, { ...rule, id: 'temp-'+Date.now(), scope: 'patient', is_active: nextActive, source_rule_id: rule.id } as PlanningRule])
        }

        try {
            if (rule.scope !== 'patient') {
                await supabase.from('planning_rules').insert({
                    name: rule.name,
                    description: rule.description,
                    rule_type: rule.rule_type,
                    priority: rule.priority,
                    is_active: nextActive,
                    definition: rule.definition,
                    scope: 'patient',
                    patient_id: patientId,
                    team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                    source_rule_id: rule.id,
                    sort_order: rule.sort_order
                })
            } else {
                await supabase.from('planning_rules').update({ is_active: nextActive }).eq('id', rule.id)
            }
            await fetchRules(true)
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error toggling rule:", e)
            await fetchRules(true)
        }
    }

    // Delete a single rule (creates a tombstone if inherited/overridden, actually deletes if pure patient rule)
    async function handleRestoreDeleted(rule: PlanningRule) {
        // Optimistic update
        setPatientRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_active: true, definition: { ...((r.definition as any) || {}), _is_deleted: false } } : r))
        
        try {
            if (rule.source_rule_id && Object.keys((rule.definition as any) || {}).length === 2 && (rule.definition as any)._is_deleted) {
                await supabase.from('planning_rules').delete().eq('id', rule.id)
            } else {
                const def = { ...((rule.definition as any) || {}) }
                delete def._is_deleted
                await supabase.from('planning_rules').update({
                    definition: def,
                    is_active: true
                }).eq('id', rule.id)
            }
            await fetchRules(true)
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error restoring rule:", e)
            await fetchRules(true) // rollback
        }
    }

    
    async function handleRestoreDefault(rule: PlanningRule) {
        // Optimistic update to make it feel instant without page reload
        setPatientRules(prev => prev.filter(r => r.id !== rule.id))
        
        try {
            await supabase.from('planning_rules').delete().eq('id', rule.id)
            await fetchRules(true)
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error restoring default rule:", e)
            await fetchRules(true) // rollback on error
        }
    }

    async function handleDeleteRule(rule: PlanningRule) {
        
        // Optimistic UI update
        if (rule.scope === 'patient') {
             setPatientRules(prev => prev.map(r => r.id === rule.id ? { ...r, is_active: false, definition: { ...((r.definition as any) || {}), _is_deleted: true } } : r))
        } else {
             setPatientRules(prev => [...prev, { ...rule, id: 'temp-'+Date.now(), scope: 'patient', is_active: false, definition: { ...((rule.definition as any) || {}), _is_deleted: true }, source_rule_id: rule.id } as PlanningRule])
        }

        try {
            if (rule.scope !== 'patient') {
                // Inherited: Insert a tombstone shadow record
                await supabase.from('planning_rules').insert({
                    name: rule.name,
                    description: rule.description,
                    rule_type: rule.rule_type,
                    priority: rule.priority,
                    is_active: false,
                    definition: { ...((rule.definition as any) || {}), _is_deleted: true },
                    scope: 'patient',
                    patient_id: patientId,
                    team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                    source_rule_id: rule.id,
                    sort_order: rule.sort_order
                })
            } else if (rule.source_rule_id || (rule.scope === 'patient' && allRules.some(r => r.id !== rule.id && (r.scope === 'global' || r.scope === 'team') && r.name === rule.name && r.rule_type === rule.rule_type))) {
                // Overridden (explicit or implicit): Update the existing patient row to be a tombstone
                await supabase.from('planning_rules').update({
                    is_active: false,
                    definition: { ...((rule.definition as any) || {}), _is_deleted: true }
                }).eq('id', rule.id)
            } else {
                // Truly local patient rule: delete
                await supabase.from('planning_rules').delete().eq('id', rule.id)
            }
            await fetchRules(true)
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error deleting rule:", e)
            await fetchRules(true) // rollback on error
        }
    }

    // Add a single base rule to patient
    // isActive: true/false for active state
    // isIgnored: true means "soft deleted" / hidden from lists
    async function handleAddGlobalRule(baseRule: PlanningRule, isActive: boolean = true, isIgnored: boolean = false) {
        setLoading(true)
        try {
            // Calculate next sort_order based on existing patient rules
            const currentMaxSort = patientRules.reduce((max, r) => {
                const v = Number(r.sort_order)
                return Number.isFinite(v) ? Math.max(max, v) : max
            }, -1)

            const { error } = await supabase
                .from('planning_rules')
                .insert({
                    name: baseRule.name,
                    description: baseRule.description,
                    rule_type: baseRule.rule_type,
                    priority: baseRule.priority,
                    is_active: isActive,
                    is_ignored: isIgnored,
                    definition: baseRule.definition,
                    scope: 'patient',
                    patient_id: patientId,
                    team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                    source_rule_id: baseRule.id,
                    sort_order: baseRule.sort_order ?? (currentMaxSort + 1)
                })

            if (error) throw error
            await fetchRules()
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error adding rule:", e)
            alert("Hata: " + e.message)
        }
        setLoading(false)
    }

    function handlePrefillAndAddRule(baseRule: PlanningRule) {
        setEditingRule(null)
        setPrefillRule(baseRule)
        setRuleDialogOpen(true)
    }

    function openRuleDialogForNew(prefill?: PlanningRule | null) {
        setEditingRule(null)
        setPrefillRule(prefill || null)
        setRuleDialogOpen(true)
    }

    function openRuleDialogForEdit(rule: PlanningRule) {
        if (rule.scope !== 'patient') {
            // Inherited rule: prefill for new override
            setPrefillRule(rule)
            setEditingRule(null)
            setRuleDialogOpen(true)
            return
        }
        setPrefillRule(null)
        setEditingRule(rule)
        setRuleDialogOpen(true)
    }

    function handleRuleDialogOpenChange(nextOpen: boolean) {
        setRuleDialogOpen(nextOpen)
        if (!nextOpen) {
            setEditingRule(null)
            setPrefillRule(null)
        }
    }


    // Suggest rule to global (for custom patient rules)
    async function handleSuggestToGlobal(rule: PlanningRule) {
        const { error } = await supabase
            .from('planning_rules')
            .update({ pending_global_approval: true })
            .eq('id', rule.id)

        if (!error) {
            await fetchRules(true)
        }
    }

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    async function handleDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const rules = [...displayRules];
        const oldIndex = rules.findIndex((r) => r.id === active.id);
        const newIndex = rules.findIndex((r) => r.id === over.id);

        if (oldIndex === -1 || newIndex === -1) return;

        // Optimistically update UI array right now. Move array item.
        const newRules = arrayMove(rules, oldIndex, newIndex);

        // Assign explicit sort_order based on array position
        // This makes sure 0 is the highest priority, 1 is next, etc.
        const sortedRules = newRules.map((r, i) => ({ ...r, sort_order: i }));

        try {
            // Optimistically update display UI by mutating current rules...
            // But actually we just want to update sort_order in db.
            // If a rule is inherited, we must first override it to set sort order!
            const updatePromises = sortedRules.map(async (sr) => {
                if (sr.scope !== 'patient') {
                    // Create an override just for the sort_order
                    await supabase.from('planning_rules').insert({
                        name: sr.name,
                        description: sr.description,
                        rule_type: sr.rule_type,
                        priority: sr.priority,
                        is_active: sr.is_active,
                        definition: sr.definition,
                        scope: 'patient',
                        patient_id: patientId,
                        team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                        source_rule_id: sr.id,
                        sort_order: sr.sort_order
                    })
                } else {
                    await supabase.from('planning_rules').update({ sort_order: sr.sort_order }).eq('id', sr.id)
                }
            });

            await Promise.all(updatePromises);

            await fetchRules(true);
            onRulesChanged?.();
        } catch (e: any) {
            console.error("Error moving rule:", e);
            alert("Sıralama değiştirilemedi: " + e.message);
            await fetchRules(true);
        }
    }

    // Always show rules: patient-specific if available, otherwise program/global
    // If sentinel is active, show global rules (the sentinel overrides program/team)
    const displayRules = hasGlobalSentinel 
        ? globalRules 
        : mergedRules

    function buildSafeFileNamePart(value: string) {
        return (value || 'hasta')
            .toLocaleLowerCase('tr-TR')
            .replace(/[^\p{L}\p{N}\s_-]/gu, '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '') || 'hasta'
    }

    function formatDateForFileName(date: Date) {
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    function handleExportPatientRules() {
        const exportRules = patientRules.filter((r) => r.name !== USE_GLOBAL_SENTINEL && !r.is_ignored)
        if (exportRules.length === 0) {
            alert("Bu hastada dışa aktarılacak bireysel kural bulunmuyor.")
            return
        }

        const today = formatDateForFileName(new Date())
        const safePatientName = buildSafeFileNamePart(patientDisplayName)
        const payload = {
            exported_at: new Date().toISOString(),
            patient_id: patientId,
            patient_name: patientDisplayName,
            scope: "patient",
            rules_count: exportRules.length,
            rules: exportRules,
        }

        const json = JSON.stringify(payload, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${safePatientName}_${today}_bireysel_kurallar.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    function handleImportButtonClick() {
        importInputRef.current?.click()
    }

    const stableStringifyRule = useCallback((value: any): string => {
        if (value === null || typeof value !== 'object') return JSON.stringify(value)
        if (Array.isArray(value)) return `[${value.map(stableStringifyRule).join(',')}]`
        const keys = Object.keys(value).sort()
        return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringifyRule(value[k])}`).join(',')}}`
    }, [])

    const buildRuleUniqueKey = useCallback((rule: any) => {
        const name = String(rule?.name || '').trim().toLocaleLowerCase('tr-TR')
        const type = String(rule?.rule_type || 'frequency').trim().toLocaleLowerCase('tr-TR')
        const def = stableStringifyRule(rule?.definition || { type: 'frequency', data: {} })
        return `${name}|${type}|${def}`
    }, [stableStringifyRule])

    async function applyPendingPatientImport(importMode: 'replace' | 'merge') {
        if (!pendingImportedRules || pendingImportedRules.length === 0) return
        setImportModeDialogOpen(false)
        setLoading(true)
        try {
            let insertedCount = 0

            if (importMode === 'replace') {
                const { error: deleteError } = await supabase
                    .from('planning_rules')
                    .delete()
                    .eq('scope', 'patient')
                    .eq('patient_id', patientId)

                if (deleteError) throw deleteError

                const replacePayload = pendingImportedRules.map((r: any, i: number) => ({ ...r, sort_order: i }))
                const { error: insertError } = await supabase
                    .from('planning_rules')
                    .insert(replacePayload)

                if (insertError) throw insertError
                insertedCount = replacePayload.length
            } else {
                await supabase
                    .from('planning_rules')
                    .delete()
                    .eq('scope', 'patient')
                    .eq('patient_id', patientId)
                    .eq('name', USE_GLOBAL_SENTINEL)

                const { data: existingRows, error: existingError } = await applyCurrentTeamFilter(
                    supabase
                        .from('planning_rules')
                        .select('id,name,rule_type,definition,sort_order')
                        .eq('scope', 'patient')
                        .eq('patient_id', patientId)
                )
                if (existingError) throw existingError

                const existing = existingRows || []
                const existingKeys = new Set(
                    existing
                        .filter((r: any) => r?.name !== USE_GLOBAL_SENTINEL)
                        .map((r: any) => buildRuleUniqueKey(r))
                )
                const currentMaxSort = existing.reduce((max: number, r: any) => {
                    const v = Number(r?.sort_order)
                    return Number.isFinite(v) ? Math.max(max, v) : max
                }, -1)

                const mergePayload = pendingImportedRules
                    .filter((r: any) => !existingKeys.has(buildRuleUniqueKey(r)))
                    .map((r: any, i: number) => ({ ...r, sort_order: currentMaxSort + i + 1 }))

                if (mergePayload.length > 0) {
                    const { error: insertError } = await supabase
                        .from('planning_rules')
                        .insert(mergePayload)
                    if (insertError) throw insertError
                }
                insertedCount = mergePayload.length
            }

            await fetchRules()
            onRulesChanged?.()
            if (importMode === 'replace') {
                alert(`${insertedCount} kural başarıyla içe aktarıldı (değiştir modu).`)
            } else {
                alert(`${insertedCount} yeni/farklı kural eklendi (birleştir modu).`)
            }
        } catch (error: any) {
            console.error("Patient rules import error:", error)
            alert("Kural içe aktarma hatası: " + (error?.message || "Geçersiz JSON dosyası"))
        } finally {
            setLoading(false)
            setPendingImportedRules(null)
            setPendingImportFileName('')
        }
    }

    async function handleImportPatientRulesFromFile(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file) return

        try {
            const raw = await file.text()
            const parsed = JSON.parse(raw)
            const importedRules = Array.isArray(parsed?.rules) ? parsed.rules : (Array.isArray(parsed) ? parsed : [])

            if (!Array.isArray(importedRules) || importedRules.length === 0) {
                alert("Geçerli bir kural listesi bulunamadı.")
                return
            }

            const cleanedRules = importedRules
                .filter((rule: any) => rule && rule.name !== USE_GLOBAL_SENTINEL)
                .map((rule: any, index: number) => ({
                    name: String(rule.name || `İçe Aktarılan Kural ${index + 1}`),
                    description: rule.description ?? null,
                    rule_type: rule.rule_type || 'frequency',
                    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
                    is_active: rule.is_active !== false,
                    is_ignored: rule.is_ignored === true,
                    definition: rule.definition || { type: 'frequency', data: {} },
                    sort_order: Number.isFinite(Number(rule.sort_order)) ? Number(rule.sort_order) : index,
                    scope: 'patient' as const,
                    patient_id: patientId,
                    team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                    source_rule_id: null,
                    pending_global_approval: false,
                }))

            const uniqueMap = new Map<string, any>()
            cleanedRules.forEach((rule: any) => {
                const key = buildRuleUniqueKey(rule)
                if (!uniqueMap.has(key)) uniqueMap.set(key, rule)
            })
            const dedupedImportedRules = Array.from(uniqueMap.values())

            if (dedupedImportedRules.length === 0) {
                alert("İçe aktarılacak geçerli bireysel kural bulunamadı.")
                return
            }

            setPendingImportedRules(dedupedImportedRules)
            setPendingImportFileName(file.name || 'rules.json')
            setImportModeDialogOpen(true)
        } catch (error: any) {
            console.error("Patient rules import error:", error)
            alert("Kural içe aktarma hatası: " + (error?.message || "Geçersiz JSON dosyası"))
        } finally {
            if (event.target) event.target.value = ''
        }
    }

    async function handleOpenCopyDialog() {
        const exportRules = patientRules.filter((r) => r.name !== USE_GLOBAL_SENTINEL && !r.is_ignored)
        if (exportRules.length === 0) {
            alert("Kopyalanacak bireysel kural bulunmuyor.")
            return
        }
        setCopyTargetsLoading(true)
        try {
            let query = supabase
                .from('patients')
                .select('id,full_name')
                .neq('id', patientId)
                .order('full_name', { ascending: true })

            const { data, error } = await query
            if (error) throw error
            const patients = (data || []) as Array<{ id: string, full_name: string }>
            setCopyTargetPatients(patients)
            setCopyTargetPatientId(patients[0]?.id || '')
            setCopyDialogOpen(true)
        } catch (error: any) {
            console.error("Copy target patients fetch error:", error)
            alert("Hedef hastalar yüklenemedi: " + (error?.message || 'Bilinmeyen hata'))
        } finally {
            setCopyTargetsLoading(false)
        }
    }

    async function applyCopyToPatient(copyMode: 'replace' | 'merge') {
        const targetPatientId = copyTargetPatientId
        if (!targetPatientId) {
            alert("Lütfen hedef hasta seçin.")
            return
        }

        const sourceRules = patientRules
            .filter((r) => r.name !== USE_GLOBAL_SENTINEL && !r.is_ignored)
            .map((rule, index) => ({
                name: String(rule.name || `Kopyalanan Kural ${index + 1}`),
                description: rule.description ?? null,
                rule_type: rule.rule_type || 'frequency',
                priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
                is_active: rule.is_active !== false,
                is_ignored: rule.is_ignored === true,
                definition: rule.definition || { type: 'frequency', data: {} },
                sort_order: Number.isFinite(Number(rule.sort_order)) ? Number(rule.sort_order) : index,
                scope: 'patient' as const,
                patient_id: targetPatientId,
                team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                source_rule_id: null,
                pending_global_approval: false,
            }))

        if (sourceRules.length === 0) {
            alert("Kopyalanacak bireysel kural bulunmuyor.")
            return
        }

        setCopyDialogOpen(false)
        setLoading(true)
        try {
            let insertedCount = 0

            if (copyMode === 'replace') {
                const { error: deleteError } = await supabase
                    .from('planning_rules')
                    .delete()
                    .eq('scope', 'patient')
                    .eq('patient_id', targetPatientId)
                if (deleteError) throw deleteError

                const replacePayload = sourceRules.map((r, i) => ({ ...r, sort_order: i }))
                const { error: insertError } = await supabase
                    .from('planning_rules')
                    .insert(replacePayload)
                if (insertError) throw insertError
                insertedCount = replacePayload.length
            } else {
                const { data: existingRows, error: existingError } = await applyCurrentTeamFilter(
                    supabase
                        .from('planning_rules')
                        .select('id,name,rule_type,definition,sort_order')
                        .eq('scope', 'patient')
                        .eq('patient_id', targetPatientId)
                )
                if (existingError) throw existingError

                const existing = existingRows || []
                const existingKeys = new Set(existing.map((r: any) => buildRuleUniqueKey(r)))
                const currentMaxSort = existing.reduce((max: number, r: any) => {
                    const v = Number(r?.sort_order)
                    return Number.isFinite(v) ? Math.max(max, v) : max
                }, -1)

                const mergePayload = sourceRules
                    .filter((r) => !existingKeys.has(buildRuleUniqueKey(r)))
                    .map((r, i) => ({ ...r, sort_order: currentMaxSort + i + 1 }))

                if (mergePayload.length > 0) {
                    const { error: insertError } = await supabase
                        .from('planning_rules')
                        .insert(mergePayload)
                    if (insertError) throw insertError
                }
                insertedCount = mergePayload.length
            }

            alert(
                copyMode === 'replace'
                    ? `${insertedCount} kural hedef hastaya kopyalandı (değiştir modu).`
                    : `${insertedCount} yeni/farklı kural hedef hastaya eklendi (birleştir modu).`
            )
        } catch (error: any) {
            console.error("Patient rules copy error:", error)
            alert("Kural kopyalama hatası: " + (error?.message || "Bilinmeyen hata"))
        } finally {
            setLoading(false)
        }
    }

    return (
        <>

            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    className="!max-w-none !translate-x-0 !translate-y-0 !flex !flex-col !p-0 !gap-0 overflow-hidden outline-none"
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
                    <DialogHeader onMouseDown={handleDialogDragStart} className="px-6 py-4 border-b bg-white shrink-0 z-10 cursor-move">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <DialogTitle className="flex items-center gap-2">
                                    Planlama Kuralları
                                    {hasGlobalSentinel ? (
                                        <Badge variant="default" className="bg-orange-600">Global (Manuel)</Badge>
                                    ) : hasPatientRules ? (
                                        <Badge variant="default" className="bg-blue-600">Kişiselleştirildi</Badge>
                                    ) : isProgramInherited ? (
                                        <Badge variant="default" className="bg-purple-600">Program Kuralları</Badge>
                                    ) : isTeamInherited ? (
                                        <Badge variant="default" className="bg-violet-600">Takım Kuralları</Badge>
                                    ) : (
                                        <Badge variant="secondary">Global</Badge>
                                    )}
                                </DialogTitle>
                                <DialogDescription>
                                    {hasGlobalSentinel
                                        ? "Bu hasta global kuralları kullanıyor (program/takım kuralları atlanıyor)."
                                        : hasPatientRules
                                            ? "Bu hastaya özel kurallar aktif. Değişiklikler sadece bu hastayı etkiler."
                                            : isProgramInherited
                                                ? "Programdan devralınan kurallar aktif. Değişiklik yaparsanız kurallar otomatik olarak kişiselleştirilir."
                                                : isTeamInherited
                                                    ? "Takımdan devralınan kurallar aktif. Değişiklik yaparsanız kurallar otomatik olarak kişiselleştirilir."
                                                    : "Tüm hastalar için geçerli global kurallar görüntüleniyor."
                                    }
                                </DialogDescription>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs shrink-0"
                                onClick={handleImportButtonClick}
                                title="JSON dosyasından bireysel kural yükle"
                            >
                                <Upload size={12} className="mr-1" />
                                Kuralları Yükle
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs shrink-0"
                                onClick={handleExportPatientRules}
                                disabled={patientRules.filter((r) => r.name !== USE_GLOBAL_SENTINEL && !r.is_ignored).length === 0}
                                title="Bu hastaya özel kuralları JSON olarak indir"
                            >
                                <Download size={12} className="mr-1" />
                                Kuralları Dışa Aktar
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs shrink-0"
                                onClick={handleOpenCopyDialog}
                                disabled={copyTargetsLoading || patientRules.filter((r) => r.name !== USE_GLOBAL_SENTINEL && !r.is_ignored).length === 0}
                                title="Bu hastanın bireysel kurallarını başka bir hastaya kopyala"
                            >
                                <Copy size={12} className="mr-1" />
                                Başka Hastaya Kopyala
                            </Button>
                        </div>
                    </DialogHeader>

                    {/* Content Area - Scrollable */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-slate-50/50">

                                                {/* Rules List */}
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="animate-spin" />
                            </div>
                        ) : displayRules.length === 0 ? (
                            <div className="text-center text-muted-foreground py-8">
                                Henüz kural tanımlanmamış.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={handleDragEnd}
                                >
                                    <SortableContext
                                        items={displayRules.map(r => r.id)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {displayRules.map((rule, index) => (
                                            <SortableRuleItem
                                                key={rule.id}
                                                rule={rule}
                                                index={index}
                                                loading={loading}
                                                canMutate={canMutateRules}
                                                activeScope={getActiveScopeForRule(rule)}
                                                inheritanceChain={getInheritanceChain(rule)}
                                                onToggleActive={handleToggleActive}
                                                onEdit={(r) => {
                                                    if (r.scope !== 'patient') {
                                                        openRuleDialogForNew(r)
                                                    } else {
                                                        openRuleDialogForEdit(r)
                                                    }
                                                }}
                                                onDelete={handleDeleteRule}
                                                onRestoreDeleted={handleRestoreDeleted}
                                                onRestoreDefault={handleRestoreDefault}
                                                onSuggest={handleSuggestToGlobal}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>

                            </div>
                        )}

                    </div>

                    <DialogFooter className="px-6 py-4 border-t bg-white shrink-0 flex items-center justify-between">
                        <div className="flex gap-2">
                        <Button variant={showDeleted ? "secondary" : "outline"} size="sm" className="h-9 gap-1.5" onClick={() => setShowDeleted(!showDeleted)}><Eye className="w-4 h-4" />{showDeleted ? "Gizle" : "Silinenleri Göster"}</Button>
                            <Button
                                variant="outline"
                                onClick={() => openRuleDialogForNew()}
                            >
                                <Plus size={14} className="mr-2" />
                                Yeni Kural
                            </Button>
                        </div>
                        <Button variant="secondary" onClick={() => onOpenChange(false)}>Kapat</Button>
                    </DialogFooter>

                    {/* Bottom-right resize handle */}
                    <div
                        onMouseDown={handleDialogResizeStart}
                        className="absolute right-0 bottom-0 h-5 w-5 cursor-se-resize z-30 group hidden sm:block"
                        title="Boyutlandır"
                    >
                        <div className="absolute right-1 bottom-1 h-3 w-3 border-r-2 border-b-2 border-slate-300 group-hover:border-slate-500" />
                    </div>
                </DialogContent>
            </Dialog>

            {/* Rule Edit/Create Dialog */}
                <RuleDialog
                    open={ruleDialogOpen}
                    onOpenChange={handleRuleDialogOpenChange}
                    initialData={editingRule}
                prefillData={prefillRule}
                onSuccess={() => {
                    fetchRules()
                    onRulesChanged?.()
                }}
                patientId={patientId}
                    teamOwnerId={isTeamScopedContext ? teamOwnerId : null}
                />

                <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportPatientRulesFromFile}
                />

                <Dialog open={importModeDialogOpen} onOpenChange={setImportModeDialogOpen}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>Kural Yükleme Modu</DialogTitle>
                            <DialogDescription>
                                {`"${pendingImportFileName}" dosyası için yükleme şeklini seçin.`}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3 pt-1">
                            <div className="flex items-center gap-2">
                                <Badge className="bg-violet-100 text-violet-700 border border-violet-200">JSON Import</Badge>
                                <Badge variant="outline" className="text-slate-600">Hasta Kuralları</Badge>
                            </div>
                            <button
                                type="button"
                                className="w-full rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white px-4 py-3 text-left hover:from-orange-100 hover:to-orange-50 transition-colors"
                                onClick={() => applyPendingPatientImport('replace')}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="h-8 w-8 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center shrink-0">
                                        <RotateCcw size={14} className="text-orange-700" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <div className="text-sm font-semibold text-orange-800">Değiştir (Önerilen)</div>
                                            <Badge className="bg-orange-100 text-orange-700 border border-orange-200">Tam Senkron</Badge>
                                        </div>
                                        <div className="text-xs text-orange-700 mt-1">Mevcut bireysel kuralları siler, JSON içeriğini aynen uygular.</div>
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                className="w-full rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-4 py-3 text-left hover:from-blue-100 hover:to-blue-50 transition-colors"
                                onClick={() => applyPendingPatientImport('merge')}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="h-8 w-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0">
                                        <Plus size={14} className="text-blue-700" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <div className="text-sm font-semibold text-blue-800">Birleştir</div>
                                            <Badge className="bg-blue-100 text-blue-700 border border-blue-200">Farklıları Ekle</Badge>
                                        </div>
                                        <div className="text-xs text-blue-700 mt-1">Mevcut kurallar kalır, JSON’dan yalnızca farklı olanlar eklenir.</div>
                                    </div>
                                </div>
                            </button>
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setImportModeDialogOpen(false)
                                    setPendingImportedRules(null)
                                    setPendingImportFileName('')
                                }}
                            >
                                İptal
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>Başka Hastaya Kopyala</DialogTitle>
                            <DialogDescription>
                                Bu hastanın bireysel kurallarını hedef hastaya uygulama yöntemini seçin.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3 pt-1">
                            <div className="flex items-center gap-2">
                                <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">Kuralları Kopyala</Badge>
                                <Badge variant="outline" className="text-slate-600">Hasta → Hasta</Badge>
                            </div>
                            <div className="space-y-1.5">
                                <div className="text-xs text-slate-500">Hedef Hasta</div>
                                <Select
                                    value={copyTargetPatientId}
                                    onValueChange={setCopyTargetPatientId}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Hasta seçin" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {copyTargetPatients.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                                {p.full_name || 'İsimsiz hasta'}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <button
                                type="button"
                                className="w-full rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white px-4 py-3 text-left hover:from-orange-100 hover:to-orange-50 transition-colors disabled:opacity-50"
                                disabled={!copyTargetPatientId}
                                onClick={() => applyCopyToPatient('replace')}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="h-8 w-8 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center shrink-0">
                                        <RotateCcw size={14} className="text-orange-700" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <div className="text-sm font-semibold text-orange-800">Değiştir (Üzerine Yaz)</div>
                                            <Badge className="bg-orange-100 text-orange-700 border border-orange-200">Eskiyi Sil</Badge>
                                        </div>
                                        <div className="text-xs text-orange-700 mt-1">Hedef hastanın mevcut bireysel kurallarını siler, bu hastanın kurallarını aynen uygular.</div>
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                className="w-full rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-4 py-3 text-left hover:from-blue-100 hover:to-blue-50 transition-colors disabled:opacity-50"
                                disabled={!copyTargetPatientId}
                                onClick={() => applyCopyToPatient('merge')}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="h-8 w-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center shrink-0">
                                        <Plus size={14} className="text-blue-700" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <div className="text-sm font-semibold text-blue-800">Birleştir (Farklıları Ekle)</div>
                                            <Badge className="bg-blue-100 text-blue-700 border border-blue-200">Güvenli Birleşim</Badge>
                                        </div>
                                        <div className="text-xs text-blue-700 mt-1">Hedefteki kurallar korunur, yalnızca farklı olan kurallar eklenir.</div>
                                    </div>
                                </div>
                            </button>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>
                                İptal
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
        </>
    )
}

interface SortableRuleItemProps {
    rule: PlanningRule;
    index: number;
    loading: boolean;
    canMutate: boolean;
    activeScope: RuleScopeKey;
    inheritanceChain?: RuleScopeKey[];
    onToggleActive: (rule: PlanningRule) => void;
    onEdit: (rule: PlanningRule) => void;
    onDelete: (rule: PlanningRule) => void;
    onRestoreDeleted?: (rule: PlanningRule) => void;
    onRestoreDefault?: (rule: PlanningRule) => void;
    onSuggest: (rule: PlanningRule) => void;
}

function SortableRuleItem({
    rule,
    index,
    loading,
    canMutate,
    activeScope,
    inheritanceChain,
    onToggleActive,
    onEdit,
    onDelete,
    onSuggest,
    onRestoreDeleted,
    onRestoreDefault
}: SortableRuleItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: rule.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 0,
        opacity: isDragging ? 0.8 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`border rounded-lg p-3 shadow-sm transition-all flex items-center gap-3 bg-white ${isDragging ? 'ring-2 ring-blue-500 shadow-md' : ''} ${!rule.is_active ? 'opacity-60 bg-slate-50' : ''}`}
        >
            {/* Drag/Move Controls */}
            <div
                {...attributes}
                {...listeners}
                className="flex flex-col gap-0.5 shrink-0 border-r pr-2 py-1 cursor-grab active:cursor-grabbing text-slate-400 hover:text-blue-600"
            >
                <GripVertical size={20} />
            </div>

            <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className={`font-semibold text-sm truncate ${(!rule.is_active || (rule.definition as any)?._is_deleted) ? 'text-slate-400 font-medium' : 'text-slate-900'} ${((rule.definition as any)?._is_deleted) ? 'line-through opacity-70' : ''}`}>{rule.name}</span>
                        <Badge variant="outline" className={`text-[10px] shrink-0 font-normal ${getScopeBadgeClass(activeScope)}`}>
                            {getScopeLabel(activeScope)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                            {getRuleTypeLabel(rule.rule_type)}
                        </Badge>
                        {inheritanceChain && inheritanceChain.length > 1 && (
                            <Badge variant="outline" className={`text-[10px] shrink-0 font-normal text-muted-foreground opacity-80 border-dashed`}>
                                Kaynak: {inheritanceChain.map(s => getScopeLabel(s)).join(' → ')}
                            </Badge>
                        )}
                        {rule.scope === 'patient' && inheritanceChain && inheritanceChain.length > 1 && (
                            <Badge variant="secondary" className="text-[10px] shrink-0 font-normal bg-blue-50 text-blue-600 hover:bg-blue-100 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400">
                                Özelleştirilmiş
                            </Badge>
                        )}
                        {(rule.definition as any)?._source === 'pattern_insights' && (
                            <Badge className="text-[10px] bg-indigo-50 text-indigo-600 border-indigo-200 shrink-0 font-normal hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400">
                                🤖 Örüntü Analizi
                            </Badge>
                        )}
                        {(rule as any).pending_global_approval && (
                            <Badge className="text-[10px] bg-amber-500 shrink-0">
                                Onay Bekliyor
                            </Badge>
                        )}

                    </div>
                    {rule.description && (
                        <p className={`text-xs leading-relaxed ${(!rule.is_active || (rule.definition as any)?._is_deleted) ? 'text-slate-400 opacity-70' : 'text-slate-500'}`}>{rule.description}</p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-1">
                        Sıra #{index + 1}
                    </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    {canMutate && (
                        <>
                            <Switch
                                checked={rule.is_active}
                                onCheckedChange={() => onToggleActive(rule)}
                                className="scale-90"
                            />
                            <div className="w-px h-4 bg-slate-200 mx-1" />
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-slate-400 hover:text-blue-600"
                                onClick={() => onEdit(rule)}
                            >
                                <Pencil size={14} />
                            </Button>
                            
                            {(rule.source_rule_id || (inheritanceChain && inheritanceChain.length > 1)) && onRestoreDefault && (
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-blue-600" onClick={() => onRestoreDefault(rule)} title="Orijinale Dön (Değişiklikleri Sil)">
                                    <Undo2 size={14} />
                                </Button>
                            )}
                            {((rule.definition as any)?._is_deleted) ? (
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-emerald-600" onClick={() => onRestoreDeleted?.(rule)} title="Çöpten Çıkar (Silmeyi İptal Et)">
                                <ArchiveRestore size={14} />
                            </Button>
                        ) : (
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => onDelete(rule)} title="Sil">
                                <Trash2 size={14} />
                            </Button>
                        )}
                            {/* Suggest to Global button - only for custom patient rules */}
                            {rule.scope === 'patient' && !(rule as any).source_rule_id && !(rule as any).pending_global_approval && (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-slate-400 hover:text-blue-600"
                                    onClick={() => onSuggest(rule)}
                                    title="Global'e Öner"
                                >
                                    <Upload size={14} />
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}




