"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import { Search, Filter, Plus, X, Edit2, Check, Settings, Save, Trash2, Pencil, AlertTriangle, Heart, Info, RefreshCw } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDraggable } from '@dnd-kit/core'
import { cn } from "@/lib/utils"
// Import raw JSON data
import foodListData from '@/data/food_list.json'
import { checkCompatibility } from "@/utils/compatibility-checker"
import { normalizeFoodName } from "@/utils/recipe-matcher"
import { useRecipeManager } from "@/hooks/use-recipe-manager"
import { FOOD_ROLES, ROLE_LABELS as SHARED_ROLE_LABELS } from "@/lib/constants/food-roles"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"
import { getFoodMicronutrientsByScope } from "@/lib/team-food-micronutrient-overrides"

import { FOOD_CATEGORIES } from "@/lib/constants/food-categories"
import { useSidebar } from "@/contexts/sidebar-context"
import { useAuth } from "@/contexts/auth-context"


// ================== FILTER CONFIGURATION ==================
type FilterFieldConfig = {
    value: string
    label: string
    type: 'text' | 'select' | 'boolean' | 'number'
    options?: string[]
}


const DEFAULT_FILTER_FIELDS: FilterFieldConfig[] = [
    { value: 'name', label: 'İsim', type: 'text' },
    { value: 'category', label: 'Kategori', type: 'select', options: [...FOOD_CATEGORIES, 'KAYITSIZLAR'] },
    { value: 'role', label: 'Rol', type: 'select', options: FOOD_ROLES.map(r => r.value) },

    { value: 'dietType', label: 'Diyet Türü', type: 'select', options: ['ketojenik', 'lowcarb', 'vegan', 'vejeteryan'] },
    { value: 'tags', label: 'Etiket', type: 'text' },
    { value: 'minCalories', label: 'Min Kalori', type: 'number' },
    { value: 'maxCalories', label: 'Max Kalori', type: 'number' },
    { value: 'minProtein', label: 'Min Protein', type: 'number' },
    { value: 'maxProtein', label: 'Max Protein', type: 'number' },
    { value: 'minCarbs', label: 'Min Karb', type: 'number' },
    { value: 'maxCarbs', label: 'Max Karb', type: 'number' },
    { value: 'minFat', label: 'Min Yağ', type: 'number' },
    { value: 'maxFat', label: 'Max Yağ', type: 'number' },
]


const ROLE_LABELS = SHARED_ROLE_LABELS

type FilterCriteria = { id: number; field: string; value: string }

// Helper function to check if food name contains any disliked word
function containsDislikedWord(foodName: string, dislikedFoods: string[]): boolean {
    if (!dislikedFoods || dislikedFoods.length === 0) return false
    const lowerName = foodName.toLowerCase()
    return dislikedFoods.some(disliked => lowerName.includes(disliked.toLowerCase()))
}

const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

function checkSeasonality(food: any, targetDate?: Date): { inSeason: boolean, reason?: string } {
    if (!targetDate) return { inSeason: true }

    // Default to full year if fields match default logic or are missing
    const sStart = food.season_start || 1
    const sEnd = food.season_end || 12

    if (sStart === 1 && sEnd === 12) return { inSeason: true }

    const month = targetDate.getMonth() + 1 // 1-12

    let inSeason = false
    if (sStart <= sEnd) {
        // Normal range (e.g. 5-9)
        inSeason = month >= sStart && month <= sEnd
    } else {
        // Cross-year range (e.g. 11-4)
        inSeason = month >= sStart || month <= sEnd
    }

    if (!inSeason) {
        return { inSeason: false, reason: `Sezon Dışı (${MONTH_NAMES[sStart - 1]} - ${MONTH_NAMES[sEnd - 1]})` }
    }
    return { inSeason: true }
}

