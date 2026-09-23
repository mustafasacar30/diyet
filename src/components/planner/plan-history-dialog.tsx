"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, History, FileText, User, Copy, Check } from "lucide-react"

interface PlanHistoryDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    patientId: string
}

interface ReportSummary {
    id: string
    generated_at: string
    source: 'patient' | 'dietitian' | 'system'
    week_number: number | null
    target_macros: any
    weekly_totals: any
    label: string | null
}

interface ReportDetail extends ReportSummary {
    logs: any[]
    plan_snapshot: any
    active_rules_summary: any[]
    generated_by_user_id: string | null
    diet_plan_id: string | null
    week_id: string | null
}

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

function describeSlotCode(day: number, slot?: string): string {
    if (day === 0) return 'Tüm hafta seviyesindeki adjustment / post-process log'
    const dayName = DAY_NAMES[day - 1] || `Gün ${day}`
    if (!slot) return `Gün ${day} (${dayName})`
    const s = slot.toUpperCase()
    if (s.startsWith('ITE')) return `Gün ${day} (${dayName}) — Iteration re-plan`
    if (s.startsWith('CRO')) return `Gün ${day} (${dayName}) — Cross-day debt`
    if (s.startsWith('GEN')) return `Gün ${day} (${dayName}) — Genel post-process`
    return `Gün ${day} (${dayName}) — ${slot}`
}

function getEventLabel(event?: string) {
    if (event === 'select') return 'Uygulandı'
    if (event === 'reject') return 'Atlandı'
    if (event === 'error') return 'Hata'
    if (event === 'info') return 'Bilgi'
    return event || 'Kayıt'
}

function getEventClass(event?: string) {
    if (event === 'error') return 'bg-red-50 text-red-800'
    if (event === 'reject') return 'text-orange-600'
    if (event === 'select') return 'text-green-700'
    return 'text-slate-600'
}

