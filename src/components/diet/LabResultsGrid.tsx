"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    Plus,
    TrendingUp,
    TrendingDown,
    Minus,
    LineChart,
    Loader2,
    Save,
    X,
    Settings2,
    Pencil,
    GripHorizontal,
    Search,
} from "lucide-react"
import {
    LineChart as RechartsLineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine
} from "recharts"

// Draggable Dialog Wrapper
function DraggableDialogContent({ children, className, ...props }: React.ComponentPropsWithoutRef<typeof DialogContent>) {
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number } | null>(null)

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        setIsDragging(true)
        dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialX: position.x,
            initialY: position.y
        }
    }, [position])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !dragRef.current) return
            const dx = e.clientX - dragRef.current.startX
            const dy = e.clientY - dragRef.current.startY
            setPosition({
                x: dragRef.current.initialX + dx,
                y: dragRef.current.initialY + dy
            })
        }

        const handleMouseUp = () => {
            setIsDragging(false)
            dragRef.current = null
        }

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isDragging])

    // Reset position - component remounts when dialog opens
    useEffect(() => {
        setPosition({ x: 0, y: 0 })
    }, [])

    return (
        <DialogContent
            className={`!top-[5%] !translate-y-0 ${className}`}
            style={{
                marginLeft: position.x,
                marginTop: position.y
            }}
            {...props}
        >
            <div
                className="absolute top-0 left-0 right-12 h-10 cursor-move flex items-center justify-center"
                onMouseDown={handleMouseDown}
            >
                <GripHorizontal className="h-4 w-4 text-gray-300" />
            </div>
            {children}
        </DialogContent>
    )
}

type Micronutrient = {
    id: string
    name: string
    unit: string
    default_min: number | null
    default_max: number | null
    category: 'mikrobesin' | 'kan_tahlili' | null
}

type LabResult = {
    id: string
    patient_id: string
    micronutrient_id: string
    value: number
    ref_min: number | null
    ref_max: number | null
    measured_at: string
}

type Props = {
    patientId: string
    onClose?: () => void
    readOnly?: boolean
}

