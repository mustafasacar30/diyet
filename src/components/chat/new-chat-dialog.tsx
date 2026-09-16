"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/auth-context"

interface NewChatDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onStartChat: (userIds: string[], isGroup: boolean, title?: string) => void
    allowGroupCreation?: boolean
}

type UserOption = {
    id: string
    full_name: string
    role: string
}

export function NewChatDialog({
    open,
    onOpenChange,
    onStartChat,
    allowGroupCreation = true
}: NewChatDialogProps) {
    const { user } = useAuth()
    const [loading, setLoading] = useState(false)
    const [users, setUsers] = useState<UserOption[]>([])
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [groupTitle, setGroupTitle] = useState("")

    useEffect(() => {
        if (open && user) {
            fetchContacts()
            setSelectedIds(new Set())
            setGroupTitle("")
        }
    }, [open, user])

    async function fetchContacts() {
        setLoading(true)
        try {
            if (!user?.id) {
                setUsers([])
                return
            }

            const { data: allowedRows, error: allowedErr } = await supabase
                .rpc("get_chat_allowed_contacts", { _user_id: user.id })

            let allowedIds: string[] = []

            if (allowedErr) {
                console.warn("RPC failed, falling back to fetching all admins/dietitians", allowedErr)
                // Fallback if RPC is missing
                const { data: fallbackAdmins } = await supabase
                    .from('profiles')
                    .select('id, full_name, role')
                    .in('role', ['admin', 'dietitian'])
                    
                if (fallbackAdmins && fallbackAdmins.length > 0) {
                    setUsers(fallbackAdmins.filter(u => u.id !== user.id).map(a => ({
                        id: a.id,
                        full_name: a.full_name || 'İsimsiz',
                        role: a.role
                    })))
                } else {
                    setUsers([])
                }
                setLoading(false)
                return
            } else {
                allowedIds = Array.from(new Set((allowedRows || []).map((r: any) => r.user_id).filter(Boolean)))
            }

            if (allowedIds.length === 0) {
                setUsers([])
                return
            }

            const { data: contacts, error: contactsErr } = await supabase
                .from("profiles")
                .select("id, full_name, role")
                .in("id", allowedIds)

            if (contactsErr) {
                console.error("Error fetching contacts detail", contactsErr)
                setUsers([])
                return
            }

            setUsers(
                (contacts || []).map((c: any) => ({
                    id: c.id,
                    full_name: c.full_name || "İsimsiz",
                    role: c.role || "unknown",
                }))
            )
        } catch (err) {
            console.error("fetchContacts error", err)
            setUsers([])
        } finally {
            setLoading(false)
        }
    }

    const handleToggle = (id: string) => {
        const next = new Set(selectedIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            if (!allowGroupCreation) next.clear()
            next.add(id)
        }
        setSelectedIds(next)
    }

    const handleStart = () => {
        const ids = Array.from(selectedIds)
        if (ids.length === 0) return

        const isGroup = ids.length > 1
        if (isGroup && !groupTitle.trim()) {
            alert("Lütfen grup için bir isim girin.")
            return
        }
        onStartChat(ids, isGroup, groupTitle)
        onOpenChange(false)
        setGroupTitle("")
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Yeni Sohbet Baslat</DialogTitle>
                    <DialogDescription className="hidden">Sohbet başlatılacak kişiyi seçin</DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {allowGroupCreation && selectedIds.size > 1 && (
                        <div className="px-1">
                            <label className="text-sm font-medium mb-1 block">Grup Adi</label>
                            <input
                                type="text"
                                value={groupTitle}
                                onChange={(e) => setGroupTitle(e.target.value)}
                                placeholder="Grup icin bir isim girin..."
                                className="w-full border rounded-md px-3 py-2 text-sm"
                            />
                        </div>
                    )}

                    {loading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="animate-spin text-gray-400" />
                        </div>
                    ) : users.length === 0 ? (
                        <div className="text-center text-gray-500 py-4">
                            Kisi bulunamadi.
                        </div>
                    ) : (
                        <ScrollArea className="h-[300px] border rounded-md p-2">
                            <div className="space-y-2">
                                {users.map((u) => (
                                    <div
                                        key={u.id}
                                        className={`flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-gray-50 ${selectedIds.has(u.id) ? "bg-green-50" : ""}`}
                                        onClick={() => handleToggle(u.id)}
                                    >
                                        <Checkbox
                                            checked={selectedIds.has(u.id)}
                                            onCheckedChange={() => handleToggle(u.id)}
                                        />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium">{u.full_name}</div>
                                            <div className="text-xs text-gray-400 capitalize">{u.role}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )}
                </div>

                <DialogFooter className="flex justify-between sm:justify-between items-center">
                    <div className="text-xs text-gray-500">
                        {selectedIds.size} kisi secildi
                    </div>
                    <Button onClick={handleStart} disabled={selectedIds.size === 0}>
                        {allowGroupCreation && selectedIds.size > 1 ? "Grup Olustur" : "Sohbet Baslat"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
