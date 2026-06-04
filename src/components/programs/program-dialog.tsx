'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { adminSaveProgramTemplateAction } from '@/actions/public-db-actions'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, Eye, Calendar, Ban, AlertTriangle, BookOpen, UtensilsCrossed, Pencil, RotateCcw, Download, Loader2, Upload, Settings, Copy } from 'lucide-react'
import { MealTypesEditor, SlotConfig as MealSlotConfig } from '@/components/planner/meal-types-editor'
import { RuleDialog } from '@/components/planner/rule-dialog'
import { SettingsDialog } from '@/components/planner/settings-dialog'
import { DietTypesEditor } from '@/components/diet/diet-types-editor'
import { PlanningRule } from '@/types/planner'
import { resolveTeamScopeContextFromAuth } from '@/lib/team-scope'
import { applyTeamDietTypeOverrides } from '@/lib/team-diet-type-overrides'
import { applyProgramDietTypeOverrides } from '@/lib/program-diet-type-overrides'

interface DietType {
    id: string
    name: string
    abbreviation?: string
    [key: string]: any
}

interface ProgramTemplateWeek {
    id?: string
    week_start: number
    week_end: number
    diet_type_id: string | null
    notes: string | null
}

interface ProgramTemplateRestriction {
    id?: string
    restriction_type: 'keyword' | 'tag' | 'food_id'
    restriction_value: string
    reason: string | null
    severity: 'warn' | 'block'
}

interface ProgramTemplate {
    id?: string
    name: string
    description: string | null
    total_weeks: number
    default_activity_level: number
    is_active: boolean
    scope_source?: 'global' | 'team'
    program_template_weeks?: ProgramTemplateWeek[]
    program_template_restrictions?: ProgramTemplateRestriction[]
}

interface ProgramDialogProps {
    open: boolean
    onClose: () => void
    program: ProgramTemplate | null
    forcedMode?: 'global' | 'team'
}

type RuleScopeKey = 'global' | 'team' | 'program' | 'patient'

const RULE_TYPE_LABELS: Record<string, string> = {
    frequency: 'Sıklık / Limit',
    affinity: 'Uyum / Eşleşme',
    consistency: 'Tutarlılık / Kilit',
    fixed_meal: 'Sabit Öğün',
    nutritional: 'Makro Kuralı',
    rotation: 'Rotasyon',
    or_group: 'VEYA Grubu',
    preference: 'Tercih',
}

function getRuleTypeLabel(type?: string | null) {
    if (!type) return 'Kural'
    return RULE_TYPE_LABELS[type] || type
}

function getRuleDisplayName(rule: PlanningRule) {
    const raw = (rule.name || '').trim()
    if (raw.length > 0) return raw
    const type = getRuleTypeLabel(rule.rule_type)
    const shortId = (rule.id || 'yeni').slice(0, 8)
    return `[Adsız] ${type} (${shortId})`
}

