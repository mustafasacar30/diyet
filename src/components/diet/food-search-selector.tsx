"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { Filter, Check, Search, Plus, AlertTriangle, Heart, Info, Loader2, Sparkles } from "lucide-react"
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
    variant?: 'default' | 'inline'
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
    variant = 'default'
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
        if (!open && scrollRestoreRef.current) {
            const { node, top } = scrollRestoreRef.current;
            if (node === window) {
                window.scrollTo({ top, behavior: 'smooth' });
            } else {
                (node as Element).scrollTo({ top, behavior: 'smooth' });
            }
            scrollRestoreRef.current = null;
        }
    }, [open])

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

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                {variant === 'inline' ? (
                    <div className="flex-1 w-full relative group cursor-text">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-emerald-500 transition-colors" />
                        <input
                            ref={triggerInputRef}
                            className="w-full bg-white ring-1 ring-gray-100 shadow-sm rounded-xl py-3 pl-9 pr-3 text-[13px] outline-none focus:bg-emerald-50/60 focus:ring-2 focus:ring-emerald-400 caret-emerald-600 transition-all placeholder:font-medium placeholder:text-gray-400 scroll-mt-[70px] sm:scroll-mt-[130px]"
                            placeholder="Yeni yemek ekle (örn: pey yum)"
                            value={query}
                            onChange={(e) => { setQuery(e.target.value); if (!open) onOpenChange(true); }}
                            onClick={(e) => { 
                                // Ensure scroll runs on click (safeguard for mobile touch events)
                                if (!scrollRestoreRef.current) {
                                    let scrollNode: Element | Window = window;
                                    let node = e.currentTarget.parentElement;
                                    while(node) {
                                        const overflow = window.getComputedStyle(node).overflowY;
                                        if (overflow === 'auto' || overflow === 'scroll') {
                                            scrollNode = node;
                                            break;
                                        }
                                        node = node.parentElement;
                                    }
                                    const top = scrollNode === window ? window.scrollY : (scrollNode as Element).scrollTop;
                                    scrollRestoreRef.current = { node: scrollNode, top };
                                }
                                const target = e.currentTarget;
                                setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600);
                                if (!open) onOpenChange(true); 
                            }}
                            onFocus={(e) => {
                                // Record current scroll position before scrolling
                                if (!scrollRestoreRef.current) {
                                    let scrollNode: Element | Window = window;
                                    let node = e.target.parentElement;
                                    while(node) {
                                        const overflow = window.getComputedStyle(node).overflowY;
                                        if (overflow === 'auto' || overflow === 'scroll') {
                                            scrollNode = node;
                                            break;
                                        }
                                        node = node.parentElement;
                                    }
                                    const top = scrollNode === window ? window.scrollY : (scrollNode as Element).scrollTop;
                                    scrollRestoreRef.current = { node: scrollNode, top };
                                }
                                const target = e.target;
                                setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600);
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
                <Command shouldFilter={false}>
                    {variant !== 'inline' && (
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
                            {/* Left: Categories */}
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

                            {/* Right: Values */}
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

                    <CommandList>
                        {/* Calorie gap indicator */}
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

                        {/* No DB results */}
                        {filteredFoods.length === 0 && query.length > 0 && !aiLoading && aiSuggestions.length === 0 && (
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

                        {/* AI Loading */}
                        {aiLoading && (
                            <div className="py-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                                <Loader2 size={14} className="animate-spin" />
                                <span>AI ile aranıyor...</span>
                            </div>
                        )}

                        {/* AI Suggestions */}
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
                                        <div className="text-[10px] text-muted-foreground flex gap-2">
                                            <span>{Math.round(food.calories)} kcal</span>
                                            <span className="text-orange-600">K:{Math.round(food.carbs)}</span>
                                            <span className="text-blue-600">P:{Math.round(food.protein)}</span>
                                            <span className="text-yellow-600">Y:{Math.round(food.fat)}</span>
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

                        {filteredFoods.length > 0 && query.length > 2 && aiSuggestions.length === 0 && !aiLoading && (
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
            </PopoverContent>
        </Popover>
    )
}
