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
import { Loader2, Plus, Trash2, Pencil, RotateCcw, Upload, Download, AlertCircle, GripVertical, Copy } from "lucide-react"
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

                let editableRule: PlanningRule | null = null

                if (rawRule.scope === 'patient' && rawRule.patient_id === patientId) {
                    editableRule = rawRule
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
                        editableRule = existingClone as PlanningRule
                    } else if (!hasPatientRules) {
                        const cloned = await ensurePatientRules()
                        editableRule = cloned.find(r => r.source_rule_id === rawRule?.id) || null
                    }

                    if (!editableRule) {
                        editableRule = await cloneSingleRuleToPatient(rawRule)
                    }
                }

                if (cancelled || !editableRule) return

                setPrefillRule(null)
                setEditingRule(editableRule)
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
    }, [open, focusRuleId, focusRuleName, lastFocusKey, patientId, programTemplateId, hasPatientRules, ensurePatientRules, fetchRules, onRulesChanged, applyCurrentTeamFilter])

    // Determine the base rules to show (program > team > global)
    const baseRules = programRules.length > 0
        ? programRules
        : teamRules.length > 0
            ? teamRules
            : globalRules
    const isProgramInherited = !hasPatientRules && programRules.length > 0
    const isTeamInherited = !hasPatientRules && programRules.length === 0 && teamRules.length > 0
    const canMutateRules = hasPatientRules || isProgramInherited || isTeamInherited
    const inheritedLabel = isProgramInherited ? 'Program' : isTeamInherited ? 'Takım' : 'Global'
    const hasExplicitProgramRules = programRules.length > 0
    const hasExplicitTeamRules = teamRules.length > 0

    const getActiveScopeForRule = useCallback((rule: PlanningRule): RuleScopeKey => {
        const rawScope = ((rule as any).scope_source || (rule as any).scope || '') as string
        if (rawScope === 'patient' || rawScope === 'program' || rawScope === 'team' || rawScope === 'global') {
            return rawScope
        }
        if (!hasPatientRules && isProgramInherited) return 'program'
        if (!hasPatientRules && isTeamInherited) return 'team'
        return 'global'
    }, [hasPatientRules, isProgramInherited, isTeamInherited])

    const getSourceScopeForRule = useCallback((rule: PlanningRule): RuleScopeKey | null => {
        const sourceRuleId = (rule as any).source_rule_id as string | null | undefined
        if (!sourceRuleId) return null
        if (programRules.some(r => r.id === sourceRuleId)) return 'program'
        if (teamRules.some(r => r.id === sourceRuleId)) return 'team'
        if (globalRules.some(r => r.id === sourceRuleId)) return 'global'
        return null
    }, [programRules, teamRules, globalRules])

    // Find new base rules that patient doesn't have
    const newInheritedRules = baseRules.filter(g => {
        return !patientRules.some(p => p.source_rule_id === g.id)
    })

    // Auto-clone helper: clone all base rules to patient scope, return new patient rules
    async function ensurePatientRules(): Promise<PlanningRule[]> {
        if (hasPatientRules) return patientRules

        const rulesToInsert = baseRules.map((rule, index) => ({
            name: rule.name,
            description: rule.description,
            rule_type: rule.rule_type,
            priority: rule.priority,
            is_active: rule.is_active,
            definition: rule.definition,
            scope: 'patient' as const,
            patient_id: patientId,
            team_owner_id: isTeamScopedContext ? teamOwnerId : null,
            source_rule_id: rule.id,
            sort_order: rule.sort_order ?? index
        }))

        const { data, error } = await supabase
            .from('planning_rules')
            .insert(rulesToInsert)
            .select()

        if (error) throw error
        return (data as unknown as PlanningRule[]) || []
    }

    async function cloneSingleRuleToPatient(baseRule: PlanningRule): Promise<PlanningRule | null> {
        const payload = {
            name: baseRule.name,
            description: baseRule.description,
            rule_type: baseRule.rule_type,
            priority: baseRule.priority,
            is_active: baseRule.is_active,
            definition: baseRule.definition,
            scope: 'patient' as const,
            patient_id: patientId,
            team_owner_id: isTeamScopedContext ? teamOwnerId : null,
            source_rule_id: baseRule.id,
            sort_order: baseRule.sort_order ?? patientRules.length
        }

        const { data, error } = await supabase
            .from('planning_rules')
            .insert(payload)
            .select()
            .single()

        if (error) {
            // Fallback: if insertion failed (e.g. duplicate), try to find an existing patient rule by name.
            const { data: existingByName } = await applyCurrentTeamFilter(
                supabase
                    .from('planning_rules')
                    .select('*')
                    .eq('scope', 'patient')
                    .eq('patient_id', patientId)
                    .eq('name', baseRule.name)
            ).limit(1)
            if (existingByName && existingByName.length > 0) {
                return existingByName[0] as PlanningRule
            }
            throw error
        }
        return (data as unknown as PlanningRule) || null
    }

    // Clone base rules (program or global) to patient scope
    async function handlePersonalize() {
        if (!patientId) return
        setLoading(true)

        try {
            await ensurePatientRules()
            await fetchRules()
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error personalizing rules:", e)
            alert("Kişiselleştirme hatası: " + e.message)
        }
        setLoading(false)
    }

    // Revert to program rules (delete patient rules, system falls back to program)
    async function handleRevertToUpperLayer() {
        const upperLabel = programTemplateId
            ? 'program kurallarına'
            : teamRules.length > 0
                ? 'takım kurallarına'
                : 'global kurallara'
        if (!confirm(`Tüm kişisel kurallar silinecek ve ${upperLabel} dönülecek. Emin misiniz?`)) return
        setLoading(true)

        try {
            // Delete ALL patient rules (ignore team_owner_id to prevent orphans)
            const { error } = await supabase
                .from('planning_rules')
                .delete()
                .eq('scope', 'patient')
                .eq('patient_id', patientId)

            if (error) throw error

            await fetchRules()
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error reverting to upper layer:", e)
            alert("Hata: " + e.message)
        }
        setLoading(false)
    }

    // Revert to global rules (delete patient rules, then clone globals to override program)
    async function handleRevertToGlobal() {
        if (!confirm("Tüm kişisel kurallar silinecek ve global kurallara dönülecek. Emin misiniz?")) return
        setLoading(true)

        try {
            // 1. Delete ALL patient rules (ignore team_owner_id to prevent orphans)
            const { error } = await supabase
                .from('planning_rules')
                .delete()
                .eq('scope', 'patient')
                .eq('patient_id', patientId)

            if (error) throw error

            // 2. If patient has program or team rules, insert a sentinel marker
            //    so the engine knows to skip inheritance and use global rules directly.
            //    Without the sentinel, the engine would fall back to program/team rules.
            if (programTemplateId || teamRules.length > 0) {
                await supabase
                    .from('planning_rules')
                    .insert({
                        name: USE_GLOBAL_SENTINEL,
                        description: 'Sentinel: bu hasta global kuralları kullanır',
                        rule_type: 'frequency',
                        priority: 0,
                        is_active: false,
                        definition: { type: 'frequency', data: {} },
                        scope: 'patient',
                        patient_id: patientId,
                        team_owner_id: isTeamScopedContext ? teamOwnerId : null
                    })
            }

            await fetchRules()
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error reverting to global:", e)
            alert("Hata: " + e.message)
        }
        setLoading(false)
    }

    // Revert to team rules (delete patient rules, then clone team rules to override program)
    async function handleRevertToTeam() {
        if (teamRules.length === 0) {
            alert("Takım kuralı bulunamadı.")
            return
        }
        if (!confirm("Tüm kişisel kurallar silinecek ve takım kurallarına dönülecek. Emin misiniz?")) return
        setLoading(true)

        try {
            // 1. Delete ALL patient rules (ignore team_owner_id to prevent orphans)
            const { error: deleteError } = await supabase
                .from('planning_rules')
                .delete()
                .eq('scope', 'patient')
                .eq('patient_id', patientId)
            if (deleteError) throw deleteError

            // 2. Clone team rules to patient scope
            const rulesToInsert = teamRules.map(rule => ({
                name: rule.name,
                description: rule.description,
                rule_type: rule.rule_type,
                priority: rule.priority,
                is_active: rule.is_active,
                definition: rule.definition,
                scope: 'patient' as const,
                patient_id: patientId,
                team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                source_rule_id: rule.id
            }))

            const { error: insertError } = await supabase
                .from('planning_rules')
                .insert(rulesToInsert)
            if (insertError) throw insertError

            await fetchRules()
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error reverting to team:", e)
            alert("Hata: " + e.message)
        }
        setLoading(false)
    }

    // Toggle rule active state (auto-clones if inheriting from program)
    async function handleToggleActive(rule: PlanningRule) {
        setLoading(true)
        try {
            if (!hasPatientRules) {
                // Copy-on-write: clone all rules first
                const cloned = await ensurePatientRules()
                // Find the cloned version of this rule
                const clonedRule = cloned.find(r => r.source_rule_id === rule.id)
                if (clonedRule) {
                    await supabase
                        .from('planning_rules')
                        .update({ is_active: !rule.is_active })
                        .eq('id', clonedRule.id)
                }
            } else {
                await supabase
                    .from('planning_rules')
                    .update({ is_active: !rule.is_active })
                    .eq('id', rule.id)
            }
            await fetchRules(true)
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error toggling rule:", e)
        }
        setLoading(false)
    }

    // Delete a single rule (auto-clones if inheriting from program, then removes)
    async function handleDeleteRule(rule: PlanningRule) {
        if (!confirm(`"${rule.name}" kuralını silmek istediğinize emin misiniz?`)) return
        setLoading(true)
        try {
            if (!hasPatientRules) {
                // Copy-on-write: clone all rules, then delete the one
                const cloned = await ensurePatientRules()
                const clonedRule = cloned.find(r => r.source_rule_id === rule.id)
                if (clonedRule) {
                    await supabase
                        .from('planning_rules')
                        .delete()
                        .eq('id', clonedRule.id)
                }
            } else {
                await supabase
                    .from('planning_rules')
                    .delete()
                    .eq('id', rule.id)
            }
            await fetchRules()
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error deleting rule:", e)
        }
        setLoading(false)
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

    // Add all new base rules
    async function handleAddAllNewGlobalRules() {
        setLoading(true)
        try {
            // Calculate next sort_order based on existing patient rules
            const currentMaxSort = patientRules.reduce((max, r) => {
                const v = Number(r.sort_order)
                return Number.isFinite(v) ? Math.max(max, v) : max
            }, -1)

            const rulesToInsert = newInheritedRules.map((rule, index) => ({
                name: rule.name,
                description: rule.description,
                rule_type: rule.rule_type,
                priority: rule.priority,
                is_active: rule.is_active,
                definition: rule.definition,
                scope: 'patient',
                patient_id: patientId,
                team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                source_rule_id: rule.id,
                sort_order: rule.sort_order ?? (currentMaxSort + index + 1)
            }))

            const { error } = await supabase
                .from('planning_rules')
                .insert(rulesToInsert)

            if (error) throw error
            await fetchRules()
            onRulesChanged?.()
        } catch (e: any) {
            console.error("Error adding rules:", e)
            alert("Hata: " + e.message)
        }
        setLoading(false)
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

        if (hasPatientRules) {
            setPatientRules(prev => {
                const updated = [...prev];
                sortedRules.forEach(sr => {
                    const idx = updated.findIndex(u => u.id === sr.id);
                    if (idx !== -1) updated[idx] = sr;
                });
                return updated.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            });
        } else {
            setPatientRules(sortedRules);
            setHasPatientRules(true);
        }

        try {
            // 1. Ensure patient-specific rules exist (Copy-on-write)
            // Need to handle state update delay, so we fetch/clone synchronously if needed
            let currentRules = patientRules;
            if (!hasPatientRules) {
                currentRules = await ensurePatientRules();
            }

            // 2. Update the sort_order for all rules to ensure complete consistency
            // If some rules had NULL or arbitrary sort_order values before, just updating min to max leaves them broken.
            const updatePromises = sortedRules.map((sr) => {
                const dbRule = currentRules.find(r => r.id === sr.id || (r.source_rule_id === sr.id && sr.scope !== 'patient'));
                if (dbRule) {
                    return supabase.from('planning_rules').update({ sort_order: sr.sort_order }).eq('id', dbRule.id);
                }
                return Promise.resolve();
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
        : hasPatientRules
            ? patientRules.filter(r => !r.is_ignored)
            : baseRules

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

                        {/* Show new inherited rules to add individually */}
                        {hasPatientRules && newInheritedRules.length > 0 && (
                            <div className="mb-6 border border-blue-200 rounded-lg bg-white overflow-hidden shadow-sm">
                                <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                                        <AlertCircle size={16} />
                                        <span>Eklenebilecek Yeni {inheritedLabel} Kuralları ({newInheritedRules.length})</span>
                                    </div>
                                    <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-100" onClick={handleAddAllNewGlobalRules}>
                                        <Download size={12} className="mr-1" /> Tümünü Kabul Et
                                    </Button>
                                </div>
                                <div className="divide-y divide-blue-50">
                                    {newInheritedRules.map(rule => (
                                        <div key={rule.id} className="flex items-center justify-between p-3 hover:bg-blue-50/30 transition-colors">
                                            <div className="flex flex-col flex-1 min-w-0 mr-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-slate-800 truncate">{rule.name}</span>
                                                    <Badge variant="outline" className={`text-[10px] font-normal ${getScopeBadgeClass(getActiveScopeForRule(rule))}`}>
                                                        {getScopeLabel(getActiveScopeForRule(rule))}
                                                    </Badge>
                                                    <Badge variant="outline" className="text-[10px] font-normal">
                                                        {getRuleTypeLabel(rule.rule_type)}
                                                    </Badge>
                                                    {getSourceScopeForRule(rule) && (
                                                        <Badge variant="outline" className={`text-[10px] font-normal ${getScopeBadgeClass(getSourceScopeForRule(rule)!)} opacity-80`}>
                                                            Kaynak: {getScopeLabel(getSourceScopeForRule(rule)!)}
                                                        </Badge>
                                                    )}
                                                </div>
                                                <span className="text-xs text-slate-500 mt-0.5 truncate">{rule.description || "Açıklama yok"}</span>
                                                <span className="text-[11px] text-slate-400 mt-1">
                                                    Öncelik {rule.priority ?? 0}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 px-2 text-xs border-blue-200 text-blue-700 hover:bg-blue-100"
                                                    onClick={() => handlePrefillAndAddRule(rule)}
                                                    title="Eklemeden önce düzenle"
                                                >
                                                    <Pencil size={12} className="mr-1" /> Düzenle
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 px-2 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                                                    onClick={() => handleAddGlobalRule(rule, false, false)}
                                                    title="Listeye ekle ama pasif olsun"
                                                >
                                                    Pasif
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    className="h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                                    onClick={() => handleAddGlobalRule(rule, true, false)}
                                                >
                                                    <Plus size={12} className="mr-1" /> Ekle
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-8 px-2 text-xs text-red-400 hover:text-red-600 hover:bg-red-50"
                                                    onClick={() => {
                                                        if (confirm("Bu öneriyi silmek istediğinize emin misiniz? (Bir daha gösterilmeyecek)")) {
                                                            handleAddGlobalRule(rule, false, true)
                                                        }
                                                    }}
                                                    title="Sil (öneri listesinden kaldır)"
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}


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
                                                sourceScope={getSourceScopeForRule(rule)}
                                                onToggleActive={handleToggleActive}
                                                onEdit={async (r) => {
                                                    if (!hasPatientRules) {
                                                        setLoading(true)
                                                        try {
                                                            const cloned = await ensurePatientRules()
                                                            const clonedRule = cloned.find(cr => cr.source_rule_id === r.id)
                                                            await fetchRules()
                                                            onRulesChanged?.()
                                                            if (clonedRule) {
                                                                openRuleDialogForEdit(clonedRule)
                                                            }
                                                        } catch (e) {
                                                            console.error(e)
                                                        }
                                                        setLoading(false)
                                                    } else {
                                                        openRuleDialogForEdit(r)
                                                    }
                                                }}
                                                onDelete={handleDeleteRule}
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
                            {!hasPatientRules && !isProgramInherited && !isTeamInherited ? (
                                <Button onClick={handlePersonalize} disabled={loading || baseRules.length === 0} className="gap-2">
                                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Kuralları Kişiselleştir
                                </Button>
                            ) : !hasPatientRules && (isProgramInherited || isTeamInherited) ? (
                                <>
                                    <Button onClick={handlePersonalize} disabled={loading || baseRules.length === 0} className="gap-2">
                                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Kuralları Kişiselleştir
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => openRuleDialogForNew()}
                                    >
                                        <Plus size={14} className="mr-2" />
                                        Yeni Kural
                                    </Button>
                                </>
                            ) : (
                                <>
                                    {/* Üst katmana dön: program varsa programa, yoksa takım kurallarına */}
                                    {(programTemplateId || teamRules.length > 0) && (
                                        <Button
                                            variant="outline"
                                            onClick={handleRevertToUpperLayer}
                                            disabled={loading || (programTemplateId ? !hasExplicitProgramRules : !hasExplicitTeamRules)}
                                            className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 border-purple-200"
                                            title={programTemplateId
                                                ? (hasExplicitProgramRules ? 'Program katmanına dön' : 'Program katmanında özelleştirilmiş kural yok')
                                                : (hasExplicitTeamRules ? 'Takım katmanına dön' : 'Takım katmanında kural yok')}
                                        >
                                            <RotateCcw size={14} className="mr-2" />
                                            {programTemplateId ? 'Programa Dön' : 'Takıma Dön'}
                                        </Button>
                                    )}
                                    {/* Takıma Dön - show for team-scoped users when patient has a program */}
                                    {programTemplateId && isTeamScopedContext && (
                                        <Button
                                            variant="outline"
                                            onClick={handleRevertToTeam}
                                            disabled={loading || !hasExplicitTeamRules}
                                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                            title={!hasExplicitTeamRules ? 'Takım katmanında kural yok' : 'Takım kurallarına dön'}
                                        >
                                            <RotateCcw size={14} className="mr-2" />
                                            Takıma Dön
                                        </Button>
                                    )}
                                    {/* Global'e Dön - always available (disabled if sentinel already active) */}
                                    <Button
                                        variant="outline"
                                        onClick={handleRevertToGlobal}
                                        disabled={loading || hasGlobalSentinel}
                                        className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                                        title={hasGlobalSentinel ? 'Zaten global kurallar kullanılıyor' : "Global kurallara dön"}
                                    >
                                        <RotateCcw size={14} className="mr-2" />
                                        Global'e Dön
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => openRuleDialogForNew()}
                                    >
                                        <Plus size={14} className="mr-2" />
                                        Yeni Kural
                                    </Button>
                                </>
                            )}
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
    sourceScope?: RuleScopeKey | null;
    onToggleActive: (rule: PlanningRule) => void;
    onEdit: (rule: PlanningRule) => void;
    onDelete: (rule: PlanningRule) => void;
    onSuggest: (rule: PlanningRule) => void;
}

function SortableRuleItem({
    rule,
    index,
    loading,
    canMutate,
    activeScope,
    sourceScope,
    onToggleActive,
    onEdit,
    onDelete,
    onSuggest
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
                        <span className="font-semibold text-sm truncate text-slate-900">{rule.name}</span>
                        <Badge variant="outline" className={`text-[10px] shrink-0 font-normal ${getScopeBadgeClass(activeScope)}`}>
                            {getScopeLabel(activeScope)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                            {getRuleTypeLabel(rule.rule_type)}
                        </Badge>
                        {sourceScope && (
                            <Badge variant="outline" className={`text-[10px] shrink-0 font-normal ${getScopeBadgeClass(sourceScope)} opacity-80`}>
                                Kaynak: {getScopeLabel(sourceScope)}
                            </Badge>
                        )}
                        {(rule as any).source_rule_id && (
                            <Badge variant="secondary" className="text-[10px] shrink-0 font-normal">
                                Klonlanmış
                            </Badge>
                        )}
                        {(rule as any).pending_global_approval && (
                            <Badge className="text-[10px] bg-amber-500 shrink-0">
                                Onay Bekliyor
                            </Badge>
                        )}

                    </div>
                    {rule.description && (
                        <p className="text-xs text-slate-500 leading-relaxed">{rule.description}</p>
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
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-slate-400 hover:text-red-600"
                                onClick={() => onDelete(rule)}
                            >
                                <Trash2 size={14} />
                            </Button>
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




