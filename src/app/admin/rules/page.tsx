"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Plus, Settings, ChevronUp, ChevronDown, LayoutGrid, List as ListIcon } from "lucide-react"
import { RuleList } from "@/components/planner/rule-list"
import { PlanningRule } from "@/types/planner"
import { RuleDialog } from "@/components/planner/rule-dialog"
import { SettingsDialog } from "@/components/planner/settings-dialog"
import { DragEndEvent } from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"
import { Switch } from "@/components/ui/switch"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"
import { useAuth } from "@/contexts/auth-context"

export default function RulesPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [rules, setRules] = useState<PlanningRule[]>([])
    const [inheritedGlobalRules, setInheritedGlobalRules] = useState<PlanningRule[]>([])
    const [suggestions, setSuggestions] = useState<PlanningRule[]>([])
    const [showSuggestions, setShowSuggestions] = useState(true)
    const [loading, setLoading] = useState(true)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
    const [ruleProgramMap, setRuleProgramMap] = useState<Record<string, string[]>>({})
    const [dialogOpen, setDialogOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [editingRule, setEditingRule] = useState<PlanningRule | null>(null)
    const [isAcceptingSuggestion, setIsAcceptingSuggestion] = useState<string | null>(null)
    const [draftLoadedFromPattern, setDraftLoadedFromPattern] = useState(false)
    const { scopeMode } = useAuth()
    const [scopeActionLoading, setScopeActionLoading] = useState(false)
    const [teamRuleCount, setTeamRuleCount] = useState(0)
    const [teamScope, setTeamScope] = useState<{
        userId: string | null
        role: string | null
        canUseGlobal: boolean
        teamOwnerId: string | null
    }>({
        userId: null,
        role: null,
        canUseGlobal: true,
        teamOwnerId: null,
    })

    const canToggleScopeMode =
        teamScope.role === 'doctor' &&
        teamScope.canUseGlobal &&
        !!teamScope.userId

    const adminOverrideTeamId = searchParams?.get('team_id')
    const isAdminOverride = !!adminOverrideTeamId && (teamScope.role === 'admin' || teamScope.canUseGlobal)

    const effectiveTeamOwnerId = isAdminOverride
        ? adminOverrideTeamId
        : (canToggleScopeMode && scopeMode === 'team'
            ? teamScope.userId
            : teamScope.teamOwnerId)

    const hasTeamScope = isAdminOverride || (
        (teamScope.role === 'doctor' || teamScope.role === 'dietitian') &&
        !!effectiveTeamOwnerId &&
        (!teamScope.canUseGlobal || (canToggleScopeMode && scopeMode === 'team'))
    )

    useEffect(() => {
        fetchRules()
    }, [scopeMode])

    useEffect(() => {
        if (draftLoadedFromPattern) return
        if (searchParams.get('fromPattern') !== '1') return

        try {
            const rawDraft = localStorage.getItem('pattern_rule_draft')
            if (!rawDraft) {
                setDraftLoadedFromPattern(true)
                router.replace('/admin/rules')
                return
            }

            const parsed = JSON.parse(rawDraft) as Partial<PlanningRule>
            const draftRule: PlanningRule = {
                ...(parsed as PlanningRule),
                id: '' as any,
                source_rule_id: null,
                pending_global_approval: false,
            }

            setEditingRule(draftRule)
            setDialogOpen(true)
            setIsAcceptingSuggestion(null)
            localStorage.removeItem('pattern_rule_draft')
            setDraftLoadedFromPattern(true)
            router.replace('/admin/rules')
        } catch (error) {
            console.error('Pattern draft load error:', error)
            setDraftLoadedFromPattern(true)
            router.replace('/admin/rules')
        }
    }, [draftLoadedFromPattern, router, searchParams])

    async function fetchRules() {
        setLoading(true)
        try {
            const { userId, role, canUseGlobal, teamOwnerId } = await resolveTeamScopeContextFromAuth()
            const hasTeamScopedRole = role === 'doctor' || role === 'dietitian'
            setTeamScope({ userId, role, canUseGlobal, teamOwnerId })

            const adminOverrideTeamId = searchParams?.get('team_id')
            const isAdminOverride = !!adminOverrideTeamId && (role === 'admin' || canUseGlobal)

            const canToggleForCurrentUser = role === 'doctor' && canUseGlobal && !!userId
            const mergedTeamOwnerId = isAdminOverride 
                ? adminOverrideTeamId
                : (canToggleForCurrentUser && scopeMode === 'team'
                    ? userId
                    : teamOwnerId)

            const shouldUseTeamScope = isAdminOverride || (
                hasTeamScopedRole &&
                !!mergedTeamOwnerId &&
                (!canUseGlobal || (canToggleForCurrentUser && scopeMode === 'team'))
            )

            // Always keep global rules for inheritance preview / team bootstrap.
            const { data: globalData, error: globalError } = await supabase
                .from('planning_rules')
                .select('*')
                .or('scope.is.null,scope.eq.global')
                .order('sort_order', { ascending: true })
                .order('priority', { ascending: false })

            if (globalError) {
                console.error('Error fetching global rules:', globalError)
            }
            const globalRules = (globalData || []) as unknown as PlanningRule[]
            setInheritedGlobalRules(globalRules)

            if (shouldUseTeamScope && mergedTeamOwnerId) {
                const { data: teamData, error: teamError } = await supabase
                    .from('planning_rules')
                    .select('*')
                    .eq('scope', 'team')
                    .eq('team_owner_id', mergedTeamOwnerId)
                    .order('sort_order', { ascending: true })
                    .order('priority', { ascending: false })

                if (teamError) {
                    console.error('Error fetching team rules:', teamError)
                    setTeamRuleCount(0)
                    setRules([])
                } else {
                    const rawTeamRules = (teamData || []) as unknown as PlanningRule[]
                    setTeamRuleCount(rawTeamRules.length)

                    const teamRuleBySource = new Map<string, PlanningRule>()
                    const customTeamRules: PlanningRule[] = []

                    rawTeamRules.forEach((rule) => {
                        if (rule.source_rule_id) {
                            teamRuleBySource.set(rule.source_rule_id, rule)
                        } else {
                            customTeamRules.push(rule)
                        }
                    })

                    const mergedRules: PlanningRule[] = globalRules.map((globalRule) => {
                        const teamOverride = teamRuleBySource.get(globalRule.id)
                        if (teamOverride) {
                            return {
                                ...teamOverride,
                                scope_source: 'team',
                                base_rule_id: globalRule.id,
                            }
                        }
                        return {
                            ...globalRule,
                            scope_source: 'global',
                            base_rule_id: globalRule.id,
                        }
                    })

                    customTeamRules.forEach((teamRule) => {
                        mergedRules.push({
                            ...teamRule,
                            scope_source: 'team',
                            base_rule_id: teamRule.id,
                        })
                    })

                    setRules(mergedRules)
                }

                // Team mode: no pending-global approval workflow list.
                setSuggestions([])
                return
            }

            // Global mode list
            setTeamRuleCount(0)
            setRules(globalRules.map((rule) => ({
                ...rule,
                scope_source: 'global',
                base_rule_id: rule.id,
            })))

            // Pending approval list (global workflow only)
            const { data: suggestionData, error: suggestionError } = await supabase
                .from('planning_rules')
                .select('*')
                .eq('pending_global_approval', true)
                .order('created_at', { ascending: false })

            if (!suggestionError && suggestionData && suggestionData.length > 0) {
                const patientIds = Array.from(new Set(suggestionData.map((r: any) => r.patient_id).filter(Boolean)))

                let patientsMap: Record<string, any> = {}
                if (patientIds.length > 0) {
                    const { data: patients } = await supabase
                        .from('patients')
                        .select('id, full_name')
                        .in('id', patientIds)

                    if (patients) {
                        patients.forEach(p => {
                            patientsMap[p.id] = p
                        })
                    }
                }

                const suggestionsWithPatient = suggestionData.map((r: any) => ({
                    ...r,
                    patients: patientsMap[r.patient_id] || { full_name: 'Bilinmeyen Hasta' }
                }))

                setSuggestions(suggestionsWithPatient as unknown as PlanningRule[])
                setSuggestions([])
            }

            // Fetch program overrides to see which global/team rules are used in which programs
            const { data: programRulesData } = await supabase
                .from('planning_rules')
                .select('source_rule_id, program_templates(name)')
                .eq('scope', 'program')
                .not('source_rule_id', 'is', null)

            const pMap: Record<string, string[]> = {}
            if (programRulesData) {
                programRulesData.forEach((pr: any) => {
                    const sid = pr.source_rule_id
                    const pName = pr.program_templates?.name
                    if (sid && pName) {
                        if (!pMap[sid]) pMap[sid] = []
                        if (!pMap[sid].includes(pName)) pMap[sid].push(pName)
                    }
                })
            }
            setRuleProgramMap(pMap)
        } finally {
            setLoading(false)
        }
    }

    const handleEdit = (rule: PlanningRule) => {
        if (hasTeamScope && effectiveTeamOwnerId && rule.scope_source !== 'team') {
            const baseRuleId = rule.base_rule_id || rule.id
            const teamDraftRule = {
                ...rule,
                id: undefined,
                scope: 'team' as const,
                source_rule_id: baseRuleId,
                team_owner_id: effectiveTeamOwnerId,
                scope_source: 'team' as const,
                base_rule_id: baseRuleId,
            } as unknown as PlanningRule
            setEditingRule(teamDraftRule)
        } else {
            setEditingRule(rule)
        }
        setDialogOpen(true)
        setIsAcceptingSuggestion(null)
    }

    const handleCreate = () => {
        setEditingRule(null)
        setDialogOpen(true)
        setIsAcceptingSuggestion(null)
    }

    const handleCloneGlobalToTeam = async () => {
        if (!effectiveTeamOwnerId) return
        if (inheritedGlobalRules.length === 0) {
            alert("Takıma kopyalanacak global kural bulunamadı.")
            return
        }
        if (!confirm("Global kurallar takım katmanına kopyalanacak. Devam edilsin mi?")) return

        setScopeActionLoading(true)
        try {
            const { data: authData } = await supabase.auth.getUser()
            const currentUserId = authData.user?.id || null
            const existingTeamSources = new Set(
                rules
                    .filter((rule) => rule.scope_source === 'team' && rule.source_rule_id)
                    .map((rule) => rule.source_rule_id as string)
            )
            const rulesToClone = inheritedGlobalRules.filter((rule) => !existingTeamSources.has(rule.id))

            if (rulesToClone.length === 0) {
                alert("Tüm global kurallar zaten takım katmanına kopyalanmış.")
                return
            }

            const payload = rulesToClone.map((rule) => ({
                name: rule.name,
                description: rule.description,
                rule_type: rule.rule_type,
                priority: rule.priority,
                sort_order: rule.sort_order,
                is_active: rule.is_active,
                definition: rule.definition,
                scope: 'team',
                team_owner_id: effectiveTeamOwnerId,
                user_id: currentUserId,
                source_rule_id: rule.id,
                pending_global_approval: false,
            }))

            const { error } = await supabase.from('planning_rules').insert(payload)
            if (error) throw error
            await fetchRules()
        } catch (error: any) {
            console.error("Team clone error:", error)
            alert("Takım katmanına kopyalama sırasında hata oluştu: " + (error.message || error))
        } finally {
            setScopeActionLoading(false)
        }
    }

    const handleRevertTeamToGlobal = async () => {
        if (!effectiveTeamOwnerId) return
        if (!confirm("Takım kuralları silinip Global mirasa dönülecek. Devam edilsin mi?")) return

        setScopeActionLoading(true)
        try {
            const { error } = await supabase
                .from('planning_rules')
                .delete()
                .eq('scope', 'team')
                .eq('team_owner_id', effectiveTeamOwnerId)

            if (error) throw error
            await fetchRules()
        } catch (error: any) {
            console.error("Team revert error:", error)
            alert("Global mirasa dönüş sırasında hata oluştu: " + (error.message || error))
        } finally {
            setScopeActionLoading(false)
        }
    }

    // Accept Suggestion: Open dialog as "New Rule" but pre-filled
    const handleAcceptSuggestion = (rule: PlanningRule) => {
        // Create a copy of the rule but tailored for Global creation
        const newGlobalRule: any = {
            ...rule,
            id: undefined, // Clear ID to create new
            scope: 'global',
            patient_id: null,
            source_rule_id: null,
            pending_global_approval: false,
            // Keep name, definition, type etc.
        }
        setEditingRule(newGlobalRule)
        setIsAcceptingSuggestion(rule.id) // Track which suggestion we are accepting
        setDialogOpen(true)
    }

    // Reject Suggestion: Just clear the flag
    const handleRejectSuggestion = async (ruleId: string) => {
        if (!confirm("Öneriyi reddetmek istediğinize emin misiniz? Kural hastada kalmaya devam edecek ancak listeden kalkacak.")) return

        const { error } = await supabase
            .from('planning_rules')
            .update({ pending_global_approval: false })
            .eq('id', ruleId)

        if (error) {
            alert("Hata: " + error.message)
        } else {
            fetchRules()
        }
    }

    // Called when RuleDialog saves successfully
    const handleSuccess = async () => {
        // If we were accepting a suggestion, we need to clear its pending flag now
        if (isAcceptingSuggestion) {
            await supabase
                .from('planning_rules')
                .update({ pending_global_approval: false })
                .eq('id', isAcceptingSuggestion)
            setIsAcceptingSuggestion(null)
        }
        fetchRules()
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        if (hasTeamScope && rules.some((rule) => rule.scope_source !== 'team')) {
            alert("Sıralama için önce tüm global kuralları Takıma Özel Hale Getir ile takım katmanına kopyalayın.")
            return
        }

        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = rules.findIndex(r => r.id === active.id);
        const newIndex = rules.findIndex(r => r.id === over.id);

        if (oldIndex === -1 || newIndex === -1) return;

        // Optimistic UI Update
        const newRules = arrayMove(rules, oldIndex, newIndex);

        // Ensure new sort orders are strict sequence
        const sortedRules = newRules.map((r, i) => ({ ...r, sort_order: i }));
        setRules(sortedRules);

        // Update DB
        try {
            const minIndex = Math.min(oldIndex, newIndex);
            const maxIndex = Math.max(oldIndex, newIndex);

            for (let i = minIndex; i <= maxIndex; i++) {
                const sr = sortedRules[i];
                await supabase.from('planning_rules').update({ sort_order: sr.sort_order }).eq('id', sr.id);
            }
        } catch (e: any) {
            console.error("Error moving rule:", e);
            alert("Sıralama değiştirilemedi: " + e.message);
            fetchRules();
        }
    }


    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Planlama Kuralları</h2>
                    <p className="text-muted-foreground">Otomatik planlayıcı için davranış kuralları tanımlayın.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" className="gap-2" onClick={() => setSettingsOpen(true)}>
                        <Settings size={16} />
                        Planlayıcı Ayarları
                    </Button>
                    <Button
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                            if (rules.length === 0) {
                                alert("Dışa aktarılacak kural yok!");
                                return;
                            }
                            const json = JSON.stringify(rules, null, 2);
                            const blob = new Blob([json], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'planning_rules_export.json';
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        Kuralları Dışa Aktar
                    </Button>
                    <Button
                        variant="outline"
                        className="gap-2"
                        onClick={async () => {
                            const { data: foods, error } = await supabase
                                .from('foods')
                                .select('id, name, category, role, meal_types, tags, calories')
                                .order('category');

                            if (error) {
                                alert("Yiyecekler alınamadı: " + error.message);
                                return;
                            }
                            if (!foods || foods.length === 0) {
                                alert("Dışa aktarılacak yiyecek yok!");
                                return;
                            }
                            const json = JSON.stringify(foods, null, 2);
                            const blob = new Blob([json], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = 'foods_export.json';
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        Yiyecekleri Dışa Aktar
                    </Button>
                    <div className="flex border rounded-md overflow-hidden bg-white shadow-sm">
                        <Button 
                            variant={viewMode === 'grid' ? 'default' : 'ghost'} 
                            size="icon" 
                            className={`rounded-none h-10 w-10 ${viewMode === 'grid' ? 'bg-slate-800 text-white hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100'}`}
                            onClick={() => setViewMode('grid')}
                            title="Grid Görünümü"
                        >
                            <LayoutGrid size={18} />
                        </Button>
                        <Button 
                            variant={viewMode === 'list' ? 'default' : 'ghost'} 
                            size="icon" 
                            className={`rounded-none h-10 w-10 ${viewMode === 'list' ? 'bg-slate-800 text-white hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100'}`}
                            onClick={() => setViewMode('list')}
                            title="Liste Görünümü"
                        >
                            <ListIcon size={18} />
                        </Button>
                    </div>
                    <Button onClick={handleCreate} className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white ml-2">
                        <Plus size={18} />
                        Yeni Kural
                    </Button>
                </div>
            </div>

            {hasTeamScope && (
                <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-violet-900">
                                Takım Scope Kuralları
                            </h3>
                            <p className="text-xs text-violet-700 mt-1">
                                Bu modda yaptığınız tüm kural değişiklikleri yalnızca takımınıza ve takım hastalarınıza yansır.
                            </p>
                        </div>
                        {teamRuleCount === 0 ? (
                            <Button size="sm" onClick={handleCloneGlobalToTeam} disabled={scopeActionLoading} className="bg-violet-600 hover:bg-violet-700 text-white">
                                {scopeActionLoading ? "Kopyalanıyor..." : "Takıma Özel Hale Getir"}
                            </Button>
                        ) : (
                            <Button size="sm" variant="outline" onClick={handleRevertTeamToGlobal} disabled={scopeActionLoading} className="border-orange-300 text-orange-700 hover:bg-orange-50">
                                {scopeActionLoading ? "İşleniyor..." : "Globalden Miras Al"}
                            </Button>
                        )}
                    </div>
                    {teamRuleCount === 0 && inheritedGlobalRules.length > 0 && (
                        <div className="mt-3 text-xs text-violet-700">
                            Şu an global kuralları miras alıyorsunuz ({inheritedGlobalRules.length} kural).
                        </div>
                    )}
                </div>
            )}

            {/* Suggestions Section */}
            {!hasTeamScope && suggestions.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
                    <div
                        className="p-4 flex items-center justify-between cursor-pointer hover:bg-amber-100/50 transition-colors"
                        onClick={() => setShowSuggestions(!showSuggestions)}
                    >
                        <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
                            <span>Onay Bekleyen Öneriler</span>
                            <span className="bg-amber-200 text-amber-900 text-xs px-2 py-0.5 rounded-full">{suggestions.length}</span>
                        </h3>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-amber-800">
                            {showSuggestions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </Button>
                    </div>

                    {showSuggestions && (
                        <div className="p-4 pt-0 space-y-2 border-t border-amber-200/50 mt-2">
                            {suggestions.map((suggestion: any) => (
                                <div key={suggestion.id} className="bg-white border border-amber-100 rounded-lg p-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between shadow-sm">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-slate-800">{suggestion.name}</span>
                                            <div className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                                {suggestion.rule_type}
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1">{suggestion.description}</p>
                                        <div className="text-[10px] text-amber-600 mt-1 font-medium">
                                            Öneren: {suggestion.patients?.full_name}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 h-8 text-xs" onClick={() => handleRejectSuggestion(suggestion.id)}>
                                            Reddet
                                        </Button>
                                        <Button size="sm" className="bg-green-600 hover:bg-green-700 h-8 text-xs" onClick={() => handleAcceptSuggestion(suggestion)}>
                                            Kabul Et & Ekle
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <RuleList
                rules={rules}
                loading={loading}
                viewMode={viewMode}
                ruleProgramMap={ruleProgramMap}
                onEdit={handleEdit}
                onDragEnd={handleDragEnd}
                onDelete={async (rule) => {
                    if (hasTeamScope && rule.scope_source !== 'team') {
                        alert("Bu kural global mirastan geliyor. Takım katmanında silmek için önce düzenleyip takım override oluşturun ya da Globalden Miras Al kullanın.")
                        return
                    }
                    if (!confirm("Kuralı silmek istediğinize emin misiniz?")) return;
                    await supabase.from('planning_rules').delete().eq('id', rule.id);
                    fetchRules();
                }}
            />

            <RuleDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                initialData={editingRule}
                onSuccess={handleSuccess}
                teamOwnerId={hasTeamScope ? effectiveTeamOwnerId : null}
            />

            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                forcedMode={canToggleScopeMode ? scopeMode : undefined}
            />
        </div>
    )
}


