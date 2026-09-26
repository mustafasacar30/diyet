"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Star, Search, Loader2, Trash2, ChevronDown, ChevronUp, Info, Minus, Plus, RotateCcw, Undo2, Filter, X, CheckSquare, Square, ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PreferenceQuestionnaire, type PreferenceData } from "@/components/patient/preference-questionnaire"
import { savePatientPreferences } from "@/actions/patient-actions"

type FoodOverride = {
    foodId: string
    name: string
    score: number
    source: 'patient' | 'program' | 'team' | 'global' | 'default'
    isOwn: boolean
}

const SCORE_LABELS: Record<number, { label: string; color: string; bg: string }> = {
    0: { label: "Verme", color: "text-red-700", bg: "bg-red-100" },
    1: { label: "Az", color: "text-orange-700", bg: "bg-orange-100" },
    2: { label: "Az", color: "text-orange-700", bg: "bg-orange-100" },
    3: { label: "Az", color: "text-orange-600", bg: "bg-orange-50" },
    4: { label: "Normal", color: "text-yellow-700", bg: "bg-yellow-100" },
    5: { label: "Normal", color: "text-yellow-700", bg: "bg-yellow-100" },
    6: { label: "Normal", color: "text-yellow-700", bg: "bg-yellow-50" },
    7: { label: "Çok", color: "text-emerald-700", bg: "bg-emerald-100" },
    8: { label: "Çok", color: "text-emerald-700", bg: "bg-emerald-100" },
    9: { label: "Çok", color: "text-emerald-700", bg: "bg-emerald-50" },
    10: { label: "En Çok", color: "text-emerald-800", bg: "bg-emerald-200" },
}

const SOURCE_LABELS: Record<string, string> = {
    patient: "Sizin ayarınız",
    program: "Programdan miras",
    team: "Takımdan miras",
    global: "Genel ayar",
    default: "Varsayılan",
}

function ScoreBadge({ score }: { score: number }) {
    const info = SCORE_LABELS[score] || SCORE_LABELS[5]
    return (
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", info.color, info.bg)}>
            {score} · {info.label}
        </span>
    )
}

function FrequencyHint({ score }: { score: number }) {
    if (score === 0) return <span className="text-[10px] text-red-500">Hiç gelmez</span>
    if (score >= 7) return <span className="text-[10px] text-emerald-600">Haftada 3x'e kadar</span>
    if (score >= 4) return <span className="text-[10px] text-yellow-600">Haftada 2x'e kadar</span>
    return <span className="text-[10px] text-orange-600">Haftada 1x</span>
}

