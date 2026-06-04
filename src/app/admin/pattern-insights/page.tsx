"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronUp, Filter, Info, Loader2, RefreshCw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"

type ProgramOption = { id: string; name: string }
type PhaseOption = { key: string; label: string; programId: string }
type SeasonOption = { key: string; label: string }

type MetricRow = {
    lhs_food_id: string
    lhs_food_name: string
    lhs_role: string | null
    lhs_category: string | null
    lhs_tags: string[]
    lhs_compatibility_tags: string[]
    rhs_food_id: string
    rhs_food_name: string
    rhs_role: string | null
    rhs_category: string | null
    rhs_tags: string[]
    rhs_compatibility_tags: string[]
    support_count: number
    lhs_count: number
    rhs_count: number
    basket_count: number
    support_rate: number
    confidence: number
    lift: number
}

type ApiResponse = {
    options: {
        programs: ProgramOption[]
        phases: PhaseOption[]
        meals: string[]
        roles: string[]
        categories: string[]
        seasons: SeasonOption[]
        tags: string[]
    }
    summary: {
        basketCount: number
        itemCount: number
        pairCount: number
        filteredMeals: number
        filteredWeeks: number
        dataSource?: "render" | "pool" | "both"
        includePoolUnmatched?: boolean
        unmatchedPoolOccurrences?: number
    }
    metrics: MetricRow[]
    frequency_metrics?: FrequencyMetricRow[]
    error?: string
}

type SortKey =
    | "row_order"
    | "lhs_food_name"
    | "rhs_food_name"
    | "support_count"
    | "support_rate"
    | "confidence"
    | "lift"
    | "lhs_count"
    | "rhs_count"

type SortState = {
    key: SortKey | null
    direction: "asc" | "desc" | null
}

type RangeFilter = {
    min: string
    max: string
}

type NumericRangeMap = {
    support_count: RangeFilter
    support_rate: RangeFilter
    confidence: RangeFilter
    lift: RangeFilter
    lhs_count: RangeFilter
    rhs_count: RangeFilter
}

type CandidatePresetKey = "explore" | "safe" | "global"
type GeneralizationMode = "tag" | "name_contains" | "tag_or_name"

type GeneralizedSuggestion = {
    id: string
    mode: "tag" | "name_contains"
    trigger: string
    outcome: string
    support: number
    rowCount: number
    confidence: number
    lift: number
}

type FrequencyMetricRow = {
    basis_type: "role" | "category" | "tag" | "name_contains"
    basis_value: string
    weeks_with_item: number
    total_weeks: number
    week_support_rate: number
    avg_per_week: number
    median_per_week: number
    dominant_weekly_count: number
    dominant_weekly_rate: number
    total_occurrences: number
    top_meal_time: string | null
    top_meal_rate: number
    suggested_min_weekly: number
    suggested_max_weekly: number
}

type GeneralizedSortKey = "mode" | "trigger" | "outcome" | "support" | "confidence" | "lift" | "rowCount"
type FrequencySortKey =
    | "basis_type"
    | "basis_value"
    | "weeks_with_item"
    | "week_support_rate"
    | "avg_per_week"
    | "median_per_week"
    | "dominant_weekly_count"
    | "dominant_weekly_rate"
    | "total_occurrences"
    | "top_meal_rate"

type GeneralizedSortState = { key: GeneralizedSortKey; direction: "asc" | "desc" }
type FrequencySortState = { key: FrequencySortKey; direction: "asc" | "desc" }

type PatternInsightsSettings = {
    ignored_terms?: string
    frequency_ignored_terms?: string
}

const GENERALIZATION_MODE_LABELS: Record<GeneralizationMode, string> = {
    tag: "Sadece Tag",
    name_contains: "Sadece Isim Kelimesi",
    tag_or_name: "Tag + Isim (Hibrit)",
}

const FREQUENCY_BASIS_LABELS: Record<FrequencyMetricRow["basis_type"], string> = {
    role: "Rol",
    category: "Kategori",
    tag: "Tag",
    name_contains: "Isim Kelimesi",
}

const DEFAULT_IGNORED_TERMS = "keto, ketojenik, lowcarb, low carb, low-carb, eliminasyonlu"
const DEFAULT_FREQUENCY_IGNORED_TERMS = [
    "keto",
    "lowcarb",
    "low carb",
    "ketojenik",
    "1adet",
    "1dilim",
    "alta",
    "arasina",
    "arkali",
    "arpa",
    "atesli",
    "atışitırmalık",
    "atistirmalik",
    "avuc",
    "bagli",
    "bardagi",
    "ayildi",
    "begendi",
    "damla",
    "diger",
    "dilim",
    "dilimleri",
    "dolgulu",
    "edilmis",
    "ekleyin",
    "ekleyin1",
    "ekleyip",
    "eritilmis",
    "etler",
    "ezilmis",
    "fazulye",
    "firinlanacak",
    "icin",
    "imam",
    "ince",
    "istege",
    "istenilen",
    "kapama",
    "kare",
    "karistirin",
    "karistirip",
    "kasik",
    "kasigi",
    "kirmizi",
    "kucuk",
    "oglen",
    "olcek",
    "onlu",
    "pisirelim",
    "pisirin",
    "s salatalik",
    "sabah",
    "sade",
    "salataliki salata",
    "salatasinin",
    "soteleyelim",
    "stediginiz",
    "tabagimizi",
    "tabanli",
    "tavayi",
    "tostlar",
    "usulu",
    "uzerine",
    "yapimi",
    "yaglayarak",
    "yagi",
    "yada",
    "yaglamak",
    "yarim",
    "yerine",
    "yerlestirin",
    "z yagi",
].join(", ")

const PATTERN_SETTINGS_KEY = "pattern_insights_settings"
const PATTERN_INSIGHTS_PAGE_CACHE_KEY = "pattern_insights_page_cache_v1"

type PatternInsightsPageCache = {
    data: ApiResponse | null
    filters: {
        selectedPrograms: string[]
        selectedPhases: string[]
        selectedMeals: string[]
        selectedRoles: string[]
        selectedCategories: string[]
        selectedTags: string[]
        dataSourceMode: "both" | "render" | "pool"
        includePoolUnmatched: boolean
        weekStart: string
        weekEnd: string
        minSupport: string
        minConfidence: string
        limit: string
        seasonMonthStart: string
        seasonMonthEnd: string
    }
    ui: {
        showFilters: boolean
        showQuickGuide: boolean
        activeInsightTab: "generalized" | "frequency" | "table-filters"
    }
    savedAt: number
}

const CANDIDATE_PRESETS: Record<
    CandidatePresetKey,
    { label: string; support: number; confidence: number; lift: number; helper: string }
> = {
    explore: {
        label: "Ilk Kesif",
        support: 3,
        confidence: 0.1,
        lift: 1.2,
        helper: "Min Support 3+, Min Confidence 0.10+, Lift > 1.2",
    },
    safe: {
        label: "Guvenli Kural Adayi",
        support: 8,
        confidence: 0.2,
        lift: 1.5,
        helper: "Min Support 8+, Min Confidence 0.20+, Lift > 1.5",
    },
    global: {
        label: "Cok Guvenli / Global",
        support: 15,
        confidence: 0.3,
        lift: 1.8,
        helper: "Min Support 15+, Min Confidence 0.30+, Lift > 1.8",
    },
}

const EMPTY_RANGE: RangeFilter = { min: "", max: "" }
const TR_STOPWORDS = new Set([
    "ve",
    "ile",
    "bir",
    "adet",
    "gram",
    "gr",
    "orta",
    "kucuk",
    "buyuk",
    "yemegi",
    "yemek",
    "tane",
    "icin",
    "veya",
    "ya",
    "da",
    "ile",
    "saat",
    "tercihen",
    "tatli",
    "kasigi",
    "kasik",
    "yemek",
    "corba",
])

function normalizeText(value: string) {
    return value.toLocaleLowerCase("tr-TR")
}

function parseNumberish(raw: string): number | undefined {
    const normalized = raw.trim().replace(",", ".")
    if (!normalized) return undefined
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) return undefined
    return parsed
}

function parseRateValue(raw: string): number | undefined {
    const parsed = parseNumberish(raw)
    if (parsed === undefined) return undefined
    if (parsed > 1) return parsed / 100
    return parsed
}

function toPercent(value: number) {
    return `%${(value * 100).toFixed(1)}`
}

function canonicalTerm(value: string) {
    return normalizeText(value).replace(/[\s\-_]+/g, "").trim()
}

function toggleArrayValue(arr: string[], value: string) {
    if (arr.includes(value)) return arr.filter(v => v !== value)
    return [...arr, value]
}

function headerSortIcon(sort: SortState, key: SortKey) {
    if (sort.key !== key || !sort.direction) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    if (sort.direction === "asc") return <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
    return <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
}

function simpleSortIcon(direction: "asc" | "desc") {
    return direction === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
    ) : (
        <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
    )
}

function matchesAnyTag(tags: string[], selected: string[]) {
    if (selected.length === 0) return true
    const set = new Set(tags.map(t => normalizeText(t)))
    return selected.some(sel => set.has(normalizeText(sel)))
}

function buildExplanation(row: MetricRow) {
    const supportPct = (row.support_rate * 100).toFixed(1)
    const confPct = (row.confidence * 100).toFixed(1)
    const liftText =
        row.lift >= 1
            ? `${row.rhs_food_name} beklenenin ${row.lift.toFixed(2)} kati kadar daha sik eslik ediyor.`
            : `${row.rhs_food_name} beklenenden daha zayif eslik ediyor (lift ${row.lift.toFixed(2)}).`

    return `${row.lhs_food_name} gecen ${row.lhs_count} sepetin ${row.support_count} tanesinde ${row.rhs_food_name} da var. Bu, destek orani %${supportPct} ve guven (confidence) %${confPct} demek. ${liftText}`
}

function tokenizeFoodName(name: string) {
    return normalizeText(name)
        .replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ\s]/g, " ")
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 4 && !TR_STOPWORDS.has(t))
}

function tokenizeFoodNameSafe(name: string) {
    return normalizeText(name)
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length >= 4 && !TR_STOPWORDS.has(t))
}

function TooltipLabel({ label, helper }: { label: string; helper: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div className="inline-flex items-center gap-1 cursor-help">
                    <span>{label}</span>
                    <Info className="h-3.5 w-3.5 text-slate-400" />
                </div>
            </TooltipTrigger>
            <TooltipContent>{helper}</TooltipContent>
        </Tooltip>
    )
}

