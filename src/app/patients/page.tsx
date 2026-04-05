"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Plus, Search, User, MoreVertical, Pencil, Trash2, Copy, LayoutGrid, List, Archive, RefreshCw, ArrowUpDown, UserCog, Eye, Check } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useRouter } from "next/navigation"

import { PatientProfileDialog } from "@/components/diet/patient-profile-dialog"
import { PatientCloneDialog } from "@/components/diet/patient-clone-dialog"
import { PatientAssignmentDialog } from "@/components/diet/patient-assignment-dialog"
import { createPatientWithAuth } from "@/actions/patient-actions"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"

type Patient = {
    id: string
    user_id?: string | null
    full_name: string
    notes: string | null
    created_at: string
    status?: 'active' | 'archived' | 'pending'
    birth_date?: string | null
    weight?: number | null
    dietitian_id?: string | null
    program_templates?: {
        name: string
    } | null
    diet_plans?: {
        id: string
        status?: string // Added status
        created_at?: string
        diet_weeks: { id: string }[]
    }[]
    dietitians?: {
        full_name: string
    } | null
    patient_assignments?: {
        dietitian_id?: string | null
        profiles: {
            full_name: string
        } | null
    }[]
}

export default function PatientsPage() {
    const { isAdmin, impersonateUser, profile } = useAuth()
    const isDoctor = profile?.role === 'doctor'
    // Dietitians can create/edit but NOT delete or assign others
    const canDelete = isAdmin || isDoctor
    const canAssign = isAdmin || isDoctor
    const [patients, setPatients] = useState<Patient[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [scopeMode, setScopeMode] = useState<'global' | 'team'>('global')
    const [teamScope, setTeamScope] = useState<{
        userId: string | null
        role: string | null
        canUseGlobal: boolean
        teamOwnerId: string | null
    }>({
        userId: null,
        role: null,
        canUseGlobal: true,
        teamOwnerId: null
    })
    const [visibleDietitianIds, setVisibleDietitianIds] = useState<string[]>([])
    const [highlightDietitianIds, setHighlightDietitianIds] = useState<string[]>([])
    const [highlightPatientIds, setHighlightPatientIds] = useState<string[]>([])

    // Sort State
    const [sortConfig, setSortConfig] = useState<{ key: keyof Patient | 'age' | 'program'; direction: 'asc' | 'desc' }>({ key: 'created_at', direction: 'desc' })

    // State for Profile Dialog (unified create/edit)
    const [profileDialogMode, setProfileDialogMode] = useState<'create' | 'edit' | null>(null)

    // State for Edit
    const [editProfileId, setEditProfileId] = useState<string | null>(null)

    // State for Clone
    const [cloneDialogData, setCloneDialogData] = useState<{ open: boolean, patient: Patient | null }>({ open: false, patient: null })

    // State for Assignment
    const [assignmentDialogData, setAssignmentDialogData] = useState<{ open: boolean, patient: Patient | null }>({ open: false, patient: null })

    // State for View & Filter
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list') // Default List
    const [filterStatus, setFilterStatus] = useState<'active' | 'archived' | 'pending' | 'all'>('active') // Default Active

    const router = useRouter()

    const canToggleScopeMode =
        teamScope.role === 'doctor' &&
        teamScope.canUseGlobal &&
        !!teamScope.userId

    const isTeamScopeActive =
        (teamScope.role === 'doctor' || teamScope.role === 'dietitian') &&
        (!teamScope.canUseGlobal || (canToggleScopeMode && scopeMode === 'team'))

    useEffect(() => {
        fetchPatients()
    }, [scopeMode])

    function getPatientAssigneeIds(patient: Patient): string[] {
        const ids: string[] = []
        if (patient.dietitian_id) ids.push(patient.dietitian_id)
        ;(patient.patient_assignments || []).forEach((assignment) => {
            if (assignment?.dietitian_id) ids.push(assignment.dietitian_id)
        })
        return Array.from(new Set(ids))
    }

    function isHighlightedPatient(patient: Patient): boolean {
        if (highlightPatientIds.length > 0 && highlightPatientIds.includes(patient.id)) {
            return true
        }
        if (highlightDietitianIds.length === 0) return false
        const highlightSet = new Set(highlightDietitianIds)
        return getPatientAssigneeIds(patient).some((dietitianId) => highlightSet.has(dietitianId))
    }

    async function fetchPatients() {
        setLoading(true)
        try {
            const scopeCtx = await resolveTeamScopeContextFromAuth()
            setTeamScope({
                userId: scopeCtx.userId,
                role: scopeCtx.role,
                canUseGlobal: scopeCtx.canUseGlobal,
                teamOwnerId: scopeCtx.teamOwnerId
            })

            let ownScopedDietitianIds: string[] = []
            if (scopeCtx.role === 'doctor' && scopeCtx.userId) {
                const { data: teamMembers, error: teamMembersError } = await supabase
                    .from('team_members')
                    .select('member_id')
                    .eq('supervisor_id', scopeCtx.userId)
                    .eq('status', 'active')

                if (teamMembersError) {
                    console.error('Error fetching team members for patient scope:', teamMembersError)
                }

                const memberIds = (teamMembers || [])
                    .map((row: { member_id: string | null }) => row.member_id)
                    .filter((id): id is string => Boolean(id))

                // Doctor direct assignment support + team dietitians.
                ownScopedDietitianIds = Array.from(new Set([scopeCtx.userId, ...memberIds]))
            } else if (scopeCtx.role === 'dietitian' && scopeCtx.userId) {
                ownScopedDietitianIds = [scopeCtx.userId]
            }

            setHighlightDietitianIds(ownScopedDietitianIds)

            const shouldApplyTeamFilter =
                (scopeCtx.role === 'doctor' || scopeCtx.role === 'dietitian') &&
                (
                    !scopeCtx.canUseGlobal ||
                    (scopeCtx.role === 'doctor' && scopeCtx.canUseGlobal && scopeMode === 'team')
                )

            const scopedDietitianIds = shouldApplyTeamFilter ? ownScopedDietitianIds : []
            setVisibleDietitianIds(scopedDietitianIds)

            let ownAssignmentPatientIds: string[] = []
            if (ownScopedDietitianIds.length > 0) {
                const { data: ownAssignments, error: ownAssignmentsError } = await supabase
                    .from('patient_assignments')
                    .select('patient_id,dietitian_id')
                    .in('dietitian_id', ownScopedDietitianIds)

                if (ownAssignmentsError) {
                    console.error('Error fetching patient assignments for team scope:', ownAssignmentsError)
                } else {
                    ownAssignmentPatientIds = (ownAssignments || [])
                        .map((row: { patient_id: string | null }) => row.patient_id)
                        .filter((id): id is string => Boolean(id))
                }
            }

            const { data, error } = await supabase
                .from('patients')
                .select(`
                    *,
                    user_id,
                    program_templates (
                        name
                    ),
                    diet_plans (
                        id,
                        status,
                        created_at,
                        diet_weeks (
                            id
                        )
                    ),
                    patient_assignments (
                        dietitian_id,
                        profiles:dietitian_id (
                            full_name
                        )
                    )
                `)
                .not('gender', 'is', null)
                .order('created_at', { ascending: false })

            if (error) {
                console.error('Error fetching patients:', error)
                setPatients([])
                return
            }

            const allPatients = (data || []) as Patient[]
            const ownDietitianSet = new Set(ownScopedDietitianIds)
            const ownAssignmentPatientSet = new Set(ownAssignmentPatientIds)
            const highlightedPatientIds = allPatients
                .filter((patient) => {
                    const directMatch = !!patient.dietitian_id && ownDietitianSet.has(patient.dietitian_id)
                    const assignmentMatch = ownAssignmentPatientSet.has(patient.id)
                    return directMatch || assignmentMatch
                })
                .map((patient) => patient.id)
            setHighlightPatientIds(highlightedPatientIds)

            let scopedPatients = allPatients
            if (shouldApplyTeamFilter) {
                if (scopedDietitianIds.length === 0) {
                    scopedPatients = []
                } else {
                    const allowedSet = new Set(scopedDietitianIds)
                    scopedPatients = scopedPatients.filter((patient) =>
                        (
                            (!!patient.dietitian_id && allowedSet.has(patient.dietitian_id)) ||
                            ownAssignmentPatientSet.has(patient.id) ||
                            getPatientAssigneeIds(patient).some((dietitianId) => allowedSet.has(dietitianId))
                        )
                    )
                }
            }

            setPatients(scopedPatients)
        } catch (error) {
            console.error('Unexpected patient fetch error:', error)
            setPatients([])
            setHighlightPatientIds([])
        }
        setLoading(false)
    }

    function openCreateDialog() {
        setEditProfileId(null)
        setProfileDialogMode('create')
    }

    function openEditDialog(patient: Patient) {
        setEditProfileId(patient.id)
        setProfileDialogMode('edit')
    }

    function closeProfileDialog() {
        setProfileDialogMode(null)
        setEditProfileId(null)
    }

    async function handleImpersonate(patient: Patient) {
        if (!isAdmin) return
        if (!patient.user_id) {
            alert("Bu hastanın bağlı bir kullanıcı hesabı yok.")
            return
        }

        if (!confirm(`${patient.full_name} kullanıcısı olarak sisteme girmek üzeresiniz. Devam edilsin mi?`)) return

        await impersonateUser(patient.user_id)
    }

    async function handleDeletePatient(patient: Patient) {
        if (!confirm(`"${patient.full_name}" isimli hastayı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) {
            return
        }

        // If patient has a linked user, try to delete it first (if admin)
        if (patient.user_id && isAdmin) {
            try {
                // Call the RPC function we created
                const { error: rpcError } = await supabase.rpc('delete_user_by_admin', {
                    target_user_id: patient.user_id
                })

                if (rpcError) {
                    console.error("User deletion error (RPC):", rpcError)
                    // Don't block patient deletion, but warn in console
                } else {
                    console.log("Linked user deleted successfully via RPC.")
                }
            } catch (e) {
                console.error("RPC call exception", e)
            }
        }

        const { error } = await supabase
            .from('patients')
            .delete()
            .eq('id', patient.id)

        if (error) {
            console.error('Error deleting patient:', error)
            alert("Silme hatası: " + error.message)
        } else {
            setPatients(patients.filter(p => p.id !== patient.id))
        }
    }

    async function handleToggleArchive(patient: Patient) {
        const newStatus = patient.status === 'archived' ? 'active' : 'archived'
        const actionName = newStatus === 'active' ? 'Aktifleştirmek' : 'Arşivlemek'

        if (!confirm(`"${patient.full_name}" isimli hastayı ${actionName.toLowerCase()} istediğinize emin misiniz?`)) {
            return
        }

        const { error } = await supabase
            .from('patients')
            .update({ status: newStatus })
            .eq('id', patient.id)

        if (error) {
            console.error('Error updating patient status:', error)
            alert("Durum güncelleme hatası: " + error.message)
        } else {
            // Update local state
            setPatients(patients.map(p => p.id === patient.id ? { ...p, status: newStatus as 'active' | 'archived' } : p))
        }
    }

    async function handleApprovePatient(patient: Patient) {
        if (!confirm(`"${patient.full_name}" isimli hastanın kaydını onaylamak istediğinize emin misiniz?`)) return
        const { error } = await supabase.from('patients').update({ status: 'active' }).eq('id', patient.id)
        if (!error) {
            setPatients(patients.map(p => p.id === patient.id ? { ...p, status: 'active' } : p))
        } else {
            alert("Onaylama hatası: " + error.message)
        }
    }

    const filteredPatients = patients.filter(p => {
        // Search Filter
        const matchesSearch = p.full_name.toLowerCase().includes(search.toLowerCase())

        // Status Filter
        let matchesStatus = true
        if (filterStatus === 'active') matchesStatus = (p.status === 'active' || !p.status) // Handle null as active
        else if (filterStatus === 'archived') matchesStatus = p.status === 'archived'
        else if (filterStatus === 'pending') matchesStatus = p.status === 'pending'

        return matchesSearch && matchesStatus
    })

    const pendingCount = patients.filter(p => p.status === 'pending').length
    const ownScopeVisibleCount = filteredPatients.filter((patient) => isHighlightedPatient(patient)).length

    const sortedPatients = [...filteredPatients].sort((a, b) => {
        let aValue: any = a[sortConfig.key as keyof Patient]
        let bValue: any = b[sortConfig.key as keyof Patient]

        // Handle special cases
        if (sortConfig.key === 'program') {
            aValue = a.program_templates?.name || ''
            bValue = b.program_templates?.name || ''
        } else if (sortConfig.key === 'age') {
            const getAge = (birthDate?: string | null) => {
                if (!birthDate) return -1
                return new Date().getFullYear() - new Date(birthDate).getFullYear()
            }
            aValue = getAge(a.birth_date)
            bValue = getAge(b.birth_date)
        } else if (sortConfig.key === 'full_name') {
            aValue = a.full_name.toLowerCase()
            bValue = b.full_name.toLowerCase()
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
    })

    function handleSort(key: any) {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
        }))
    }

    function SortIcon({ column }: { column: string }) {
        if (sortConfig.key !== column) return <ArrowUpDown size={14} className="ml-1 text-gray-300 opacity-0 group-hover:opacity-50" />
        return <ArrowUpDown size={14} className={`ml-1 ${sortConfig.direction === 'asc' ? 'text-blue-600' : 'text-blue-600 rotate-180'} transition-transform`} />
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Hastalar</h2>
                    <p className="text-muted-foreground">Danışanlarınızı buradan yönetin.</p>
                    {isTeamScopeActive && (
                        <p className="text-xs text-violet-700 mt-1">
                            Takım kapsamı aktif: {filteredPatients.length} hasta listeleniyor, {visibleDietitianIds.length} sorumlu kullanıcı filtresi uygulanıyor.
                        </p>
                    )}
                    {(teamScope.role === 'doctor' || teamScope.role === 'dietitian') && (
                        <p className="text-xs text-gray-500 mt-1">
                            Sorumlu olduğunuz hastalar "Takımım" etiketiyle işaretlenir ({ownScopeVisibleCount} hasta).
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {canToggleScopeMode && (
                        <div className="flex items-center gap-3 rounded-md border bg-white px-3 py-2">
                            <span className={`text-sm ${scopeMode === 'global' ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                                Global Mod
                            </span>
                            <Switch
                                checked={scopeMode === 'team'}
                                onCheckedChange={(checked) => setScopeMode(checked ? 'team' : 'global')}
                                aria-label="Patients scope mode switch"
                            />
                            <span className={`text-sm ${scopeMode === 'team' ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                                Takım Modu
                            </span>
                        </div>
                    )}
                    <Button className="gap-2 bg-green-600 hover:bg-green-700 text-white" onClick={openCreateDialog}>
                        <Plus size={18} />
                        Yeni Hasta Ekle
                    </Button>
                </div>
            </div>

            {/* Filters & View Toggle */}
            <div className="flex flex-col sm:flex-row justify-between items-end sm:items-center gap-4 border-b pb-4">
                <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)} className="w-full sm:w-auto">
                    <TabsList>
                        <TabsTrigger value="active">Aktif</TabsTrigger>
                        <TabsTrigger value="pending" className="data-[state=active]:bg-orange-500 data-[state=active]:text-white relative">
                            Onay Bekleyenler
                            {pendingCount > 0 && (
                                <span className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                                    {pendingCount}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="archived">Arşiv</TabsTrigger>
                        <TabsTrigger value="all">Tümü</TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="flex items-center gap-2">
                    <div className="relative max-w-sm w-full sm:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Hasta ara..."
                            className="pl-8"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center border rounded-md bg-white p-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 rounded-sm ${viewMode === 'list' ? 'bg-gray-100 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                            onClick={() => setViewMode('list')}
                            title="Liste Görünümü"
                        >
                            <List size={16} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 rounded-sm ${viewMode === 'grid' ? 'bg-gray-100 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                            onClick={() => setViewMode('grid')}
                            title="Izgara Görünümü"
                        >
                            <LayoutGrid size={16} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Patient Grid / List */}
            {loading ? (
                <div className="text-center py-12 text-muted-foreground">Yükleniyor...</div>
            ) : filteredPatients.length === 0 ? (
                <div className="text-center py-12 border rounded-lg bg-gray-50">
                    <User className="mx-auto h-12 w-12 text-gray-300" />
                    <h3 className="mt-2 text-lg font-semibold text-gray-900">Hasta Bulunamadı</h3>
                    <p className="text-sm text-gray-500">Henüz kayıtlı bir hasta yok veya arama sonucu boş.</p>
                </div>
            ) : viewMode === 'grid' ? (
                // GRID VIEW
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sortedPatients.map((patient) => {
                        const isOwnScopePatient = isHighlightedPatient(patient)
                        return (
                        <Card
                            key={patient.id}
                            className={`hover:shadow-md transition-shadow cursor-pointer group relative overflow-hidden ${patient.status === 'archived' ? 'opacity-75 bg-gray-50' : ''} ${isOwnScopePatient ? 'ring-1 ring-violet-200' : ''}`}
                        >
                            <div className={`absolute top-0 left-0 w-1 h-full opacity-0 group-hover:opacity-100 transition-opacity ${patient.status === 'archived' ? 'bg-gray-400' : 'bg-gradient-to-b from-blue-400 to-blue-600'}`} />
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle
                                    className="text-lg font-medium truncate pr-4 flex-1 cursor-pointer"
                                    onClick={() => router.push(`/patients/${patient.id}`)}
                                >
                                    {patient.full_name}
                                    {isOwnScopePatient && (
                                        <span className="ml-2 inline-flex items-center rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 align-middle">
                                            Takımım
                                        </span>
                                    )}
                                </CardTitle>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                                            <MoreVertical size={16} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        {isAdmin && patient.user_id && (
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleImpersonate(patient); }}>
                                                <Eye size={14} className="mr-2" /> Kullanıcı Olarak Gir
                                            </DropdownMenuItem>
                                        )}
                                        {patient.status === 'pending' && (
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleApprovePatient(patient); }} className="text-orange-600 focus:text-orange-600">
                                                <Check size={14} className="mr-2" /> Onayla
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEditDialog(patient); }}>
                                            <Pencil size={14} className="mr-2" /> Düzenle
                                        </DropdownMenuItem>
                                        {canAssign && (
                                            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setAssignmentDialogData({ open: true, patient }) }}>
                                                <UserCog size={14} className="mr-2" /> Diyetisyen Ata
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setCloneDialogData({ open: true, patient }); }}>
                                            <Copy size={14} className="mr-2" /> Klonla
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleToggleArchive(patient); }}>
                                            {patient.status === 'archived' ? (
                                                <><RefreshCw size={14} className="mr-2" /> Aktifleştir</>
                                            ) : (
                                                <><Archive size={14} className="mr-2" /> Arşivle</>
                                            )}
                                        </DropdownMenuItem>
                                        {canDelete && (
                                            <DropdownMenuItem
                                                className="text-red-600 focus:text-red-600"
                                                onClick={(e) => { e.stopPropagation(); handleDeletePatient(patient); }}
                                            >
                                                <Trash2 size={14} className="mr-2" /> Sil
                                            </DropdownMenuItem>
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </CardHeader>
                            <CardContent onClick={() => router.push(`/patients/${patient.id}`)}>
                                <p className="text-sm text-muted-foreground line-clamp-3 h-[60px]">
                                    {patient.notes || "Not eklenmemiş."}
                                </p>
                                <div className="mt-4 text-xs text-gray-400 flex items-center justify-between">
                                    <span>Kayıt: {new Date(patient.created_at).toLocaleDateString('tr-TR')}</span>
                                    {patient.status === 'archived' && (
                                        <span className="bg-gray-200 text-gray-600 px-2 py-0.5 rounded text-[10px] font-medium">ARŞİV</span>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )})}
                </div>
            ) : (
                // LIST VIEW (TABLE)
                <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-12 gap-4 border-b bg-gray-50/50 p-4 text-xs font-medium text-gray-500">
                        <div className="col-span-1 flex items-center cursor-pointer group select-none" onClick={() => handleSort('created_at')}>
                            No <SortIcon column="created_at" />
                        </div>
                        <div className="col-span-2 flex items-center cursor-pointer group select-none" onClick={() => handleSort('full_name')}>
                            Ad Soyad <SortIcon column="full_name" />
                        </div>
                        <div className="col-span-1">
                            Program
                        </div>
                        <div className="col-span-1 text-center">
                            Plan
                        </div>
                        <div className="col-span-2">
                            Diyetisyen
                        </div>
                        <div className="col-span-1 flex items-center cursor-pointer group select-none" onClick={() => handleSort('created_at')}>
                            Tarih <SortIcon column="created_at" />
                        </div>
                        <div className="col-span-1 flex items-center cursor-pointer group select-none" onClick={() => handleSort('weight')}>
                            Kilo <SortIcon column="weight" />
                        </div>
                        <div className="col-span-1 flex items-center cursor-pointer group select-none" onClick={() => handleSort('age')}>
                            Yaş <SortIcon column="age" />
                        </div>
                        <div className="col-span-2 text-right">İşlemler</div>
                    </div>

                    {/* Table Rows */}
                    {sortedPatients.map((patient, index) => {
                        const age = patient.birth_date ? new Date().getFullYear() - new Date(patient.birth_date).getFullYear() : '-'
                        // Count weeks only from the LATEST ACTIVE plan to match the detail page
                        const activePlans = patient.diet_plans?.filter(plan => plan.status === 'active') || []
                        activePlans.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                        const latestActivePlan = activePlans[0]
                        const weekCount = latestActivePlan?.diet_weeks?.length || 0
                        const isOwnScopePatient = isHighlightedPatient(patient)
                        return (
                            <div
                                key={patient.id}
                                className={`grid grid-cols-12 gap-4 items-center p-4 border-b last:border-b-0 hover:bg-gray-50 transition-colors cursor-pointer group text-sm ${patient.status === 'archived' ? 'bg-gray-50/50 text-gray-500' : ''} ${isOwnScopePatient ? 'bg-violet-50/40' : ''}`}
                                onClick={() => router.push(`/patients/${patient.id}`)}
                            >
                                <div className="col-span-1 font-medium text-gray-400">
                                    {index + 1}
                                </div>
                                <div className="col-span-2 flex items-center gap-3">
                                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${patient.status === 'archived' ? 'bg-gray-200 text-gray-500' : 'bg-blue-100 text-blue-600'}`}>
                                        {patient.full_name.substring(0, 1)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-medium truncate">{patient.full_name}</div>
                                    </div>
                                    {isOwnScopePatient && (
                                        <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0">
                                            Takımım
                                        </span>
                                    )}
                                    {patient.status === 'archived' && (
                                        <span className="bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0">ARŞİV</span>
                                    )}
                                </div>
                                <div className="col-span-1 text-gray-600 truncate text-xs">
                                    {patient.program_templates?.name || <span className="text-gray-300 italic">-</span>}
                                </div>
                                <div className="col-span-1 text-center">
                                    {weekCount > 0 ? (
                                        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-medium">
                                            {weekCount}
                                        </span>
                                    ) : (
                                        <span className="text-gray-300 italic">-</span>
                                    )}
                                </div>
                                <div className="col-span-2 text-gray-600 truncate text-xs">
                                    {patient.patient_assignments && patient.patient_assignments.length > 0 ? (
                                        patient.patient_assignments
                                            .filter(a => a.profiles?.full_name)
                                            .map(a => a.profiles?.full_name)
                                            .join(', ') || <span className="text-gray-300 italic">-</span>
                                    ) : (
                                        <span className="text-gray-300 italic">-</span>
                                    )}
                                </div>
                                <div className="col-span-1 text-gray-600 text-xs">
                                    {new Date(patient.created_at).toLocaleDateString('tr-TR')}
                                </div>
                                <div className="col-span-1 text-gray-600 text-xs">
                                    {patient.weight ? `${patient.weight} kg` : '-'}
                                </div>
                                <div className="col-span-1 text-gray-600 text-xs">
                                    {age}
                                </div>
                                <div className="col-span-2 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                        {isAdmin && patient.user_id && (
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-purple-600" onClick={(e) => { e.stopPropagation(); handleImpersonate(patient); }}>
                                                <Eye size={14} />
                                            </Button>
                                        )}
                                        {patient.status === 'pending' && (
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-400 hover:text-orange-600" title="Onayla" onClick={(e) => { e.stopPropagation(); handleApprovePatient(patient); }}>
                                                <Check size={14} />
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); openEditDialog(patient); }}>
                                            <Pencil size={14} />
                                        </Button>
                                        {canAssign && (
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-amber-600" onClick={(e) => { e.stopPropagation(); setAssignmentDialogData({ open: true, patient }) }}>
                                                <UserCog size={14} />
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-green-600" onClick={(e) => { e.stopPropagation(); setCloneDialogData({ open: true, patient }); }}>
                                            <Copy size={14} />
                                        </Button>
                                        {canDelete && (
                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); handleDeletePatient(patient); }}>
                                                <Trash2 size={14} />
                                            </Button>
                                        )}
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 group-hover:text-gray-700 sm:hidden">
                                                <MoreVertical size={16} />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {isAdmin && patient.user_id && (
                                                <DropdownMenuItem onClick={() => handleImpersonate(patient)}>
                                                    <Eye size={14} className="mr-2" /> Kullanıcı Olarak Gir
                                                </DropdownMenuItem>
                                            )}
                                            {patient.status === 'pending' && (
                                                <DropdownMenuItem onClick={() => handleApprovePatient(patient)} className="text-orange-600 focus:text-orange-600">
                                                    <Check size={14} className="mr-2" /> Onayla
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={() => openEditDialog(patient)}>
                                                <Pencil size={14} className="mr-2" /> Düzenle
                                            </DropdownMenuItem>
                                            {canAssign && (
                                                <DropdownMenuItem onClick={() => setAssignmentDialogData({ open: true, patient })}>
                                                    <UserCog size={14} className="mr-2" /> Diyetisyen Ata
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={() => setCloneDialogData({ open: true, patient })}>
                                                <Copy size={14} className="mr-2" /> Klonla
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleToggleArchive(patient)}>
                                                {patient.status === 'archived' ? (
                                                    <><RefreshCw size={14} className="mr-2" /> Aktifleştir</>
                                                ) : (
                                                    <><Archive size={14} className="mr-2" /> Arşivle</>
                                                )}
                                            </DropdownMenuItem>
                                            {canDelete && (
                                                <DropdownMenuItem
                                                    className="text-red-600 focus:text-red-600"
                                                    onClick={() => handleDeletePatient(patient)}
                                                >
                                                    <Trash2 size={14} className="mr-2" /> Sil
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}


            {/* Unified Patient Profile Dialog (Create & Edit) */}
            <PatientProfileDialog
                open={profileDialogMode !== null}
                onOpenChange={(open) => {
                    if (!open) closeProfileDialog()
                }}
                patientId={editProfileId || undefined}
                mode={profileDialogMode === 'create' ? 'create' : 'edit'}
                onSuccess={() => {
                    fetchPatients()
                    closeProfileDialog()
                }}
            />

            {/* Clone Dialog */}
            <PatientCloneDialog
                open={cloneDialogData.open}
                onOpenChange={(open) => setCloneDialogData(prev => ({ ...prev, open }))}
                sourcePatientId={cloneDialogData.patient?.id || ""}
                sourcePatientName={cloneDialogData.patient?.full_name || ""}
                onSuccess={() => {
                    fetchPatients()
                    setCloneDialogData({ open: false, patient: null })
                }}
            />

            {/* Assignment Dialog */}
            <PatientAssignmentDialog
                open={assignmentDialogData.open}
                onOpenChange={(open) => setAssignmentDialogData(prev => ({ ...prev, open }))}
                patient={assignmentDialogData.patient}
                onSuccess={() => {
                    // Optional: refresh list if we showed assignment info in table
                    fetchPatients()
                }}
            />
        </div>
    )
}

