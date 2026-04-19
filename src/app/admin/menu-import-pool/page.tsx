"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import {
    Loader2,
    RefreshCw,
    Search,
    ChevronDown,
    ChevronUp,
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    PlusCircle,
    Trash2,
    FolderOpen,
    FileSpreadsheet,
    LogIn,
    KeyRound,
    ArrowLeft
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FOOD_CATEGORIES } from "@/lib/constants/food-categories"
import { FOOD_ROLES } from "@/lib/constants/food-roles"
import { FoodEditDialog } from "@/components/diet/food-sidebar"
import { useGapi } from "@/hooks/use-gapi"

type PoolFoodRow = {
    label: string
    matched_food_id: string | null
    status: string
    calories: number
    carbs: number
    protein: number
    fat: number
    db_name: string | null
    role: string | null
    category: string | null
    tags: string[]
    compatibility_tags: string[]
}

type PoolRow = {
    id: string
    week_number: number | null
    week_label?: string | null
    source_type: string
    source_file_name: string | null
    source_tab_name: string | null
    source_file_names?: string[]
    source_tab_names?: string[]
    source_patient_names?: string[]
    source_patient_name: string | null
    day_name: string | null
    meal_name: string | null
    food_count: number
    unknown_count: number
    unknown_food_names: string[]
    repeat_count: number
    created_at: string
    updated_at: string
    roles: string[]
    categories: string[]
    foods: PoolFoodRow[]
}

type ListResponse = {
    rows: PoolRow[]
    summary: {
        total: number
        offset: number
        limit: number
        returned: number
        total_repeat_count: number
        total_unknown_count: number
    }
    error?: string
}

type SortField =
    | "created_at"
    | "updated_at"
    | "repeat_count"
    | "week_number"
    | "day_name"
    | "meal_name"
    | "food_count"
    | "unknown_count"
    | "source_patient_name"
    | "source_file_name"
    | "source_tab_name"

type NewFoodDraft = {
    poolId: string
    unknownName: string
    name: string
    role: string
    category: string
    calories: string
    carbs: string
    protein: string
    fat: string
    tags: string
    compatibility_tags: string
}

type DriveItem = {
    id: string
    name: string
    mimeType: string
    modifiedTime?: string
}

type DriveFolderCrumb = {
    id: string
    name: string
}

type DriveSortField = "name" | "modified"
type DriveSortDir = "asc" | "desc"
const DRIVE_IMPORT_VIEW_STATE_KEY = "drive_import_view_state_v1"

type ParsedPoolFood = {
    foodName: string
    originalText: string
    calories: number
    carbs: number
    protein: number
    fat: number
    status: "unknown"
}

type ParsedPoolDay = {
    dayName: string
    meals: {
        mealName: string
        foods: ParsedPoolFood[]
    }[]
}

type DriveImportEntry = {
    source_type: string
    source_file_id: string
    source_file_name: string
    source_tab_name: string
    source_patient_name: string | null
    week_number: number
    raw_text: string
    parsed_days: ParsedPoolDay[]
}

function getExactWeekNumberFromTab(tabName: string): number | null {
    const normalized = String(tabName || "")
        .trim()
        .toLocaleLowerCase("tr-TR")
        .replace(/\s+/g, " ")
    if (!normalized) return null
    if (/(pdf|gdf|kopya|copy|yedek|backup|arsiv|archive)/i.test(normalized)) return null

    const direct = normalized.match(/^(\d+)\.?\s*hafta$/i)
    if (direct?.[1]) {
        const n = Number(direct[1])
        return Number.isFinite(n) ? n : null
    }
    const reverse = normalized.match(/^hafta\s*(\d+)\.?$/i)
    if (reverse?.[1]) {
        const n = Number(reverse[1])
        return Number.isFinite(n) ? n : null
    }
    return null
}

function rowsToRawText(rows: any[][]) {
    if (!Array.isArray(rows)) return ""
    return rows
        .filter(row => Array.isArray(row) && row.some(cell => String(cell ?? "").trim().length > 0))
        .map(row => row.map(cell => String(cell ?? "").trim()).join("\t"))
        .join("\n")
}

const DAY_PATTERNS: Array<{ canonical: string; variants: string[] }> = [
    { canonical: "PAZARTESI", variants: ["PAZARTESI", "PAZARTESÄ°"] },
    { canonical: "SALI", variants: ["SALI"] },
    { canonical: "CARSAMBA", variants: ["CARSAMBA", "Ã‡ARÅAMBA"] },
    { canonical: "PERSEMBE", variants: ["PERSEMBE", "PERÅEMBE"] },
    { canonical: "CUMA", variants: ["CUMA"] },
    { canonical: "CUMARTESI", variants: ["CUMARTESI", "CUMARTESÄ°"] },
    { canonical: "PAZAR", variants: ["PAZAR"] },
]

const MEAL_PATTERNS: Array<{ canonical: string; variants: string[] }> = [
    { canonical: "KAHVALTI", variants: ["KAHVALTI"] },
    { canonical: "OGLEN", variants: ["OGLE", "OGLEN", "Ã–ÄLE", "Ã–ÄLEN"] },
    { canonical: "AKSAM", variants: ["AKSAM", "AKÅAM"] },
    { canonical: "ARA OGUN", variants: ["ARA OGUN", "ARA Ã–ÄÃœN"] },
    { canonical: "KUSLUK", variants: ["KUSLUK", "KUÅLUK"] },
    { canonical: "GEC GECE", variants: ["GEC GECE", "GEÃ‡ GECE"] },
]

function normalizeForParse(value: string) {
    return String(value || "")
        .toLocaleUpperCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/Ä°/g, "I")
        .trim()
}

function parseMacroCell(value: string): number | null {
    if (!value) return null
    const cleaned = String(value).replace(",", ".").replace(/[^0-9.-]/g, "")
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
}

