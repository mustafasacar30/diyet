"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth, UserRole } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabase"
import { Plus, Users, Shield, UserCog, Network, Utensils, Activity, Bot, Settings } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export default function AdminDashboard() {
    const { isAdmin, isStaff, loading, profile } = useAuth()
    const router = useRouter()
    const [stats, setStats] = useState({
        doctors: 0,
        dietitians: 0,
        patients: 0,
        activePrograms: 0,
        totalDietTypes: 0,
        totalFoods: 0
    })
    const [inviteOpen, setInviteOpen] = useState(false)

    useEffect(() => {
        // Only redirect if loading done AND profile loaded AND not staff (Admin, Doctor, Dietitian)
        if (!loading && profile && !isStaff) {
            router.push("/") // Redirect unauthorized (patients or others)
        }
    }, [isStaff, loading, router, profile])

    useEffect(() => {
        if (isAdmin) loadStats()
    }, [isAdmin])

    async function loadStats() {
        const [
            { count: doctors },
            { count: dietitians },
            { count: patients },
            { count: activePrograms },
            { count: totalDietTypes },
            { count: totalFoods }
        ] = await Promise.all([
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'doctor'),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'dietitian'),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'patient'),
            supabase.from('program_templates').select('*', { count: 'exact', head: true }).eq('is_active', true),
            supabase.from('diet_types').select('*', { count: 'exact', head: true }).is('patient_id', null),
            supabase.from('foods').select('*', { count: 'exact', head: true })
        ])

        setStats({
            doctors: doctors || 0,
            dietitians: dietitians || 0,
            patients: patients || 0,
            activePrograms: activePrograms || 0,
            totalDietTypes: totalDietTypes || 0,
            totalFoods: totalFoods || 0
        })
    }

    if (loading || !isStaff) return <div className="p-10 text-center">Yükleniyor...</div>

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900">Yönetim Paneli</h1>
                    <p className="text-gray-500">Sistem genelindeki kullanıcı ve takımları yönetin.</p>
                </div>
                <Button onClick={() => setInviteOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Yeni Profesyonel Ekle
                </Button>
            </div>

            {/* Stats Cards - Clickable for Navigation */}
            {isAdmin && (
                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                    <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/admin/users?role=patient')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Toplam Hasta</CardTitle>
                            <Users className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.patients}</div>
                        </CardContent>
                    </Card>
                    <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/programs?tab=programs')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Aktif Programlar</CardTitle>
                            <Activity className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.activePrograms}</div>
                        </CardContent>
                    </Card>
                    <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/programs?tab=diet-types')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Diyet Türleri</CardTitle>
                            <Shield className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.totalDietTypes}</div>
                        </CardContent>
                    </Card>
                    <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/admin/recipes')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Yemek Veritabanı</CardTitle>
                            <Utensils className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.totalFoods}</div>
                        </CardContent>
                    </Card>
                    <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/admin/users?role=doctor')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Doktorlar</CardTitle>
                            <Shield className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.doctors}</div>
                        </CardContent>
                    </Card>
                    <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/admin/users?role=dietitian')}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">Diyetisyenler</CardTitle>
                            <UserCog className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.dietitians}</div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Actions Grid - Removed Redundant Active Program/Diet Types Cards */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/admin/users')}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Users size={20} /> Kullanıcı Yönetimi
                        </CardTitle>
                        <p className="text-sm text-gray-500">Tüm kullanıcıları listele, düzenle veya sil.</p>
                    </CardHeader>
                </Card>

                <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/admin/teams')}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Network size={20} /> Takım Yapılandırması
                        </CardTitle>
                        <p className="text-sm text-gray-500">Doktor-Diyetisyen ilişkilerini kur.</p>
                    </CardHeader>
                </Card>

                {/* Recipes/Cards Action - Kept as explicit action for broader management, or could be removed if integrated into stats. 
                    User asked to remove redundancy for programs/diet types, not explicitly this one. 
                    But stats card "Yemek Veritabanı" links to /admin/recipes now. 
                    So let's keep this if it implies more than just database view, or remove it?
                    The stat says "Yemek Veritabanı" (Food DB), this says "Tarif ve Kart Yönetimi" (Recipe & Card Mgmt). 
                    Let's keep it for clarity but ensure stats link works too. 
                    Actually, redundancy is bad. Let's rely on the stats card if possible, 
                    OR keep this one and make stats card link to /foods (raw db). 
                    Let's KEEP this one for now to be safe, but removed the Programs/DietTypes ones.
                */}
                <Card className="hover:bg-gray-50 cursor-pointer transition-colors" onClick={() => router.push('/admin/recipes')}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Utensils size={20} /> Tarif ve Kart Yönetimi
                        </CardTitle>
                        <p className="text-sm text-gray-500">Yemek tariflerini kartlarla eşleştir.</p>
                    </CardHeader>
                </Card>

                <Card className="hover:bg-emerald-50 cursor-pointer transition-colors border-emerald-100" onClick={() => router.push('/admin/settings/food-options')}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg text-emerald-700">
                            <Settings size={20} /> Gıda Seçenekleri
                        </CardTitle>
                        <p className="text-sm text-emerald-600">Kategori, rol ve öğün türlerini yönet.</p>
                    </CardHeader>
                </Card>

                <Card className="hover:bg-indigo-50 cursor-pointer transition-colors border-indigo-200" onClick={() => router.push('/admin/rules')}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg text-indigo-700">
                            <Activity size={20} /> Planlama Motoru
                        </CardTitle>
                        <p className="text-sm text-indigo-600">Otomatik planlayıcı kurallarını yönet.</p>
                    </CardHeader>
                </Card>

                <Card className="hover:bg-purple-50 cursor-pointer transition-colors border-purple-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg text-purple-700">
                            <Bot size={20} /> AI Ayarları & Prompt
                        </CardTitle>
                        <p className="text-sm text-purple-600 mb-4">Gemini model ve prompt ayarlarını yönet.</p>
                    </CardHeader>
                    <CardContent>
                        <Link href="/admin/settings/ai">
                            <Button className="w-full bg-purple-600 hover:bg-purple-700">AI Ayarlarına Git</Button>
                        </Link>
                    </CardContent>
                </Card>

                <Card className="hover:shadow-lg transition-shadow border-gray-200">
                    <CardContent className="p-6">
                        <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
                            <Settings size={20} /> Genel Ayarlar
                        </h2>
                        <p className="text-sm text-gray-500 mb-4">Uygulama genel kayıt ve izin ayarları.</p>
                        <Link href="/admin/settings/general">
                            <Button className="w-full bg-slate-800 hover:bg-slate-900">Ayarlara Git</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>

            {/* Invite Dialog */}
            <InviteProfessionalDialog open={inviteOpen} onOpenChange={setInviteOpen} />
        </div>
    )
}

function InviteProfessionalDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (o: boolean) => void }) {
    const [email, setEmail] = useState("")
    const [role, setRole] = useState<UserRole>("dietitian")
    const [name, setName] = useState("")
    const [loading, setLoading] = useState(false)

    async function handleInvite() {
        setLoading(true)
        // In a real app, this would call supabase.auth.admin.inviteUserByEmail
        // But since we are client side, we might create a user with a temp password or just a profile entry?
        // Supabase Client SDK cannot create users without auto-login unless Service Role key is used.
        // For this demo, we can just insert into profiles if we assume auth user is created separately, 
        // OR we can't fully implement creation without a backend function.

        // Simulating flow: We assume the user creates the account themselves, 
        // OR admins use the Supabase Dashboard. 
        // BUT users want a "Create User" button.
        // Best approach for client-side demo: Show a "Copy Invite Link" or similar, 
        // but since we want functionality: 
        // We will mock the "Invite" by showing an alert that says "User Created" 
        // and ideally inserting a row into a `pending_invites` table if we had one.

        // For now, let's just log it. Real implementation needs Supabase Admin API (Edge Function).
        alert("Üzgünüm, istemci tarafından doğrudan kullanıcı oluşturulamıyor (Admin API gerekli). Lütfen Supabase Dashboard'dan kullanıcıyı ekleyin veya Edge Function kurun.")
        setLoading(false)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Yeni Profesyonel Ekle</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Ad Soyad</Label>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Dr. Ahmet Yılmaz" />
                    </div>
                    <div className="space-y-2">
                        <Label>E-posta</Label>
                        <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="ahmet@klinik.com" />
                    </div>
                    <div className="space-y-2">
                        <Label>Rol</Label>
                        <Select value={role} onValueChange={(v: any) => setRole(v)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="doctor">Doktor / Baş Diyetisyen</SelectItem>
                                <SelectItem value="dietitian">Diyetisyen</SelectItem>
                                <SelectItem value="admin">Yönetici</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button className="w-full" onClick={handleInvite} disabled={loading}>
                        {loading ? "Ekleniyor..." : "Davet Gönder / Ekle"}
                    </Button>
                    <p className="text-xs text-red-500 mt-2">
                        Not: Gerçek kullanıcı oluşturma işlemi için Supabase Service Role Key gereklidir.
                        Bu demo ortamında bu işlem simüle edilmektedir.
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    )
}