function MultiSelectDropdown({
    title,
    options,
    selected,
    onToggle,
    buttonClassName,
}: {
    title: string
    options: { value: string; label: string }[]
    selected: string[]
    onToggle: (value: string) => void
    buttonClassName?: string
}) {
    const [query, setQuery] = useState("")
    const filtered = useMemo(() => {
        const q = normalizeText(query.trim())
        if (!q) return options
        return options.filter(option => normalizeText(option.label).includes(q))
    }, [options, query])

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className={cn("h-9 min-w-[170px] justify-between gap-2 bg-white", buttonClassName)}
                >
                    <span className="truncate text-left">{title}</span>
                    <span className="inline-flex items-center gap-1">
                        {selected.length > 0 && (
                            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                                {selected.length}
                            </span>
                        )}
                        <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-0">
                <div className="flex items-center justify-between border-b px-3 py-2">
                    <p className="text-sm font-semibold">{title}</p>
                    <button
                        type="button"
                        onClick={() => options.forEach(o => selected.includes(o.value) && onToggle(o.value))}
                        className="text-xs text-slate-500 hover:text-slate-700"
                    >
                        Temizle
                    </button>
                </div>

                <div className="border-b p-2">
                    <Input
                        className="h-8"
                        placeholder="Ara..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                </div>

                <ScrollArea className="h-56">
                    <div className="space-y-1 p-2">
                        {filtered.map(option => (
                            <label key={option.value} className="flex items-start gap-2 text-sm cursor-pointer rounded px-1 py-1 hover:bg-slate-50">
                                <Checkbox
                                    checked={selected.includes(option.value)}
                                    onCheckedChange={checked => {
                                        if (checked === true) onToggle(option.value)
                                        if (checked === false && selected.includes(option.value)) onToggle(option.value)
                                    }}
                                    className="mt-0.5"
                                />
                                <span className="leading-tight">{option.label}</span>
                            </label>
                        ))}
                        {filtered.length === 0 && <p className="text-xs text-slate-400 p-1">Sonuc yok</p>}
                    </div>
                </ScrollArea>

                <div className="border-t px-3 py-1.5 text-xs text-slate-500">{selected.length} secili</div>
            </PopoverContent>
        </Popover>
    )
}

