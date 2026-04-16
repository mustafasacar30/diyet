"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw, ChevronDown, ChevronUp, ArrowDown, ArrowUp, ArrowUpDown, PlusCircle, Trash2 } from "lucide-react"
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

    const roleOptions = useMemo(
        () =>
            Array.from(new Set(rows.flatMap(row => row.roles).map(v => v.trim()).filter(Boolean))).sort((a, b) =>
                a.localeCompare(b, "tr")
            ),
        [rows]
    )
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
                        <DialogTitle>Bilinmeyen Yemeği Veritabanına Ekle</DialogTitle>
                        <DialogDescription>Bu kayıt havuz satırına otomatik işlenecek ve bilinmeyen listeden düşecek.</DialogDescription>
                    </DialogHeader>
                    {draft && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="col-span-2">
                                    <Label>Yemek Adı</Label>
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
                        <Button variant="outline" onClick={() => setDraft(null)} disabled={savingDraft}>Vazgeç</Button>
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
