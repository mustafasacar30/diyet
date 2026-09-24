"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { Filter, Check, Search, Plus, AlertTriangle, Heart, Info, Loader2, Sparkles, X, Camera, ChefHat, Clock, Lightbulb, ChevronLeft, UtensilsCrossed, Download } from "lucide-react"
import { checkCompatibility, DietRules } from "@/utils/compatibility-checker"
import { supabase } from "@/lib/supabase"
import { useAiLimit } from "@/hooks/use-ai-limit"
import { AiCountdown } from "./ai-countdown"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type Food = {
    id: string
    name: string
    calories: number
    protein: number
    carbs: number
    fat: number
    category?: string
    tags?: string[]
    description?: string // Sometimes used for role
    // Dynamic typing for other props
    [key: string]: any
}

interface FoodSearchSelectorProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    foods: Food[]
    onSelect: (food: Food) => void
    onCreate: (name: string, macros?: { calories: number, protein: number, carbs: number, fat: number }, source?: string) => void
    trigger?: React.ReactNode
    activeDietRules?: DietRules
    patientDiseases?: any[]
    patientLabs?: any[]
    patientMedicationRules?: any[]
    dayDate?: Date
    calorieGap?: number  // Kalori açığı: hedef - mevcut toplam
    proteinGap?: number
    fatGap?: number
    patientId?: string
    variant?: 'default' | 'inline' | 'fullscreen'
    onCameraClick?: () => void
}

// Utility to normalize text for searching (Turkish char support)
function normalizeText(text: string) {
    return text
        .toLowerCase()
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ı/g, 'i')
        .replace(/i̇/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        // Do NOT strip punctuation yet, we need commas for logic
        .trim()
}

const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

