"use client"

import { useEffect, useState } from "react"
import { useAuth, UserRole } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { adminFetchAllUsers } from "@/actions/admin-db-actions"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ArrowLeft, MoreHorizontal, User as UserIcon, Shield, UserCog, Stethoscope, PlusCircle, Pencil, Trash2, MessageCircle } from "lucide-react"

import { CreateUserDialog } from "./create-user-dialog"
import { UpdateUserDialog } from "./update-user-dialog"
import { PatientProfileDialog } from "@/components/diet/patient-profile-dialog"
import { deleteUserCompletely } from "@/actions/auth-actions"

export default function AdminUsersPage() {
    const { isAdmin, loading, impersonateUser, profile } = useAuth()
    const router = useRouter()
    const [users, setUsers] = useState<any[]>([])
    const [isLoadingData, setIsLoadingData] = useState(true)
    const [isCreateOpen, setIsCreateOpen] = useState(false)

    // Update Dialog State
    const [isUpdateOpen, setIsUpdateOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<any>(null)

    // Patient Profile Dialog state
    const [patientProfileOpen, setPatientProfileOpen] = useState(false)
    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)

    // ... (useEffect hooks and fetchUsers remain same)

    useEffect(() => {
        // Only redirect if loading is done AND profile is loaded (not null) AND user is not admin
        // This prevents race condition where isAdmin is false before profile loads
        if (!loading && profile && !isAdmin) {
            router.push("/")
        }
    }, [isAdmin, loading, router, profile])

    useEffect(() => {
        if (isAdmin) fetchUsers()
    }, [isAdmin])

    async function fetchUsers() {
        setIsLoadingData(true)
        try {
            const result = await adminFetchAllUsers()
            if (result.error) {
                console.error("Fetch users error:", result.error)
            } else if (result.data) {
                setUsers(result.data)
            }
        } catch (error) {
            console.error("Fetch users error:", error)
        }
        setIsLoadingData(false)
    }

    async function updateUserRole(userId: string, newRole: UserRole) {
        if (!confirm("Emin misiniz? Kullanıcının yetkileri değiştirilecek.")) return

        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId)

        if (!error) {
            // If new role is patient, also sync to patients table
            if (newRole === 'patient') {
                // Get user info for patient record
                const user = users.find(u => u.id === userId)
                if (user) {
                    await supabase
                        .from('patients')
                        .upsert({
                            id: userId,
                            user_id: userId,
                            full_name: user.full_name,
                            email: user.email,
                            status: 'active'
                        })
                }

                setSelectedPatientId(userId)
                setPatientProfileOpen(true)
            }

            fetchUsers()
        } else {
            alert("Hata oluştu: " + error.message)
        }
    }

    async function handleDeleteUser(user: any) {
        if (!confirm(`"${user.full_name}" kullanıcısını tamamen silmek istediğinize emin misiniz?\n\nBu işlem:\n- Auth hesabını\n- Profil bilgilerini\n- Hasta kaydını\n- Cihaz kayıtlarını\n\ntamamen silecektir ve geri alınamaz.`)) return

        try {
            const result = await deleteUserCompletely(user.id)

            if (result.error) throw new Error(result.error)

            fetchUsers()
        } catch (error: any) {
            console.error("Delete user error:", error)
            alert("Silme hatası: " + error.message)
        }
    }

    async function handleImpersonate(user: any) {
        if (!confirm(`${user.full_name} kullanıcısı olarak sisteme girmek üzeresiniz. Devam edilsin mi?`)) return

        await impersonateUser(user.id)

        // Redirect based on role
        if (user.role === 'doctor') router.push('/doctor')
        else if (user.role === 'dietitian') router.push('/dietitian')
        else if (user.role === 'patient') router.push('/patient') // Force reload to ensure clean context
        else if (user.role === 'admin') router.push('/admin')
        else router.push('/')
    }

    // ... (RoleIcon and RoleBadge remain same)

    const RoleIcon = ({ role }: { role: string }) => {
        switch (role) {
            case 'admin': return <Shield className="h-4 w-4 text-red-600" />
            case 'doctor': return <Stethoscope className="h-4 w-4 text-blue-600" />
            case 'dietitian': return <UserCog className="h-4 w-4 text-green-600" />
            default: return <UserIcon className="h-4 w-4 text-gray-400" />
        }
    }

    const RoleBadge = ({ role }: { role: string }) => {
        const styles = {
            admin: "bg-red-100 text-red-800",
            doctor: "bg-blue-100 text-blue-800",
            dietitian: "bg-green-100 text-green-800",
            patient: "bg-gray-100 text-gray-800"
        }
        const label = {
            admin: "Yönetici",
            doctor: "Doktor / Baş Diyetisyen",
            dietitian: "Diyetisyen",
            patient: "Hasta"
        }
        return (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[role as keyof typeof styles] || styles.patient}`}>
                <RoleIcon role={role} />
                {label[role as keyof typeof label] || role}
            </span>
        )
    }

    if (loading || !isAdmin) return null

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => router.push('/admin')}>
                    <ArrowLeft size={16} className="mr-1" />
                    Panele Dön
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Kullanıcı Yönetimi</h1>
                    <p className="text-gray-500 text-sm">Sistemdeki tüm kullanıcıları görüntüleyin ve rollerini yönetin.</p>
                </div>
                <div className="ml-auto">
                    <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
                        <PlusCircle className="h-4 w-4" />
                        Yeni Kullanıcı Ekle
                    </Button>
                </div>
            </div>

            
            {/* Mobile Cards View */}
            <div className="md:hidden flex flex-col gap-4">
                {isLoadingData ? (
                    <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">Yükleniyor...</div>
                ) : users.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">Kullanıcı bulunamadı.</div>
                ) : (
                    users.map((user) => (
                        <div key={user.id} className="bg-white rounded-xl border p-4 shadow-sm flex flex-col gap-3">
                            <div className="flex justify-between items-start gap-2">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
                                        {user.full_name?.charAt(0) || user.role.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="text-sm font-semibold text-slate-900">{user.full_name || "İsimsiz Kullanıcı"}</div>
                                        <div className="text-xs text-slate-500 truncate max-w-[200px]">{user.email || "-"}</div>
                                    </div>
                                </div>
                                <div className="shrink-0">
                                    
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Menü</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>İşlemler</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(user.id)}>
                                                    ID Kopyala
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleImpersonate(user)}>
                                                    <UserCog className="mr-2 h-4 w-4" /> Kullanıcı Olarak Gir
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => router.push(/admin/messages?targetUserId=)}>
                                                    <MessageCircle className="mr-2 h-4 w-4" /> Mesaj Gönder
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => { setSelectedUser(user); setIsUpdateOpen(true); }}>
                                                    <Pencil className="mr-2 h-4 w-4" /> Düzenle
                                                </DropdownMenuItem>
                                                {user.role === 'patient' && (
                                                    <DropdownMenuItem onClick={() => { setSelectedPatientId(user.id); setPatientProfileOpen(true); }}>
                                                        <UserIcon className="mr-2 h-4 w-4" /> Profil Düzenle
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuLabel className="text-xs text-gray-400 font-normal">Güvenlik</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={async () => {
                                                    if (!confirm(${user.full_name} kullanıcısının kayıtlı cihazlarını sıfırlamak istiyor musunuz?)) return;
                                                    const { error } = await supabase.rpc('admin_reset_devices', { _target_user_id: user.id });
                                                    if (error) alert("Hata: " + error.message);
                                                    else alert("Cihazlar sıfırlandı.");
                                                }}>
                                                    <Shield className="mr-2 h-4 w-4" /> Cihazları Sıfırla
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuLabel className="text-xs text-gray-400 font-normal">Rol Değiştir</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'admin')}>Yönetici Yap</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'doctor')}>Doktor Yap</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'dietitian')}>Diyetisyen Yap</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'patient')}>Hasta Yap</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="text-red-600 focus:text-red-600"
                                                    onClick={() => handleDeleteUser(user)}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" /> Kullanıcıyı Sil
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>

                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-1">
                                <RoleBadge role={user.role} />
                                {user.role === 'patient' && (
                                    <div className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                        {user.valid_until ? (
                                            new Date() > new Date(user.valid_until) ? (
                                                <span className="text-red-600 font-medium">Süresi Doldu ({new Date(user.valid_until).toLocaleDateString('tr-TR')})</span>
                                            ) : (
                                                <span className="text-green-600 font-medium">Kayıtlı: {new Date(user.valid_until).toLocaleDateString('tr-TR')}</span>
                                            )
                                        ) : (
                                            <span className="text-slate-500 italic">Kullanım Süresi Yok</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

<div className="hidden md:block border rounded-lg bg-white shadow-sm overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Ad Soyad</TableHead>
                            <TableHead>E-posta</TableHead>
                            <TableHead>Rol</TableHead>
                            <TableHead>Kullanım Süresi</TableHead>
                            <TableHead>Kayıt Tarihi</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoadingData ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">Yükleniyor...</TableCell>
                            </TableRow>
                        ) : users.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-gray-500">Kullanıcı bulunamadı.</TableCell>
                            </TableRow>
                        ) : (
                            users.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-medium">
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                                                {user.full_name?.charAt(0) || user.role.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium">{user.full_name || "İsimsiz Kullanıcı"}</div>
                                                <div className="text-xs text-gray-400">{user.title}</div>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm text-gray-600">
                                        {user.email || "-"}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <RoleBadge role={user.role} />
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {user.role === 'patient' ? (
                                            user.valid_until ? (
                                                new Date() > new Date(user.valid_until) ? (
                                                    <span className="text-red-600 font-medium">Süresi Doldu <br/><span className="text-xs text-red-400">({new Date(user.valid_until).toLocaleDateString('tr-TR')})</span></span>
                                                ) : (
                                                    <span className="text-green-600 font-medium">{new Date(user.valid_until).toLocaleDateString('tr-TR')}</span>
                                                )
                                            ) : (
                                                <span className="text-gray-500 italic">Belirtilmedi</span>
                                            )
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-gray-500 text-sm">
                                        {new Date(user.created_at).toLocaleDateString('tr-TR')}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                    <span className="sr-only">Menü</span>
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuLabel>İşlemler</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => navigator.clipboard.writeText(user.id)}>
                                                    ID Kopyala
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => handleImpersonate(user)}>
                                                    <UserCog className="mr-2 h-4 w-4" /> Kullanıcı Olarak Gir
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => router.push(`/admin/messages?targetUserId=${user.id}`)}>
                                                    <MessageCircle className="mr-2 h-4 w-4" /> Mesaj Gönder
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => { setSelectedUser(user); setIsUpdateOpen(true); }}>
                                                    <Pencil className="mr-2 h-4 w-4" /> Düzenle
                                                </DropdownMenuItem>
                                                {user.role === 'patient' && (
                                                    <DropdownMenuItem onClick={() => { setSelectedPatientId(user.id); setPatientProfileOpen(true); }}>
                                                        <UserIcon className="mr-2 h-4 w-4" /> Profil Düzenle
                                                    </DropdownMenuItem>
                                                )}
                                                <DropdownMenuSeparator />
                                                <DropdownMenuLabel className="text-xs text-gray-400 font-normal">Güvenlik</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={async () => {
                                                    if (!confirm(`${user.full_name} kullanıcısının kayıtlı cihazlarını sıfırlamak istiyor musunuz?`)) return;
                                                    const { error } = await supabase.rpc('admin_reset_devices', { _target_user_id: user.id });
                                                    if (error) alert("Hata: " + error.message);
                                                    else alert("Cihazlar sıfırlandı.");
                                                }}>
                                                    <Shield className="mr-2 h-4 w-4" /> Cihazları Sıfırla
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuLabel className="text-xs text-gray-400 font-normal">Rol Değiştir</DropdownMenuLabel>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'admin')}>Yönetici Yap</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'doctor')}>Doktor Yap</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'dietitian')}>Diyetisyen Yap</DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => updateUserRole(user.id, 'patient')}>Hasta Yap</DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="text-red-600 focus:text-red-600"
                                                    onClick={() => handleDeleteUser(user)}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" /> Kullanıcıyı Sil
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <CreateUserDialog
                open={isCreateOpen}
                onOpenChange={setIsCreateOpen}
                onSuccess={(userId, role) => {
                    fetchUsers()
                    // If patient role was selected, open PatientProfileDialog
                    if (role === 'patient' && userId) {
                        setSelectedPatientId(userId)
                        setPatientProfileOpen(true)
                    }
                }}
            />

            <UpdateUserDialog
                open={isUpdateOpen}
                onOpenChange={setIsUpdateOpen}
                user={selectedUser}
                onSuccess={() => {
                    fetchUsers()
                }}
            />

            {/* Patient Profile Dialog - shown when assigning patient role */}
            {selectedPatientId && (
                <PatientProfileDialog
                    open={patientProfileOpen}
                    onOpenChange={(open) => {
                        setPatientProfileOpen(open)
                        if (!open) setSelectedPatientId(null)
                    }}
                    patientId={selectedPatientId}
                    onSuccess={() => {
                        fetchUsers()
                        setPatientProfileOpen(false)
                        setSelectedPatientId(null)
                    }}
                />
            )}
        </div>
    )
}