export default function PatternInsightsPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [data, setData] = useState<ApiResponse | null>(null)
    const [cacheHydrated, setCacheHydrated] = useState(false)
    const [hasRestoredData, setHasRestoredData] = useState(false)

    const [showFilters, setShowFilters] = useState(true)
    const [showQuickGuide, setShowQuickGuide] = useState(false)
    const [activeInsightTab, setActiveInsightTab] = useState<"generalized" | "frequency" | "table-filters">("generalized")
    const [showOnlyCandidates, setShowOnlyCandidates] = useState(false)
    const [candidatePreset, setCandidatePreset] = useState<CandidatePresetKey>("safe")
    const [generalizationMode, setGeneralizationMode] = useState<GeneralizationMode>("tag")
    const [showGeneralizedOnlyCandidates, setShowGeneralizedOnlyCandidates] = useState(true)
    const [ignoredTermsInput, setIgnoredTermsInput] = useState(DEFAULT_IGNORED_TERMS)
    const [generalizedSort, setGeneralizedSort] = useState<GeneralizedSortState>({ key: "support", direction: "desc" })
    const [generalizedTriggerSearch, setGeneralizedTriggerSearch] = useState("")
    const [generalizedOutcomeSearch, setGeneralizedOutcomeSearch] = useState("")
    const [generalizedRanges, setGeneralizedRanges] = useState({
        support: { ...EMPTY_RANGE },
        confidence: { ...EMPTY_RANGE },
        lift: { ...EMPTY_RANGE },
        rowCount: { ...EMPTY_RANGE },
    })

    const [frequencySort, setFrequencySort] = useState<FrequencySortState>({ key: "total_occurrences", direction: "desc" })
    const [frequencySearch, setFrequencySearch] = useState("")
    const [frequencyTypeFilter, setFrequencyTypeFilter] = useState<string[]>([])
    const [frequencyIgnoredTermsInput, setFrequencyIgnoredTermsInput] = useState(DEFAULT_FREQUENCY_IGNORED_TERMS)
    const [frequencyRanges, setFrequencyRanges] = useState({
        weeks_with_item: { ...EMPTY_RANGE },
        week_support_rate: { ...EMPTY_RANGE },
        avg_per_week: { ...EMPTY_RANGE },
        median_per_week: { ...EMPTY_RANGE },
        dominant_weekly_rate: { ...EMPTY_RANGE },
        total_occurrences: { ...EMPTY_RANGE },
    })
    const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)
    const [draftNotice, setDraftNotice] = useState<string | null>(null)
    const [settingsNotice, setSettingsNotice] = useState<string | null>(null)
    const [savingSettings, setSavingSettings] = useState(false)

    const [sort, setSort] = useState<SortState>({ key: "support_count", direction: "desc" })

    const [selectedPrograms, setSelectedPrograms] = useState<string[]>([])
    const [selectedPhases, setSelectedPhases] = useState<string[]>([])
    const [selectedMeals, setSelectedMeals] = useState<string[]>([])
    const [selectedRoles, setSelectedRoles] = useState<string[]>([])
    const [selectedCategories, setSelectedCategories] = useState<string[]>([])
    const [selectedTags, setSelectedTags] = useState<string[]>([])
    const [dataSourceMode, setDataSourceMode] = useState<"both" | "render" | "pool">("both")
    const [includePoolUnmatched, setIncludePoolUnmatched] = useState(false)

    const [weekStart, setWeekStart] = useState("1")
    const [weekEnd, setWeekEnd] = useState("26")
    const [minSupport, setMinSupport] = useState("3")
    const [minConfidence, setMinConfidence] = useState("0,1")
    const [limit, setLimit] = useState("120")
    const [seasonMonthStart, setSeasonMonthStart] = useState("")
    const [seasonMonthEnd, setSeasonMonthEnd] = useState("")

    const [triggerSearch, setTriggerSearch] = useState("")
    const [suggestionSearch, setSuggestionSearch] = useState("")
    const [triggerRolesFilter, setTriggerRolesFilter] = useState<string[]>([])
    const [suggestionRolesFilter, setSuggestionRolesFilter] = useState<string[]>([])
    const [triggerCategoriesFilter, setTriggerCategoriesFilter] = useState<string[]>([])
    const [suggestionCategoriesFilter, setSuggestionCategoriesFilter] = useState<string[]>([])
    const [triggerTagsFilter, setTriggerTagsFilter] = useState<string[]>([])
    const [suggestionTagsFilter, setSuggestionTagsFilter] = useState<string[]>([])

    const [ranges, setRanges] = useState<NumericRangeMap>({
        support_count: { ...EMPTY_RANGE },
        support_rate: { ...EMPTY_RANGE },
        confidence: { ...EMPTY_RANGE },
        lift: { ...EMPTY_RANGE },
        lhs_count: { ...EMPTY_RANGE },
        rhs_count: { ...EMPTY_RANGE },
    })

    const fetchData = async () => {
        setLoading(true)
        setError(null)
        setDraftNotice(null)
        try {
            const qs = new URLSearchParams()
            if (selectedPrograms.length > 0) qs.set("program_ids", selectedPrograms.join(","))
            if (selectedPhases.length > 0) qs.set("phase_keys", selectedPhases.join(","))
            if (selectedMeals.length > 0) qs.set("meal_times", selectedMeals.join(","))
            if (selectedRoles.length > 0) qs.set("food_roles", selectedRoles.join(","))
            if (selectedCategories.length > 0) qs.set("food_categories", selectedCategories.join(","))
            qs.set("data_source", dataSourceMode)
            if (includePoolUnmatched) qs.set("include_pool_unmatched", "1")

            qs.set("week_start", String(parseNumberish(weekStart) ?? 1))
            qs.set("week_end", String(parseNumberish(weekEnd) ?? 26))
            qs.set("min_support", String(parseNumberish(minSupport) ?? 3))
            qs.set("min_confidence", String(parseRateValue(minConfidence) ?? 0.1))
            qs.set("limit", String(parseNumberish(limit) ?? 120))
            const seasonStartNumber = parseNumberish(seasonMonthStart)
            const seasonEndNumber = parseNumberish(seasonMonthEnd)
            if (seasonStartNumber && seasonStartNumber >= 1 && seasonStartNumber <= 12) {
                qs.set("season_start_month", String(seasonStartNumber))
            }
            if (seasonEndNumber && seasonEndNumber >= 1 && seasonEndNumber <= 12) {
                qs.set("season_end_month", String(seasonEndNumber))
            }

            const response = await fetch(`/api/admin/pattern-insights?${qs.toString()}`, {
                method: "GET",
                cache: "no-store",
            })

            const json = (await response.json()) as ApiResponse
            if (!response.ok) {
                throw new Error(json.error || "Oruntu verileri alinamadi.")
            }

            setData(json)
        } catch (e: any) {
            setError(e?.message || "Beklenmeyen bir hata oldu.")
        } finally {
            setLoading(false)
        }
    }

    const loadPatternSettings = async () => {
        try {
            const { data: row, error: settingsError } = await supabase
                .from("app_settings")
                .select("value")
                .eq("key", PATTERN_SETTINGS_KEY)
                .maybeSingle()

            if (settingsError) {
                console.error("Pattern settings load error:", settingsError)
                return
            }

            const value = (row?.value || {}) as PatternInsightsSettings
            if (typeof value.ignored_terms === "string" && value.ignored_terms.trim()) {
                setIgnoredTermsInput(value.ignored_terms)
            }
            if (
                typeof value.frequency_ignored_terms === "string" &&
                value.frequency_ignored_terms.trim()
            ) {
                setFrequencyIgnoredTermsInput(value.frequency_ignored_terms)
            }
        } catch (err) {
            console.error("Pattern settings load exception:", err)
        }
    }

    const savePatternSettings = async (patch?: Partial<PatternInsightsSettings>) => {
        const payload: PatternInsightsSettings = {
            ignored_terms: patch?.ignored_terms ?? ignoredTermsInput,
            frequency_ignored_terms: patch?.frequency_ignored_terms ?? frequencyIgnoredTermsInput,
        }

        setSavingSettings(true)
        setSettingsNotice(null)
        try {
            const { error: settingsError } = await supabase.from("app_settings").upsert({
                key: PATTERN_SETTINGS_KEY,
                value: payload,
                updated_at: new Date().toISOString(),
            })

            if (settingsError) {
                setSettingsNotice(`Ayar kaydetme hatasi: ${settingsError.message}`)
                return false
            }

            if (patch?.ignored_terms !== undefined) {
                setIgnoredTermsInput(patch.ignored_terms)
            }
            if (patch?.frequency_ignored_terms !== undefined) {
                setFrequencyIgnoredTermsInput(patch.frequency_ignored_terms)
            }

            setSettingsNotice("Ihmal listesi ayarlari kaydedildi.")
            return true
        } catch (err: any) {
            setSettingsNotice(`Ayar kaydetme hatasi: ${err?.message || "Bilinmeyen hata"}`)
            return false
        } finally {
            setSavingSettings(false)
        }
    }

    useEffect(() => {
        loadPatternSettings()

        if (typeof window === "undefined") {
            setCacheHydrated(true)
            return
        }

        try {
            const raw = window.sessionStorage.getItem(PATTERN_INSIGHTS_PAGE_CACHE_KEY)
            if (!raw) {
                setCacheHydrated(true)
                return
            }

            const parsed = JSON.parse(raw) as Partial<PatternInsightsPageCache>
            const cachedData = parsed?.data ?? null
            const cachedFilters = parsed?.filters
            const cachedUi = parsed?.ui

            if (cachedFilters) {
                setSelectedPrograms(cachedFilters.selectedPrograms || [])
                setSelectedPhases(cachedFilters.selectedPhases || [])
                setSelectedMeals(cachedFilters.selectedMeals || [])
                setSelectedRoles(cachedFilters.selectedRoles || [])
                setSelectedCategories(cachedFilters.selectedCategories || [])
                setSelectedTags(cachedFilters.selectedTags || [])
                setDataSourceMode(cachedFilters.dataSourceMode || "both")
                setIncludePoolUnmatched(Boolean(cachedFilters.includePoolUnmatched))
                setWeekStart(cachedFilters.weekStart || "1")
                setWeekEnd(cachedFilters.weekEnd || "26")
                setMinSupport(cachedFilters.minSupport || "3")
                setMinConfidence(cachedFilters.minConfidence || "0,1")
                setLimit(cachedFilters.limit || "120")
                setSeasonMonthStart(cachedFilters.seasonMonthStart || "")
                setSeasonMonthEnd(cachedFilters.seasonMonthEnd || "")
            }

            if (cachedUi) {
                setShowFilters(Boolean(cachedUi.showFilters))
                setShowQuickGuide(Boolean(cachedUi.showQuickGuide))
                setActiveInsightTab(cachedUi.activeInsightTab || "generalized")
            }

            if (cachedData) {
                setData(cachedData)
                setHasRestoredData(true)
                setError(null)
                setLoading(false)
            }
        } catch {
            // ignore broken cache and fall back to network fetch
        } finally {
            setCacheHydrated(true)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!cacheHydrated) return
        if (hasRestoredData) return
        fetchData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cacheHydrated, hasRestoredData])

    useEffect(() => {
        if (!cacheHydrated || typeof window === "undefined") return

        const payload: PatternInsightsPageCache = {
            data,
            filters: {
                selectedPrograms,
                selectedPhases,
                selectedMeals,
                selectedRoles,
                selectedCategories,
                selectedTags,
                dataSourceMode,
                includePoolUnmatched,
                weekStart,
                weekEnd,
                minSupport,
                minConfidence,
                limit,
                seasonMonthStart,
                seasonMonthEnd,
            },
            ui: {
                showFilters,
                showQuickGuide,
                activeInsightTab,
            },
            savedAt: Date.now(),
        }

        try {
            window.sessionStorage.setItem(PATTERN_INSIGHTS_PAGE_CACHE_KEY, JSON.stringify(payload))
        } catch {
            // ignore quota/cache errors
        }
    }, [
        cacheHydrated,
        data,
        selectedPrograms,
        selectedPhases,
        selectedMeals,
        selectedRoles,
        selectedCategories,
        selectedTags,
        dataSourceMode,
        includePoolUnmatched,
        weekStart,
        weekEnd,
        minSupport,
        minConfidence,
        limit,
        seasonMonthStart,
        seasonMonthEnd,
        showFilters,
        showQuickGuide,
        activeInsightTab,
    ])

    const rows = useMemo(() => {
        return (data?.metrics || []).map((row, idx) => ({
            ...row,
            row_order: idx + 1,
            row_key: `${row.lhs_food_id}__${row.rhs_food_id}__${idx}`,
        }))
    }, [data?.metrics])

    const presetThreshold = CANDIDATE_PRESETS[candidatePreset]

    const ignoredTerms = useMemo(() => {
        return ignoredTermsInput
            .split(/[\n,]+/)
            .map(v => canonicalTerm(v))
            .filter(Boolean)
    }, [ignoredTermsInput])

    const frequencyIgnoredTerms = useMemo(() => {
        return frequencyIgnoredTermsInput
            .split(/[\n,]+/)
            .map(v => canonicalTerm(v))
            .filter(Boolean)
    }, [frequencyIgnoredTermsInput])

    const filteredRows = useMemo(() => {
        let items = [...rows]

        if (triggerSearch.trim()) {
            const q = normalizeText(triggerSearch.trim())
            items = items.filter(r => normalizeText(r.lhs_food_name).includes(q))
        }

        if (suggestionSearch.trim()) {
            const q = normalizeText(suggestionSearch.trim())
            items = items.filter(r => normalizeText(r.rhs_food_name).includes(q))
        }

        if (triggerRolesFilter.length > 0) {
            items = items.filter(r => triggerRolesFilter.includes(String(r.lhs_role || "")))
        }

        if (suggestionRolesFilter.length > 0) {
            items = items.filter(r => suggestionRolesFilter.includes(String(r.rhs_role || "")))
        }

        if (triggerCategoriesFilter.length > 0) {
            items = items.filter(r => triggerCategoriesFilter.includes(String(r.lhs_category || "")))
        }

        if (suggestionCategoriesFilter.length > 0) {
            items = items.filter(r => suggestionCategoriesFilter.includes(String(r.rhs_category || "")))
        }

        if (triggerTagsFilter.length > 0) {
            items = items.filter(r => matchesAnyTag([...(r.lhs_tags || []), ...(r.lhs_compatibility_tags || [])], triggerTagsFilter))
        }

        if (suggestionTagsFilter.length > 0) {
            items = items.filter(r => matchesAnyTag([...(r.rhs_tags || []), ...(r.rhs_compatibility_tags || [])], suggestionTagsFilter))
        }

        if (selectedTags.length > 0) {
            items = items.filter(r =>
                matchesAnyTag(
                    [
                        ...(r.lhs_tags || []),
                        ...(r.rhs_tags || []),
                        ...(r.lhs_compatibility_tags || []),
                        ...(r.rhs_compatibility_tags || []),
                    ],
                    selectedTags
                )
            )
        }

        if (showOnlyCandidates) {
            items = items.filter(
                r =>
                    r.support_count >= presetThreshold.support &&
                    r.confidence >= presetThreshold.confidence &&
                    r.lift > presetThreshold.lift
            )
        }

        const applyRange = (value: number, key: keyof NumericRangeMap) => {
            const minValue =
                key === "support_rate" || key === "confidence"
                    ? parseRateValue(ranges[key].min)
                    : parseNumberish(ranges[key].min)
            const maxValue =
                key === "support_rate" || key === "confidence"
                    ? parseRateValue(ranges[key].max)
                    : parseNumberish(ranges[key].max)
            if (minValue !== undefined && value < minValue) return false
            if (maxValue !== undefined && value > maxValue) return false
            return true
        }

        items = items.filter(
            r =>
                applyRange(r.support_count, "support_count") &&
                applyRange(r.support_rate, "support_rate") &&
                applyRange(r.confidence, "confidence") &&
                applyRange(r.lift, "lift") &&
                applyRange(r.lhs_count, "lhs_count") &&
                applyRange(r.rhs_count, "rhs_count")
        )

        const sorted = [...items]
        const sortKey = sort.key ?? "row_order"
        const sortDirection = sort.direction ?? "asc"

        sorted.sort((a: any, b: any) => {
            const av = a[sortKey]
            const bv = b[sortKey]

            let cmp = 0
            if (typeof av === "string" && typeof bv === "string") {
                cmp = av.localeCompare(bv, "tr")
            } else {
                cmp = Number(av) - Number(bv)
            }

            return sortDirection === "asc" ? cmp : -cmp
        })

        return sorted
    }, [
        rows,
        triggerSearch,
        suggestionSearch,
        triggerRolesFilter,
        suggestionRolesFilter,
        triggerCategoriesFilter,
        suggestionCategoriesFilter,
        triggerTagsFilter,
        suggestionTagsFilter,
        selectedTags,
        showOnlyCandidates,
        presetThreshold,
        ranges,
        sort,
    ])

    const generalizedSuggestions = useMemo<GeneralizedSuggestion[]>(() => {
        const useTag = generalizationMode === "tag" || generalizationMode === "tag_or_name"
        const useName = generalizationMode === "name_contains" || generalizationMode === "tag_or_name"

        type Accumulator = {
            id: string
            mode: "tag" | "name_contains"
            trigger: string
            outcome: string
            support: number
            rowCount: number
            weightedConfidence: number
            weightedLift: number
            totalWeight: number
        }

        const map = new Map<string, Accumulator>()
        const shouldUseRow = (row: MetricRow) => {
            if (!showGeneralizedOnlyCandidates) return true
            return (
                row.support_count >= presetThreshold.support &&
                row.confidence >= presetThreshold.confidence &&
                row.lift > presetThreshold.lift
            )
        }

        const isIgnored = (value: string) => {
            const canonical = canonicalTerm(value)
            if (!canonical) return true
            return ignoredTerms.some(term => canonical === term || canonical.includes(term) || term.includes(canonical))
        }

        const add = (mode: "tag" | "name_contains", trigger: string, outcome: string, row: MetricRow) => {
            const t = normalizeText(trigger)
            const o = normalizeText(outcome)
            if (!t || !o || t === o) return
            if (isIgnored(t) || isIgnored(o)) return

            const key = `${mode}::${t}=>${o}`
            const existing = map.get(key)
            if (!existing) {
                map.set(key, {
                    id: key,
                    mode,
                    trigger: t,
                    outcome: o,
                    support: row.support_count,
                    rowCount: 1,
                    weightedConfidence: row.confidence * row.support_count,
                    weightedLift: row.lift * row.support_count,
                    totalWeight: row.support_count,
                })
                return
            }

            existing.support += row.support_count
            existing.rowCount += 1
            existing.weightedConfidence += row.confidence * row.support_count
            existing.weightedLift += row.lift * row.support_count
            existing.totalWeight += row.support_count
        }

        for (const row of filteredRows) {
            if (!shouldUseRow(row)) continue

            if (useTag) {
                const lhsTags = Array.from(new Set([...(row.lhs_tags || []), ...(row.lhs_compatibility_tags || [])]))
                const rhsTags = Array.from(new Set([...(row.rhs_tags || []), ...(row.rhs_compatibility_tags || [])]))
                lhsTags.forEach(lhsTag => rhsTags.forEach(rhsTag => add("tag", lhsTag, rhsTag, row)))
            }

            if (useName) {
                const lhsTokens = Array.from(new Set(tokenizeFoodNameSafe(row.lhs_food_name)))
                const rhsTokens = Array.from(new Set(tokenizeFoodNameSafe(row.rhs_food_name)))
                lhsTokens.forEach(lhsToken => rhsTokens.forEach(rhsToken => add("name_contains", lhsToken, rhsToken, row)))
            }
        }

        return Array.from(map.values())
            .map(item => ({
                id: item.id,
                mode: item.mode,
                trigger: item.trigger,
                outcome: item.outcome,
                support: item.support,
                rowCount: item.rowCount,
                confidence: item.totalWeight > 0 ? item.weightedConfidence / item.totalWeight : 0,
                lift: item.totalWeight > 0 ? item.weightedLift / item.totalWeight : 0,
            }))
            .filter(item => item.support >= Math.max(2, presetThreshold.support))
            .sort((a, b) => {
                if (b.support !== a.support) return b.support - a.support
                if (b.confidence !== a.confidence) return b.confidence - a.confidence
                return b.lift - a.lift
            })
            .slice(0, 500)
    }, [filteredRows, generalizationMode, ignoredTerms, presetThreshold, showGeneralizedOnlyCandidates])

    const generalizedRows = useMemo(() => {
        const applyRange = (value: number, key: keyof typeof generalizedRanges) => {
            const minValue =
                key === "confidence"
                    ? parseRateValue(generalizedRanges[key].min)
                    : parseNumberish(generalizedRanges[key].min)
            const maxValue =
                key === "confidence"
                    ? parseRateValue(generalizedRanges[key].max)
                    : parseNumberish(generalizedRanges[key].max)
            if (minValue !== undefined && value < minValue) return false
            if (maxValue !== undefined && value > maxValue) return false
            return true
        }

        let items = [...generalizedSuggestions]

        if (generalizedTriggerSearch.trim()) {
            const q = normalizeText(generalizedTriggerSearch.trim())
            items = items.filter(item => normalizeText(item.trigger).includes(q))
        }

        if (generalizedOutcomeSearch.trim()) {
            const q = normalizeText(generalizedOutcomeSearch.trim())
            items = items.filter(item => normalizeText(item.outcome).includes(q))
        }

        items = items.filter(
            item =>
                applyRange(item.support, "support") &&
                applyRange(item.confidence, "confidence") &&
                applyRange(item.lift, "lift") &&
                applyRange(item.rowCount, "rowCount")
        )

        const sortKey = generalizedSort.key
        const direction = generalizedSort.direction
        items.sort((a, b) => {
            let cmp = 0
            if (sortKey === "mode" || sortKey === "trigger" || sortKey === "outcome") {
                cmp = String(a[sortKey]).localeCompare(String(b[sortKey]), "tr")
            } else {
                cmp = Number(a[sortKey]) - Number(b[sortKey])
            }
            return direction === "asc" ? cmp : -cmp
        })

        return items
    }, [
        generalizedSuggestions,
        generalizedSort,
        generalizedTriggerSearch,
        generalizedOutcomeSearch,
        generalizedRanges,
    ])

    const frequencyRows = useMemo(() => {
        let items = [...(data?.frequency_metrics || [])]

        const applyRange = (value: number, key: keyof typeof frequencyRanges) => {
            const minValue =
                key === "week_support_rate" || key === "dominant_weekly_rate"
                    ? parseRateValue(frequencyRanges[key].min)
                    : parseNumberish(frequencyRanges[key].min)
            const maxValue =
                key === "week_support_rate" || key === "dominant_weekly_rate"
                    ? parseRateValue(frequencyRanges[key].max)
                    : parseNumberish(frequencyRanges[key].max)
            if (minValue !== undefined && value < minValue) return false
            if (maxValue !== undefined && value > maxValue) return false
            return true
        }

        if (frequencySearch.trim()) {
            const q = normalizeText(frequencySearch.trim())
            items = items.filter(item => normalizeText(item.basis_value).includes(q))
        }

        if (frequencyTypeFilter.length > 0) {
            items = items.filter(item => frequencyTypeFilter.includes(item.basis_type))
        }

        if (frequencyIgnoredTerms.length > 0) {
            items = items.filter(item => {
                const canonical = canonicalTerm(item.basis_value)
                if (!canonical) return false
                return !frequencyIgnoredTerms.some(
                    term => canonical === term || canonical.includes(term) || term.includes(canonical)
                )
            })
        }

        items = items.filter(
            item =>
                applyRange(item.weeks_with_item, "weeks_with_item") &&
                applyRange(item.week_support_rate, "week_support_rate") &&
                applyRange(item.avg_per_week, "avg_per_week") &&
                applyRange(item.median_per_week, "median_per_week") &&
                applyRange(item.dominant_weekly_rate, "dominant_weekly_rate") &&
                applyRange(item.total_occurrences, "total_occurrences")
        )

        const key = frequencySort.key
        const direction = frequencySort.direction
        items.sort((a, b) => {
            let cmp = 0
            if (key === "basis_type" || key === "basis_value") {
                cmp = String(a[key]).localeCompare(String(b[key]), "tr")
            } else {
                cmp = Number(a[key]) - Number(b[key])
            }
            return direction === "asc" ? cmp : -cmp
        })

        return items
    }, [data?.frequency_metrics, frequencySearch, frequencyTypeFilter, frequencyIgnoredTerms, frequencyRanges, frequencySort])

    const toggleSort = (key: SortKey) => {
        setSort(current => {
            if (current.key !== key) return { key, direction: "asc" }
            if (current.direction === "asc") return { key, direction: "desc" }
            if (current.direction === "desc") return { key: null, direction: null }
            return { key, direction: "asc" }
        })
    }

    const setRange = (key: keyof NumericRangeMap, side: keyof RangeFilter, value: string) => {
        setRanges(prev => ({ ...prev, [key]: { ...prev[key], [side]: value } }))
    }

    const toggleGeneralizedSort = (key: GeneralizedSortKey) => {
        setGeneralizedSort(current => {
            if (current.key !== key) return { key, direction: "asc" }
            return { key, direction: current.direction === "asc" ? "desc" : "asc" }
        })
    }

    const setGeneralizedRange = (
        key: keyof typeof generalizedRanges,
        side: keyof RangeFilter,
        value: string
    ) => {
        setGeneralizedRanges(prev => ({ ...prev, [key]: { ...prev[key], [side]: value } }))
    }

    const clearGeneralizedFilters = () => {
        setGeneralizedTriggerSearch("")
        setGeneralizedOutcomeSearch("")
        setGeneralizedRanges({
            support: { ...EMPTY_RANGE },
            confidence: { ...EMPTY_RANGE },
            lift: { ...EMPTY_RANGE },
            rowCount: { ...EMPTY_RANGE },
        })
        setGeneralizedSort({ key: "support", direction: "desc" })
    }

    const toggleFrequencySort = (key: FrequencySortKey) => {
        setFrequencySort(current => {
            if (current.key !== key) return { key, direction: "asc" }
            return { key, direction: current.direction === "asc" ? "desc" : "asc" }
        })
    }

    const setFrequencyRange = (
        key: keyof typeof frequencyRanges,
        side: keyof RangeFilter,
        value: string
    ) => {
        setFrequencyRanges(prev => ({ ...prev, [key]: { ...prev[key], [side]: value } }))
    }

    const clearFrequencyFilters = () => {
        setFrequencySearch("")
        setFrequencyTypeFilter([])
        setFrequencyIgnoredTermsInput(DEFAULT_FREQUENCY_IGNORED_TERMS)
        setFrequencyRanges({
            weeks_with_item: { ...EMPTY_RANGE },
            week_support_rate: { ...EMPTY_RANGE },
            avg_per_week: { ...EMPTY_RANGE },
            median_per_week: { ...EMPTY_RANGE },
            dominant_weekly_rate: { ...EMPTY_RANGE },
            total_occurrences: { ...EMPTY_RANGE },
        })
        setFrequencySort({ key: "total_occurrences", direction: "desc" })
    }

    const clearAllClientFilters = () => {
        setTriggerSearch("")
        setSuggestionSearch("")
        setTriggerRolesFilter([])
        setSuggestionRolesFilter([])
        setTriggerCategoriesFilter([])
        setSuggestionCategoriesFilter([])
        setTriggerTagsFilter([])
        setSuggestionTagsFilter([])
        setSelectedTags([])
        setRanges({
            support_count: { ...EMPTY_RANGE },
            support_rate: { ...EMPTY_RANGE },
            confidence: { ...EMPTY_RANGE },
            lift: { ...EMPTY_RANGE },
            lhs_count: { ...EMPTY_RANGE },
            rhs_count: { ...EMPTY_RANGE },
        })
        setSort({ key: "support_count", direction: "desc" })
    }

    const options = data?.options
    const frequencyTypeOptions = useMemo(
        () =>
            (Object.keys(FREQUENCY_BASIS_LABELS) as FrequencyMetricRow["basis_type"][]).map(type => ({
                value: type,
                label: FREQUENCY_BASIS_LABELS[type],
            })),
        []
    )
    const phaseOptionsFiltered = useMemo(() => {
        const phases = options?.phases || []
        if (selectedPrograms.length === 0) {
            return phases
        }
        const allowed = new Set(selectedPrograms)
        return phases.filter(phase => allowed.has(phase.programId))
    }, [options?.phases, selectedPrograms])

    useEffect(() => {
        const allowedKeys = new Set(phaseOptionsFiltered.map(phase => phase.key))
        setSelectedPhases(prev => {
            const next = prev.filter(key => allowedKeys.has(key))
            return next.length === prev.length ? prev : next
        })
    }, [selectedPrograms, phaseOptionsFiltered])

    const buildRuleDraft = (row: MetricRow & { row_order: number; row_key: string }) => {
        const extractFoodId = (rawId: string) => (rawId.startsWith("food:") ? rawId.replace("food:", "") : null)
        const lhsFoodId = extractFoodId(row.lhs_food_id)
        const rhsFoodId = extractFoodId(row.rhs_food_id)

        if (!lhsFoodId || !rhsFoodId) {
            return null
        }

        const safeName = `${row.lhs_food_name} -> ${row.rhs_food_name}`.slice(0, 120)
        const ruleDraft = {
            name: safeName,
            description: `${row.lhs_food_name} gecen ogunlerde ${row.rhs_food_name} eslesmesini guclendirir.`,
            rule_type: "affinity",
            priority: Math.max(1, Math.min(100, Math.round(row.confidence * 100))),
            is_active: true,
            definition: {
                type: "affinity",
                _source: "pattern_insights",
                data: {
                    trigger: { type: "food_id", value: lhsFoodId },
                    outcome: { type: "food_id", value: rhsFoodId },
                    association: "boost",
                    probability: Math.max(1, Math.min(99, Math.round(row.confidence * 100))),
                    direction: "one-way",
                },
            },
            scope: "global",
            patient_id: null,
            pending_global_approval: false,
            is_ignored: false,
        }
        return ruleDraft
    }

    const copyRuleDraft = async (row: MetricRow & { row_order: number; row_key: string }) => {
        const ruleDraft = buildRuleDraft(row)
        if (!ruleDraft) {
            setDraftNotice("Bu satir custom yemek iceriyor; guvenli taslak icin her iki taraf da veritabaninda kayitli bir food olmalidir.")
            return
        }

        try {
            await navigator.clipboard.writeText(JSON.stringify(ruleDraft, null, 2))
            setDraftNotice("Kural taslagi panoya kopyalandi. Rules ekraninda JSON olarak kullanabilirsiniz.")
        } catch {
            setDraftNotice("Panoya kopyalama basarisiz oldu. Tarayici izinlerini kontrol edin.")
        }
    }

    const openRuleDraftInForm = (row: MetricRow & { row_order: number; row_key: string }) => {
        const ruleDraft = buildRuleDraft(row)
        if (!ruleDraft) {
            setDraftNotice("Bu satir custom yemek iceriyor; form acmak icin her iki taraf da veritabaninda kayitli bir food olmalidir.")
            return
        }
        try {
            localStorage.setItem("pattern_rule_draft", JSON.stringify(ruleDraft))
            router.push("/admin/rules?fromPattern=1")
        } catch {
            setDraftNotice("Taslak forma aktarma sirasinda sorun oldu. Tarayici depolama izinlerini kontrol edin.")
        }
    }

    const buildGeneralizedRuleDraft = (suggestion: GeneralizedSuggestion) => {
        const triggerType = suggestion.mode === "tag" ? "tag" : "name_contains"
        const outcomeType = suggestion.mode === "tag" ? "tag" : "name_contains"
        const confidencePercent = Math.max(1, Math.min(99, Math.round(suggestion.confidence * 100)))
        const safeName = `${suggestion.trigger} -> ${suggestion.outcome}`.slice(0, 120)

        const draft = {
            name: safeName,
            description:
                suggestion.mode === "tag"
                    ? `${suggestion.trigger} etiketi gecen ogunlerde ${suggestion.outcome} etiketini guclendirir.`
                    : `Isminde "${suggestion.trigger}" gecen ogunlerde "${suggestion.outcome}" kelimesini guclendirir.`,
            rule_type: "affinity",
            priority: Math.max(1, Math.min(100, confidencePercent)),
            is_active: true,
            definition: {
                type: "affinity",
                _source: "pattern_insights",
                data: {
                    trigger: { type: triggerType, value: suggestion.trigger },
                    outcome: { type: outcomeType, value: suggestion.outcome },
                    association: "boost",
                    probability: confidencePercent,
                    direction: "one-way",
                },
            },
            scope: "global",
            patient_id: null,
            pending_global_approval: false,
            is_ignored: false,
        }

        return draft
    }

    const copyGeneralizedDraft = async (suggestion: GeneralizedSuggestion) => {
        try {
            const draft = buildGeneralizedRuleDraft(suggestion)
            await navigator.clipboard.writeText(JSON.stringify(draft, null, 2))
            setDraftNotice(`Genellenmis kural taslagi panoya kopyalandi (${suggestion.trigger} -> ${suggestion.outcome}).`)
        } catch {
            setDraftNotice("Panoya kopyalama basarisiz oldu. Tarayici izinlerini kontrol edin.")
        }
    }

    const openGeneralizedDraftInForm = (suggestion: GeneralizedSuggestion) => {
        try {
            const draft = buildGeneralizedRuleDraft(suggestion)
            localStorage.setItem("pattern_rule_draft", JSON.stringify(draft))
            router.push("/admin/rules?fromPattern=1")
        } catch {
            setDraftNotice("Taslak forma aktarma sirasinda sorun oldu. Tarayici depolama izinlerini kontrol edin.")
        }
    }

    const buildFrequencyRuleDraft = (row: FrequencyMetricRow) => {
        const targetType = row.basis_type === "name_contains" ? "name_contains" : row.basis_type
        const scopedMeal = row.top_meal_time && row.top_meal_rate >= 0.75 ? [row.top_meal_time] : undefined
        const priority = Math.max(1, Math.min(100, Math.round(row.week_support_rate * 100)))

        return {
            name: `${FREQUENCY_BASIS_LABELS[row.basis_type]}: ${row.basis_value} haftalik siklik`,
            description: `${row.basis_value} icin haftalik siklik paterni. Ortalama ${row.avg_per_week.toFixed(1)}, onerilen aralik ${row.suggested_min_weekly}-${row.suggested_max_weekly}.`,
            rule_type: "frequency",
            priority,
            is_active: true,
            definition: {
                type: "frequency",
                _source: "pattern_insights",
                data: {
                    target: { type: targetType, value: row.basis_value },
                    period: "weekly",
                    min_count: row.suggested_min_weekly,
                    max_count: row.suggested_max_weekly,
                    scope_meals: scopedMeal,
                },
            },
            scope: "global",
            patient_id: null,
            pending_global_approval: false,
            is_ignored: false,
        }
    }

    const copyFrequencyRuleDraft = async (row: FrequencyMetricRow) => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(buildFrequencyRuleDraft(row), null, 2))
            setDraftNotice(`Siklik kural taslagi panoya kopyalandi (${row.basis_value}).`)
        } catch {
            setDraftNotice("Panoya kopyalama basarisiz oldu. Tarayici izinlerini kontrol edin.")
        }
    }

    const openFrequencyRuleInForm = (row: FrequencyMetricRow) => {
        try {
            localStorage.setItem("pattern_rule_draft", JSON.stringify(buildFrequencyRuleDraft(row)))
            router.push("/admin/rules?fromPattern=1")
        } catch {
            setDraftNotice("Taslak forma aktarma sirasinda sorun oldu. Tarayici depolama izinlerini kontrol edin.")
        }
    }

    return (
        <TooltipProvider>
            <div className="space-y-4 p-4 md:p-6">
                <Tabs value={activeInsightTab} onValueChange={v => setActiveInsightTab(v as "generalized" | "frequency" | "table-filters")} className="gap-3">
                    <TabsList className="h-auto min-h-10 w-full justify-start gap-1 overflow-x-auto bg-slate-100 p-1">
                        <TabsTrigger
                            value="generalized"
                            className="px-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
                        >
                            Ust Seviye Kural Onerileri
                        </TabsTrigger>
                        <TabsTrigger
                            value="frequency"
                            className="px-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
                        >
                            Siklik Kural Adaylari ({frequencyRows.length})
                        </TabsTrigger>
                        <TabsTrigger
                            value="table-filters"
                            className="px-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
                        >
                            Tablo Filtreleri (istemci tarafi)
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="generalized">
                <Card className="py-4">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <CardTitle>Oruntu Analizi</CardTitle>
                                <CardDescription>
                                    Program/faz/ogun filtreleriyle yemek eslesme metriklerini inceleyin.
                                </CardDescription>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Button variant="outline" onClick={() => setShowFilters(v => !v)}>
                                    {showFilters ? <ChevronUp className="h-4 w-4 mr-2" /> : <ChevronDown className="h-4 w-4 mr-2" />}
                                    {showFilters ? "Filtreleri Gizle" : "Filtreleri Goster"}
                                </Button>
                                <Button onClick={fetchData} disabled={loading}>
                                    {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                                    Filtreleri Uygula
                                </Button>
                            </div>
                        </div>
                    </CardHeader>

                    {showFilters && (
                        <CardContent className="space-y-4">
                            <div className="rounded-xl border bg-slate-50/70 p-3 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-semibold text-slate-700">Veri Kapsami Filtreleri</p>
                                    <p className="text-xs text-slate-500">Coklu secim icin tiklayin</p>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <div className="flex items-center gap-1 rounded-md border bg-white p-1">
                                        <span className="px-2 text-xs font-medium text-slate-600">Kaynak</span>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={dataSourceMode === "both" ? "default" : "outline"}
                                            className="h-7 text-xs"
                                            onClick={() => setDataSourceMode("both")}
                                        >
                                            Render + Havuz
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={dataSourceMode === "render" ? "default" : "outline"}
                                            className="h-7 text-xs"
                                            onClick={() => setDataSourceMode("render")}
                                        >
                                            Sadece Render
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={dataSourceMode === "pool" ? "default" : "outline"}
                                            className="h-7 text-xs"
                                            onClick={() => setDataSourceMode("pool")}
                                        >
                                            Sadece Havuz
                                        </Button>
                                    </div>
                                    <label className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-xs text-slate-700">
                                        <Checkbox
                                            checked={includePoolUnmatched}
                                            onCheckedChange={v => setIncludePoolUnmatched(v === true)}
                                        />
                                        Havuzda eslesmeyenleri de say
                                    </label>
                                    <MultiSelectDropdown
                                        title="Programlar"
                                        options={(options?.programs || []).map(p => ({ value: p.id, label: p.name }))}
                                        selected={selectedPrograms}
                                        onToggle={value => setSelectedPrograms(prev => toggleArrayValue(prev, value))}
                                    />
                                    <MultiSelectDropdown
                                        title="Fazlar"
                                        options={phaseOptionsFiltered.map(p => ({ value: p.key, label: p.label }))}
                                        selected={selectedPhases}
                                        onToggle={value => setSelectedPhases(prev => toggleArrayValue(prev, value))}
                                    />
                                    <MultiSelectDropdown
                                        title="Ogunler"
                                        options={(options?.meals || []).map(m => ({ value: m, label: m }))}
                                        selected={selectedMeals}
                                        onToggle={value => setSelectedMeals(prev => toggleArrayValue(prev, value))}
                                    />
                                    <MultiSelectDropdown
                                        title="Rol (API)"
                                        options={(options?.roles || []).map(r => ({ value: r, label: r }))}
                                        selected={selectedRoles}
                                        onToggle={value => setSelectedRoles(prev => toggleArrayValue(prev, value))}
                                    />
                                    <MultiSelectDropdown
                                        title="Kategori (API)"
                                        options={(options?.categories || []).map(c => ({ value: c, label: c }))}
                                        selected={selectedCategories}
                                        onToggle={value => setSelectedCategories(prev => toggleArrayValue(prev, value))}
                                    />
                                    <MultiSelectDropdown
                                        title="Etiket (Tablo)"
                                        options={(options?.tags || []).map(t => ({ value: t, label: t }))}
                                        selected={selectedTags}
                                        onToggle={value => setSelectedTags(prev => toggleArrayValue(prev, value))}
                                    />
                                    <div className="flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 min-w-[260px]">
                                        <span className="text-xs font-medium text-slate-600">Mevsim (Ay Araligi)</span>
                                        <Input
                                            className="h-7 w-14"
                                            placeholder="Bas"
                                            value={seasonMonthStart}
                                            onChange={e => setSeasonMonthStart(e.target.value)}
                                        />
                                        <span className="text-slate-400">-</span>
                                        <Input
                                            className="h-7 w-14"
                                            placeholder="Bit"
                                            value={seasonMonthEnd}
                                            onChange={e => setSeasonMonthEnd(e.target.value)}
                                        />
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Info className="h-3.5 w-3.5 text-slate-400 cursor-help" />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                Ornek: 2-8 secerseniz, 7-9 gibi kesisen mevsimler de dahil edilir.
                                            </TooltipContent>
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                                    <Filter className="h-4 w-4" />
                                    Parametreler
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                                    <div>
                                        <label className="text-xs text-slate-600">
                                            <TooltipLabel
                                                label="Hafta Baslangic"
                                                helper="Dahil baslangic haftasi. Ornek: 1"
                                            />
                                        </label>
                                        <Input value={weekStart} onChange={e => setWeekStart(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-600">
                                            <TooltipLabel
                                                label="Hafta Bitis"
                                                helper="Dahil bitis haftasi. Ornek: 26"
                                            />
                                        </label>
                                        <Input value={weekEnd} onChange={e => setWeekEnd(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-600">
                                            <TooltipLabel
                                                label="Min Support"
                                                helper="Eslesmenin en az kac kez goruldugu."
                                            />
                                        </label>
                                        <Input value={minSupport} onChange={e => setMinSupport(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-600">
                                            <TooltipLabel
                                                label="Min Confidence (0-1)"
                                                helper="Tetikleyici varken onerilenin gorulme olasiligi alt siniri."
                                            />
                                        </label>
                                        <Input value={minConfidence} onChange={e => setMinConfidence(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="text-xs text-slate-600">
                                            <TooltipLabel
                                                label="Limit"
                                                helper="API'den kac satir donecegi. 10-300 arasi."
                                            />
                                        </label>
                                        <Input value={limit} onChange={e => setLimit(e.target.value)} />
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={showOnlyCandidates}
                                            onCheckedChange={checked => setShowOnlyCandidates(checked === true)}
                                        />
                                        <span>Yalnizca kural adayi satirlari goster</span>
                                    </label>
                                    <div className="flex flex-wrap gap-1">
                                        {(Object.keys(CANDIDATE_PRESETS) as CandidatePresetKey[]).map(key => (
                                            <Button
                                                key={key}
                                                variant={candidatePreset === key ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setCandidatePreset(key)}
                                            >
                                                {CANDIDATE_PRESETS[key].label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500">{CANDIDATE_PRESETS[candidatePreset].helper}</p>
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowQuickGuide(v => !v)}
                                    className="inline-flex items-center gap-2"
                                >
                                    {showQuickGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                    Hizli Esik Rehberi
                                </Button>
                                {showQuickGuide && (
                                    <div className="overflow-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b bg-slate-50 text-left">
                                                    <th className="p-2">Seviye</th>
                                                    <th className="p-2">Min Support</th>
                                                    <th className="p-2">Min Confidence</th>
                                                    <th className="p-2">Lift</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr className="border-b">
                                                    <td className="p-2">Ilk kesif</td>
                                                    <td className="p-2">3-5</td>
                                                    <td className="p-2">0.10+</td>
                                                    <td className="p-2">&gt; 1.2</td>
                                                </tr>
                                                <tr className="border-b">
                                                    <td className="p-2">Guvenli kural adayi</td>
                                                    <td className="p-2">8+</td>
                                                    <td className="p-2">0.20+</td>
                                                    <td className="p-2">&gt; 1.5</td>
                                                </tr>
                                                <tr>
                                                    <td className="p-2">Cok guvenli / global</td>
                                                    <td className="p-2">15+</td>
                                                    <td className="p-2">0.30+</td>
                                                    <td className="p-2">&gt; 1.8</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    )}
                </Card>

                {error && (
                    <Card className="border-red-300 bg-red-50 py-3">
                        <CardContent>
                            <p className="text-sm text-red-700">{error}</p>
                        </CardContent>
                    </Card>
                )}

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <Card className="py-3">
                        <CardContent>
                            <p className="text-xs text-slate-500">Sepet Sayisi</p>
                            <p className="text-3xl font-bold">{data?.summary?.basketCount ?? 0}</p>
                            {data?.summary?.includePoolUnmatched ? (
                                <div className="mt-2">
                                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                                        Eslesmeyen dahil ({data?.summary?.unmatchedPoolOccurrences ?? 0})
                                    </Badge>
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                    <Card className="py-3">
                        <CardContent>
                            <p className="text-xs text-slate-500">Benzersiz Oge</p>
                            <p className="text-3xl font-bold">{data?.summary?.itemCount ?? 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="py-3">
                        <CardContent>
                            <p className="text-xs text-slate-500">Aday Cift</p>
                            <p className="text-3xl font-bold">{data?.summary?.pairCount ?? 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="py-3">
                        <CardContent>
                            <p className="text-xs text-slate-500">Filtrelenen Ogun</p>
                            <p className="text-3xl font-bold">{data?.summary?.filteredMeals ?? 0}</p>
                        </CardContent>
                    </Card>
                    <Card className="py-3">
                        <CardContent>
                            <p className="text-xs text-slate-500">Filtrelenen Hafta</p>
                            <p className="text-3xl font-bold">{data?.summary?.filteredWeeks ?? 0}</p>
                        </CardContent>
                </Card>
            </div>

                {draftNotice && (
                    <Card className="py-2">
                        <CardContent>
                            <p className="text-sm text-slate-700">{draftNotice}</p>
                        </CardContent>
                    </Card>
                )}
                {settingsNotice && (
                    <Card className="py-2">
                        <CardContent>
                            <p className="text-sm text-slate-700">{settingsNotice}</p>
                        </CardContent>
                    </Card>
                )}

                <Card className="py-4">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <CardTitle>Ust Seviye Kural Onerileri</CardTitle>
                                <CardDescription>
                                    Tek tek satirlar yerine genellenmis adaylar. Ornek: "yumurta" -&gt; "zeytin".
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(Object.keys(GENERALIZATION_MODE_LABELS) as GeneralizationMode[]).map(mode => (
                                    <Button
                                        key={mode}
                                        size="sm"
                                        variant={generalizationMode === mode ? "default" : "outline"}
                                        onClick={() => setGeneralizationMode(mode)}
                                    >
                                        {GENERALIZATION_MODE_LABELS[mode]}
                                    </Button>
                                ))}
                                <Button size="sm" variant="outline" onClick={clearGeneralizedFilters}>
                                    Genellenmis Sifirla
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={showGeneralizedOnlyCandidates}
                                    onCheckedChange={checked => setShowGeneralizedOnlyCandidates(checked === true)}
                                />
                                <span>Yalniz guclu adaylari goster (secili esiklere gore)</span>
                            </label>
                            <p className="text-xs text-slate-500">
                                Mod: {GENERALIZATION_MODE_LABELS[generalizationMode]} | Toplam: {generalizedRows.length}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-xs text-slate-600">Ihmal Edilen Kelimeler / Tagler</label>
                                <Textarea
                                    value={ignoredTermsInput}
                                    onChange={e => setIgnoredTermsInput(e.target.value)}
                                    className="min-h-[82px]"
                                    placeholder="ornek: keto, ketojenik, lowcarb, low carb"
                                />
                                <p className="text-xs text-slate-500">
                                    Virgulle veya alt satirla ayirabilirsiniz. Bu terimler genellenmis onerilerden filtrelenir.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-slate-600">Genellenmis Tablo Filtreleri</label>
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                    <Input
                                        placeholder="Tetikleyici ara..."
                                        value={generalizedTriggerSearch}
                                        onChange={e => setGeneralizedTriggerSearch(e.target.value)}
                                    />
                                    <Input
                                        placeholder="Onerilen ara..."
                                        value={generalizedOutcomeSearch}
                                        onChange={e => setGeneralizedOutcomeSearch(e.target.value)}
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            void savePatternSettings({ ignored_terms: ignoredTermsInput })
                                        }}
                                        disabled={savingSettings}
                                    >
                                        {savingSettings ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                        Ihmal Ayarini Kaydet
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={clearGeneralizedFilters}>
                                        Genellenmis Filtreleri Sifirla
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setIgnoredTermsInput(DEFAULT_IGNORED_TERMS)
                                            void savePatternSettings({ ignored_terms: DEFAULT_IGNORED_TERMS })
                                        }}
                                        disabled={savingSettings}
                                    >
                                        Varsayilan Ihmal Listesi
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50">
                                        <TableHead>#</TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleGeneralizedSort("mode")}>
                                                <TooltipLabel
                                                    label="Mod"
                                                    helper="Tag: foods.tags/compatibility_tags bazli. Isim: yemek adindaki anlamli kelimeler bazli."
                                                />
                                                {generalizedSort.key === "mode" ? simpleSortIcon(generalizedSort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleGeneralizedSort("trigger")}>
                                                <TooltipLabel
                                                    label="Tetikleyici"
                                                    helper="Iliskiyi baslatan tag veya isim-kelimesi."
                                                />
                                                {generalizedSort.key === "trigger" ? simpleSortIcon(generalizedSort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleGeneralizedSort("outcome")}>
                                                <TooltipLabel
                                                    label="Onerilen"
                                                    helper="Tetikleyici varken daha sik gelen tamamlayici tag veya isim-kelimesi."
                                                />
                                                {generalizedSort.key === "outcome" ? simpleSortIcon(generalizedSort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleGeneralizedSort("support")}>
                                                <TooltipLabel label="Support" helper="Bu genellenmis iliskiyi destekleyen toplam gorulum adedi." />
                                                {generalizedSort.key === "support" ? simpleSortIcon(generalizedSort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleGeneralizedSort("confidence")}>
                                                <TooltipLabel label="Confidence" helper="Destekleyen satirlarin agirlikli guven ortalamasi." />
                                                {generalizedSort.key === "confidence" ? simpleSortIcon(generalizedSort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleGeneralizedSort("lift")}>
                                                <TooltipLabel label="Lift" helper="1 ustu guclendirici etkidir; ne kadar buyukse iliski o kadar belirgin." />
                                                {generalizedSort.key === "lift" ? simpleSortIcon(generalizedSort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleGeneralizedSort("rowCount")}>
                                                <TooltipLabel label="Satir Sayisi" helper="Bu genellemenin kac farkli satirdan turetildigi." />
                                                {generalizedSort.key === "rowCount" ? simpleSortIcon(generalizedSort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead className="text-right">Aksiyon</TableHead>
                                    </TableRow>
                                    <TableRow className="bg-slate-50/60">
                                        <TableHead />
                                        <TableHead />
                                        <TableHead />
                                        <TableHead />
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={generalizedRanges.support.min}
                                                    onChange={e => setGeneralizedRange("support", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={generalizedRanges.support.max}
                                                    onChange={e => setGeneralizedRange("support", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">= %"
                                                    value={generalizedRanges.confidence.min}
                                                    onChange={e => setGeneralizedRange("confidence", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<= %"
                                                    value={generalizedRanges.confidence.max}
                                                    onChange={e => setGeneralizedRange("confidence", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={generalizedRanges.lift.min}
                                                    onChange={e => setGeneralizedRange("lift", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={generalizedRanges.lift.max}
                                                    onChange={e => setGeneralizedRange("lift", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={generalizedRanges.rowCount.min}
                                                    onChange={e => setGeneralizedRange("rowCount", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={generalizedRanges.rowCount.max}
                                                    onChange={e => setGeneralizedRange("rowCount", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {generalizedRows.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={9} className="py-6 text-center text-slate-500">
                                                Bu filtrelerle genellenmis oneriler olusmadi.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {generalizedRows.map((item, idx) => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{idx + 1}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">
                                                    {item.mode === "tag" ? "Tag" : "Isim"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-medium">{item.trigger}</TableCell>
                                            <TableCell className="font-medium">{item.outcome}</TableCell>
                                            <TableCell>{item.support}</TableCell>
                                            <TableCell>{toPercent(item.confidence)}</TableCell>
                                            <TableCell>{item.lift.toFixed(2)}</TableCell>
                                            <TableCell>{item.rowCount}</TableCell>
                                            <TableCell>
                                                <div className="flex justify-end gap-2">
                                                    <Button size="sm" onClick={() => openGeneralizedDraftInForm(item)}>
                                                        Kural Formunda Ac
                                                    </Button>
                                                    <Button size="sm" variant="outline" onClick={() => copyGeneralizedDraft(item)}>
                                                        Taslagi Kopyala
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                    </TabsContent>

                    <TabsContent value="frequency">
                <Card className="py-4">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <CardTitle>Siklik Kural Adaylari ({frequencyRows.length})</CardTitle>
                                <CardDescription>
                                    Haftalik tekrar oruntulerinden role/kategori/tag/isim-kelimesi bazli otomatik siklik kurali adaylari.
                                </CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={clearFrequencyFilters}>
                                Siklik Filtrelerini Sifirla
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3 space-y-3">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                <Input
                                    placeholder="Rol/kategori/tag/kelime ara..."
                                    value={frequencySearch}
                                    onChange={e => setFrequencySearch(e.target.value)}
                                />
                                <MultiSelectDropdown
                                    title="Temel Tip"
                                    options={frequencyTypeOptions}
                                    selected={frequencyTypeFilter}
                                    onToggle={value => setFrequencyTypeFilter(prev => toggleArrayValue(prev, value))}
                                />
                                <div className="text-xs text-slate-600 rounded-md border bg-white px-3 py-2">
                                    Bu alan, secili veri setindeki haftalik tekrar kaliplarini gosterir.
                                    Ilk adimda ustte Program/Faz/Ogun filtrelerini daraltin;
                                    sonra buradan "hangi oge haftada kac kez tekrar etmeli" kararini alin.
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-slate-700">
                                        Siklik icin Ihmal Edilen Kelimeler / Tagler
                                    </label>
                                    <Textarea
                                        value={frequencyIgnoredTermsInput}
                                        onChange={e => setFrequencyIgnoredTermsInput(e.target.value)}
                                        className="min-h-[88px]"
                                        placeholder="ornek: keto, lowcarb, ketojenik..."
                                    />
                                    <p className="text-xs text-slate-500">
                                        Virgulle veya alt satirla ayirabilirsiniz. Bu terimler Siklik Kural Adaylari tablosundan gizlenir.
                                    </p>
                                </div>

                                <div className="flex gap-2 lg:flex-col lg:justify-start">
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            void savePatternSettings({
                                                frequency_ignored_terms: frequencyIgnoredTermsInput,
                                            })
                                        }}
                                        disabled={savingSettings}
                                    >
                                        {savingSettings ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                        Ihmal Ayarini Kaydet
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setFrequencyIgnoredTermsInput(DEFAULT_FREQUENCY_IGNORED_TERMS)
                                            void savePatternSettings({
                                                frequency_ignored_terms: DEFAULT_FREQUENCY_IGNORED_TERMS,
                                            })
                                        }}
                                        disabled={savingSettings}
                                    >
                                        Varsayilan Liste
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setFrequencyIgnoredTermsInput("")
                                            void savePatternSettings({ frequency_ignored_terms: "" })
                                        }}
                                        disabled={savingSettings}
                                    >
                                        Ihmal Listesini Temizle
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50">
                                        <TableHead>#</TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("basis_type")}>
                                                <TooltipLabel
                                                    label="Tip"
                                                    helper="Bu satir hangi temelden uretildi? Rol, kategori, tag veya isim kelimesi."
                                                />
                                                {frequencySort.key === "basis_type" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("basis_value")}>
                                                <TooltipLabel
                                                    label="Deger"
                                                    helper="Tipin kendisi. Ornek: Tip=Tag ise Deger=zeytin; Tip=Rol ise Deger=sideDish."
                                                />
                                                {frequencySort.key === "basis_value" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("weeks_with_item")}>
                                                <TooltipLabel
                                                    label="Hafta Destek"
                                                    helper="Bu degerin en az 1 kez gorundugu hafta sayisi. (Kac haftada var?)"
                                                />
                                                {frequencySort.key === "weeks_with_item" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("week_support_rate")}>
                                                <TooltipLabel
                                                    label="Hafta Destek %"
                                                    helper="Hafta Destek / Toplam Hafta. Ornek %60 = haftalarin %60'inda en az bir kez var."
                                                />
                                                {frequencySort.key === "week_support_rate" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("avg_per_week")}>
                                                <TooltipLabel
                                                    label="Ort/Hafta"
                                                    helper="Toplam tekrar / toplam hafta. 0 olan haftalar da dahildir."
                                                />
                                                {frequencySort.key === "avg_per_week" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("median_per_week")}>
                                                <TooltipLabel
                                                    label="Medyan/Hafta"
                                                    helper="Goruldugu haftalardaki ortanca tekrar degeri. Uc degerleri (asiri yuksek/dusuk) dengeler."
                                                />
                                                {frequencySort.key === "median_per_week" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("dominant_weekly_count")}>
                                                <TooltipLabel
                                                    label="Baskin Sayi"
                                                    helper="En sik tekrar eden haftalik adet (mode). Ornek: en cok 3 kez/hafta gorulduyse deger 3."
                                                />
                                                {frequencySort.key === "dominant_weekly_count" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("dominant_weekly_rate")}>
                                                <TooltipLabel
                                                    label="Baskin %"
                                                    helper="Baskin Sayi'nin goruldugu hafta orani. Yuksekse kalip daha tutarlidir."
                                                />
                                                {frequencySort.key === "dominant_weekly_rate" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("total_occurrences")}>
                                                <TooltipLabel
                                                    label="Toplam Tekrar"
                                                    helper="Tum filtreli haftalardaki toplam gecis sayisi. (Ham tekrar adedi)"
                                                />
                                                {frequencySort.key === "total_occurrences" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <TooltipLabel
                                                label="Baskin Ogun"
                                                helper="Bu deger en cok hangi ogunde goruluyor? (KAHVALTI/OGLE/AKSAM gibi)"
                                            />
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleFrequencySort("top_meal_rate")}>
                                                <TooltipLabel
                                                    label="Ogun Payi %"
                                                    helper="Toplam gorulumun ne kadari Baskin Ogun'de? Ornek %70 = gecislerin %70'i ayni ogunde."
                                                />
                                                {frequencySort.key === "top_meal_rate" ? simpleSortIcon(frequencySort.direction) : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <TooltipLabel
                                                label="Onerilen Aralik"
                                                helper="Kural taslagi icin onerilen haftalik tekrar araligi (min-max)."
                                            />
                                        </TableHead>
                                        <TableHead className="text-right">Aksiyon</TableHead>
                                    </TableRow>
                                    <TableRow className="bg-slate-50/60">
                                        <TableHead />
                                        <TableHead />
                                        <TableHead />
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={frequencyRanges.weeks_with_item.min}
                                                    onChange={e => setFrequencyRange("weeks_with_item", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={frequencyRanges.weeks_with_item.max}
                                                    onChange={e => setFrequencyRange("weeks_with_item", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">= %"
                                                    value={frequencyRanges.week_support_rate.min}
                                                    onChange={e => setFrequencyRange("week_support_rate", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<= %"
                                                    value={frequencyRanges.week_support_rate.max}
                                                    onChange={e => setFrequencyRange("week_support_rate", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={frequencyRanges.avg_per_week.min}
                                                    onChange={e => setFrequencyRange("avg_per_week", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={frequencyRanges.avg_per_week.max}
                                                    onChange={e => setFrequencyRange("avg_per_week", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={frequencyRanges.median_per_week.min}
                                                    onChange={e => setFrequencyRange("median_per_week", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={frequencyRanges.median_per_week.max}
                                                    onChange={e => setFrequencyRange("median_per_week", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead />
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">= %"
                                                    value={frequencyRanges.dominant_weekly_rate.min}
                                                    onChange={e => setFrequencyRange("dominant_weekly_rate", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<= %"
                                                    value={frequencyRanges.dominant_weekly_rate.max}
                                                    onChange={e => setFrequencyRange("dominant_weekly_rate", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={frequencyRanges.total_occurrences.min}
                                                    onChange={e => setFrequencyRange("total_occurrences", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={frequencyRanges.total_occurrences.max}
                                                    onChange={e => setFrequencyRange("total_occurrences", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead />
                                        <TableHead />
                                        <TableHead />
                                        <TableHead />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {frequencyRows.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={14} className="py-6 text-center text-slate-500">
                                                Bu filtrelerle siklik kural adayi bulunamadi.
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {frequencyRows.map((row, index) => (
                                        <TableRow key={`${row.basis_type}:${row.basis_value}`}>
                                            <TableCell className="font-medium">{index + 1}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{FREQUENCY_BASIS_LABELS[row.basis_type]}</Badge>
                                            </TableCell>
                                            <TableCell className="font-medium">{row.basis_value}</TableCell>
                                            <TableCell>{row.weeks_with_item}</TableCell>
                                            <TableCell>{toPercent(row.week_support_rate)}</TableCell>
                                            <TableCell>{row.avg_per_week.toFixed(2)}</TableCell>
                                            <TableCell>{row.median_per_week.toFixed(2)}</TableCell>
                                            <TableCell>{row.dominant_weekly_count}</TableCell>
                                            <TableCell>{toPercent(row.dominant_weekly_rate)}</TableCell>
                                            <TableCell>{row.total_occurrences}</TableCell>
                                            <TableCell>{row.top_meal_time || "-"}</TableCell>
                                            <TableCell>{toPercent(row.top_meal_rate)}</TableCell>
                                            <TableCell>
                                                {row.suggested_min_weekly}-{row.suggested_max_weekly} / hafta
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex justify-end gap-2">
                                                    <Button size="sm" onClick={() => openFrequencyRuleInForm(row)}>
                                                        Kural Formunda Ac
                                                    </Button>
                                                    <Button size="sm" variant="outline" onClick={() => copyFrequencyRuleDraft(row)}>
                                                        Taslagi Kopyala
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                    </TabsContent>

                    <TabsContent value="table-filters">
                <Card className="py-4">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <CardTitle>Tablo Filtreleri (istemci tarafi)</CardTitle>
                                <CardDescription>
                                    Asagidaki filtreler sadece gorunen metrik tablosunu daraltir; API verisini tekrar cekmez.
                                </CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={clearAllClientFilters}>
                                Tablo Filtrelerini Sifirla
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-3">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-3 shadow-sm space-y-2">
                                    <p className="text-sm font-semibold text-blue-900">Tetikleyen Yemek Filtresi</p>
                                    <Input
                                        placeholder="Tetikleyen yemek adi ara..."
                                        value={triggerSearch}
                                        onChange={e => setTriggerSearch(e.target.value)}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        <MultiSelectDropdown
                                            title="Rol"
                                            options={(options?.roles || []).map(v => ({ value: v, label: v }))}
                                            selected={triggerRolesFilter}
                                            onToggle={value => setTriggerRolesFilter(prev => toggleArrayValue(prev, value))}
                                            buttonClassName="min-w-[130px] border-blue-200"
                                        />
                                        <MultiSelectDropdown
                                            title="Kategori"
                                            options={(options?.categories || []).map(v => ({ value: v, label: v }))}
                                            selected={triggerCategoriesFilter}
                                            onToggle={value => setTriggerCategoriesFilter(prev => toggleArrayValue(prev, value))}
                                            buttonClassName="min-w-[130px] border-blue-200"
                                        />
                                        <MultiSelectDropdown
                                            title="Etiket"
                                            options={(options?.tags || []).map(v => ({ value: v, label: v }))}
                                            selected={triggerTagsFilter}
                                            onToggle={value => setTriggerTagsFilter(prev => toggleArrayValue(prev, value))}
                                            buttonClassName="min-w-[130px] border-blue-200"
                                        />
                                    </div>
                                </div>

                                <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 shadow-sm space-y-2">
                                    <p className="text-sm font-semibold text-emerald-900">Onerilen Yemek Filtresi</p>
                                    <Input
                                        placeholder="Onerilen yemek adi ara..."
                                        value={suggestionSearch}
                                        onChange={e => setSuggestionSearch(e.target.value)}
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        <MultiSelectDropdown
                                            title="Rol"
                                            options={(options?.roles || []).map(v => ({ value: v, label: v }))}
                                            selected={suggestionRolesFilter}
                                            onToggle={value => setSuggestionRolesFilter(prev => toggleArrayValue(prev, value))}
                                            buttonClassName="min-w-[130px] border-emerald-200"
                                        />
                                        <MultiSelectDropdown
                                            title="Kategori"
                                            options={(options?.categories || []).map(v => ({ value: v, label: v }))}
                                            selected={suggestionCategoriesFilter}
                                            onToggle={value => setSuggestionCategoriesFilter(prev => toggleArrayValue(prev, value))}
                                            buttonClassName="min-w-[130px] border-emerald-200"
                                        />
                                        <MultiSelectDropdown
                                            title="Etiket"
                                            options={(options?.tags || []).map(v => ({ value: v, label: v }))}
                                            selected={suggestionTagsFilter}
                                            onToggle={value => setSuggestionTagsFilter(prev => toggleArrayValue(prev, value))}
                                            buttonClassName="min-w-[130px] border-emerald-200"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                    </TabsContent>
                </Tabs>

                {activeInsightTab !== "frequency" && (
                <Card className="py-4">
                    <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <CardTitle>Iliski Metrikleri ({filteredRows.length})</CardTitle>
                                <CardDescription>
                                    Sutun basliklarindan siralama (artan/azalan/sifirla), metrik sutunlarindan min-max aralik filtresi yapabilirsiniz.
                                </CardDescription>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => setSort({ key: null, direction: null })}>
                                Siralamayi Sifirla
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50">
                                        <TableHead className="w-[72px]">
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("row_order")}>
                                                # {headerSortIcon(sort, "row_order")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("lhs_food_name")}>
                                                Tetikleyen {headerSortIcon(sort, "lhs_food_name")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("rhs_food_name")}>
                                                Onerilen {headerSortIcon(sort, "rhs_food_name")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("support_count")}>
                                                <TooltipLabel label="Support" helper="Birlikte gorulme adedi (ham sayi)." /> {headerSortIcon(sort, "support_count")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("support_rate")}>
                                                <TooltipLabel label="Support %" helper="Support / toplam sepet sayisi." /> {headerSortIcon(sort, "support_rate")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("confidence")}>
                                                <TooltipLabel label="Confidence" helper="Tetikleyici varken onerilenin gorulme olasiligi." /> {headerSortIcon(sort, "confidence")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("lift")}>
                                                <TooltipLabel label="Lift" helper="1 uzeri guclendirici iliski, 1 alti zayif iliski." /> {headerSortIcon(sort, "lift")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("lhs_count")}>
                                                <TooltipLabel label="Sol Sayim" helper="Tetikleyen ogenin gectigi sepet adedi." /> {headerSortIcon(sort, "lhs_count")}
                                            </button>
                                        </TableHead>
                                        <TableHead>
                                            <button className="inline-flex items-center gap-1" onClick={() => toggleSort("rhs_count")}>
                                                <TooltipLabel label="Sag Sayim" helper="Onerilen ogenin gectigi sepet adedi." /> {headerSortIcon(sort, "rhs_count")}
                                            </button>
                                        </TableHead>
                                    </TableRow>
                                    <TableRow className="bg-slate-50/60">
                                        <TableHead />
                                        <TableHead />
                                        <TableHead />
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={ranges.support_count.min}
                                                    onChange={e => setRange("support_count", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={ranges.support_count.max}
                                                    onChange={e => setRange("support_count", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">= %"
                                                    value={ranges.support_rate.min}
                                                    onChange={e => setRange("support_rate", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<= %"
                                                    value={ranges.support_rate.max}
                                                    onChange={e => setRange("support_rate", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">= %"
                                                    value={ranges.confidence.min}
                                                    onChange={e => setRange("confidence", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<= %"
                                                    value={ranges.confidence.max}
                                                    onChange={e => setRange("confidence", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={ranges.lift.min}
                                                    onChange={e => setRange("lift", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={ranges.lift.max}
                                                    onChange={e => setRange("lift", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={ranges.lhs_count.min}
                                                    onChange={e => setRange("lhs_count", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={ranges.lhs_count.max}
                                                    onChange={e => setRange("lhs_count", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                        <TableHead>
                                            <div className="flex gap-1">
                                                <Input
                                                    className="h-8"
                                                    placeholder=">="
                                                    value={ranges.rhs_count.min}
                                                    onChange={e => setRange("rhs_count", "min", e.target.value)}
                                                />
                                                <Input
                                                    className="h-8"
                                                    placeholder="<="
                                                    value={ranges.rhs_count.max}
                                                    onChange={e => setRange("rhs_count", "max", e.target.value)}
                                                />
                                            </div>
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading && (
                                        <TableRow>
                                            <TableCell colSpan={9} className="py-8 text-center">
                                                <span className="inline-flex items-center gap-2 text-slate-500">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Veriler yukleniyor...
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {!loading && filteredRows.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={9} className="py-8 text-center text-slate-500">
                                                Bu filtrelerle eslesme bulunamadi.
                                            </TableCell>
                                        </TableRow>
                                    )}

                                    {!loading &&
                                        filteredRows.map((row, idx) => {
                                            const isExpanded = expandedRowKey === row.row_key
                                            return (
                                                <FragmentRow
                                                    key={row.row_key}
                                                    index={idx + 1}
                                                    row={row}
                                                    isExpanded={isExpanded}
                                                    onCopyDraft={() => copyRuleDraft(row)}
                                                    onOpenRuleDraft={() => openRuleDraftInForm(row)}
                                                    onToggle={() =>
                                                        setExpandedRowKey(current => (current === row.row_key ? null : row.row_key))
                                                    }
                                                />
                                            )
                                        })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
                )}
            </div>
        </TooltipProvider>
    )
}

function FragmentRow({
    index,
    row,
    isExpanded,
    onCopyDraft,
    onOpenRuleDraft,
    onToggle,
}: {
    index: number
    row: MetricRow & { row_order: number; row_key: string }
    isExpanded: boolean
    onCopyDraft: () => void
    onOpenRuleDraft: () => void
    onToggle: () => void
}) {
    const explanation = buildExplanation(row)

    return (
        <>
            <TableRow onClick={onToggle} className="cursor-pointer">
                <TableCell className="font-medium">{index}</TableCell>
                <TableCell>
                    <div className="space-y-1">
                        <p className="font-medium">{row.lhs_food_name}</p>
                        <div className="flex flex-wrap gap-1">
                            {row.lhs_role && <Badge variant="secondary">{row.lhs_role}</Badge>}
                            {row.lhs_category && <Badge variant="outline">{row.lhs_category}</Badge>}
                        </div>
                    </div>
                </TableCell>
                <TableCell>
                    <div className="space-y-1">
                        <p className="font-medium">{row.rhs_food_name}</p>
                        <div className="flex flex-wrap gap-1">
                            {row.rhs_role && <Badge variant="secondary">{row.rhs_role}</Badge>}
                            {row.rhs_category && <Badge variant="outline">{row.rhs_category}</Badge>}
                        </div>
                    </div>
                </TableCell>
                <TableCell>{row.support_count}</TableCell>
                <TableCell>{toPercent(row.support_rate)}</TableCell>
                <TableCell>{toPercent(row.confidence)}</TableCell>
                <TableCell>{row.lift.toFixed(2)}</TableCell>
                <TableCell>{row.lhs_count}</TableCell>
                <TableCell>{row.rhs_count}</TableCell>
            </TableRow>

            {isExpanded && (
                <TableRow className="bg-blue-50/30">
                    <TableCell colSpan={9}>
                        <div className="space-y-2 p-2">
                            <p className="text-sm text-slate-700">{explanation}</p>
                            <p className="text-xs text-slate-500">
                                Not: "Etiket yok" ifadesi <code>foods.tags</code> alaninin bos oldugunu gosterir. Ayrica
                                <code> compatibility_tags</code> alanini da ayri gosteriyoruz.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-600">
                                <div className="rounded border p-2 bg-white/80">
                                    <p className="font-semibold">Tetikleyen Etiketler</p>
                                    <p>{row.lhs_tags?.length ? row.lhs_tags.join(", ") : "Etiket yok (tags bos)"}</p>
                                    <p className="mt-1 font-semibold">Tetikleyen Compatibility Tags</p>
                                    <p>
                                        {row.lhs_compatibility_tags?.length
                                            ? row.lhs_compatibility_tags.join(", ")
                                            : "Compatibility etiket yok"}
                                    </p>
                                </div>
                                <div className="rounded border p-2 bg-white/80">
                                    <p className="font-semibold">Onerilen Etiketler</p>
                                    <p>{row.rhs_tags?.length ? row.rhs_tags.join(", ") : "Etiket yok (tags bos)"}</p>
                                    <p className="mt-1 font-semibold">Onerilen Compatibility Tags</p>
                                    <p>
                                        {row.rhs_compatibility_tags?.length
                                            ? row.rhs_compatibility_tags.join(", ")
                                            : "Compatibility etiket yok"}
                                    </p>
                                </div>
                            </div>
                            <div className="pt-1">
                                <div className="flex flex-wrap gap-2">
                                    <Button type="button" size="sm" variant="default" onClick={onOpenRuleDraft}>
                                        Kural Formunda Ac
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={onCopyDraft}>
                                        Satirdan Kural Taslagi Kopyala
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </TableCell>
                </TableRow>
            )}
        </>
    )
}