export function FoodSearchSelector({
    open,
    onOpenChange,
    foods,
    onSelect,
    onCreate,
    trigger,
    activeDietRules,
    patientDiseases,
    patientLabs,
    patientMedicationRules,
    dayDate,
    calorieGap,
    proteinGap,
    fatGap,
    patientId,
    variant = 'default',
    onCameraClick
}: FoodSearchSelectorProps) {
    const [query, setQuery] = useState("")
    const [showFilters, setShowFilters] = useState(false)
    const [selectedFilters, setSelectedFilters] = useState<Record<string, string[]>>({})
    const [activeFilterCategory, setActiveFilterCategory] = useState<string>("scope")
    const [searchScopes, setSearchScopes] = useState<string[]>(['name']) // Default only name
    const inputRef = useRef<HTMLInputElement>(null)
    const triggerInputRef = useRef<HTMLInputElement>(null)
    const scrollRestoreRef = useRef<{ node: Element | Window, top: number } | null>(null)

    useEffect(() => {
        if (variant === 'fullscreen' && open) {
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [open, variant])

    // Typewriter animation for placeholder
    const [typedPlaceholder, setTypedPlaceholder] = useState("")
    const [showCursor, setShowCursor] = useState(false)
    const typewriterDone = useRef(false)
    const [fsTypedPlaceholder, setFsTypedPlaceholder] = useState("")
    const [fsShowCursor, setFsShowCursor] = useState(false)
    const fsTypewriterDone = useRef(false)

    useEffect(() => {
        if (variant !== 'fullscreen' || !open || fsTypewriterDone.current) return
        const text = "Öğünlerinize yeni yemek ekleyin..."
        let i = 0
        setFsShowCursor(true)
        const timer = setInterval(() => {
            i++
            setFsTypedPlaceholder(text.slice(0, i))
            if (i >= text.length) {
                clearInterval(timer)
                fsTypewriterDone.current = true
                setFsShowCursor(false)
            }
        }, 40)
        return () => clearInterval(timer)
    }, [open, variant])

    useEffect(() => {
        if (variant !== 'inline' || typewriterDone.current) return
        try {
            if (sessionStorage.getItem('food-search-typed')) {
                typewriterDone.current = true
                return
            }
        } catch { return }

        const text = "Yeni yemek ekle (örn: pey yum)"
        let i = 0
        setShowCursor(true)
        const timer = setInterval(() => {
            i++
            setTypedPlaceholder(text.slice(0, i))
            if (i >= text.length) {
                clearInterval(timer)
                typewriterDone.current = true
                setShowCursor(false)
                try { sessionStorage.setItem('food-search-typed', '1') } catch {}
            }
        }, 45)
        return () => clearInterval(timer)
    }, [variant])

    const [aiSuggestions, setAiSuggestions] = useState<Food[]>([])
    const [aiLoading, setAiLoading] = useState(false)
    const aiTimerRef = useRef<NodeJS.Timeout | null>(null)

    const [userId, setUserId] = useState<string | null>(null)
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null))
    }, [])

    const { aiEligibility, checkAiEligibility, recordAiUsage } = useAiLimit()
    const [aiErrorMsg, setAiErrorMsg] = useState<string | null>(null)

    const [macroPreference, setMacroPreference] = useState<number | null>(null)

    useEffect(() => {
        if (open && macroPreference === null) {
            setMacroPreference(0)
        }
        if (!open) {
            setMacroPreference(null) // Reset when closed
        }
    }, [open, proteinGap, fatGap, macroPreference])

    const activeMacroPreference = macroPreference ?? 0

    // Extract available options
    const filterOptions = useMemo(() => {
        const options: Record<string, Set<string>> = {
            category: new Set(),
            tags: new Set(),
            role: new Set(),
            season: new Set(MONTH_NAMES),
            compatibility: new Set()
        }

        foods.forEach(f => {
            if (f.category) options.category.add(f.category)
            if (f.tags && Array.isArray(f.tags)) f.tags.forEach(t => options.tags.add(t))
            if (f.role) options.role.add(f.role)

            // Compatibility tags/keywords placeholder if available
            if (f.compatibility_tags && Array.isArray(f.compatibility_tags)) {
                f.compatibility_tags.forEach(t => options.compatibility.add(t))
            }
        })

        return {
            category: Array.from(options.category).sort(),
            tags: Array.from(options.tags).sort(),
            role: Array.from(options.role).sort(),
            season: MONTH_NAMES,
            compatibility: Array.from(options.compatibility).sort(),
            scope: ['İsim', 'Etiketler', 'Uyumluluk']
        }
    }, [foods])

    // Filter foods locally
    const filteredFoods = useMemo(() => {
        let result = foods

        // 1. Apply Advanced Filters
        const activeFilterKeys = Object.keys(selectedFilters)
        if (activeFilterKeys.length > 0) {
            result = result.filter(food => {
                return activeFilterKeys.every(key => {
                    const selectedValues = selectedFilters[key]
                    if (!selectedValues || selectedValues.length === 0) return true

                    if (key === 'category') {
                        return selectedValues.includes(food.category || '')
                    }
                    if (key === 'tags') {
                        return food.tags?.some(t => selectedValues.includes(t))
                    }
                    if (key === 'role') {
                        return selectedValues.includes(food.role || '')
                    }
                    if (key === 'season') {
                        // Check if food is in season for ANY of the selected months
                        const selectedIndices = selectedValues.map(m => MONTH_NAMES.indexOf(m) + 1)
                        const sStart = food.season_start || 1
                        const sEnd = food.season_end || 12

                        return selectedIndices.some(month => {
                            if (sStart <= sEnd) return month >= sStart && month <= sEnd
                            return month >= sStart || month <= sEnd // Cross-year
                        })
                    }
                    if (key === 'compatibility') {
                        return food.compatibility_tags?.some((t: string) => selectedValues.includes(t))
                    }
                    return true
                })
            })
        }

        // 2. Apply Text Search
        if (!query) {
            // Sort by calorie gap if available
            if (calorieGap !== undefined && calorieGap > 0) {
                return [...result].sort((a, b) => {
                    let scoreA = Math.abs(a.calories - calorieGap)
                    let scoreB = Math.abs(b.calories - calorieGap)

                    if (activeMacroPreference !== 0) {
                        const proteinPriority = Math.max(0, -activeMacroPreference) / 100
                        const fatPriority = Math.max(0, activeMacroPreference) / 100

                        scoreA -= (a.protein * proteinPriority * 5) + (a.fat * fatPriority * 10)
                        scoreB -= (b.protein * proteinPriority * 5) + (b.fat * fatPriority * 10)
                    }

                    return scoreA - scoreB
                }).slice(0, 15)
            }
            return result.slice(0, 15)
        }

        const rawOrGroups = query.split(',')
        const orGroups = rawOrGroups.map(group => {
            const normalizedGroup = normalizeText(group)
            return normalizedGroup.replace(/[.,;:\-]/g, ' ').split(/\s+/).filter(Boolean)
        }).filter(group => group.length > 0)

        return result.filter(food => {
            // Prepare Search Targets based on Scopes
            const targets: string[] = []
            if (searchScopes.includes('name')) targets.push(food.name || "")
            if (searchScopes.includes('tags')) targets.push((food.tags || []).join(' '))
            if (searchScopes.includes('compatibility')) targets.push((food.compatibility_tags || []).join(' '))

            // Normalize the combined target string ONCE for performance if possible, 
            // but effectively we check against normalized terms.
            const dataToSearch = normalizeText(targets.join(' ')).replace(/[.,;:\-]/g, ' ')

            return orGroups.some(terms => {
                return terms.every(term => dataToSearch.includes(term))
            })
        }).slice(0, 20)
    }, [foods, query, selectedFilters, searchScopes, calorieGap, activeMacroPreference])

    // AI fallback when no DB results found
    const triggerAiFallback = useCallback(async (searchQuery: string) => {
        if (!searchQuery || searchQuery.length < 2) return

        const effectivePatientId = patientId || userId
        if (effectivePatientId) {
            const isEligible = await checkAiEligibility(effectivePatientId, 'search')
            if (!isEligible) {
                setAiErrorMsg(`Akıllı arama hakkınız doldu. Yeni bir arama yapabilmek için saat ${aiEligibility.nextAvailableTime ? new Date(aiEligibility.nextAvailableTime!).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '...'} beklemeniz gerekiyor.`)
                return
            }
        }

        setAiLoading(true)
        setAiSuggestions([])
        setAiErrorMsg(null)
        try {
            await recordAiUsage(effectivePatientId || 'unknown_user', 'ai_text_search').catch(e => console.error("Log err", e))

            const response = await fetch('/api/ai/search-food-suggestions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchQuery, count: 10, calorieGap })
            })
            if (response.ok) {
                const data = await response.json()
                setAiSuggestions((data.suggestions || []).map((s: any, i: number) => ({
                    id: `ai_suggestion_${i}`,
                    name: s.name,
                    calories: s.calories || 0,
                    protein: s.protein || 0,
                    carbs: s.carbs || 0,
                    fat: s.fat || 0,
                    category: s.category || 'AI Öneri',
                    _isAiSuggestion: true
                })).sort((a: any, b: any) => {
                    if (calorieGap && calorieGap > 0) {
                        let scoreA = Math.abs(a.calories - calorieGap)
                        let scoreB = Math.abs(b.calories - calorieGap)

                        if (activeMacroPreference !== 0) {
                            const proteinPriority = Math.max(0, -activeMacroPreference) / 100
                            const fatPriority = Math.max(0, activeMacroPreference) / 100

                            scoreA -= (a.protein * proteinPriority * 5) + (a.fat * fatPriority * 10)
                            scoreB -= (b.protein * proteinPriority * 5) + (b.fat * fatPriority * 10)
                        }

                        return scoreA - scoreB
                    }
                    return 0
                }))
            }
        } catch (err) {
            console.error('AI food suggestion error:', err)
        } finally {
            setAiLoading(false)
        }
    }, [calorieGap, activeMacroPreference])

    const [estimatingMacros, setEstimatingMacros] = useState(false)
    const createWithMacroEstimate = useCallback(async (foodQuery: string) => {
        setEstimatingMacros(true)
        try {
            const res = await fetch('/api/ai/estimate-food-macros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: foodQuery })
            })
            if (res.ok) {
                const data = await res.json()
                onCreate(data.food_name || foodQuery, {
                    calories: data.calories || 0,
                    protein: data.protein || 0,
                    carbs: data.carbs || 0,
                    fat: data.fat || 0,
                    food_name: data.food_name || foodQuery,
                    unit: data.unit || 'porsiyon'
                } as any, 'ai_text')
            } else {
                onCreate(foodQuery)
            }
        } catch {
            onCreate(foodQuery)
        } finally {
            setEstimatingMacros(false)
            setQuery("")
        }
    }, [onCreate])

    // Recipe detail sheet state
    const [recipeFood, setRecipeFood] = useState<Food | null>(null)
    const [recipeData, setRecipeData] = useState<any>(null)
    const [recipeLoading, setRecipeLoading] = useState(false)
    const [recipeSource, setRecipeSource] = useState<'db' | 'ai'>('db')
    const recipeContentRef = useRef<HTMLDivElement>(null)
    const [downloading, setDownloading] = useState(false)

    const openRecipeSheet = useCallback((food: Food, source: 'db' | 'ai') => {
        setRecipeFood(food)
        setRecipeSource(source)
        setRecipeData(null)
        setRecipeLoading(true)
        fetch('/api/ai/food-recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                foodName: food.name,
                calories: food.calories,
                protein: food.protein,
                carbs: food.carbs,
                fat: food.fat
            })
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => setRecipeData(data))
            .catch(() => setRecipeData(null))
            .finally(() => setRecipeLoading(false))
    }, [])

    const handleRecipeAdd = useCallback(() => {
        if (!recipeFood) return
        if (recipeSource === 'ai') {
            const macros: any = {
                calories: recipeFood.calories,
                protein: recipeFood.protein,
                carbs: recipeFood.carbs,
                fat: recipeFood.fat,
                food_name: recipeFood.name
            }
            if (recipeData) {
                macros.recipe = recipeData
            }
            onCreate(recipeFood.name, macros, 'ai_text')
        } else {
            onSelect(recipeFood)
        }
        setRecipeFood(null)
        setRecipeData(null)
        setQuery("")
        setAiSuggestions([])
    }, [recipeFood, recipeSource, recipeData, onCreate, onSelect])

    const downloadRecipeAsImage = useCallback(async () => {
        if (!recipeContentRef.current || !recipeFood) return
        setDownloading(true)
        try {
            const html2canvas = (await import('html2canvas-pro')).default
            const canvas = await html2canvas(recipeContentRef.current, {
                backgroundColor: '#f3f1ee',
                scale: 2,
                useCORS: true
            })
            const link = document.createElement('a')
            link.download = `tarif-${recipeFood.name.replace(/\s+/g, '-').toLowerCase()}.png`
            link.href = canvas.toDataURL('image/png')
            link.click()
        } catch (err) {
            console.error('Download error:', err)
        } finally {
            setDownloading(false)
        }
    }, [recipeFood])

    // Debounced AI search when no DB results
    useEffect(() => {
        if (aiTimerRef.current) clearTimeout(aiTimerRef.current)
        if (filteredFoods.length === 0 && query.length >= 2) {
            aiTimerRef.current = setTimeout(() => triggerAiFallback(query), 800)
        } else {
            setAiSuggestions([])
        }
        return () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current) }
    }, [query, filteredFoods.length, triggerAiFallback])

    const toggleFilter = (category: string, value: string) => {
        if (category === 'scope') {
            const mapKeys: Record<string, string> = { 'İsim': 'name', 'Etiketler': 'tags', 'Uyumluluk': 'compatibility' }
            const scopeKey = mapKeys[value]
            if (searchScopes.includes(scopeKey)) {
                if (searchScopes.length > 1) setSearchScopes(prev => prev.filter(s => s !== scopeKey))
            } else {
                setSearchScopes(prev => [...prev, scopeKey])
            }
            return
        }

        setSelectedFilters(prev => {
            const current = prev[category] || []
            const exists = current.includes(value)
            if (exists) {
                const updated = current.filter(v => v !== value)
                if (updated.length === 0) {
                    const { [category]: _, ...rest } = prev
                    return rest
                }
                return { ...prev, [category]: updated }
            } else {
                return { ...prev, [category]: [...current, value] }
            }
        })
    }

    const searchContent = (
        <Command shouldFilter={false} className={variant === 'fullscreen' ? "flex flex-col h-full" : undefined}>
            {variant === 'fullscreen' && (
                <div className="flex items-center border-b px-3 gap-2 bg-white shrink-0">
                    <Search className="h-4 w-4 shrink-0 text-emerald-500" />
                    <input
                        ref={inputRef}
                        className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-gray-400"
                        placeholder={fsTypewriterDone.current ? "Öğünlerinize yeni yemek ekleyin..." : (fsTypedPlaceholder + (fsShowCursor ? "│" : ""))}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                    {onCameraClick && (
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0 text-blue-500 hover:bg-blue-50"
                            onClick={() => { onOpenChange(false); setQuery(""); onCameraClick() }}
                            title="Fotoğraf ile Ekle"
                        >
                            <Camera size={16} />
                        </Button>
                    )}
                    <Button
                        size="icon"
                        variant="ghost"
                        className={`h-8 w-8 shrink-0 ${query.length > 1 ? 'text-purple-500 hover:bg-purple-50' : 'text-gray-300 cursor-not-allowed'}`}
                        onClick={() => { if (query.length > 1) triggerAiFallback(query) }}
                        title={query.length > 1 ? "AI ile Ara" : "Önce bir yemek adı yazın"}
                        disabled={query.length <= 1}
                    >
                        <Sparkles size={16} />
                    </Button>
                    <Button
                        size="icon"
                        variant={showFilters ? "secondary" : "ghost"}
                        className="h-8 w-8 shrink-0"
                        onClick={() => setShowFilters(!showFilters)}
                        title="Filtrele"
                    >
                        <Filter size={16} className={(Object.keys(selectedFilters).length > 0 || searchScopes.length > 1) ? "text-emerald-600" : ""} />
                    </Button>
                </div>
            )}
            {variant === 'default' && (
                <div className="flex items-center border-b px-3 gap-2">
                    <Search className="h-4 w-4 shrink-0 opacity-50" />
                    <input
                        ref={inputRef}
                        className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                        placeholder="Yemek ara... (örn: pey yum)"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        autoFocus
                    />
                    <Button
                        size="icon"
                        variant={showFilters ? "secondary" : "ghost"}
                        className="h-8 w-8"
                        onClick={() => setShowFilters(!showFilters)}
                        title="Filtrele"
                    >
                        <Filter size={16} className={(Object.keys(selectedFilters).length > 0 || searchScopes.length > 1) ? "text-blue-600" : ""} />
                    </Button>
                </div>
            )}
            {variant === 'inline' && (
                <div className="flex justify-end p-1 border-b bg-gray-50/50">
                    <Button
                        size="sm"
                        variant={showFilters ? "secondary" : "ghost"}
                        className="h-7 text-[10px]"
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <Filter size={12} className={(Object.keys(selectedFilters).length > 0 || searchScopes.length > 1) ? "text-blue-600 mr-1" : "mr-1"} />
                        Filtreler
                    </Button>
                </div>
            )}

            {showFilters && (
                <div className="flex h-64 border-b text-xs">
                    <div className="w-1/3 border-r bg-gray-50 p-1 space-y-0.5 overflow-y-auto">
                        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Arama Ayarları</div>
                        <button
                            className={`w-full text-left px-2 py-1.5 rounded flex justify-between items-center ${activeFilterCategory === 'scope' ? 'bg-white shadow-sm font-medium text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`}
                            onClick={() => setActiveFilterCategory('scope')}
                        >
                            <span>Arama Kapsamı</span>
                            {searchScopes.length > 0 && <span className="bg-blue-100 text-blue-700 px-1.5 rounded-full text-[9px]">{searchScopes.length}</span>}
                        </button>

                        <div className="px-2 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-2">Filtreler</div>
                        {['category', 'role', 'tags', 'season', 'compatibility'].map(cat => (
                            <button
                                key={cat}
                                className={`w-full text-left px-2 py-1.5 rounded flex justify-between items-center ${activeFilterCategory === cat ? 'bg-white shadow-sm font-medium text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`}
                                onClick={() => setActiveFilterCategory(cat)}
                            >
                                <span className="capitalize">{cat === 'category' ? 'Kategori' : cat === 'tags' ? 'Diyet/Etiket' : cat === 'role' ? 'Rol' : cat === 'season' ? 'Sezon' : cat === 'compatibility' ? 'Uyumluluk' : cat}</span>
                                {selectedFilters[cat]?.length > 0 && (
                                    <span className="bg-blue-100 text-blue-700 px-1.5 rounded-full text-[9px]">{selectedFilters[cat].length}</span>
                                )}
                            </button>
                        ))}
                        {(Object.keys(selectedFilters).length > 0) && (
                            <button className="w-full text-left px-2 py-1.5 text-red-500 hover:bg-red-50 mt-4 text-[10px]" onClick={() => setSelectedFilters({})}>
                                Filtreleri Temizle
                            </button>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-1">
                        {(filterOptions[activeFilterCategory as keyof typeof filterOptions] || []).length === 0 ? (
                            <div className="text-gray-400 p-2 italic">Seçenek yok</div>
                        ) : (
                            (filterOptions[activeFilterCategory as keyof typeof filterOptions] || []).map((val: string) => {
                                let isSelected = false
                                if (activeFilterCategory === 'scope') {
                                    const mapKeys: Record<string, string> = { 'İsim': 'name', 'Etiketler': 'tags', 'Uyumluluk': 'compatibility' }
                                    isSelected = searchScopes.includes(mapKeys[val])
                                } else {
                                    isSelected = selectedFilters[activeFilterCategory]?.includes(val)
                                }

                                return (
                                    <button
                                        key={val}
                                        className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 mb-0.5 ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}
                                        onClick={() => toggleFilter(activeFilterCategory, val)}
                                    >
                                        <div className={`w-3 h-3 border rounded flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                                            {isSelected && <Check size={8} className="text-white" />}
                                        </div>
                                        <span className="truncate">{val}</span>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            )}

            {variant === 'fullscreen' && query.length > 1 && (
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50/80 shrink-0">
                    <button
                        onClick={() => triggerAiFallback(query)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition-colors"
                    >
                        <Sparkles size={13} />
                        AI ile Ara
                    </button>
                    <button
                        onClick={() => createWithMacroEstimate(query)}
                        disabled={estimatingMacros}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                    >
                        {estimatingMacros ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        {estimatingMacros ? 'Makrolar hesaplanıyor...' : <>&ldquo;{query.length > 15 ? query.slice(0, 15) + '...' : query}&rdquo; Ekle</>}
                    </button>
                </div>
            )}

            <CommandList className={variant === 'fullscreen' ? "max-h-none flex-1 overflow-y-auto pb-[300px]" : undefined}>
                {calorieGap !== undefined && calorieGap > 0 && !query && (
                    <div className="flex flex-col border-b bg-emerald-50/50">
                        <div className="px-3 py-1.5 text-[10px] text-emerald-700 flex items-center gap-1">
                            <Info size={10} />
                            <span>Kalori açığı: <strong>{Math.round(calorieGap)} kcal</strong> — en yakın eşleşmeler üstte</span>
                        </div>
                        {(proteinGap !== undefined || fatGap !== undefined) && (
                            <div className="px-4 pb-3 pt-1">
                                <div className="flex justify-between text-[9px] font-medium text-gray-500 mb-1.5 px-1">
                                    <span className={activeMacroPreference < 0 ? "text-blue-600 font-bold" : ""}>Protein Öncelikli</span>
                                    <span className={activeMacroPreference === 0 ? "text-gray-700 font-bold" : ""}>Dengeli</span>
                                    <span className={activeMacroPreference > 0 ? "text-yellow-600 font-bold" : ""}>Yağ Öncelikli</span>
                                </div>
                                <Slider
                                    defaultValue={[activeMacroPreference]}
                                    value={[activeMacroPreference]}
                                    min={-100}
                                    max={100}
                                    step={5}
                                    onValueChange={(vals) => setMacroPreference(vals[0])}
                                />
                            </div>
                        )}
                    </div>
                )}

                {filteredFoods.length === 0 && query.length > 0 && !aiLoading && aiSuggestions.length === 0 && (
                    variant === 'fullscreen' ? (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                            <p>"{query}" veritabanında bulunamadı.</p>
                            <p className="text-xs mt-1">Yukarıdaki butonlarla AI ile arayabilir veya yeni oluşturabilirsiniz.</p>
                        </div>
                    ) : (
                        <div className="py-6 text-center text-sm flex flex-col items-center gap-2">
                            <p className="text-muted-foreground mb-2">"{query}" bulunamadı.</p>
                            <div className="flex items-center gap-2">
                                <Button size="sm" variant="secondary" className="h-8 gap-1 text-purple-600 border-purple-200 bg-purple-50 hover:bg-purple-100" onClick={() => triggerAiFallback(query)}>
                                    <Sparkles size={14} /> AI'ya Sor
                                </Button>
                                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => onCreate(query)}>
                                    <Plus size={14} /> Yeni Oluştur
                                </Button>
                            </div>
                        </div>
                    )
                )}

                {aiErrorMsg && (
                    <div className="w-full my-1 p-2 bg-orange-50/80 text-orange-900 text-[11px] flex flex-col items-center gap-1 border-y border-orange-100/50 animate-in fade-in slide-in-from-top-1 duration-200">
                        <div className="flex items-center gap-1.5 opacity-90">
                            <AlertTriangle size={13} className="text-orange-600 shrink-0" />
                            <span className="font-bold text-orange-800 uppercase tracking-tighter text-[9px]">Analiz Sınırı</span>
                        </div>
                        <span className="text-center font-medium leading-tight px-2 break-words w-full">
                            {aiEligibility.nextAvailableTime ? (
                                <>Akıllı arama hakkınız doldu. <br/> Yeni arama için: <AiCountdown endDate={aiEligibility.nextAvailableTime} /></>
                            ) : aiErrorMsg}
                        </span>
                        <button
                            className="mt-1 text-[10px] font-bold text-orange-700 hover:text-orange-900 underline underline-offset-2"
                            onClick={() => setAiErrorMsg(null)}
                        >
                            Anladım
                        </button>
                    </div>
                )}

                {aiLoading && (
                    <div className="py-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        <span>AI ile aranıyor...</span>
                    </div>
                )}

                {aiSuggestions.length > 0 && (
                    <CommandGroup heading={
                        <span className="flex items-center gap-1">
                            <Sparkles size={12} className="text-purple-500" />
                            AI Önerileri ({aiSuggestions.length})
                        </span>
                    }>
                        {aiSuggestions.map(food => (
                            <CommandItem
                                key={food.id}
                                value={food.id}
                                onSelect={() => { onCreate(food.name, { calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat }, 'ai_text'); setQuery(""); setAiSuggestions([]) }}
                                className="flex flex-col items-start gap-1 py-2 cursor-pointer"
                            >
                                <div className="font-medium flex items-center gap-2 w-full justify-between">
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <Sparkles size={10} className="text-purple-400 shrink-0" />
                                        <span className="truncate">{food.name}</span>
                                    </span>
                                    <Badge variant="outline" className="text-[9px] h-4 font-normal text-purple-500 border-purple-200 shrink-0">AI</Badge>
                                </div>
                                <div className="text-[10px] text-muted-foreground flex gap-2 w-full justify-between">
                                    <div className="flex gap-2">
                                        <span>{Math.round(food.calories)} kcal</span>
                                        <span className="text-orange-600">K:{Math.round(food.carbs)}</span>
                                        <span className="text-blue-600">P:{Math.round(food.protein)}</span>
                                        <span className="text-yellow-600">Y:{Math.round(food.fat)}</span>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); openRecipeSheet(food, 'ai') }}
                                        className="text-[9px] font-semibold text-orange-500 hover:text-orange-700 flex items-center gap-0.5 shrink-0"
                                    >
                                        <ChefHat size={10} />
                                        Tarif
                                    </button>
                                </div>
                            </CommandItem>
                        ))}
                        <CommandItem onSelect={() => onCreate(query)} className="text-blue-600 cursor-pointer mt-1">
                            <Plus size={14} className="mr-2" /> "{query}" olarak yeni oluştur
                        </CommandItem>
                    </CommandGroup>
                )}

                {filteredFoods.length > 0 && (
                    <CommandGroup heading={`Sonuçlar (${filteredFoods.length})`}>
                        {filteredFoods.map(food => {
                            const compatibility = checkCompatibility(food, activeDietRules, patientDiseases, patientLabs, patientMedicationRules)
                            return (
                                <TooltipProvider key={food.id}>
                                    <Tooltip delayDuration={300}>
                                        <TooltipTrigger asChild>
                                            <CommandItem
                                                value={food.id}
                                                onSelect={() => { onSelect(food); setQuery("") }}
                                                className="flex flex-col items-start gap-1 py-2 cursor-pointer"
                                            >
                                                <div className="font-medium flex items-center gap-2 w-full justify-between">
                                                    <span className="flex items-center gap-1.5 min-w-0">
                                                        {!compatibility.compatible && <AlertTriangle size={12} className="text-red-500 shrink-0" />}
                                                        {compatibility.recommended && <Heart size={12} fill="currentColor" className="text-blue-500 shrink-0" />}
                                                        <span className="truncate">{food.name}</span>
                                                    </span>
                                                    {food.category && <Badge variant="outline" className="text-[9px] h-4 font-normal text-gray-500 shrink-0">{food.category}</Badge>}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground flex gap-2">
                                                    <span>{Math.round(food.calories)} kcal</span>
                                                    <span className="text-orange-600">K:{Math.round(food.carbs)}</span>
                                                    <span className="text-blue-600">P:{Math.round(food.protein)}</span>
                                                    <span className="text-yellow-600">Y:{Math.round(food.fat)}</span>
                                                </div>
                                            </CommandItem>
                                        </TooltipTrigger>
                                        <TooltipContent side="right" className="max-w-sm text-xs p-3">
                                            <div className="space-y-2">
                                                <div className="font-bold border-b pb-1 mb-1">{food.name}</div>
                                                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                                    <div className="flex justify-between"><span>Enerji:</span> <span>{Math.round(food.calories)} kcal</span></div>
                                                    <div className="flex justify-between text-orange-600"><span>Karbonhidrat:</span> <span>{Math.round(food.carbs)}g</span></div>
                                                    <div className="flex justify-between text-blue-600"><span>Protein:</span> <span>{Math.round(food.protein)}g</span></div>
                                                    <div className="flex justify-between text-yellow-600"><span>Yağ:</span> <span>{Math.round(food.fat)}g</span></div>
                                                </div>

                                                {compatibility.warnings?.length > 0 && (
                                                    <div className="mt-2 pt-2 border-t border-gray-200">
                                                        <div className="font-semibold text-red-600 mb-1">Uyumluluk Uyarıları:</div>
                                                        {compatibility.warnings.map((w, i) => (
                                                            <div key={i} className="text-[10px] leading-tight mb-1 flex gap-1 items-start">
                                                                <span>{w.type === 'negative' ? '🚫' : '⚠️'}</span>
                                                                <span><strong>{w.sourceName}:</strong> {w.warning || w.info || w.keyword}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {compatibility.reason && !compatibility.compatible && (
                                                    <div className="mt-1 text-[10px] text-red-500 italic">{compatibility.reason}</div>
                                                )}
                                            </div>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )
                        })}
                    </CommandGroup>
                )}

                {variant !== 'fullscreen' && filteredFoods.length > 0 && query.length > 2 && aiSuggestions.length === 0 && !aiLoading && (
                    <CommandGroup heading="Diğer">
                        <CommandItem onSelect={() => triggerAiFallback(query)} className="text-purple-600 cursor-pointer font-medium border border-purple-100 bg-purple-50/50 mb-1 rounded-sm">
                            <Sparkles size={14} className="mr-2" /> Aradığınızı bulamadınız mı? "{query}" için AI'ya Sor
                        </CommandItem>
                        <CommandItem onSelect={() => onCreate(query)} className="text-blue-600 cursor-pointer">
                            <Plus size={14} className="mr-2" /> "{query}" olarak yeni oluştur
                        </CommandItem>
                    </CommandGroup>
                )}
            </CommandList>
        </Command>
    )

    if (variant === 'fullscreen') {
        return (
            <>
                <span onClick={() => onOpenChange(true)}>{trigger}</span>
                {open && typeof document !== 'undefined' && createPortal(
                    <div className="fixed inset-0 bg-white flex flex-col" style={{ zIndex: 99999, height: '100dvh' }}>
                        <div className="flex items-center justify-between px-3 py-2 border-b bg-emerald-50 shrink-0">
                            <h2 className="text-sm font-bold text-emerald-800">Yemek Ara</h2>
                            <button
                                onClick={() => { onOpenChange(false); setQuery("") }}
                                className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-emerald-100 text-emerald-600"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                            {searchContent}
                        </div>

                        {/* Recipe Detail Bottom Sheet */}
                        {recipeFood && (
                            <div className="absolute inset-0 flex flex-col animate-in slide-in-from-bottom duration-200" style={{ zIndex: 100000, background: '#f3f1ee' }}>
                                {/* Header */}
                                <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid #ddd6cf', background: '#ece7e1' }}>
                                    <button
                                        onClick={() => { setRecipeFood(null); setRecipeData(null) }}
                                        className="h-8 w-8 rounded-full flex items-center justify-center"
                                        style={{ color: '#6a844a' }}
                                    >
                                        <ChevronLeft size={20} />
                                    </button>
                                    <div className="flex-1 min-w-0">
                                        <h2 className="text-sm font-bold truncate" style={{ color: '#171717', fontFamily: 'Georgia, serif' }}>{recipeFood.name}</h2>
                                        <div className="text-[10px] flex gap-2" style={{ color: '#666' }}>
                                            <span>{Math.round(recipeFood.calories)} kcal</span>
                                            <span>P:{Math.round(recipeFood.protein)}</span>
                                            <span>K:{Math.round(recipeFood.carbs)}</span>
                                            <span>Y:{Math.round(recipeFood.fat)}</span>
                                        </div>
                                    </div>
                                    {recipeData && !recipeLoading && (
                                        <button
                                            onClick={downloadRecipeAsImage}
                                            disabled={downloading}
                                            className="h-8 w-8 rounded-full flex items-center justify-center"
                                            style={{ color: '#6a844a' }}
                                            title="Tarifi İndir"
                                        >
                                            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setRecipeFood(null); setRecipeData(null) }}
                                        className="h-8 w-8 rounded-full flex items-center justify-center"
                                        style={{ color: '#666' }}
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="flex-1 overflow-y-auto pb-24">
                                    {recipeLoading ? (
                                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                                            <Loader2 size={24} className="animate-spin text-orange-500" />
                                            <span className="text-sm text-gray-500">Tarif hazırlanıyor...</span>
                                        </div>
                                    ) : recipeData ? (
                                        <div ref={recipeContentRef} style={{ background: '#f3f1ee', fontFamily: 'Georgia, serif' }}>
                                            {/* Hero image */}
                                            <div style={{ background: 'linear-gradient(135deg, #c9bfb5 0%, #ece7e1 50%, #d4cdc4 100%)', height: '160px', position: 'relative', overflow: 'hidden' }}>
                                                {recipeData.image_url ? (
                                                    <img src={recipeData.image_url} alt={recipeFood.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                ) : (
                                                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <div style={{ textAlign: 'center', color: '#8a7f73' }}>
                                                            <ChefHat size={32} style={{ margin: '0 auto 4px', opacity: 0.5 }} />
                                                            <div style={{ fontSize: '10px', fontFamily: 'system-ui', opacity: 0.6 }}>Görsel yükleniyor...</div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Title pill */}
                                            <div style={{ margin: '-20px 16px 0', position: 'relative', zIndex: 2 }}>
                                                <div style={{ background: '#ece7e1', borderRadius: '16px', padding: '12px 16px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                                                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#171717', fontFamily: 'Georgia, serif' }}>{recipeFood.name}</h3>
                                                </div>
                                            </div>

                                            <div style={{ padding: '12px 16px 16px' }}>
                                                {/* Two column: ingredients + macros */}
                                                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                                                    {/* Ingredients */}
                                                    <div style={{ flex: 1 }}>
                                                        <h4 style={{ fontSize: '16px', fontWeight: 500, color: '#171717', margin: '0 0 8px', fontFamily: 'Georgia, serif' }}>Malzemeler</h4>
                                                        {recipeData.ingredients && recipeData.ingredients.length > 0 && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                {recipeData.ingredients.map((ing: any, i: number) => (
                                                                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '12px', color: '#171717', fontFamily: 'system-ui' }}>
                                                                        <span style={{ color: '#6a844a', fontSize: '8px' }}>●</span>
                                                                        <span>
                                                                            {ing.amount && <span style={{ fontWeight: 600, color: '#6a844a' }}>{ing.amount} {ing.unit} </span>}
                                                                            {ing.name}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Macro box + serving */}
                                                    <div style={{ width: '120px', flexShrink: 0 }}>
                                                        {recipeData.serving && (
                                                            <div style={{ fontSize: '11px', fontWeight: 800, color: '#171717', textAlign: 'center', marginBottom: '6px', fontFamily: 'system-ui' }}>
                                                                Servis: {recipeData.serving}
                                                            </div>
                                                        )}
                                                        <div style={{ background: '#ece7e1', borderRadius: '14px', padding: '10px 8px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '9px', fontWeight: 800, color: '#171717', marginBottom: '6px', fontFamily: 'system-ui', lineHeight: 1.2 }}>1 porsiyon için<br />makro değerleri</div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', fontFamily: 'system-ui' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#171717' }}>
                                                                    <span>Kalori</span>
                                                                    <span style={{ fontWeight: 700 }}>{Math.round(recipeFood.calories)}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#171717' }}>
                                                                    <span>Protein</span>
                                                                    <span style={{ fontWeight: 700 }}>{Math.round(recipeFood.protein)}g</span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#171717' }}>
                                                                    <span>Karb.</span>
                                                                    <span style={{ fontWeight: 700 }}>{Math.round(recipeFood.carbs)}g</span>
                                                                </div>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#171717' }}>
                                                                    <span>Yağ</span>
                                                                    <span style={{ fontWeight: 700 }}>{Math.round(recipeFood.fat)}g</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {(recipeData.prep_time || recipeData.cook_time) && (
                                                            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '10px', color: '#666', fontFamily: 'system-ui', textAlign: 'center' }}>
                                                                {recipeData.prep_time && <div>⏱ Hazırlık: {recipeData.prep_time}</div>}
                                                                {recipeData.cook_time && <div>🔥 Pişirme: {recipeData.cook_time}</div>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Preparation - single paragraph */}
                                                {(recipeData.preparation || (recipeData.steps && recipeData.steps.length > 0)) && (
                                                    <div style={{ marginTop: '14px' }}>
                                                        <h4 style={{ fontSize: '16px', fontWeight: 500, color: '#171717', margin: '0 0 8px', fontFamily: 'Georgia, serif' }}>Hazırlama</h4>
                                                        <p style={{ margin: 0, fontSize: '12px', fontFamily: 'system-ui', color: '#171717', lineHeight: 1.5, textAlign: 'justify' }}>
                                                            {recipeData.preparation || recipeData.steps.join(' ')}
                                                        </p>
                                                    </div>
                                                )}

                                                {/* Tip */}
                                                {recipeData.tip && (
                                                    <div style={{ marginTop: '12px', display: 'flex', gap: '6px', padding: '10px 12px', borderRadius: '12px', background: '#e8e3db', border: '1px solid #ddd6cf' }}>
                                                        <Lightbulb size={14} style={{ color: '#6a844a', flexShrink: 0, marginTop: '1px' }} />
                                                        <span style={{ fontSize: '11px', color: '#4a4540', lineHeight: 1.4, fontFamily: 'system-ui' }}>{recipeData.tip}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-12 gap-2 text-gray-400">
                                            <ChefHat size={24} />
                                            <span className="text-sm">Tarif yüklenemedi</span>
                                        </div>
                                    )}
                                </div>

                                {/* Bottom Add Button */}
                                <div className="absolute bottom-0 left-0 right-0 p-3" style={{ background: '#ece7e1', borderTop: '1px solid #ddd6cf' }}>
                                    <button
                                        onClick={handleRecipeAdd}
                                        className="w-full py-3 rounded-xl text-sm font-bold text-white transition-colors flex items-center justify-center gap-2"
                                        style={{ background: '#2c6e49' }}
                                    >
                                        <Plus size={16} />
                                        Öğüne Ekle
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>,
                    document.body
                )}
            </>
        )
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                {variant === 'inline' ? (
                    <div className="flex-1 w-full relative group cursor-text">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-emerald-500 transition-colors" />
                        <input
                            ref={triggerInputRef}
                            className="w-full bg-emerald-50/70 ring-1 ring-emerald-200 shadow-sm rounded-lg py-2 pl-9 pr-3 text-[12px] outline-none focus:bg-emerald-50 focus:ring-2 focus:ring-emerald-400 caret-emerald-600 transition-all placeholder:font-medium placeholder:text-gray-400 scroll-mt-[70px] sm:scroll-mt-[130px]"
                            placeholder={typewriterDone.current ? "Yeni yemek ekle (örn: pey yum)" : (typedPlaceholder + (showCursor ? "│" : ""))}
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); if (!open) onOpenChange(true); }}
                            onClick={() => {
                                if (!open) onOpenChange(true);
                            }}
                            onFocus={() => {
                                if (!open) onOpenChange(true);
                            }}
                        />
                    </div>
                ) : trigger}
            </PopoverTrigger>
            <PopoverContent
                className="p-0 w-[min(500px,calc(100vw-2rem))] bg-slate-50 border border-indigo-100 shadow-[0_15px_50px_-12px_rgba(0,0,0,0.25)] rounded-2xl overflow-hidden"
                align="start"
                side="bottom"
                avoidCollisions={false}
                sideOffset={8}
                onOpenAutoFocus={e => variant === 'inline' ? e.preventDefault() : undefined}
            >
                {searchContent}
            </PopoverContent>
        </Popover>
    )
}
