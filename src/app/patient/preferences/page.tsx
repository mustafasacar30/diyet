"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Star, Search, Loader2, Trash2, ChevronDown, ChevronUp, Info, Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
    const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

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
                .select('id, food_score_overrides')
                .eq('scope', 'patient')
                .eq('patient_id', patientId)
                .maybeSingle()

            if (patientSettings?.id) setSettingsId(patientSettings.id)

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
        } catch (err) {
            console.error("Error saving overrides:", err)
        } finally {
            setSaving(false)
        }
    }

    // Sort overrides
    const sortedOverrides = [...overrides].sort((a, b) => {
        if (sortMode === 'score-desc') return b.score - a.score
        if (sortMode === 'score-asc') return a.score - b.score
        return a.name.localeCompare(b.name, 'tr')
    })

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto p-2 pb-24 sm:p-4 space-y-3">
            {/* Hero Header */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 px-4 py-4 text-white shadow-lg">
                <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
                <div className="relative z-10 flex items-center gap-3">
                    <div className="h-10 w-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm border border-white/10 shrink-0">
                        <Star className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-base font-bold tracking-tight">Yemek Tercihlerim</h1>
                        <p className="text-[11px] text-amber-100/90 mt-0.5 leading-snug">
                            Yemeklerin öncelik skorlarını ayarlayarak diyet planınızı kişiselleştirin.
                        </p>
                    </div>
                </div>
            </div>

            {/* Guide Toggle */}
            <button
                onClick={() => setShowGuide(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[12px]"
            >
                <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5" />
                    Skor ne anlama gelir?
                </span>
                {showGuide ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showGuide && (
                <div className="px-3 py-2.5 rounded-xl bg-amber-50/50 border border-amber-100 space-y-1.5 text-[11px] text-amber-900">
                    <div className="flex items-center gap-2"><span className="font-bold text-red-600 w-6">0</span> Hiç verilmez (tamamen dışlanır)</div>
                    <div className="flex items-center gap-2"><span className="font-bold text-orange-600 w-6">1-3</span> Az tercih — haftada en fazla 1 kez</div>
                    <div className="flex items-center gap-2"><span className="font-bold text-yellow-600 w-6">4-6</span> Normal — haftada en fazla 2 kez</div>
                    <div className="flex items-center gap-2"><span className="font-bold text-emerald-600 w-6">7-10</span> Çok tercih — haftada 3 keze kadar</div>
                    <p className="text-[10px] text-amber-700 mt-1 italic">
                        Varsayılan skor 5'tir. Diyetisyeniniz veya programınız tarafından ayarlanmış skorlar miras olarak görünür.
                    </p>
                </div>
            )}

            {/* Search */}
            <div className="relative">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-gray-200 shadow-sm focus-within:ring-2 focus-within:ring-amber-300 focus-within:border-amber-300">
                    <Search className="h-4 w-4 text-gray-400 shrink-0" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => handleSearch(e.target.value)}
                        placeholder="Yemek ara ve skor ata..."
                        className="flex-1 text-[13px] outline-none bg-transparent placeholder:text-gray-400"
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

            {/* Sort Toggle */}
            {overrides.length > 0 && (
                <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] text-gray-500">{overrides.length} yemek</span>
                    <button
                        onClick={() => setSortMode(m =>
                            m === 'score-desc' ? 'score-asc' : m === 'score-asc' ? 'name' : 'score-desc'
                        )}
                        className="text-[11px] text-gray-500 hover:text-gray-800 flex items-center gap-1"
                    >
                        {sortMode === 'score-desc' ? 'Skor ↓' : sortMode === 'score-asc' ? 'Skor ↑' : 'İsim A-Z'}
                    </button>
                </div>
            )}

            {/* Food List */}
            <div className="space-y-1">
                {sortedOverrides.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-sm">
                        <Star className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                        <p>Henüz özel skor atanmış yemek yok.</p>
                        <p className="text-[11px] mt-1">Yukarıdan yemek arayarak skor ekleyebilirsiniz.</p>
                    </div>
                ) : (
                    sortedOverrides.map(item => {
                        const isExpanded = expandedId === item.foodId
                        return (
                            <div
                                key={item.foodId}
                                className={cn(
                                    "rounded-xl border transition-all",
                                    isExpanded
                                        ? "bg-amber-50/60 border-amber-200 ring-1 ring-amber-200 shadow-sm"
                                        : "bg-white border-gray-100 hover:border-gray-200"
                                )}
                            >
                                {/* Row */}
                                <div
                                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                                    onClick={() => setExpandedId(isExpanded ? null : item.foodId)}
                                >
                                    <div className="flex-1 min-w-0">
                                        <span className="text-[13px] font-medium leading-tight line-clamp-1">{item.name}</span>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className={cn(
                                                "text-[9px] px-1 py-0.5 rounded",
                                                item.isOwn ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"
                                            )}>
                                                {SOURCE_LABELS[item.source]}
                                            </span>
                                            <FrequencyHint score={item.score} />
                                        </div>
                                    </div>
                                    <ScoreBadge score={item.score} />
                                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                                </div>

                                {/* Expanded Controls */}
                                {isExpanded && (
                                    <div className="px-3 pb-3 space-y-2">
                                        {/* Score Stepper */}
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => updateScore(item.foodId, item.score - 1)}
                                                    disabled={item.score <= 0}
                                                    className="h-8 w-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition-colors"
                                                >
                                                    <Minus className="h-3.5 w-3.5" />
                                                </button>

                                                {/* Score Dots */}
                                                <div className="flex items-center gap-0.5 px-1">
                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
                                                        <button
                                                            key={s}
                                                            onClick={() => updateScore(item.foodId, s)}
                                                            className={cn(
                                                                "h-5 w-5 rounded-full text-[9px] font-bold transition-all",
                                                                item.score === s
                                                                    ? s === 0
                                                                        ? "bg-red-500 text-white scale-125 shadow-sm"
                                                                        : s <= 3
                                                                            ? "bg-orange-500 text-white scale-125 shadow-sm"
                                                                            : s <= 6
                                                                                ? "bg-yellow-500 text-white scale-125 shadow-sm"
                                                                                : "bg-emerald-500 text-white scale-125 shadow-sm"
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
                                                    className="h-8 w-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-50 disabled:opacity-30 transition-colors"
                                                >
                                                    <Plus className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Remove */}
                                        {item.isOwn && (
                                            <button
                                                onClick={() => removeOverride(item.foodId)}
                                                className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 transition-colors"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                                Kaldır (varsayılana dön)
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
    )
}
