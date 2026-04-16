'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'

export interface BalanceChange {
    id: string
    type: 'portion' | 'swap' | 'add' | 'remove'
    foodId?: string
    foodName: string
    detail: string
    slotName?: string
    diffCals: number
    diffProt: number
    diffFat: number
    diffCarbs: number
    originalMultiplier?: number
    newMultiplier?: number
    newFood?: any
    day?: number
    dayName?: string
    isAlternative?: boolean
}

interface BalanceConfirmModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: (approvedChanges: BalanceChange[]) => void
    title: string
    initialTotals: {
        calories: number
        protein: number
        fat: number
        carbs: number
    }
    targetMacros: {
        calories: number
        protein: number
        fat: number
        carbs: number
    }
    changes: BalanceChange[]
    defaultSelectAll?: boolean
}

const mojibakeMap: Array<[string, string]> = [
    ['Ã‡', 'Ç'],
    ['Ã§', 'ç'],
    ['ÄŸ', 'ğ'],
    ['Äž', 'Ğ'],
    ['Ä', 'Ğ'],
    ['Ä±', 'ı'],
    ['Ä°', 'İ'],
    ['Ã–', 'Ö'],
    ['Ã¶', 'ö'],
    ['Ãœ', 'Ü'],
    ['Ã¼', 'ü'],
    ['Åž', 'Ş'],
    ['ÅŸ', 'ş'],
    ['Ä°ptal', 'İptal'],
    ['YaÄŸ', 'Yağ'],
    ['DeÄŸişim', 'Değişim'],
    ['Ã‡ıkarma', 'Çıkarma'],
    ['DÃ¼zenleme', 'Düzenleme'],
    ['Ã–neri', 'Öneri'],
    ['GÃœNLÃœK', 'GÜNLÜK'],
    ['â†’', '→'],
]

const normalizeText = (value?: string) => {
    if (!value) return ''
    let next = value
    for (const [bad, good] of mojibakeMap) next = next.split(bad).join(good)
    return next
}

const getTypeLabel = (type: BalanceChange['type']) => {
    if (type === 'swap') return 'Değişim'
    if (type === 'add') return 'Ekleme'
    if (type === 'remove') return 'Çıkarma'
    return 'Porsiyon'
}

const getTypeBadgeClass = (type: BalanceChange['type']) => {
    if (type === 'swap') return 'bg-blue-100 text-blue-700'
    if (type === 'add') return 'bg-emerald-100 text-emerald-700'
    if (type === 'remove') return 'bg-rose-100 text-rose-700'
    return 'bg-amber-100 text-amber-700'
}