function getRuleDisplayDescription(rule: PlanningRule) {
    const raw = (rule.description || '').trim()
    if (raw.length > 0) return raw
    if (rule.rule_type === 'frequency') return 'Sıklık / limit davranışı'
    if (rule.rule_type === 'affinity') return 'Birlikte öneri / eşleşme davranışı'
    if (rule.rule_type === 'consistency') return 'Kilitleme / tutarlılık davranışı'
    if (rule.rule_type === 'fixed_meal') return 'Sabit öğün davranışı'
    if (rule.rule_type === 'nutritional') return 'Makro bazlı davranış'
    return 'Açıklama eklenmemiş'
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

export default function ProgramDialog({ open, onClose, program, forcedMode }: ProgramDialogProps) {
    const DIALOG_MARGIN = 12
    const OPEN_VERTICAL_OFFSET = 24
    const MIN_DIALOG_WIDTH = 760
    const MIN_DIALOG_HEIGHT = 560
    const DEFAULT_DIALOG_WIDTH = 1100
    const DEFAULT_DIALOG_HEIGHT = 900

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

    const getInitialDialogSize = useCallback(() => {
        return clampDialogSize({ width: DEFAULT_DIALOG_WIDTH, height: DEFAULT_DIALOG_HEIGHT })
    }, [clampDialogSize])

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

    const [saving, setSaving] = useState(false)
    const [dietTypes, setDietTypes] = useState<DietType[]>([])

    // Form state
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [totalWeeks, setTotalWeeks] = useState(12)
    const [activityLevel, setActivityLevel] = useState(3)
    const [isActive, setIsActive] = useState(true)
    const [weekMappings, setWeekMappings] = useState<ProgramTemplateWeek[]>([])
    const [restrictions, setRestrictions] = useState<ProgramTemplateRestriction[]>([])

    // New restriction form
    const [newRestrictionType, setNewRestrictionType] = useState<'keyword' | 'tag'>('keyword')
    const [newRestrictionValue, setNewRestrictionValue] = useState('')
    const [newRestrictionSeverity, setNewRestrictionSeverity] = useState<'warn' | 'block'>('warn')

    // â”€â”€â”€ Rules Tab State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [rulesLoading, setRulesLoading] = useState(false)
    const [showDeleted, setShowDeleted] = useState(false)
    const [globalRules, setGlobalRules] = useState<PlanningRule[]>([])
    const [teamRules, setTeamRules] = useState<PlanningRule[]>([])
    const [programRules, setProgramRules] = useState<PlanningRule[]>([])
    const [hasProgramRules, setHasProgramRules] = useState(false)
    const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
    const [editingRule, setEditingRule] = useState<PlanningRule | null>(null)
    const [prefillRule, setPrefillRule] = useState<PlanningRule | null>(null)
    const [rulesTeamOwnerId, setRulesTeamOwnerId] = useState<string | null>(null)
    const programRulesImportRef = useRef<HTMLInputElement | null>(null)
    const [importModeDialogOpen, setImportModeDialogOpen] = useState(false)
    const [pendingImportedRules, setPendingImportedRules] = useState<any[] | null>(null)
    const [pendingImportFileName, setPendingImportFileName] = useState('')
    const [copyDialogOpen, setCopyDialogOpen] = useState(false)
    const [copyTargetProgramId, setCopyTargetProgramId] = useState<string>('')
    const [copyTargetPrograms, setCopyTargetPrograms] = useState<Array<{ id: string, name: string }>>([])
    const [copyTargetsLoading, setCopyTargetsLoading] = useState(false)
    const [upperRulesPanelRatio, setUpperRulesPanelRatio] = useState(0.42)
    const [isSplitDragging, setIsSplitDragging] = useState(false)
    const splitContainerRef = useRef<HTMLDivElement | null>(null)
    const [dialogSize, setDialogSize] = useState(getInitialDialogSize)
    const [dialogPosition, setDialogPosition] = useState({ x: DIALOG_MARGIN, y: DIALOG_MARGIN })
    const [isDraggingDialog, setIsDraggingDialog] = useState(false)
    const [isResizingDialog, setIsResizingDialog] = useState(false)
    const dragStartRef = useRef<{ x: number, y: number, startPositionX: number, startPositionY: number } | null>(null)
    const resizeStartRef = useRef<{ x: number, y: number, width: number, height: number } | null>(null)

    // â”€â”€â”€ General Settings Tab State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [settingsOpen, setSettingsOpen] = useState(false)

    const safeDialogPosition = clampPosition(dialogPosition, dialogSize)

    useEffect(() => {
        if (!open || typeof window === 'undefined') return
        const nextSize = getInitialDialogSize()
        setDialogSize(nextSize)
        setDialogPosition(getCenteredPosition(nextSize))
    }, [open, getInitialDialogSize, getCenteredPosition])

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

    useEffect(() => {
        if (!isSplitDragging || typeof window === 'undefined') return
        const handleMove = (event: MouseEvent) => {
            const container = splitContainerRef.current
            if (!container) return
            const rect = container.getBoundingClientRect()
            if (rect.height <= 0) return
            const ratio = (event.clientY - rect.top) / rect.height
            setUpperRulesPanelRatio(Math.max(0.2, Math.min(0.75, ratio)))
        }
        const handleUp = () => {
            setIsSplitDragging(false)
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'row-resize'
        window.addEventListener('mousemove', handleMove)
        window.addEventListener('mouseup', handleUp)
        return () => {
            window.removeEventListener('mousemove', handleMove)
            window.removeEventListener('mouseup', handleUp)
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }
    }, [isSplitDragging])

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

    function handleSplitDragStart(event: any) {
        event.preventDefault()
        setIsSplitDragging(true)
    }

    useEffect(() => {
        if (open) {
            setRuleDialogOpen(false)
            setEditingRule(null)
            setPrefillRule(null)
            fetchDietTypes()
            if (program) {
                // Edit mode
                setName(program.name)
                setDescription(program.description || '')
                setTotalWeeks(program.total_weeks)
                setActivityLevel(program.default_activity_level)
                setIsActive(program.is_active)
                setWeekMappings(program.program_template_weeks || [])
                setRestrictions(program.program_template_restrictions || [])
                // Fetch program-specific rules
                fetchProgramRules(program.id!)
            } else {
                // New mode
                resetForm()
            }
        }
    }, [open, program, forcedMode])

    function resetForm() {
        setName('')
        setDescription('')
        setTotalWeeks(12)
        setActivityLevel(3)
        setIsActive(true)
        setWeekMappings([])
        setRestrictions([])
        setProgramRules([])
        setHasProgramRules(false)
        setGlobalRules([])
        setTeamRules([])
        setRulesTeamOwnerId(null)
        setRuleDialogOpen(false)
        setEditingRule(null)
        setPrefillRule(null)
    }

    async function fetchDietTypes() {
        const { data, error } = await supabase
            .from('diet_types')
            .select('*')
            .is('patient_id', null)
            .order('name')
        if (error) {
            console.error('Error fetching diet types:', error)
            setDietTypes([])
            return
        }

        let mergedDietTypes = (data || []).map((row: any) => ({
            ...row,
            base_diet_type_id: row.id,
            scope_source: 'global',
        }))

        try {
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null

            if (teamOwnerId) {
                mergedDietTypes = await applyTeamDietTypeOverrides(mergedDietTypes, teamOwnerId)
            }

            if (program?.id) {
                mergedDietTypes = await applyProgramDietTypeOverrides(mergedDietTypes, {
                    programTemplateId: program.id,
                    teamOwnerId,
                })
            }
        } catch (scopeError) {
            console.warn('Program dialog diet type scope merge skipped:', scopeError)
        }

        setDietTypes(mergedDietTypes)
    }

    async function resolveEffectiveScopeContext() {
        let baseCtx: {
            userId: string | null
            role: string | null
            canUseGlobal: boolean
            teamOwnerId: string | null
        } = {
            userId: null,
            role: null,
            canUseGlobal: true,
            teamOwnerId: null
        }

        try {
            baseCtx = await resolveTeamScopeContextFromAuth()
        } catch (scopeError) {
            console.warn('Team scope resolve failed, fallback to global context:', scopeError)
        }

        const canForceTeamModeForAdminDoctor =
            forcedMode === 'team' &&
            baseCtx.role === 'doctor' &&
            baseCtx.canUseGlobal &&
            !!baseCtx.userId

        const effectiveCanUseGlobal = canForceTeamModeForAdminDoctor ? false : baseCtx.canUseGlobal
        const effectiveTeamOwnerId = canForceTeamModeForAdminDoctor ? baseCtx.userId : baseCtx.teamOwnerId
        const isTeamScoped =
            (baseCtx.role === 'doctor' || baseCtx.role === 'dietitian') &&
            !effectiveCanUseGlobal &&
            !!effectiveTeamOwnerId

        return {
            ...baseCtx,
            canUseGlobal: effectiveCanUseGlobal,
            teamOwnerId: effectiveTeamOwnerId,
            isTeamScoped
        }
    }

    // â”€â”€â”€ Rules Fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const fetchProgramRules = useCallback(async (programId: string) => {
        setRulesLoading(true)
        try {
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null
            setRulesTeamOwnerId(teamOwnerId || null)

            // Fetch global rules
            const { data: gRules } = await supabase
                .from('planning_rules')
                .select('*')
                .or('scope.is.null,scope.eq.global')
                .order('sort_order', { ascending: true })
                .order('priority', { ascending: false })
            setGlobalRules(gRules || [])

            // Fetch team base rules (only for team-scoped mode)
            if (teamOwnerId) {
                const { data: tRules } = await supabase
                    .from('planning_rules')
                    .select('*')
                    .eq('scope', 'team')
                    .eq('team_owner_id', teamOwnerId)
                    .order('sort_order', { ascending: true })
                    .order('priority', { ascending: false })
                setTeamRules(tRules || [])
            } else {
                setTeamRules([])
            }

            // Fetch program-specific rules
            let programQuery = supabase
                .from('planning_rules')
                .select('*')
                .eq('scope', 'program')
                .eq('program_template_id', programId)

            if (teamOwnerId) {
                programQuery = programQuery.eq('team_owner_id', teamOwnerId)
            } else {
                programQuery = programQuery.is('team_owner_id', null)
            }

            const { data: pRules } = await programQuery
                .order('sort_order', { ascending: true })
                .order('priority', { ascending: false })

            setProgramRules(pRules || [])
            setHasProgramRules((pRules?.length || 0) > 0)
        } catch (e) {
            console.error("Error fetching program rules:", e)
        }
        setRulesLoading(false)
    }, [forcedMode])    // Toggle rule active state (creates override if inherited)
    async function handleToggleRuleActive(rule: PlanningRule) {
        setRulesLoading(true)
        try {
            if (rule.scope !== 'program') {
                // It's inherited. Insert a program-scoped override
                await supabase.from('planning_rules').insert({
                    name: rule.name,
                    description: rule.description,
                    rule_type: rule.rule_type,
                    priority: rule.priority,
                    is_active: !rule.is_active,
                    definition: rule.definition,
                    scope: 'program',
                    program_template_id: program!.id,
                    team_owner_id: rulesTeamOwnerId,
                    source_rule_id: rule.id,
                    sort_order: rule.sort_order
                })
            } else {
                await supabase
                    .from('planning_rules')
                    .update({ is_active: !rule.is_active })
                    .eq('id', rule.id)
            }
            if (program?.id) await fetchProgramRules(program.id)
        } catch (e: any) {
            console.error("Error toggling rule:", e)
        }
        setRulesLoading(false)
    }    // Delete single program rule (creates a tombstone if inherited/overridden)
    async function handleDeleteProgramRule(rule: PlanningRule) {
        if (!confirm(`"${rule.name}" kuralını silmek istediğinize emin misiniz?`)) return
        setRulesLoading(true)
        try {
            if (rule.scope !== 'program') {
                // Inherited: Insert a tombstone shadow record
                await supabase.from('planning_rules').insert({
                    name: rule.name,
                    description: rule.description,
                    rule_type: rule.rule_type,
                    priority: rule.priority,
                    is_active: false,
                    definition: { ...((rule.definition as any) || {}), _is_deleted: true },
                    scope: 'program',
                    program_template_id: program!.id,
                    team_owner_id: rulesTeamOwnerId,
                    source_rule_id: rule.id,
                    sort_order: rule.sort_order
                })
            } else if (rule.source_rule_id || (rule.scope === 'program' && allRules.some(r => r.id !== rule.id && (r.scope === 'global' || r.scope === 'team') && r.name === rule.name && r.rule_type === rule.rule_type))) {
                // Overridden (explicit or implicit): Update the existing program row to be a tombstone
                await supabase.from('planning_rules').update({
                    is_active: false,
                    definition: { ...((rule.definition as any) || {}), _is_deleted: true }
                }).eq('id', rule.id)
            } else {
                // Pure program rule: Actually delete it
                await supabase.from('planning_rules').delete().eq('id', rule.id)
            }
            if (program?.id) await fetchProgramRules(program.id)
        } catch (e: any) {
            console.error("Error deleting rule:", e)
        }
        setRulesLoading(false)
    }

    // Restore a deleted or overridden rule (removes the program-scoped row)
    async function handleRestoreOriginal(rule: PlanningRule) {
        if (!confirm(`"${rule.name}" kuralını orijinale (üst katmana) döndürmek istediğinize emin misiniz?`)) return
        setRulesLoading(true)
        try {
            await supabase
                .from('planning_rules')
                .delete()
                .eq('id', rule.id)
            if (program?.id) await fetchProgramRules(program.id)
        } catch (e: any) {
            console.error("Error restoring rule:", e)
        }
        setRulesLoading(false)
    }    // Sparse Override Merged Rules Calculation
    const allRules = [...globalRules, ...teamRules, ...programRules]
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
    
    globalRules.forEach(r => mergedRulesMap.set(getRootId(r, allRules), r))
    teamRules.forEach(r => mergedRulesMap.set(getRootId(r, allRules), r))
    programRules.forEach(r => mergedRulesMap.set(getRootId(r, allRules), r))
    
    const mergedRules = Array.from(mergedRulesMap.values())
        .filter(r => {
            const def = r.definition as any
            if (!showDeleted && def && def._is_deleted === true) return false
            return true
        })
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    const inheritedFromTeam = teamRules.length > 0
    const baseRules = mergedRules
    const inheritedRulesSourceLabel = inheritedFromTeam ? 'Takım' : 'Global'

    const getActiveScopeForRule = useCallback((rule: PlanningRule): RuleScopeKey => {
        if (rule.scope === 'patient' || rule.scope === 'program' || rule.scope === 'team' || rule.scope === 'global') {
            return rule.scope
        }
        if (hasProgramRules) return 'program'
        if (inheritedFromTeam) return 'team'
        return 'global'
    }, [hasProgramRules, inheritedFromTeam])

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

    const getResolvedRuleName = useCallback((rule: PlanningRule) => {
        const ownName = getRuleDisplayName(rule)
        if (!ownName.startsWith('[Adsız]')) return ownName

        const sourceId = rule.source_rule_id
        if (sourceId) {
            const sourceRule = [...programRules, ...teamRules, ...globalRules].find(r => r.id === sourceId)
            if (sourceRule) {
                const sourceName = (sourceRule.name || '').trim()
                if (sourceName.length > 0) return `${sourceName} (Kaynak)`
            }
        }

        return ownName
    }, [programRules, teamRules, globalRules])

    function openRuleDialogForNew(prefill?: PlanningRule | null) {
        setEditingRule(null)
        setPrefillRule(prefill || null)
        setRuleDialogOpen(true)
    }

    function openRuleDialogForEdit(rule: PlanningRule) {
        if (rule.scope !== 'program') {
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

    function handleExportProgramRules() {
        if (!program?.id) {
            alert("Önce programı kaydedin, ardından dışa aktarın.")
            return
        }

        const exportRules = programRules.filter((r) => !r.is_ignored)
        if (exportRules.length === 0) {
            alert("Bu programda dışa aktarılacak programa özel kural bulunmuyor.")
            return
        }

        const payload = {
            exported_at: new Date().toISOString(),
            program_id: program.id,
            program_name: program.name,
            scope: "program",
            rules_count: exportRules.length,
            rules: exportRules,
        }

        const json = JSON.stringify(payload, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `program_rules_${(program.name || 'program').replace(/[^a-z0-9-_]+/gi, '_')}.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    function handleImportProgramRulesClick() {
        if (!program?.id) {
            alert("Önce programı kaydedin, ardından kural yükleyin.")
            return
        }
        programRulesImportRef.current?.click()
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

    async function applyPendingProgramImport(importMode: 'replace' | 'merge') {
        if (!program?.id || !pendingImportedRules || pendingImportedRules.length === 0) return
        setImportModeDialogOpen(false)
        setRulesLoading(true)
        try {
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null

            let insertedCount = 0
            if (importMode === 'replace') {
                let deleteQuery = supabase
                    .from('planning_rules')
                    .delete()
                    .eq('scope', 'program')
                    .eq('program_template_id', program.id)

                if (teamOwnerId) deleteQuery = deleteQuery.eq('team_owner_id', teamOwnerId)
                else deleteQuery = deleteQuery.is('team_owner_id', null)

                const { error: deleteError } = await deleteQuery
                if (deleteError) throw deleteError

                const replacePayload = pendingImportedRules.map((r: any, i: number) => ({ ...r, sort_order: i }))
                const { error: insertError } = await supabase
                    .from('planning_rules')
                    .insert(replacePayload)
                if (insertError) throw insertError
                insertedCount = replacePayload.length
            } else {
                let existingQuery = supabase
                    .from('planning_rules')
                    .select('id,name,rule_type,definition,sort_order')
                    .eq('scope', 'program')
                    .eq('program_template_id', program.id)

                if (teamOwnerId) existingQuery = existingQuery.eq('team_owner_id', teamOwnerId)
                else existingQuery = existingQuery.is('team_owner_id', null)

                const { data: existingRows, error: existingError } = await existingQuery
                if (existingError) throw existingError

                const existing = existingRows || []
                const existingKeys = new Set(existing.map((r: any) => buildRuleUniqueKey(r)))
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

            await fetchProgramRules(program.id)
            if (importMode === 'replace') {
                alert(`${insertedCount} kural programa başarıyla yüklendi (değiştir modu).`)
            } else {
                alert(`${insertedCount} yeni/farklı kural eklendi (birleştir modu).`)
            }
        } catch (e: any) {
            console.error("Program rules import error:", e)
            alert("Kural yükleme hatası: " + (e?.message || "Geçersiz JSON dosyası"))
        } finally {
            setRulesLoading(false)
            setPendingImportedRules(null)
            setPendingImportFileName('')
        }
    }

    async function handleImportProgramRulesFromFile(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file || !program?.id) return

        try {
            const raw = await file.text()
            const parsed = JSON.parse(raw)
            const importedRules = Array.isArray(parsed?.rules) ? parsed.rules : (Array.isArray(parsed) ? parsed : [])

            if (!Array.isArray(importedRules) || importedRules.length === 0) {
                alert("Geçerli bir kural listesi bulunamadı.")
                return
            }

            const rulesToInsert = importedRules
                .filter((rule: any) => rule && String(rule?.name || '').trim().length > 0)
                .map((rule: any, index: number) => ({
                    name: String(rule.name || `İçe Aktarılan Kural ${index + 1}`),
                    description: rule.description ?? null,
                    rule_type: rule.rule_type || 'frequency',
                    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
                    is_active: rule.is_active !== false,
                    is_ignored: rule.is_ignored === true,
                    definition: rule.definition || { type: 'frequency', data: {} },
                    sort_order: Number.isFinite(Number(rule.sort_order)) ? Number(rule.sort_order) : index,
                    scope: 'program' as const,
                    program_template_id: program.id,
                    team_owner_id: null,
                    source_rule_id: null,
                    pending_global_approval: false,
                }))

            const uniqueMap = new Map<string, any>()
            rulesToInsert.forEach((rule: any) => {
                const key = buildRuleUniqueKey(rule)
                if (!uniqueMap.has(key)) uniqueMap.set(key, rule)
            })
            const dedupedImportedRules = Array.from(uniqueMap.values())

            if (dedupedImportedRules.length === 0) {
                alert("İçe aktarılacak geçerli kural bulunamadı.")
                return
            }
            setPendingImportedRules(dedupedImportedRules)
            setPendingImportFileName(file.name || 'rules.json')
            setImportModeDialogOpen(true)
        } catch (e: any) {
            console.error("Program rules import error:", e)
            alert("Kural yükleme hatası: " + (e?.message || "Geçersiz JSON dosyası"))
        } finally {
            if (event.target) event.target.value = ''
        }
    }

    async function handleOpenCopyDialog() {
        if (!program?.id) {
            alert("Önce programı kaydedin.")
            return
        }
        const sourceRules = programRules.filter((r) => !r.is_ignored)
        if (sourceRules.length === 0) {
            alert("Kopyalanacak programa özel kural bulunmuyor.")
            return
        }

        setCopyTargetsLoading(true)
        try {
            const { data, error } = await supabase
                .from('program_templates')
                .select('id,name')
                .neq('id', program.id)
                .order('name', { ascending: true })

            if (error) throw error
            const programs = (data || []) as Array<{ id: string, name: string }>
            setCopyTargetPrograms(programs)
            setCopyTargetProgramId(programs[0]?.id || '')
            setCopyDialogOpen(true)
        } catch (e: any) {
            console.error("Program copy target fetch error:", e)
            alert("Hedef programlar yüklenemedi: " + (e?.message || "Bilinmeyen hata"))
        } finally {
            setCopyTargetsLoading(false)
        }
    }

    async function applyCopyToProgram(copyMode: 'replace' | 'merge') {
        if (!program?.id) return
        if (!copyTargetProgramId) {
            alert("Lütfen hedef program seçin.")
            return
        }

        const sourceRules = programRules
            .filter((r) => !r.is_ignored)
            .map((rule, index) => ({
                name: String(rule.name || `Kopyalanan Kural ${index + 1}`),
                description: rule.description ?? null,
                rule_type: rule.rule_type || 'frequency',
                priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0,
                is_active: rule.is_active !== false,
                is_ignored: rule.is_ignored === true,
                definition: rule.definition || { type: 'frequency', data: {} },
                sort_order: Number.isFinite(Number(rule.sort_order)) ? Number(rule.sort_order) : index,
                scope: 'program' as const,
                program_template_id: copyTargetProgramId,
                team_owner_id: null,
                source_rule_id: null,
                pending_global_approval: false,
            }))

        if (sourceRules.length === 0) {
            alert("Kopyalanacak programa özel kural bulunmuyor.")
            return
        }

        setCopyDialogOpen(false)
        setRulesLoading(true)
        try {
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null
            let insertedCount = 0

            if (copyMode === 'replace') {
                let deleteQuery = supabase
                    .from('planning_rules')
                    .delete()
                    .eq('scope', 'program')
                    .eq('program_template_id', copyTargetProgramId)

                if (teamOwnerId) deleteQuery = deleteQuery.eq('team_owner_id', teamOwnerId)
                else deleteQuery = deleteQuery.is('team_owner_id', null)

                const { error: deleteError } = await deleteQuery
                if (deleteError) throw deleteError

                const replacePayload = sourceRules.map((r, i) => ({
                    ...r,
                    sort_order: i,
                    team_owner_id: teamOwnerId
                }))
                const { error: insertError } = await supabase
                    .from('planning_rules')
                    .insert(replacePayload)
                if (insertError) throw insertError
                insertedCount = replacePayload.length
            } else {
                let existingQuery = supabase
                    .from('planning_rules')
                    .select('id,name,rule_type,definition,sort_order')
                    .eq('scope', 'program')
                    .eq('program_template_id', copyTargetProgramId)

                if (teamOwnerId) existingQuery = existingQuery.eq('team_owner_id', teamOwnerId)
                else existingQuery = existingQuery.is('team_owner_id', null)

                const { data: existingRows, error: existingError } = await existingQuery
                if (existingError) throw existingError

                const existing = existingRows || []
                const existingKeys = new Set(existing.map((r: any) => buildRuleUniqueKey(r)))
                const currentMaxSort = existing.reduce((max: number, r: any) => {
                    const v = Number(r?.sort_order)
                    return Number.isFinite(v) ? Math.max(max, v) : max
                }, -1)

                const mergePayload = sourceRules
                    .filter((r) => !existingKeys.has(buildRuleUniqueKey(r)))
                    .map((r, i) => ({
                        ...r,
                        sort_order: currentMaxSort + i + 1,
                        team_owner_id: teamOwnerId
                    }))

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
                    ? `${insertedCount} kural hedef programa kopyalandı (değiştir modu).`
                    : `${insertedCount} yeni/farklı kural hedef programa eklendi (birleştir modu).`
            )
        } catch (e: any) {
            console.error("Program rules copy error:", e)
            alert("Kural kopyalama hatası: " + (e?.message || "Bilinmeyen hata"))
        } finally {
            setRulesLoading(false)
        }
    }

    const displayRules = mergedRules.filter(r => !r.is_ignored)

    // â”€â”€â”€ Week Mapping Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function addWeekMapping() {
        const lastWeek = weekMappings.length > 0
            ? Math.max(...weekMappings.map(w => w.week_end))
            : 0
        const newStart = lastWeek + 1
        const newEnd = Math.min(newStart + 1, totalWeeks)

        if (newStart <= totalWeeks) {
            setWeekMappings([...weekMappings, {
                week_start: newStart,
                week_end: newEnd,
                diet_type_id: dietTypes[0]?.id || null,
                notes: null
            }])
        }
    }

    function updateWeekMapping(index: number, field: keyof ProgramTemplateWeek, value: any) {
        const updated = [...weekMappings]
        updated[index] = { ...updated[index], [field]: value }
        setWeekMappings(updated)
    }

    function removeWeekMapping(index: number) {
        setWeekMappings(weekMappings.filter((_, i) => i !== index))
    }

    // â”€â”€â”€ Restriction Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function addRestriction() {
        if (!newRestrictionValue.trim()) return

        setRestrictions([...restrictions, {
            restriction_type: newRestrictionType,
            restriction_value: newRestrictionValue.trim(),
            reason: null,
            severity: newRestrictionSeverity
        }])
        setNewRestrictionValue('')
    }

    function removeRestriction(index: number) {
        setRestrictions(restrictions.filter((_, i) => i !== index))
    }

    // â”€â”€â”€ Save Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function handleSave() {
        if (!name.trim()) {
            alert('Program adı zorunludur')
            return
        }

        setSaving(true)

        try {
            let programId = program?.id
            let teamOverrideId: string | null = null
            let saveMode: 'global' | 'team' = 'global'

            let scopeCtx: {
                userId: string | null
                role: string | null
                canUseGlobal: boolean
                teamOwnerId: string | null
            } | null = null

            try {
                scopeCtx = await resolveTeamScopeContextFromAuth()
            } catch (scopeError) {
                console.warn('Team scope resolve failed in program save, fallback to global mode:', scopeError)
            }

            const resolvedScopeCtx = scopeCtx || {
                userId: null,
                role: null,
                canUseGlobal: true,
                teamOwnerId: null
            }

            const canForceTeamModeForAdminDoctor =
                forcedMode === 'team' &&
                resolvedScopeCtx.role === 'doctor' &&
                resolvedScopeCtx.canUseGlobal &&
                !!resolvedScopeCtx.userId

            const effectiveCanUseGlobal = canForceTeamModeForAdminDoctor ? false : resolvedScopeCtx.canUseGlobal
            const effectiveTeamOwnerId = canForceTeamModeForAdminDoctor
                ? resolvedScopeCtx.userId
                : resolvedScopeCtx.teamOwnerId

            const isTeamScopedUser =
                (resolvedScopeCtx.role === 'doctor' || resolvedScopeCtx.role === 'dietitian') &&
                !effectiveCanUseGlobal &&
                !!effectiveTeamOwnerId

const saveResult = await adminSaveProgramTemplateAction({
                programId,
                name: name.trim(),
                description: description.trim() || null,
                totalWeeks,
                activityLevel,
                isActive,
                weekMappings,
                restrictions,
                saveMode,
                effectiveTeamOwnerId,
                userId: resolvedScopeCtx.userId
            });

            if (saveResult.error) throw new Error(saveResult.error);
            onClose();
            onClose()
        } catch (error) {
            console.error('Error saving program:', error)
            alert('Program kaydedilirken hata oluştu')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
            <DialogContent
                className="!max-w-none !translate-x-0 !translate-y-0 p-0 flex flex-col overflow-hidden"
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
                <DialogHeader
                    onMouseDown={handleDialogDragStart}
                    className="shrink-0 px-6 pt-6 pb-3 border-b bg-white cursor-move"
                >
                    <DialogTitle>
                        {program ? 'Programı Düzenle' : 'Yeni Program Oluştur'}
                    </DialogTitle>
                    <DialogDescription>
                        Program detaylarını ve haftalık planlamayı buradan yönetebilirsiniz.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="general" className="px-6 pt-4 flex flex-col flex-1 overflow-hidden">
                    <TabsList className="flex flex-wrap w-full gap-2 p-1 bg-slate-100 rounded-lg shrink-0 select-auto">
                        <TabsTrigger value="general" className="flex-1 min-w-[100px]">Genel</TabsTrigger>
                        <TabsTrigger value="weeks" className="flex-1 min-w-[100px]">
                            <Calendar size={14} className="mr-1 inline" />
                            Hafta Planı
                        </TabsTrigger>
                        <TabsTrigger value="restrictions" className="flex-1 min-w-[100px]">
                            <Ban size={14} className="mr-1 inline" />
                            Yasaklar
                        </TabsTrigger>
                        <TabsTrigger value="rules" className="flex-1 min-w-[100px]">
                            <BookOpen size={14} className="mr-1 inline" />
                            Kurallar
                        </TabsTrigger>
                        <TabsTrigger value="diet-types" className="flex-1 min-w-[120px]">
                            <UtensilsCrossed size={14} className="mr-1 inline" />
                            Diyet Türleri
                        </TabsTrigger>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                if (!program?.id) {
                                    alert("Önce programı kaydedin, ardından gelişmiş ayarları düzenleyebilirsiniz.");
                                    return;
                                }
                                setSettingsOpen(true);
                            }}
                            className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all flex-1 min-w-[100px] bg-blue-50/50 text-blue-700 hover:bg-blue-100"
                        >
                            <Settings size={14} className="mr-1 inline" />
                            Gelişmiş Ayarlar
                        </button>
                    </TabsList>

                    {/* General Tab */}
                    <TabsContent value="general" className="space-y-4 mt-4 overflow-y-auto pr-2 pb-2">
                        <div className="grid gap-4">
                            <div>
                                <Label htmlFor="name">Program Adı *</Label>
                                <Input
                                    id="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Örn: Lipödem Beslenmesi"
                                />
                            </div>

                            <div>
                                <Label htmlFor="description">Açıklama</Label>
                                <Textarea
                                    id="description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Program hakkında kısa açıklama..."
                                    rows={2}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="totalWeeks">Toplam Hafta</Label>
                                    <Input
                                        id="totalWeeks"
                                        type="number"
                                        min={1}
                                        max={52}
                                        value={totalWeeks}
                                        onChange={(e) => setTotalWeeks(parseInt(e.target.value) || 12)}
                                    />
                                </div>

                                <div>
                                    <Label htmlFor="activityLevel">Varsayılan Aktivite Düzeyi</Label>
                                    <Select
                                        value={activityLevel.toString()}
                                        onValueChange={(v) => setActivityLevel(parseInt(v))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="1">1 - Çok Düşük</SelectItem>
                                            <SelectItem value="2">2 - Düşük</SelectItem>
                                            <SelectItem value="3">3 - Orta</SelectItem>
                                            <SelectItem value="4">4 - Yüksek</SelectItem>
                                            <SelectItem value="5">5 - Çok Yüksek</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="isActive"
                                    checked={isActive}
                                    onCheckedChange={(checked) => setIsActive(checked as boolean)}
                                />
                                <Label htmlFor="isActive" className="cursor-pointer">
                                    Aktif (hasta atamalarında görünsün)
                                </Label>
                            </div>
                        </div>
                    </TabsContent>

                    {/* Diet Types Tab */}
                    <TabsContent value="diet-types" className="space-y-4 mt-4 overflow-y-auto pr-2 pb-2">
                        {!program?.id ? (
                            <div className="text-center py-8 text-amber-600 bg-amber-50 border-2 border-dashed border-amber-200 rounded-lg">
                                <AlertTriangle className="mx-auto mb-2" size={24} />
                                <p className="text-sm font-medium">Önce programı kaydedin, ardından diyet türü override düzenleyin.</p>
                            </div>
                        ) : (
                            <div className="rounded-lg border p-3">
                                <DietTypesEditor
                                    dietTypes={dietTypes}
                                    programTemplateId={program.id}
                                    forcedMode={forcedMode}
                                    onUpdate={fetchDietTypes}
                                />
                            </div>
                        )}
                    </TabsContent>

                    {/* Weeks Tab */}
                    <TabsContent value="weeks" className="space-y-4 mt-4 overflow-y-auto pr-2 pb-2">
                        <div className="flex justify-between items-center">
                            <p className="text-sm text-gray-500">
                                Her hafta aralığı için diyet türü belirleyin
                            </p>
                            <Button variant="outline" size="sm" onClick={addWeekMapping}>
                                <Plus size={14} className="mr-1" />
                                Aralık Ekle
                            </Button>
                        </div>

                        {weekMappings.length === 0 ? (
                            <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                                Henüz hafta aralığı eklenmemiş
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {weekMappings.map((week, index) => (
                                    <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                                        <span className="text-sm text-gray-500 w-16">Hafta</span>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={totalWeeks}
                                            value={week.week_start}
                                            onChange={(e) => updateWeekMapping(index, 'week_start', parseInt(e.target.value) || 1)}
                                            className="w-16"
                                        />
                                        <span className="text-gray-400">-</span>
                                        <Input
                                            type="number"
                                            min={week.week_start}
                                            max={totalWeeks}
                                            value={week.week_end}
                                            onChange={(e) => updateWeekMapping(index, 'week_end', parseInt(e.target.value) || week.week_start)}
                                            className="w-16"
                                        />
                                        <span className="text-gray-400">:</span>
                                        <Select
                                            value={week.diet_type_id || ''}
                                            onValueChange={(v) => updateWeekMapping(index, 'diet_type_id', v || null)}
                                        >
                                            <SelectTrigger className="flex-1">
                                                <SelectValue placeholder="Diyet türü seçin" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {dietTypes.map(dt => (
                                                    <SelectItem key={dt.id} value={dt.id}>
                                                        {dt.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => removeWeekMapping(index)}
                                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                        >
                                            <Trash2 size={14} />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    {/* Restrictions Tab */}
                    <TabsContent value="restrictions" className="space-y-4 mt-4 overflow-y-auto pr-2 pb-2">
                        <div className="flex justify-between items-center mb-4">
                            <p className="text-sm text-gray-500">
                                Bu programda yasaklanacak yemek anahtar kelimeleri veya etiketleri
                            </p>
                            {program?.id && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={restrictions.length === 0}
                                    onClick={async () => {
                                        if (confirm("Tüm program yasaklarını temizleyip global yasaklara dönmek istediğinize emin misiniz?")) {
                                            setRestrictions([])
                                        }
                                    }}
                                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                                    title={restrictions.length === 0 ? "Program katmaninda yasak ozellestirmesi yok" : "Program yasaklarini temizleyip global mirasa don"}
                                >
                                    <RotateCcw size={14} className="mr-1" /> Temizle (Global'e Dön)
                                </Button>
                            )}
                        </div>

                        {/* Add new restriction */}
                        <div className="flex gap-2 p-3 bg-blue-50 rounded-lg">
                            <Select
                                value={newRestrictionType}
                                onValueChange={(v) => setNewRestrictionType(v as 'keyword' | 'tag')}
                            >
                                <SelectTrigger className="w-32">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="keyword">Yemek İsminde Geçen Kelime</SelectItem>
                                    <SelectItem value="tag">Etiket (Tag)</SelectItem>
                                </SelectContent>
                            </Select>
                            <Input
                                placeholder={newRestrictionType === 'keyword' ? 'İsimde geçen kelime (örn: şeker, ekmek)' : 'Veritabanı etiketi (örn: gluten, laktoz)'}
                                value={newRestrictionValue}
                                onChange={(e) => setNewRestrictionValue(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && addRestriction()}
                                className="flex-1"
                            />
                            <Select
                                value={newRestrictionSeverity}
                                onValueChange={(v) => setNewRestrictionSeverity(v as 'warn' | 'block')}
                            >
                                <SelectTrigger className="w-28">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                        <SelectItem value="warn">Uyarı</SelectItem>
                                        <SelectItem value="block">Engelle</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button onClick={addRestriction} disabled={!newRestrictionValue.trim()}>
                                <Plus size={14} />
                            </Button>
                        </div>

                        {/* Restrictions list */}
                        {restrictions.length === 0 ? (
                            <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                                Henüz yasak eklenmemiş
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {restrictions.map((r, index) => (
                                    <Badge
                                        key={index}
                                        variant={r.severity === 'block' ? 'destructive' : 'secondary'}
                                        className="flex items-center gap-1 px-3 py-1"
                                    >
                                                            {r.severity === 'block' ? 'Engel' : 'Uyarı'}
                                        <span className="text-xs opacity-70">{r.restriction_type === 'keyword' ? 'Kelime:' : 'Tag:'}</span>
                                        {r.restriction_value}
                                        <button
                                            onClick={() => removeRestriction(index)}
                                            className="ml-1 hover:text-red-500"
                                        >
                                            ×
                                        </button>
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </TabsContent>

                    {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• NEW: Rules Tab â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                    <TabsContent value="rules" className="space-y-4 mt-4 flex-1 min-h-0 flex flex-col overflow-hidden">
                        {!program?.id ? (
                            <div className="text-center py-8 text-slate-500">
                                Kuralları yönetmek için önce programı kaydedin.
                            </div>
                        ) : rulesLoading && displayRules.length === 0 ? (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                            </div>
                        ) : (
                            <>
                                <p className="text-xs text-slate-500 mb-3">
                                    {`${inheritedRulesSourceLabel} katmanından gelen kurallar ve bu programa özel kurallar birlikte görüntüleniyor. Düzenlenen her kural programa özel olarak kaydedilir.`}
                                </p>

                                <>
                                    {displayRules.length === 0 ? (
                                        <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                                            Henüz kural tanımlanmamış.
                                        </div>
                                    ) : (
                                        <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-2 pb-2">
                                            {displayRules.map((rule, index) => {
                                                const isOverriddenOrProgram = rule.scope === 'program'
                                                const isDeleted = (rule.definition as any)?._is_deleted
                                                
                                                return (
                                                <div
                                                    key={rule.id}
                                                    className={`border rounded-lg p-2.5 shadow-sm transition-all ${rule.is_active ? 'bg-white' : 'bg-slate-50 opacity-60'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex-1 min-w-0">
                                                            <span className="font-semibold text-sm text-slate-900 block truncate">
                                                                {getResolvedRuleName(rule)}
                                                            </span>
                                                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                                                                <Badge variant="outline" className={`text-[10px] shrink-0 font-normal ${getScopeBadgeClass(getActiveScopeForRule(rule))}`}>
                                                                    {getScopeLabel(getActiveScopeForRule(rule))}
                                                                </Badge>
                                                                <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                                                                    {getRuleTypeLabel(rule.rule_type)}
                                                                </Badge>
                                                                {getInheritanceChain(rule).length > 1 && (
                                                                    <Badge variant="outline" className={`text-[10px] shrink-0 font-normal text-muted-foreground opacity-80 border-dashed`}>
                                                                        Kaynak: {getInheritanceChain(rule).map(s => getScopeLabel(s)).join(' → ')}
                                                                    </Badge>
                                                                )}
{getInheritanceChain(rule).length > 1 && getInheritanceChain(rule)[getInheritanceChain(rule).length - 1] === rule.scope && (
                                                                    <Badge variant="secondary" className="text-[10px] shrink-0 font-normal bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400">
                                                                        Özelleştirilmiş
                                                                    </Badge>
                                                                )}
                                                                {isOverriddenOrProgram && rule.source_rule_id && (
                                                                    <Badge variant="secondary" className="text-[10px] shrink-0 font-normal">Özelleştirilmiş</Badge>
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-slate-500 mt-0.5 truncate">{getRuleDisplayDescription(rule)}</p>
                                                            <p className="text-[11px] text-slate-400 mt-1">
                                                                Sıra #{(rule.sort_order ?? (index + 1))} • Öncelik {rule.priority ?? 0}
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <Switch
                                                                checked={rule.is_active}
                                                                onCheckedChange={() => handleToggleRuleActive(rule)}
                                                                className="scale-75"
                                                            />
                                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-blue-600"
                                                                onClick={() => openRuleDialogForEdit(rule)}>
                                                                <Pencil size={12} />
                                                            </Button>
                                                            {isOverriddenOrProgram && rule.source_rule_id ? (
                                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-orange-400 hover:text-orange-600 hover:bg-orange-50"
                                                                    onClick={() => handleRestoreOriginal(rule)} title="Orijinale Dön (Özelleştirmeyi Kaldır)">
                                                                    <RotateCcw size={12} />
                                                                </Button>
                                                            ) : (
                                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-red-600"
                                                                    onClick={() => handleDeleteProgramRule(rule)}>
                                                                    <Trash2 size={12} />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )})}
                                        </div>
                                    )}
                                </>

                                {/* Footer Actions */}
                                <div className="flex gap-2 justify-end pt-2 border-t shrink-0">
                                    <Button variant="outline" onClick={() => openRuleDialogForNew()}>
                                        <Plus size={14} className="mr-1" /> Yeni Kural Ekle
                                    </Button>
                                </div>
                            </>
                        )}
                    </TabsContent>
                </Tabs>

                <RuleDialog
                    open={ruleDialogOpen}
                    onOpenChange={handleRuleDialogOpenChange}
                    initialData={editingRule}
                    prefillData={prefillRule}
                    onSuccess={async () => {
                        if (program?.id) await fetchProgramRules(program.id)
                    }}
                    programTemplateId={program?.id || null}
                    teamOwnerId={rulesTeamOwnerId}
                />

                <input
                    ref={programRulesImportRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportProgramRulesFromFile}
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
                                <Badge variant="outline" className="text-slate-600">Program Kuralları</Badge>
                            </div>
                            <button
                                type="button"
                                className="w-full rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white px-4 py-3 text-left hover:from-orange-100 hover:to-orange-50 transition-colors"
                                onClick={() => applyPendingProgramImport('replace')}
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
                                        <div className="text-xs text-orange-700 mt-1">Mevcut program kurallarını siler, JSON içeriğini aynen uygular.</div>
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                className="w-full rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-4 py-3 text-left hover:from-blue-100 hover:to-blue-50 transition-colors"
                                onClick={() => applyPendingProgramImport('merge')}
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
                            <DialogTitle>Başka Programa Kopyala</DialogTitle>
                            <DialogDescription>
                                Mevcut programa özel kuralları hedef programa uygulama yöntemini seçin.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3 pt-1">
                            <div className="flex items-center gap-2">
                                <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">Kuralları Kopyala</Badge>
                                <Badge variant="outline" className="text-slate-600">Program → Program</Badge>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-slate-500">Hedef Program</Label>
                                <Select value={copyTargetProgramId} onValueChange={setCopyTargetProgramId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Program seçin" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {copyTargetPrograms.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>
                                                {p.name || 'İsimsiz program'}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <button
                                type="button"
                                className="w-full rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white px-4 py-3 text-left hover:from-orange-100 hover:to-orange-50 transition-colors disabled:opacity-50"
                                disabled={!copyTargetProgramId}
                                onClick={() => applyCopyToProgram('replace')}
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
                                        <div className="text-xs text-orange-700 mt-1">Hedef programın mevcut kurallarını siler, bu programın kurallarını aynen uygular.</div>
                                    </div>
                                </div>
                            </button>
                            <button
                                type="button"
                                className="w-full rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-4 py-3 text-left hover:from-blue-100 hover:to-blue-50 transition-colors disabled:opacity-50"
                                disabled={!copyTargetProgramId}
                                onClick={() => applyCopyToProgram('merge')}
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

                <SettingsDialog
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                    programTemplateId={program?.id}
                    defaultTab="scores"
                    forcedMode={forcedMode}
                />

                <DialogFooter className="mt-4 shrink-0 px-6 pt-4 pb-5 border-t">
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        İptal
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? 'Kaydediliyor...' : 'Kaydet'}
                    </Button>
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
    )
}


