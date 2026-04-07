'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Plus, Pencil, Trash2, Calendar, Activity, Ban, ArrowLeft, Loader2 } from 'lucide-react'
import ProgramDialog from '@/components/programs/program-dialog'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DietTypesEditor } from "@/components/diet/diet-types-editor"
import { applyTeamProgramOverrides } from "@/lib/team-program-overrides"
import { applyTeamDietTypeOverrides } from "@/lib/team-diet-type-overrides"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"

interface ProgramTemplate {
    id: string
    name: string
    description: string | null
    total_weeks: number
    default_activity_level: number
    is_active: boolean
    created_at: string
    scope_source?: 'global' | 'team'
    program_template_weeks?: ProgramTemplateWeek[]
    program_template_restrictions?: ProgramTemplateRestriction[]
}

interface ProgramTemplateWeek {
    id: string
    week_start: number
    week_end: number
    diet_type_id: string | null
    diet_types?: { name: string; abbreviation?: string } | null
    notes: string | null
}

interface ProgramTemplateRestriction {
    id: string
    restriction_type: 'keyword' | 'tag' | 'food_id'
    restriction_value: string
    reason: string | null
    severity: 'warn' | 'block'
}

export default function ProgramsPage() {
    return (
        <Suspense fallback={<div className="p-10 text-center">Yükleniyor...</div>}>
            <ProgramsContent />
        </Suspense>
    )
}

function ProgramsContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [activeTab, setActiveTab] = useState('programs')

    const [programs, setPrograms] = useState<ProgramTemplate[]>([])
    const [dietTypes, setDietTypes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingProgram, setEditingProgram] = useState<ProgramTemplate | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [programToDelete, setProgramToDelete] = useState<ProgramTemplate | null>(null)
    const [scopeActionProgramId, setScopeActionProgramId] = useState<string | null>(null)
    const { scopeMode } = useAuth()
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

    const effectiveTeamOwnerId =
        canToggleScopeMode && scopeMode === 'team'
            ? teamScope.userId
            : teamScope.teamOwnerId

    const hasTeamScope =
        (teamScope.role === 'doctor' || teamScope.role === 'dietitian') &&
        !!effectiveTeamOwnerId &&
        (!teamScope.canUseGlobal || (canToggleScopeMode && scopeMode === 'team'))

    useEffect(() => {
        const tabParam = searchParams.get('tab')
        if (tabParam && (tabParam === 'programs' || tabParam === 'diet-types')) {
            setActiveTab(tabParam)
        }
    }, [searchParams])

    useEffect(() => {
        fetchPrograms()
    }, [scopeMode])

    useEffect(() => {
        fetchDietTypes()
    }, [scopeMode])

    async function fetchPrograms() {
        setLoading(true)
        const { data, error } = await supabase
            .from('program_templates')
            .select(`
                *,
                program_template_weeks (
                    id, week_start, week_end, diet_type_id, notes,
                    diet_types (name, abbreviation)
                ),
                program_template_restrictions (
                    id, restriction_type, restriction_value, reason, severity
                )
            `)
            .order('name')

        if (error) {
            console.error('Error fetching programs:', error)
        } else {
            let finalPrograms: ProgramTemplate[] = (data || []).map((program: ProgramTemplate) => ({
                ...program,
                scope_source: 'global',
            }))

            try {
                const { userId, role, canUseGlobal, teamOwnerId } = await resolveTeamScopeContextFromAuth()
                const hasTeamScopedRole = role === 'doctor' || role === 'dietitian'
                setTeamScope({ userId, role, canUseGlobal, teamOwnerId })

                const canToggleForCurrentUser = role === 'doctor' && canUseGlobal && !!userId
                const mergedTeamOwnerId =
                    canToggleForCurrentUser && scopeMode === 'team'
                        ? userId
                        : teamOwnerId

                const shouldUseTeamOverrides =
                    hasTeamScopedRole &&
                    !!mergedTeamOwnerId &&
                    (!canUseGlobal || (canToggleForCurrentUser && scopeMode === 'team'))

                if (shouldUseTeamOverrides) {
                    finalPrograms = await applyTeamProgramOverrides(finalPrograms, mergedTeamOwnerId)

                    const teamCustomizedIds = new Set(
                        finalPrograms
                            .filter((p) => p.scope_source === 'team')
                            .map((p) => p.id)
                    )

                    // Planner settings team/program overrides
                    const { data: plannerRows, error: plannerError } = await supabase
                        .from('planner_settings')
                        .select('program_template_id')
                        .eq('scope', 'program')
                        .eq('team_owner_id', mergedTeamOwnerId)
                        .in('program_template_id', finalPrograms.map((p) => p.id))

                    if (!plannerError) {
                        ;(plannerRows || []).forEach((row: { program_template_id: string | null }) => {
                            if (row.program_template_id) teamCustomizedIds.add(row.program_template_id)
                        })
                    }

                    // Program rules team/program overrides (v101 sonrası aktif)
                    const { data: ruleRows, error: ruleError } = await supabase
                        .from('planning_rules')
                        .select('program_template_id')
                        .eq('scope', 'program')
                        .eq('team_owner_id', mergedTeamOwnerId)
                        .in('program_template_id', finalPrograms.map((p) => p.id))

                    if (!ruleError) {
                        ;(ruleRows || []).forEach((row: { program_template_id: string | null }) => {
                            if (row.program_template_id) teamCustomizedIds.add(row.program_template_id)
                        })
                    }

                    // Program-level diet type overrides
                    const { data: dietTypeRows, error: dietTypeError } = await supabase
                        .from('program_diet_type_overrides')
                        .select('program_template_id')
                        .eq('team_owner_id', mergedTeamOwnerId)
                        .in('program_template_id', finalPrograms.map((p) => p.id))

                    if (!dietTypeError) {
                        ;(dietTypeRows || []).forEach((row: { program_template_id: string | null }) => {
                            if (row.program_template_id) teamCustomizedIds.add(row.program_template_id)
                        })
                    }

                    finalPrograms = finalPrograms.map((program) => ({
                        ...program,
                        scope_source: teamCustomizedIds.has(program.id) ? 'team' : 'global',
                    }))
                }
            } catch (teamScopeError) {
                console.warn('Team override merge skipped:', teamScopeError)
                setTeamScope({
                    userId: null,
                    role: null,
                    canUseGlobal: true,
                    teamOwnerId: null,
                })
            }

            setPrograms(finalPrograms)
        }
        setLoading(false)
    }

    async function handleRevertToGlobal(program: ProgramTemplate) {
        if (!effectiveTeamOwnerId) return
        const confirmed = window.confirm(
            `"${program.name}" icin tum takım ozellestirmeleri (program bilgisi, hafta/yasak, kurallar, gelismis ayarlar) kaldirilacak ve global mirasa donulecek. Devam edilsin mi?`
        )
        if (!confirmed) return

        setScopeActionProgramId(program.id)

        const { error: overrideError } = await supabase
            .from('team_program_overrides')
            .delete()
            .eq('team_owner_id', effectiveTeamOwnerId)
            .eq('program_template_id', program.id)

        const { error: settingsError } = await supabase
            .from('planner_settings')
            .delete()
            .eq('scope', 'program')
            .eq('team_owner_id', effectiveTeamOwnerId)
            .eq('program_template_id', program.id)

        const { error: rulesError } = await supabase
            .from('planning_rules')
            .delete()
            .eq('scope', 'program')
            .eq('team_owner_id', effectiveTeamOwnerId)
            .eq('program_template_id', program.id)

        const { error: dietTypeOverrideError } = await supabase
            .from('program_diet_type_overrides')
            .delete()
            .eq('team_owner_id', effectiveTeamOwnerId)
            .eq('program_template_id', program.id)

        if (overrideError || settingsError || rulesError || dietTypeOverrideError) {
            console.error('Error reverting to global:', {
                overrideError,
                settingsError,
                rulesError,
                dietTypeOverrideError,
            })
            alert('Global mirasa donus sirasinda hata olustu.')
        }

        await fetchPrograms()
        setScopeActionProgramId(null)
    }

    async function fetchDietTypes() {
        // Base list: global diet types.
        const { data, error } = await supabase
            .from('diet_types')
            .select('*')
            .is('patient_id', null)
            .order('name')

        if (error) {
            console.error('Error fetching diet types:', error)
            return
        }

        let finalDietTypes = (data || []).map((row: any) => ({
            ...row,
            base_diet_type_id: row.id,
            scope_source: 'global',
        }))

        try {
            const { userId, role, canUseGlobal, teamOwnerId } = await resolveTeamScopeContextFromAuth()
            const hasTeamScopedRole = role === 'doctor' || role === 'dietitian'
            const canToggleForCurrentUser = role === 'doctor' && canUseGlobal && !!userId
            const mergedTeamOwnerId =
                canToggleForCurrentUser && scopeMode === 'team'
                    ? userId
                    : teamOwnerId

            const shouldUseTeamOverrides =
                hasTeamScopedRole &&
                !!mergedTeamOwnerId &&
                (!canUseGlobal || (canToggleForCurrentUser && scopeMode === 'team'))

            if (shouldUseTeamOverrides) {
                finalDietTypes = await applyTeamDietTypeOverrides(finalDietTypes, mergedTeamOwnerId)
            }
        } catch (teamScopeError) {
            console.warn('Team diet type merge skipped:', teamScopeError)
        }

        setDietTypes(finalDietTypes)
    }

    async function handleDelete() {
        if (!programToDelete) return

        if (hasTeamScope) {
            alert('Takım modunda global program silinemez. "Globalden Miras Al" butonunu kullanin.')
            setDeleteDialogOpen(false)
            setProgramToDelete(null)
            return
        }

        const { error } = await supabase
            .from('program_templates')
            .delete()
            .eq('id', programToDelete.id)

        if (error) {
            console.error('Error deleting program:', error)
            alert('Program silinirken hata oluştu')
        } else {
            fetchPrograms()
        }
        setDeleteDialogOpen(false)
        setProgramToDelete(null)
    }

    function openEditDialog(program: ProgramTemplate) {
        setEditingProgram(program)
        setDialogOpen(true)
    }

    function openNewDialog() {
        setEditingProgram(null)
        setDialogOpen(true)
    }

    function handleDialogClose() {
        setDialogOpen(false)
        setEditingProgram(null)
        fetchPrograms()
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push('/admin')}>
                            <ArrowLeft size={16} className="mr-1" />
                            Panele Dön
                        </Button>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Program Yönetimi</h1>
                    <p className="text-gray-500 mt-1">
                        Program şablonları ve diyet türlerini buradan yönetebilirsiniz.
                    </p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(val) => {
                setActiveTab(val)
                // Update URL without refresh
                const params = new URLSearchParams(searchParams)
                params.set('tab', val)
                router.replace(`/programs?${params.toString()}`, { scroll: false })
            }} className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="programs">Program Şablonları</TabsTrigger>
                    <TabsTrigger value="diet-types">Diyet Türleri Kütüphanesi</TabsTrigger>
                </TabsList>

                <TabsContent value="programs">
                    {!hasTeamScope && (
                        <div className="flex justify-end mb-4">
                            <Button onClick={openNewDialog} className="flex items-center gap-2">
                                <Plus size={18} />
                                Yeni Program
                            </Button>
                        </div>
                    )}

                    {/* Programs Grid */}
                    {loading ? (
                        <div className="text-center py-12 text-gray-500">Yükleniyor...</div>
                    ) : programs.length === 0 ? (
                        <Card className="text-center py-12">
                            <CardContent>
                                <p className="text-gray-500 mb-4">Henüz program şablonu oluşturulmamış</p>
                                {!hasTeamScope && (
                                <Button onClick={openNewDialog} variant="outline">
                                    <Plus size={18} className="mr-2" />
                                    İlk Programı Oluştur
                                </Button>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {programs.map(program => (
                                <Card key={program.id} className={`transition-shadow hover:shadow-md ${!program.is_active ? 'opacity-60' : ''}`}>
                                    <CardHeader className="pb-3">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <CardTitle className="text-lg">
                                                    {program.name} ({program.scope_source === 'team' ? 'Takım' : 'Global'})
                                                </CardTitle>
                                                {program.description && (
                                                    <CardDescription className="mt-1 line-clamp-2">
                                                        {program.description}
                                                    </CardDescription>
                                                )}
                                            </div>
                                            {!program.is_active && (
                                                <Badge variant="secondary">Pasif</Badge>
                                            )}
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        {/* Quick Stats */}
                                        <div className="flex gap-4 text-sm text-gray-600">
                                            <div className="flex items-center gap-1">
                                                <Calendar size={14} />
                                                <span>{program.total_weeks} hafta</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Activity size={14} />
                                                <span>Seviye {program.default_activity_level}</span>
                                            </div>
                                            {(program.program_template_restrictions?.length || 0) > 0 && (
                                                <div className="flex items-center gap-1 text-red-600">
                                                    <Ban size={14} />
                                                    <span>{program.program_template_restrictions?.length} yasak</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Week Diet Types Preview */}
                                        {program.program_template_weeks && program.program_template_weeks.length > 0 && (
                                            <div className="flex flex-wrap gap-1">
                                                {program.program_template_weeks
                                                    .sort((a, b) => a.week_start - b.week_start)
                                                    .slice(0, 4)
                                                    .map((week, index) => (
                                                        <Badge
                                                            key={week.id ? `${week.id}-${index}` : `${program.id}-${week.week_start}-${week.week_end}-${week.diet_type_id || 'none'}-${index}`}
                                                            variant="outline"
                                                            className="text-xs"
                                                        >
                                                            H{week.week_start}-{week.week_end}: {week.diet_types?.abbreviation || week.diet_types?.name || '?'}
                                                        </Badge>
                                                    ))}
                                                {program.program_template_weeks.length > 4 && (
                                                    <Badge variant="outline" className="text-xs">
                                                        +{program.program_template_weeks.length - 4}
                                                    </Badge>
                                                )}
                                            </div>
                                        )}

                                        {/* Actions */}
                                        {hasTeamScope && program.scope_source === 'team' && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="w-full"
                                                disabled={scopeActionProgramId === program.id}
                                                onClick={() => handleRevertToGlobal(program)}
                                            >
                                                {scopeActionProgramId === program.id ? (
                                                    <>
                                                        <Loader2 size={14} className="mr-1 animate-spin" />
                                                        İşleniyor...
                                                    </>
                                                ) : (
                                                    'Globalden Miras Al'
                                                )}
                                            </Button>
                                        )}
                                        <div className="flex gap-2 pt-2 border-t">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className={hasTeamScope ? 'w-full' : 'flex-1'}
                                                onClick={() => openEditDialog(program)}
                                            >
                                                <Pencil size={14} className="mr-1" />
                                                Düzenle
                                            </Button>
                                            {!hasTeamScope && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => {
                                                        setProgramToDelete(program)
                                                        setDeleteDialogOpen(true)
                                                    }}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="diet-types">
                    <Card>
                        <CardHeader>
                            <CardTitle>Diyet Türleri Kütüphanesi</CardTitle>
                            <CardDescription>
                                Sistem genelinde kullanılan diyet şablonlarını yönetin. Hastalara özel kopyalar bu şablonlardan türetilir.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <DietTypesEditor
                                dietTypes={dietTypes}
                                onUpdate={fetchDietTypes}
                                forcedMode={canToggleScopeMode ? scopeMode : undefined}
                            // No patientId passed -> Global Mode
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Program Dialog */}
            <ProgramDialog
                open={dialogOpen}
                onClose={handleDialogClose}
                program={editingProgram}
                forcedMode={canToggleScopeMode ? scopeMode : undefined}
            />

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Programı Sil</AlertDialogTitle>
                        <AlertDialogDescription>
                            "{programToDelete?.name}" programını silmek istediğinize emin misiniz?
                            Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}