const short = (text: string, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const getDayToneClass = (dayNameRaw: string) => {
    const day = normalizeText(dayNameRaw).toLowerCase()
    if (day.includes('pazartesi')) return 'bg-emerald-50/70'
    if (day.includes('salı')) return 'bg-sky-50/70'
    if (day.includes('çarşamba')) return 'bg-amber-50/70'
    if (day.includes('perşembe')) return 'bg-violet-50/70'
    if (day.includes('cuma')) return 'bg-rose-50/70'
    if (day.includes('cumartesi')) return 'bg-indigo-50/70'
    if (day.includes('pazar')) return 'bg-teal-50/70'
    return 'bg-slate-50/70'
}

const extractBeforeAfter = (change: BalanceChange) => {
    const raw = normalizeText(change.detail || '')
    const byArrow = raw.includes('→') ? raw.split('→') : (raw.includes('->') ? raw.split('->') : null)
    if (change.type === 'swap' && byArrow && byArrow.length >= 2) {
        return {
            before: byArrow[0].trim(),
            after: byArrow.slice(1).join('→').trim()
        }
    }
    if (change.type === 'add') {
        return { before: '—', after: normalizeText(change.foodName || 'Yeni yemek') }
    }
    if (change.type === 'remove') {
        return { before: normalizeText(change.foodName || 'Yemek'), after: '—' }
    }
    return { before: normalizeText(change.foodName || 'Yemek'), after: raw || normalizeText(change.foodName || 'Yemek') }
}

export function BalanceConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    initialTotals,
    targetMacros,
    changes,
    defaultSelectAll = false
}: BalanceConfirmModalProps) {
    const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set())
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (isOpen && changes) {
            const selected = defaultSelectAll
                ? changes.map((c) => c.id)
                : changes.filter((c) => !c.isAlternative).map((c) => c.id)
            setSelectedChanges(new Set(selected))
            setExpandedRows(new Set())
        }
    }, [isOpen, changes, defaultSelectAll])

    const handleToggle = (id: string) => {
        const next = new Set(selectedChanges)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelectedChanges(next)
    }

    const toggleExpand = (id: string) => {
        const next = new Set(expandedRows)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setExpandedRows(next)
    }

    const currentTotals = useMemo(() => {
        const totals = { ...initialTotals }
        changes.forEach((c) => {
            if (!selectedChanges.has(c.id)) return
            totals.calories += c.diffCals
            totals.protein += c.diffProt
            totals.fat += c.diffFat
            totals.carbs += c.diffCarbs
        })
        return totals
    }, [changes, initialTotals, selectedChanges])

    const calcPct = (val: number, target: number) => {
        if (!target || target <= 0) return 0
        return Math.round((val / target) * 100)
    }

    const renderMacroRow = (label: string, initialVal: number, currentVal: number, target: number) => {
        const initialPct = calcPct(initialVal, target)
        const currentPct = calcPct(currentVal, target)
        const displayInitial = Math.round(initialVal)
        const displayCurrent = Math.round(currentVal)
        const displayTarget = Math.round(target)

        return (
            <div className="flex flex-col py-0.5 border-b border-slate-50 last:border-0">
                <div className="flex items-center justify-between text-[10px] sm:text-xs">
                    <span className="font-bold text-slate-700 w-12 sm:w-16 truncate">{label}:</span>
                    <div className="flex items-center gap-1 flex-1 justify-center min-w-0">
                        <span className="text-slate-500 font-medium truncate">{displayInitial}</span>
                        <ArrowRight className="w-2.5 h-2.5 text-slate-300 shrink-0" />
                        <span className="font-bold text-slate-800 truncate">{displayCurrent}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 w-14 sm:w-16 text-right truncate">
                        Hd: {displayTarget}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-8 text-[9px] text-slate-400 text-right">% {initialPct}</div>
                    <div className="flex-1 relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="absolute top-0 left-0 h-full bg-slate-300 opacity-50" style={{ width: `${Math.min(100, initialPct)}%` }} />
                        <div
                            className={`absolute top-0 left-0 h-full transition-all duration-300 ${currentPct >= 90 && currentPct <= 110 ? 'bg-emerald-500' : currentPct > 110 ? 'bg-amber-500' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(100, currentPct)}%` }}
                        />
                    </div>
                    <div className={`w-8 text-[9px] font-bold text-right ${currentPct >= 90 && currentPct <= 110 ? 'text-emerald-600' : currentPct > 110 ? 'text-amber-600' : 'text-blue-600'}`}>
                        % {currentPct}
                    </div>
                </div>
            </div>
        )
    }

    const renderDeltaChip = (label: string, value: number, positiveClass: string, negativeClass: string) => {
        if (!value) return null
        const klass = value > 0 ? positiveClass : negativeClass
        return (
            <span className={`px-2 py-0.5 rounded-full ${klass}`}>
                {label}: {value > 0 ? '+' : ''}{Math.round(value)}
            </span>
        )
    }

    const renderChangeRow = (change: BalanceChange, alt = false) => {
        const isSelected = selectedChanges.has(change.id)
        const isExpanded = expandedRows.has(change.id)
        const dayName = normalizeText(change.dayName || (change.day ? `Gün ${change.day}` : '-'))
        const slotName = normalizeText(change.slotName || '-')
        const detail = normalizeText(change.detail || '')
        const pair = extractBeforeAfter(change)

        const baseClass = alt
            ? 'border-amber-200 bg-white'
            : 'border-emerald-200 bg-white'
        const selectedClass = isSelected
            ? (alt ? 'shadow-[0_0_0_1px_rgba(251,191,36,0.35)]' : 'shadow-[0_0_0_1px_rgba(52,211,153,0.35)]')
            : 'opacity-70'

        return (
            <div key={change.id} className={`rounded-lg border ${baseClass} ${selectedClass} ${getDayToneClass(dayName)}`}>
                <div className="flex items-center gap-2 px-2.5 py-2">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggle(change.id)}
                        className="w-4 h-4 rounded-sm data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                    />
                    <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => toggleExpand(change.id)}
                    >
                        <div className="grid grid-cols-[68px_58px_66px_1fr_auto] items-center gap-1.5">
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded truncate">{dayName}</span>
                            <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded uppercase truncate">{slotName}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getTypeBadgeClass(change.type)}`}>{getTypeLabel(change.type)}</span>
                            <span className={`text-[11px] font-semibold text-slate-700 ${isSelected ? '' : 'opacity-70'}`}>Değişiklik detayı</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                        </div>
                        <div className="mt-1.5 text-[12px] text-slate-700 leading-snug break-words whitespace-normal">
                            <span className="font-medium">{pair.before}</span>
                            <span className="mx-1 text-slate-400">→</span>
                            <span className="font-semibold text-slate-900">{pair.after}</span>
                        </div>
                    </button>
                </div>

                {isExpanded && (
                    <div className="px-2.5 pb-2.5 border-t border-slate-100">
                        <div className="pt-2 text-[12px] text-slate-700 leading-snug">
                            {detail}
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-[10px] font-medium mt-2">
                            {renderDeltaChip('Kalori', change.diffCals, 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700')}
                            {renderDeltaChip('Pro', change.diffProt, 'bg-blue-100 text-blue-700', 'bg-slate-100 text-slate-600')}
                            {renderDeltaChip('Karb', change.diffCarbs, 'bg-orange-100 text-orange-700', 'bg-slate-100 text-slate-600')}
                            {renderDeltaChip('Yağ', change.diffFat, 'bg-red-100 text-red-700', 'bg-slate-100 text-slate-600')}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    const primaryChanges = changes.filter((c) => !c.isAlternative)
    const alternativeChanges = changes.filter((c) => c.isAlternative)

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="!w-screen !h-[100dvh] !max-w-none !rounded-none !border-0 !left-0 !top-0 !translate-x-0 !translate-y-0 sm:!w-full sm:!h-auto sm:!max-w-[560px] sm:!max-h-[90dvh] sm:!rounded-xl sm:!top-[50%] sm:!left-[50%] sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:!border p-0 bg-slate-50 sm:bg-white flex flex-col overflow-hidden">
                <DialogHeader className="p-3 sm:p-4 bg-white border-b border-slate-100 shrink-0 flex flex-col items-center">
                    <DialogTitle className="text-base sm:text-lg text-center font-bold text-slate-800">
                        {normalizeText(title)}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Önerilen değişiklikleri seçip detayları inceleyerek onaylayın.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto w-full flex flex-col relative">
                    <div className="bg-white px-3 py-2 sm:p-4 border-b border-slate-100 shadow-sm shrink-0 sticky top-0 z-20">
                        {renderMacroRow('Kalori', initialTotals.calories, currentTotals.calories, targetMacros.calories)}
                        {renderMacroRow('Protein', initialTotals.protein, currentTotals.protein, targetMacros.protein)}
                        {renderMacroRow('Karb', initialTotals.carbs, currentTotals.carbs, targetMacros.carbs)}
                        {renderMacroRow('Yağ', initialTotals.fat, currentTotals.fat, targetMacros.fat)}
                    </div>

                    <div className="px-2.5 sm:px-4 pt-3 pb-6 space-y-4">
                        {changes.length === 0 && (
                            <div className="text-center text-sm text-slate-500 py-6 bg-slate-50 rounded-lg border border-slate-100">
                                Önerilen değişiklik bulunamadı.
                            </div>
                        )}

                        {primaryChanges.length > 0 && (
                            <div className="space-y-2">
                                <div className="text-[11px] font-black text-slate-500 tracking-wide uppercase px-0.5">
                                    Temel Düzenlemeler
                                </div>
                                <div className="grid grid-cols-[68px_58px_66px_1fr] gap-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400 px-9">
                                    <span>Gün</span>
                                    <span>Öğün</span>
                                    <span>Değişim</span>
                                    <span>Yemek</span>
                                </div>
                                <div className="space-y-2">
                                    {primaryChanges.map((change) => renderChangeRow(change, false))}
                                </div>
                            </div>
                        )}

                        {alternativeChanges.length > 0 && (
                            <div className="space-y-2 mt-2">
                                <div className="text-[11px] font-black text-amber-700 tracking-wide uppercase px-0.5">
                                    Alternatif İnce Ayarlar
                                </div>
                                <div className="space-y-2">
                                    {alternativeChanges.map((change) => renderChangeRow(change, true))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="p-4 bg-white border-t border-slate-100 shrink-0 flex flex-row items-center gap-3 w-full">
                    <Button
                        variant="outline"
                        className="flex-1 text-slate-600 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                        onClick={onClose}
                    >
                        İptal
                    </Button>
                    <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm"
                        onClick={() => {
                            const approved = changes.filter((c) => selectedChanges.has(c.id))
                            onConfirm(approved)
                        }}
                    >
                        Onayla
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
