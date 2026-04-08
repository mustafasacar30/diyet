"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { ArrowLeft, UserPlus, Trash2, Shield, UserCog, Users, ChevronRight, Plus, Save } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

type Profile = {
    id: string
    full_name: string
    role: string
    title?: string
}

type TeamMember = {
    id: string
    member_id: string
    status: string
    profile: Profile
}

type PatientInfo = {
    id: string
    full_name: string
    status?: string
    assignment_id?: string
}

export default function AdminTeamsPage() {
    const { isAdmin, loading, profile } = useAuth()
    const router = useRouter()
    const isDoctor = profile?.role === 'doctor'
    const canManageTeams = isAdmin // Only admin can add/remove dietitians
    const canManagePatients = isAdmin || isDoctor // Both can assign patients

    const [doctors, setDoctors] = useState<Profile[]>([])
    const [selectedDoctor, setSelectedDoctor] = useState<Profile | null>(null)
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])

    const [selectedDietitian, setSelectedDietitian] = useState<TeamMember | null>(null)
    const [dietitianPatients, setDietitianPatients] = useState<PatientInfo[]>([])
    const [loadingPatients, setLoadingPatients] = useState(false)

    const [availableDietitians, setAvailableDietitians] = useState<Profile[]>([])
    const [assignDialogOpen, setAssignDialogOpen] = useState(false)
    const [selectedDietitianId, setSelectedDietitianId] = useState<string>("")

    const [assignPatientDialogOpen, setAssignPatientDialogOpen] = useState(false)
    const [availablePatients, setAvailablePatients] = useState<PatientInfo[]>([])
    const [selectedPatientId, setSelectedPatientId] = useState<string>("")
    const [teamFooterText, setTeamFooterText] = useState("")
    const [teamFooterSaving, setTeamFooterSaving] = useState(false)

    useEffect(() => {
        // Allow admin and doctors
        if (!loading && profile && !isAdmin && !isDoctor) router.push("/")
    }, [isAdmin, isDoctor, loading, router, profile])

    useEffect(() => {
        if (isAdmin) {
            loadDoctors()
        } else if (isDoctor && profile?.id) {
            // Doctor mode: auto-select themselves
            setDoctors([{ id: profile.id, full_name: profile.full_name || '', role: 'doctor', title: profile.title || undefined }])
            setSelectedDoctor({ id: profile.id, full_name: profile.full_name || '', role: 'doctor', title: profile.title || undefined })
        }
    }, [isAdmin, isDoctor, profile])

    useEffect(() => {
        if (selectedDoctor) {
            loadTeam(selectedDoctor.id)
            loadTeamBranding(selectedDoctor.id)
            setSelectedDietitian(null)
            setDietitianPatients([])
        } else {
            setTeamMembers([])
            setTeamFooterText("")
            setSelectedDietitian(null)
            setDietitianPatients([])
        }
    }, [selectedDoctor])

    useEffect(() => {
        if (selectedDietitian) {
            loadDietitianPatients(selectedDietitian.member_id)
        } else {
            setDietitianPatients([])
        }
    }, [selectedDietitian])

    async function loadDoctors() {
        const { data } = await supabase.from('profiles').select('*').eq('role', 'doctor')
        if (data) setDoctors(data)
    }

    async function loadTeam(supervisorId: string) {
        const { data, error } = await supabase
            .from('team_members')
            .select(`
                id,
                member_id,
                status,
                member:profiles!member_id (id, full_name, role, title)
            `)
            .eq('supervisor_id', supervisorId)

        if (data) {
            const formatted = data.map((d: any) => ({
                id: d.id,
                member_id: d.member_id,
                status: d.status,
                profile: d.member
            }))
            setTeamMembers(formatted)
        }
    }

    async function loadTeamBranding(supervisorId: string) {
        try {
            const res = await fetch(`/api/team-branding?supervisor_id=${encodeURIComponent(supervisorId)}`)
            const result = await res.json()
            if (!res.ok) {
                console.error("Team branding load error:", result?.error)
                setTeamFooterText("")
                return
            }
            setTeamFooterText(result?.footerText || "")
        } catch (error) {
            console.error("Team branding load exception:", error)
            setTeamFooterText("")
        }
    }

    async function saveTeamBranding() {
        if (!selectedDoctor) return

        setTeamFooterSaving(true)
        try {
            const res = await fetch('/api/team-branding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    supervisor_id: selectedDoctor.id,
                    footer_text: teamFooterText,
                })
            })
            const result = await res.json()
            if (!res.ok) {
                alert("Takım PDF metni kaydedilemedi: " + (result?.error || "Bilinmeyen hata"))
                return
            }
            setTeamFooterText(result?.footerText || "")
        } catch (error: any) {
            alert("Takım PDF metni kaydedilemedi: " + (error?.message || "Bilinmeyen hata"))
        } finally {
            setTeamFooterSaving(false)
        }
    }

    async function loadDietitianPatients(dietitianId: string) {
        setLoadingPatients(true)
        try {
            const { data: assignments, error: assignErr } = await supabase
                .from('patient_assignments')
                .select(`
                    id,
                    patient_id,
                    patients (
                        id,
                        full_name,
                        status
                    )
                `)
                .eq('dietitian_id', dietitianId)

            if (assignErr) {
                console.error("Error loading patient assignments:", assignErr)
                const { data: directPatients } = await supabase
                    .from('patients')
                    .select('id, full_name, status')
                    .eq('dietitian_id', dietitianId)
                    .order('full_name', { ascending: true })
                setDietitianPatients(directPatients || [])
            } else {
                const patients = (assignments || [])
                    .filter((a: any) => a.patients)
                    .map((a: any) => ({
                        id: a.patients.id,
                        full_name: a.patients.full_name,
                        status: a.patients.status,
                        assignment_id: a.id
                    }))
                    .sort((a: PatientInfo, b: PatientInfo) => (a.full_name || '').localeCompare(b.full_name || '', 'tr'))
                setDietitianPatients(patients)
            }
        } catch (err) {
            console.error("Error loading patients:", err)
            setDietitianPatients([])
        } finally {
            setLoadingPatients(false)
        }
    }

    async function loadAvailableDietitians() {
        const { data } = await supabase.from('profiles').select('*').eq('role', 'dietitian')
        if (data) {
            const currentMemberIds = teamMembers.map(m => m.member_id)
            const available = data.filter(d => !currentMemberIds.includes(d.id))
            setAvailableDietitians(available)
        }
    }

    async function loadAvailablePatients() {
        if (!selectedDietitian || !selectedDoctor) return

        // For doctors: only show patients already within their team scope
        // For admins: show all patients
        if (isDoctor && !isAdmin) {
            // Get all dietitian IDs in this doctor's team (including the doctor themselves)
            const teamDietitianIds = [selectedDoctor.id, ...teamMembers.map(m => m.member_id)]

            // Get patient IDs assigned to any team member
            const { data: teamAssignments } = await supabase
                .from('patient_assignments')
                .select('patient_id')
                .in('dietitian_id', teamDietitianIds)

            const teamPatientIds = [...new Set((teamAssignments || []).map(a => a.patient_id).filter(Boolean))]

            if (teamPatientIds.length === 0) {
                setAvailablePatients([])
                return
            }

            const { data: teamPatients } = await supabase
                .from('patients')
                .select('id, full_name, status')
                .in('id', teamPatientIds)
                .not('gender', 'is', null)
                .neq('status', 'archived')
                .order('full_name', { ascending: true })

            if (teamPatients) {
                const existingIds = new Set(dietitianPatients.map(p => p.id))
                const available = teamPatients.filter(p => !existingIds.has(p.id))
                setAvailablePatients(available)
            }
        } else {
            // Admin: show all patients
            const { data: allPatients } = await supabase
                .from('patients')
                .select('id, full_name, status')
                .not('gender', 'is', null)
                .neq('status', 'archived')
                .order('full_name', { ascending: true })

            if (allPatients) {
                const existingIds = new Set(dietitianPatients.map(p => p.id))
                const available = allPatients.filter(p => !existingIds.has(p.id))
                setAvailablePatients(available)
            }
        }
    }

    async function handleAssign() {
        if (!selectedDoctor || !selectedDietitianId) return
        const { error } = await supabase.from('team_members').insert({
            supervisor_id: selectedDoctor.id,
            member_id: selectedDietitianId,
            status: 'active'
        })
        if (!error) {
            loadTeam(selectedDoctor.id)
            setAssignDialogOpen(false)
            setSelectedDietitianId("")
        } else {
            alert("Atama başarısız: " + error.message)
        }
    }

    async function handleAssignPatient() {
        if (!selectedDietitian || !selectedPatientId || !selectedDoctor) return

        try {
            const res = await fetch('/api/admin/assign-patient', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientId: selectedPatientId,
                    dietitianId: selectedDietitian.member_id,
                    doctorId: selectedDoctor.id,
                })
            })

            const result = await res.json()
            if (!res.ok) {
                alert("Hasta atama başarısız: " + (result.error || "Bilinmeyen hata"))
                return
            }
        } catch (err) {
            console.error("Error assigning patient:", err)
            alert("Hasta atama başarısız.")
            return
        }

        loadDietitianPatients(selectedDietitian.member_id)
        setAssignPatientDialogOpen(false)
        setSelectedPatientId("")
    }

    async function removePatientAssignment(assignmentId: string) {
        if (!confirm("Bu hastayı bu diyetisyenden kaldırmak istediğinize emin misiniz?")) return
        if (!selectedDoctor) return

        try {
            // Use server-side API route to bypass RLS
            const res = await fetch('/api/admin/remove-patient-assignment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    assignmentId,
                    doctorId: selectedDoctor.id,
                    mode: 'park'
                })
            })

            const result = await res.json()
            if (!res.ok) {
                console.error("Error removing patient assignment:", result.error)
                alert("Hasta kaldırma başarısız: " + (result.error || "Bilinmeyen hata"))
                return
            }
        } catch (err) {
            console.error("Error removing patient assignment:", err)
            alert("Hasta kaldırma başarısız.")
            return
        }

        if (selectedDietitian) loadDietitianPatients(selectedDietitian.member_id)
    }

    async function removeMember(relationId: string) {
        if (!confirm("Bu diyetisyeni takımdan çıkarmak istediğinize emin misiniz?")) return
        await supabase.from('team_members').delete().eq('id', relationId)
        if (selectedDoctor) loadTeam(selectedDoctor.id)
        if (selectedDietitian?.id === relationId) {
            setSelectedDietitian(null)
        }
    }

    if (loading || (!isAdmin && !isDoctor)) return null

    // For doctor mode: skip the doctors column, show 2 columns directly
    const showDoctorsList = isAdmin

    return (
        <div className="p-6 max-w-[1400px] mx-auto space-y-6 h-[calc(100vh-60px)] flex flex-col">
            <div className="flex items-center gap-4 shrink-0">
                {isAdmin && (
                    <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push('/admin')}>
                        <ArrowLeft size={16} className="mr-1" />
                        Panele Dön
                    </Button>
                )}
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        {isDoctor && !isAdmin ? 'Takımım' : 'Takım Yapılandırması'}
                    </h1>
                    <p className="text-gray-500 text-sm">
                        {isDoctor && !isAdmin
                            ? 'Takımınızdaki diyetisyenler ve hastalarını görüntüleyin.'
                            : 'Doktorlar → Diyetisyenler → Hastalar hiyerarşisini yönetin.'}
                    </p>
                </div>
            </div>

            {selectedDoctor && (
                <Card className="shrink-0 bg-white shadow-sm border">
                    <CardContent className="pt-5 pb-4">
                        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                            <div className="space-y-2">
                                <Label htmlFor="team-footer-text">Takım PDF Metni (Oncelik 1)</Label>
                                <Input
                                    id="team-footer-text"
                                    value={teamFooterText}
                                    onChange={(e) => setTeamFooterText(e.target.value)}
                                    placeholder="Orn: Lipodem Merkezi - Klinik Adi"
                                />
                                <p className="text-xs text-gray-500">
                                    PDF'te logo altinda metin onceligi: Takim &gt; Doktor &gt; Diyetisyen.
                                </p>
                            </div>
                            <Button onClick={saveTeamBranding} disabled={teamFooterSaving} className="gap-2">
                                <Save className="h-4 w-4" />
                                {teamFooterSaving ? "Kaydediliyor..." : "Takim Metnini Kaydet"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className={`grid grid-cols-1 gap-4 flex-1 min-h-0 ${showDoctorsList ? 'md:grid-cols-12' : 'md:grid-cols-2'}`}>
                {/* Column 1: Doctors List (Admin only) */}
                {showDoctorsList && (
                    <Card className="flex flex-col h-full bg-white shadow-sm border md:col-span-3">
                        <CardHeader className="py-4 px-4 border-b bg-gray-50">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Shield className="h-4 w-4 text-blue-600" />
                                Doktorlar (Baş Diyetisyen)
                            </CardTitle>
                        </CardHeader>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {doctors.length === 0 && <p className="text-xs text-gray-500 p-4 text-center">Henüz doktor bulunmuyor.</p>}
                            {doctors.map(doc => (
                                <div
                                    key={doc.id}
                                    onClick={() => setSelectedDoctor(doc)}
                                    className={`p-3 rounded-lg cursor-pointer transition-all flex items-center gap-3 border ${selectedDoctor?.id === doc.id ? 'bg-blue-50 border-blue-200 shadow-sm' : 'hover:bg-gray-50 border-transparent'}`}
                                >
                                    <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                                        {doc.full_name?.charAt(0) || "D"}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 truncate">{doc.full_name || "İsimsiz"}</div>
                                        <div className="text-xs text-gray-500 truncate">{doc.title || "Ünvan yok"}</div>
                                    </div>
                                    {selectedDoctor?.id === doc.id && <ChevronRight size={14} className="text-blue-500 shrink-0" />}
                                </div>
                            ))}
                        </div>
                    </Card>
                )}

                {/* Column 2: Team Members (Dietitians) */}
                <Card className={`flex flex-col h-full bg-white shadow-sm border ${showDoctorsList ? 'md:col-span-4' : ''}`}>
                    <CardHeader className="py-4 px-4 border-b flex flex-row items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`h-9 w-9 rounded-full ${selectedDoctor ? 'bg-blue-600' : 'bg-gray-300'} text-white flex items-center justify-center font-bold text-sm shrink-0`}>
                                {selectedDoctor ? (selectedDoctor.full_name?.charAt(0) || "D") : "?"}
                            </div>
                            <div className="min-w-0">
                                <CardTitle className="text-sm font-bold truncate">
                                    {isDoctor && !isAdmin
                                        ? 'Diyetisyenlerim'
                                        : selectedDoctor ? selectedDoctor.full_name + "'in Takımı" : "Doktor Seçiniz"}
                                </CardTitle>
                                {selectedDoctor && <p className="text-xs text-gray-500">{teamMembers.length} diyetisyen</p>}
                            </div>
                        </div>
                        {/* Only admin can add/remove dietitians */}
                        {canManageTeams && selectedDoctor && (
                            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={loadAvailableDietitians}>
                                        <UserPlus className="h-3.5 w-3.5 mr-1" /> Ekle
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Takıma Diyetisyen Ekle</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-600">
                                                <span className="font-semibold">{selectedDoctor.full_name}</span> adlı yöneticinin takımına eklenecek diyetisyeni seçin.
                                            </p>
                                            <Select onValueChange={setSelectedDietitianId}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Diyetisyen Seçin..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availableDietitians.map(d => (
                                                        <SelectItem key={d.id} value={d.id}>
                                                            {d.full_name || "İsimsiz"} ({d.title || "Ünvan yok"})
                                                        </SelectItem>
                                                    ))}
                                                    {availableDietitians.length === 0 && (
                                                        <div className="p-2 text-xs text-gray-500 text-center">Uygun diyetisyen bulunamadı.</div>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Button className="w-full" onClick={handleAssign} disabled={!selectedDietitianId}>
                                            Atamayı Yap
                                        </Button>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        )}
                    </CardHeader>
                    <div className="flex-1 overflow-y-auto p-3">
                        {!selectedDoctor ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <Shield className="h-10 w-10 mb-3 opacity-20" />
                                <p className="text-sm">Soldan bir doktor seçin.</p>
                            </div>
                        ) : teamMembers.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <UserCog className="h-10 w-10 mb-3 opacity-20" />
                                <p className="text-sm">Bu takımda henüz diyetisyen yok.</p>
                                {canManageTeams && (
                                    <Button variant="link" size="sm" onClick={() => { loadAvailableDietitians(); setAssignDialogOpen(true); }}>
                                        Hemen bir tane ekleyin
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {teamMembers.map(member => (
                                    <div
                                        key={member.id}
                                        onClick={() => setSelectedDietitian(member)}
                                        className={`border rounded-lg p-3 cursor-pointer transition-all bg-white flex items-center justify-between group ${selectedDietitian?.id === member.id ? 'border-green-300 bg-green-50 shadow-sm' : 'hover:bg-gray-50 hover:shadow-sm border-gray-200'}`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`h-9 w-9 rounded-full ${selectedDietitian?.id === member.id ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'} flex items-center justify-center font-bold text-xs shrink-0 transition-colors`}>
                                                {member.profile?.full_name?.charAt(0) || "D"}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-gray-900 truncate">{member.profile?.full_name}</div>
                                                <div className="text-xs text-green-600 font-medium">Diyetisyen</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {/* Only admin can remove dietitians */}
                                            {canManageTeams && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
                                                    onClick={(e) => { e.stopPropagation(); removeMember(member.id); }}
                                                    title="Takımdan Çıkar"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                            {selectedDietitian?.id === member.id && <ChevronRight size={14} className="text-green-500 shrink-0" />}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Card>

                {/* Column 3: Dietitian's Patients */}
                <Card className={`flex flex-col h-full bg-white shadow-sm border ${showDoctorsList ? 'md:col-span-5' : ''}`}>
                    <CardHeader className="py-4 px-4 border-b bg-gray-50 flex flex-row items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`h-9 w-9 rounded-full ${selectedDietitian ? 'bg-green-600' : 'bg-gray-300'} text-white flex items-center justify-center font-bold text-sm shrink-0`}>
                                {selectedDietitian ? (selectedDietitian.profile?.full_name?.charAt(0) || "D") : "?"}
                            </div>
                            <div className="min-w-0">
                                <CardTitle className="text-sm font-bold truncate">
                                    {selectedDietitian ? selectedDietitian.profile?.full_name + " — Hastalar" : "Diyetisyen Seçiniz"}
                                </CardTitle>
                                {selectedDietitian && (
                                    <p className="text-xs text-gray-500">
                                        {loadingPatients ? "Yükleniyor..." : `${dietitianPatients.length} hasta`}
                                    </p>
                                )}
                            </div>
                        </div>
                        {/* Both admin and doctor can assign patients */}
                        {canManagePatients && selectedDietitian && (
                            <Dialog open={assignPatientDialogOpen} onOpenChange={setAssignPatientDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button size="sm" variant="outline" className="shrink-0 text-xs" onClick={loadAvailablePatients}>
                                        <Plus className="h-3.5 w-3.5 mr-1" /> Hasta Ata
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Diyetisyene Hasta Ata</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-600">
                                                <span className="font-semibold">{selectedDietitian.profile?.full_name}</span> adlı diyetisyene atanacak hastayı seçin.
                                            </p>
                                            <Select onValueChange={setSelectedPatientId}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Hasta Seçin..." />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {availablePatients.map(p => (
                                                        <SelectItem key={p.id} value={p.id}>
                                                            {p.full_name || "İsimsiz"}
                                                        </SelectItem>
                                                    ))}
                                                    {availablePatients.length === 0 && (
                                                        <div className="p-2 text-xs text-gray-500 text-center">Uygun hasta bulunamadı.</div>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Button className="w-full" onClick={handleAssignPatient} disabled={!selectedPatientId}>
                                            Hastayı Ata
                                        </Button>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        )}
                    </CardHeader>
                    <div className="flex-1 overflow-y-auto p-3">
                        {!selectedDietitian ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <Users className="h-10 w-10 mb-3 opacity-20" />
                                <p className="text-sm text-center">Hastaları görmek için<br />bir diyetisyen seçin.</p>
                            </div>
                        ) : loadingPatients ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-green-600 mb-3"></div>
                                <p className="text-sm">Hastalar yükleniyor...</p>
                            </div>
                        ) : dietitianPatients.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400">
                                <Users className="h-10 w-10 mb-3 opacity-20" />
                                <p className="text-sm">Bu diyetisyene atanmış hasta yok.</p>
                                {canManagePatients && (
                                    <Button variant="link" size="sm" onClick={() => { loadAvailablePatients(); setAssignPatientDialogOpen(true); }}>
                                        Hemen bir tane atayın
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                {dietitianPatients.map(patient => (
                                    <div
                                        key={patient.id}
                                        className="border border-gray-200 rounded-lg p-3 transition-all bg-white hover:bg-blue-50 hover:border-blue-200 hover:shadow-sm flex items-center justify-between group"
                                    >
                                        <div
                                            className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                                            onClick={() => router.push(`/patients/${patient.id}`)}
                                        >
                                            <div className="h-8 w-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs shrink-0">
                                                {patient.full_name?.charAt(0) || "H"}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-gray-900 truncate">{patient.full_name || "İsimsiz"}</div>
                                                <div className={`text-xs font-medium ${patient.status === 'archived' ? 'text-gray-400' : 'text-purple-600'}`}>
                                                    {patient.status === 'archived' ? 'Arşivlenmiş' : 'Aktif Hasta'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {canManagePatients && patient.assignment_id && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
                                                    onClick={() => removePatientAssignment(patient.assignment_id!)}
                                                    title="Bu diyetisyenden kaldır"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                            <ChevronRight
                                                size={14}
                                                className="text-gray-300 group-hover:text-blue-500 shrink-0 transition-colors cursor-pointer"
                                                onClick={() => router.push(`/patients/${patient.id}`)}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Card>
            </div>
        </div>
    )
}