export function FoodSidebar({
    dislikedFoods = [],
    activeDietRules,
    referenceDate,
    patientName,
    likedFoods = [],
    onEditProfile,
    mealCounts,
    defaultSort = null,
    onSortChange,
    customFoods = [],
    patientDiseases = [],
    patientLabs = [],
    patientMedicationRules = [],
    foodMicronutrients = {},
    patientId
}: {
    dislikedFoods?: string[],
    activeDietRules?: { allowedTags: string[], bannedKeywords: string[], bannedTags?: string[], dietName: string },
    referenceDate?: Date,
    patientName?: string,
    likedFoods?: string[],
    onEditProfile?: () => void,
    mealCounts?: Map<string, number>,
    defaultSort?: 'asc' | 'desc' | null,
    onSortChange?: (sort: 'asc' | 'desc' | null) => void,
    customFoods?: any[],
    patientDiseases?: any[],
    patientLabs?: any[],
    patientMedicationRules?: any[],
    foodMicronutrients?: Record<string, string[]>,
    onSave?: (data: any) => Promise<any>,
    patientId?: string
}) {
    const { scopeMode } = useAuth()
    const { isSidebarCollapsed } = useSidebar()
    const [filterFields, setFilterFields] = useState<FilterFieldConfig[]>(DEFAULT_FILTER_FIELDS)
    const [filters, setFilters] = useState<FilterCriteria[]>([
        { id: 1, field: 'name', value: '' },
        { id: 2, field: 'category', value: '' }
    ])
    // ... rest of the component state ...
    const [foods, setFoods] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [nextId, setNextId] = useState(3)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [showCompatibleOnly, setShowCompatibleOnly] = useState(false)
    const [sortByCount, setSortByCount] = useState<'asc' | 'desc' | null>(defaultSort)

    useEffect(() => {
        if (defaultSort !== undefined) {
            setSortByCount(defaultSort)
        }
    }, [defaultSort])

    const handleSortChange = (newSort: 'asc' | 'desc' | null) => {
        setSortByCount(newSort)
        onSortChange?.(newSort)
    }

    // ... migrateFromJSON ...
    async function migrateFromJSON() {
        if (!confirm('Tüm yemek veritabanı JSON dosyasındaki verilerle güncellenecek. Bu işlem biraz sürebilir. Devam edilsin mi?')) return
        // ... implementation ...
        setLoading(true)
        try {
            // 1. Fetch all existing foods to match by name
            const { data: existingFoods } = await supabase.from('foods').select('id, name')
            const foodMap = new Map((existingFoods || []).map((f: any) => [f.name.trim().toLowerCase(), f.id]))

            let updatedCount = 0
            let insertedCount = 0

            for (const category of foodListData.categories) {
                for (const item of category.items as any[]) {
                    let seasonStart = 1, seasonEnd = 12
                    try {
                        if (item.seasonRange) {
                            const range = JSON.parse(item.seasonRange)
                            if (Array.isArray(range) && range.length === 2) {
                                seasonStart = range[0]
                                seasonEnd = range[1]
                            }
                        }
                    } catch (e) { }

                    const dbItem = {
                        name: item.name,
                        category: item.category || category.name,
                        calories: item.calories,
                        protein: item.protein,
                        carbs: item.carbs,
                        fat: item.fat,
                        role: item.role,
                        min_quantity: item.minQuantity,
                        max_quantity: item.maxQuantity,
                        step: item.step,
                        multiplier: item.multiplier,
                        portion_fixed: item.portionFixed,
                        keto: item.keto,
                        lowcarb: item.lowcarb,
                        vegan: item.dietTypes?.includes('vegan') || false,
                        vejeteryan: item.dietTypes?.includes('vejeteryan') || false,
                        meal_types: item.mealType,
                        filler_lunch: item.fillerLunch,
                        filler_dinner: item.fillerDinner,
                        season_start: seasonStart,
                        season_end: seasonEnd,
                        tags: item.tags,
                        compatibility_tags: item.compatibilityTags,
                        notes: item.notes
                    }

                    const normalizedName = item.name.trim().toLowerCase()
                    const existingId = foodMap.get(normalizedName)

                    if (existingId) {
                        // Update existing
                        const { error } = await supabase.from('foods').update(dbItem).eq('id', existingId)
                        if (error) console.error('Error updating:', item.name, error)
                        else updatedCount++
                    } else {
                        // Insert new
                        const { error } = await supabase.from('foods').insert(dbItem)
                        if (error) console.error('Error inserting:', item.name, error)
                        else insertedCount++
                    }
                }
            }
            alert(`İşlem tamamlandı!\nGüncellenen: ${updatedCount}\nYeni Eklenen: ${insertedCount}`)
            fetchFoods()
        } catch (e: any) {
            alert('Hata: ' + e.message)
        }
        setLoading(false)
    }

    useEffect(() => {
        loadFilterFieldsFromDB()
    }, [])

    async function loadFilterFieldsFromDB() {
        const { data } = await supabase.from('system_settings').select('value').eq('key', 'filter_fields').maybeSingle()
        if (data?.value) setFilterFields(data.value as FilterFieldConfig[])
    }

    async function saveFilterFieldsToDB(fields: FilterFieldConfig[]) {
        await supabase.from('system_settings').upsert({ key: 'filter_fields', value: fields, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        setFilterFields(fields)
    }

    useEffect(() => {
        const timer = setTimeout(() => {
            const hasValid = filters.some(f => {
                const fc = filterFields.find(ff => ff.value === f.field)
                if (fc?.type === 'number' || fc?.type === 'select') return f.value !== ''
                return f.value.length >= 3
            })
            if (hasValid) fetchFoods()
            else setFoods([])
        }, 300)
        return () => clearTimeout(timer)
    }, [filters, filterFields])

    async function fetchFoods() {
        setLoading(true)
        // Include food_micronutrients for proper micronutrient association detection in checkCompatibility
        let query = supabase.from('foods').select('*, food_micronutrients(micronutrient_id)')

        try {
            const { userId, role, canUseGlobal, teamOwnerId } = await resolveTeamScopeContextFromAuth()
            const canToggleForCurrentUser = role === 'doctor' && canUseGlobal && !!userId
            const mergedTeamOwnerId =
                canToggleForCurrentUser && scopeMode === 'team'
                    ? userId
                    : teamOwnerId

            if (mergedTeamOwnerId) {
                query = query.or(`hidden_from_cardmaker.is.null,hidden_from_cardmaker.eq.false,meta->>team_owner_id.eq.${mergedTeamOwnerId}`)
            } else {
                query = query.or('hidden_from_cardmaker.is.null,hidden_from_cardmaker.eq.false')
            }
        } catch (e) {
            query = query.or('hidden_from_cardmaker.is.null,hidden_from_cardmaker.eq.false')
        }

        for (const filter of filters) {
            if (!filter.value) continue
            switch (filter.field) {
                case 'name':
                    if (filter.value.length >= 3) {
                        const words = filter.value.toLowerCase().split(/\s+/).filter(w => w.length >= 2)
                        for (const word of words) query = query.ilike('name', `%${word}%`)
                    }
                    break
                case 'category':
                case 'role':
                    query = query.eq(filter.field, filter.value)
                    break
                case 'dietType':
                    if (filter.value === 'keto' || filter.value === 'ketojenik') query = query.eq('keto', true)
                    else if (filter.value === 'lowcarb') query = query.or('lowcarb.eq.true,keto.eq.true')
                    else if (filter.value === 'vegan') query = query.eq('vegan', true)
                    else if (filter.value === 'vejeteryan') query = query.eq('vejeteryan', true)
                    break
                case 'tags':
                    if (filter.value.length >= 2) {
                        const words = filter.value.toLowerCase().split(/\s+/).filter(w => w.length >= 2)
                        for (const word of words) query = query.contains('tags', [word])
                    }
                    break
                case 'minCalories':
                    query = query.gte('calories', parseInt(filter.value))
                    break
                case 'maxCalories':
                    query = query.lte('calories', parseInt(filter.value))
                    break
                case 'minProtein':
                    query = query.gte('protein', parseInt(filter.value))
                    break
                case 'maxProtein':
                    query = query.lte('protein', parseInt(filter.value))
                    break
                case 'minCarbs':
                    query = query.gte('carbs', parseInt(filter.value))
                    break
                case 'maxCarbs':
                    query = query.lte('carbs', parseInt(filter.value))
                    break
                case 'minFat':
                    query = query.gte('fat', parseInt(filter.value))
                    break
                case 'maxFat':
                    query = query.lte('fat', parseInt(filter.value))
                    break
            }
        }

        const { data } = await query.limit(50)
        if (data) {
            let allFoods = [...data]

            // If viewing all categories or specifically "Kayıtsızlar", include custom foods
            const categoryFilter = filters.find(f => f.field === 'category')
            const shouldShowCustom = !categoryFilter?.value || categoryFilter.value === 'KAYITSIZLAR'

            if (shouldShowCustom && customFoods && customFoods.length > 0) {
                // Filter custom foods if there is a name filter
                const nameFilter = filters.find(f => f.field === 'name')
                let filteredCustom = customFoods

                if (nameFilter?.value && nameFilter.value.length >= 3) {
                    const words = nameFilter.value.toLowerCase().split(/\s+/).filter(w => w.length >= 2)
                    filteredCustom = filteredCustom.filter(cf =>
                        words.every(w => cf.name.toLowerCase().includes(w))
                    )
                }

                // Append custom foods
                allFoods = [...allFoods, ...filteredCustom]
            }

            // Deduplicate by normalized name AND calories (to keep distinct variants)
            // If name AND calories are same, we consider it duplicate.
            const uniqueFoods = new Map()
            allFoods.forEach(food => {
                const key = `${food.name.trim().toLowerCase()}_${food.calories}`
                if (!uniqueFoods.has(key)) {
                    uniqueFoods.set(key, food)
                }
            })

            const resolvedFoods = Array.from(uniqueFoods.values()).map((food: any) => {
                const overrideMicronutrients = foodMicronutrients?.[food.id]
                if (!Array.isArray(overrideMicronutrients)) return food
                return {
                    ...food,
                    micronutrients: overrideMicronutrients,
                    food_micronutrients: overrideMicronutrients.map((micronutrientId: string) => ({
                        micronutrient_id: micronutrientId
                    }))
                }
            })

            setFoods(resolvedFoods)
        }
        setLoading(false)
    }

    function addFilter() {
        setFilters([...filters, { id: nextId, field: 'name', value: '' }])
        setNextId(nextId + 1)
    }

    function removeFilter(id: number) {
        if (filters.length > 1) setFilters(filters.filter(f => f.id !== id))
    }

    function updateFilter(id: number, updates: Partial<FilterCriteria>) {
        setFilters(filters.map(f => f.id === id ? { ...f, ...updates } : f))
    }

    function refreshFoods() {
        fetchFoods()
    }

    // Filter foods by compatibility switch
    const displayedFoods = showCompatibleOnly && activeDietRules
        ? foods.filter(f => checkCompatibility(f, activeDietRules).compatible)
        : foods

    // Sort foods by usage count (0-count always at bottom)
    // Sort foods by Compatibility (Positive > Neutral > Negative) then by Usage/Name
    const sortedFoods = useMemo(() => {
        // 1. Calculate compatibility scores logic
        // Score 3: Positive (Recommended/Compatible with positive rules)
        // Score 2: Neutral (Compatible)
        // Score 1: Negative (Incompatible)

        const scoredFoods = displayedFoods.map(food => {
            // We need to re-run checkCompatibility here to get the 'recommended' status
            // checkCompatibility returns : { compatible: boolean, recommended?: boolean ... }
            const status = activeDietRules
                ? checkCompatibility(food, activeDietRules, patientDiseases, patientLabs, patientMedicationRules)
                : { compatible: true, recommended: false }

            // Preference checks
            // Re-use logic: if food name contains disliked word -> Disliked
            const isDisliked = dislikedFoods?.some(d => food.name.toLocaleLowerCase('tr-TR').includes(d.toLocaleLowerCase('tr-TR')))
            // If food name contains liked word -> Liked
            const isLiked = likedFoods?.some(l => food.name.toLocaleLowerCase('tr-TR').includes(l.toLocaleLowerCase('tr-TR')))

            let score = 2 // Default Neutral

            // Priority Logic:
            // 1. Incompatible OR Disliked -> Score 1 (Negative)
            // 2. Recommended OR Liked -> Score 3 (Positive)
            // 3. Else -> Score 2 (Neutral)

            if (!status.compatible || isDisliked) {
                score = 1 // Negative
            } else if (status.recommended || isLiked) {
                score = 3 // Positive
            }

            const countKey = food.id || food.name?.toLowerCase().trim()
            const count = mealCounts?.get(countKey) || 0

            return { ...food, _compatScore: score, _count: count }
        })


        // 2. Sort
        scoredFoods.sort((a, b) => {
            // First: Compatibility Score DESC
            if (a._compatScore !== b._compatScore) {
                return b._compatScore - a._compatScore
            }

            // Second: Usage Count (if sort active)
            if (sortByCount) {
                if (sortByCount === 'asc') return a._count - b._count
                return b._count - a._count
            }

            // Third: Name ASC (default fallback)
            return a.name.localeCompare(b.name, 'tr-TR')
        })

        return scoredFoods
    }, [displayedFoods, sortByCount, mealCounts, activeDietRules, patientDiseases, patientLabs, patientMedicationRules])

    return (
        <div className="w-full border-r bg-white flex flex-col h-full overflow-hidden">
            
            {/* LİPODEM MERKEZİ Branding Header */}
            {!isSidebarCollapsed && (
                <div className="p-4 border-b flex items-center justify-center font-bold tracking-widest text-[#1a5f7a] bg-slate-50">
                    LİPODEM MERKEZİ
                </div>
            )}

            {/* Patient Info Header */}
            {!isSidebarCollapsed && (
                <div className="p-3 border-b bg-gray-50/50 space-y-2">
                    <div className="group font-bold text-xs text-gray-500/80 flex items-center justify-between gap-2 px-1">
                    <span className="uppercase tracking-wider">Hasta Tercihleri</span>
                    {onEditProfile && (
                        <button onClick={onEditProfile} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-opacity" title="Profili Düzenle">
                            <Edit2 size={14} className="text-gray-500" />
                        </button>
                    )}
                </div>
                <div className="space-y-1">
                    {likedFoods && likedFoods.length > 0 && (
                        <div
                            className={cn("text-xs flex items-center gap-1 overflow-hidden", onEditProfile && "cursor-pointer hover:bg-gray-100 p-0.5 rounded transition-colors")}
                            title={likedFoods.join(', ')}
                            onClick={onEditProfile}
                        >
                            <span className="shrink-0 text-red-500">❤️</span>
                            <div className="text-gray-600 truncate">
                                {likedFoods.join(', ')}
                            </div>
                        </div>
                    )}
                    {dislikedFoods && dislikedFoods.length > 0 && (
                        <div
                            className={cn("text-xs flex items-center gap-1 overflow-hidden", onEditProfile && "cursor-pointer hover:bg-gray-100 p-0.5 rounded transition-colors")}
                            title={dislikedFoods.join(', ')}
                            onClick={onEditProfile}
                        >
                            <span className="shrink-0 text-gray-500">🚫</span>
                            <div className="text-gray-400 truncate decoration-1">
                                {dislikedFoods.join(', ')}
                            </div>
                        </div>
                    )}
                    {/* If lists are empty, show 'Add' placeholders if editable */}
                    {onEditProfile && (!likedFoods || likedFoods.length === 0) && (
                        <div className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600 flex items-center gap-1" onClick={onEditProfile}>
                            <Plus size={10} /> Sevilen Ekle
                        </div>
                    )}
                    {onEditProfile && (!dislikedFoods || dislikedFoods.length === 0) && (
                        <div className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600 flex items-center gap-1" onClick={onEditProfile}>
                            <Plus size={10} /> Sevilmeyen Ekle
                        </div>
                    )}
                </div>
            </div>
            )}

            <div className="p-2 border-b space-y-2 bg-gray-50">
                <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">Yemek Ara</span>
                    <div className="flex gap-0.5">
                        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                            <DialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"><Settings size={14} /></Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                                <DialogHeader><DialogTitle>Filtre Ayarları</DialogTitle></DialogHeader>
                                <FilterSettingsPanel fields={filterFields} onSave={(f) => { saveFilterFieldsToDB(f); setSettingsOpen(false); }} />

                                <div className="border-t pt-4 mt-6">
                                    <h4 className="text-sm font-medium mb-3">Veri Yönetimi (Admin)</h4>
                                    <div className="p-3 bg-yellow-50 border border-yellow-100 rounded-md">
                                        <p className="text-xs text-yellow-800 mb-3">
                                            Bu işlem <b>food_list.json</b> dosyasındaki tüm yemekleri ve özellikleri veritabanına aktarır.
                                            Eksik alanlar (keto, lowcarb, mevsim vb.) doldurulur.
                                        </p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={migrateFromJSON}
                                            disabled={loading}
                                            className="w-full bg-white hover:bg-yellow-100 border-yellow-200 text-yellow-900"
                                        >
                                            JSON Verileriyle Veritabanını Güncelle
                                        </Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addFilter}>
                            <Plus size={12} className="mr-0.5" /> Filtre
                        </Button>
                    </div>
                </div>

                {/* Compatibility Switch */}
                {activeDietRules && (
                    <div className="flex items-center gap-2 px-1">
                        <label className="flex items-center gap-2 text-xs select-none cursor-pointer">
                            <input type="checkbox" checked={showCompatibleOnly} onChange={e => setShowCompatibleOnly(e.target.checked)} className="rounded" />
                            Sadece {activeDietRules.dietName} Uyumlu
                        </label>
                    </div>
                )}

                {filters.map(filter => (
                    <div key={filter.id} className="flex gap-1 items-center">
                        <select
                            className="w-20 text-[10px] border rounded px-1 py-1 bg-gray-50"
                            value={filter.field}
                            onChange={e => updateFilter(filter.id, { field: e.target.value, value: '' })}
                        >
                            {filterFields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>

                        {filterFields.find(f => f.value === filter.field)?.type === 'text' && (
                            <Input placeholder="3+ karakter" className="flex-1 h-6 text-xs px-2" value={filter.value} onChange={e => updateFilter(filter.id, { value: e.target.value })} />
                        )}
                        {filterFields.find(f => f.value === filter.field)?.type === 'number' && (
                            <Input type="number" placeholder="0" className="flex-1 h-6 text-xs px-2" value={filter.value} onChange={e => updateFilter(filter.id, { value: e.target.value })} />
                        )}
                        {filterFields.find(f => f.value === filter.field)?.type === 'select' && (
                            <select className="flex-1 text-[10px] border rounded px-1 py-1 bg-white" value={filter.value} onChange={e => updateFilter(filter.id, { value: e.target.value })}>
                                <option value="">Seçin...</option>
                                <option value="">Hepsi</option>
                                {filterFields.find(f => f.value === filter.field)?.options?.map(opt => (
                                    <option key={opt} value={opt}>{ROLE_LABELS[opt] || opt}</option>
                                ))}
                            </select>
                        )}

                        {filters.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFilter(filter.id)}><X size={12} /></Button>
                        )}
                    </div>
                ))}
            </div>

            {/* Sort Buttons */}
            <div className="flex gap-1 px-1.5 pb-1 border-b">
                <button
                    className={`flex-1 text-[10px] py-1 rounded border transition-colors ${sortByCount === 'asc' ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                    onClick={() => handleSortChange(sortByCount === 'asc' ? null : 'asc')}
                    title="En az kullanılandan başla (0 kullanılanlar sonda)"
                >
                    ↑ En Az
                </button>
                <button
                    className={`flex-1 text-[10px] py-1 rounded border transition-colors ${sortByCount === 'desc' ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                    onClick={() => handleSortChange(sortByCount === 'desc' ? null : 'desc')}
                    title="En çok kullanılandan başla (0 kullanılanlar sonda)"
                >
                    ↓ En Çok
                </button>
            </div>

            <div className="flex-1 overflow-auto p-1.5 space-y-1">
                {loading && <div className="text-center text-xs text-gray-400 py-2">Aranıyor...</div>}

                {sortedFoods.map(food => {
                    const countKey = food.id || food.name?.toLowerCase().trim()
                    const count = mealCounts?.get(countKey) || 0
                    return (
                        <DraggableFoodItem
                            key={food.id}
                            food={food}
                            onUpdate={refreshFoods}
                            dislikedFoods={dislikedFoods}
                            activeDietRules={activeDietRules}
                            referenceDate={referenceDate}
                            count={count}
                            patientDiseases={patientDiseases}
                            patientLabs={patientLabs}
                            patientMedicationRules={patientMedicationRules}
                            patientId={patientId}
                        />
                    )
                })}

                {!loading && sortedFoods.length === 0 && filters.some(f => f.value && f.value.length >= 3) && (
                    <div className="text-center text-xs text-gray-400 py-2">Sonuç bulunamadı</div>
                )}
                {!loading && sortedFoods.length === 0 && !filters.some(f => f.value && f.value.length >= 3) && (
                    <div className="text-center text-xs text-gray-400 py-2">3+ karakter yazın</div>
                )}

                {!loading && sortedFoods.length > 0 && (
                    <div className="text-center text-[10px] text-gray-300 pt-1">{displayedFoods.length} sonuç</div>
                )}
            </div>
        </div>
    )
}

// ================== DRAGGABLE FOOD ITEM ==================
function DraggableFoodItem({ food, onUpdate, dislikedFoods = [], activeDietRules, referenceDate, count = 0, patientDiseases = [], patientLabs = [], patientMedicationRules = [], patientId }: { food: any; onUpdate: () => void; dislikedFoods?: string[], activeDietRules?: any, referenceDate?: Date, count?: number, patientDiseases?: any[], patientLabs?: any[], patientMedicationRules?: any[], patientId?: string }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `food-${food.id}`,
        data: { type: 'food', food }
    })
    const [editOpen, setEditOpen] = useState(false)
    const isDisliked = containsDislikedWord(food.name || '', dislikedFoods)

    // Check compatibility
    const compatibility = checkCompatibility(food, activeDietRules, patientDiseases, patientLabs, patientMedicationRules)
    const isCompatible = compatibility.compatible
    const isRecommended = compatibility.recommended

    // Check Seasonality
    const seasonality = checkSeasonality(food, referenceDate)

    // Build hover tooltip (Base info)
    const buildTooltip = () => {
        const parts: string[] = []
        if (isDisliked) parts.push('🚫 Hastanın sevmediği besin')

        if (!isCompatible && compatibility.reason && !compatibility.warnings?.length) parts.push(`⚠️ ${compatibility.reason}`)
        if (isRecommended && compatibility.diseaseName && !compatibility.warnings?.length) parts.push(`💙 Önerilen: ${compatibility.diseaseName}`)
        if (!seasonality.inSeason) parts.push(`🍂 ${seasonality.reason}`)
        return parts.join('\n') || food.name
    }

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 999,
        opacity: 0.8
    } : undefined

    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div
                            ref={setNodeRef}
                            style={style}
                            {...listeners}
                            {...attributes}
                            className={`relative group bg-white border rounded p-1.5 cursor-move hover:shadow-sm transition-shadow touch-none ${isDragging ? 'opacity-50' : ''} ${isDisliked ? 'border-red-300 bg-red-50' : ''} ${!isCompatible ? 'border-yellow-300 bg-yellow-50' : ''} ${isRecommended ? 'border-blue-200 bg-blue-50/30' : ''}`}
                        >
                            {/* Cumulative Count Badge ... */}
                            {count > 0 && (
                                <span
                                    className={`absolute -top-1.5 -left-1.5 text-[9px] font-bold rounded-full min-w-[16px] h-4 px-0.5 flex items-center justify-center z-30 border shadow-sm
                                        ${count <= 2 ? 'bg-green-100 text-green-700 border-green-300' : count <= 4 ? 'bg-yellow-100 text-yellow-700 border-yellow-300' : 'bg-red-100 text-red-700 border-red-300'}`}
                                    title={`Bu yemek ${count} kez verildi`}
                                >
                                    {count}
                                </span>
                            )}
                            <div className="flex justify-between items-start gap-1">
                                <div className="flex-1 min-w-0">
                                    <div className={`font-medium text-xs truncate flex items-center gap-0.5 ${isDisliked ? 'text-red-600' : ''}`} title={food.name}>
                                        {/* Icons - same order as meal render */}
                                        {!seasonality.inSeason && <span className="text-[10px]" title={seasonality.reason}>🍂</span>}

                                        {/* Medication Icons */}
                                        {compatibility.medicationWarning && compatibility.medicationWarning.type === 'negative' && (
                                            <span className="text-[10px]">💊🚫</span>
                                        )}
                                        {compatibility.medicationWarning && compatibility.medicationWarning.type === 'warning' && (
                                            <span className="text-[10px]">💊⚠️</span>
                                        )}
                                        {compatibility.medicationWarning && compatibility.medicationWarning.type === 'positive' && (
                                            <span className="text-[10px]">💊✅</span>
                                        )}

                                        {isDisliked && <span className="text-[10px]">🚫</span>}
                                        {!isCompatible && (
                                            <span className="">
                                                <AlertTriangle size={11} className="text-red-600" />
                                            </span>
                                        )}
                                        {isRecommended && (
                                            <span className="">
                                                <Heart size={11} fill="currentColor" className="text-blue-600" />
                                            </span>
                                        )}
                                        <span>{food.name}</span>
                                        {food.meta?.team_owner_id && (
                                            <span className="ml-1 px-1 bg-indigo-100 text-indigo-700 text-[8px] font-bold tracking-widest rounded uppercase">Takım</span>
                                        )}
                                    </div>
                                    <div className="text-[10px] text-gray-500 flex gap-1.5 mt-0.5">
                                        <span>{Math.round(food.calories)}kcal</span>
                                        {food.protein > 0 && <span>P:{food.protein}</span>}
                                        {food.role && <span className="text-blue-500">{ROLE_LABELS[food.role] || food.role}</span>}
                                    </div>
                                </div>
                                <button
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-100 rounded transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); setEditOpen(true); }}
                                    onPointerDown={(e) => e.stopPropagation()}
                                >
                                    <Pencil size={10} className="text-gray-400" />
                                </button>
                            </div>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent className="w-auto max-w-[800px] min-w-[300px] max-h-[80vh] overflow-y-auto p-0 text-xs shadow-xl border-2 border-slate-300 z-50">
                        {compatibility.warnings?.length > 0 ? (
                            <div className="p-3">
                                {(() => {
                                    const groups = new Map<string, typeof compatibility.warnings>();
                                    compatibility.warnings.forEach((w: any) => {
                                        const kwKey = w.keyword.toLocaleLowerCase('tr-TR');
                                        if (!groups.has(kwKey)) groups.set(kwKey, []);
                                        groups.get(kwKey)!.push(w);
                                    });
                                    const groupCount = groups.size;
                                    const isGrid = groupCount > 1;

                                    return (
                                        <div className={`gap-3 space-y-3 ${isGrid ? 'columns-2' : 'columns-1'}`}>
                                            {Array.from(groups.entries()).map(([kwKey, items]) => (
                                                <div key={kwKey} className="break-inside-avoid rounded-md border border-slate-200 bg-slate-50 overflow-hidden shadow-sm flex flex-col mb-3">
                                                    <div className="bg-slate-50 p-2 space-y-2 flex-1">
                                                        {items.map((w, wi) => {
                                                            let cardBg = 'bg-white';
                                                            let cardBorder = 'border-slate-100';
                                                            let titleColor = 'text-slate-800';
                                                            let icon = '⚠️';

                                                            if (w.source === 'disease') {
                                                                icon = '🏥';
                                                                if (w.type === 'negative') { cardBg = 'bg-red-50'; cardBorder = 'border-red-200'; titleColor = 'text-red-900'; }
                                                                else if (w.type === 'positive') { cardBg = 'bg-blue-50'; cardBorder = 'border-blue-200'; titleColor = 'text-blue-900'; }
                                                            } else if (w.source === 'medication') {
                                                                icon = '💊';
                                                                cardBg = 'bg-amber-50'; cardBorder = 'border-amber-200'; titleColor = 'text-amber-900';
                                                                if (w.type === 'positive') { cardBg = 'bg-green-50'; cardBorder = 'border-green-200'; titleColor = 'text-green-900'; }
                                                            } else if (w.source === 'lab') {
                                                                icon = '🔬';
                                                                cardBg = 'bg-purple-50'; cardBorder = 'border-purple-200'; titleColor = 'text-purple-900';
                                                            } else if (w.source === 'diet') {
                                                                icon = '🥗';
                                                                cardBg = 'bg-orange-50'; cardBorder = 'border-orange-200'; titleColor = 'text-orange-900';
                                                            }


                                                            // Determine status icon
                                                            let statusIcon = '⚠️';
                                                            if (w.type === 'negative') statusIcon = '⛔';
                                                            if (w.type === 'positive') statusIcon = '✅';

                                                            const typeLabel = w.type === 'negative' ? 'UYUMSUZ' : w.type === 'positive' ? 'ÖNERİLEN' : 'UYARI';
                                                            const typeColor = w.type === 'negative' ? 'text-red-700' : w.type === 'positive' ? 'text-green-700' : 'text-amber-700';

                                                            return (
                                                                <div key={wi} className={`p-1.5 rounded border ${cardBg} ${cardBorder}`}>
                                                                    <div className={`flex items-center gap-1.5 ${titleColor} font-semibold`}>
                                                                        <span className="text-sm font-bold text-slate-700">{w.keyword}</span>
                                                                        <span className="text-sm">{statusIcon}</span>
                                                                        <span className="text-sm">{w.sourceName}</span>
                                                                        {icon !== statusIcon && <span className="text-xs opacity-70 ml-0.5">({icon})</span>}
                                                                    </div>

                                                                    {w.warning && (
                                                                        <div className="flex gap-2 items-start text-slate-700 mt-1 text-[11px] leading-snug">
                                                                            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600" />
                                                                            <span>{w.warning}</span>
                                                                        </div>
                                                                    )}
                                                                    {w.info && (
                                                                        <div className="flex gap-2 items-start text-slate-600 mt-1.5 text-[11px] leading-snug">
                                                                            <Info size={12} className="mt-0.5 shrink-0 text-blue-600" />
                                                                            <span>{w.info}</span>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                                {seasonality.inSeason === false && (
                                    <div className="pt-2 border-t border-gray-200 text-orange-600 font-medium">
                                        🍂 {seasonality.reason}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-gray-600 whitespace-pre-line">{buildTooltip()}</div>
                        )}
                    </TooltipContent>
                </Tooltip >
            </TooltipProvider >

            <FoodEditDialog food={food} isOpen={editOpen} onClose={() => setEditOpen(false)} onUpdate={onUpdate} patientId={patientId} />
        </>
    )
}

// ================== FOOD EDIT DIALOG ==================
export function FoodEditDialog({
    food,
    isOpen,
    onClose,
    onUpdate,
    mode = 'edit',
    onCreate,
    onSave,
    patientId,
    teamOwnerId
}: {
    food: any
    isOpen: boolean
    onClose: () => void
    onUpdate: () => void
    mode?: 'edit' | 'create'
    onCreate?: (newFood: any) => void
    onSave?: (data: any) => Promise<any>
    patientId?: string
    teamOwnerId?: string | null
}) {
    // Basic info
    const [name, setName] = useState(food.name || '')
    const [category, setCategory] = useState(food.category || 'ÖĞLEN')
    const [role, setRole] = useState(food.role || 'mainDish')

    // Dynamic options state
    const [categories, setCategories] = useState<string[]>([...FOOD_CATEGORIES])
    const [roles, setRoles] = useState<{ value: string, label: string }[]>([...FOOD_ROLES])

    // Macros
    const [calories, setCalories] = useState(food.calories?.toString() || '0')
    const [protein, setProtein] = useState(food.protein?.toString() || '0')
    const [carbs, setCarbs] = useState(food.carbs?.toString() || '0')
    const [fat, setFat] = useState(food.fat?.toString() || '0')

    // Portion settings
    const [minQuantity, setMinQuantity] = useState(food.min_quantity?.toString() || '1')
    const [maxQuantity, setMaxQuantity] = useState(food.max_quantity?.toString() || '1')
    const [step, setStep] = useState(food.step?.toString() || '1')
    const [multiplier, setMultiplier] = useState(food.multiplier?.toString() || '1')
    const [portionFixed, setPortionFixed] = useState(food.portion_fixed || false)

    // Diet types — dynamic from diet_types table
    const [availableDietTypes, setAvailableDietTypes] = useState<any[]>([])
    // Map: diet_type.id -> boolean (checked or not)
    const [dietTypeChecks, setDietTypeChecks] = useState<Record<string, boolean>>({})
    // Legacy boolean column mapping for backward compatibility
    const LEGACY_DIET_COLUMNS: Record<string, string> = {
        'keto': 'keto', 'ketojenik': 'keto',
        'lowcarb': 'lowcarb', 'low carb': 'lowcarb', 'low-carb': 'lowcarb',
        'vegan': 'vegan',
        'vejeteryan': 'vejeteryan', 'vejetaryen': 'vejeteryan'
    }

    // Meal types (array)
    const [mealBreakfast, setMealBreakfast] = useState(food.meal_types?.includes('breakfast') || false)
    const [mealLunch, setMealLunch] = useState(food.meal_types?.includes('lunch') || false)
    const [mealDinner, setMealDinner] = useState(food.meal_types?.includes('dinner') || false)

    // Variety control
    const [maxWeeklyFreq, setMaxWeeklyFreq] = useState(food.max_weekly_freq?.toString() || '')
    const [minWeeklyFreq, setMinWeeklyFreq] = useState(food.min_weekly_freq?.toString() || '')
    const [priorityScore, setPriorityScore] = useState(food.priority_score ?? 5)
    const [applyScoreToGlobal, setApplyScoreToGlobal] = useState(false)

    // Filler
    const [fillerLunch, setFillerLunch] = useState(food.filler_lunch || false)
    const [fillerDinner, setFillerDinner] = useState(food.filler_dinner || false)

    // Season
    const [seasonStart, setSeasonStart] = useState(food.season_start?.toString() || '1')
    const [seasonEnd, setSeasonEnd] = useState(food.season_end?.toString() || '12')

    // Tags
    const [tags, setTags] = useState(food.tags?.join(', ') || '')
    const [compatibilityTags, setCompatibilityTags] = useState(food.compatibility_tags?.join(', ') || '')
    const [notes, setNotes] = useState(food.notes || '')

    // AI Recipe Fields
    const [ingredients, setIngredients] = useState(food.ingredients || '')
    const [recipeText, setRecipeText] = useState(food.recipe_text || '')

    // Micronutrients
    type KeywordEntry = { keyword: string; match_type: 'name' | 'tag' | 'both' }
    type MicronutrientWithKeywords = { id: string; name: string; compatible_keywords: KeywordEntry[] | null }
    const [allMicronutrients, setAllMicronutrients] = useState<MicronutrientWithKeywords[]>([])
    const [selectedMicronutrients, setSelectedMicronutrients] = useState<string[]>([]) // Manual selections
    const [autoDetectedMicronutrients, setAutoDetectedMicronutrients] = useState<string[]>([]) // Auto-detected via keywords

    const [saving, setSaving] = useState(false)
    const [effectiveTeamOwnerId, setEffectiveTeamOwnerId] = useState<string | null>(teamOwnerId ?? null)

    // Recipe match/ban management
    const { manualMatches, bans, cards, addManualMatch, deleteManualMatch, addBan, deleteBan, syncCards, refresh } = useRecipeManager()
    const [recipeSearch, setRecipeSearch] = useState('')
    const [isSyncing, setIsSyncing] = useState(false)

    // Compute existing matches & bans for this food
    const foodPattern = normalizeFoodName(name)
    const foodMatches = manualMatches.filter(m =>
        m.food_pattern === foodPattern ||
        normalizeFoodName(m.food_pattern) === foodPattern ||
        m.food_pattern.toLowerCase() === name.toLowerCase()
    )
    const foodBans = bans.filter(b =>
        b.food_pattern === foodPattern ||
        normalizeFoodName(b.food_pattern) === foodPattern ||
        b.food_pattern.toLowerCase() === name.toLowerCase()
    )

    // Filter cards for search (multi-token smart search)
    const filteredCards = useMemo(() => {
        if (recipeSearch.length < 2) return []
        
        const trNorm = (s: string) => s.toLowerCase().replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch: string) => ({
            'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u',
            'Ç':'c','Ğ':'g','İ':'i','Ö':'o','Ş':'s','Ü':'u'
        } as any)[ch] || ch)
        
        const searchTokens = trNorm(recipeSearch).split(/\s+/).filter(t => t.length >= 2)
        
        return cards.filter(c => {
            const fn = trNorm(c.filename)
            const metadataText = c.metadata?.original_text ? trNorm(c.metadata.original_text) : ""
            // All tokens must be found in either filename OR metadata original text
            return searchTokens.every(token => fn.includes(token) || metadataText.includes(token))
        }).slice(0, 15)
    }, [recipeSearch, cards])

    // Compute the currently active thumbnail for the header
    const activeThumbnail = useMemo(() => {
        if (!name || cards.length === 0) return null
        
        const trNorm = (s: string) => s.toLowerCase().replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch: string) => ({
            'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u',
            'Ç':'c','Ğ':'g','İ':'i','Ö':'o','Ş':'s','Ü':'u'
        } as any)[ch] || ch).replace(/[^a-z0-9]/g, '')
        
        const fn = trNorm(name)
        const foodTokens = (name.toLowerCase().replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch: string) => ({
            'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u',
            'Ç':'c','Ğ':'g','İ':'i','Ö':'o','Ş':'s','Ü':'u'
        } as any)[ch] || ch) || "").match(/[a-z0-9]+/g) || []

        // 1. Check manual matches first
        if (foodMatches.length > 0) {
            const firstMatch = foodMatches[0]
            const card = cards.find(c => c.filename === firstMatch.card_filename)
            if (card) return card.url
        }

        // 2. Fuzzy match (Simplified version of getCardUrls)
        const candidates = cards.map(c => {
            const cn = trNorm(c.filename.replace(/\..+$/, ''))
            
            // Skip if banned
            if (foodBans.some(b => b.card_filename === c.filename)) return { url: c.url, score: 0 }
            
            let score = 0
            if (cn === fn) score += 100
            if (cn.includes(fn) || fn.includes(cn)) score += 50
            
            const cardTokens = (c.filename.toLowerCase().replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch: string) => ({
                'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u',
                'Ç':'c','Ğ':'g','İ':'i','Ö':'o','Ş':'s','Ü':'u'
            } as any)[ch] || ch) || "").match(/[a-z0-9]+/g) || []
            
            const matchedTokens = foodTokens.filter((ft: string) => ft.length > 2 && cardTokens.some((ct: string) => ct.includes(ft) || ft.includes(ct)))
            if (foodTokens.length > 0) {
                const ratio = matchedTokens.length / foodTokens.filter((ft: string) => ft.length > 2).length
                if (ratio >= 0.6) score += ratio * 40
            }
            
            return { url: c.url, score }
        }).filter(c => c.score > 25).sort((a, b) => b.score - a.score)

        return candidates.length > 0 ? candidates[0].url : null
    }, [name, cards, foodMatches, foodBans])

    // Fetch all micronutrients with compatible_keywords on mount
    useEffect(() => {
        async function fetchMicronutrients() {
            const { data } = await supabase
                .from('micronutrients')
                .select('id, name, compatible_keywords')
                .order('name')
            if (data) setAllMicronutrients(data)
        }
        fetchMicronutrients()
        loadOptions()
    }, [])

    useEffect(() => {
        let mounted = true

        if (teamOwnerId !== undefined) {
            setEffectiveTeamOwnerId(teamOwnerId || null)
            return () => {
                mounted = false
            }
        }

        resolveTeamScopeContextFromAuth()
            .then((scope) => {
                if (mounted) {
                    setEffectiveTeamOwnerId(scope.teamOwnerId)
                }
            })
            .catch(() => {
                if (mounted) {
                    setEffectiveTeamOwnerId(null)
                }
            })

        return () => {
            mounted = false
        }
    }, [teamOwnerId])

    async function loadOptions() {
        try {
            const { data: settingsData } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'food_management_options')
                .maybeSingle()

            if (settingsData?.value) {
                // Merge categories
                if (settingsData.value.categories && Array.isArray(settingsData.value.categories)) {
                    const dbCats = settingsData.value.categories.filter((c: any) => typeof c === 'string');
                    const uniqueCats = Array.from(new Set([...FOOD_CATEGORIES, ...dbCats]));
                    setCategories(uniqueCats);
                }

                // Merge roles
                if (settingsData.value.roles && Array.isArray(settingsData.value.roles)) {
                    const dbRoles = settingsData.value.roles.map((r: any) =>
                        typeof r === 'string' ? { value: r, label: r } : r
                    ).filter((r: any) => r && r.value && r.label);

                    const existingValues = new Set(FOOD_ROLES.map(r => r.value.toLowerCase()));
                    const newRoles = dbRoles.filter((r: any) => !existingValues.has(r.value.toLowerCase()));

                    setRoles([...FOOD_ROLES, ...newRoles]);
                }
            }
        } catch (e) { }
    }

    // Compute auto-detected micronutrients based on food name and tags
    useEffect(() => {
        if (allMicronutrients.length === 0) return

        const foodName = (name || '').toLocaleLowerCase('tr-TR')
        const foodTags = (tags || '').split(',').map((t: string) => t.trim().toLocaleLowerCase('tr-TR')).filter(Boolean)

        const detected: string[] = []

        allMicronutrients.forEach(micro => {
            if (!micro.compatible_keywords || !Array.isArray(micro.compatible_keywords)) return

            for (const kw of micro.compatible_keywords) {
                if (!kw.keyword) continue
                const kwText = kw.keyword.trim().toLocaleLowerCase('tr-TR')
                const mType = kw.match_type || 'both'
                const matchName = mType === 'name' || mType === 'both'
                const matchTag = mType === 'tag' || mType === 'both'

                let match = false
                if (matchName && foodName.includes(kwText)) match = true
                if (!match && matchTag && foodTags.some((t: string) => t.includes(kwText))) match = true

                if (match) {
                    detected.push(micro.id)
                    break
                }
            }
        })

        setAutoDetectedMicronutrients(detected)
    }, [allMicronutrients, name, tags])

    // Fetch food's current micronutrients when food changes
    useEffect(() => {
        async function fetchFoodMicronutrients() {
            if (!food.id) {
                setSelectedMicronutrients([])
                return
            }

            if (Array.isArray(food.micronutrients)) {
                setSelectedMicronutrients(Array.from(new Set(food.micronutrients)))
            }

            try {
                const micronutrients = await getFoodMicronutrientsByScope(food.id, effectiveTeamOwnerId)
                setSelectedMicronutrients(micronutrients)
            } catch (error) {
                console.warn('[FoodEditDialog] micronutrient scope fetch failed:', error)
            }
        }
        fetchFoodMicronutrients()
    }, [food.id, effectiveTeamOwnerId, food.micronutrients])

    // Fetch available diet types from database
    useEffect(() => {
        async function fetchDietTypes() {
            const { data } = await supabase
                .from('diet_types')
                .select('id, name, abbreviation, description')
                .is('patient_id', null)
                .order('name')
            if (data) {
                setAvailableDietTypes(data)
                // Initialize checks from food data
                const initChecks: Record<string, boolean> = {}
                const foodDietTypes: string[] = food.meta?.dietTypes || []
                data.forEach(dt => {
                    const nameKey = dt.name?.toLowerCase().trim()
                    const legacyCol = LEGACY_DIET_COLUMNS[nameKey]
                    const isCheckedLegacy = legacyCol ? !!food[legacyCol] : false
                    const isCheckedMeta = foodDietTypes.some((fdt: string) => fdt.toLowerCase().trim() === nameKey)
                    initChecks[dt.id] = isCheckedLegacy || isCheckedMeta
                })
                setDietTypeChecks(initChecks)
            }
        }
        fetchDietTypes()
    }, [food.id])

    // Sync state when food prop changes (after save & refetch)
    useEffect(() => {
        setName(food.name || '')
        setCategory(food.category || 'ÖĞLEN')
        setRole(food.role || 'mainDish')
        setCalories(food.calories?.toString() || '0')
        setProtein(food.protein?.toString() || '0')
        setCarbs(food.carbs?.toString() || '0')
        setFat(food.fat?.toString() || '0')
        setMinQuantity(food.min_quantity?.toString() || '1')
        setMaxQuantity(food.max_quantity?.toString() || '1')
        setStep(food.step?.toString() || '1')
        setMultiplier(food.multiplier?.toString() || '1')
        setPortionFixed(food.portion_fixed || false)
        // Reset diet type checks from food data
        const initChecks: Record<string, boolean> = {}
        const foodDietTypes: string[] = food.meta?.dietTypes || []
        availableDietTypes.forEach(dt => {
            const nameKey = dt.name?.toLowerCase().trim()
            const legacyCol = LEGACY_DIET_COLUMNS[nameKey]
            // Check legacy boolean column OR meta.dietTypes array
            const isCheckedLegacy = legacyCol ? !!food[legacyCol] : false
            const isCheckedMeta = foodDietTypes.some((fdt: string) => fdt.toLowerCase().trim() === nameKey)
            initChecks[dt.id] = isCheckedLegacy || isCheckedMeta
        })
        setDietTypeChecks(initChecks)
        setMealBreakfast(food.meal_types?.includes('breakfast') || false)
        setMealLunch(food.meal_types?.includes('lunch') || false)
        setMealDinner(food.meal_types?.includes('dinner') || false)
        setMaxWeeklyFreq(food.max_weekly_freq?.toString() || '')
        setMinWeeklyFreq(food.min_weekly_freq?.toString() || '')
        setPriorityScore(food.priority_score ?? 5)
        setFillerLunch(food.filler_lunch || false)
        setFillerDinner(food.filler_dinner || false)
        setSeasonStart(food.season_start?.toString() || '1')
        setSeasonEnd(food.season_end?.toString() || '12')
        setTags(food.tags?.join(', ') || '')
        setCompatibilityTags(food.compatibility_tags?.join(', ') || '')
        setNotes(food.notes || '')
        setIngredients(food.ingredients || '')
        setRecipeText(food.recipe_text || '')
    }, [food])

    // Auto-calculate calories whenever macros change
    useEffect(() => {
        const p = parseFloat(protein) || 0
        const c = parseFloat(carbs) || 0
        const f = parseFloat(fat) || 0
        const calculatedCalories = (p * 4) + (c * 4) + (f * 9)
        setCalories(Math.round(calculatedCalories).toString())
    }, [protein, carbs, fat])

    const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']


    async function handleSave() {
        setSaving(true)

        // Build meal_types array
        const mealTypes: string[] = []
        if (mealBreakfast) mealTypes.push('breakfast')
        if (mealLunch) mealTypes.push('lunch')
        if (mealDinner) mealTypes.push('dinner')

        // Parse tags
        const parsedTags = tags.split(',').map((t: string) => t.trim()).filter(Boolean)
        const parsedCompatTags = compatibilityTags.split(',').map((t: string) => t.trim()).filter(Boolean)

        const updateData: Record<string, any> = {
            name,
            category,
            role,
            calories: parseFloat(calories) || 0,
            protein: parseFloat(protein) || 0,
            carbs: parseFloat(carbs) || 0,
            fat: parseFloat(fat) || 0,
            min_quantity: parseFloat(minQuantity) || 1,
            max_quantity: parseFloat(maxQuantity) || 1,
            step: parseFloat(step) || 1,
            multiplier: parseFloat(multiplier) || 1,
            portion_fixed: portionFixed,
            // Legacy boolean columns from dynamic diet type checks
            keto: availableDietTypes.some(dt => LEGACY_DIET_COLUMNS[dt.name?.toLowerCase().trim()] === 'keto' && dietTypeChecks[dt.id]),
            lowcarb: availableDietTypes.some(dt => LEGACY_DIET_COLUMNS[dt.name?.toLowerCase().trim()] === 'lowcarb' && dietTypeChecks[dt.id]),
            vegan: availableDietTypes.some(dt => LEGACY_DIET_COLUMNS[dt.name?.toLowerCase().trim()] === 'vegan' && dietTypeChecks[dt.id]),
            vejeteryan: availableDietTypes.some(dt => LEGACY_DIET_COLUMNS[dt.name?.toLowerCase().trim()] === 'vejeteryan' && dietTypeChecks[dt.id]),
            // Save selected diet type names to meta.dietTypes for extensibility
            meta: {
                ...(food.meta || {}),
                dietTypes: availableDietTypes
                    .filter(dt => dietTypeChecks[dt.id])
                    .map(dt => dt.name)
            },
            meal_types: mealTypes,
            filler_lunch: fillerLunch,
            filler_dinner: fillerDinner,
            max_weekly_freq: maxWeeklyFreq ? parseInt(maxWeeklyFreq) : null,
            min_weekly_freq: minWeeklyFreq ? parseInt(minWeeklyFreq) : null,
            // If patientId is present, don't write priority_score to foods table directly
            // (it will be saved to planner_settings.food_score_overrides instead)
            ...(!patientId || applyScoreToGlobal ? { priority_score: priorityScore } : {}),
            season_start: parseInt(seasonStart) || 1,
            season_end: parseInt(seasonEnd) || 12,
            tags: parsedTags,
            compatibility_tags: parsedCompatTags,
            notes,
            ingredients,
            recipe_text: recipeText
        }

        console.log('Saving food:', updateData)

        let error = null
        let data = null


        if (onSave) {
            // Custom save handler (used for special meal updates or Admin Panel)
            try {
                // If onSave returns data, use it
                // We pass selectedMicronutrients so the parent/API can handle them
                const result = await onSave({ ...updateData, micronutrients: selectedMicronutrients })
                if (result) data = result
            } catch (e: any) {
                error = e
            }
        } else if (mode === 'create') {
            const result = await supabase.from('foods').insert(updateData).select().single()
            error = result.error
            data = result.data
        } else {
            const result = await supabase.from('foods').update(updateData).eq('id', food.id).select().single()
            error = result.error
            data = result.data
        }

        if (error) {
            console.error('Save error:', error)
            alert('Hata: ' + error.message)
        } else {
            // Save micronutrient associations
            const foodId = data?.id || food.id
            if (foodId && !onSave) {
                // Delete existing associations
                await supabase.from('food_micronutrients').delete().eq('food_id', foodId)

                // Insert new associations
                if (selectedMicronutrients.length > 0) {
                    const associations = selectedMicronutrients.map(microId => ({
                        food_id: foodId,
                        micronutrient_id: microId
                    }))
                    await supabase.from('food_micronutrients').insert(associations)
                }
            }

            // Save patient-scoped food score override if patientId is present
            if (patientId && food.id && priorityScore !== (food.priority_score ?? 5)) {
                try {
                    // Get or create patient planner_settings
                    let { data: patientSettings } = await supabase
                        .from('planner_settings')
                        .select('id, food_score_overrides')
                        .eq('scope', 'patient')
                        .eq('patient_id', patientId)
                        .maybeSingle()

                    const currentOverrides = patientSettings?.food_score_overrides || {}
                    const updatedOverrides = { ...currentOverrides, [food.id]: priorityScore }

                    if (patientSettings) {
                        await supabase
                            .from('planner_settings')
                            .update({ food_score_overrides: updatedOverrides })
                            .eq('id', patientSettings.id)
                    } else {
                        const user = (await supabase.auth.getUser()).data.user
                        if (user) {
                            await supabase
                                .from('planner_settings')
                                .insert({
                                    user_id: user.id,
                                    scope: 'patient',
                                    patient_id: patientId,
                                    food_score_overrides: updatedOverrides
                                })
                        }
                    }
                    console.log(`[FoodEditDialog] Saved patient-scoped score override: food=${food.id}, score=${priorityScore}, patient=${patientId}`)
                } catch (e) {
                    console.error('Error saving patient score override:', e)
                }
            }

            // Sync score to global planner_settings.food_score_overrides when "Globale de uygula" is checked
            if (applyScoreToGlobal && food.id && priorityScore !== (food.priority_score ?? 5)) {
                try {
                    let { data: globalSettings } = await supabase
                        .from('planner_settings')
                        .select('id, food_score_overrides')
                        .eq('scope', 'global')
                        .maybeSingle()

                    if (globalSettings) {
                        const currentGlobalOverrides = globalSettings.food_score_overrides || {}
                        const updatedGlobalOverrides = { ...currentGlobalOverrides, [food.id]: priorityScore }
                        await supabase
                            .from('planner_settings')
                            .update({ food_score_overrides: updatedGlobalOverrides })
                            .eq('id', globalSettings.id)
                    } else {
                        // Create global settings row if it doesn't exist
                        const user = (await supabase.auth.getUser()).data.user
                        if (user) {
                            await supabase
                                .from('planner_settings')
                                .insert({
                                    user_id: user.id,
                                    scope: 'global',
                                    food_score_overrides: { [food.id]: priorityScore }
                                })
                        }
                    }
                    console.log(`[FoodEditDialog] Synced score to global overrides: food=${food.id}, score=${priorityScore}`)
                } catch (e) {
                    console.error('Error syncing score to global overrides:', e)
                }
            }

            if (mode === 'create' && onCreate && data) {
                await onCreate(data)
            }
            onUpdate()
            onClose()
        }
        setSaving(false)
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[95vw] h-auto max-h-[90vh] flex flex-col p-0 gap-0">
                {/* Fixed Header */}
                <div className="px-6 py-4 border-b shrink-0 flex items-center justify-between">
                    <DialogHeader>
                        <DialogTitle>{mode === 'create' ? 'Yeni Yemek Ekle' : 'Yemek Düzenle'}</DialogTitle>
                    </DialogHeader>
                    {activeThumbnail && (
                        <div className="flex items-center gap-3">
                            <div className="text-right">
                                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Eşleşen Kart</p>
                                <p className="text-[11px] font-semibold text-green-600">Otomatik Bağlandı</p>
                            </div>
                            <div 
                                className="w-12 h-12 rounded-lg border-2 border-green-100 overflow-hidden shadow-sm hover:scale-110 transition-transform cursor-zoom-in"
                                onClick={() => window.open(activeThumbnail, '_blank')}
                            >
                                <img src={activeThumbnail} alt="Thumbnail" className="w-full h-full object-cover" />
                            </div>
                        </div>
                    )}
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    <div className="grid grid-cols-2 gap-8">
                        {/* Left Column */}
                        <div className="space-y-4">
                            <div>
                                <Label className="text-xs font-medium">Yemek Adı</Label>
                                <Input value={name} onChange={e => setName(e.target.value)} className="h-9" />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Kalori (Otomatik)</Label>
                                    <Input type="number" value={calories} readOnly className="h-8 bg-gray-100/50 cursor-not-allowed text-gray-500" />
                                </div>
                                <div>
                                    <Label className="text-xs">Protein (g)</Label>
                                    <Input type="number" value={protein} onChange={e => setProtein(e.target.value)} className="h-8" />
                                </div>
                                <div>
                                    <Label className="text-xs">Karb. (g)</Label>
                                    <Input type="number" value={carbs} onChange={e => setCarbs(e.target.value)} className="h-8" />
                                </div>
                                <div>
                                    <Label className="text-xs">Yağ (g)</Label>
                                    <Input type="number" value={fat} onChange={e => setFat(e.target.value)} className="h-8" />
                                </div>
                            </div>



                            <div>
                                <Label className="text-xs">Etiketler (virgülle ayır)</Label>
                                <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="peynir, keto, kahvaltı" className="h-8" />
                            </div>

                            <div>
                                <Label className="text-xs">Uyumluluk Etiketleri</Label>
                                <Input value={compatibilityTags} onChange={e => setCompatibilityTags(e.target.value)} placeholder="yeşillik, zeytin, domates" className="h-8" />
                                <p className="text-[10px] text-gray-400 mt-0.5">Bu etiketler yemek uyumluluğunu kontrol etmek için kullanılır.</p>
                            </div>

                            <div>
                                <Label className="text-xs">Notlar</Label>
                                <Input value={notes} onChange={e => setNotes(e.target.value)} className="h-8" />
                            </div>

                            <div>
                                <Label className="text-xs text-blue-600 flex items-center gap-1 mt-2"><span>📝</span> Malzemeler</Label>
                                <textarea 
                                    value={ingredients} 
                                    onChange={e => setIngredients(e.target.value)} 
                                    className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm mt-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500" 
                                    placeholder="200g tavuk, 1 yk zeytinyağı..." 
                                />
                            </div>
                            
                            <div>
                                <Label className="text-xs text-blue-600 flex items-center gap-1"><span>👨‍🍳</span> Tarif Adımları</Label>
                                <textarea 
                                    value={recipeText} 
                                    onChange={e => setRecipeText(e.target.value)} 
                                    className="flex min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm mt-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500" 
                                    placeholder="1. Tavuğu doğrayın...&#10;2. Tavada soteleyin..." 
                                />
                                <p className="text-[10px] text-gray-400 mt-0.5">Eğer tarif kartı yoksa hastaya bu metin gösterilir.</p>
                            </div>

                            {/* Recipe Card Match/Ban Controls */}
                            {mode !== 'create' && name && (
                                <div className="border-t pt-3">
                                    <Label className="text-xs text-indigo-600 flex items-center gap-1 mb-2">
                                        <span>📖</span> Tarif Kartı Eşleşmeleri
                                    </Label>

                                    {/* Existing matches */}
                                    {foodMatches.length > 0 && (
                                        <div className="mb-2">
                                            <span className="text-[10px] text-gray-500">Eşleşen Kartlar:</span>
                                            <div className="flex flex-wrap gap-1 mt-0.5">
                                                {foodMatches.map(m => (
                                                    <span key={m.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-green-100 text-green-800 border border-green-200">
                                                        ✅ {m.card_filename.replace(/\..+$/, '')}
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); deleteManualMatch(m.id) }}
                                                            className="hover:text-red-600 ml-0.5"
                                                            title="Eşleşmeyi Kaldır"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Existing bans */}
                                    {foodBans.length > 0 && (
                                        <div className="mb-2">
                                            <span className="text-[10px] text-gray-500">Yasaklanan Kartlar:</span>
                                            <div className="flex flex-wrap gap-1 mt-0.5">
                                                {foodBans.map(b => (
                                                    <span key={b.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-800 border border-red-200">
                                                        🚫 {b.card_filename.replace(/\..+$/, '')}
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); deleteBan(b.id) }}
                                                            className="hover:text-red-900 ml-0.5"
                                                            title="Yasağı Kaldır"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Search + Add */}
                                    <div className="flex gap-1 items-end">
                                        <div className="flex-1 relative">
                                            <div className="flex items-center gap-1">
                                                <Input
                                                    placeholder="Tarif kartı ara... (2+ karakter)"
                                                    value={recipeSearch}
                                                    onChange={e => setRecipeSearch(e.target.value)}
                                                    className="h-7 text-xs"
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7 shrink-0"
                                                    onClick={async (e) => {
                                                        e.preventDefault()
                                                        setIsSyncing(true)
                                                        await syncCards()
                                                        await refresh()
                                                        setIsSyncing(false)
                                                    }}
                                                    disabled={isSyncing}
                                                    title="GitHub'dan yeni kartları çek"
                                                >
                                                    <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                                                </Button>
                                            </div>
                                            {filteredCards.length > 0 && recipeSearch.length >= 2 && (
                                                <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg max-h-40 overflow-y-auto">
                                                    {filteredCards.map(c => {
                                                        const displayName = c.filename.replace(/\..+$/, '')
                                                        const isAlreadyMatched = foodMatches.some(m => m.card_filename === c.filename)
                                                        const isAlreadyBanned = foodBans.some(b => b.card_filename === c.filename)
                                                        return (
                                                            <div key={c.id} className="flex items-center gap-1 px-2 py-1 hover:bg-gray-50 text-xs border-b border-gray-50 last:border-0">
                                                                <span className="flex-1 truncate" title={displayName}>{displayName}</span>
                                                                {isAlreadyMatched && <span className="text-[9px] text-green-600 shrink-0">✅ Eşleşti</span>}
                                                                {isAlreadyBanned && <span className="text-[9px] text-red-600 shrink-0">🚫 Yasaklı</span>}
                                                                {!isAlreadyMatched && !isAlreadyBanned && (
                                                                    <>
                                                                        <button
                                                                            onClick={async (e) => {
                                                                                e.preventDefault()
                                                                                await addManualMatch(foodPattern, c.filename, name)
                                                                                setRecipeSearch('')
                                                                            }}
                                                                            className="px-1.5 py-0.5 rounded text-[9px] bg-green-100 hover:bg-green-200 text-green-700 border border-green-200 shrink-0"
                                                                            title="Bu kartı eşleştir"
                                                                        >
                                                                            ✅ Eşleştir
                                                                        </button>
                                                                        <button
                                                                            onClick={async (e) => {
                                                                                e.preventDefault()
                                                                                await addBan(foodPattern, c.filename, name)
                                                                                setRecipeSearch('')
                                                                            }}
                                                                            className="px-1.5 py-0.5 rounded text-[9px] bg-red-100 hover:bg-red-200 text-red-700 border border-red-200 shrink-0"
                                                                            title="Bu kartı yasakla"
                                                                        >
                                                                            🚫 Yasakla
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-1">
                                        <span className="text-green-600">Eşleştir:</span> Tarif kartını bu yemeğe zorla bağla.
                                        <span className="text-red-600 ml-1">Yasakla:</span> Otomatik eşleşmeyi engelle.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Right Column */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-xs">Rol</Label>
                                    <select className="w-full h-9 text-sm border rounded px-2" value={role} onChange={e => setRole(e.target.value)}>
                                        {roles.map(r => (
                                            <option key={r.value} value={r.value}>{r.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <Label className="text-xs">Kategori</Label>
                                    <select className="w-full h-9 text-sm border rounded px-2" value={category} onChange={e => setCategory(e.target.value)}>
                                        {categories.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <Label className="text-xs">Mevsim Aralığı</Label>
                                <div className="grid grid-cols-2 gap-2 mt-1">
                                    <div>
                                        <Label className="text-[10px] text-gray-400">Başlangıç Ayı</Label>
                                        <select className="w-full h-8 text-sm border rounded px-2" value={seasonStart} onChange={e => setSeasonStart(e.target.value)}>
                                            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <Label className="text-[10px] text-gray-400">Bitiş Ayı</Label>
                                        <select className="w-full h-8 text-sm border rounded px-2" value={seasonEnd} onChange={e => setSeasonEnd(e.target.value)}>
                                            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-0.5">Boş bırakılırsa tüm yıl kullanılabilir.</p>
                            </div>

                            {/* PORSİYON VE ESNEKLİK AYARLARI */}
                            <div className="bg-orange-50 border border-orange-100 rounded p-3">
                                <Label className="text-xs font-semibold text-orange-800 mb-2 flex items-center gap-1.5">
                                    <span>⚖️</span> Porsiyon ve Otoplanlama Sınırları
                                </Label>

                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center gap-4">
                                        <label className="flex items-center gap-1.5 text-xs font-medium text-orange-900 select-none cursor-pointer p-1.5 bg-white border border-orange-200 rounded shadow-sm hover:bg-orange-50/50 transition-colors">
                                            <input type="checkbox" checked={portionFixed} onChange={e => setPortionFixed(e.target.checked)} className="rounded text-orange-600 focus:ring-orange-500" />
                                            Porsiyon Sabit (Değişmez)
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <Label className="text-xs font-medium text-orange-900">Varsayılan Çarpan:</Label>
                                            <Input type="number" step="0.5" value={multiplier} onChange={e => setMultiplier(e.target.value)} className="h-8 w-16 text-center border-orange-200" title="Yemek plana eklendiğinde ilk alacağı porsiyon katsayısı" />
                                        </div>
                                    </div>

                                    {!portionFixed && (
                                        <div className="flex items-center gap-3 bg-white p-2 rounded border border-orange-100 shadow-sm mt-1">
                                            <div className="flex flex-col gap-1">
                                                <Label className="text-[10px] text-orange-800 font-medium" title="Otoplanlamada porsiyon en az bu kadar olabilir">Min Katsayı</Label>
                                                <Input type="number" step="0.5" value={minQuantity} onChange={e => setMinQuantity(e.target.value)} className="h-7 w-16 text-xs text-center border-orange-200" />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <Label className="text-[10px] text-orange-800 font-medium" title="Otoplanlamada porsiyon en fazla bu kadar olabilir">Maks Katsayı</Label>
                                                <Input type="number" step="0.5" value={maxQuantity} onChange={e => setMaxQuantity(e.target.value)} className="h-7 w-16 text-xs text-center border-orange-200" />
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <Label className="text-[10px] text-orange-800 font-medium" title="Porsiyonu artırıp azaltırken kullanılacak birim (örn 0.5)">Artış Adımı</Label>
                                                <Input type="number" step="0.1" value={step} onChange={e => setStep(e.target.value)} className="h-7 w-16 text-xs text-center border-orange-200" />
                                            </div>
                                            <p className="text-[9px] text-orange-600 ml-2 leading-tight flex-1">
                                                Kalori dengesi sağlanırken porsiyon bu aralıkta, adım değeri kadar büyütülüp küçültülebilir.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="bg-indigo-50 border border-indigo-100 rounded p-2">
                                <Label className="text-xs font-semibold text-indigo-800 mb-1 flex items-center gap-1">
                                    <span>📅</span> Haftalık Tüketim Limiti
                                </Label>
                                <div className="flex items-center gap-4 mt-2">
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs font-medium text-indigo-900">En Az:</Label>
                                        <Input type="number" value={minWeeklyFreq} onChange={e => setMinWeeklyFreq(e.target.value)} placeholder="Yok" className="h-8 w-16 text-center border-indigo-200" min={0} max={7} />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs font-medium text-indigo-900">En Fazla:</Label>
                                        <Input type="number" value={maxWeeklyFreq} onChange={e => setMaxWeeklyFreq(e.target.value)} placeholder="Oto" className="h-8 w-16 text-center border-indigo-200" min={1} max={7} />
                                    </div>
                                    <span className="text-[10px] text-indigo-600 font-medium whitespace-nowrap">Kez / Hafta</span>
                                </div>
                                <p className="text-[9px] text-indigo-500 mt-1.5 leading-tight">Bu yemeğin planda bir haftada en az/en çok kaç kez verileceğini belirler. Boş bırakırsanız genel ayarlar geçerli olur.</p>
                            </div>

                            <div>
                                <Label className="text-xs">Öncelik Skoru</Label>
                                <div className="flex items-center gap-2 mt-1">
                                    <input
                                        type="range" min={0} max={10} step={1}
                                        value={priorityScore}
                                        onChange={e => setPriorityScore(Number(e.target.value))}
                                        className="flex-1 h-2 accent-blue-600"
                                    />
                                    <span className={`text-sm font-bold w-6 text-center ${priorityScore === 0 ? 'text-red-600' : priorityScore <= 3 ? 'text-orange-500' : priorityScore >= 8 ? 'text-green-600' : 'text-slate-700'}`}>
                                        {priorityScore}
                                    </span>
                                </div>
                                <p className="text-[9px] text-slate-400 mt-0.5">0=hiç verilmez, 1-3=az tercih, 5=normal, 8-10=çok tercih</p>
                                {patientId && (
                                    <div className="mt-1.5 flex items-center gap-2">
                                        <div className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                                            <span className="text-[9px] text-blue-600">🔒 Bu skor hastaya özel kaydedilir</span>
                                        </div>
                                        <label className="flex items-center gap-1.5 text-[10px] select-none cursor-pointer text-slate-500 hover:text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={applyScoreToGlobal}
                                                onChange={e => setApplyScoreToGlobal(e.target.checked)}
                                                className="rounded h-3 w-3"
                                            />
                                            Global'e de uygula
                                        </label>
                                    </div>
                                )}
                            </div>

                            <div>
                                <Label className="text-xs">Öğün Türü</Label>
                                <div className="flex gap-4 mt-1">
                                    <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer">
                                        <input type="checkbox" checked={mealBreakfast} onChange={e => setMealBreakfast(e.target.checked)} className="rounded" />
                                        Kahvaltı
                                    </label>
                                    <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer">
                                        <input type="checkbox" checked={mealLunch} onChange={e => setMealLunch(e.target.checked)} className="rounded" />
                                        Öğle
                                    </label>
                                    <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer">
                                        <input type="checkbox" checked={mealDinner} onChange={e => setMealDinner(e.target.checked)} className="rounded" />
                                        Akşam
                                    </label>
                                </div>
                            </div>

                            <div>
                                <Label className="text-xs">Dolgu Türü</Label>
                                <div className="flex gap-4 mt-1">
                                    <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer">
                                        <input type="checkbox" checked={fillerLunch} onChange={e => setFillerLunch(e.target.checked)} className="rounded" />
                                        Öğlen
                                    </label>
                                    <label className="flex items-center gap-1.5 text-sm select-none cursor-pointer">
                                        <input type="checkbox" checked={fillerDinner} onChange={e => setFillerDinner(e.target.checked)} className="rounded" />
                                        Akşam
                                    </label>
                                </div>
                            </div>

                            <div>
                                <Label className="text-xs">Diyet Türü</Label>
                                <div className="flex flex-wrap gap-3 mt-1">
                                    {availableDietTypes.length > 0 ? availableDietTypes.map(dt => (
                                        <label key={dt.id} className="flex items-center gap-1.5 text-sm select-none cursor-pointer" title={dt.description || dt.name}>
                                            <input
                                                type="checkbox"
                                                checked={!!dietTypeChecks[dt.id]}
                                                onChange={e => setDietTypeChecks(prev => ({ ...prev, [dt.id]: e.target.checked }))}
                                                className="rounded"
                                            />
                                            {dt.abbreviation || dt.name}
                                        </label>
                                    )) : (
                                        <span className="text-xs text-gray-400">Diyet türleri yükleniyor...</span>
                                    )}
                                </div>
                            </div>

                            {/* Zengin Olduğu Mikrobesinler */}
                            <div>
                                <Label className="text-xs text-green-600 flex items-center gap-1">
                                    <span>🧬</span> Zengin Olduğu Mikrobesinler
                                </Label>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-1 max-h-48 overflow-y-auto border rounded p-2 bg-gray-50">
                                    {allMicronutrients.map(micro => {
                                        const isAuto = autoDetectedMicronutrients.includes(micro.id)
                                        const isManual = selectedMicronutrients.includes(micro.id)
                                        const isChecked = isAuto || isManual

                                        return (
                                            <label
                                                key={micro.id}
                                                className={`flex items-center gap-1.5 text-sm select-none rounded px-1.5 py-0.5 ${isAuto
                                                    ? 'bg-green-100 border border-green-200 cursor-default'
                                                    : isManual
                                                        ? 'bg-blue-50 border border-blue-200 cursor-pointer'
                                                        : 'cursor-pointer hover:bg-gray-100'
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    disabled={isAuto}
                                                    onChange={e => {
                                                        if (isAuto) return // Can't change auto-detected
                                                        if (e.target.checked) {
                                                            setSelectedMicronutrients([...selectedMicronutrients, micro.id])
                                                        } else {
                                                            setSelectedMicronutrients(selectedMicronutrients.filter(id => id !== micro.id))
                                                        }
                                                    }}
                                                    className="rounded"
                                                />
                                                <span className={isAuto ? 'text-green-800' : isManual ? 'text-blue-800' : 'text-gray-700'}>
                                                    {micro.name}
                                                </span>
                                                {isAuto && (
                                                    <span className="text-[9px] px-1 py-0.5 bg-green-200 text-green-700 rounded ml-auto">
                                                        Otomatik
                                                    </span>
                                                )}
                                                {!isAuto && isManual && (
                                                    <span className="text-[9px] px-1 py-0.5 bg-blue-200 text-blue-700 rounded ml-auto">
                                                        Manuel
                                                    </span>
                                                )}
                                            </label>
                                        )
                                    })}
                                </div>
                                <p className="text-xs text-gray-400 mt-1">
                                    <span className="text-green-600">Otomatik:</span> Admin panelden tanımlanan kelimeler ile eşleşti.
                                    <span className="text-blue-600 ml-1">Manuel:</span> Elle işaretlendi.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Fixed Footer */}
                <div className="p-4 border-t bg-gray-50 shrink-0">
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={onClose} className="flex-1">İptal</Button>
                        <Button onClick={handleSave} disabled={saving} className="flex-1 bg-green-500 hover:bg-green-600">
                            {saving ? 'Kaydediliyor...' : 'Kaydet'}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}

// ================== FILTER SETTINGS PANEL ==================
function FilterSettingsPanel({ fields, onSave }: { fields: FilterFieldConfig[]; onSave: (fields: FilterFieldConfig[]) => void }) {
    const [editedFields, setEditedFields] = useState<FilterFieldConfig[]>(fields)
    const [newName, setNewName] = useState('')
    const [newLabel, setNewLabel] = useState('')
    const [newType, setNewType] = useState<'text' | 'select' | 'number'>('text')
    const [newOpts, setNewOpts] = useState('')

    function addField() {
        if (!newName || !newLabel) return
        setEditedFields([...editedFields, { value: newName, label: newLabel, type: newType, options: newType === 'select' ? newOpts.split(',').map(o => o.trim()).filter(Boolean) : undefined }])
        setNewName(''); setNewLabel(''); setNewOpts('')
    }

    return (
        <div className="space-y-4">
            <div className="space-y-1 max-h-48 overflow-y-auto">
                {editedFields.map(f => (
                    <div key={f.value} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-xs">
                        <span className="font-medium w-20">{f.label}</span>
                        <span className="text-gray-400 text-[10px]">({f.type})</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto text-red-500" onClick={() => setEditedFields(editedFields.filter(x => x.value !== f.value))}><X size={12} /></Button>
                    </div>
                ))}
            </div>
            <div className="border-t pt-3 grid grid-cols-4 gap-2">
                <Input placeholder="Alan adı" value={newName} onChange={e => setNewName(e.target.value)} className="h-7 text-xs" />
                <Input placeholder="Etiket" value={newLabel} onChange={e => setNewLabel(e.target.value)} className="h-7 text-xs" />
                <select className="h-7 text-xs border rounded px-1" value={newType} onChange={e => setNewType(e.target.value as any)}>
                    <option value="text">Metin</option>
                    <option value="select">Seçenek</option>
                    <option value="number">Sayı</option>
                </select>
                <Button size="sm" className="h-7" onClick={addField}><Plus size={12} /></Button>
            </div>
            <Button className="w-full" onClick={() => onSave(editedFields)}>Kaydet</Button>
        </div>
    )
}