function extractTrailingMacros(text: string): { calories: number; carbs: number; protein: number; fat: number } | null {
    const strict = text.match(/(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/)
    if (strict) {
        return {
            calories: parseMacroCell(strict[1]) ?? 0,
            carbs: parseMacroCell(strict[2]) ?? 0,
            protein: parseMacroCell(strict[3]) ?? 0,
            fat: parseMacroCell(strict[4]) ?? 0,
        }
    }
    const numbers = [...String(text).matchAll(/-?\d+(?:[.,]\d+)?/g)]
        .map(m => parseMacroCell(m[0]))
        .filter((n): n is number => n !== null)
    if (numbers.length < 4) return null
    const lastFour = numbers.slice(-4)
    return {
        calories: lastFour[0] ?? 0,
        carbs: lastFour[1] ?? 0,
        protein: lastFour[2] ?? 0,
        fat: lastFour[3] ?? 0,
    }
}

function detectDay(text: string): string | null {
    const normalized = normalizeForParse(text)
    for (const day of DAY_PATTERNS) {
        const matched = day.variants.some(variant => {
            const v = normalizeForParse(variant)
            return new RegExp(`(^|\\s)${v}([:\\s]|$)`, "i").test(normalized)
        })
        if (matched) return day.canonical
    }
    return null
}

function detectMeal(text: string): string | null {
    const normalized = normalizeForParse(text)
    for (const meal of MEAL_PATTERNS) {
        const matched = meal.variants.some(variant => {
            const v = normalizeForParse(variant)
            return new RegExp(`(^|\\s)${v}([:\\s]|$)`, "i").test(normalized)
        })
        if (matched) return meal.canonical
    }
    return null
}

function extractFoodFromRow(row: string[]): { foodName: string; calories: number; carbs: number; protein: number; fat: number } | null {
    const cells = row.map(c => String(c ?? "").trim())
    const firstIdx = cells.findIndex(Boolean)
    if (firstIdx < 0) return null
    // İlk sütun boşsa (gün sonu toplam satırı gibi) yemeğe dönüştürme.
    if (firstIdx !== 0) return null

    const rawName = String(cells[firstIdx] || "")
        .replace(/^['"â€¢\-\*â¤>]+\s*/, "")
        .trim()
    if (!rawName || rawName.length < 2) return null

    const normalizedName = normalizeForParse(rawName)
    // Açıklama/not satırlarını ihmal et.
    if (
        /^(\*|-|•)/.test(rawName) ||
        /(GUNLUK|ORTALAMA|ONERILIR|DEGISTIREBILIRSINIZ|TERCIHEN SAAT)/i.test(normalizedName)
    ) {
        return null
    }
    if (DAY_PATTERNS.some(d => d.variants.some(v => normalizeForParse(v) === normalizedName))) return null
    if (MEAL_PATTERNS.some(m => m.variants.some(v => normalizeForParse(v) === normalizedName))) return null

    const macroFromCells = cells
        .slice(firstIdx + 1)
        .map(parseMacroCell)
        .filter((n): n is number => n !== null)

    let macros: { calories: number; carbs: number; protein: number; fat: number } | null = null
    if (macroFromCells.length >= 4) {
        macros = {
            calories: macroFromCells[0] ?? 0,
            carbs: macroFromCells[1] ?? 0,
            protein: macroFromCells[2] ?? 0,
            fat: macroFromCells[3] ?? 0,
        }
    } else {
        const fullText = cells.join(" ").trim()
        const trailing = extractTrailingMacros(fullText)
        if (trailing) macros = trailing
    }

    // Makro yoksa yemek satırı değildir.
    if (!macros) return null

    const cleanedName = rawName.replace(/(\d+(?:[.,]\d+)?\s+){3}\d+(?:[.,]\d+)?\s*$/, "").trim()
    if (!cleanedName) return null

    return {
        foodName: cleanedName,
        calories: macros.calories,
        carbs: macros.carbs,
        protein: macros.protein,
        fat: macros.fat,
    }
}

function parseRowsToParsedDays(tabName: string, rows: any[][]): ParsedPoolDay[] {
    const parsedDays: ParsedPoolDay[] = []
    let currentDay: ParsedPoolDay | null = null
    let currentMeal: { mealName: string; foods: ParsedPoolFood[] } | null = null

    for (const row of rows || []) {
        if (!Array.isArray(row)) continue
        const cells = row.map(c => String(c ?? "").trim())
        const fullLine = cells.join(" ").replace(/\s+/g, " ").trim()
        if (!fullLine) continue

        const detectedDay = detectDay(fullLine)
        if (detectedDay) {
            currentDay = { dayName: detectedDay, meals: [] }
            parsedDays.push(currentDay)
            currentMeal = null
            continue
        }

        const detectedMeal = detectMeal(fullLine)
        if (detectedMeal) {
            if (!currentDay) continue
            currentMeal = { mealName: detectedMeal, foods: [] }
            currentDay.meals.push(currentMeal)
            continue
        }

        if (!currentDay || !currentMeal) continue
        const extracted = extractFoodFromRow(cells)
        if (!extracted) continue

        currentMeal.foods.push({
            originalText: fullLine,
            foodName: extracted.foodName,
            calories: extracted.calories,
            carbs: extracted.carbs,
            protein: extracted.protein,
            fat: extracted.fat,
            status: "unknown",
        })
    }

    return parsedDays
        .map(day => ({
            ...day,
            meals: day.meals.filter(meal => meal.foods.length > 0),
        }))
        .filter(day => day.meals.length > 0)
}

function normalizeText(value: string) {
    return String(value || "").trim().toLocaleLowerCase("tr-TR")
}

function trimText(value: unknown) {
    return String(value ?? "").trim()
}

function asFiniteNumber(value: string, fallback = 0) {
    const parsed = Number(String(value || "").replace(",", "."))
    if (!Number.isFinite(parsed)) return fallback
    return parsed
}

function splitTags(raw: string) {
    return String(raw || "")
        .split(",")
        .map(tag => tag.trim())
        .filter(Boolean)
}

function toggleArrayValue(values: string[], value: string) {
    if (values.includes(value)) return values.filter(v => v !== value)
    return [...values, value]
}

function fmtDateTime(value: string | null | undefined) {
    if (!value) return "-"
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return d.toLocaleString("tr-TR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function formatDay(value: string | null | undefined) {
    const normalized = normalizeText(value || "")
    if (!normalized) return "-"
    return normalized
        .replace("PAZARTESI", "PAZARTESI")
        .replace("SALI", "SALI")
        .replace("CARSAMBA", "CARSAMBA")
        .replace("PERSEMBE", "PERSEMBE")
        .replace("CUMARTESI", "CUMARTESI")
        .replace("PAZAR", "PAZAR")
}

function isFolder(item: DriveItem) {
    return item.mimeType === "application/vnd.google-apps.folder"
}

function isSpreadsheet(item: DriveItem) {
    return item.mimeType === "application/vnd.google-apps.spreadsheet"
}

function guessPatientNameFromFileName(fileName: string) {
    const base = String(fileName || "")
        .replace(/\.(xlsx?|csv|txt)$/i, "")
        .replace(/\s+/g, " ")
        .trim()
    if (!base) return null
    const cleaned = base
        .replace(/\b\d+\.?\s*hafta\b/gi, "")
        .replace(/\bhafta\s*\d+\.?\b/gi, "")
        .replace(/\b(plan|program|liste)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    return cleaned || base
}

function isExcludedByName(fileName: string) {
    const n = normalizeText(fileName)
    if (!n) return false
    return n.includes("program sonrasi devam") || n.includes("program sonrasÄ± devam")
}

function MultiSelectDropdown({
    title,
    options,
    selected,
    onToggle,
    onClear,
}: {
    title: string
    options: string[]
    selected: string[]
    onToggle: (value: string) => void
    onClear: () => void
}) {
    const [query, setQuery] = useState("")

    const filtered = useMemo(() => {
        const q = normalizeText(query)
        if (!q) return options
        return options.filter(option => normalizeText(option).includes(q))
    }, [options, query])

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="h-9 min-w-[190px] justify-between gap-2 bg-white">
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
                    <button type="button" className="text-xs text-slate-500 hover:text-slate-700" onClick={onClear}>
                        Temizle
                    </button>
                </div>
                <div className="border-b p-2">
                    <Input className="h-8" placeholder="Ara..." value={query} onChange={e => setQuery(e.target.value)} />
                </div>
                <ScrollArea className="h-56">
                    <div className="space-y-1 p-2">
                        {filtered.map(option => (
                            <label key={option} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 cursor-pointer">
                                <Checkbox
                                    checked={selected.includes(option)}
                                    onCheckedChange={checked => {
                                        if (checked === true) onToggle(option)
                                        if (checked === false && selected.includes(option)) onToggle(option)
                                    }}
                                />
                                <span className="leading-tight">{option}</span>
                            </label>
                        ))}
                        {filtered.length === 0 && <p className="p-1 text-xs text-slate-400">Sonuc yok</p>}
                    </div>
                </ScrollArea>
                <div className="border-t px-3 py-1.5 text-xs text-slate-500">{selected.length} secili</div>
            </PopoverContent>
        </Popover>
    )
}

export default function MenuImportPoolPage() {
    const [rows, setRows] = useState<PoolRow[]>([])
    const [summary, setSummary] = useState<ListResponse["summary"] | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [qInput, setQInput] = useState("")
    const [q, setQ] = useState("")
    const [sourceType, setSourceType] = useState("all")
    const [unknownOnly, setUnknownOnly] = useState(false)
    const [dateFrom, setDateFrom] = useState("")
    const [dateTo, setDateTo] = useState("")
    const [limit, setLimit] = useState(120)
    const [offset, setOffset] = useState(0)
    const [sortBy, setSortBy] = useState<SortField>("created_at")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})

    const [roleFilters, setRoleFilters] = useState<string[]>([])
    const [categoryFilters, setCategoryFilters] = useState<string[]>([])
    const [roleFilterMode, setRoleFilterMode] = useState<"or" | "and">("or")
    const [categoryFilterMode, setCategoryFilterMode] = useState<"or" | "and">("or")
    const [draft, setDraft] = useState<NewFoodDraft | null>(null)
    const [savingDraft, setSavingDraft] = useState(false)
    const [selectedRowIds, setSelectedRowIds] = useState<string[]>([])
    const [isDeletingSelected, setIsDeletingSelected] = useState(false)

    const {
        isReady: isGapiReady,
        isInitializing: isGapiInitializing,
        isInitialized: isGapiInitialized,
        initClient: initGapiClient,
        login: gapiLogin,
        isAuthenticated: isGapiAuthenticated,
        error: gapiError,
        gapi,
    } = useGapi(true)
    const [gApiKey, setGApiKey] = useState("")
    const [gClientId, setGClientId] = useState("")
    const [driveBusy, setDriveBusy] = useState(false)
    const [driveItems, setDriveItems] = useState<DriveItem[]>([])
    const [driveSearch, setDriveSearch] = useState("")
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
    const [currentFolderName, setCurrentFolderName] = useState<string>("Kok")
    const [folderStack, setFolderStack] = useState<DriveFolderCrumb[]>([])
    const [selectedSheetIds, setSelectedSheetIds] = useState<string[]>([])
    const [selectedSheetMeta, setSelectedSheetMeta] = useState<Record<string, DriveItem>>({})
    const [importedFileIds, setImportedFileIds] = useState<Set<string>>(new Set())
    const [hideImportedFiles, setHideImportedFiles] = useState(true)
    const [driveSortField, setDriveSortField] = useState<DriveSortField>("modified")
    const [driveSortDir, setDriveSortDir] = useState<DriveSortDir>("desc")
    const [importingSheets, setImportingSheets] = useState(false)
    const [importLog, setImportLog] = useState<string>("")
    const [importStats, setImportStats] = useState<{
        files: number
        tabs: number
        entries: number
        matchedFoodIds: number
        unknownFoods: number
    } | null>(null)
    const [resumeAuthOnMount, setResumeAuthOnMount] = useState(false)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewEntries, setPreviewEntries] = useState<DriveImportEntry[]>([])
    const [previewFilesCount, setPreviewFilesCount] = useState(0)
    const [previewTabsCount, setPreviewTabsCount] = useState(0)

    const roleOptions = useMemo(
        () =>
            Array.from(new Set(rows.flatMap(row => row.roles).map(v => v.trim()).filter(Boolean))).sort((a, b) =>
                a.localeCompare(b, "tr")
            ),
        [rows]
    )
    const displayedDriveItems = useMemo(() => {
        const q = normalizeText(driveSearch)
        let items = [...driveItems]
        if (q) {
            items = items.filter(item => normalizeText(item.name).includes(q))
        }
        if (hideImportedFiles) {
            items = items.filter(item => !isSpreadsheet(item) || !importedFileIds.has(item.id))
        }
        items.sort((a, b) => {
            if (isFolder(a) && !isFolder(b)) return -1
            if (!isFolder(a) && isFolder(b)) return 1
            if (driveSortField === "modified") {
                const ta = a.modifiedTime ? new Date(a.modifiedTime).getTime() : 0
                const tb = b.modifiedTime ? new Date(b.modifiedTime).getTime() : 0
                if (ta !== tb) {
                    return driveSortDir === "asc" ? ta - tb : tb - ta
                }
            }
            return driveSortDir === "asc"
                ? a.name.localeCompare(b.name, "tr")
                : b.name.localeCompare(a.name, "tr")
        })
        return items
    }, [driveItems, driveSearch, hideImportedFiles, importedFileIds, driveSortField, driveSortDir])

    const selectedSheets = useMemo(() => {
        const map = new Map(driveItems.map(item => [item.id, item]))
        return selectedSheetIds
            .map(id => map.get(id) || selectedSheetMeta[id])
            .filter((v): v is DriveItem => Boolean(v))
    }, [driveItems, selectedSheetIds, selectedSheetMeta])
    const visibleSheetIds = useMemo(() => displayedDriveItems.filter(isSpreadsheet).map(item => item.id), [displayedDriveItems])
    const categoryOptions = useMemo(
        () =>
            Array.from(new Set(rows.flatMap(row => row.categories).map(v => v.trim()).filter(Boolean))).sort((a, b) =>
                a.localeCompare(b, "tr")
            ),
        [rows]
    )

    const filteredRows = useMemo(() => {
        return rows.filter(row => {
            if (roleFilters.length > 0) {
                const roleSet = new Set(row.roles.map(v => normalizeText(v)))
                const roleMatch =
                    roleFilterMode === "and"
                        ? roleFilters.every(role => roleSet.has(normalizeText(role)))
                        : roleFilters.some(role => roleSet.has(normalizeText(role)))
                if (!roleMatch) {
                    return false
                }
            }
            if (categoryFilters.length > 0) {
                const categorySet = new Set(row.categories.map(v => normalizeText(v)))
                const categoryMatch =
                    categoryFilterMode === "and"
                        ? categoryFilters.every(category => categorySet.has(normalizeText(category)))
                        : categoryFilters.some(category => categorySet.has(normalizeText(category)))
                if (!categoryMatch) {
                    return false
                }
            }
            return true
        })
    }, [rows, roleFilters, categoryFilters, roleFilterMode, categoryFilterMode])
    const filteredRowIds = useMemo(() => filteredRows.map(row => row.id), [filteredRows])
    const selectedVisibleCount = useMemo(
        () => filteredRowIds.filter(id => selectedRowIds.includes(id)).length,
        [filteredRowIds, selectedRowIds]
    )
    const allVisibleSelected = filteredRowIds.length > 0 && selectedVisibleCount === filteredRowIds.length
    const visibleSelectionState: boolean | "indeterminate" =
        selectedVisibleCount === 0 ? false : allVisibleSelected ? true : "indeterminate"

    useEffect(() => {
        if (typeof window === "undefined") return
        const storedKey = window.localStorage.getItem("diyet_google_api_key") || ""
        const storedClient = window.localStorage.getItem("diyet_google_client_id") || ""
        setGApiKey(storedKey)
        setGClientId(storedClient)

        try {
            const raw = window.sessionStorage.getItem(DRIVE_IMPORT_VIEW_STATE_KEY)
            if (!raw) return
            const parsed = JSON.parse(raw) as any
            if (Array.isArray(parsed?.driveItems)) setDriveItems(parsed.driveItems)
            if (typeof parsed?.driveSearch === "string") setDriveSearch(parsed.driveSearch)
            if (typeof parsed?.currentFolderId === "string" || parsed?.currentFolderId === null) setCurrentFolderId(parsed.currentFolderId)
            if (typeof parsed?.currentFolderName === "string") setCurrentFolderName(parsed.currentFolderName)
            if (Array.isArray(parsed?.folderStack)) setFolderStack(parsed.folderStack)
            if (Array.isArray(parsed?.selectedSheetIds)) setSelectedSheetIds(parsed.selectedSheetIds)
            if (parsed?.selectedSheetMeta && typeof parsed.selectedSheetMeta === "object") setSelectedSheetMeta(parsed.selectedSheetMeta)
            if (Array.isArray(parsed?.importedFileIds)) setImportedFileIds(new Set(parsed.importedFileIds))
            if (typeof parsed?.hideImportedFiles === "boolean") setHideImportedFiles(parsed.hideImportedFiles)
            if (parsed?.resumeAuthOnMount === true) setResumeAuthOnMount(true)
        } catch {
            // ignore corrupt session payload
        }
    }, [])

    useEffect(() => {
        if (typeof window === "undefined") return
        const payload = {
            driveItems,
            driveSearch,
            currentFolderId,
            currentFolderName,
            folderStack,
            selectedSheetIds,
            selectedSheetMeta,
            importedFileIds: Array.from(importedFileIds),
            hideImportedFiles,
            resumeAuthOnMount: isGapiAuthenticated || resumeAuthOnMount,
        }
        window.sessionStorage.setItem(DRIVE_IMPORT_VIEW_STATE_KEY, JSON.stringify(payload))
    }, [
        driveItems,
        driveSearch,
        currentFolderId,
        currentFolderName,
        folderStack,
        selectedSheetIds,
        selectedSheetMeta,
        importedFileIds,
        hideImportedFiles,
        isGapiAuthenticated,
        resumeAuthOnMount,
    ])

    useEffect(() => {
        if (!resumeAuthOnMount) return
        if (!isGapiReady || isGapiInitializing) return
        if (isGapiAuthenticated) return
        if (isGapiInitialized) return
        if (!gApiKey.trim() || !gClientId.trim()) return
        ;(async () => {
            await initGapiClient(gApiKey.trim(), gClientId.trim())
        })()
    }, [resumeAuthOnMount, isGapiReady, isGapiInitializing, isGapiAuthenticated, isGapiInitialized, gApiKey, gClientId, initGapiClient])

    const saveDriveCredentials = async () => {
        if (!gApiKey.trim() || !gClientId.trim()) {
            alert("API key ve Client ID zorunlu.")
            return
        }
        if (typeof window !== "undefined") {
            window.localStorage.setItem("diyet_google_api_key", gApiKey.trim())
            window.localStorage.setItem("diyet_google_client_id", gClientId.trim())
        }
        await initGapiClient(gApiKey.trim(), gClientId.trim())
    }

    const refreshImportedFileIds = async () => {
        try {
            const response = await fetch("/api/admin/menu-import-pool/list?limit=5000&offset=0&source_type=google_sheets", {
                method: "GET",
                cache: "no-store",
            })
            const json = (await response.json().catch(() => ({}))) as any
            if (!response.ok) return
            const ids = new Set<string>()
            for (const row of json?.rows || []) {
                const id = String(row?.source_file_id || "").trim()
                if (id) ids.add(id)
            }
            setImportedFileIds(ids)
        } catch {
            // non-blocking
        }
    }

    const listDriveItems = async (folderId: string | null, queryText: string) => {
        if (!gapi) return
        setDriveBusy(true)
        setImportLog("")
        try {
            const escapedQuery = queryText.trim().replace(/'/g, "\\'")
            const parent = folderId ? `'${folderId}' in parents` : `'root' in parents`
            const nameFilter = escapedQuery ? ` and name contains '${escapedQuery}'` : ""
            const q = `${parent} and trashed=false and (mimeType='application/vnd.google-apps.folder' or mimeType='application/vnd.google-apps.spreadsheet')${nameFilter}`
            const response = await gapi.client.drive.files.list({
                q,
                fields: "files(id,name,mimeType,modifiedTime)",
                pageSize: 200,
                orderBy: "folder,name_natural",
            })
            const files = (response?.result?.files || []) as DriveItem[]
            const normalized = files
                .map(file => ({
                    id: String(file.id || ""),
                    name: String(file.name || ""),
                    mimeType: String(file.mimeType || ""),
                    modifiedTime: file.modifiedTime,
                }))
                .filter(file => file.id && file.name)
                .filter(file => !isSpreadsheet(file) || !isExcludedByName(file.name))
                .sort((a, b) => {
                    if (isFolder(a) && !isFolder(b)) return -1
                    if (!isFolder(a) && isFolder(b)) return 1
                    return a.name.localeCompare(b.name, "tr")
                })
            setDriveItems(normalized)
            setSelectedSheetIds(prev => prev.filter(id => normalized.some(item => item.id === id)))
        } catch (e: any) {
            alert(`Drive listeleme hatasi: ${e?.result?.error?.message || e?.message || "Bilinmeyen hata"}`)
        } finally {
            setDriveBusy(false)
        }
    }

    const openDriveFolder = async (folder: DriveItem) => {
        setFolderStack(prev => [...prev, { id: folder.id, name: folder.name }])
        setCurrentFolderId(folder.id)
        setCurrentFolderName(folder.name)
        await listDriveItems(folder.id, "")
        setDriveSearch("")
    }

    const goToDriveCrumb = async (crumbIndex: number) => {
        const targetStack = folderStack.slice(0, crumbIndex + 1)
        const target = targetStack[targetStack.length - 1] || null
        setFolderStack(targetStack)
        setCurrentFolderId(target?.id || null)
        setCurrentFolderName(target?.name || "Kok")
        setDriveSearch("")
        await listDriveItems(target?.id || null, "")
    }

    const goDriveRoot = async () => {
        setFolderStack([])
        setCurrentFolderId(null)
        setCurrentFolderName("Kok")
        setDriveSearch("")
        await listDriveItems(null, "")
    }

    const toggleSheetSelection = (sheet: DriveItem) => {
        setSelectedSheetIds(prev => (prev.includes(sheet.id) ? prev.filter(id => id !== sheet.id) : [...prev, sheet.id]))
        setSelectedSheetMeta(prev => {
            if (prev[sheet.id]) return prev
            return { ...prev, [sheet.id]: sheet }
        })
    }

    const toggleSelectAllVisibleSheets = (checked: boolean) => {
        const visibleSheets = displayedDriveItems.filter(isSpreadsheet)
        const visibleSheetIds = visibleSheets.map(item => item.id)
        if (!checked) {
            setSelectedSheetIds(prev => prev.filter(id => !visibleSheetIds.includes(id)))
            return
        }
        setSelectedSheetMeta(prev => {
            const next = { ...prev }
            for (const sheet of visibleSheets) next[sheet.id] = sheet
            return next
        })
        setSelectedSheetIds(prev => Array.from(new Set([...prev, ...visibleSheetIds])))
    }

    const importSelectedDriveSheets = async () => {
        if (!gapi) return
        const selectedVisibleSheets = displayedDriveItems
            .filter(isSpreadsheet)
            .filter(item => selectedSheetIds.includes(item.id))
            .filter(item => !isExcludedByName(item.name))
            .filter(item => !importedFileIds.has(item.id))
        if (selectedVisibleSheets.length === 0) {
            alert("Aktarim icin bu listede secili dosya bulunamadi.")
            return
        }

        const retryGapi = async <T,>(fn: () => Promise<T>, maxTry = 4): Promise<T> => {
            let attempt = 0
            let lastError: any = null
            while (attempt < maxTry) {
                try {
                    return await fn()
                } catch (e: any) {
                    lastError = e
                    const message = String(e?.result?.error?.message || e?.message || "")
                    const status = Number(e?.status || e?.result?.error?.code || 0)
                    const isRateLimit = status === 429 || /rate|quota|too many/i.test(message)
                    if (!isRateLimit || attempt === maxTry - 1) {
                        throw e
                    }
                    const waitMs = 400 * Math.pow(2, attempt)
                    await new Promise(resolve => setTimeout(resolve, waitMs))
                }
                attempt += 1
            }
            throw lastError
        }

        setImportingSheets(true)
        setDriveBusy(true)
        setImportLog("Dosyalar ayristiriliyor...")
        setImportStats(null)
        try {
            const entries: DriveImportEntry[] = []
            let processedTabs = 0

            for (let fileIdx = 0; fileIdx < selectedVisibleSheets.length; fileIdx++) {
                const file = selectedVisibleSheets[fileIdx]
                setImportLog(`Dosya ${fileIdx + 1}/${selectedVisibleSheets.length}: ${file.name}`)
                const spreadsheet = await retryGapi<any>(() => gapi.client.sheets.spreadsheets.get({
                    spreadsheetId: file.id,
                    fields: "sheets.properties.title",
                }))
                const tabs: string[] = (spreadsheet?.result?.sheets || [])
                    .map((s: any) => String(s?.properties?.title || ""))
                    .filter(Boolean)
                const weekTabs = tabs
                    .map(tabName => ({ tabName, week: getExactWeekNumberFromTab(tabName) }))
                    .filter(t => Number.isFinite(t.week))
                    .sort((a, b) => Number(a.week) - Number(b.week))

                if (weekTabs.length === 0) {
                    continue
                }

                for (const weekTab of weekTabs) {
                    processedTabs += 1
                    setImportLog(`Tab cekiliyor: ${file.name} / ${weekTab.tabName}`)
                    const range = `'${weekTab.tabName.replace(/'/g, "''")}'!A:AZ`
                    const valuesResp = await retryGapi<any>(() => gapi.client.sheets.spreadsheets.values.get({
                        spreadsheetId: file.id,
                        range,
                    }))
                    const rows = valuesResp?.result?.values || []
                    if (!Array.isArray(rows) || rows.length === 0) continue

                    const rawText = rowsToRawText(rows)
                    if (!rawText.trim()) continue

                    const parsedDays = parseRowsToParsedDays(weekTab.tabName, rows)
                    const totalFoods = parsedDays.reduce(
                        (sum, day) => sum + day.meals.reduce((mealSum, meal) => mealSum + meal.foods.length, 0),
                        0
                    )
                    if (totalFoods === 0) continue

                    entries.push({
                        source_type: "google_sheets",
                        source_file_id: file.id,
                        source_file_name: file.name,
                        source_tab_name: weekTab.tabName,
                        source_patient_name: guessPatientNameFromFileName(file.name),
                        week_number: Number(weekTab.week),
                        raw_text: rawText,
                        parsed_days: parsedDays,
                    })
                }
            }

            if (entries.length === 0) {
                setImportLog("Uygun tab bulunamadi. Sadece tam hafta tablari (1. hafta, 2. hafta...) aktarilir.")
                return
            }

            setPreviewEntries(entries)
            setPreviewFilesCount(selectedVisibleSheets.length)
            setPreviewTabsCount(processedTabs)
            setPreviewOpen(true)
            setImportLog(`Ayristirma tamamlandi. Dosya: ${selectedVisibleSheets.length}, Tab: ${processedTabs}, Paket: ${entries.length}. Onizleme hazir.`)
        } catch (e: any) {
            setImportLog(`Hata: ${e?.message || "Bilinmeyen hata"}`)
            alert(`Toplu aktarim hatasi: ${e?.message || "Bilinmeyen hata"}`)
        } finally {
            setImportingSheets(false)
            setDriveBusy(false)
        }
    }

    const confirmImportPreview = async () => {
        if (previewEntries.length === 0) return
        setImportingSheets(true)
        setDriveBusy(true)
        setImportLog(`Ingest baslatiliyor... (${previewEntries.length} paket)`)
        try {
            const response = await fetch("/api/admin/menu-import-pool/ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ entries: previewEntries }),
            })
            const json = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(json?.error || "Ingest hatasi")
            }

            const summary = json?.summary || {}
            setImportStats({
                files: previewFilesCount,
                tabs: previewTabsCount,
                entries: Number(summary?.inserted ?? previewEntries.length),
                matchedFoodIds: Number(summary?.matched_food_ids_total ?? 0),
                unknownFoods: Number(summary?.unknown_food_names_total ?? 0),
            })
            setImportLog(
                `Aktarim tamamlandi. Dosya: ${previewFilesCount}, Tab: ${previewTabsCount}, Paket: ${Number(summary?.inserted ?? previewEntries.length)}`
            )
            setPreviewOpen(false)
            setPreviewEntries([])
            await refreshImportedFileIds()
            await fetchRows()
            alert("Drive toplu iceri aktarma tamamlandi.")
        } catch (e: any) {
            setImportLog(`Hata: ${e?.message || "Bilinmeyen hata"}`)
            alert(`Toplu aktarim hatasi: ${e?.message || "Bilinmeyen hata"}`)
        } finally {
            setImportingSheets(false)
            setDriveBusy(false)
        }
    }

    const fetchRows = async () => {
        setLoading(true)
        setError(null)
        try {
            const qs = new URLSearchParams()
            if (q.trim()) qs.set("q", q.trim())
            if (sourceType !== "all") qs.set("source_type", sourceType)
            if (unknownOnly) qs.set("unknown_only", "1")
            if (dateFrom) qs.set("date_from", dateFrom)
            if (dateTo) qs.set("date_to", dateTo)
            qs.set("limit", String(limit))
            qs.set("offset", String(offset))
            qs.set("sort_by", sortBy)
            qs.set("sort_dir", sortDir)

            const response = await fetch(`/api/admin/menu-import-pool/list?${qs.toString()}`, {
                method: "GET",
                cache: "no-store",
            })
            const json = (await response.json()) as ListResponse
            if (!response.ok) {
                throw new Error(json.error || "Havuz listesi yuklenemedi.")
            }
            const nextRows = json.rows || []
            setRows(nextRows)
            setSelectedRowIds(prev => prev.filter(id => nextRows.some(row => row.id === id)))
            setSummary(json.summary || null)
        } catch (e: any) {
            setRows([])
            setSelectedRowIds([])
            setSummary(null)
            setError(e?.message || "Beklenmeyen bir hata oldu.")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchRows()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offset, limit, sortBy, sortDir])

    useEffect(() => {
        if (!isGapiAuthenticated) return
        refreshImportedFileIds()
        listDriveItems(currentFolderId, "")
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isGapiAuthenticated])

    const toggleSort = (field: SortField) => {
        if (sortBy !== field) {
            setSortBy(field)
            setSortDir("desc")
            return
        }
        setSortDir(prev => (prev === "desc" ? "asc" : "desc"))
    }

    const sortIcon = (field: SortField) => {
        if (sortBy !== field) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
        return sortDir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
        ) : (
            <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
        )
    }

    const openDraft = (row: PoolRow, unknownName: string) => {
        const sample = row.foods.find(
            food => !food.matched_food_id && normalizeText(food.label) === normalizeText(unknownName)
        )
        setDraft({
            poolId: row.id,
            unknownName,
            name: unknownName,
            role: sample?.role || "sideDish",
            category: sample?.category || "AI Onerisi",
            calories: String(sample?.calories ?? 0),
            carbs: String(sample?.carbs ?? 0),
            protein: String(sample?.protein ?? 0),
            fat: String(sample?.fat ?? 0),
            tags: "",
            compatibility_tags: "",
        })
    }

    const toggleRowSelection = (rowId: string) => {
        setSelectedRowIds(prev => (prev.includes(rowId) ? prev.filter(id => id !== rowId) : [...prev, rowId]))
    }

    const toggleSelectVisible = (nextChecked: boolean) => {
        if (!nextChecked) {
            setSelectedRowIds(prev => prev.filter(id => !filteredRowIds.includes(id)))
            return
        }
        setSelectedRowIds(prev => Array.from(new Set([...prev, ...filteredRowIds])))
    }

    const clearSelection = () => setSelectedRowIds([])

    const deleteSelectedRows = async () => {
        if (selectedRowIds.length === 0) return
        const toDelete = selectedRowIds.slice()
        const ok = confirm(`${toDelete.length} havuz paketi kalici olarak silinecek. Devam edilsin mi?`)
        if (!ok) return

        setIsDeletingSelected(true)
        try {
            const response = await fetch("/api/admin/menu-import-pool/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: toDelete }),
            })
            const json = await response.json().catch(() => ({}))
            if (!response.ok) {
                throw new Error(json?.error || "Toplu silme basarisiz.")
            }
            clearSelection()
            await fetchRows()
            alert(`Silme tamamlandi. Silinen paket: ${json?.deleted ?? toDelete.length}`)
        } catch (e: any) {
            alert(`Toplu silme hatasi: ${e?.message || "Bilinmeyen hata"}`)
        } finally {
            setIsDeletingSelected(false)
        }
    }

    const saveDraft = async (payload?: Record<string, any>) => {
        if (!draft) return
        const resolvedName = trimText(payload?.name || draft.name || "")
        if (!resolvedName) {
            alert("Yemek adi bos olamaz.")
            throw new Error("Yemek adi bos olamaz.")
        }

        setSavingDraft(true)
        try {
            const response = await fetch("/api/admin/menu-import-pool/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    pool_id: draft.poolId,
                    unknown_name: draft.unknownName,
                    create_food: {
                        name: resolvedName,
                        role: trimText(payload?.role || draft.role || "") || "sideDish",
                        category: trimText(payload?.category || draft.category || "") || "AI Onerisi",
                        calories: asFiniteNumber(String(payload?.calories ?? draft.calories), 0),
                        carbs: asFiniteNumber(String(payload?.carbs ?? draft.carbs), 0),
                        protein: asFiniteNumber(String(payload?.protein ?? draft.protein), 0),
                        fat: asFiniteNumber(String(payload?.fat ?? draft.fat), 0),
                        portion_unit: trimText(payload?.portion_unit || "") || "porsiyon",
                        standard_amount: asFiniteNumber(String(payload?.standard_amount ?? 1), 1),
                        tags: Array.isArray(payload?.tags) ? payload.tags : splitTags(draft.tags),
                        compatibility_tags: Array.isArray(payload?.compatibility_tags)
                            ? payload.compatibility_tags
                            : splitTags(draft.compatibility_tags),
                    },
                }),
            })
            const json = await response.json()
            if (!response.ok) {
                throw new Error(json?.error || "Bilinmeyen cozumleme hatasi")
            }

            setDraft(null)
            await fetchRows()
            alert("Bilinmeyen yemek veritabanina eklendi ve havuz satiri guncellendi.")
            return json
        } catch (e: any) {
            alert(`Kayit hatasi: ${e?.message || "Bilinmeyen hata"}`)
            throw e
        } finally {
            setSavingDraft(false)
        }
    }

    const totalPages = summary ? Math.max(1, Math.ceil(summary.total / summary.limit)) : 1
    const currentPage = summary ? Math.floor(summary.offset / summary.limit) + 1 : 1

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                        Drive Ise Aktar (Global)
                    </CardTitle>
                    <CardDescription>
                        Google Drive klasorlerini gezin, dosyalari secin ve sadece net hafta tablarini (1. hafta, 2. hafta...)
                        toplu olarak Menu Havuzu'na aktarÄ±n.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                        <div>
                            <Label>Google API Key</Label>
                            <Input
                                value={gApiKey}
                                onChange={e => setGApiKey(e.target.value)}
                                placeholder="AIzaSy..."
                                className="font-mono text-xs"
                            />
                        </div>
                        <div>
                            <Label>Google Client ID</Label>
                            <Input
                                value={gClientId}
                                onChange={e => setGClientId(e.target.value)}
                                placeholder="....apps.googleusercontent.com"
                                className="font-mono text-xs"
                            />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            variant="outline"
                            onClick={saveDriveCredentials}
                            disabled={isGapiInitializing || !gApiKey.trim() || !gClientId.trim()}
                        >
                            <KeyRound className="mr-2 h-4 w-4" />
                            {isGapiInitialized ? "Anahtarlar Kayitli" : "Anahtarlari Kaydet ve Baslat"}
                        </Button>
                        <Button
                            onClick={() => gapiLogin(true)}
                            disabled={!isGapiReady || isGapiInitializing || !isGapiInitialized || isGapiAuthenticated}
                        >
                            <LogIn className="mr-2 h-4 w-4" />
                            {isGapiAuthenticated ? "Bagli" : "Google ile Giris"}
                        </Button>
                        <Badge variant={isGapiAuthenticated ? "default" : "secondary"}>
                            {isGapiAuthenticated ? "Baglanti Aktif" : "Baglanti Bekleniyor"}
                        </Badge>
                        {gapiError && <Badge variant="destructive" className="max-w-full truncate">{gapiError}</Badge>}
                    </div>

                    {isGapiAuthenticated && (
                        <div className="rounded-lg border bg-slate-50 p-3 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={goDriveRoot}
                                    disabled={driveBusy}
                                >
                                    Kok
                                </Button>
                                {folderStack.map((crumb, idx) => (
                                    <button
                                        key={`${crumb.id}-${idx}`}
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs hover:bg-slate-100"
                                        onClick={() => goToDriveCrumb(idx)}
                                        disabled={driveBusy}
                                    >
                                        <ArrowLeft className="h-3 w-3" />
                                        {crumb.name}
                                    </button>
                                ))}
                                <span className="ml-auto text-xs text-slate-500">Klasor: {currentFolderName}</span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative w-full max-w-md">
                                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                                    <Input
                                        value={driveSearch}
                                        onChange={e => setDriveSearch(e.target.value)}
                                        onKeyDown={async e => {
                                            if (e.key === "Enter") {
                                                await listDriveItems(currentFolderId, "")
                                            }
                                        }}
                                        className="pl-8"
                                        placeholder="Bu klasorde dosya/klasor ara..."
                                    />
                                </div>
                                <Select value={driveSortField} onValueChange={value => setDriveSortField(value as DriveSortField)}>
                                    <SelectTrigger className="w-[160px]">
                                        <SelectValue placeholder="Siralama alani" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="name">Ada gore</SelectItem>
                                        <SelectItem value="modified">Tarihe gore</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={driveSortDir} onValueChange={value => setDriveSortDir(value as DriveSortDir)}>
                                    <SelectTrigger className="w-[130px]">
                                        <SelectValue placeholder="Yon" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="asc">Artan</SelectItem>
                                        <SelectItem value="desc">Azalan</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => listDriveItems(currentFolderId, "")}
                                    disabled={driveBusy}
                                >
                                    <Search className="mr-2 h-4 w-4" />
                                    Ara
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => listDriveItems(currentFolderId, "")}
                                    disabled={driveBusy}
                                >
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Yenile
                                </Button>
                            </div>

                            <div className="rounded-md border bg-white">
                                <div className="flex items-center justify-between border-b px-3 py-2">
                                    <label className="inline-flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={
                                                visibleSheetIds.length > 0 &&
                                                visibleSheetIds.every(id => selectedSheetIds.includes(id))
                                            }
                                            onCheckedChange={checked => toggleSelectAllVisibleSheets(checked === true)}
                                        />
                                        Gorunen tum sheet dosyalarini sec
                                    </label>
                                    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                                        <Checkbox
                                            checked={hideImportedFiles}
                                            onCheckedChange={checked => setHideImportedFiles(checked === true)}
                                        />
                                        Onceki aktarilanlari gizle
                                    </label>
                                    <Badge variant="outline">Secili dosya: {selectedSheetIds.filter(id => visibleSheetIds.includes(id)).length}</Badge>
                                </div>
                                <ScrollArea className="h-[300px]">
                                    <div className="divide-y">
                                        {displayedDriveItems.map(item => (
                                            <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                                                {isSpreadsheet(item) ? (
                                                    <Checkbox
                                                        checked={selectedSheetIds.includes(item.id)}
                                                        onCheckedChange={() => toggleSheetSelection(item)}
                                                    />
                                                ) : (
                                                    <span className="w-5" />
                                                )}

                                                {isFolder(item) ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => openDriveFolder(item)}
                                                        className="inline-flex items-center gap-2 text-left text-sm font-medium text-slate-700 hover:text-emerald-700"
                                                    >
                                                        <FolderOpen className="h-4 w-4 text-amber-600" />
                                                        {item.name}
                                                    </button>
                                                ) : (
                                                    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
                                                        <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                                                        {item.name}
                                                        <Badge
                                                            variant={importedFileIds.has(item.id) ? "secondary" : "outline"}
                                                            className={
                                                                importedFileIds.has(item.id)
                                                                    ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                                                    : "border-slate-200 text-slate-600"
                                                            }
                                                        >
                                                            {importedFileIds.has(item.id) ? "Aktarildi" : "Yeni"}
                                                        </Badge>
                                                    </span>
                                                )}
                                                <span className="ml-auto text-xs text-slate-400">
                                                    {item.modifiedTime ? fmtDateTime(item.modifiedTime) : "-"}
                                                </span>
                                            </div>
                                        ))}
                                        {displayedDriveItems.length === 0 && (
                                            <div className="px-3 py-8 text-center text-sm text-slate-400">
                                                {driveBusy ? "Drive liste yukleniyor..." : "Filtreye uygun oge bulunamadi."}
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs text-slate-600">
                                    Secili dosyalarin sadece net hafta tablari aktarilir. Ornek: <b>1. hafta</b>, <b>2. hafta</b>.
                                    <span className="ml-1">"1. hafta gdf", "pdf" gibi tablar atlanir.</span>
                                </div>
                                <Button
                                    type="button"
                                    onClick={importSelectedDriveSheets}
                                    disabled={importingSheets || selectedSheetIds.filter(id => visibleSheetIds.includes(id)).length === 0 || driveBusy}
                                >
                                    {importingSheets ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    Ayristir ve Onizle
                                </Button>
                            </div>

                            {(importLog || importStats) && (
                                <div className="rounded-md border bg-white px-3 py-2 text-sm">
                                    {importLog && <p className="text-slate-700">{importLog}</p>}
                                    {importStats && (
                                        <p className="mt-1 text-xs text-slate-500">
                                            Dosya: {importStats.files} | Taranan tab: {importStats.tabs} | Ingest kaydi: {importStats.entries} | Eslesen ID: {importStats.matchedFoodIds} | Eslesmeyen: {importStats.unknownFoods}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-5xl">
                    <DialogHeader>
                        <DialogTitle>Drive Ayristirma Onizleme</DialogTitle>
                        <DialogDescription>
                            Hasta tarafindaki akis gibi: once ayristirilan paketleri kontrol edin, sonra onayla havuza aktarin.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2 md:grid-cols-4">
                        <div className="rounded border p-2 text-sm">
                            <div className="text-xs text-slate-500">Dosya</div>
                            <div className="font-semibold">{previewFilesCount}</div>
                        </div>
                        <div className="rounded border p-2 text-sm">
                            <div className="text-xs text-slate-500">Tab</div>
                            <div className="font-semibold">{previewTabsCount}</div>
                        </div>
                        <div className="rounded border p-2 text-sm">
                            <div className="text-xs text-slate-500">Paket</div>
                            <div className="font-semibold">{previewEntries.length}</div>
                        </div>
                        <div className="rounded border p-2 text-sm">
                            <div className="text-xs text-slate-500">Toplam Yemek</div>
                            <div className="font-semibold">
                                {previewEntries.reduce(
                                    (total, entry) =>
                                        total + entry.parsed_days.reduce((sum, day) => sum + day.meals.reduce((m, meal) => m + meal.foods.length, 0), 0),
                                    0
                                )}
                            </div>
                        </div>
                    </div>
                    <ScrollArea className="h-[420px] rounded border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Dosya</TableHead>
                                    <TableHead>Tab</TableHead>
                                    <TableHead className="text-right">Hafta</TableHead>
                                    <TableHead className="text-right">Gun</TableHead>
                                    <TableHead className="text-right">Ogun</TableHead>
                                    <TableHead className="text-right">Yemek</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {previewEntries.map((entry, idx) => {
                                    const dayCount = entry.parsed_days.length
                                    const mealCount = entry.parsed_days.reduce((sum, day) => sum + day.meals.length, 0)
                                    const foodCount = entry.parsed_days.reduce(
                                        (sum, day) => sum + day.meals.reduce((mealSum, meal) => mealSum + meal.foods.length, 0),
                                        0
                                    )
                                    return (
                                        <TableRow key={`${entry.source_file_id}-${entry.source_tab_name}-${idx}`}>
                                            <TableCell className="max-w-[280px] truncate">{entry.source_file_name}</TableCell>
                                            <TableCell>{entry.source_tab_name}</TableCell>
                                            <TableCell className="text-right">{entry.week_number}</TableCell>
                                            <TableCell className="text-right">{dayCount}</TableCell>
                                            <TableCell className="text-right">{mealCount}</TableCell>
                                            <TableCell className="text-right font-medium">{foodCount}</TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setPreviewOpen(false)}
                            disabled={importingSheets}
                        >
                            Vazgec
                        </Button>
                        <Button
                            type="button"
                            onClick={confirmImportPreview}
                            disabled={importingSheets || previewEntries.length === 0}
                        >
                            {importingSheets ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Onayla ve Ise Aktar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle>Menu Havuzu</CardTitle>
                    <CardDescription>
                        Import edilen ogun paketlerini tarihe gore inceleyin, tekrar edenleri gorun, bilinmeyen yemekleri
                        buradan duzenleyip veritabanina ekleyin.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                        <div className="lg:col-span-2">
                            <Label>Ara</Label>
                            <Input
                                placeholder="Hasta / dosya / tab / gun / ogun / metin"
                                value={qInput}
                                onChange={e => setQInput(e.target.value)}
                            />
                        </div>
                        <div>
                            <Label>Kaynak</Label>
                            <Select value={sourceType} onValueChange={setSourceType}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Tum kaynaklar</SelectItem>
                                    <SelectItem value="google_sheets">Google Sheets</SelectItem>
                                    <SelectItem value="text">Metin / Excel</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Tarih Baslangic</Label>
                            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                        </div>
                        <div>
                            <Label>Tarih Bitis</Label>
                            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-sm">
                            <Checkbox checked={unknownOnly} onCheckedChange={v => setUnknownOnly(v === true)} />
                            Sadece bilinmeyen icerenleri goster
                        </label>
                        <div className="inline-flex items-center gap-2">
                            <Label className="text-sm">Sayfa boyutu</Label>
                            <Select
                                value={String(limit)}
                                onValueChange={value => {
                                    setLimit(Math.max(20, Math.min(500, Number(value) || 120)))
                                    setOffset(0)
                                }}
                            >
                                <SelectTrigger className="w-[100px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="50">50</SelectItem>
                                    <SelectItem value="120">120</SelectItem>
                                    <SelectItem value="250">250</SelectItem>
                                    <SelectItem value="500">500</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setQInput("")
                                    setQ("")
                                    setSourceType("all")
                                    setUnknownOnly(false)
                                    setDateFrom("")
                                    setDateTo("")
                                    setRoleFilters([])
                                    setCategoryFilters([])
                                    setRoleFilterMode("or")
                                    setCategoryFilterMode("or")
                                    clearSelection()
                                    setSortBy("created_at")
                                    setSortDir("desc")
                                    setOffset(0)
                                }}
                            >
                                Filtreleri Sifirla
                            </Button>
                            <Button
                                onClick={() => {
                                    setQ(qInput)
                                    setOffset(0)
                                    fetchRows()
                                }}
                            >
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Uygula
                            </Button>
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-4">
                        <Card>
                            <CardHeader className="py-3">
                                <CardDescription>Toplam Paket</CardDescription>
                                <CardTitle className="text-2xl">{summary?.total ?? 0}</CardTitle>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-3">
                                <CardDescription>Toplam Tekrar Sayimi</CardDescription>
                                <CardTitle className="text-2xl">{summary?.total_repeat_count ?? 0}</CardTitle>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-3">
                                <CardDescription>Toplam Bilinmeyen</CardDescription>
                                <CardTitle className="text-2xl">{summary?.total_unknown_count ?? 0}</CardTitle>
                            </CardHeader>
                        </Card>
                        <Card>
                            <CardHeader className="py-3">
                                <CardDescription>Sayfa</CardDescription>
                                <CardTitle className="text-2xl">
                                    {currentPage} / {totalPages}
                                </CardTitle>
                            </CardHeader>
                        </Card>
                    </div>

                    <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-700">Istemci Filtreleri</p>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                    setRoleFilters([])
                                    setCategoryFilters([])
                                    setRoleFilterMode("or")
                                    setCategoryFilterMode("or")
                                }}
                            >
                                Rol/Kategori temizle
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <MultiSelectDropdown
                                title="Rol Filtresi"
                                options={roleOptions}
                                selected={roleFilters}
                                onToggle={value => setRoleFilters(prev => toggleArrayValue(prev, value))}
                                onClear={() => setRoleFilters([])}
                            />
                            <div className="inline-flex items-center gap-1 rounded-md border bg-white px-1 py-1">
                                <span className="px-1 text-[11px] font-medium text-slate-500">Rol</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={roleFilterMode === "or" ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setRoleFilterMode("or")}
                                >
                                    VEYA
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={roleFilterMode === "and" ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setRoleFilterMode("and")}
                                >
                                    VE
                                </Button>
                            </div>
                            <MultiSelectDropdown
                                title="Kategori Filtresi"
                                options={categoryOptions}
                                selected={categoryFilters}
                                onToggle={value => setCategoryFilters(prev => toggleArrayValue(prev, value))}
                                onClear={() => setCategoryFilters([])}
                            />
                            <div className="inline-flex items-center gap-1 rounded-md border bg-white px-1 py-1">
                                <span className="px-1 text-[11px] font-medium text-slate-500">Kategori</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={categoryFilterMode === "or" ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setCategoryFilterMode("or")}
                                >
                                    VEYA
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={categoryFilterMode === "and" ? "default" : "outline"}
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setCategoryFilterMode("and")}
                                >
                                    VE
                                </Button>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {roleFilters.map(role => (
                                <Badge key={`rf-${role}`} variant="secondary">{role}</Badge>
                            ))}
                            {categoryFilters.map(category => (
                                <Badge key={`cf-${category}`} variant="outline">{category}</Badge>
                            ))}
                            {roleFilters.length === 0 && categoryFilters.length === 0 && (
                                <span className="text-xs text-slate-400">Aktif rol/kategori filtresi yok.</span>
                            )}
                            {roleFilters.length > 1 && (
                                <Badge variant="outline" className="text-[11px]">
                                    Rol Mantigi: {roleFilterMode === "and" ? "VE" : "VEYA"}
                                </Badge>
                            )}
                            {categoryFilters.length > 1 && (
                                <Badge variant="outline" className="text-[11px]">
                                    Kategori Mantigi: {categoryFilterMode === "and" ? "VE" : "VEYA"}
                                </Badge>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-slate-50 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={visibleSelectionState}
                                    onCheckedChange={checked => toggleSelectVisible(checked === true)}
                                />
                                Bu sayfadaki filtreli satirlari sec
                            </label>
                            <Badge variant="outline">Secili: {selectedRowIds.length}</Badge>
                            <Badge variant="secondary">Gorunen secili: {selectedVisibleCount}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={selectedRowIds.length === 0}
                                onClick={clearSelection}
                            >
                                Secimi Temizle
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={selectedRowIds.length === 0 || isDeletingSelected}
                                onClick={deleteSelectedRows}
                            >
                                {isDeletingSelected ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                Seciliyi Sil ({selectedRowIds.length})
                            </Button>
                        </div>
                    </div>

                    {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="w-[40px]">
                                        <Checkbox
                                            checked={visibleSelectionState}
                                            onCheckedChange={checked => toggleSelectVisible(checked === true)}
                                        />
                                    </TableHead>
                                    <TableHead>#</TableHead>
                                    <TableHead>
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("created_at")}>
                                            Kayit Tarihi {sortIcon("created_at")}
                                        </button>
                                    </TableHead>
                                    <TableHead>
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("source_patient_name")}>
                                            Hasta {sortIcon("source_patient_name")}
                                        </button>
                                    </TableHead>
                                    <TableHead>
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("week_number")}>
                                            Hafta {sortIcon("week_number")}
                                        </button>
                                    </TableHead>
                                    <TableHead>
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("source_tab_name")}>
                                            Tab {sortIcon("source_tab_name")}
                                        </button>
                                    </TableHead>
                                    <TableHead>
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("day_name")}>
                                            Gun {sortIcon("day_name")}
                                        </button>
                                    </TableHead>
                                    <TableHead>
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("meal_name")}>
                                            Ogun {sortIcon("meal_name")}
                                        </button>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("food_count")}>
                                            Yemek {sortIcon("food_count")}
                                        </button>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("unknown_count")}>
                                            Bilinmeyen {sortIcon("unknown_count")}
                                        </button>
                                    </TableHead>
                                    <TableHead className="text-right">
                                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("repeat_count")}>
                                            Tekrar {sortIcon("repeat_count")}
                                        </button>
                                    </TableHead>
                                    <TableHead>Detay</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading && (
                                    <TableRow>
                                        <TableCell colSpan={12} className="py-8 text-center text-slate-500">
                                            <span className="inline-flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Havuz yukleniyor...
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                )}

                                {!loading && filteredRows.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={12} className="py-8 text-center text-slate-500">
                                            Filtrelere uygun havuz kaydi bulunamadi.
                                        </TableCell>
                                    </TableRow>
                                )}

                                {!loading &&
                                    filteredRows.map((row, idx) => {
                                        const absoluteIndex = (summary?.offset || 0) + idx + 1
                                        const isExpanded = !!expandedRows[row.id]
                                        return (
                                            <Fragment key={row.id}>
                                                <TableRow key={row.id}>
                                                    <TableCell>
                                                        <Checkbox
                                                            checked={selectedRowIds.includes(row.id)}
                                                            onCheckedChange={checked => {
                                                                if (checked === true && !selectedRowIds.includes(row.id)) {
                                                                    toggleRowSelection(row.id)
                                                                }
                                                                if (checked === false && selectedRowIds.includes(row.id)) {
                                                                    toggleRowSelection(row.id)
                                                                }
                                                            }}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="font-medium">{absoluteIndex}</TableCell>
                                                    <TableCell>{fmtDateTime(row.created_at)}</TableCell>
                                                    <TableCell>{row.source_patient_name || "-"}</TableCell>
                                                    <TableCell>{row.week_label || (row.week_number ? `${row.week_number}. hafta` : "-")}</TableCell>
                                                    <TableCell>
                                                        <div className="max-w-[220px]">
                                                            <p className="truncate font-medium">
                                                                {row.source_tab_name || "-"}
                                                                {(row.source_tab_names?.length || 0) > 1 ? ` (+${(row.source_tab_names?.length || 1) - 1})` : ""}
                                                            </p>
                                                            <p className="truncate text-xs text-slate-500">{row.source_file_name || "-"}</p>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>{formatDay(row.day_name)}</TableCell>
                                                    <TableCell>{row.meal_name || "-"}</TableCell>
                                                    <TableCell className="text-right">{row.food_count || 0}</TableCell>
                                                    <TableCell className="text-right">
                                                        <span className={row.unknown_count > 0 ? "font-semibold text-amber-700" : "text-slate-500"}>
                                                            {row.unknown_count || 0}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right">{row.repeat_count || 1}</TableCell>
                                                    <TableCell>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() =>
                                                                setExpandedRows(prev => ({ ...prev, [row.id]: !prev[row.id] }))
                                                            }
                                                        >
                                                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>

                                                {isExpanded && (
                                                    <TableRow key={`${row.id}-detail`} className="bg-slate-50/60">
                                                        <TableCell colSpan={12}>
                                                            <div className="space-y-3 p-2">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="text-xs font-semibold text-slate-600">Roller:</span>
                                                                    {row.roles.length > 0 ? (
                                                                        row.roles.map(role => (
                                                                            <Badge key={`${row.id}-role-${role}`} variant="secondary">
                                                                                {role}
                                                                            </Badge>
                                                                        ))
                                                                    ) : (
                                                                        <span className="text-xs text-slate-500">Yok</span>
                                                                    )}
                                                                    <span className="ml-3 text-xs font-semibold text-slate-600">Kategoriler:</span>
                                                                    {row.categories.length > 0 ? (
                                                                        row.categories.map(category => (
                                                                            <Badge key={`${row.id}-cat-${category}`} variant="outline">
                                                                                {category}
                                                                            </Badge>
                                                                        ))
                                                                    ) : (
                                                                        <span className="text-xs text-slate-500">Yok</span>
                                                                    )}
                                                                </div>

                                                                {(row.source_tab_names?.length || 0) > 1 && (
                                                                    <div className="rounded-md border bg-white p-2">
                                                                        <p className="mb-1 text-xs font-semibold text-slate-600">Bu paketin geldigi tablar</p>
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(row.source_tab_names || []).map(tabName => (
                                                                                <Badge key={`${row.id}-tab-${tabName}`} variant="outline">
                                                                                    {tabName}
                                                                                </Badge>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                <div className="grid gap-2 md:grid-cols-2">
                                                                    {row.foods.map((food, foodIdx) => {
                                                                        const isUnknown = !food.matched_food_id
                                                                        return (
                                                                            <div key={`${row.id}-food-${foodIdx}`} className="rounded-lg border bg-white p-3">
                                                                                <div className="mb-2 flex items-start justify-between gap-2">
                                                                                    <p className="text-sm font-semibold text-slate-800">{food.label || "-"}</p>
                                                                                    {isUnknown ? (
                                                                                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Bilinmeyen</Badge>
                                                                                    ) : (
                                                                                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Eslesti</Badge>
                                                                                    )}
                                                                                </div>
                                                                                <div className="space-y-1 text-xs text-slate-600">
                                                                                    <p><span className="font-medium">Kal/Karb/Prot/Yag:</span> {food.calories} / {food.carbs} / {food.protein} / {food.fat}</p>
                                                                                    <p><span className="font-medium">Rol:</span> {food.role || "-"}</p>
                                                                                    <p><span className="font-medium">Kategori:</span> {food.category || "-"}</p>
                                                                                    <p className="truncate"><span className="font-medium">Eslesen kayit:</span> {food.db_name || "-"}</p>
                                                                                </div>
                                                                                <div className="mt-3">
                                                                                    {isUnknown ? (
                                                                                        <Button type="button" size="sm" variant="outline" onClick={() => openDraft(row, food.label)}>
                                                                                            <PlusCircle className="mr-1 h-3.5 w-3.5" />
                                                                                            Duzenle ve Ekle
                                                                                        </Button>
                                                                                    ) : (
                                                                                        <span className="text-xs text-slate-500">Kayitli yemekte kullaniliyor.</span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </Fragment>
                                        )
                                    })}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" disabled={currentPage <= 1 || loading} onClick={() => setOffset(prev => Math.max(0, prev - limit))}>
                            Onceki
                        </Button>
                        <Button variant="outline" disabled={!summary || currentPage >= totalPages || loading} onClick={() => setOffset(prev => prev + limit)}>
                            Sonraki
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {draft && (
                <FoodEditDialog
                    isOpen={Boolean(draft)}
                    onClose={() => setDraft(null)}
                    onUpdate={fetchRows}
                    mode="create"
                    food={{
                        id: "",
                        name: draft.name || draft.unknownName,
                        role: draft.role || "sideDish",
                        category: draft.category || "AI Onerisi",
                        calories: asFiniteNumber(draft.calories, 0),
                        carbs: asFiniteNumber(draft.carbs, 0),
                        protein: asFiniteNumber(draft.protein, 0),
                        fat: asFiniteNumber(draft.fat, 0),
                        tags: splitTags(draft.tags),
                        compatibility_tags: splitTags(draft.compatibility_tags),
                        min_quantity: 1,
                        max_quantity: 1,
                        step: 1,
                        multiplier: 1,
                        portion_fixed: false,
                        season_start: 1,
                        season_end: 12,
                        meal_types: [],
                        filler_lunch: false,
                        filler_dinner: false,
                        max_weekly_freq: null,
                        min_weekly_freq: null,
                        priority_score: 5,
                        notes: "",
                        ingredients: "",
                        recipe_text: "",
                    }}
                    onSave={saveDraft}
                />
            )}

            {false && (
            <Dialog open={false} onOpenChange={open => !open && setDraft(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Bilinmeyen YemeÄŸi VeritabanÄ±na Ekle</DialogTitle>
                        <DialogDescription>Bu kayÄ±t havuz satÄ±rÄ±na otomatik iÅŸlenecek ve bilinmeyen listeden dÃ¼ÅŸecek.</DialogDescription>
                    </DialogHeader>
                    {draft && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <Label>Yemek AdÄ±</Label>
                                    <Input value={draft?.name ?? ""} onChange={e => setDraft(prev => (prev ? { ...prev, name: e.target.value } : prev))} />
                                </div>
                                <div>
                                    <Label>Rol</Label>
                                    <Select value={draft?.role ?? "sideDish"} onValueChange={value => setDraft(prev => (prev ? { ...prev, role: value } : prev))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {FOOD_ROLES.map(role => (
                                                <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>Kategori</Label>
                                    <Select value={draft?.category ?? "AI Onerisi"} onValueChange={value => setDraft(prev => (prev ? { ...prev, category: value } : prev))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {FOOD_CATEGORIES.map(category => (
                                                <SelectItem key={category} value={category}>{category}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div><Label>Kalori</Label><Input value={draft?.calories ?? "0"} onChange={e => setDraft(prev => (prev ? { ...prev, calories: e.target.value } : prev))} /></div>
                                <div><Label>Karb</Label><Input value={draft?.carbs ?? "0"} onChange={e => setDraft(prev => (prev ? { ...prev, carbs: e.target.value } : prev))} /></div>
                                <div><Label>Prot</Label><Input value={draft?.protein ?? "0"} onChange={e => setDraft(prev => (prev ? { ...prev, protein: e.target.value } : prev))} /></div>
                                <div><Label>Yag</Label><Input value={draft?.fat ?? "0"} onChange={e => setDraft(prev => (prev ? { ...prev, fat: e.target.value } : prev))} /></div>
                                <div><Label>Etiketler (virgulle)</Label><Input value={draft?.tags ?? ""} onChange={e => setDraft(prev => (prev ? { ...prev, tags: e.target.value } : prev))} /></div>
                                <div><Label>Uyumluluk Etiketleri</Label><Input value={draft?.compatibility_tags ?? ""} onChange={e => setDraft(prev => (prev ? { ...prev, compatibility_tags: e.target.value } : prev))} /></div>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDraft(null)} disabled={savingDraft}>VazgeÃ§</Button>
                        <Button onClick={saveDraft} disabled={savingDraft || !draft}>
                            {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Kaydet ve Havuzu Guncelle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            )}
        </div>
    )
}

