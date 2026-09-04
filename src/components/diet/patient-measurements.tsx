import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/contexts/auth-context"
import { startOfWeek, parseISO, format } from "date-fns"
import { tr } from "date-fns/locale"
import { Plus, Settings, Loader2, Save, Trash2, CheckCircle2, AlertCircle, Eye, Pencil } from "lucide-react"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { updateWeekWeightAction, syncPatientWeightAndActivityAction } from "@/actions/measurement-actions"
// ... imports ...

// --- TYPES ---

type MeasurementDef = {
    id: string
    name: string
    unit: string
    sort_order: number
    is_active: boolean
    patient_id: string | null
}

type MeasurementLog = {
    id: string
    date: string
    values: Record<string, number>
    note: string | null
    is_seen_by_dietitian: boolean
    created_at: string
    diet_week_id?: string | null
    week_number?: number | null
    is_virtual?: boolean
}

// --- SUB COMPONENTS ---

function ManageDefinitionsDialog({ open, onOpenChange, patientId, definitions, onSuccess }: {
    open: boolean,
    onOpenChange: (o: boolean) => void,
    patientId: string,
    definitions: MeasurementDef[],
    onSuccess: () => void
}) {
    const [localDefs, setLocalDefs] = useState<MeasurementDef[]>([])
    const [loading, setLoading] = useState(false)
    const [newDefName, setNewDefName] = useState("")
    const [newDefUnit, setNewDefUnit] = useState("cm")

    useEffect(() => {
        setLocalDefs(definitions)
    }, [definitions])

    // Fetch again just to be sure if opened? No, relies on parent props is usually okay but editing needs careful sync.
    // Let's use simple local edits and reload parent on close/save.

    async function handleAdd() {
        if (!newDefName.trim()) return
        setLoading(true)

        // Calculate next order
        const maxOrder = Math.max(...localDefs.map(d => d.sort_order), 0)

        const { error } = await supabase.from('measurement_definitions').insert([{
            patient_id: patientId,
            name: newDefName.trim(),
            unit: newDefUnit,
            sort_order: maxOrder + 1,
            is_active: true
        }])

        if (error) {
            alert('Hata: ' + error.message)
        } else {
            setNewDefName("")
            setNewDefUnit("cm")
            onSuccess() // Parent refresh will update props
        }
        setLoading(false)
    }

    async function handleToggleActive(def: MeasurementDef) {
        // System defaults cannot be deleted, but maybe hidden?
        // Admin can edit system defaults. Dietitian can only edit patient specific?
        // For now, let's allow "soft delete" via is_active for custom ones.
        // For system defaults, we might need a separate "assignments" table if we want to hide them per patient.
        // Or simply: Dietitian can create new ones. Cannot modify system ones.

        if (!def.patient_id) {
            alert("Sistem varsayılanları değiştirilemez. (Şimdilik)")
            return
        }

        const { error } = await supabase.from('measurement_definitions')
            .update({ is_active: !def.is_active })
            .eq('id', def.id)

        if (!error) onSuccess()
    }

    async function handleDelete(def: MeasurementDef) {
        if (!def.patient_id) {
            alert("Sistem varsayılanları silinemez.")
            return
        }
        if (!confirm(`${def.name} alanını silmek istiyor musunuz? Bu alana ait geçmiş veriler korunur ama artık listede görünmez.`)) return

        const { error } = await supabase.from('measurement_definitions').delete().eq('id', def.id)
        if (!error) onSuccess()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Ölçüm Parametrelerini Düzenle</DialogTitle>
                    <DialogDescription>Bu hasta için takip edilen ölçüm alanlarını yönetin.</DialogDescription>
                </DialogHeader>

                <div className="flex gap-2 items-end border-b pb-4 mb-4">
                    <div className="grid gap-1.5 flex-1">
                        <Label>Yeni Alan Adı</Label>
                        <Input placeholder="Örn: Boyun" value={newDefName} onChange={e => setNewDefName(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5 w-24">
                        <Label>Birim</Label>
                        <Input placeholder="cm" value={newDefUnit} onChange={e => setNewDefUnit(e.target.value)} />
                    </div>
                    <Button onClick={handleAdd} disabled={loading}><Plus size={16} className="mr-1" /> Ekle</Button>
                </div>

                <ScrollArea className="flex-1 pr-4">
                    <div className="space-y-2">
                        {localDefs.map(def => (
                            <div key={def.id} className="flex items-center justify-between p-2 border rounded bg-white">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-bold ${def.patient_id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                        {def.patient_id ? 'Özel' : 'Sys'}
                                    </div>
                                    <div>
                                        <div className="font-medium">{def.name}</div>
                                        <div className="text-xs text-gray-400">{def.unit}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {def.patient_id && (
                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(def)} className="text-red-500 hover:bg-red-50">
                                            <Trash2 size={16} />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    )
}

function LogMeasurementDialog({ open, onOpenChange, definitions, patientId, onSuccess, existingLog }: {
    open: boolean,
    onOpenChange: (o: boolean) => void,
    definitions: MeasurementDef[],
    patientId: string,
    onSuccess: () => void,
    existingLog?: MeasurementLog | null
}) {
    const isEditMode = !!existingLog
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [values, setValues] = useState<Record<string, string>>({})
    const [note, setNote] = useState("")
    const [loading, setLoading] = useState(false)

    // Reset form on open or when existingLog changes
    useEffect(() => {
        if (open) {
            if (existingLog) {
                // Edit mode: populate form with existing data
                setDate(existingLog.date)
                const stringValues: Record<string, string> = {}
                Object.entries(existingLog.values).forEach(([key, val]) => {
                    stringValues[key] = val.toString()
                })
                setValues(stringValues)
                setNote(existingLog.note || "")
            } else {
                // Create mode: reset form
                setDate(new Date().toISOString().split('T')[0])
                setValues({})
                setNote("")
            }
        }
    }, [open, existingLog])

    async function handleSave() {
        setLoading(true)

        // Convert string inputs to numbers mapping
        const numericValues: Record<string, number> = {}
        Object.entries(values).forEach(([defId, valStr]) => {
            if (valStr && !isNaN(parseFloat(valStr))) {
                numericValues[defId] = parseFloat(parseFloat(valStr).toFixed(2))
            }
        })

        if (Object.keys(numericValues).length === 0) {
            alert("En az bir değer girmelisiniz.")
            setLoading(false)
            return
        }

        try {
            const weightDef = definitions.find(d => d.name.toLowerCase().includes('kilo') || d.name.toLowerCase() === 'ağırlık')
            const weightVal = weightDef ? numericValues[weightDef.id] : 0
            
            // Determine active week ID from existing log or context
            const weekId = existingLog?.diet_week_id || (existingLog?.id.startsWith('week_') ? existingLog.id.replace('week_', '') : null)
            const weekNum = existingLog?.week_number

            const { success, errors } = await syncPatientWeightAndActivityAction(
                patientId,
                weightVal || 0,
                0, // activity weight not directly editable here usually, but we could add it
                weekId || undefined,
                'Diyetisyen',
                numericValues,
                weekNum || undefined
            )

            if (!success) throw new Error(errors.join(', '))
            
            onSuccess()
            onOpenChange(false)
        } catch (err: any) {
            alert("Kaydetme hatası: " + err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{isEditMode ? 'Ölçüm Düzenle' : 'Yeni Ölçüm Ekle'}</DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-auto pr-2">
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Tarih</Label>
                            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {definitions.filter(d => d.is_active).map(def => (
                                <div key={def.id} className="space-y-1">
                                    <Label className="text-xs text-gray-500 uppercase">{def.name} ({def.unit})</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0"
                                        value={values[def.id] || ''}
                                        onChange={e => setValues(prev => ({ ...prev, [def.id]: e.target.value }))}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="grid gap-2">
                            <Label>Not (Opsiyonel)</Label>
                            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Örn: Sabah aç karnına..." />
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
                    <Button onClick={handleSave} disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {isEditMode ? 'Güncelle' : 'Kaydet'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}


// --- MAIN DATA COMPONENT ---

export function PatientMeasurements({ patientId, readOnly = false }: { patientId: string, readOnly?: boolean }) {
    const [definitions, setDefinitions] = useState<MeasurementDef[]>([])
    const [logs, setLogs] = useState<MeasurementLog[]>([])
    const [loading, setLoading] = useState(true)
    const [logDialogOpen, setLogDialogOpen] = useState(false)
    const [defsDialogOpen, setDefsDialogOpen] = useState(false)
    const [editingLog, setEditingLog] = useState<MeasurementLog | null>(null)

    const { profile } = useAuth()
    const isDietitian = profile?.role === 'dietitian'

    useEffect(() => {
        if (patientId) loadData()
    }, [patientId])

    async function loadData() {
        setLoading(true)
        try {
            // 1. Fetch Definitions
            const { data: defs } = await supabase
                .from('measurement_definitions')
                .select('*')
                .or(`patient_id.is.null,patient_id.eq.${patientId}`)
                .order('sort_order')

            let fetchedDefs = defs || []
            setDefinitions(fetchedDefs)

            const weightDef = fetchedDefs.find(d => d.name.toLowerCase().includes('kilo') || d.name.toLowerCase() === 'ağırlık')

            // 2. Fetch all measurement logs for this patient
            const { data: logData } = await supabase
                .from('patient_measurements')
                .select('*')
                .eq('patient_id', patientId)

            const realLogs: any[] = logData || []

            // 3. Fetch all weeks for this patient, including plan status to resolve numbering conflicts
            const { data: planData } = await supabase
                .from('diet_plans')
                .select('id, status, diet_weeks(id, week_number, start_date, weight_log, activity_level_log)')
                .eq('patient_id', patientId)

            const allWeeks = planData?.flatMap(p => p.diet_weeks.map(w => ({ ...w, plan_status: p.status }))) || []

            // 4. Construct strictly weekly logs by logical week (Monday-based)
            const sortedRealLogs = [...realLogs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

            // Helper to get consistent Monday key
            const getWeekKey = (d: string) => {
                try {
                    return format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd')
                } catch (e) {
                    return d.split('T')[0]
                }
            }

            // Map of start_date (Monday) -> MeasurementLog
            const weeklyLogsByDate: Record<string, MeasurementLog & { _plan_status?: string }> = {}

            // Initialize with week info from diet_weeks
            allWeeks.forEach(week => {
                const dateKey = getWeekKey(week.start_date)
                const existing = weeklyLogsByDate[dateKey]

                if (!existing) {
                    weeklyLogsByDate[dateKey] = {
                        id: `week_${week.id}`,
                        diet_week_id: week.id,
                        week_number: week.week_number,
                        _plan_status: (week as any).plan_status,
                        date: dateKey,
                        values: weightDef && (week.weight_log !== null && week.weight_log !== -1)
                            ? { [weightDef.id]: week.weight_log }
                            : {},
                        note: 'Haftalık Veri',
                        is_seen_by_dietitian: true,
                        is_virtual: true,
                        created_at: new Date().toISOString()
                    }
                } else {
                    if (weightDef && (week.weight_log !== null && week.weight_log !== -1)) {
                        existing.values[weightDef.id] = week.weight_log
                    }

                    // RESOLVE WEEK NUMBER DISCREPANCY:
                    // If multiple weeks hit same Monday (e.g. from different plans), 
                    // prioritize the one from the ACTIVE plan. 
                    // This ensures the dietitian view matches what the patient sees in their active portal.
                    const isNewerActive = (week as any).plan_status === 'active'
                    const wasAlreadyActive = existing._plan_status === 'active'

                    if (isNewerActive || (!wasAlreadyActive && week.week_number > (existing.week_number || 0))) {
                        existing.week_number = week.week_number
                        existing.diet_week_id = week.id
                        existing._plan_status = (week as any).plan_status
                    }
                }
            })

            // Overlay with real patient_measurements
            sortedRealLogs.forEach(log => {
                const dateKey = getWeekKey(log.date)
                const logWeekId = log.values?._diet_week_id
                
                const existing = weeklyLogsByDate[dateKey]
                
                const cleanValues = { ...log.values }
                Object.keys(cleanValues).forEach(k => { if (k.startsWith('_')) delete cleanValues[k] })

                if (existing) {
                    // Update existing entry (week or already processed log)
                    weeklyLogsByDate[dateKey] = {
                        ...existing,
                        ...log,
                        id: log.id || existing.id,
                        date: dateKey, // Enforce Monday
                        diet_week_id: logWeekId || existing.diet_week_id,
                        week_number: existing.week_number || log.values?._week_number,
                        is_virtual: false,
                        values: {
                            ...existing.values,
                            ...cleanValues
                        }
                    }
                } else {
                    // Create new "floating" entry but at the Monday of its week
                    weeklyLogsByDate[dateKey] = {
                        ...log,
                        date: dateKey,
                        week_number: log.values?._week_number || null,
                        is_virtual: false,
                        values: cleanValues
                    }
                }
            })

            const finalLogs = Object.values(weeklyLogsByDate).sort((a, b) => {
                if (a.week_number !== null && b.week_number !== null) {
                    if (a.week_number !== b.week_number) return (a.week_number || 0) - (b.week_number || 0)
                }
                if (a.week_number !== null && b.week_number === null) return 1
                if (a.week_number === null && b.week_number !== null) return -1
                return new Date(a.date).getTime() - new Date(b.date).getTime()
            })

            setLogs(finalLogs)
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    // Mark as seen if Dietitian views this component and there are unseen logs
    useEffect(() => {
        if (isDietitian && logs.some(l => !l.is_seen_by_dietitian)) {
            handleMarkAllSeen()
        }
    }, [isDietitian, logs]) // logs changes only when fetched, so this runs once per fetch basically.
    // Wait, infinite loop? "handleMarkAllSeen" updates DB, but we don't necessarily refetch immediately to prevent flicker loop.
    // Better: Update DB silently. 

    async function handleMarkAllSeen() {
        const unseenIds = logs.filter(l => !l.is_seen_by_dietitian).map(l => l.id)
        if (unseenIds.length === 0) return

        // Optimistic update locally? 
        // No, let's just fire and forget DB update to avoid UI jitter.
        // Actually, we WANT to show the highlight first, then fade it? 
        // User Requirement: "Hatta hasta veriler girdiğinde diyetisyen görülmemiş veri olarak farketmeli."
        // If I auto-mark them as seen immediately upon mounting, the dietitian might miss them if they blink.
        // Better: Show a button "Okundu İşaretle" or mark them seen after a delay?
        // Or just let them be highlighted until next refresh.
        // Let's create a manual "Mark Seen" effect or a 3-second timeout.

        // Timeout strategy:
        setTimeout(async () => {
            const { error } = await supabase
                .from('patient_measurements')
                .update({ is_seen_by_dietitian: true })
                .in('id', unseenIds)

            if (!error) {
                // Update local state to remove highlight nicely
                setLogs(prev => prev.map(l => unseenIds.includes(l.id) ? { ...l, is_seen_by_dietitian: true } : l))
            }
        }, 3000)
    }

    const visibleDefs = useMemo(() => definitions.filter(d => d.is_active), [definitions])

    return (
        <Card className="w-full h-full flex flex-col border-none shadow-none">
            <CardHeader className="px-0 py-4 flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>Vücut Ölçümleri</CardTitle>
                    <CardDescription>Periyodik ölçüm takibi</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    {isDietitian && !readOnly && (
                        <Button variant="outline" size="sm" onClick={() => setDefsDialogOpen(true)}>
                            <Settings size={14} className="mr-1" /> Parametreler
                        </Button>
                    )}
                    {!readOnly && (
                        <Button size="sm" onClick={() => { setEditingLog(null); setLogDialogOpen(true) }}>
                            <Plus size={14} className="mr-1" /> Yeni Ölçüm
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="px-0 flex-1 min-h-0 overflow-hidden flex flex-col">
                {/* Mobile Card View */}
                <div className="md:hidden space-y-4 px-4 pb-4 overflow-y-auto">
                    {loading ? (
                        <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>
                    ) : logs.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">Kayıtlı ölçüm bulunamadı.</div>
                    ) : (
                        visibleDefs.map(def => (
                            <div key={def.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="font-semibold text-sm text-gray-800">{def.name}</span>
                                    <span className="text-xs text-gray-400">{def.unit}</span>
                                </div>
                                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                                    {(() => {
                                        const sortedLogs = [...logs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                        return sortedLogs.map(log => {
                                            const val = log.values[def.id]
                                            const logDate = new Date(log.date)
                                            return (
                                                <div key={`${log.id}-${def.id}`} className="flex-shrink-0 bg-gray-50 rounded-lg px-3 py-2 min-w-[80px] text-center">
                                                    <div className="text-[10px] text-gray-400 mb-1">{format(logDate, 'dd.MM.yy')}</div>
                                                    <div className="text-sm font-bold text-gray-800">{val !== undefined ? val : '-'}</div>
                                                </div>
                                            )
                                        })
                                    })()}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="hidden md:flex border rounded-md flex-1 overflow-hidden flex-col relative w-full">
                    <ScrollArea className="flex-1 w-full max-w-[100vw] sm:max-w-none">
                        <div className="min-w-max pb-4">
                            {loading ? (
                                <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>
                            ) : logs.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground">Kayıtlı ölçüm bulunamadı.</div>
                            ) : (() => {
                                // Calculate first log date for week calculation
                                const sortedLogs = [...logs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                const firstLogDate = sortedLogs.length > 0 ? new Date(sortedLogs[0].date) : null
                                const lastLog = sortedLogs[sortedLogs.length - 1]
                                const firstLog = sortedLogs[0]

                                // Calculate week number for a given date
                                const getWeekNumber = (date: Date) => {
                                    if (!firstLogDate) return 0
                                    const diffTime = date.getTime() - firstLogDate.getTime()
                                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
                                    return Math.floor(diffDays / 7)
                                }

                                // Calculate differences between first and last
                                const differences: Record<string, number> = {}
                                let totalWeeks = 0
                                if (firstLog && lastLog && firstLog.id !== lastLog.id) {
                                    visibleDefs.forEach(def => {
                                        const firstVal = firstLog.values[def.id]
                                        const lastVal = lastLog.values[def.id]
                                        if (firstVal !== undefined && lastVal !== undefined) {
                                            differences[def.id] = lastVal - firstVal
                                        }
                                    })
                                    // Calculate total weeks between first and last
                                    const firstDate = new Date(firstLog.date)
                                    const lastDate = new Date(lastLog.date)
                                    const diffTime = lastDate.getTime() - firstDate.getTime()
                                    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
                                    totalWeeks = Math.floor(diffDays / 7)
                                }

                                return (
                                    <>
                                        <div className="flex bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky top-0 z-20 shadow-sm">
                                            <div className="w-48 p-3 shrink-0 bg-gray-100 sticky left-0 border-b border-r z-30 flex items-center h-16">
                                                Parametre / Tarih
                                            </div>
                                            {sortedLogs.map(log => {
                                                 const logDate = new Date(log.date)
                                                 const weekNum = log.week_number
                                                 const isVirtual = log.is_virtual

                                                 return (
                                                     <div key={log.id} className={cn(
                                                         "w-28 p-3 text-center border-b border-r flex flex-col items-center justify-center relative group min-h-[4rem]", 
                                                         !log.is_seen_by_dietitian && isDietitian ? "bg-blue-50/60" : "bg-gray-50",
                                                         isVirtual ? "bg-purple-50/20" : "bg-emerald-50/20"
                                                     )}>
                                                         {/* Unseen Indicator Line */}
                                                         {!log.is_seen_by_dietitian && isDietitian && (
                                                             <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500 z-30"></div>
                                                         )}

                                                         <span className="flex items-center gap-1 text-[10px] font-bold text-gray-600">
                                                             {format(logDate, 'dd.MM.yy')}
                                                             {!log.is_seen_by_dietitian && isDietitian && (
                                                                 <span className="ml-1 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 animate-pulse" title="Yeni Veri" />
                                                             )}
                                                         </span>
                                                         {weekNum !== null && weekNum !== undefined && (
                                                             <span className="text-[11px] text-emerald-700 font-black">{weekNum}. Hafta</span>
                                                         )}
                                                         {isVirtual && (
                                                             <span className="text-[9px] text-purple-400 font-normal leading-tight">(Boş Hafta)</span>
                                                         )}

                                                        {/* Actions on Column Header */}
                                                        <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                                            {!readOnly && (
                                                                <Button variant="ghost" size="icon" className="h-5 w-5 bg-white/80 shadow-sm text-blue-500 hover:text-blue-700 hover:bg-white"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        setEditingLog(log)
                                                                        setLogDialogOpen(true)
                                                                    }}
                                                                >
                                                                    <Pencil size={10} />
                                                                </Button>
                                                            )}
                                                            {isDietitian && !readOnly && !isVirtual && (
                                                                <Button variant="ghost" size="icon" className="h-5 w-5 bg-white/80 shadow-sm text-red-500 hover:text-red-700 hover:bg-white"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation()
                                                                        if (confirm('Bu tarihli ölçüm tamamen silinsin mi?')) {
                                                                            await supabase.from('patient_measurements').delete().eq('id', log.id)
                                                                            loadData()
                                                                        }
                                                                    }}
                                                                >
                                                                    <Trash2 size={10} />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                            {/* Difference Column Header */}
                                            {Object.keys(differences).length > 0 && (
                                                <div className="w-24 p-3 shrink-0 bg-emerald-50 border-b text-emerald-700 flex flex-col items-center justify-center sticky right-0 z-20 shadow-[-4px_0_10px_-5px_rgba(0,0,0,0.1)] h-16">
                                                    <span>📊 FARK</span>
                                                    <span className="text-[10px] font-normal text-emerald-600">{totalWeeks > 0 ? `${totalWeeks} Hafta` : 'Ayrıntı'}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="divide-y relative z-0">
                                            {/* Map Definitions as Rows */}
                                            {visibleDefs.map(def => (
                                                <div key={def.id} className="flex hover:bg-gray-50/50 transition-colors text-sm">
                                                    {/* Row Header (Param Name) */}
                                                    <div className="w-48 p-3 shrink-0 border-r font-medium flex items-center justify-between sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] text-gray-700 uppercase">
                                                        <span>{def.name}</span>
                                                        <span className="text-xs text-gray-400 normal-case">{def.unit}</span>
                                                    </div>

                                                    {/* Row Data (Dates) */}
                                                    {sortedLogs.map(log => {
                                                        const val = log.values[def.id]
                                                        return (
                                                            <div key={`${log.id}-${def.id}`} className="w-28 p-3 text-center border-r last:border-r-0 text-gray-800 font-medium">
                                                                {val !== undefined ? val : '-'}
                                                            </div>
                                                        )
                                                    })}

                                                    {/* Difference Data Cell */}
                                                    {Object.keys(differences).length > 0 && (
                                                        <div className="w-24 p-3 text-center bg-emerald-50/50 sticky right-0 font-semibold shadow-[-4px_0_10px_-5px_rgba(0,0,0,0.05)]">
                                                            {(() => {
                                                                const diff = differences[def.id]
                                                                if (diff === undefined) return <span className="text-gray-400">-</span>
                                                                const isPositive = diff > 0
                                                                const isNegative = diff < 0
                                                                const colorClass = isNegative ? 'text-green-600' : isPositive ? 'text-red-600' : 'text-gray-600'
                                                                return (
                                                                    <span className={colorClass}>
                                                                        {isPositive ? '+' : ''}{diff.toFixed(1)}
                                                                    </span>
                                                                )
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            {/* Note Row */}
                                            <div className="flex text-sm bg-gray-50/30">
                                                <div className="w-48 p-3 shrink-0 border-r text-gray-500 font-medium sticky left-0 bg-gray-50/80 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] flex items-center">
                                                    Notlar
                                                </div>
                                                {sortedLogs.map(log => (
                                                    <div key={`${log.id}-note`} className="w-28 p-3 text-xs italic text-gray-500 border-r last:border-r-0 break-words">
                                                        {log.note || '-'}
                                                    </div>
                                                ))}
                                                {Object.keys(differences).length > 0 && (
                                                    <div className="w-24 p-3 bg-emerald-50/50 sticky right-0 shadow-[-4px_0_10px_-5px_rgba(0,0,0,0.05)]"></div>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )
                            })()}
                        </div>
                        <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                </div>
            </CardContent>

            <ManageDefinitionsDialog
                open={defsDialogOpen}
                onOpenChange={setDefsDialogOpen}
                patientId={patientId}
                definitions={definitions}
                onSuccess={loadData}
            />

            <LogMeasurementDialog
                open={logDialogOpen}
                onOpenChange={(open) => {
                    setLogDialogOpen(open)
                    if (!open) setEditingLog(null) // Reset editing state when dialog closes
                }}
                patientId={patientId}
                definitions={visibleDefs}
                onSuccess={loadData}
                existingLog={editingLog}
            />
        </Card>
    )
}
