import re

filepath = 'src/app/admin/users/page.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# We want to replace the div wrapper for the table.
# Currently it is: <div className="border rounded-lg bg-white shadow-sm overflow-x-auto">
# We will change it to <div className="hidden md:block border rounded-lg bg-white shadow-sm overflow-x-auto">
content = content.replace('<div className="border rounded-lg bg-white shadow-sm overflow-x-auto">', '<div className="hidden md:block border rounded-lg bg-white shadow-sm overflow-x-auto">')

# We need to insert the mobile cards view right before the desktop table div.
# Let's find the table div.
table_div_start = '<div className="hidden md:block border rounded-lg bg-white shadow-sm overflow-x-auto">'
if table_div_start not in content:
    print("Could not find table div")
    exit(1)

# To generate the mobile cards, we need the dropdown menu logic.
# The dropdown menu is exactly the same, we just need a reusable dropdown or just duplicate it.
# Duplicating is easiest for now.

dropdown_code = '''
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
'''

mobile_view_code = f'''
            {{/* Mobile Cards View */}}
            <div className="md:hidden flex flex-col gap-4">
                {{isLoadingData ? (
                    <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">Yükleniyor...</div>
                ) : users.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 bg-white rounded-lg border">Kullanıcı bulunamadı.</div>
                ) : (
                    users.map((user) => (
                        <div key={{user.id}} className="bg-white rounded-xl border p-4 shadow-sm flex flex-col gap-3">
                            <div className="flex justify-between items-start gap-2">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
                                        {{user.full_name?.charAt(0) || user.role.charAt(0).toUpperCase()}}
                                    </div>
                                    <div className="flex flex-col">
                                        <div className="text-sm font-semibold text-slate-900">{{user.full_name || "İsimsiz Kullanıcı"}}</div>
                                        <div className="text-xs text-slate-500 truncate max-w-[200px]">{{user.email || "-"}}</div>
                                    </div>
                                </div>
                                <div className="shrink-0">
                                    {dropdown_code}
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2 mt-1">
                                <RoleBadge role={{user.role}} />
                                {{user.role === 'patient' && (
                                    <div className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                        {{user.valid_until ? (
                                            new Date() > new Date(user.valid_until) ? (
                                                <span className="text-red-600 font-medium">Süresi Doldu ({{new Date(user.valid_until).toLocaleDateString('tr-TR')}})</span>
                                            ) : (
                                                <span className="text-green-600 font-medium">Kayıtlı: {{new Date(user.valid_until).toLocaleDateString('tr-TR')}}</span>
                                            )
                                        ) : (
                                            <span className="text-slate-500 italic">Kullanım Süresi Yok</span>
                                        )}}
                                    </div>
                                )}}
                            </div>
                        </div>
                    ))
                )}}
            </div>

'''

content = content.replace(table_div_start, mobile_view_code + table_div_start)

# Save
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Modified successfully")
