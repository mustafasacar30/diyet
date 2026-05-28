"use client"

import { useState, useEffect } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Check, AlertCircle, Loader2, Settings, Trash2, Plus, FileSpreadsheet, Search, Key, LogIn, FileText, Download, Ban, Copy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useGapi } from '@/hooks/use-gapi'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calendar as CalendarIcon, Save, ArrowLeft, CheckCircle2 } from "lucide-react"
import { 
    Tooltip, 
    TooltipContent, 
    TooltipProvider, 
    TooltipTrigger 
} from "@/components/ui/tooltip"

const formatDateISO = (date: Date) => {
    const d = new Date(date)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    return d.toISOString().split('T')[0]
}

interface WeekImportDialogProps {
    isOpen: boolean
    onClose: () => void
    onImport: (days: ParsedDay[], mode: 'replace' | 'append') => Promise<void>
    weekId: string
    checkSeasonality: (food: any, date?: Date) => { inSeason: boolean, reason?: string }
    allFoods: any[] // Now passed as a prop
    patientName?: string // New prop for auto-search
    weekNumber?: number // New prop for auto-tab selection
    autoStart?: boolean // Auto-start Google Sheets flow
    onBulkImport?: (weekData: { weekNumber: number, tabName: string, startDate: string, endDate: string, days: ParsedDay[] }[]) => Promise<void> // NEW: Bulk import
}

type MenuPoolEntry = {
    week_id: string | null
    patient_id: string | null
    program_template_id: string | null
    week_number: number | null
    source_type: string
    source_file_id: string | null
    source_file_name: string | null
    source_tab_name: string | null
    source_patient_name: string | null
    raw_text: string
    parsed_days: ParsedDay[]
}

export interface ParsedDay {
    dayName: string
    date?: string
    is_active?: boolean
    meals: ParsedMeal[]
}

export interface ParsedMeal {
    mealName: string
    foods: ParsedFood[]
}

export interface ParsedFood {
    originalText: string
    foodName: string
    calories: number
    protein: number
    carbs: number
    fat: number
    matchedFoodId?: string
    matchConfidence?: number // 0-1
    portionMultiplier?: number
    status: 'matched' | 'unknown' | 'created'
}

interface IgnoreHistoryItem {
    ruleId?: string
    pattern: string
    dayIdx: number
    mealIdx: number
    foodIdx: number
    food: ParsedFood
}

type RuleType = 'replace' | 'ignore' | 'header' | 'food'

interface ImportRule {
    id: string
    rule_type: RuleType
    pattern: string
    replacement?: string
}

