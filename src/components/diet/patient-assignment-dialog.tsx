"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { UserCog, AlertCircle, Check } from "lucide-react"

interface PatientAssignmentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    patient: { id: string, full_name: string } | null
    onSuccess: () => void
}

type DietitianOption = {
    id: string
    full_name: string | null
}

export function PatientAssignmentDialog({ open, onOpenChange, patient, onSuccess }: PatientAssignmentDialogProps) {
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [dietitians, setDietitians] = useState<DietitianOption[]>([])
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [originalIds, setOriginalIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (open && patient) {
            fetchData()
        }
    }, [open, patient])

    async function fetchData() {
        setLoading(true)
        setSelectedIds(new Set())
        setOriginalIds(new Set())

        try {
            // Resolve current user's team scope
            const { data: { user } } = await supabase.auth.getUser()
            const userId = user?.id || null

            let userRole: string | null = null
            let isGlobalAccess = false

            if (userId) {
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('role, is_global_access')
                    .eq('id', userId)
                    .maybeSingle()
                userRole = profileData?.role || null
                isGlobalAccess = !!profileData?.is_global_access
            }

            const isCurrentUserAdmin = userRole === 'admin' || (userRole === 'doctor' && isGlobalAccess)
            const isCurrentUserDoctor = userRole === 'doctor'

            if (isCurrentUserDoctor && !isCurrentUserAdmin && userId) {
                // Doctor: only show dietitians from their team
                const { data: teamMembers, error: teamError } = await supabase
                    .from('team_members')
                    .select('member_id')
                    .eq('supervisor_id', userId)
                    .eq('status', 'active')

                if (teamError) throw teamError

                const teamMemberIds = (teamMembers || []).map(m => m.member_id).filter(Boolean)

                if (teamMemberIds.length === 0) {
                    setDietitians([])
                } else {
                    const { data: teamDietitians, error: dError } = await supabase
                        .from('profiles')
                        .select('id, full_name')
                        .in('id', teamMemberIds)
                        .order('full_name')

                    if (dError) throw dError
                    setDietitians(teamDietitians || [])
                }
            } else {
                // Admin: show all dietitians
                const { data: dietitiansData, error: dietitiansError } = await supabase
                    .from('profiles')
                    .select('id, full_name')
                    .eq('role', 'dietitian')
                    .order('full_name')

                if (dietitiansError) throw dietitiansError
                setDietitians(dietitiansData || [])
            }

            // 2. Fetch current assignments for this patient (multiple)
            const { data: assignmentData, error: assignmentError } = await supabase
                .from('patient_assignments')
                .select('dietitian_id')
                .eq('patient_id', patient?.id)

            if (assignmentError && assignmentError.code !== 'PGRST116') {
                throw assignmentError
            }

            const currentIds = new Set((assignmentData || []).map(a => a.dietitian_id))
            setSelectedIds(currentIds)
            setOriginalIds(new Set(currentIds))

        } catch (error) {
            console.error("Error fetching assignment data:", error)
        } finally {
            setLoading(false)
        }
    }

    function toggleDietitian(id: string) {
        const newSet = new Set(selectedIds)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedIds(newSet)
    }

    async function handleSave() {
        if (!patient) return
        setSaving(true)

        try {
            // Find added and removed dietitians
            const added = [...selectedIds].filter(id => !originalIds.has(id))
            const removed = [...originalIds].filter(id => !selectedIds.has(id))

            // Remove unselected
            for (const dietitianId of removed) {
                const { error } = await supabase
                    .from('patient_assignments')
                    .delete()
                    .eq('patient_id', patient.id)
                    .eq('dietitian_id', dietitianId)

                if (error) throw error
            }

            // Add newly selected
            for (const dietitianId of added) {
                const { error } = await supabase
                    .from('patient_assignments')
                    .insert({
                        patient_id: patient.id,
                        dietitian_id: dietitianId,
                        is_primary: selectedIds.size === 1 // Primary if only one selected
                    })

                if (error) throw error
            }

            onSuccess()
            onOpenChange(false)

        } catch (error: any) {
            console.error("Error saving assignment:", error)
            alert("Atama kaydedilirken hata oluştu: " + error.message)
        } finally {
            setSaving(false)
        }
    }

    const hasChanges = () => {
        if (selectedIds.size !== originalIds.size) return true
        for (const id of selectedIds) {
            if (!originalIds.has(id)) return true
        }
        return false
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <UserCog className="h-5 w-5 text-green-600" />
                        Diyetisyen Ata
                    </DialogTitle>
                    <DialogDescription>
                        <strong>{patient?.full_name}</strong> için sorumlu diyetisyen(ler)i seçin.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {loading ? (
                        <div className="text-center py-4">Yükleniyor...</div>
                    ) : dietitians.length === 0 ? (
                        <div className="flex items-center gap-2 text-amber-600 text-sm bg-amber-50 p-3 rounded">
                            <AlertCircle size={16} />
                            Sistemde kayıtlı diyetisyen bulunamadı.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label className="text-sm text-muted-foreground">
                                Diyetisyenleri seçin (birden fazla seçebilirsiniz)
                            </Label>
                            <div className="border rounded-lg divide-y max-h-[300px] overflow-y-auto">
                                {dietitians.map((d) => (
                                    <label
                                        key={d.id}
                                        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors ${selectedIds.has(d.id) ? 'bg-green-50' : ''
                                            }`}
                                    >
                                        <Checkbox
                                            checked={selectedIds.has(d.id)}
                                            onCheckedChange={() => toggleDietitian(d.id)}
                                        />
                                        <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-xs shrink-0">
                                            {d.full_name?.substring(0, 1) || '?'}
                                        </div>
                                        <span className="font-medium">
                                            {d.full_name || "İsimsiz Diyetisyen"}
                                        </span>
                                        {selectedIds.has(d.id) && (
                                            <Check className="h-4 w-4 text-green-600 ml-auto" />
                                        )}
                                    </label>
                                ))}
                            </div>
                            <div className="text-xs text-muted-foreground mt-2">
                                {selectedIds.size} diyetisyen seçildi
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        İptal
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={saving || !hasChanges()}
                        className="bg-green-600 hover:bg-green-700"
                    >
                        {saving ? "Kaydediliyor..." : "Kaydet"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