export default function PreferencesPage() {
    const { user, profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [patientId, setPatientId] = useState<string | null>(null)
    const [settingsId, setSettingsId] = useState<string | null>(null)

    const [overrides, setOverrides] = useState<FoodOverride[]>([])
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [searchResults, setSearchResults] = useState<any[]>([])
    const [searching, setSearching] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)
    const [showGuide, setShowGuide] = useState(false)
    const [sortMode, setSortMode] = useState<'score-desc' | 'score-asc' | 'name'>('score-desc')
    const [lastSavedDate, setLastSavedDate] = useState<string | null>(null)
    const [backupOverrides, setBackupOverrides] = useState<FoodOverride[] | null>(null)
    const [resetting, setResetting] = useState(false)
    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const [filterQuery, setFilterQuery] = useState("")
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [bulkMode, setBulkMode] = useState(false)
    const [bulkScore, setBulkScore] = useState("")
    const [viewMode, setViewMode] = useState<'scores' | 'questionnaire'>('scores')
    const [questionnaireSaving, setQuestionnaireSaving] = useState(false)
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Typewriter effect for placeholders
    const [searchPlaceholder, setSearchPlaceholder] = useState("Tüm yemeklerde arama yapın")
    const [filterPlaceholder, setFilterPlaceholder] = useState("Listeyi filtreleyin...")
    const typeDone = useRef(false)

    useEffect(() => {
        try { if (sessionStorage.getItem('pref-typed')) { typeDone.current = true; return } } catch { return }
        if (typeDone.current) return

        const text1 = "Tüm yemeklerde arama yapın"
        const text2 = "Listeyi filtreleyin..."
        let i = 0
        let cancelled = false
        setSearchPlaceholder("│")
        setFilterPlaceholder("")

        const timer1 = setInterval(() => {
            if (cancelled) return
            i++
            setSearchPlaceholder(text1.slice(0, i) + "│")
            if (i >= text1.length) {
                clearInterval(timer1)
                setSearchPlaceholder(text1)
                setTimeout(() => {
                    if (cancelled) return
                    let j = 0
                    setFilterPlaceholder("│")
                    const timer2 = setInterval(() => {
                        if (cancelled) return
                        j++
                        setFilterPlaceholder(text2.slice(0, j) + "│")
                        if (j >= text2.length) {
                            clearInterval(timer2)
                            setFilterPlaceholder(text2)
                            typeDone.current = true
                            try { sessionStorage.setItem('pref-typed', '1') } catch {}
                        }
                    }, 40)
                }, 500)
            }
        }, 40)

        return () => { cancelled = true; clearInterval(timer1) }
    }, [])

    // Resolve patient ID
    useEffect(() => {
        async function resolvePatient() {
            if (!user || !profile) return
            const targetId = profile.id || user.id
            let pid = targetId
            const { data: legacyMatch } = await supabase
                .from('patients')
                .select('id')
                .eq('user_id', targetId)
                .neq('id', targetId)
                .limit(1)
                .maybeSingle()
            if (legacyMatch) pid = legacyMatch.id
            setPatientId(pid)
        }
        resolvePatient()
    }, [user, profile])

    // Load overrides from all layers
    useEffect(() => {
        if (!patientId) return
        loadOverrides()
    }, [patientId])

    const loadOverrides = useCallback(async () => {
        if (!patientId) return
        setLoading(true)

        try {
            // Fetch all layers
            const [
                { data: globalSettings },
                { data: patientRow },
            ] = await Promise.all([
                supabase.from('planner_settings').select('food_score_overrides').eq('scope', 'global').maybeSingle(),
                supabase.from('patients').select('program_template_id').eq('id', patientId).single(),
            ])

            // Fetch patient settings
            const { data: patientSettings } = await supabase
                .from('planner_settings')
                .select('id, food_score_overrides, updated_at')
                .eq('scope', 'patient')
                .eq('patient_id', patientId)
                .maybeSingle()

            if (patientSettings?.id) setSettingsId(patientSettings.id)
            if (patientSettings?.updated_at) setLastSavedDate(patientSettings.updated_at)

            // Fetch program settings if applicable
            let programSettings: any = null
            if (patientRow?.program_template_id) {
                const { data } = await supabase
                    .from('planner_settings')
                    .select('food_score_overrides')
                    .eq('scope', 'program')
                    .eq('program_template_id', patientRow.program_template_id)
                    .maybeSingle()
                programSettings = data
            }

            // Merge layers: patient > program > global
            const globalOvr: Record<string, number> = globalSettings?.food_score_overrides || {}
            const programOvr: Record<string, number> = programSettings?.food_score_overrides || {}
            const patientOvr: Record<string, number> = patientSettings?.food_score_overrides || {}

            const allFoodIds = new Set([
                ...Object.keys(globalOvr),
                ...Object.keys(programOvr),
                ...Object.keys(patientOvr),
            ])

            if (allFoodIds.size === 0) {
                setOverrides([])
                setLoading(false)
                return
            }

            // Fetch food names
            const { data: foods } = await supabase
                .from('foods')
                .select('id, name')
                .in('id', Array.from(allFoodIds))

            const foodNames: Record<string, string> = {}
            for (const f of (foods || [])) foodNames[f.id] = f.name

            // Build override list
            const result: FoodOverride[] = []
            for (const foodId of allFoodIds) {
                let score = 5
                let source: FoodOverride['source'] = 'default'
                let isOwn = false

                if (foodId in globalOvr) { score = globalOvr[foodId]; source = 'global' }
                if (foodId in programOvr) { score = programOvr[foodId]; source = 'program' }
                if (foodId in patientOvr) { score = patientOvr[foodId]; source = 'patient'; isOwn = true }

                result.push({
                    foodId,
                    name: foodNames[foodId] || foodId.slice(0, 8) + '...',
                    score,
                    source,
                    isOwn,
                })
            }

            setOverrides(result)
        } catch (err) {
            console.error("Error loading overrides:", err)
        } finally {
            setLoading(false)
        }
    }, [patientId])

    // Search foods
    const handleSearch = useCallback(async (query: string) => {
        setSearchQuery(query)
        if (searchTimeout.current) clearTimeout(searchTimeout.current)

        if (query.length < 2) {
            setSearchResults([])
            return
        }

        searchTimeout.current = setTimeout(async () => {
            setSearching(true)
            const words = query.trim().split(/\s+/).filter(w => w.length > 0)
            let q = supabase.from('foods').select('id, name, category, priority_score')
            words.forEach(w => { q = q.ilike('name', `%${w}%`) })
            const { data } = await q.limit(15)
            setSearchResults(data || [])
            setSearching(false)
        }, 300)
    }, [])

    // Add food to overrides
    const addFood = (food: any) => {
        const existing = overrides.find(o => o.foodId === food.id)
        if (existing) {
            setExpandedId(food.id)
            setSearchQuery("")
            setSearchResults([])
            return
        }

        setOverrides(prev => [...prev, {
            foodId: food.id,
            name: food.name,
            score: food.priority_score ?? 5,
            source: 'patient',
            isOwn: true,
        }])
        setExpandedId(food.id)
        setSearchQuery("")
        setSearchResults([])
        setHasChanges(true)
    }

    // Update score
    const updateScore = (foodId: string, newScore: number) => {
        const clamped = Math.max(0, Math.min(10, newScore))
        setOverrides(prev => prev.map(o =>
            o.foodId === foodId ? { ...o, score: clamped, isOwn: true, source: 'patient' } : o
        ))
        setHasChanges(true)
    }

    // Remove override (reset to inherited)
    const removeOverride = (foodId: string) => {
        setOverrides(prev => prev.filter(o => o.foodId !== foodId || !o.isOwn))
        setHasChanges(true)
        setExpandedId(null)
    }

    // Save all changes
    const handleSave = async () => {
        if (!patientId) return
        setSaving(true)

        const patientOverrides: Record<string, number> = {}
        for (const o of overrides) {
            if (o.isOwn) patientOverrides[o.foodId] = o.score
        }

        try {
            if (settingsId) {
                await supabase
                    .from('planner_settings')
                    .update({ food_score_overrides: patientOverrides })
                    .eq('id', settingsId)
            } else {
                const userId = user?.id
                if (userId) {
                    const { data } = await supabase
                        .from('planner_settings')
                        .insert({
                            user_id: userId,
                            scope: 'patient',
                            patient_id: patientId,
                            food_score_overrides: patientOverrides,
                        })
                        .select('id')
                        .single()
                    if (data) setSettingsId(data.id)
                }
            }
            setHasChanges(false)
            setLastSavedDate(new Date().toISOString())
            setBackupOverrides(null)
        } catch (err) {
            console.error("Error saving overrides:", err)
        } finally {
            setSaving(false)
        }
    }

    const handleReset = async () => {
        if (!patientId || !settingsId) return
        setResetting(true)
        setBackupOverrides([...overrides])

        try {
            await supabase
                .from('planner_settings')
                .update({ food_score_overrides: {} })
                .eq('id', settingsId)
            setShowResetConfirm(false)
            await loadOverrides()
            setHasChanges(false)
        } catch (err) {
            console.error("Error resetting overrides:", err)
        } finally {
            setResetting(false)
        }
    }

    const handleRestore = async () => {
        if (!backupOverrides || !patientId) return
        setSaving(true)

        const patientOverrides: Record<string, number> = {}
        for (const o of backupOverrides) {
            if (o.isOwn) patientOverrides[o.foodId] = o.score
        }

        try {
            if (settingsId) {
                await supabase
                    .from('planner_settings')
                    .update({ food_score_overrides: patientOverrides })
                    .eq('id', settingsId)
            }
            setOverrides(backupOverrides)
            setBackupOverrides(null)
            setHasChanges(false)
        } catch (err) {
            console.error("Error restoring overrides:", err)
        } finally {
            setSaving(false)
        }
    }

    // Filter + Sort overrides
    const filteredOverrides = filterQuery.length >= 2
        ? overrides.filter(o => o.name.toLowerCase().includes(filterQuery.toLowerCase()))
        : overrides
    const sortedOverrides = [...filteredOverrides].sort((a, b) => {
        if (sortMode === 'score-desc') return b.score - a.score
        if (sortMode === 'score-asc') return a.score - b.score
        return a.name.localeCompare(b.name, 'tr')
    })

    const handleSelectAll = () => {
        const ids = new Set(sortedOverrides.filter(o => o.isOwn).map(o => o.foodId))
        setSelectedIds(ids)
    }

    const handleDeselectAll = () => setSelectedIds(new Set())

    const handleBulkRemove = () => {
        setOverrides(prev => prev.filter(o => !selectedIds.has(o.foodId) || !o.isOwn))
        setHasChanges(true)
        setSelectedIds(new Set())
        setBulkMode(false)
    }

    const toggleSelect = (foodId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(foodId)) next.delete(foodId)
            else next.add(foodId)
            return next
        })
    }

    const handleBulkSetScore = () => {
        const score = parseInt(bulkScore)
        if (isNaN(score) || score < 0 || score > 10 || selectedIds.size === 0) return
        setOverrides(prev => prev.map(o =>
            selectedIds.has(o.foodId) ? { ...o, score, isOwn: true, source: 'patient' as const } : o
        ))
        setHasChanges(true)
        setBulkScore("")
        setSelectedIds(new Set())
        setBulkMode(false)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
        )
    }

    const handleQuestionnaireSave = async (data: PreferenceData) => {
        if (!patientId) return
        setQuestionnaireSaving(true)
        try {
            const result = await savePatientPreferences(patientId, data)
            if (result.error) {
                alert(result.error)
            } else {
                setViewMode('scores')
                loadOverrides()
            }
        } catch (e: any) {
            alert(e.message || "Bir hata oluştu")
        } finally {
            setQuestionnaireSaving(false)
        }
    }

    return (
        <div className="max-w-4xl mx-auto p-2 pb-24 sm:p-4 space-y-2">
            {/* Page Title */}
            <div className="flex items-center justify-between px-1 pt-1">
                <h1 className="text-[15px] font-bold text-gray-800 flex items-center gap-1.5">
                    <Star className="h-4 w-4 text-amber-500" />
                    Yemek Tercihlerim
                </h1>
                <button
                    onClick={() => setShowGuide(v => !v)}
                    className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-800 font-medium"
                >
                    <Info className="h-3 w-3" />
                    {showGuide ? "Gizle" : "Skor rehberi"}
                </button>
            </div>

            {/* View Toggle */}
            <div className="flex gap-1.5 px-1">
                <button
                    onClick={() => setViewMode('scores')}
                    className={cn(
                        "flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                        viewMode === 'scores'
                            ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                            : "bg-white text-gray-600 border-gray-200 hover:border-amber-300"
                    )}
                >
                    <Star className="h-3 w-3" /> Yemek Skorları
                </button>
                <button
                    onClick={() => setViewMode('questionnaire')}
                    className={cn(
                        "flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all",
                        viewMode === 'questionnaire'
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                            : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300"
                    )}
                >
                    <ClipboardList className="h-3 w-3" /> Tercih Anketi
                </button>
            </div>
            {showGuide && (
                <div className="px-2.5 py-2 rounded-lg bg-amber-50/50 border border-amber-100 space-y-1 text-[10px] text-amber-900">
                    <div className="flex items-center gap-2"><span className="font-bold text-red-600 w-5">0</span> Hiç verilmez</div>
                    <div className="flex items-center gap-2"><span className="font-bold text-orange-600 w-5">1-3</span> Az — haftada 1x</div>
                    <div className="flex items-center gap-2"><span className="font-bold text-yellow-600 w-5">4-6</span> Normal — haftada 2x</div>
                    <div className="flex items-center gap-2"><span className="font-bold text-emerald-600 w-5">7-10</span> Çok — haftada 3x</div>
                </div>
            )}

            {viewMode === 'questionnaire' && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                    <PreferenceQuestionnaire
                        onComplete={handleQuestionnaireSave}
                        onCancel={() => setViewMode('scores')}
                        loading={questionnaireSaving}
                        standalone
                    />
                </div>
            )}

            {viewMode === 'scores' && (
            <div className="space-y-2">
            {/* Search */}
            <div className="relative">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 shadow-sm focus-within:ring-2 focus-within:ring-amber-300 focus-within:border-amber-300">
                    <Search className="h-4 w-4 text-gray-400 shrink-0" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => handleSearch(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="flex-1 text-[12px] outline-none bg-transparent placeholder:text-amber-600 placeholder:font-medium"
                    />
                    {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                </div>

                {/* Search Results Dropdown */}
                {searchResults.length > 0 && searchQuery.length >= 2 && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {searchResults.map(f => {
                            const alreadyAdded = overrides.some(o => o.foodId === f.id)
                            return (
                                <button
                                    key={f.id}
                                    onClick={() => addFood(f)}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-amber-50 text-left border-b last:border-0 transition-colors"
                                >
                                    <span className="flex-1 text-[13px] font-medium truncate">{f.name}</span>
                                    <span className="text-[10px] text-gray-400 shrink-0">{f.category}</span>
                                    {alreadyAdded ? (
                                        <span className="text-[10px] text-emerald-600 font-bold shrink-0">✓</span>
                                    ) : (
                                        <span className="text-[10px] text-amber-600 font-bold shrink-0">+ Ekle</span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Reset & Restore Section */}
            {backupOverrides && (
                <div className="flex items-start gap-2.5 p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <Undo2 className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <p className="text-[13px] text-blue-800">Tercihleriniz sıfırlandı. Önceki ayarlarınıza geri dönmek ister misiniz?</p>
                        <button
                            onClick={handleRestore}
                            disabled={saving}
                            className="mt-1.5 text-[12px] font-semibold text-blue-700 hover:text-blue-900 underline underline-offset-2"
                        >
                            {saving ? "Geri yükleniyor..." : "Önceki Tercihlerimi Geri Yükle"}
                        </button>
                    </div>
                </div>
            )}

            {/* Filter + Sort + Bulk */}
            {overrides.length > 0 && (
                <div className="space-y-1.5">
                    {/* Filter Bar */}
                    <div className="flex items-center gap-1.5">
                        <div className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 focus-within:ring-1 focus-within:ring-emerald-300">
                            <Filter className="h-3 w-3 text-gray-400 shrink-0" />
                            <input
                                type="text"
                                value={filterQuery}
                                onChange={e => { setFilterQuery(e.target.value); setSelectedIds(new Set()) }}
                                placeholder={filterPlaceholder}
                                className="flex-1 text-[12px] outline-none bg-transparent placeholder:text-emerald-600 placeholder:font-medium"
                            />
                            {filterQuery && (
                                <button onClick={() => { setFilterQuery(""); setSelectedIds(new Set()) }}>
                                    <X className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                                </button>
                            )}
                        </div>
                        <button
                            onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); setBulkScore("") }}
                            className={cn(
                                "text-[10px] px-2.5 py-1.5 rounded-lg border font-semibold transition-colors",
                                bulkMode
                                    ? "bg-amber-500 border-amber-500 text-white shadow-sm"
                                    : "bg-gradient-to-r from-amber-400 to-orange-400 border-amber-300 text-white shadow-sm hover:from-amber-500 hover:to-orange-500"
                            )}
                        >
                            {bulkMode ? "Bitti" : "Seç"}
                        </button>
                    </div>

                    {/* Count + Sort + Bulk Actions */}
                    <div className="flex items-center justify-between px-0.5">
                        <span className="text-[10px] text-gray-400">
                            {filterQuery ? `${sortedOverrides.length}/${overrides.length}` : overrides.length} yemek
                        </span>
                        <div className="flex items-center gap-2">
                            {bulkMode && sortedOverrides.some(o => o.isOwn) && (
                                <>
                                    <button onClick={selectedIds.size > 0 ? handleDeselectAll : handleSelectAll} className="text-[10px] text-amber-600 hover:text-amber-800 font-medium">
                                        {selectedIds.size > 0 ? "Seçimi Kaldır" : "Tümünü Seç"}
                                    </button>
                                    {selectedIds.size > 0 && (
                                        <>
                                            <span className="text-[10px] text-gray-300">|</span>
                                            <button onClick={handleBulkRemove} className="text-[10px] text-red-500 hover:text-red-700 font-medium">{selectedIds.size} Sil</button>
                                        </>
                                    )}
                                </>
                            )}
                            <button
                                onClick={() => setSortMode(m =>
                                    m === 'score-desc' ? 'score-asc' : m === 'score-asc' ? 'name' : 'score-desc'
                                )}
                                className="text-[10px] text-gray-400 hover:text-gray-700"
                            >
                                {sortMode === 'score-desc' ? 'Skor ↓' : sortMode === 'score-asc' ? 'Skor ↑' : 'A-Z'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reset Button */}
            {overrides.some(o => o.isOwn) && !showResetConfirm && (
                <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200">
                    <div>
                        <p className="text-[12px] text-gray-600">Tüm kişisel tercihleri sıfırla</p>
                        {lastSavedDate && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                                Son değişiklik: {new Date(lastSavedDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => setShowResetConfirm(true)}
                        className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                    >
                        <RotateCcw className="h-3 w-3" />
                        Sıfırla
                    </button>
                </div>
            )}

            {/* Reset Confirmation */}
            {showResetConfirm && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 space-y-2">
                    <p className="text-[13px] text-red-800 font-medium">Tüm kişisel yemek tercihleriniz silinecek ve program varsayılanlarına dönülecek.</p>
                    <p className="text-[11px] text-red-600">Bu işlem geri alınabilir — sıfırlama sonrası önceki tercihlerinize dönebilirsiniz.</p>
                    <div className="flex gap-2">
                        <Button
                            onClick={handleReset}
                            disabled={resetting}
                            size="sm"
                            className="bg-red-600 hover:bg-red-700 text-white text-[12px] h-8"
                        >
                            {resetting ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sıfırlanıyor...</> : "Evet, Sıfırla"}
                        </Button>
                        <Button
                            onClick={() => setShowResetConfirm(false)}
                            size="sm"
                            variant="outline"
                            className="text-[12px] h-8"
                        >
                            Vazgeç
                        </Button>
                    </div>
                </div>
            )}

            {/* Bulk Score Bar */}
            {bulkMode && selectedIds.size > 0 && (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-amber-50 border border-amber-200">
                    <span className="text-[11px] text-amber-800 font-medium shrink-0">{selectedIds.size} yemek seçili →</span>
                    <input
                        type="number"
                        min={0}
                        max={10}
                        value={bulkScore}
                        onChange={e => setBulkScore(e.target.value)}
                        placeholder="Skor"
                        className="w-14 text-center text-[12px] font-bold px-1.5 py-1 rounded-md border border-amber-300 bg-white outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <Button
                        onClick={handleBulkSetScore}
                        disabled={!bulkScore || parseInt(bulkScore) < 0 || parseInt(bulkScore) > 10}
                        size="sm"
                        className="h-7 text-[11px] bg-amber-600 hover:bg-amber-700 text-white px-3"
                    >
                        Uygula
                    </Button>
                </div>
            )}

            {/* Food List */}
            <div className="space-y-px">
                {sortedOverrides.length === 0 ? (
                    <div className="text-center py-6 text-gray-400 text-sm">
                        <Star className="h-6 w-6 mx-auto mb-1.5 text-gray-300" />
                        <p className="text-[12px]">{filterQuery ? "Filtre ile eşleşen yemek yok." : "Henüz özel skor atanmış yemek yok."}</p>
                        {!filterQuery && <p className="text-[10px] mt-0.5">Yukarıdan yemek arayarak skor ekleyebilirsiniz.</p>}
                    </div>
                ) : (
                    sortedOverrides.map(item => {
                        const isExpanded = expandedId === item.foodId && !bulkMode
                        const isSelected = selectedIds.has(item.foodId)
                        return (
                            <div
                                key={item.foodId}
                                className={cn(
                                    "rounded-lg border transition-all",
                                    isExpanded
                                        ? "bg-amber-50/60 border-amber-200 ring-1 ring-amber-200"
                                        : isSelected
                                            ? "bg-amber-50/40 border-amber-200"
                                            : "bg-white border-gray-100"
                                )}
                            >
                                {/* Row */}
                                <div
                                    className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer"
                                    onClick={() => bulkMode && item.isOwn ? toggleSelect(item.foodId) : setExpandedId(isExpanded ? null : item.foodId)}
                                >
                                    {bulkMode && item.isOwn && (
                                        isSelected
                                            ? <CheckSquare className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                                            : <Square className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                                    )}
                                    <span className="flex-1 min-w-0 text-[12px] font-medium leading-tight truncate">{item.name}</span>
                                    <ScoreBadge score={item.score} />
                                    {!bulkMode && (isExpanded ? <ChevronUp className="h-3 w-3 text-gray-400 shrink-0" /> : <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />)}
                                </div>

                                {/* Expanded Controls */}
                                {isExpanded && (
                                    <div className="px-2 pb-2 space-y-1.5">
                                        {/* Score Stepper */}
                                        <div className="flex items-center gap-0.5">
                                            <button
                                                onClick={() => updateScore(item.foodId, item.score - 1)}
                                                disabled={item.score <= 0}
                                                className="h-7 w-7 rounded-md bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition-colors shrink-0"
                                            >
                                                <Minus className="h-3 w-3" />
                                            </button>

                                            <div className="flex items-center gap-px flex-1 justify-center">
                                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
                                                    <button
                                                        key={s}
                                                        onClick={() => updateScore(item.foodId, s)}
                                                        className={cn(
                                                            "h-5 w-5 rounded-full text-[8px] font-bold transition-all",
                                                            item.score === s
                                                                ? s === 0
                                                                    ? "bg-red-500 text-white scale-110"
                                                                    : s <= 3
                                                                        ? "bg-orange-500 text-white scale-110"
                                                                        : s <= 6
                                                                            ? "bg-yellow-500 text-white scale-110"
                                                                            : "bg-emerald-500 text-white scale-110"
                                                                : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                                                        )}
                                                    >
                                                        {s}
                                                    </button>
                                                ))}
                                            </div>

                                            <button
                                                onClick={() => updateScore(item.foodId, item.score + 1)}
                                                disabled={item.score >= 10}
                                                className="h-7 w-7 rounded-md bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition-colors shrink-0"
                                            >
                                                <Plus className="h-3 w-3" />
                                            </button>
                                        </div>

                                        {item.isOwn && (
                                            <button
                                                onClick={() => removeOverride(item.foodId)}
                                                className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700"
                                            >
                                                <Trash2 className="h-2.5 w-2.5" />
                                                Kaldır
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>

            {/* Save Button */}
            {hasChanges && (
                <div className="fixed bottom-20 left-0 right-0 px-4 z-40 md:static md:px-0 md:pt-2">
                    <Button
                        onClick={handleSave}
                        disabled={saving}
                        className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white shadow-lg shadow-amber-200 rounded-xl text-sm font-bold"
                    >
                        {saving ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Kaydediliyor...</>
                        ) : (
                            "Tercihleri Kaydet"
                        )}
                    </Button>
                </div>
            )}
            </div>
            )}

        </div>
    )
}