function ImportRulesDialog({ rules, onRulesChange }: { rules: ImportRule[], onRulesChange: () => void }) {
    const [newPattern, setNewPattern] = useState('')
    const [newReplacement, setNewReplacement] = useState('')
    const [newType, setNewType] = useState<RuleType>('replace')
    const [isOpen, setIsOpen] = useState(false)
    const [loading, setLoading] = useState(false)

    async function addRule() {
        if (!newPattern.trim()) return
        setLoading(true)
        const { error } = await supabase.from('import_rules').insert({
            rule_type: newType,
            pattern: newPattern,
            replacement: (newType === 'replace' || newType === 'header' || newType === 'food') ? newReplacement : null
        })

        if (error) {
            alert('Kural eklenirken hata oluştu: ' + error.message)
        } else {
            onRulesChange()
            setNewPattern('')
            setNewReplacement('')
        }
        setLoading(false)
    }

    async function removeRule(id: string) {
        if (!confirm('Bu kuralı silmek istediğinize emin misiniz?')) return
        setLoading(true)
        const { error } = await supabase.from('import_rules').delete().eq('id', id)
        if (error) {
            alert('Silme hatası: ' + error.message)
        } else {
            onRulesChange()
        }
        setLoading(false)
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 h-8 text-xs">
                    <Settings size={14} />
                    Ayrıştırma Kuralları
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Ayrıştırma Ayarları</DialogTitle>
                    <DialogDescription>
                        Metin ayrıştırılırken uygulanacak manuel kurallar ekleyin. Bu kurallar veritabanında saklanır.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="flex gap-2 items-end border-b pb-4">
                        <div className="grid gap-2 flex-[1.5]">
                            <Label>Kural Tipi</Label>
                            <Select value={newType} onValueChange={(v: RuleType) => setNewType(v)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="replace">Düzelt &amp; Yemek (Replace)</SelectItem>
                                    <SelectItem value="header">Sadece Başlık (Yemek Yok)</SelectItem>
                                    <SelectItem value="food">Yemek Olarak Ekle (0 Makro)</SelectItem>
                                    <SelectItem value="ignore">Yoksay (Ignore)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2 flex-[2]">
                            <Label>Aranacak Metin (İçerir)</Label>
                            <Input value={newPattern} onChange={e => setNewPattern(e.target.value)} placeholder="Örn: Öğle (Saat..." />
                        </div>
                        {(newType === 'replace' || newType === 'header' || newType === 'food') && (
                            <div className="grid gap-2 flex-[2]">
                                <Label>{newType === 'food' ? 'Yemek Adı (Boş bırakılırsa satır alınır)' : 'Yeni Değer / Başlık Adı'}</Label>
                                <Input value={newReplacement} onChange={e => setNewReplacement(e.target.value)} placeholder={newType === 'food' ? 'Örn: Turşu' : newType === 'header' ? "Örn: ÖĞLEN" : "Örn: ÖĞLEN"} />
                            </div>
                        )}
                        <Button onClick={addRule} size="icon" className="mb-0.5" disabled={loading}>
                            {loading ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                        </Button>
                    </div>

                    <ScrollArea className="h-[300px]">
                        {rules.length === 0 && <div className="text-center text-gray-400 py-8">Henüz kural yok.</div>}
                        <div className="space-y-2">
                            {rules.map(rule => (
                                <div key={rule.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border text-sm">
                                    <div className="flex items-center gap-2">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${rule.rule_type === 'replace' ? 'bg-blue-100 text-blue-700' :
                                            rule.rule_type === 'header' ? 'bg-purple-100 text-purple-700' :
                                                rule.rule_type === 'food' ? 'bg-green-100 text-green-700' :
                                                    'bg-red-100 text-red-700'
                                            }`}>
                                            {rule.rule_type === 'replace' ? 'DÜZELT' :
                                                rule.rule_type === 'header' ? 'BAŞLIK' :
                                                    rule.rule_type === 'food' ? 'YEMEK' : 'YOKSAY'}
                                        </span>
                                        <span className="font-mono truncate max-w-[150px]" title={rule.pattern}>"{rule.pattern}"</span>
                                        {(rule.rule_type === 'replace' || rule.rule_type === 'header' || rule.rule_type === 'food') && (
                                            <>
                                                <span className="text-gray-400">→</span>
                                                <span className="font-bold text-green-700">"{rule.replacement}"</span>
                                            </>
                                        )}
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400 hover:text-red-700" onClick={() => removeRule(rule.id)} disabled={loading}>
                                        <Trash2 size={14} />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export function WeekImportDialog({ isOpen, onClose, onImport, weekId, checkSeasonality, allFoods, patientName = '', weekNumber = 1, autoStart = false, onBulkImport }: WeekImportDialogProps) {
    const [step, setStep] = useState<'input' | 'review' | 'bulk-review'>('input')
    const [text, setText] = useState('')
    const [parsedDays, setParsedDays] = useState<ParsedDay[]>([])
    const [isProcessing, setIsProcessing] = useState(false)
    const [activeTab, setActiveTab] = useState<'text' | 'google'>(autoStart ? 'google' : 'text')

    // Google State
    const gapiEnabled = isOpen && activeTab === 'google'
    const { isReady, isInitializing, isInitialized, initClient, login, isAuthenticated, error: gapiError, gapi, logs } = useGapi(gapiEnabled)
    const [apiKey, setApiKey] = useState('AIzaSyAFRdF7Myoa27DpBmt76_trtwEVpFpWgL8')
    const [clientId, setClientId] = useState('337617773303-3h4isdumdaptn9psov53a930dp9c4826.apps.googleusercontent.com')
    const [searchQuery, setSearchQuery] = useState(patientName)
    const [autoStartTriggered, setAutoStartTriggered] = useState(false)
    const [foundFiles, setFoundFiles] = useState<any[]>([])
    const [selectedFile, setSelectedFile] = useState<any>(null)
    const [sheetTabs, setSheetTabs] = useState<string[]>([])
    const [selectedTab, setSelectedTab] = useState('')
    const [selectedTabs, setSelectedTabs] = useState<string[]>([])
    const [configOpen, setConfigOpen] = useState(false)
    const [autoImportStatus, setAutoImportStatus] = useState<string>('')
    const [pendingAutoImport, setPendingAutoImport] = useState(false)
    const [bulkBaseDate, setBulkBaseDate] = useState<string>('')
    const [bulkImportData, setBulkImportData] = useState<{ 
        weekNumber: number, 
        tabName: string, 
        startDate: string, 
        endDate: string, 
        days: any[] 
    }[]>([])

    // DB Rules
    const [rules, setRules] = useState<ImportRule[]>([])

    // Bulk Import Mode
    const [bulkMode, setBulkMode] = useState<'single' | 'all'>('single')
    const [detectedWeekTabs, setDetectedWeekTabs] = useState<{ tabName: string, weekNumber: number }[]>([])
    const [localFoods, setLocalFoods] = useState<any[]>(allFoods || [])
    const [importMode, setImportMode] = useState<'append' | 'replace'>('replace')
    const [loadedTabNames, setLoadedTabNames] = useState<string[]>([])
    const [ignoreHistory, setIgnoreHistory] = useState<IgnoreHistoryItem[]>([])
    const [isSyncingPool, setIsSyncingPool] = useState(false)

    // --- UTILITIES ---
    function findBestMatch(text: string) {
        if (!localFoods.length) return null

        const normalize = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9ğüşıöç]/g, '')
        const target = normalize(text)

        let best = null
        let bestScore = 0

        for (const food of localFoods) {
            const current = normalize(food.name)

            // 1. Exact or Substring Match (DB contains Target)
            if (current.includes(target)) {
                const score = target.length / current.length
                if (score > bestScore) {
                    bestScore = score
                    best = food
                }
            }
            // 2. Prefix Boost
            if (current.startsWith(target) || target.startsWith(current)) {
                const shorterLen = Math.min(current.length, target.length)
                if (shorterLen >= 3) {
                    if (0.95 > bestScore) {
                        bestScore = 0.95
                        best = food
                    }
                }
            }
        }

        if (best && normalize(best.name) === target) {
            bestScore = 1.0
        }

        return best ? { id: best.id, score: bestScore } : null
    }

    function getFoodsForParsing() {
        const hasMacroColumns = (arr: any[]) =>
            Array.isArray(arr) && arr.some(f =>
                ['calories', 'carbs', 'protein', 'fat'].some(k => typeof f?.[k] === 'number')
            )

        if (hasMacroColumns(localFoods)) return localFoods
        if (hasMacroColumns(allFoods || [])) return allFoods || []
        return localFoods?.length ? localFoods : (allFoods || [])
    }

    // Sync prop to local state
    useEffect(() => {
        if (allFoods) setLocalFoods(allFoods)
    }, [allFoods])

    // Auto-start effect: trigger oneClickImport when dialog opens with autoStart=true
    useEffect(() => {
        if (isOpen && autoStart && !autoStartTriggered) {
            setAutoStartTriggered(true)
            setActiveTab('google')
            // Small delay to ensure component is mounted
            if (isAuthenticated) {
                setTimeout(() => {
                    oneClickImport()
                }, 300)
            }
        }
        // Reset trigger when dialog closes
        if (!isOpen) {
            setAutoStartTriggered(false)
        }
    }, [isOpen, autoStart, isAuthenticated])

    // --- WEEK TAB MATCHING ---
    function getExactWeekNumberFromTab(tabName: string): number | null {
        const normalized = tabName
            .trim()
            .toLocaleLowerCase('tr-TR')
            .replace(/\s+/g, ' ')

        // Explicitly exclude noisy / derivative tabs
        if (/(pdf|gdf|kopya|copy|yedek|backup|arsiv|archive)/i.test(normalized)) {
            return null
        }

        // Accept only exact forms:
        // "1. hafta", "1 hafta", "hafta 1", "hafta 1."
        const exactForward = normalized.match(/^(\d+)\.?\s*hafta$/i)
        if (exactForward?.[1]) {
            const n = parseInt(exactForward[1], 10)
            return Number.isFinite(n) ? n : null
        }

        const exactReverse = normalized.match(/^hafta\s*(\d+)\.?$/i)
        if (exactReverse?.[1]) {
            const n = parseInt(exactReverse[1], 10)
            return Number.isFinite(n) ? n : null
        }

        return null
    }

    function matchWeekTab(tabs: string[], targetWeek: number): string | null {
        for (const tab of tabs) {
            const n = getExactWeekNumberFromTab(tab)
            if (n === targetWeek) return tab
        }
        return null
    }

    function toggleTabSelection(tab: string) {
        setSelectedTabs(prev => prev.includes(tab) ? prev.filter(t => t !== tab) : [...prev, tab])
    }

    function downloadFile(filename: string, content: string, mimeType: string) {
        const blob = new Blob([content], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    function handleExportTxt() {
        if (!text.trim()) return
        const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        downloadFile(`program-import-${now}.txt`, text, 'text/plain;charset=utf-8')
    }

    function handleExportJson() {
        const payload = {
            exportedAt: new Date().toISOString(),
            source: activeTab === 'google' ? 'google_sheets' : 'text',
            fileName: selectedFile?.name || null,
            tabs: loadedTabNames,
            parsedDays,
            bulkImportData,
            rawText: text,
        }
        const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        downloadFile(`program-import-${now}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8')
    }

    function csvEscape(value: any) {
        const str = String(value ?? '')
        if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
        return str
    }

    function buildCsvFromRawText(rawText: string) {
        const rows = rawText
            .split(/\r?\n/)
            .filter(line => line.trim().length > 0)
            .map(line => line.split('\t'))

        if (rows.length === 0) return ''

        const maxCols = Math.max(1, ...rows.map(r => r.length))
        const header = Array.from({ length: maxCols }, (_, i) => `col_${i + 1}`)
        const csvRows = [header, ...rows]
        return csvRows
            .map(row => {
                const normalized = [...row]
                while (normalized.length < maxCols) normalized.push('')
                return normalized.map(csvEscape).join(',')
            })
            .join('\n')
    }

    function buildPlainTextFromParsedDays(days: ParsedDay[]) {
        const lines: string[] = []
        lines.push('Makro sirasi: Kalori | Karb | Prot | Yag')
        lines.push('')

        for (const day of days) {
            lines.push(day.dayName)
            for (const meal of day.meals) {
                lines.push(`  ${meal.mealName}`)
                for (const food of meal.foods) {
                    const label = food.originalText || food.foodName
                    lines.push(`    - ${label} | ${food.calories} ${food.carbs} ${food.protein} ${food.fat}`)
                }
            }
            lines.push('')
        }
        return lines.join('\n').trim()
    }

    function buildCsvFromParsedDays(days: ParsedDay[]) {
        const header = ['day', 'meal', 'food', 'calories', 'carbs', 'protein', 'fat', 'status', 'matched_food', 'original_text']
        const rows: string[][] = [header]

        for (const day of days) {
            for (const meal of day.meals) {
                for (const food of meal.foods) {
                    rows.push([
                        day.dayName,
                        meal.mealName,
                        food.foodName || food.originalText || '',
                        String(food.calories ?? 0),
                        String(food.carbs ?? 0),
                        String(food.protein ?? 0),
                        String(food.fat ?? 0),
                        food.status,
                        food.matchedFoodId ? (localFoods.find(f => f.id === food.matchedFoodId)?.name || '') : '',
                        food.originalText || '',
                    ])
                }
            }
        }

        return rows.map(row => row.map(csvEscape).join(',')).join('\n')
    }

    function buildPlainTextFromBulkImportData() {
        const lines: string[] = []
        lines.push('Makro sirasi: Kalori | Karb | Prot | Yag')
        lines.push('')
        for (const week of bulkImportData) {
            lines.push(`### HAFTA ${week.weekNumber} | ${week.tabName} | ${week.startDate} - ${week.endDate} ###`)
            for (const day of week.days) {
                lines.push(day.dayName)
                for (const meal of day.meals) {
                    lines.push(`  ${meal.mealName}`)
                    for (const food of meal.foods) {
                        const label = food.originalText || food.foodName
                        lines.push(`    - ${label} | ${food.calories} ${food.carbs} ${food.protein} ${food.fat}`)
                    }
                }
            }
            lines.push('')
        }
        return lines.join('\n').trim()
    }

    function buildCsvFromBulkImportData() {
        const header = ['week_no', 'tab_name', 'start_date', 'end_date', 'day', 'meal', 'food', 'calories', 'carbs', 'protein', 'fat']
        const rows: string[][] = [header]

        for (const week of bulkImportData) {
            for (const day of week.days) {
                for (const meal of day.meals) {
                    for (const food of meal.foods) {
                        rows.push([
                            String(week.weekNumber),
                            week.tabName,
                            week.startDate,
                            week.endDate,
                            day.dayName,
                            meal.mealName,
                            food.foodName || food.originalText || '',
                            String(food.calories ?? 0),
                            String(food.carbs ?? 0),
                            String(food.protein ?? 0),
                            String(food.fat ?? 0),
                        ])
                    }
                }
            }
        }

        return rows.map(row => row.map(csvEscape).join(',')).join('\n')
    }

    function buildRawTextFromDays(days: ParsedDay[]) {
        const lines: string[] = []
        for (const day of days || []) {
            lines.push(day.dayName || "GUN")
            for (const meal of day.meals || []) {
                lines.push(`  ${meal.mealName || "OGUN"}`)
                for (const food of meal.foods || []) {
                    const label = (food.originalText || food.foodName || "").trim()
                    if (!label) continue
                    lines.push(`    - ${label} | ${food.calories ?? 0} ${food.carbs ?? 0} ${food.protein ?? 0} ${food.fat ?? 0}`)
                }
            }
            lines.push("")
        }
        return lines.join("\n").trim()
    }

    function splitTabPrefixFromDayName(dayName: string) {
        const raw = String(dayName || "").trim()
        if (!raw) return { tabName: null as string | null, cleanDayName: "" }

        const bracketMatch = raw.match(/^\[(.+?)\]\s*(.+)$/)
        if (bracketMatch?.[1] && bracketMatch?.[2]) {
            return {
                tabName: bracketMatch[1].trim() || null,
                cleanDayName: bracketMatch[2].trim(),
            }
        }
        return { tabName: null as string | null, cleanDayName: raw }
    }

    function normalizeParsedDaysForPool(days: ParsedDay[]) {
        return (days || []).map(day => {
            const split = splitTabPrefixFromDayName(day.dayName || "")
            return {
                ...day,
                dayName: split.cleanDayName || day.dayName || "GUN",
            }
        })
    }

    function buildMenuPoolEntriesFromCurrentStep(): MenuPoolEntry[] {
        const sourcePatient = (searchQuery || patientName || "").trim() || null
        const sourceType = activeTab === "google" ? "google_sheets" : "text"
        const sourceFileId = selectedFile?.id ? String(selectedFile.id) : null
        const sourceFileName = selectedFile?.name ? String(selectedFile.name) : null
        const tabTextMap = new Map(
            splitByTabMarkers(text).map(block => [String(block.tabName || "").trim(), block.text || ""])
        )

        if (step === "bulk-review") {
            return bulkImportData
                .map((week, idx) => {
                    const tabName = String(week.tabName || "").trim() || null
                    const fallbackRaw = buildRawTextFromDays(week.days as ParsedDay[])
                    const rawText = (tabName ? tabTextMap.get(tabName) || "" : "").trim() || fallbackRaw
                    if (!rawText) return null
                    return {
                        week_id: null,
                        patient_id: null,
                        program_template_id: null,
                        week_number: Number.isFinite(Number(week.weekNumber))
                            ? Number(week.weekNumber)
                            : inferWeekNumberFromTabName(tabName || "", idx),
                        source_type: sourceType,
                        source_file_id: sourceFileId,
                        source_file_name: sourceFileName,
                        source_tab_name: tabName,
                        source_patient_name: sourcePatient,
                        raw_text: rawText,
                        parsed_days: (week.days as ParsedDay[]) || [],
                    } as MenuPoolEntry
                })
                .filter((entry): entry is MenuPoolEntry => entry !== null)
        }

        if (step === "review") {
            const tabBlocks = splitByTabMarkers(text)
            const hasMultipleTabs = tabBlocks.length > 1

            if (hasMultipleTabs) {
                return tabBlocks
                    .map((block, idx) => {
                        const tabName = String(block.tabName || "").trim() || null
                        const rawParsed = parseTextToDays(block.text, getFoodsForParsing())
                        const alignedParsed = getMondayAlignedDays(rawParsed)
                        const normalizedDays = normalizeParsedDaysForPool(alignedParsed)
                        const rawText = (block.text || "").trim() || buildRawTextFromDays(normalizedDays)
                        if (!rawText || normalizedDays.length === 0) return null

                        return {
                            week_id: weekId || null,
                            patient_id: null,
                            program_template_id: null,
                            week_number: tabName
                                ? inferWeekNumberFromTabName(tabName, idx)
                                : weekNumber || null,
                            source_type: sourceType,
                            source_file_id: sourceFileId,
                            source_file_name: sourceFileName,
                            source_tab_name: tabName,
                            source_patient_name: sourcePatient,
                            raw_text: rawText,
                            parsed_days: normalizedDays,
                        } as MenuPoolEntry
                    })
                    .filter((entry): entry is MenuPoolEntry => entry !== null)
            }

            const tabName = (selectedTab || loadedTabNames?.[0] || "").trim() || null
            const normalizedDays = normalizeParsedDaysForPool(parsedDays || [])
            const rawText = text.trim() || buildRawTextFromDays(normalizedDays)
            if (!rawText) return []
            return [
                {
                    week_id: weekId || null,
                    patient_id: null,
                    program_template_id: null,
                    week_number: tabName
                        ? inferWeekNumberFromTabName(tabName, Math.max(0, (weekNumber || 1) - 1))
                        : weekNumber || null,
                    source_type: sourceType,
                    source_file_id: sourceFileId,
                    source_file_name: sourceFileName,
                    source_tab_name: tabName,
                    source_patient_name: sourcePatient,
                    raw_text: rawText,
                    parsed_days: normalizedDays,
                },
            ]
        }

        return []
    }

    async function handleSendToPool() {
        const entries = buildMenuPoolEntriesFromCurrentStep()
        if (entries.length === 0) {
            alert("Havuza aktarilacak icerik bulunamadi.")
            return
        }

        setIsSyncingPool(true)
        try {
            const response = await fetch("/api/admin/menu-import-pool/ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ entries }),
            })
            const responseText = await response.text()
            let json: any = null
            try {
                json = responseText ? JSON.parse(responseText) : null
            } catch {
                json = null
            }
            if (!response.ok) {
                const detailParts = [
                    json?.error,
                    json?.code ? `Kod: ${json.code}` : null,
                    json?.hint ? `Ipuccu: ${json.hint}` : null,
                    json?.details ? `Detay: ${JSON.stringify(json.details)}` : null,
                    responseText && !json ? `Govde: ${responseText.slice(0, 600)}` : null,
                ].filter(Boolean)
                throw new Error(detailParts.join(" | ") || "Havuza aktarim basarisiz oldu.")
            }

            const inserted = Number(json?.summary?.new_meal_packages ?? json?.summary?.inserted ?? 0)
            const repeated = Number(json?.summary?.repeat_meal_packages ?? json?.summary?.deduped ?? 0)
            alert(`Havuza aktarim tamamlandi. Yeni ogun paketi: ${inserted}, tekrar ogun paketi: ${repeated}.`)
        } catch (err: any) {
            alert(`Havuza aktarim hatasi: ${err?.message || "Bilinmeyen hata"}`)
        } finally {
            setIsSyncingPool(false)
        }
    }

    function getCopyAllContent() {
        if (step === 'review' && parsedDays.length > 0) return buildPlainTextFromParsedDays(parsedDays)
        if (step === 'bulk-review' && bulkImportData.length > 0) return buildPlainTextFromBulkImportData()
        return text
    }

    function getCopyCsvContent() {
        if (step === 'review' && parsedDays.length > 0) return buildCsvFromParsedDays(parsedDays)
        if (step === 'bulk-review' && bulkImportData.length > 0) return buildCsvFromBulkImportData()
        return buildCsvFromRawText(text)
    }

    async function copyToClipboard(content: string, label: string) {
        if (!content.trim()) {
            alert('Kopyalanacak icerik yok.')
            return
        }

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(content)
            } else {
                const ta = document.createElement('textarea')
                ta.value = content
                ta.style.position = 'fixed'
                ta.style.opacity = '0'
                document.body.appendChild(ta)
                ta.focus()
                ta.select()
                document.execCommand('copy')
                document.body.removeChild(ta)
            }
            alert(`${label} panoya kopyalandi.`)
        } catch (err: any) {
            alert(`Kopyalama basarisiz: ${err?.message || 'Bilinmeyen hata'}`)
        }
    }

    async function handleCopyAll() {
        await copyToClipboard(getCopyAllContent(), 'Tum icerik')
    }

    async function handleCopyCsv() {
        await copyToClipboard(getCopyCsvContent(), 'CSV icerik')
    }



    // Effect to continue auto-import after login
    useEffect(() => {
        if (isAuthenticated && pendingAutoImport) {
            setPendingAutoImport(false)
            continueAutoImport()
        }
    }, [isAuthenticated, pendingAutoImport])

    // Safety effect: Reset processing if error occurs
    useEffect(() => {
        if (gapiError && isProcessing) {
            setIsProcessing(false)
            setPendingAutoImport(false)
            setAutoImportStatus(`Hata: ${gapiError}`)
        }
    }, [gapiError])

    // Load Rules & Foods
    useEffect(() => {
        if (isOpen) {
            fetchFoods()
            fetchRules()
        }
    }, [isOpen])

    async function fetchRules() {
        const { data } = await supabase.from('import_rules').select('*').order('created_at', { ascending: false })
        if (data) setRules(data)
    }

    async function fetchFoods() {
        const { data } = await supabase
            .from('foods')
            .select('id, name, calories, carbs, protein, fat')
            .order('created_at', { ascending: false })
            .limit(10000)
        if (data) setLocalFoods(data)
    }

    async function handleConfirm() {
        if (!parsedDays.length) return
        await onImport(parsedDays, importMode)
        onClose()
    }

    async function markFoodAsNotFood(dayIdx: number, mealIdx: number, foodIdx: number) {
        const target = parsedDays[dayIdx]?.meals?.[mealIdx]?.foods?.[foodIdx]
        if (!target) return

        const pattern = (target.originalText || target.foodName || '').trim()
        if (!pattern) return

        const normalizedPattern = pattern.slice(0, 240)
        const { data: insertedRule, error } = await supabase
            .from('import_rules')
            .insert({
            rule_type: 'ignore',
            pattern: normalizedPattern,
            replacement: null
            })
            .select('id')
            .single()

        if (error && !String(error.message || '').toLowerCase().includes('duplicate')) {
            alert('Kural kaydedilemedi: ' + error.message)
            return
        }

        setParsedDays(prev => prev.map((day, d) => {
            if (d !== dayIdx) return day
            return {
                ...day,
                meals: day.meals.map((meal, m) => {
                    if (m !== mealIdx) return meal
                    return { ...meal, foods: meal.foods.filter((_, f) => f !== foodIdx) }
                })
            }
        }))
        setIgnoreHistory(prev => [
            ...prev,
            {
                ruleId: insertedRule?.id,
                pattern: normalizedPattern,
                dayIdx,
                mealIdx,
                foodIdx,
                food: target,
            },
        ])
        fetchRules()
    }

    async function undoLastIgnoredFood() {
        const last = ignoreHistory[ignoreHistory.length - 1]
        if (!last) return

        if (last.ruleId) {
            const { error } = await supabase.from('import_rules').delete().eq('id', last.ruleId)
            if (error) {
                alert('Kural geri alınamadı: ' + error.message)
                return
            }
        } else {
            alert('Satır önizlemeye geri alındı. Kalıcı ignore kuralı varsa "Ayrıştırma Kuralları" ekranından silebilirsiniz.')
        }

        setParsedDays(prev =>
            prev.map((day, dIdx) => {
                if (dIdx !== last.dayIdx) return day
                return {
                    ...day,
                    meals: day.meals.map((meal, mIdx) => {
                        if (mIdx !== last.mealIdx) return meal
                        const foods = [...meal.foods]
                        const insertAt = Math.min(last.foodIdx, foods.length)
                        foods.splice(insertAt, 0, last.food)
                        return { ...meal, foods }
                    }),
                }
            })
        )

        setIgnoreHistory(prev => prev.slice(0, -1))
        fetchRules()
    }

    function saveKeys() {
        if (!apiKey || !clientId) return
        localStorage.setItem('diyet_google_api_key', apiKey)
        localStorage.setItem('diyet_google_client_id', clientId)
        initClient(apiKey, clientId)
        setConfigOpen(false)
    }

    function buildSheetRange(tabName: string) {
        const escapedTabName = tabName.replace(/'/g, "''")
        // Keep a wide range so macro columns from Drive are not dropped for unknown foods.
        return `'${escapedTabName}'!A:AZ`
    }

    async function searchDrive() {
        if (!gapi || !searchQuery) return

        setIsProcessing(true)
        try {
            setFoundFiles([])
            setSelectedFile(null)
            setSheetTabs([])
            setSelectedTab('')
            setSelectedTabs([])
            setDetectedWeekTabs([])
            setLoadedTabNames([])
            setAutoImportStatus('')

            const q = `name contains '${searchQuery.replace(/'/g, "\\'")}' and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and trashed=false`
            const response = await gapi.client.drive.files.list({
                q: q,
                fields: 'files(id, name)',
                pageSize: 20,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
                corpora: 'allDrives'
            })
            setFoundFiles(response.result.files || [])
        } catch (err: any) {
            alert('Drive arama hatası: ' + (err.result?.error?.message || err.message))
        }
        setIsProcessing(false)
    }

    async function fetchTabs(file: any) {
        setSelectedFile(file)
        setIsProcessing(true)
        setSheetTabs([])
        setSelectedTab('')
        setSelectedTabs([])
        setDetectedWeekTabs([])
        setLoadedTabNames([])
        try {
            const response = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: file.id,
                fields: 'sheets.properties.title'
            })
            const tabs = response.result.sheets?.map((s: any) => s.properties.title) || []
            setSheetTabs(tabs)
            setDetectedWeekTabs(detectWeekTabs(tabs))
            if (tabs.length > 0) {
                const firstTab = tabs[0]
                setSelectedTab(firstTab)
                setSelectedTabs([firstTab])
                setLoadedTabNames([firstTab])
                // Auto-fetch preview content for the first tab
                await fetchTabContent(file.id, firstTab)
            }
        } catch (err: any) {
            alert('Tablar alınamadı: ' + (err.result?.error?.message || err.message))
        }
        setIsProcessing(false)
    }

    async function importFromSheet() {
        if (!selectedFile || !selectedTab) return
        setIsProcessing(true)
        try {
            const range = buildSheetRange(selectedTab)
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: selectedFile.id,
                range: range
            })

            const rows = response.result.values
            if (!rows || rows.length === 0) {
                alert('Sayfa boş veya veri okunamadı.')
                return
            }

            const textData = rows.map((row: any[]) => row.join('\t')).join('\n')
            setText(textData)
            setActiveTab('text')
            alert('Veriler çekildi. "Ayrıştır ve Önizle" butonuna basarak kontrol edin.')

        } catch (err: any) {
            alert('Veri çekme hatası: ' + (err.result?.error?.message || err.message))
        }
        setIsProcessing(false)
    }

    // --- ONE-CLICK IMPORT AUTOMATION ---
    async function oneClickImport() {
        setAutoImportStatus('Bağlantı hazırlanıyor...')
        setIsProcessing(true)

        // 1. Check API Keys
        const storedKey = apiKey || localStorage.getItem('diyet_google_api_key') || 'AIzaSyAFRdF7Myoa27DpBmt76_trtwEVpFpWgL8'
        const storedClient = clientId || localStorage.getItem('diyet_google_client_id') || '337617773303-3h4isdumdaptn9psov53a930dp9c4826.apps.googleusercontent.com'

        if (!storedKey || !storedClient) {
            setAutoImportStatus('API anahtarları eksik. Lütfen önce Ayarları yapılandırın.')
            setConfigOpen(true)
            setIsProcessing(false)
            return
        }

        // Update state with stored values
        setApiKey(storedKey)
        setClientId(storedClient)

        // 2. Init Client and wait for it to be COMPLETELY ready
        setAutoImportStatus('Google API başlatılıyor...')
        const success = await initClient(storedKey, storedClient)
        
        if (!success) {
            setAutoImportStatus('Google API başlatılamadı. Ayarları ve bağlantıyı kontrol edin.')
            setIsProcessing(false)
            return
        }

        // 3. Wait for tokenClient to be ready (React state update/Ref sync)
        setAutoImportStatus('Servis hazırlanıyor...')
        let retryCount = 0
        while ((!isInitialized || isInitializing) && retryCount < 20) {
            await new Promise(resolve => setTimeout(resolve, 500))
            retryCount++
        }

        // 4. Set pending flag and trigger login if needed
        if (!isAuthenticated) {
            setAutoImportStatus('Google ile giriş bekleniyor...')
            setPendingAutoImport(true)
            
            const loginStarted = login()
            if (!loginStarted) {
                setAutoImportStatus('Oturum açma başlatılamadı. Servis hazır olmayabilir.')
                setPendingAutoImport(false)
                setIsProcessing(false) // Reset spinning button
            }
            // If login started, we keep setIsProcessing(true) and wait for useEffect
            return
        }

        // If already authenticated, continue flow
        await continueAutoImport()
    }

    async function continueAutoImport() {
        if (!gapi || !patientName) {
            setAutoImportStatus('Hasta adı veya bağlantı eksik.')
            setIsProcessing(false)
            return
        }

        setFoundFiles([])
        setSelectedFile(null)
        setSheetTabs([])
        setSelectedTab('')
        setSelectedTabs([])
        setDetectedWeekTabs([])
        setLoadedTabNames([])

        // 4. Search Drive
        setAutoImportStatus(`"${patientName}" Drive'da aranıyor...`)
        try {
            // Helper to convert Turkish chars to English equivalents for Drive indexing issues
            const toEng = (s: string) => s
                .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
                .replace(/ü/g, 'u').replace(/Ü/g, 'U')
                .replace(/ş/g, 's').replace(/Ş/g, 'S')
                .replace(/ı/g, 'i').replace(/İ/g, 'I')
                .replace(/ö/g, 'o').replace(/Ö/g, 'O')
                .replace(/ç/g, 'c').replace(/Ç/g, 'C')

            // Create highly flexible variants
            const baseName = patientName.trim()
            const firstWord = baseName.split(' ')[0] // e.g., "HACER"

            const nameVariants = [
                baseName,
                toEng(baseName),
                baseName.toLocaleUpperCase('tr-TR'),
                toEng(baseName).toUpperCase(),
                firstWord, // Fallback to just the first name if full name fails
                toEng(firstWord)
            ].filter((v, i, a) => v && a.indexOf(v) === i)

            const nameQueries = nameVariants.map(v => `name contains '${v.replace(/'/g, "\\'")}'`).join(' or ')
            const q = `(mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and (${nameQueries}) and trashed=false`
            
            const response = await gapi.client.drive.files.list({
                q: q,
                fields: 'files(id, name)',
                pageSize: 10,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
                corpora: 'allDrives'
            })
            const files = response.result.files || []

            if (files.length === 0) {
                setAutoImportStatus(`"${patientName}" adında dosya bulunamadı.`)
                setIsProcessing(false)
                return
            }

            setFoundFiles(files)

            // 5. Select first matching file
            const file = files[0]
            setSelectedFile(file)
            setAutoImportStatus(`"${file.name}" açılıyor...`)

            // 6. Fetch tabs
            const tabResponse = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: file.id,
                fields: 'sheets.properties.title'
            })
            const tabs = tabResponse.result.sheets?.map((s: any) => s.properties.title) || []
            setSheetTabs(tabs)

            // 7. Detect all week tabs for bulk import option
            const weekTabs = detectWeekTabs(tabs)
            setDetectedWeekTabs(weekTabs)

            // 8. Auto-select current week tab
            let matchedTab = matchWeekTab(tabs, weekNumber)

            if (!matchedTab) {
                setAutoImportStatus(`${weekNumber}. Hafta tabı otomatik bulunamadı. Lütfen listeden seçin.`)
                matchedTab = tabs[0] // Fallback to first tab
            }

            setSelectedTab(matchedTab || '')
            setSelectedTabs(matchedTab ? [matchedTab] : [])

            // If multiple week tabs found, show selection UI instead of auto-importing
            if (weekTabs.length > 1) {
                setAutoImportStatus(`${weekTabs.length} hafta tabı bulundu. Tek hafta mı, tüm haftalar mı?`)
                setIsProcessing(false)
                return // Wait for user selection
            }

            if (matchedTab) {
                // 9. Import from sheet (single tab)
                await fetchTabContent(file.id, matchedTab)
            } else {
                setIsProcessing(false) // Stop processing to let user select
            }

        } catch (err: any) {
            setAutoImportStatus('Hata: ' + (err.result?.error?.message || err.message))
            setIsProcessing(false)
        }
    }

    // Helper: Find a 7-day window, ideally starting from a Monday (if > 7 days)
    function getMondayAlignedDays(parsed: ParsedDay[]): ParsedDay[] {
        if (parsed.length <= 7) return parsed;
        
        // Ensure we always return exactly 7 days starting from the first Monday
        const firstMondayIndex = parsed.findIndex(d => 
            d.dayName.toLocaleUpperCase('tr-TR').includes('PAZARTESİ') || 
            d.dayName.toUpperCase().includes('PAZARTESI')
        );
        
        if (firstMondayIndex !== -1) {
            return parsed.slice(firstMondayIndex, firstMondayIndex + 7);
        }
        
        // Fallback: just return the first 7 days
        return parsed.slice(0, 7);
    }

    // Helper: Fetch content from a specific tab
    async function fetchTabContent(fileId: string, tabName: string) {
        setAutoImportStatus(`"${tabName}" verisi çekiliyor...`)
        setIsProcessing(true)

        try {
            const range = buildSheetRange(tabName)
            const dataResponse = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: fileId,
                range: range
            })

            const rows = dataResponse.result.values
            if (!rows || rows.length === 0) {
                setAutoImportStatus('Sayfa boş veya veri okunamadı.')
                setIsProcessing(false)
                return
            }

            const lines: string[] = []
            for (const row of rows) {
                if (row && row.length > 0) {
                    const hasContent = row.some((c: any) => c !== null && c !== undefined && String(c).trim() !== '')
                    if (hasContent) {
                        const paddedRow = [...row]
                        while (paddedRow.length < 5) paddedRow.push('')
                        lines.push(paddedRow.map((c: any) => String(c ?? '').trim()).join('\t'))
                    }
                }
            }

            const combinedText = lines.join('\n')
            setText(combinedText)
            setLoadedTabNames([tabName])
            
            // Parse and align
            const rawParsed = parseTextToDays(combinedText, getFoodsForParsing())
            const alignedParsed = getMondayAlignedDays(rawParsed)
            setParsedDays(alignedParsed)

            setAutoImportStatus('')
            setIsProcessing(false)

        } catch (err: any) {
            setAutoImportStatus('Veri çekme hatası: ' + (err.result?.error?.message || err.message))
            setIsProcessing(false)
        }
    }

    async function handleManualTabChange(newTab: string) {
        if (!selectedFile || !gapi) return
        setSelectedTab(newTab)
        setSelectedTabs([newTab])
        await fetchTabContent(selectedFile.id, newTab)
    }

    async function fetchMultipleTabsContent(fileId: string, tabNames: string[], goToPreview: boolean) {
        if (!gapi || tabNames.length === 0) return
        setIsProcessing(true)
        setAutoImportStatus(`Secili tablar cekiliyor... (0/${tabNames.length})`)

        try {
            const allBlocks: string[] = []
            const loadedTabs: string[] = []
            let failedTabs = 0

            for (let i = 0; i < tabNames.length; i++) {
                const tabName = tabNames[i]
                setAutoImportStatus(`"${tabName}" cekiliyor... (${i + 1}/${tabNames.length})`)
                try {
                    const range = buildSheetRange(tabName)
                    const dataResponse = await gapi.client.sheets.spreadsheets.values.get({
                        spreadsheetId: fileId,
                        range
                    })

                    const rows = dataResponse.result.values
                    if (!rows || rows.length === 0) continue

                    const lines: string[] = []
                    for (const row of rows) {
                        if (row && row.length > 0) {
                            const hasContent = row.some((c: any) => c !== null && c !== undefined && String(c).trim() !== '')
                            if (hasContent) {
                                const paddedRow = [...row]
                                while (paddedRow.length < 5) paddedRow.push('')
                                lines.push(paddedRow.map((c: any) => String(c ?? '').trim()).join('\t'))
                            }
                        }
                    }

                    if (lines.length > 0) {
                        allBlocks.push(`### TAB: ${tabName} ###`)
                        allBlocks.push(...lines)
                        allBlocks.push('')
                        loadedTabs.push(tabName)
                    }
                } catch (err) {
                    failedTabs += 1
                    console.warn(`Tab "${tabName}" okunamadi, atlandi.`, err)
                }
            }

            const combinedText = allBlocks.join('\n').trim()
            setText(combinedText)
            setLoadedTabNames(loadedTabs.length > 0 ? loadedTabs : tabNames)
            setActiveTab('text')

            if (goToPreview) {
                parseText(combinedText)
            }

            if (failedTabs > 0) {
                setAutoImportStatus(`${failedTabs} tab okunamadi, digerleri yuklendi.`)
            } else {
                setAutoImportStatus('')
            }
        } catch (err: any) {
            setAutoImportStatus('Veri cekme hatasi: ' + (err.result?.error?.message || err.message))
        } finally {
            setIsProcessing(false)
        }
    }

    const inferWeekNumberFromTabName = (tabName: string, fallbackIndex: number) => {
        const m = tabName.match(/(\d+)\.?\s*hafta/i) || tabName.match(/hafta\s*(\d+)/i)
        if (m?.[1]) return parseInt(m[1], 10)
        return fallbackIndex + 1
    }

    const buildSelectedTabTargets = () => {
        const targets = selectedTabs.map((tabName, idx) => ({
            tabName,
            weekNumber: inferWeekNumberFromTabName(tabName, idx),
        }))
        return targets.sort((a, b) => a.weekNumber - b.weekNumber)
    }

    // --- BULK IMPORT ALL WEEKS ---
    async function handleBulkImportAllWeeks(targetWeekTabs = detectedWeekTabs) {
        if (!selectedFile || !gapi || targetWeekTabs.length === 0) {
            setAutoImportStatus('Dosya veya hafta tabları eksik.')
            return
        }

        const availableTabNames = new Set(sheetTabs)
        const effectiveTargets = targetWeekTabs.filter(t => availableTabNames.has(t.tabName))
        if (effectiveTargets.length === 0) {
            setAutoImportStatus('Secilen dosyada uygun tab bulunamadi.')
            return
        }

        setIsProcessing(true)
        const allWeekData: { weekNumber: number, tabName: string, startDate: string, endDate: string, days: ParsedDay[] }[] = []
        const allBlocks: string[] = []

        for (let i = 0; i < effectiveTargets.length; i++) {
            const weekTab = effectiveTargets[i]
            setAutoImportStatus(`${weekTab.tabName} çekiliyor... (${i + 1}/${effectiveTargets.length})`)

            try {
                const range = buildSheetRange(weekTab.tabName)
                const dataResponse = await gapi.client.sheets.spreadsheets.values.get({
                    spreadsheetId: selectedFile.id,
                    range: range
                })

                const rows = dataResponse.result.values
                if (!rows || rows.length === 0) {
                    console.warn(`Tab "${weekTab.tabName}" boş, atlanıyor.`)
                    continue
                }

                // Convert to text for parser
                const lines: string[] = []
                for (const row of rows) {
                    if (row && row.length > 0) {
                        // Boş hücreleri koru, sadece tamamen boş satırları atla
                        const hasContent = row.some((c: any) => c !== null && c !== undefined && String(c).trim() !== '')
                        if (hasContent) {
                            // Satırı 5 sütuna padle (A-E: Name, Cal, Carbs, Prot, Fat)
                            // Google Sheets API trailing boş hücreleri döndürmeyebilir
                            const paddedRow = [...row]
                            while (paddedRow.length < 5) {
                                paddedRow.push('')
                            }
                            // Hücreleri tab ile birleştir, boşları da dahil et (sütun sırasını koru)
                            lines.push(paddedRow.map((c: any) => String(c ?? '').trim()).join('\t'))
                        }
                    }
                }

                const combinedText = lines.join('\n')
                if (combinedText.trim()) {
                    allBlocks.push(`### TAB: ${weekTab.tabName} ###`)
                    allBlocks.push(combinedText)
                    allBlocks.push('')
                }

                // Parse this week's data - use internal parsing logic
                const rawParsed = parseTextToDays(combinedText, getFoodsForParsing())
                const alignedParsed = getMondayAlignedDays(rawParsed)
                
                // Initial dates (will be adjusted in review step)
                const weekStart = new Date()
                weekStart.setDate(weekStart.getDate() + (weekTab.weekNumber - 1) * 7)
                const weekEnd = new Date(weekStart)
                weekEnd.setDate(weekEnd.getDate() + 6)

                allWeekData.push({
                    weekNumber: weekTab.weekNumber,
                    tabName: weekTab.tabName,
                    startDate: formatDateISO(weekStart),
                    endDate: formatDateISO(weekEnd),
                    days: alignedParsed
                })
            } catch (err: any) {
                console.error(`Tab ${weekTab.tabName} error:`, err)
            }
        }

        if (allBlocks.length > 0) {
            setText(allBlocks.join('\n').trim())
            setLoadedTabNames(effectiveTargets.map(w => w.tabName))
        }

        if (allWeekData.length > 0) {
            setBulkImportData(allWeekData)
            // Set base date to today's Monday or existing week 1 start if possible
            const today = new Date()
            const monday = new Date(today)
            monday.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1))
            setBulkBaseDate(formatDateISO(monday))
            
            setStep('bulk-review')
            setAutoImportStatus('Lütfen haftaları ve tarihleri gözden geçirin.')
        } else {
            setAutoImportStatus('Aktarılacak veri bulunamadı.')
        }

        setIsProcessing(false)
    }

    async function handleBulkImportSelectedWeeks() {
        const selectedTabTargets = buildSelectedTabTargets()
        if (selectedTabTargets.length === 0) {
            setAutoImportStatus('Önce tablardan seçim yapın.')
            return
        }
        await handleBulkImportAllWeeks(selectedTabTargets)
    }

    const updateBulkDates = (newBaseDate: string) => {
        setBulkBaseDate(newBaseDate)
        if (!newBaseDate) return

        const base = new Date(newBaseDate)
        setBulkImportData(prev => prev.map((item, idx) => {
            const start = new Date(base)
            const offset = idx * 7 
            start.setDate(start.getDate() + offset)
            const end = new Date(start)
            end.setDate(end.getDate() + 6)
            
            return {
                ...item,
                startDate: formatDateISO(start),
                endDate: formatDateISO(end)
            }
        }))
    }

    const updateSingleBulkDate = (index: number, newDate: string) => {
        if (!newDate) return
        
        const base = new Date(newDate)
        setBulkImportData(prev => prev.map((item, idx) => {
            if (idx < index) return item
            
            const start = new Date(base)
            const offset = (idx - index) * 7
            start.setDate(start.getDate() + offset)
            const end = new Date(start)
            end.setDate(end.getDate() + 6)
            
            return {
                ...item,
                startDate: formatDateISO(start),
                endDate: formatDateISO(end)
            }
        }))
    }

    const updateBulkWeekNumber = (idx: number, newNum: number) => {
        setBulkImportData(prev => prev.map((item, i) => i === idx ? { ...item, weekNumber: newNum } : item))
    }

    const toggleBulkDayActive = (weekIdx: number, dayIdx: number) => {
        setBulkImportData(prev => prev.map((item, wIdx) => {
            if (wIdx !== weekIdx) return item
            const newDays = [...item.days]
            newDays[dayIdx] = {
                ...newDays[dayIdx],
                is_active: newDays[dayIdx].is_active === false ? true : false
            }
            return { ...item, days: newDays }
        }))
    }

    const confirmBulkImport = async () => {
        if (!onBulkImport || bulkImportData.length === 0) return
        
        setIsProcessing(true)
        setAutoImportStatus('Plan sisteme kaydediliyor...')
        
        try {
            await onBulkImport(bulkImportData as any)
            setAutoImportStatus('')
            onClose()
        } catch (err: any) {
            setAutoImportStatus(`Kayıt Hatası: ${err.message}`)
            setIsProcessing(false)
        }
    }

    function splitByTabMarkers(inputText: string): { tabName: string; text: string }[] {
        const lines = inputText.split('\n')
        const blocks: { tabName: string; lines: string[] }[] = []
        let current: { tabName: string; lines: string[] } | null = null
        const markerRegex = /^###\s*TAB:\s*(.+?)\s*###$/i

        for (const rawLine of lines) {
            const line = rawLine.trim()
            const match = line.match(markerRegex)
            if (match) {
                if (current && current.lines.length > 0) blocks.push(current)
                current = { tabName: match[1], lines: [] }
                continue
            }
            if (!current) current = { tabName: 'Tek Tab', lines: [] }
            current.lines.push(rawLine)
        }
        if (current && current.lines.length > 0) blocks.push(current)

        return blocks
            .map(b => ({ tabName: b.tabName, text: b.lines.join('\n').trim() }))
            .filter(b => b.text.length > 0)
    }

    // Helper to parse text into preview
    function parseText(inputText: string) {
        const tabBlocks = splitByTabMarkers(inputText)

        if (tabBlocks.length <= 1) {
            const rawDays = parseTextToDays(inputText, getFoodsForParsing())
            const alignedDays = getMondayAlignedDays(rawDays)
            setParsedDays(alignedDays)
            setStep('review')
            return
        }

        const combinedDays: ParsedDay[] = []
        for (const block of tabBlocks) {
            const rawDays = parseTextToDays(block.text, getFoodsForParsing())
            const alignedDays = getMondayAlignedDays(rawDays)
            combinedDays.push(...alignedDays)
        }
        setParsedDays(combinedDays)
        setStep('review')
    }

    // --- DETECT ALL WEEK TABS ---
    function detectWeekTabs(tabs: string[]): { tabName: string, weekNumber: number }[] {
        const weekMap = new Map<number, { tabName: string, weekNumber: number }>()

        for (const tab of tabs) {
            const weekNumber = getExactWeekNumberFromTab(tab)
            if (typeof weekNumber !== 'number' || !Number.isFinite(weekNumber)) continue
            if (!weekMap.has(weekNumber)) {
                weekMap.set(weekNumber, { tabName: tab, weekNumber })
            }
        }

        return Array.from(weekMap.values()).sort((a, b) => a.weekNumber - b.weekNumber)
    }

    // New helper for bulk import parsing
    function parseTextToDays(inputText: string, foodsDb: any[]): ParsedDay[] {
        const result: ParsedDay[] = []
        const normalizeForMatch = (s: string) => s
            .toLocaleUpperCase('tr-TR')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/İ/g, 'I')
            .replace(/İ/g, 'I')
        const parseNum = (v: string): number | null => {
            if (!v) return null
            const cleaned = String(v).replace(',', '.').replace(/[^0-9.-]/g, '')
            if (!cleaned) return null
            const parsed = parseFloat(cleaned)
            return Number.isFinite(parsed) ? parsed : null
        }
        const extractTrailingMacros = (line: string): { calories: number; carbs: number; protein: number; fat: number } | null => {
            const strict = line.match(/(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/)
            if (strict) {
                return {
                    calories: parseNum(strict[1]) ?? 0,
                    carbs: parseNum(strict[2]) ?? 0,
                    protein: parseNum(strict[3]) ?? 0,
                    fat: parseNum(strict[4]) ?? 0,
                }
            }
            const looseTokens = [...line.matchAll(/-?\d+(?:[.,]\d+)?/g)]
                .map(m => parseNum(m[0]))
                .filter((n): n is number => n !== null)
            if (looseTokens.length < 4) return null
            const lastFour = looseTokens.slice(-4)
            return {
                calories: lastFour[0] ?? 0,
                carbs: lastFour[1] ?? 0,
                protein: lastFour[2] ?? 0,
                fat: lastFour[3] ?? 0,
            }
        }
        const extractRowMacros = (line: string): { calories: number; carbs: number; protein: number; fat: number } | null => {
            const clean = line.trim()
            if (!clean) return null
            let parts = clean.split('\t').map(p => String(p ?? '').trim())
            if (parts.length === 1) {
                parts = clean.split(/ {2,}/).map(p => String(p ?? '').trim())
            }
            let nameIndex = 0
            while (nameIndex < parts.length && !parts[nameIndex]) nameIndex += 1
            if (nameIndex >= parts.length) return extractTrailingMacros(clean)
            const macroCells = parts.slice(nameIndex + 1).map(parseNum)
            const nonNull = macroCells.filter((v): v is number => v !== null)
            if (nonNull.length >= 4) {
                return {
                    calories: nonNull[0] ?? 0,
                    carbs: nonNull[1] ?? 0,
                    protein: nonNull[2] ?? 0,
                    fat: nonNull[3] ?? 0,
                }
            }
            if (macroCells.some(v => v !== null)) {
                return {
                    calories: macroCells[0] ?? 0,
                    carbs: macroCells[1] ?? 0,
                    protein: macroCells[2] ?? 0,
                    fat: macroCells[3] ?? 0,
                }
            }
            return extractTrailingMacros(clean)
        }

        // DEBUG LOGGING
        console.log('--- PARSER START ---')

        const lines = inputText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
        const macroLookup = new Map<string, { calories: number; carbs: number; protein: number; fat: number }>()
        for (const line of lines) {
            const cleanLine = line.replace(/^['"â€¢\-\*âœ¦â¤>]\s*/, '').trim()
            if (!cleanLine) continue
            let parts = cleanLine.split('\t').map(p => String(p ?? '').trim())
            if (parts.length === 1) {
                parts = cleanLine.split(/ {2,}/).map(p => String(p ?? '').trim())
            }
            let nameIndex = 0
            while (nameIndex < parts.length && !parts[nameIndex]) nameIndex += 1
            const candidateName = parts[nameIndex] || cleanLine
            const macro = extractRowMacros(cleanLine)
            if (!candidateName || !macro) continue
            macroLookup.set(normalizeForMatch(candidateName), macro)
        }
        // Reordered to prevent "CUMA" matching inside "CUMARTESİ"
        const dayNames = ['PAZARTESİ', 'SALI', 'ÇARŞAMBA', 'PERŞEMBE', 'CUMARTESİ', 'CUMA', 'PAZAR']
        const mealHeaders = ['KAHVALTI', 'ÖĞLE', 'ÖĞLEN', 'AKŞAM', 'ARA ÖĞÜN', 'KUŞLUK', 'GEÇ GECE']

        const dayPatterns: { canonical: string; variants: string[] }[] = [
            { canonical: 'PAZARTESİ', variants: ['PAZARTESI', 'PAZARTESİ'] },
            { canonical: 'SALI', variants: ['SALI'] },
            { canonical: 'ÇARŞAMBA', variants: ['CARSAMBA', 'ÇARŞAMBA'] },
            { canonical: 'PERŞEMBE', variants: ['PERSEMBE', 'PERŞEMBE'] },
            { canonical: 'CUMARTESİ', variants: ['CUMARTESI', 'CUMARTESİ'] },
            { canonical: 'CUMA', variants: ['CUMA'] },
            { canonical: 'PAZAR', variants: ['PAZAR'] },
        ]
        const mealPatterns: { canonical: string; variants: string[] }[] = [
            { canonical: 'KAHVALTI', variants: ['KAHVALTI'] },
            { canonical: 'ÖĞLEN', variants: ['OGLE', 'ÖĞLE', 'ÖĞLEN'] },
            { canonical: 'AKŞAM', variants: ['AKSAM', 'AKŞAM'] },
            { canonical: 'ARA ÖĞÜN', variants: ['ARA OGUN', 'ARA ÖĞÜN'] },
            { canonical: 'KUŞLUK', variants: ['KUSLUK', 'KUŞLUK'] },
            { canonical: 'GEÇ GECE', variants: ['GEC GECE', 'GEÇ GECE'] },
        ]

        let currentDay: ParsedDay | null = null
        let currentMeal: ParsedMeal | null = null

        for (const line of lines) {
            // Apply rules first
            let processedLine = line
            for (const rule of rules) {
                if (rule.rule_type === 'ignore' && processedLine.includes(rule.pattern)) {
                    processedLine = ''
                    break
                }
                if (rule.rule_type === 'replace' && rule.replacement) {
                    processedLine = processedLine.replace(new RegExp(rule.pattern, 'gi'), rule.replacement)
                }
            }
            if (!processedLine) continue

            // AGGRESSIVE FILTERING REMOVED: User wants to process foods starting with * (e.g. "*Avokadolu omlet")
            // Informational lines should be handled by 'ignore' rules defined by the user.

            // Remove common garbage characters from start
            let cleanLine = processedLine.replace(/^['"•\-\*✦➤>]\s*/, '').trim()

            // Filter out junk lines
            if (
                cleanLine.length < 2 || // Too short
                cleanLine.match(/^\d+$/) || // Only digits "983"
                cleanLine.match(/^\d+\s*\(x\)/i) || // "1032 (x)"
                cleanLine.match(/kcal$/i) || // Ends with kcal
                cleanLine.match(/^toplam/i) || // Starts with Toplam
                cleanLine.match(/^#{2,}\s*tab:/i) || // Combined tab separators
                cleanLine.match(/^\[tab:/i) || // Combined tab separators
                cleanLine.match(/^tab:\s*/i) || // Combined tab separators
                cleanLine.match(/^\(x\)$/i) || // Just (x)
                cleanLine.match(/^[\d\s\t.,]+$/) || // Only digits/spaces/tabs (daily totals like "983\t13\t55\t79")
                // cleanLine.match(/^\t/) || // REMOVED: Starts with tab check prevented indented lines
                cleanLine.match(/^günlük/i) || // Begins with "Günlük..." (daily tips)
                cleanLine.match(/yerine.*ekleyebilirsiniz/i) || // "... yerine ... ekleyebilirsiniz" (substitution tips)
                cleanLine.match(/için.*değiştirebilirsiniz/i) || // "... için ... değiştirebilirsiniz" (substitution tips)
                cleanLine.match(/önerilir$/i) // Ends with "önerilir" (recommendations)
            ) {
                console.log('-> IGNORED:', cleanLine)
                continue
            }

            const upperLine = cleanLine.toLocaleUpperCase('tr-TR')
            const normalizedLine = normalizeForMatch(cleanLine)

            // Check day (Relaxed Match)
            const matchedDay =
                dayPatterns.find(d =>
                    d.variants.some(v => normalizedLine.includes(normalizeForMatch(v)))
                )?.canonical ||
                dayNames.find(d => upperLine.includes(d))
            if (matchedDay) {
                console.log(`-> Day MATCHED: ${matchedDay} in "${upperLine}"`)
                if (currentDay) result.push(currentDay)
                currentDay = { dayName: matchedDay, is_active: true, meals: [] }
                currentMeal = null
                continue
            }

            // Check meal header (Relaxed Match for Tab/Spaces)
            const matchedMeal =
                mealPatterns.find(m =>
                    m.variants.some(v => {
                        const nv = normalizeForMatch(v)
                        const pattern = new RegExp(`^${nv}([:\\s\\t]|$)`, 'i')
                        return pattern.test(normalizedLine)
                    })
                )?.canonical ||
                mealHeaders.find(m => {
                    const pattern = new RegExp(`^${m}([:\\s\\t]|$)`, 'i')
                    return pattern.test(upperLine)
                })
            if (matchedMeal && currentDay) {
                let finalMealName = matchedMeal
                if (finalMealName === 'ÖĞLE') finalMealName = 'ÖĞLEN'
                currentMeal = { mealName: finalMealName, foods: [] }
                currentDay.meals.push(currentMeal)
                continue
            }

                // Food line (parser)
            if (currentMeal && currentDay) {
                // Tab ile ayır (Google Sheets'ten gelen veri)
                let parts = cleanLine.split('\t')
                let normalizedParts = parts.map(part => String(part ?? '').trim())
                // Eğer tab yoksa, 2+ boşlukla dene
                if (parts.length === 1) {
                    parts = cleanLine.split(/ {2,}/)
                    normalizedParts = parts.map(part => String(part ?? '').trim())
                }

                // Handle indentation: Find first non-empty column
                let nameIndex = 0
                while (nameIndex < normalizedParts.length && !normalizedParts[nameIndex]) {
                    nameIndex++
                }

                // If all columns are empty, skip
                if (nameIndex >= normalizedParts.length) continue
                // İlk sütun boşsa (gün toplamı gibi), bu satırı yemek olarak alma.
                if (nameIndex !== 0) continue

                let foodName = normalizedParts[nameIndex] || cleanLine

                // Skip if foodName is too short or just numbers (daily total)
                if (!foodName || foodName.length < 2 || foodName.match(/^[\d.,\s]+$/)) continue
                // Açıklama/not satırları yemek satırı değildir.
                if (
                    /^(\*|-|•)/.test(foodName) ||
                    /(gunluk|ortalama|onerilir|degistirebilirsiniz|tercihen saat)/i.test(normalizeForMatch(foodName))
                ) {
                    continue
                }

                // Check for inline nutrition values
                let lineCalories = 0, lineProtein = 0, lineCarbs = 0, lineFat = 0
                let hasLineValues = false
                let macroParseMode: 'none' | 'indexed' | 'sequential' | 'trailing' | 'lookup' = 'none'
                let macroCells: Array<number | null> = []
                const cleanNum = (val: string): number | null => {
                    if (!val) return null
                    // Virgül ve nokta ile sayıları temizle
                    const cleaned = val.replace(',', '.').replace(/[^0-9.-]/g, '')
                    if (!cleaned) return null
                    const parsed = parseFloat(cleaned)
                    return Number.isFinite(parsed) ? parsed : null
                }

                // parts[0] = name, sonraki sütunlar makrolar (Name Index'e göre kaydır)
                // Google Sheets sırası: Kalori > Karbonhidrat > Protein > Yağ
                if (normalizedParts.length >= nameIndex + 2) {
                    // Sütunları tara - Name [nameIndex], Cal [nameIndex+1], Carbs [nameIndex+2], Protein [nameIndex+3], Fat [nameIndex+4]
                    macroCells = normalizedParts.slice(nameIndex + 1).map(cleanNum)
                    const nonNullCells = macroCells.filter((v): v is number => v !== null)

                    // En az kalori değeri varsa veya herhangi bir makro varsa
                    if (nonNullCells.length >= 4) {
                        ;[lineCalories, lineCarbs, lineProtein, lineFat] = nonNullCells.slice(0, 4)
                        hasLineValues = true
                        macroParseMode = 'sequential'
                    } else if (macroCells.some(v => v !== null)) {
                        lineCalories = macroCells[0] ?? 0
                        lineCarbs = macroCells[1] ?? 0
                        lineProtein = macroCells[2] ?? 0
                        lineFat = macroCells[3] ?? 0
                        hasLineValues = true
                        macroParseMode = 'indexed'
                    }
                }

                // If no tab separation, try trailing macro extraction from line end
                if (!hasLineValues) {
                    const trailing = extractTrailingMacros(cleanLine)
                    if (trailing) {
                        lineCalories = trailing.calories
                        lineCarbs = trailing.carbs
                        lineProtein = trailing.protein
                        lineFat = trailing.fat
                        hasLineValues = true
                        macroParseMode = 'trailing'
                    }
                }
                // Makro bulunamayan satırlar (ör. dip notlar) import edilmez.
                if (!hasLineValues) continue

                // Try to match with DB
                const matchResult = findBestMatch(foodName)
                const matchedFood = matchResult ? foodsDb.find(f => f.id === matchResult.id) : null

                // Prioritize line values
                const hasCalCell = macroCells[0] !== null && macroCells[0] !== undefined
                const hasCarbCell = macroCells[1] !== null && macroCells[1] !== undefined
                const hasProtCell = macroCells[2] !== null && macroCells[2] !== undefined
                const hasFatCell = macroCells[3] !== null && macroCells[3] !== undefined
                const hasStructuredMacroCells = macroParseMode === 'indexed'

                const finalCalories = hasLineValues
                    ? (hasStructuredMacroCells ? (hasCalCell ? lineCalories : (matchedFood?.calories || 0)) : lineCalories)
                    : (matchedFood?.calories || 0)
                const finalCarbs = hasLineValues
                    ? (hasStructuredMacroCells ? (hasCarbCell ? lineCarbs : (matchedFood?.carbs || 0)) : lineCarbs)
                    : (matchedFood?.carbs || 0)
                const finalProtein = hasLineValues
                    ? (hasStructuredMacroCells ? (hasProtCell ? lineProtein : (matchedFood?.protein || 0)) : lineProtein)
                    : (matchedFood?.protein || 0)
                const finalFat = hasLineValues
                    ? (hasStructuredMacroCells ? (hasFatCell ? lineFat : (matchedFood?.fat || 0)) : lineFat)
                    : (matchedFood?.fat || 0)

                currentMeal.foods.push({
                    originalText: processedLine,
                    foodName: foodName.replace(/(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/, '').trim(), // Clean macros from name just in case
                    calories: finalCalories,
                    protein: finalProtein,
                    carbs: finalCarbs,
                    fat: finalFat,
                    matchedFoodId: matchResult?.id, // Her zaman eşleşme varsa ayarla
                    matchConfidence: matchResult?.score || 0,
                    status: matchResult ? 'matched' : 'created'
                })
            }
        }

        if (currentDay) result.push(currentDay)
        console.log('--- PARSER END --- Result:', result)
        return result
    }

    const totalFoodCountSingle = parsedDays.reduce((acc, d) => 
        acc + d.meals.reduce((mAcc, m) => mAcc + m.foods.length, 0), 0
    )

    const totalFoodCountBulk = bulkImportData.reduce((acc, w) => 
        acc + w.days.reduce((dAcc: number, d: any) => 
            dAcc + d.meals.reduce((mAcc: number, m: any) => mAcc + m.foods.length, 0), 0
        ), 0
    )

    const canShowPoolAction = step === 'review' || step === 'bulk-review'
    const hasPoolPayload =
        (step === 'review' && parsedDays.length > 0) ||
        (step === 'bulk-review' && bulkImportData.length > 0)
    const isPoolActionDisabled = isSyncingPool || isProcessing || !hasPoolPayload

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[98vw] max-w-[98vw] sm:max-w-[98vw] h-[95vh] sm:h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                <div className="px-6 py-4 border-b shrink-0 flex flex-row items-center justify-between">
                    <div>
                        <DialogTitle>Dışarıdan Program Al</DialogTitle>
                        <DialogDescription>
                            İster metin yapıştırın, ister Google Sheets'ten çekin.
                        </DialogDescription>
                    </div>
                    {step === 'input' && (
                        <div className="flex bg-gray-100 p-1 rounded-lg">
                            <button
                                onClick={() => setActiveTab('text')}
                                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'text' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <FileText size={14} /> Metin / Excel
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('google')}
                                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'google' ? 'bg-white shadow text-green-700' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center gap-2">
                                    <FileSpreadsheet size={14} /> Google Sheets
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-hidden min-h-0 py-4 px-6">
                    {step === 'input' ? (
                        activeTab === 'text' ? (
                            <div className="h-full flex flex-col gap-2">
                                <div className="flex justify-between items-center px-1">
                                    <Label>Yapıştırılacak Metin (Tablo)</Label>
	                                    <div className="flex items-center gap-2">
	                                        <Button
	                                            type="button"
	                                            variant="outline"
	                                            size="sm"
	                                            className="h-8 text-xs gap-1"
	                                            onClick={handleCopyAll}
	                                            disabled={!text.trim()}
	                                        >
	                                            <Copy size={12} />
	                                            Tumunu Kopyala
	                                        </Button>
	                                        <Button
	                                            type="button"
	                                            variant="outline"
	                                            size="sm"
	                                            className="h-8 text-xs gap-1"
	                                            onClick={handleCopyCsv}
	                                            disabled={!text.trim()}
	                                        >
	                                            <Copy size={12} />
	                                            CSV Kopyala
	                                        </Button>
	                                        <Button
	                                            type="button"
	                                            variant="outline"
	                                            size="sm"
	                                            className="h-8 text-xs gap-1"
	                                            onClick={handleExportTxt}
	                                            disabled={!text.trim()}
	                                        >
	                                            <Download size={12} />
	                                            TXT Export
	                                        </Button>
	                                        <Button
	                                            type="button"
	                                            variant="outline"
	                                            size="sm"
	                                            className="h-8 text-xs gap-1"
	                                            onClick={handleExportJson}
	                                            disabled={!text.trim() && parsedDays.length === 0}
	                                        >
	                                            <Download size={12} />
	                                            JSON Export
	                                        </Button>
	                                        <ImportRulesDialog rules={rules} onRulesChange={fetchRules} />
	                                    </div>
                                </div>
                                <Textarea
                                    className="flex-1 font-mono text-sm whitespace-pre"
                                    placeholder="Örn: PAZARTESİ\nKAHVALTI\nYumurta 1 adet 90 0 6 5"
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                />
                            </div>
                        ) : (
                            <div className="h-full flex flex-col gap-4 overflow-y-auto pr-2">
                                {/* ONE-CLICK IMPORT BUTTON */}
                                <div className="bg-green-50 border border-green-100 p-4 rounded-lg space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-green-800 font-semibold">
                                            <FileSpreadsheet size={18} /> Google Sheets Import
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => setConfigOpen(!configOpen)} className="text-green-700 h-8">
                                            <Key size={14} className="mr-1" /> Ayarlar
                                        </Button>
                                    </div>

                                    {/* Status Message */}
                                    {autoImportStatus && (
                                        <div className="bg-blue-50 text-blue-700 px-3 py-2 rounded text-sm border border-blue-200 flex items-center gap-2">
                                            <Loader2 size={14} className="animate-spin" />
                                            {autoImportStatus}
                                        </div>
                                    )}

                                    {/* NEW: File & Tab Selector Dashboard */}
                                    {isAuthenticated && selectedFile && selectedTab && !isProcessing && (
                                        <div className="p-3 bg-white border border-green-200 rounded-lg shadow-sm space-y-2 animate-in fade-in slide-in-from-top-1">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-800 border-b border-gray-100 pb-2">
                                                <FileSpreadsheet className="text-green-600" size={16} />
                                                <span className="truncate flex-1" title={selectedFile.name}>{selectedFile.name}</span>
                                                <div className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Aktif</div>
                                            </div>
                                            <div className="flex items-center gap-2 pt-1">
                                                <Label className="text-xs text-gray-500 whitespace-nowrap">Seçili Sayfa:</Label>
                                                <select
                                                    className="flex-1 h-8 text-xs border border-gray-300 rounded px-2 bg-white outline-none focus:border-green-500 cursor-pointer hover:border-green-400 transition-colors"
                                                    value={selectedTab}
                                                    onChange={(e) => handleManualTabChange(e.target.value)}
                                                >
                                                    {sheetTabs.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}

                                    {/* BULK IMPORT SELECTION - when multiple week tabs found */}
                                    {isAuthenticated && selectedFile && detectedWeekTabs.length > 1 && !isProcessing && (
                                        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg shadow-sm space-y-3 animate-in fade-in slide-in-from-top-1">
                                            <div className="text-sm font-semibold text-purple-800">
                                                📚 {detectedWeekTabs.length} hafta tabı bulundu
                                            </div>
                                            <div className="text-xs text-purple-600">
                                                Bulunan: {detectedWeekTabs.map(t => t.tabName).join(', ')}
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="border-purple-300 text-purple-700 hover:bg-purple-100"
                                                    onClick={() => {
                                                        const weekTabs = detectedWeekTabs.map(t => t.tabName)
                                                        if (selectedFile && weekTabs.length > 0) {
                                                            fetchMultipleTabsContent(selectedFile.id, weekTabs, false)
                                                        }
                                                    }}
                                                >
                                                    Tüm Haftaları Çek ({detectedWeekTabs.length})
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    className="bg-purple-600 hover:bg-purple-700 text-white"
                                                    onClick={() => {
                                                        if (selectedFile && selectedTabs.length > 0) {
                                                            fetchMultipleTabsContent(selectedFile.id, selectedTabs, false)
                                                        } else {
                                                            setAutoImportStatus('Önce tablardan seçim yapın.')
                                                        }
                                                    }}
                                                >
                                                    Seçili Tabları Çek ({selectedTabs.length})
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="flex-1 border-purple-300 text-purple-700 hover:bg-purple-100"
                                                    onClick={() => {
                                                        setBulkMode('all')
                                                        handleBulkImportAllWeeks()
                                                    }}
                                                >
                                                    Tüm Haftaları Tarihli İçe Aktar
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="border-purple-300 text-purple-700 hover:bg-purple-100"
                                                    onClick={() => {
                                                        setBulkMode('all')
                                                        handleBulkImportSelectedWeeks()
                                                    }}
                                                >
                                                    Seçili Tabları Tarihli İçe Aktar
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {(configOpen || !apiKey || !clientId) && (
                                        <div className="bg-white p-3 rounded border border-green-200 space-y-3 animate-in fade-in slide-in-from-top-2">
                                            <div className="grid gap-2">
                                                <Label htmlFor="apiKey">API Key</Label>
                                                <Input id="apiKey" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIzaSy..." className="font-mono text-xs" />
                                            </div>
                                            <div className="grid gap-2">
                                                <Label htmlFor="clientId">Client ID</Label>
                                                <Input id="clientId" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="733...apps.googleusercontent.com" className="font-mono text-xs" />
                                            </div>
                                            <div className="flex gap-2">
                                                <Button onClick={saveKeys} size="sm" className="flex-1 bg-green-600 hover:bg-green-700">Kaydet</Button>
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => {
                                                        if (confirm('Tüm Google API ayarları silinecek. Emin misiniz?')) {
                                                            localStorage.removeItem('diyet_google_api_key')
                                                            localStorage.removeItem('diyet_google_client_id')
                                                            setApiKey('')
                                                            setClientId('')
                                                            window.location.reload()
                                                        }
                                                    }}
                                                >
                                                    <Trash2 size={14} className="mr-1" /> Sıfırla
                                                </Button>
                                            </div>

                                            {/* API Logs Section */}
                                            <div className="mt-4 pt-4 border-t border-gray-100">
                                                <Label className="text-[10px] uppercase text-gray-400 font-bold mb-2 block">API Logları (Sorun Giderme)</Label>
                                                <div className="bg-gray-900 text-green-400 p-2 rounded text-[10px] font-mono h-32 overflow-y-auto whitespace-pre-wrap">
                                                    {logs.length === 0 ? '> Henüz işlem yapılmadı.' : logs.map((log, i) => (
                                                        <div key={i} className="mb-0.5 border-b border-gray-800 pb-0.5 last:border-0">{log}</div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {gapiError && (
                                        <div className="bg-red-50 text-red-700 px-3 py-2 rounded text-xs border border-red-200">
                                            <strong>Hata:</strong> {gapiError}
                                            <br />
                                            <span className="opacity-75">API Key kısıtlamalarını kontrol edin.</span>
                                        </div>
                                    )}

                                    {/* MAIN ACTION BUTTON */}
                                    <div className="pt-2">
                                        <Button
                                            onClick={async () => {
                                                if (selectedFile && selectedTabs.length > 0) {
                                                    await fetchMultipleTabsContent(selectedFile.id, selectedTabs, false)
                                                    return
                                                }
                                                if (isAuthenticated) {
                                                    await oneClickImport()
                                                } else {
                                                    const storedKey = apiKey || localStorage.getItem('diyet_google_api_key') || 'AIzaSyAFRdF7Myoa27DpBmt76_trtwEVpFpWgL8';
                                                    const storedClient = clientId || localStorage.getItem('diyet_google_client_id') || '337617773303-3h4isdumdaptn9psov53a930dp9c4826.apps.googleusercontent.com';
                                                    if (!storedKey || !storedClient) {
                                                        setAutoImportStatus('API anahtarları eksik. Lütfen Ayarları yapılandırın.');
                                                        setConfigOpen(true);
                                                        return;
                                                    }
                                                    if (isInitialized) {
                                                        login();
                                                    } else {
                                                        setAutoImportStatus('Google API hazırlanıyor, lütfen birazdan tekrar tıklayın.');
                                                        initClient(storedKey, storedClient);
                                                    }
                                                }
                                            }}
                                            disabled={isProcessing}
                                            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg py-6 text-lg font-semibold"
                                        >
                                            {isProcessing ? (
                                                <Loader2 className="animate-spin mr-2" size={20} />
                                            ) : (
                                                <FileSpreadsheet className="mr-2" size={20} />
                                            )}
                                            {isAuthenticated
                                                ? (selectedFile && selectedTabs.length > 0
                                                    ? `Seçili Tabları Çek (${selectedTabs.length})`
                                                    : 'Google Drive Dosyasını Otomatik Bul')
                                                : 'Bağlan ve Getir'}
                                        </Button>
                                        <p className="text-xs text-gray-500 text-center mt-2">
                                            {patientName ? `"${patientName}" ile otomatik dosya araması yapılır` : 'Hasta adı ile otomatik dosya araması yapılır'}
                                        </p>
                                    </div>

                                    {isAuthenticated && (
                                        <div className="flex items-center gap-2 text-sm text-green-700 bg-white px-3 py-2 rounded border border-green-200">
                                            <Check size={14} className="bg-green-100 rounded-full p-0.5" /> Google Bağlantısı Aktif
                                        </div>
                                    )}
                                </div>

                                {/* Search Section */}
                                {isAuthenticated && (
                                    <div className="space-y-4">
                                        <div className="flex gap-2">
                                            <Input
                                                value={searchQuery}
                                                onChange={e => setSearchQuery(e.target.value)}
                                                placeholder="Dosya adı veya Hasta ismi..."
                                                onKeyDown={e => e.key === 'Enter' && searchDrive()}
                                            />
                                            <Button onClick={searchDrive} disabled={isProcessing}>
                                                {isProcessing ? <Loader2 className="animate-spin" /> : <Search size={16} />} Ara
                                            </Button>
                                        </div>

                                        {foundFiles.length > 0 && (
                                            <div className="border rounded-md overflow-hidden">
                                                <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 border-b">Bulunan Dosyalar</div>
                                                <div className="max-h-40 overflow-y-auto divide-y">
                                                    {foundFiles.map(file => (
                                                        <div
                                                            key={file.id}
                                                            className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 flex justify-between items-center ${selectedFile?.id === file.id ? 'bg-blue-50 text-blue-700 font-medium' : ''}`}
                                                            onClick={() => fetchTabs(file)}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <FileSpreadsheet size={14} className="text-green-600" />
                                                                {file.name}
                                                            </div>
                                                            {selectedFile?.id === file.id && isProcessing && <Loader2 size={12} className="animate-spin text-blue-600" />}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Tab Selection */}
                                        {selectedFile && sheetTabs.length > 0 && (
                                            <div className="space-y-2 animate-in fade-in">
                                                <div className="flex items-center justify-between text-xs text-gray-500 gap-2">
                                                    <div>Seçili tab: {selectedTabs.length}</div>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            className="underline hover:text-gray-700"
                                                            onClick={() => setSelectedTabs([...sheetTabs])}
                                                        >
                                                            Tümünü Seç
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="underline hover:text-gray-700"
                                                            onClick={() => setSelectedTabs([])}
                                                        >
                                                            Seçimi Temizle
                                                        </button>
                                                    </div>
                                                </div>
                                                <Label>Sayfa (Tab) Seçin:</Label>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {sheetTabs.map(tab => (
                                                        <div
                                                            key={tab}
                                                            onClick={() => {
                                                                setSelectedTab(tab)
                                                                toggleTabSelection(tab)
                                                            }}
                                                            className={`px-3 py-2 border rounded text-center text-sm cursor-pointer transition-all ${selectedTabs.includes(tab) ? 'bg-green-600 text-white border-green-600 shadow' : 'hover:bg-gray-50 hover:border-gray-300'}`}
                                                        >
                                                            {tab}
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="pt-2 text-xs text-gray-500">
                                                    Üstteki 4 ana butonla tüm/seçili tabları çekebilir veya tarihli içe aktarma akışını başlatabilirsiniz.
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    ) : step === 'bulk-review' ? (
                        <div className="h-full flex flex-col space-y-4">
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 space-y-3 shrink-0">
                                <div className="flex items-center gap-2 text-blue-800 font-bold text-sm">
                                    <CalendarIcon size={18} />
                                    Toplu İçe Aktarma: Tarih ve Sıralama
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs font-bold text-blue-700">1. Haftanın Başlangıç Tarihi</Label>
                                        <div className="flex items-center gap-2">
                                            <Input 
                                                type="date" 
                                                value={bulkBaseDate} 
                                                onChange={(e) => updateBulkDates(e.target.value)}
                                                className="bg-white flex-1"
                                            />
                                            <div className="text-[10px] font-bold text-blue-600 bg-blue-100/50 px-2 py-1 rounded min-w-[80px] text-center border border-blue-200">
                                                {new Date(bulkBaseDate).toLocaleDateString('tr-TR', { weekday: 'long' }).toUpperCase()}
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-blue-600 italic leading-tight">
                                            İpucu: Bu tarihi değiştirdiğinizde tüm haftalar ardışık olarak (+7 gün) güncellenir. 
                                            Verileriniz 7 günden fazla olsa bile 1. Pazartesi'den itibaren 7 günlük periyotlar alınır.
                                        </p>
                                    </div>
                                    <div className="bg-white/50 p-2 rounded border border-blue-200 flex items-center gap-3">
                                       <div className="bg-blue-600 text-white p-2 rounded-full">
                                           <CheckCircle2 size={20} />
                                       </div>
                                       <div className="text-xs text-blue-800">
                                           <b>{bulkImportData.length} Hafta</b> algılandı. <br/>
                                           Lütfen aşağıdan numaraları ve tarihleri kontrol edin.
                                       </div>
                                    </div>
                                </div>
                            </div>

                            <ScrollArea className="flex-1 border rounded-lg bg-gray-50/30 overflow-hidden">
                                <div className="p-2 space-y-2">
                                    {bulkImportData.map((item, idx) => (
                                        <div key={idx} className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-white p-3 rounded-md border shadow-sm group hover:border-blue-300 transition-colors">
                                            <div className="w-16 space-y-1">
                                                <Label className="text-[10px] text-gray-400 font-bold uppercase">H.NO</Label>
                                                <Input 
                                                    type="number" 
                                                    value={item.weekNumber} 
                                                    onChange={(e) => updateBulkWeekNumber(idx, parseInt(e.target.value) || 0)}
                                                    className="h-8 font-bold text-center"
                                                />
                                            </div>
                                            
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-gray-400 uppercase">SHEET SAYFASI</div>
                                                <div className="text-sm font-semibold truncate text-gray-700">{item.tabName}</div>
                                                <div className="flex gap-0.5 mt-1">
                                                    {item.days.map((day: any, di: number) => {
                                                        const isActive = day.is_active !== false;
                                                        return (
                                                            <div 
                                                                key={di} 
                                                                onClick={() => toggleBulkDayActive(idx, di)}
                                                                className={`w-5 h-5 rounded-sm flex items-center justify-center text-[9px] font-bold uppercase cursor-pointer transition-colors ${
                                                                    isActive 
                                                                        ? 'bg-blue-50 border border-blue-100 text-blue-600 hover:bg-blue-100' 
                                                                        : 'bg-gray-50 border border-gray-200 text-gray-400 hover:bg-gray-100'
                                                                }`}
                                                                title={isActive ? "Aktif (İçe Aktarılacak)" : "Pasif (Atlanacak)"}
                                                            >
                                                                {day.dayName.substring(0, 1)}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>

                                            <div className="flex-1 space-y-1 min-w-[150px]">
                                                <div className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-2">
                                                    BAŞLANGIÇ TARİHİ
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Input 
                                                        type="date"
                                                        value={item.startDate}
                                                        onChange={(e) => updateSingleBulkDate(idx, e.target.value)}
                                                        className="h-8 text-xs font-mono w-40"
                                                    />
                                                    <div className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${
                                                        (() => {
                                                            const dateDay = new Date(item.startDate).toLocaleDateString('tr-TR', { weekday: 'long' }).toUpperCase();
                                                            const dataDay = item.days[0]?.dayName.toUpperCase() || '';
                                                            const aligned = dataDay.includes(dateDay) || dateDay.includes(dataDay);
                                                            return aligned ? 'bg-green-50 text-green-700 border-green-200' : 'bg-orange-50 text-orange-700 border-orange-200';
                                                        })()
                                                    }`}>
                                                        {new Date(item.startDate).toLocaleDateString('tr-TR', { weekday: 'long' }).toUpperCase()}
                                                    </div>
                                                    {(() => {
                                                        const dateDay = new Date(item.startDate).toLocaleDateString('tr-TR', { weekday: 'long' }).toUpperCase();
                                                        const dataDay = item.days[0]?.dayName.toUpperCase() || '';
                                                        const aligned = dataDay.includes(dateDay) || dateDay.includes(dataDay);
                                                        if (!aligned) {
                                                            return (
                                                                <TooltipProvider>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <div className="cursor-help">
                                                                                <AlertCircle size={14} className="text-orange-500 animate-pulse" />
                                                                            </div>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent>
                                                                            <p className="text-xs">Tarih ile verideki gün ({dataDay}) uyuşmuyor.</p>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                            )
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                            </div>
                                            
                                            <div className="text-right space-y-1 hidden sm:block min-w-[100px]">
                                                <div className="text-[10px] font-bold text-gray-400 uppercase">BİTİŞ</div>
                                                <div className="text-xs font-mono bg-gray-50 px-2 py-1 rounded border border-dashed text-gray-400">
                                                    {item.endDate}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                    ) : (
                        <ScrollArea className="h-full border rounded-md p-4 bg-gray-50">
                            {parsedDays.length === 0 && <div className="text-center text-gray-500 py-10">Hiçbir veri algılanamadı. Formatı kontrol edin veya Kurallar ekleyin.</div>}

                            {parsedDays.map((day, dIdx) => (
                                <div key={dIdx} className={`mb-6 border rounded shadow-sm overflow-hidden transition-all ${day.is_active !== false ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
                                    <div className="bg-orange-100 flex items-center justify-between px-4 py-2 border-b border-orange-200">
                                        <span className="font-bold text-orange-900">{day.dayName}</span>
                                        <button 
                                            onClick={() => {
                                                const newDays = [...parsedDays]
                                                newDays[dIdx] = { ...newDays[dIdx], is_active: newDays[dIdx].is_active === false ? true : false }
                                                setParsedDays(newDays)
                                            }}
                                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border transition-colors ${
                                                day.is_active !== false 
                                                    ? 'bg-orange-600 border-orange-700 text-white hover:bg-orange-700' 
                                                    : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                                            }`}
                                        >
                                            {day.is_active !== false ? 'İçe Aktarılacak' : 'Atlanacak'}
                                        </button>
                                    </div>
                                    <div className="divide-y">
                                        {day.meals.map((meal, mIdx) => (
                                            <div key={mIdx}>
                                                <div className="bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-800 uppercase tracking-wide">
                                                    {meal.mealName}
                                                </div>
                                                <div className="p-2 space-y-1">
                                                    <div className="flex items-center justify-end gap-2 text-[10px] font-semibold text-gray-500 px-1">
                                                        <span className="w-10 text-right">Kal</span>
                                                        <span className="w-8 text-right">Karb</span>
                                                        <span className="w-8 text-right">Prot</span>
                                                        <span className="w-8 text-right">Yağ</span>
                                                    </div>
                                                    {meal.foods.map((food, fIdx) => (
                                                        <div key={fIdx} className="flex items-center gap-3 text-sm p-1 hover:bg-gray-50 rounded group">
                                                            <div
                                                                className="w-6 flex justify-center cursor-pointer"
                                                                onClick={() => {
                                                                    // Deep clone to ensure React detects state change for nested objects
                                                                    const newDays = JSON.parse(JSON.stringify(parsedDays))
                                                                    const targetFood = newDays[dIdx].meals[mIdx].foods[fIdx]

                                                                    if (targetFood.status === 'matched') {
                                                                        // Unmatch: Force to unknown
                                                                        targetFood.status = 'unknown'
                                                                        targetFood.matchedFoodId = undefined
                                                                    } else {
                                                                        // Rematch: Try to find match again
                                                                        const match = findBestMatch(targetFood.originalText)
                                                                        if (match && match.score > 0.75) {
                                                                            targetFood.matchedFoodId = match.id
                                                                            targetFood.matchConfidence = match.score
                                                                            targetFood.status = 'matched'
                                                                        } else {
                                                                            // Could not find match, maybe alert or just stay unknown
                                                                            // For UX, maybe just blink or nothing?
                                                                        }
                                                                    }
                                                                    setParsedDays(newDays)
                                                                }}
                                                                title={food.status === 'matched' ? "Eşleşmeyi Boz (Özel Yemek Olarak Ekle)" : "Tekrar Eşleştirmeyi Dene"}
                                                            >
                                                                {food.status === 'matched' ? (
                                                                    <div className="relative">
                                                                        <Check size={16} className="text-green-500" />
                                                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-white/80">
                                                                            <span className="text-[10px] font-bold text-red-500">X</span>
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="relative">
                                                                        <AlertCircle size={16} className="text-yellow-500" />
                                                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-white/80">
                                                                            <span className="text-[10px] font-bold text-green-500">?</span>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-50 text-red-500"
                                                                title="Bu bir yemek değil: satırı çıkarır. Gerekirse alttaki 'Yanlışı Geri Al' ile geri alabilirsiniz."
                                                                onClick={() => markFoodAsNotFood(dIdx, mIdx, fIdx)}
                                                            >
                                                                <Ban size={14} />
                                                            </button>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-medium truncate" title={food.originalText}>{food.originalText}</div>
                                                                {food.status === 'matched' && food.matchedFoodId && (
                                                                    <div className="text-[10px] text-green-600 flex items-center gap-1">
                                                                        <Check size={10} /> {localFoods.find(f => f.id === food.matchedFoodId)?.name}
                                                                        <span className="text-gray-400 text-[9px]">(Otomatik Eşleşme)</span>
                                                                    </div>
                                                                )}
                                                                {food.status !== 'matched' && (
                                                                    <div className="text-[10px] text-orange-600 flex items-center gap-1">
                                                                        <span>⚠️ Veritabanına yeni kayıt olarak eklenecek</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {/* Macros */}
                                                            <div className="flex gap-2 text-xs text-gray-500 font-mono">
                                                                <span className="w-10 text-right">{food.calories}</span>
                                                                <span className="w-8 text-right text-orange-600">{food.carbs}</span>
                                                                <span className="w-8 text-right text-blue-600">{food.protein}</span>
                                                                <span className="w-8 text-right text-yellow-600">{food.fat}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {meal.foods.length === 0 && <div className="text-xs text-gray-400 italic px-4">Besin bulunamadı</div>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </ScrollArea>
                    )}
                </div>

                <div className="px-6 py-4 border-t flex flex-col sm:flex-row gap-4 items-center justify-between bg-gray-50/50 shrink-0">
                    {step === 'review' ? (
                        <div className="flex flex-1 flex-col sm:flex-row items-start sm:items-center gap-4 bg-blue-50/50 p-2 rounded border border-blue-100 max-w-2xl">
                            <div className="text-xs font-semibold text-blue-700 whitespace-nowrap">İçe Aktarma Modu:</div>
                            <div className="flex flex-col sm:flex-row gap-4">
                                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-blue-100/50 px-2 py-1 rounded transition-colors">
                                    <input type="radio" name="mode" className="accent-blue-600" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
                                    <span>Değiştir (Eskileri Sil*)</span>
                                </label>
                                <label className="flex items-center gap-2 text-sm cursor-pointer hover:bg-blue-100/50 px-2 py-1 rounded transition-colors">
                                    <input type="radio" name="mode" className="accent-blue-600" checked={importMode === 'append'} onChange={() => setImportMode('append')} />
                                    <span>Ekle (Mevcutun Altına)</span>
                                </label>
                            </div>
                            <div className="text-[10px] text-gray-500 flex items-center gap-1 sm:ml-auto whitespace-nowrap italic">
                                *Kilitli yemekler korunur.
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1"></div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                        {step === 'review' && ignoreHistory.length > 0 && (
                            <Button variant="outline" onClick={undoLastIgnoredFood}>
                                Yanlışı Geri Al ({ignoreHistory.length})
                            </Button>
                        )}
                        {(step === 'review' || step === 'bulk-review') && (
                            <>
                                <Button variant="outline" onClick={handleCopyAll} disabled={!getCopyAllContent().trim()}>
                                    <Copy size={14} className="mr-1" />
                                    Tumunu Kopyala
                                </Button>
                                <Button variant="outline" onClick={handleCopyCsv} disabled={!getCopyCsvContent().trim()}>
                                    <Copy size={14} className="mr-1" />
                                    CSV Kopyala
                                </Button>
                                <Button variant="outline" onClick={handleExportTxt} disabled={!text.trim()}>
                                    <Download size={14} className="mr-1" />
                                    TXT Export
                                </Button>
                                <Button variant="outline" onClick={handleExportJson} disabled={!text.trim() && parsedDays.length === 0 && bulkImportData.length === 0}>
                                    <Download size={14} className="mr-1" />
                                    JSON Export
                                </Button>
                            </>
                        )}
                        {canShowPoolAction && (
                            <Button
                                variant="outline"
                                className="border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                onClick={handleSendToPool}
                                disabled={isPoolActionDisabled}
                            >
                                {isSyncingPool ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                                Havuza Aktar
                            </Button>
                        )}
                        {(step === 'review' || step === 'bulk-review') && (
                            <Button variant="outline" onClick={() => setStep('input')}>Geri Dön</Button>
                        )}
                        {step === 'input' ? (
                            activeTab === 'text' ? (
                            <Button onClick={() => parseText(text)} disabled={!text.trim() || isProcessing} className="w-full sm:w-auto">
                                {isProcessing ? <Loader2 className="animate-spin mr-2" /> : null}
                                Ayrıştır ve Önizle
                            </Button>
                            ) : null
                        ) : step === 'bulk-review' ? (
                            <Button onClick={confirmBulkImport} disabled={isProcessing || bulkImportData.length === 0} className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto shadow-sm">
                                {isProcessing ? <Loader2 className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
                                Planı Onayla ve {bulkImportData.length} Haftayı İçe Aktar ({totalFoodCountBulk} Besin)
                            </Button>
                        ) : (
                            <Button onClick={handleConfirm} className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto shadow-sm">
                                <Save size={16} className="mr-2" />
                                Onayla ve İçe Aktar ({totalFoodCountSingle} Besin)
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
