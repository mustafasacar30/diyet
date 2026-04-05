"use client"

import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
// import { ScrollArea } from "@/components/ui/scroll-area" 
import { Loader2, Plus, Trash2, Pencil, RotateCcw, Upload, Download, AlertCircle, GripVertical } from "lucide-react"
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
    const [lastFocusKey, setLastFocusKey] = useState<string | null>(null)
    const [teamOwnerId, setTeamOwnerId] = useState<string | null>(null)
    const [isTeamScopedContext, setIsTeamScopedContext] = useState(false)

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
                    source_rule_id: baseRule.id
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

    // Add all new base rules
    async function handleAddAllNewGlobalRules() {
        setLoading(true)
        try {
            const rulesToInsert = newInheritedRules.map(rule => ({
                name: rule.name,
                description: rule.description,
                rule_type: rule.rule_type,
                priority: rule.priority,
                is_active: rule.is_active,
                definition: rule.definition,
                scope: 'patient',
                patient_id: patientId,
                team_owner_id: isTeamScopedContext ? teamOwnerId : null,
                source_rule_id: rule.id
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

            // 2. Loop and update the reordered rules
            // We can just update minIndex to maxIndex
            const minIndex = Math.min(oldIndex, newIndex);
            const maxIndex = Math.max(oldIndex, newIndex);

            for (let i = minIndex; i <= maxIndex; i++) {
                const sr = sortedRules[i];
                const dbRule = currentRules.find(r => r.id === sr.id || (r.source_rule_id === sr.id && sr.scope !== 'patient'));
                if (dbRule) {
                    await supabase.from('planning_rules').update({ sort_order: sr.sort_order }).eq('id', dbRule.id);
                }
            }

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

    return (
        <>

            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="!max-w-[800px] !w-full !h-[85vh] !flex !flex-col !p-0 !gap-0 overflow-hidden outline-none">
                    <DialogHeader className="px-6 py-4 border-b bg-white shrink-0 z-10">
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
                                                    <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-500 font-normal border-slate-200">{inheritedLabel}</Badge>
                                                </div>
                                                <span className="text-xs text-slate-500 mt-0.5 truncate">{rule.description || "Açıklama yok"}</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
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
                                                                setEditingRule(clonedRule)
                                                                setRuleDialogOpen(true)
                                                            }
                                                        } catch (e) {
                                                            console.error(e)
                                                        }
                                                        setLoading(false)
                                                    } else {
                                                        setEditingRule(r)
                                                        setRuleDialogOpen(true)
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
                                        onClick={() => {
                                            setEditingRule(null)
                                            setRuleDialogOpen(true)
                                        }}
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
                                        onClick={() => {
                                            setEditingRule(null)
                                            setRuleDialogOpen(true)
                                        }}
                                    >
                                        <Plus size={14} className="mr-2" />
                                        Yeni Kural
                                    </Button>
                                </>
                            )}
                        </div>
                        <Button variant="secondary" onClick={() => onOpenChange(false)}>Kapat</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rule Edit/Create Dialog */}
            <RuleDialog
                open={ruleDialogOpen}
                onOpenChange={setRuleDialogOpen}
                initialData={editingRule}
                onSuccess={() => {
                    fetchRules()
                    onRulesChanged?.()
                }}
                patientId={patientId}
                teamOwnerId={isTeamScopedContext ? teamOwnerId : null}
            />
        </>
    )
}

interface SortableRuleItemProps {
    rule: PlanningRule;
    index: number;
    loading: boolean;
    canMutate: boolean;
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
                        <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                            {rule.rule_type}
                        </Badge>
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



