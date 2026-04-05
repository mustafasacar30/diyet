'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
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
import { Plus, Trash2, Calendar, Ban, AlertTriangle, BookOpen, UtensilsCrossed, Pencil, RotateCcw, Download, Loader2, Upload, Settings } from 'lucide-react'
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

export default function ProgramDialog({ open, onClose, program, forcedMode }: ProgramDialogProps) {
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
    const [globalRules, setGlobalRules] = useState<PlanningRule[]>([])
    const [teamRules, setTeamRules] = useState<PlanningRule[]>([])
    const [programRules, setProgramRules] = useState<PlanningRule[]>([])
    const [hasProgramRules, setHasProgramRules] = useState(false)
    const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
    const [editingRule, setEditingRule] = useState<PlanningRule | null>(null)
    const [rulesTeamOwnerId, setRulesTeamOwnerId] = useState<string | null>(null)

    // â”€â”€â”€ General Settings Tab State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const [settingsOpen, setSettingsOpen] = useState(false)

    useEffect(() => {
        if (open) {
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
                .order('priority', { ascending: false })
            setGlobalRules(gRules || [])

            // Fetch team base rules (only for team-scoped mode)
            if (teamOwnerId) {
                const { data: tRules } = await supabase
                    .from('planning_rules')
                    .select('*')
                    .eq('scope', 'team')
                    .eq('team_owner_id', teamOwnerId)
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
                .order('priority', { ascending: false })

            setProgramRules(pRules || [])
            setHasProgramRules((pRules?.length || 0) > 0)
        } catch (e) {
            console.error("Error fetching program rules:", e)
        }
        setRulesLoading(false)
    }, [forcedMode])

    // Clone inherited base rules (team if exists, otherwise global) â†’ program scope
    async function handleCloneGlobalRules(programId: string) {
        if (!programId) return
        setRulesLoading(true)
        try {
            const baseRules = teamRules.length > 0 ? teamRules : globalRules
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null

            const rulesToInsert = baseRules.map(rule => ({
                name: rule.name,
                description: rule.description,
                rule_type: rule.rule_type,
                priority: rule.priority,
                is_active: rule.is_active,
                definition: rule.definition,
                scope: 'program',
                program_template_id: programId,
                team_owner_id: teamOwnerId,
                source_rule_id: rule.id
            }))
            const { error } = await supabase.from('planning_rules').insert(rulesToInsert)
            if (error) throw error
            await fetchProgramRules(programId)
        } catch (e: any) {
            console.error("Error cloning rules:", e)
            alert("Kurallar kopyalanamadı: " + e.message)
        }
        setRulesLoading(false)
    }

    // Revert to parent inherited layer (team/global) by deleting program rules.
    async function handleRevertRules(programId: string) {
        const parentLabel = teamRules.length > 0 ? 'takım kurallarına' : 'global kurallara'
        if (!confirm(`Tüm program kuralları silinecek ve ${parentLabel} dönülecek. Emin misiniz?`)) return
        setRulesLoading(true)
        try {
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null

            let deleteQuery = supabase
                .from('planning_rules')
                .delete()
                .eq('scope', 'program')
                .eq('program_template_id', programId)

            if (teamOwnerId) {
                deleteQuery = deleteQuery.eq('team_owner_id', teamOwnerId)
            } else {
                deleteQuery = deleteQuery.is('team_owner_id', null)
            }

            const { error } = await deleteQuery
            if (error) throw error
            await fetchProgramRules(programId)
        } catch (e: any) {
            console.error("Error reverting rules:", e)
            alert("Hata: " + e.message)
        }
        setRulesLoading(false)
    }

    // Toggle rule active state
    async function handleToggleRuleActive(rule: PlanningRule) {
        const { error } = await supabase
            .from('planning_rules')
            .update({ is_active: !rule.is_active })
            .eq('id', rule.id)
        if (!error && program?.id) await fetchProgramRules(program.id)
    }

    // Delete single program rule
    async function handleDeleteProgramRule(rule: PlanningRule) {
        if (!confirm(`"${rule.name}" kuralını silmek istediğinize emin misiniz?`)) return
        const { error } = await supabase
            .from('planning_rules')
            .delete()
            .eq('id', rule.id)
        if (!error && program?.id) await fetchProgramRules(program.id)
    }

    // New inherited rules (team if available, otherwise global) not yet in program
    const inheritedFromTeam = teamRules.length > 0
    const baseRules = inheritedFromTeam ? teamRules : globalRules
    const inheritedRulesSourceLabel = inheritedFromTeam ? 'Takım' : 'Global'

    const newGlobalRules = baseRules.filter(g =>
        !programRules.some(p => p.source_rule_id === g.id || p.id === g.id)
    )

    // Add single inherited rule to program
    async function handleAddGlobalRuleToProgram(globalRule: PlanningRule) {
        if (!program?.id) return
        setRulesLoading(true)
        try {
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null

            const { error } = await supabase.from('planning_rules').insert({
                name: globalRule.name,
                description: globalRule.description,
                rule_type: globalRule.rule_type,
                priority: globalRule.priority,
                is_active: globalRule.is_active,
                definition: globalRule.definition,
                scope: 'program',
                program_template_id: program.id,
                team_owner_id: teamOwnerId,
                source_rule_id: globalRule.id
            })
            if (error) throw error
            await fetchProgramRules(program.id)
        } catch (e: any) {
            alert("Hata: " + e.message)
        }
        setRulesLoading(false)
    }

    // Add all new global rules
    async function handleAddAllNewGlobalRules() {
        if (!program?.id) return
        setRulesLoading(true)
        try {
            const scopeCtx = await resolveEffectiveScopeContext()
            const teamOwnerId = scopeCtx.isTeamScoped ? scopeCtx.teamOwnerId : null

            const rulesToInsert = newGlobalRules.map(rule => ({
                name: rule.name,
                description: rule.description,
                rule_type: rule.rule_type,
                priority: rule.priority,
                is_active: rule.is_active,
                definition: rule.definition,
                scope: 'program',
                program_template_id: program.id,
                team_owner_id: teamOwnerId,
                source_rule_id: rule.id
            }))
            const { error } = await supabase.from('planning_rules').insert(rulesToInsert)
            if (error) throw error
            await fetchProgramRules(program.id)
        } catch (e: any) {
            alert("Hata: " + e.message)
        }
        setRulesLoading(false)
    }

    const displayRules = hasProgramRules
        ? programRules.filter(r => !r.is_ignored)
        : baseRules

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

            if (programId) {
                if (isTeamScopedUser && effectiveTeamOwnerId && resolvedScopeCtx.userId) {
                    saveMode = 'team'

                    const { data: overrideRow, error: overrideError } = await supabase
                        .from('team_program_overrides')
                        .upsert(
                            {
                                team_owner_id: effectiveTeamOwnerId,
                                program_template_id: programId,
                                name: name.trim(),
                                description: description.trim() || null,
                                total_weeks: totalWeeks,
                                default_activity_level: activityLevel,
                                is_active: isActive,
                                created_by: resolvedScopeCtx.userId,
                            },
                            { onConflict: 'team_owner_id,program_template_id' }
                        )
                        .select('id')
                        .single()

                    if (overrideError) throw overrideError
                    teamOverrideId = overrideRow.id

                    await supabase.from('team_program_override_weeks').delete().eq('override_id', teamOverrideId)
                    await supabase.from('team_program_override_restrictions').delete().eq('override_id', teamOverrideId)
                } else {
                    const { error } = await supabase
                        .from('program_templates')
                        .update({
                            name: name.trim(),
                            description: description.trim() || null,
                            total_weeks: totalWeeks,
                            default_activity_level: activityLevel,
                            is_active: isActive,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', programId)

                    if (error) throw error

                    await supabase.from('program_template_weeks').delete().eq('program_template_id', programId)
                    await supabase.from('program_template_restrictions').delete().eq('program_template_id', programId)
                }
            } else {
                if (isTeamScopedUser) {
                    alert('Takım modunda yeni global program olusturamazsiniz. Mevcut bir programi Takıma Ozel Hale Getir ile ozellestirin.')
                    return
                }

                const { data, error } = await supabase
                    .from('program_templates')
                    .insert({
                        name: name.trim(),
                        description: description.trim() || null,
                        total_weeks: totalWeeks,
                        default_activity_level: activityLevel,
                        is_active: isActive
                    })
                    .select()
                    .single()

                if (error) throw error
                programId = data.id
            }

            // Insert week mappings
            if (weekMappings.length > 0) {
                if (saveMode === 'team' && teamOverrideId) {
                    const weeksToInsert = weekMappings.map(w => ({
                        override_id: teamOverrideId,
                        week_start: w.week_start,
                        week_end: w.week_end,
                        diet_type_id: w.diet_type_id,
                        notes: w.notes
                    }))
                    const { error } = await supabase.from('team_program_override_weeks').insert(weeksToInsert)
                    if (error) throw error
                } else {
                    const weeksToInsert = weekMappings.map(w => ({
                        program_template_id: programId,
                        week_start: w.week_start,
                        week_end: w.week_end,
                        diet_type_id: w.diet_type_id,
                        notes: w.notes
                    }))
                    const { error } = await supabase.from('program_template_weeks').insert(weeksToInsert)
                    if (error) throw error
                }
            }

            // Insert restrictions
            if (restrictions.length > 0) {
                if (saveMode === 'team' && teamOverrideId) {
                    const restrictionsToInsert = restrictions.map(r => ({
                        override_id: teamOverrideId,
                        restriction_type: r.restriction_type,
                        restriction_value: r.restriction_value,
                        reason: r.reason,
                        severity: r.severity
                    }))
                    const { error } = await supabase.from('team_program_override_restrictions').insert(restrictionsToInsert)
                    if (error) throw error
                } else {
                    const restrictionsToInsert = restrictions.map(r => ({
                        program_template_id: programId,
                        restriction_type: r.restriction_type,
                        restriction_value: r.restriction_value,
                        reason: r.reason,
                        severity: r.severity
                    }))
                    const { error } = await supabase.from('program_template_restrictions').insert(restrictionsToInsert)
                    if (error) throw error
                }
            }

            onClose()
        } catch (error) {
            console.error('Error saving program:', error)
            alert('Program kaydedilirken hata oluştu')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl min-h-[600px] max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle>
                        {program ? 'Programı Düzenle' : 'Yeni Program Oluştur'}
                    </DialogTitle>
                    <DialogDescription>
                        Program detaylarını ve haftalık planlamayı buradan yönetebilirsiniz.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="general" className="mt-4 flex flex-col flex-1 overflow-hidden">
                    <TabsList className="flex flex-wrap w-full gap-2 p-1 bg-slate-100 rounded-lg shrink-0">
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
                    <TabsContent value="rules" className="space-y-4 mt-4 flex flex-col overflow-hidden">
                        {!program?.id ? (
                            <div className="text-center py-8 text-amber-600 bg-amber-50 border-2 border-dashed border-amber-200 rounded-lg">
                                <AlertTriangle className="mx-auto mb-2" size={24} />
                                <p className="text-sm font-medium">Önce programı kaydedin, ardından kurallarını düzenleyebilirsiniz.</p>
                            </div>
                        ) : rulesLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="animate-spin" />
                            </div>
                        ) : (
                            <>
                                {/* Header badge */}
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-sm font-medium text-slate-700">Planlama Kuralları</span>
                                    {hasProgramRules ? (
                                        <Badge variant="default" className="bg-purple-600">🏷️ Programa Özel</Badge>
                                    ) : (
                                        <Badge variant="secondary">🌐 {inheritedRulesSourceLabel} (miras)</Badge>
                                    )}
                                </div>
                                <p className="text-xs text-slate-500 mb-3">
                                    {hasProgramRules
                                        ? "Bu programa özel kurallar aktif. Değişiklikler sadece bu programı ve atanan hastaları etkiler."
                                        : `${inheritedRulesSourceLabel} kuralları görüntüleniyor. Özelleştirmek için \"Programa Kopyala\" butonuna basın.`
                                    }
                                </p>

                                {/* New global rules that can be added */}
                                {hasProgramRules && newGlobalRules.length > 0 && (
                                    <div className="mb-4 border border-blue-200 rounded-lg bg-white overflow-hidden shadow-sm">
                                        <div className="bg-blue-50/50 px-4 py-2.5 border-b border-blue-100 flex items-center justify-between">
                                            <span className="text-xs font-semibold text-blue-700">Yeni {inheritedRulesSourceLabel} Kuralları ({newGlobalRules.length})</span>
                                            <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-600" onClick={handleAddAllNewGlobalRules}>
                                                <Download size={12} className="mr-1" /> Tümünü Ekle
                                            </Button>
                                        </div>
                                        <div className="divide-y divide-blue-50">
                                            {newGlobalRules.map(rule => (
                                                <div key={rule.id} className="flex items-center justify-between p-2.5 hover:bg-blue-50/30">
                                                    <div className="flex-1 min-w-0 mr-3">
                                                        <span className="text-sm font-medium text-slate-800 truncate block">{rule.name}</span>
                                                    </div>
                                                    <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleAddGlobalRuleToProgram(rule)}>
                                                        <Plus size={12} className="mr-1" /> Ekle
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Rules list */}
                                {displayRules.length === 0 ? (
                                    <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                                        Henüz kural tanımlanmamış.
                                    </div>
                                ) : (
                                    <div className="space-y-2 flex-1 overflow-y-auto pr-2 pb-2">
                                        {displayRules.map(rule => (
                                            <div
                                                key={rule.id}
                                                className={`border rounded-lg p-2.5 shadow-sm transition-all ${rule.is_active ? 'bg-white' : 'bg-slate-50 opacity-60'}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-sm truncate text-slate-900">{rule.name}</span>
                                                            <Badge variant="outline" className="text-[10px] shrink-0 font-normal">{rule.rule_type}</Badge>
                                                            {rule.source_rule_id && (
                                                                <Badge variant="secondary" className="text-[10px] shrink-0 font-normal">Klonlanmış</Badge>
                                                            )}
                                                        </div>
                                                        {rule.description && (
                                                            <p className="text-xs text-slate-500 mt-0.5 truncate">{rule.description}</p>
                                                        )}
                                                    </div>
                                                    {hasProgramRules && (
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <Switch
                                                                checked={rule.is_active}
                                                                onCheckedChange={() => handleToggleRuleActive(rule)}
                                                                className="scale-75"
                                                            />
                                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-blue-600"
                                                                onClick={() => { setEditingRule(rule); setRuleDialogOpen(true) }}>
                                                                <Pencil size={12} />
                                                            </Button>
                                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-red-600"
                                                                onClick={() => handleDeleteProgramRule(rule)}>
                                                                <Trash2 size={12} />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Footer Actions */}
                                <div className="flex gap-2 pt-2 border-t shrink-0">
                                    {!hasProgramRules ? (
                                        <Button onClick={() => handleCloneGlobalRules(program!.id!)} disabled={rulesLoading || baseRules.length === 0} className="gap-2 bg-purple-600 hover:bg-purple-700">
                                            {rulesLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                                            🏷️ Programa Kopyala
                                        </Button>
                                    ) : (
                                        <>
                                            <Button variant="outline" onClick={() => handleRevertRules(program!.id!)} disabled={rulesLoading}
                                                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 border-orange-200">
                                                <RotateCcw size={14} className="mr-1" /> {inheritedFromTeam ? "Takıma Dön" : "Global'e Dön"}
                                            </Button>
                                            <Button variant="outline" onClick={() => { setEditingRule(null); setRuleDialogOpen(true) }}>
                                                <Plus size={14} className="mr-1" /> Yeni Kural
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </TabsContent>
                </Tabs>

                <RuleDialog
                    open={ruleDialogOpen}
                    onOpenChange={setRuleDialogOpen}
                    initialData={editingRule}
                    onSuccess={async () => {
                        if (program?.id) await fetchProgramRules(program.id)
                    }}
                    programTemplateId={program?.id || null}
                    teamOwnerId={rulesTeamOwnerId}
                />

                <SettingsDialog
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                    programTemplateId={program?.id}
                    defaultTab="scores"
                    forcedMode={forcedMode}
                />

                <DialogFooter className="mt-6 shrink-0 pt-4 border-t">
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        İptal
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? 'Kaydediliyor...' : 'Kaydet'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