export default function LabResultsGrid({ patientId, onClose, readOnly = false }: Props) {
    const [micronutrients, setMicronutrients] = useState<Micronutrient[]>([])
    const [labResults, setLabResults] = useState<LabResult[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // New Date Entry
    const [isAddingDate, setIsAddingDate] = useState(false)
    const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
    const [newValues, setNewValues] = useState<Record<string, string>>({})

    // Column Editing - edit entire column at once
    const [editingColumn, setEditingColumn] = useState<string | null>(null) // date being edited
    const [columnValues, setColumnValues] = useState<Record<string, string>>({}) // microId -> value

    // Chart Modal
    const [chartOpen, setChartOpen] = useState(false)
    const [selectedMicronutrient, setSelectedMicronutrient] = useState<Micronutrient | null>(null)

    // Reference Settings Modal
    const [refSettingsOpen, setRefSettingsOpen] = useState(false)
    const [patientRefValues, setPatientRefValues] = useState<Record<string, { min: string; max: string }>>({})

    // Search/Filter
    const [searchQuery, setSearchQuery] = useState('')

    useEffect(() => {
        loadData()
    }, [patientId])

    const loadData = async () => {
        setLoading(true)
        const { data: microData } = await supabase
            .from('micronutrients')
            .select('*')
            .order('category', { ascending: true })
            .order('name')

        if (microData) setMicronutrients(microData)

        const { data: labData } = await supabase
            .from('patient_lab_results')
            .select('*')
            .eq('patient_id', patientId)
            .order('measured_at', { ascending: false })

        if (labData) setLabResults(labData)
        setLoading(false)
    }

    const uniqueDates = useMemo(() => {
        const dates = [...new Set(labResults.map(r => r.measured_at))]
        return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime()).slice(0, 6)
    }, [labResults])

    const getValue = (microId: string, date: string): LabResult | undefined => {
        return labResults.find(r => r.micronutrient_id === microId && r.measured_at === date)
    }

    const getRefValues = (microId: string): { min: number | null; max: number | null } => {
        const latestResult = labResults.find(r => r.micronutrient_id === microId)
        const micro = micronutrients.find(m => m.id === microId)
        return {
            min: latestResult?.ref_min ?? micro?.default_min ?? null,
            max: latestResult?.ref_max ?? micro?.default_max ?? null
        }
    }

    const getValueColor = (value: number, refMin: number | null, refMax: number | null): string => {
        // No reference values - show neutral
        if (refMin === null && refMax === null) return "text-gray-800"

        // Out of range - RED
        if (refMin !== null && value < refMin) return "text-red-600 font-bold"
        if (refMax !== null && value > refMax) return "text-red-600 font-bold"

        // In range - check if close to boundaries for AMBER, otherwise GREEN
        // Calculate the safe zone (10% buffer from each boundary)
        const rangeSize = (refMax ?? 0) - (refMin ?? 0)
        const buffer = rangeSize * 0.1

        // Close to min boundary (within 10% of range from min)
        if (refMin !== null && value < refMin + buffer) return "text-amber-600 font-medium"
        // Close to max boundary (within 10% of range from max)  
        if (refMax !== null && value > refMax - buffer) return "text-amber-600 font-medium"

        // Safely in range - GREEN
        return "text-green-600 font-medium"
    }

    const getTrend = (microId: string): 'up' | 'down' | 'stable' | null => {
        const values = labResults
            .filter(r => r.micronutrient_id === microId)
            .sort((a, b) => new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime())
        if (values.length < 2) return null
        const diff = values[0].value - values[1].value
        const threshold = values[1].value * 0.05
        if (diff > threshold) return 'up'
        if (diff < -threshold) return 'down'
        return 'stable'
    }

    // Save new date with all entered values
    const handleSaveNewDate = async () => {
        if (!newDate) return
        setSaving(true)
        const inserts: { patient_id: string; micronutrient_id: string; value: number; ref_min: number | null; ref_max: number | null; measured_at: string }[] = []

        for (const [microId, valueStr] of Object.entries(newValues)) {
            if (valueStr.trim() === '') continue
            const value = parseFloat(valueStr)
            if (isNaN(value)) continue
            const refs = getRefValues(microId)
            inserts.push({
                patient_id: patientId,
                micronutrient_id: microId,
                value,
                ref_min: refs.min,
                ref_max: refs.max,
                measured_at: newDate
            })
        }

        if (inserts.length > 0) {
            await supabase.from('patient_lab_results').insert(inserts)
            await loadData()
        }
        setIsAddingDate(false)
        setNewValues({})
        setNewDate(new Date().toISOString().split('T')[0])
        setSaving(false)
    }

    // Start editing a column
    const startColumnEdit = (date: string) => {
        const values: Record<string, string> = {}
        micronutrients.forEach(m => {
            const result = getValue(m.id, date)
            values[m.id] = result?.value?.toString() || ''
        })
        setColumnValues(values)
        setEditingColumn(date)
    }

    // Save entire column
    const handleSaveColumn = async () => {
        if (!editingColumn) return
        setSaving(true)

        for (const micro of micronutrients) {
            const valueStr = columnValues[micro.id]
            const existing = getValue(micro.id, editingColumn)

            if (valueStr?.trim() === '') {
                // Delete if cleared
                if (existing) {
                    await supabase.from('patient_lab_results').delete().eq('id', existing.id)
                }
            } else if (valueStr) {
                const value = parseFloat(valueStr)
                if (!isNaN(value)) {
                    if (existing) {
                        // Update
                        await supabase.from('patient_lab_results').update({ value }).eq('id', existing.id)
                    } else {
                        // Insert new
                        const refs = getRefValues(micro.id)
                        await supabase.from('patient_lab_results').insert({
                            patient_id: patientId,
                            micronutrient_id: micro.id,
                            value,
                            ref_min: refs.min,
                            ref_max: refs.max,
                            measured_at: editingColumn
                        })
                    }
                }
            }
        }

        setEditingColumn(null)
        setColumnValues({})
        await loadData()
        setSaving(false)
    }

    // Delete entire column
    const handleDeleteColumn = async (date: string) => {
        if (!confirm(`${formatDate(date)} tarihli tüm tahlilleri silmek istediğinize emin misiniz?`)) return
        setSaving(true)
        await supabase.from('patient_lab_results').delete().eq('patient_id', patientId).eq('measured_at', date)
        await loadData()
        setSaving(false)
    }

    // Reference settings
    const openRefSettings = () => {
        const refs: Record<string, { min: string; max: string }> = {}
        micronutrients.forEach(m => {
            const r = getRefValues(m.id)
            refs[m.id] = { min: r.min?.toString() || '', max: r.max?.toString() || '' }
        })
        setPatientRefValues(refs)
        setRefSettingsOpen(true)
    }

    const handleSaveRefSettings = async () => {
        setSaving(true)
        for (const [microId, refs] of Object.entries(patientRefValues)) {
            const refMin = refs.min ? parseFloat(refs.min) : null
            const refMax = refs.max ? parseFloat(refs.max) : null
            await supabase.from('patient_lab_results')
                .update({ ref_min: refMin, ref_max: refMax })
                .eq('patient_id', patientId)
                .eq('micronutrient_id', microId)
        }
        await loadData()
        setRefSettingsOpen(false)
        setSaving(false)
    }

    const chartData = useMemo(() => {
        if (!selectedMicronutrient) return []
        return labResults
            .filter(r => r.micronutrient_id === selectedMicronutrient.id)
            .sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime())
            .map(r => ({
                date: new Date(r.measured_at).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }),
                value: r.value,
                refMin: r.ref_min,
                refMax: r.ref_max
            }))
    }, [selectedMicronutrient, labResults])

    const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' })

    // Filter by search query
    const filterBySearch = (items: Micronutrient[]) => {
        if (!searchQuery.trim()) return items
        const q = searchQuery.toLocaleLowerCase('tr-TR')
        return items.filter(m => m.name.toLocaleLowerCase('tr-TR').includes(q))
    }

    const mikrobesinler = filterBySearch(micronutrients.filter(m => m.category === 'mikrobesin' || !m.category))
    const kanTahlilleri = filterBySearch(micronutrients.filter(m => m.category === 'kan_tahlili'))

    if (loading) {
        return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
    }

    // Render cell - either editing or display mode
    const renderCell = (micro: Micronutrient, date: string) => {
        const refs = getRefValues(micro.id)
        const isColumnEditing = editingColumn === date && !readOnly

        if (isColumnEditing) {
            return (
                <Input
                    type="number"
                    step="any"
                    value={columnValues[micro.id] || ''}
                    onChange={e => setColumnValues({ ...columnValues, [micro.id]: e.target.value })}
                    className="h-7 w-full text-center text-sm border-indigo-300 bg-indigo-50/50"
                    placeholder="-"
                />
            )
        }

        const result = getValue(micro.id, date)
        if (result) {
            return (
                <span className={`text-sm ${getValueColor(result.value, refs.min, refs.max)}`}>
                    {result.value}
                </span>
            )
        }

        return <span className="text-gray-300">-</span>
    }

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-base font-semibold text-gray-800">🩸 Tahlil Takip</h3>
                <div className="flex items-center gap-2">
                    {/* Search Input */}
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <Input
                            type="text"
                            placeholder="Tahlil ara..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="h-8 w-40 pl-7 text-sm"
                        />
                    </div>
                    <div className="flex gap-2">
                        {!readOnly && (
                            <Button size="sm" variant="outline" onClick={openRefSettings} className="h-8 text-xs">
                                <Settings2 className="h-3.5 w-3.5 mr-1" /> Referanslar
                            </Button>
                        )}
                        {!readOnly && (isAddingDate ? (
                            <>
                                <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-36 h-8 text-sm" />
                                <Button size="sm" onClick={handleSaveNewDate} disabled={saving} className="h-8 bg-green-600 hover:bg-green-700">
                                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />} Kaydet
                                </Button>
                                <Button size="sm" variant="outline" className="h-8" onClick={() => { setIsAddingDate(false); setNewValues({}) }}>
                                    <X className="h-3.5 w-3.5" />
                                </Button>
                            </>
                        ) : (
                            <Button size="sm" onClick={() => setIsAddingDate(true)} className="h-8 bg-indigo-600 hover:bg-indigo-700" disabled={!!editingColumn}>
                                <Plus className="h-3.5 w-3.5 mr-1" /> Yeni Tarih
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Excel-like Table */}
            <div className="border border-gray-300 rounded overflow-auto max-h-[55vh]">
                <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-10 bg-gray-100">
                        <tr>
                            <th className="sticky left-0 z-20 bg-gray-100 border-b border-r border-gray-300 px-3 py-2 text-left font-semibold text-xs text-gray-700 min-w-[180px]">
                                Parametre
                            </th>
                            {isAddingDate && (
                                <th className="border-b border-r border-gray-300 px-2 py-2 text-center font-semibold text-xs bg-indigo-100 text-indigo-800 min-w-[80px]">
                                    <div className="flex flex-col items-center gap-0.5">
                                        <span>{formatDate(newDate)}</span>
                                        <span className="text-[10px] text-indigo-600">Yeni</span>
                                    </div>
                                </th>
                            )}
                            {uniqueDates.map(date => (
                                <th key={date} className={`border-b border-r border-gray-300 px-2 py-1.5 text-center min-w-[80px] ${editingColumn === date ? 'bg-amber-50' : ''}`}>
                                    <div className="flex flex-col items-center gap-0.5">
                                        <span className="font-semibold text-xs text-gray-600">{formatDate(date)}</span>
                                        {editingColumn === date ? (
                                            <div className="flex gap-1">
                                                <Button size="sm" onClick={handleSaveColumn} disabled={saving} className="h-5 px-2 text-[10px] bg-green-600 hover:bg-green-700">
                                                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3 mr-0.5" />Kaydet</>}
                                                </Button>
                                                <Button size="sm" variant="outline" className="h-5 px-1" onClick={() => { setEditingColumn(null); setColumnValues({}) }}>
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        ) : (
                                            !readOnly && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1.5 text-[10px] text-gray-500 hover:text-indigo-600"
                                                    onClick={() => startColumnEdit(date)}
                                                    disabled={isAddingDate || !!editingColumn}
                                                >
                                                    <Pencil className="h-3 w-3 mr-0.5" />Düzenle
                                                </Button>
                                            )
                                        )}
                                    </div>
                                </th>
                            ))}
                            <th className="border-b border-r border-gray-300 px-2 py-2 text-center font-semibold text-xs text-gray-600 w-[50px]">Trend</th>
                            <th className="border-b border-gray-300 px-2 py-2 w-[40px]"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Mikrobesinler */}
                        {mikrobesinler.length > 0 && (
                            <>
                                <tr>
                                    <td colSpan={isAddingDate ? uniqueDates.length + 4 : uniqueDates.length + 3} className="bg-emerald-100 border-b border-gray-300 px-3 py-1.5 font-semibold text-xs text-emerald-800">
                                        🧬 Mikrobesinler
                                    </td>
                                </tr>
                                {mikrobesinler.map(micro => {
                                    const refs = getRefValues(micro.id)
                                    const hasData = labResults.some(r => r.micronutrient_id === micro.id)
                                    return (
                                        <tr key={micro.id} className="hover:bg-gray-50">
                                            <td className="sticky left-0 bg-white border-b border-r border-gray-200 px-3 py-1.5">
                                                <div className="flex items-center gap-1">
                                                    <span className="font-medium text-gray-800">{micro.name}</span>
                                                    <span className="text-gray-400 text-xs">({micro.unit})</span>
                                                    {refs.min !== null && refs.max !== null && (
                                                        <span className="text-[10px] text-gray-400 ml-1">[{refs.min}-{refs.max}]</span>
                                                    )}
                                                </div>
                                            </td>
                                            {isAddingDate && (
                                                <td className="border-b border-r border-gray-200 bg-indigo-50/50 p-1">
                                                    <Input
                                                        type="number"
                                                        step="any"
                                                        value={newValues[micro.id] || ''}
                                                        onChange={e => setNewValues({ ...newValues, [micro.id]: e.target.value })}
                                                        className="h-7 w-full text-center text-sm"
                                                        placeholder="-"
                                                    />
                                                </td>
                                            )}
                                            {uniqueDates.map(date => (
                                                <td key={date} className={`border-b border-r border-gray-200 p-1 text-center h-9 ${editingColumn === date ? 'bg-amber-50/50' : ''}`}>
                                                    {renderCell(micro, date)}
                                                </td>
                                            ))}
                                            <td className="border-b border-r border-gray-200 p-1 text-center">
                                                {(() => {
                                                    const trend = getTrend(micro.id)
                                                    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-500 mx-auto" />
                                                    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-500 mx-auto" />
                                                    if (trend === 'stable') return <Minus className="h-4 w-4 text-gray-400 mx-auto" />
                                                    return <span className="text-gray-300">-</span>
                                                })()}
                                            </td>
                                            <td className="border-b border-gray-200 p-1">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelectedMicronutrient(micro); setChartOpen(true) }} disabled={!hasData}>
                                                    <LineChart className="h-4 w-4 text-indigo-500" />
                                                </Button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </>
                        )}

                        {/* Kan Tahlilleri */}
                        {kanTahlilleri.length > 0 && (
                            <>
                                <tr>
                                    <td colSpan={isAddingDate ? uniqueDates.length + 4 : uniqueDates.length + 3} className="bg-rose-100 border-b border-gray-300 px-3 py-1.5 font-semibold text-xs text-rose-800">
                                        🩸 Kan Tahlilleri
                                    </td>
                                </tr>
                                {kanTahlilleri.map(micro => {
                                    const refs = getRefValues(micro.id)
                                    const hasData = labResults.some(r => r.micronutrient_id === micro.id)
                                    return (
                                        <tr key={micro.id} className="hover:bg-gray-50">
                                            <td className="sticky left-0 bg-white border-b border-r border-gray-200 px-3 py-1.5">
                                                <div className="flex items-center gap-1">
                                                    <span className="font-medium text-gray-800">{micro.name}</span>
                                                    <span className="text-gray-400 text-xs">({micro.unit})</span>
                                                    {refs.min !== null && refs.max !== null && (
                                                        <span className="text-[10px] text-gray-400 ml-1">[{refs.min}-{refs.max}]</span>
                                                    )}
                                                </div>
                                            </td>
                                            {isAddingDate && (
                                                <td className="border-b border-r border-gray-200 bg-indigo-50/50 p-1">
                                                    <Input
                                                        type="number"
                                                        step="any"
                                                        value={newValues[micro.id] || ''}
                                                        onChange={e => setNewValues({ ...newValues, [micro.id]: e.target.value })}
                                                        className="h-7 w-full text-center text-sm"
                                                        placeholder="-"
                                                    />
                                                </td>
                                            )}
                                            {uniqueDates.map(date => (
                                                <td key={date} className={`border-b border-r border-gray-200 p-1 text-center h-9 ${editingColumn === date ? 'bg-amber-50/50' : ''}`}>
                                                    {renderCell(micro, date)}
                                                </td>
                                            ))}
                                            <td className="border-b border-r border-gray-200 p-1 text-center">
                                                {(() => {
                                                    const trend = getTrend(micro.id)
                                                    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-500 mx-auto" />
                                                    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-500 mx-auto" />
                                                    if (trend === 'stable') return <Minus className="h-4 w-4 text-gray-400 mx-auto" />
                                                    return <span className="text-gray-300">-</span>
                                                })()}
                                            </td>
                                            <td className="border-b border-gray-200 p-1">
                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelectedMicronutrient(micro); setChartOpen(true) }} disabled={!hasData}>
                                                    <LineChart className="h-4 w-4 text-indigo-500" />
                                                </Button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Legend */}
            <div className="flex gap-4 text-xs text-gray-500 justify-end">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>Normal</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>Sınırda</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>Dışında</span>
            </div>

            {/* Chart Modal - Draggable */}
            <Dialog open={chartOpen} onOpenChange={setChartOpen}>
                <DraggableDialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <LineChart className="h-5 w-5 text-indigo-600" />
                            {selectedMicronutrient?.name}
                            <span className="text-sm font-normal text-gray-500">({selectedMicronutrient?.unit})</span>
                        </DialogTitle>
                    </DialogHeader>
                    <div className="h-[280px]">
                        {chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <RechartsLineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip contentStyle={{ fontSize: 12 }} />
                                    {chartData[0]?.refMin !== null && <ReferenceLine y={chartData[0].refMin} stroke="#22c55e" strokeDasharray="5 5" label={{ value: 'Min', fontSize: 10 }} />}
                                    {chartData[0]?.refMax !== null && <ReferenceLine y={chartData[0].refMax} stroke="#22c55e" strokeDasharray="5 5" label={{ value: 'Max', fontSize: 10 }} />}
                                    <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1' }} />
                                </RechartsLineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-400">Veri yok</div>
                        )}
                    </div>
                </DraggableDialogContent>
            </Dialog>

            {/* Reference Settings Modal - Draggable, Horizontal Excel-like */}
            <Dialog open={refSettingsOpen} onOpenChange={setRefSettingsOpen}>
                <DraggableDialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Settings2 className="h-5 w-5 text-gray-600" />
                            Hasta Referans Değerleri
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-xs text-gray-500 mb-3">Bu hastanın tahlil sonuçları için özel referans aralıklarını belirleyin.</p>

                    {/* Horizontal Excel-like Table */}
                    <div className="border border-gray-300 rounded overflow-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="border border-gray-300 px-3 py-2 text-left font-semibold text-xs text-gray-700 w-[140px]">Parametre</th>
                                    <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-xs text-gray-700 w-[50px]">Birim</th>
                                    <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-xs text-gray-700 w-[90px]">Min</th>
                                    <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-xs text-gray-700 w-[90px]">Max</th>
                                    <th className="border border-gray-300 w-[20px]"></th>
                                    <th className="border border-gray-300 px-3 py-2 text-left font-semibold text-xs text-gray-700 w-[140px]">Parametre</th>
                                    <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-xs text-gray-700 w-[50px]">Birim</th>
                                    <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-xs text-gray-700 w-[90px]">Min</th>
                                    <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-xs text-gray-700 w-[90px]">Max</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Mikrobesinler Section Header */}
                                {mikrobesinler.length > 0 && (
                                    <tr>
                                        <td colSpan={9} className="bg-emerald-100 border border-gray-300 px-3 py-1 font-semibold text-xs text-emerald-800">
                                            🧬 Mikrobesinler
                                        </td>
                                    </tr>
                                )}
                                {/* Mikrobesinler Rows - 2 items per row */}
                                {Array.from({ length: Math.ceil(mikrobesinler.length / 2) }).map((_, rowIdx) => {
                                    const left = mikrobesinler[rowIdx * 2]
                                    const right = mikrobesinler[rowIdx * 2 + 1]
                                    return (
                                        <tr key={`micro-row-${rowIdx}`} className="hover:bg-gray-50">
                                            {/* Left item */}
                                            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-800">{left?.name || ''}</td>
                                            <td className="border border-gray-200 px-1 py-1 text-center text-gray-500 text-xs">{left?.unit || ''}</td>
                                            <td className="border border-gray-200 p-0">
                                                {left && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[left.id]?.min || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [left.id]: { ...patientRefValues[left.id], min: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                            <td className="border border-gray-200 p-0">
                                                {left && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[left.id]?.max || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [left.id]: { ...patientRefValues[left.id], max: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                            {/* Separator */}
                                            <td className="border border-gray-300 bg-gray-100"></td>
                                            {/* Right item */}
                                            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-800">{right?.name || ''}</td>
                                            <td className="border border-gray-200 px-1 py-1 text-center text-gray-500 text-xs">{right?.unit || ''}</td>
                                            <td className="border border-gray-200 p-0">
                                                {right && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[right.id]?.min || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [right.id]: { ...patientRefValues[right.id], min: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                            <td className="border border-gray-200 p-0">
                                                {right && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[right.id]?.max || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [right.id]: { ...patientRefValues[right.id], max: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}

                                {/* Kan Tahlilleri Section Header */}
                                {kanTahlilleri.length > 0 && (
                                    <tr>
                                        <td colSpan={9} className="bg-rose-100 border border-gray-300 px-3 py-1 font-semibold text-xs text-rose-800">
                                            🩸 Kan Tahlilleri
                                        </td>
                                    </tr>
                                )}
                                {/* Kan Tahlilleri Rows - 2 items per row */}
                                {Array.from({ length: Math.ceil(kanTahlilleri.length / 2) }).map((_, rowIdx) => {
                                    const left = kanTahlilleri[rowIdx * 2]
                                    const right = kanTahlilleri[rowIdx * 2 + 1]
                                    return (
                                        <tr key={`kan-row-${rowIdx}`} className="hover:bg-gray-50">
                                            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-800">{left?.name || ''}</td>
                                            <td className="border border-gray-200 px-1 py-1 text-center text-gray-500 text-xs">{left?.unit || ''}</td>
                                            <td className="border border-gray-200 p-0">
                                                {left && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[left.id]?.min || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [left.id]: { ...patientRefValues[left.id], min: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                            <td className="border border-gray-200 p-0">
                                                {left && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[left.id]?.max || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [left.id]: { ...patientRefValues[left.id], max: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                            <td className="border border-gray-300 bg-gray-100"></td>
                                            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-800">{right?.name || ''}</td>
                                            <td className="border border-gray-200 px-1 py-1 text-center text-gray-500 text-xs">{right?.unit || ''}</td>
                                            <td className="border border-gray-200 p-0">
                                                {right && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[right.id]?.min || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [right.id]: { ...patientRefValues[right.id], min: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                            <td className="border border-gray-200 p-0">
                                                {right && (
                                                    <Input
                                                        type="number"
                                                        value={patientRefValues[right.id]?.max || ''}
                                                        onChange={e => setPatientRefValues({ ...patientRefValues, [right.id]: { ...patientRefValues[right.id], max: e.target.value } })}
                                                        className="h-8 w-full text-center text-sm border-0 rounded-none"
                                                        placeholder="-"
                                                    />
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>

                    <DialogFooter className="mt-4">
                        <Button variant="outline" onClick={() => setRefSettingsOpen(false)}>İptal</Button>
                        <Button onClick={handleSaveRefSettings} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                            Kaydet
                        </Button>
                    </DialogFooter>
                </DraggableDialogContent>
            </Dialog>
        </div>
    )
}