export function PlanHistoryDialog({ open, onOpenChange, patientId }: PlanHistoryDialogProps) {
    const [reports, setReports] = useState<ReportSummary[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [detail, setDetail] = useState<ReportDetail | null>(null)
    const [loading, setLoading] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        if (!open || !patientId) return
        setLoading(true)
        fetch(`/api/plan-reports?patient_id=${patientId}&limit=50`)
            .then(r => r.json())
            .then(res => {
                if (res.success) setReports(res.reports || [])
            })
            .catch(err => console.error('list reports failed:', err))
            .finally(() => setLoading(false))
    }, [open, patientId])

    useEffect(() => {
        if (!selectedId) { setDetail(null); return }
        setDetailLoading(true)
        fetch(`/api/plan-reports/${selectedId}`)
            .then(r => r.json())
            .then(res => {
                if (res.success) setDetail(res.report)
            })
            .catch(err => console.error('report detail failed:', err))
            .finally(() => setDetailLoading(false))
    }, [selectedId])

    const copyForAI = async () => {
        if (!detail) return
        const lines: string[] = []
        lines.push('OTOMATIK PLAN — KARAR RAPORU')
        lines.push(`Tarih: ${new Date(detail.generated_at).toLocaleString('tr-TR')}`)
        lines.push(`Kaynak: ${detail.source === 'patient' ? 'Hasta' : detail.source === 'dietitian' ? 'Diyetisyen' : 'Sistem'}`)
        lines.push(`Hafta: ${detail.week_number || '?'}`)
        if (detail.target_macros) lines.push(`Hedef makrolar: ${JSON.stringify(detail.target_macros)}`)
        if (detail.weekly_totals) lines.push(`Haftalık toplam: ${JSON.stringify(detail.weekly_totals)}`)
        lines.push('')
        if (Array.isArray(detail.active_rules_summary)) {
            lines.push('## AKTIF KURALLAR')
            for (const r of detail.active_rules_summary) {
                lines.push(`- [${r.rule_type}] "${r.name}" p=${r.priority} scope=${r.scope}`)
            }
            lines.push('')
        }
        lines.push('## LOG SATIRLARI')
        for (const log of (detail.logs || [])) {
            const prefix = log.day === 0 ? 'GENEL      ' : `G${log.day} ${(log.slot || '').substring(0, 3).padEnd(3)}`.padEnd(11)
            const eventLabel = getEventLabel(log.event).padEnd(10)
            const food = log.food ? ` [${log.food}]` : ''
            lines.push(`${prefix} | ${eventLabel} | ${log.reason}${food}`)
        }
        try {
            await navigator.clipboard.writeText(lines.join('\n'))
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch (e) {
            console.error('copy failed', e)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="w-[95vw] sm:max-w-[95vw] md:max-w-6xl h-[90vh] sm:h-[85vh] flex flex-col p-0 overflow-hidden"
            >
                <DialogHeader className="p-3 sm:p-4 border-b shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
                        <History className="h-4 w-4" />
                        Planlama Geçmişi
                        {selectedId && (
                            <button
                                onClick={() => setSelectedId(null)}
                                className="md:hidden ml-auto text-xs text-emerald-600 underline"
                            >
                                ← Listeye dön
                            </button>
                        )}
                    </DialogTitle>
                    <DialogDescription className="text-[11px] sm:text-xs">
                        Otomatik plan üretim karar raporları.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    {/* Left: list — mobile'da detay seçilince gizle; desktop'ta hep göster */}
                    <div className={`${selectedId ? 'hidden md:flex' : 'flex'} md:w-72 md:border-r border-b md:border-b-0 flex-col overflow-hidden shrink-0 max-h-[40vh] md:max-h-none`}>
                        <div className="p-2 border-b bg-slate-50 text-xs font-semibold text-slate-600">
                            {loading ? 'Yükleniyor...' : `${reports.length} rapor`}
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y">
                            {reports.map(r => {
                                const isSelected = r.id === selectedId
                                return (
                                    <button
                                        key={r.id}
                                        onClick={() => setSelectedId(r.id)}
                                        className={`w-full text-left p-3 hover:bg-emerald-50 transition-colors ${isSelected ? 'bg-emerald-100' : ''}`}
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-1">
                                            <div className="text-xs font-semibold text-slate-800">
                                                {r.label || `Hafta ${r.week_number || '?'}`}
                                            </div>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${r.source === 'patient' ? 'bg-blue-100 text-blue-700' : r.source === 'dietitian' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                                                {r.source === 'patient' ? 'Hasta' : r.source === 'dietitian' ? 'Diyetisyen' : 'Sistem'}
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                            {new Date(r.generated_at).toLocaleString('tr-TR')}
                                        </div>
                                        {r.weekly_totals && (
                                            <div className="text-[10px] text-slate-600 mt-1">
                                                Kal: {Math.round(r.weekly_totals?.avg?.calories || r.weekly_totals?.calories || 0)} / {r.target_macros?.calories || '?'} kcal
                                            </div>
                                        )}
                                    </button>
                                )
                            })}
                            {!loading && reports.length === 0 && (
                                <div className="p-4 text-center text-xs text-slate-400">Henüz rapor yok.</div>
                            )}
                        </div>
                    </div>

                    {/* Right: detail — mobile'da rapor seçilmediyse gizle */}
                    <div className={`${selectedId ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden`}>
                        {!selectedId ? (
                            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                                Sol taraftan bir rapor seçin.
                            </div>
                        ) : detailLoading || !detail ? (
                            <div className="flex-1 flex items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
                            </div>
                        ) : (
                            <>
                                <div className="p-2 sm:p-3 border-b bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                                    <div className="text-[11px] sm:text-xs text-slate-600 flex flex-wrap items-center gap-2 sm:gap-3">
                                        <span className="flex items-center gap-1"><FileText size={12} /> {detail.label || `Hafta ${detail.week_number || '?'}`}</span>
                                        <span className="flex items-center gap-1"><User size={12} /> {detail.source === 'patient' ? 'Hasta' : detail.source === 'dietitian' ? 'Diyetisyen' : 'Sistem'}</span>
                                        <span className="text-[10px] sm:text-xs">{new Date(detail.generated_at).toLocaleString('tr-TR')}</span>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={copyForAI} className="h-7 gap-1 text-xs self-end sm:self-auto">
                                        <Copy size={12} />
                                        {copied ? 'Kopyalandı!' : 'AI\'ye kopyala'}
                                    </Button>
                                </div>

                                {detail.target_macros && (
                                    <div className="px-2 sm:px-3 py-1.5 sm:py-2 border-b text-[10px] sm:text-xs text-slate-700 bg-white flex gap-2 sm:gap-4 flex-wrap">
                                        <span>Kal: <b>{detail.target_macros.calories}</b></span>
                                        <span>P: <b>{detail.target_macros.protein}g</b></span>
                                        <span>K: <b>{detail.target_macros.carbs}g</b></span>
                                        <span>Y: <b>{detail.target_macros.fat}g</b></span>
                                    </div>
                                )}

                                <div className="flex-1 overflow-y-auto p-2 sm:p-3">
                                    <div className="space-y-1 font-mono text-[10px] sm:text-xs">
                                        {(detail.logs || []).map((log: any, idx: number) => (
                                            <div key={idx} className={`flex flex-wrap sm:flex-nowrap gap-1 sm:gap-2 py-1 border-b border-slate-100 ${getEventClass(log.event)}`}>
                                                <span className="w-20 sm:w-24 shrink-0 font-semibold text-slate-400" title={describeSlotCode(log.day, log.slot)}>
                                                    {log.day === 0 ? 'GENEL' : `G${log.day} ${(log.slot || '').substring(0, 3)}`}
                                                </span>
                                                <span className="uppercase font-bold shrink-0 w-14 sm:w-16 text-[9px] sm:text-[10px] pt-0.5">
                                                    {getEventLabel(log.event)}
                                                </span>
                                                <div className="flex-1 min-w-0 break-words">
                                                    <span>{log.reason}</span>
                                                    {log.food && <span className="font-bold ml-1">[{log.food}]</span>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
