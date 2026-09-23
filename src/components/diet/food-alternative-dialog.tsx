import { useState, useEffect, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"
import { checkCompatibility, DietRules } from "@/utils/compatibility-checker"
import { Settings, RefreshCw, AlertTriangle, Pencil, Target, Search, ChevronsUpDown, Check, Info, Heart, Pill, CheckCircle2, MinusCircle, FlaskConical, Stethoscope } from "lucide-react"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { FoodEditDialog } from "./food-sidebar"

// Types
type FilterPrefs = {
    includeCategory: boolean
    includeRole: boolean
    includeDietType: boolean
    includeMealType: boolean
    checkSeason: boolean
    excludeTags: boolean
    excludeNameCollision: boolean
    excludeTagsCollision: boolean
    excludeConsecutive: boolean
    limit: number
    useGapClosingMode: boolean
    weights: {
        calories: number
        protein: number
        carbs: number
        fat: number
        mainDishCompat: number
    }
    showSettingsPanel: boolean
    ignoredWords: string
    ignoredTagWords: string
}

type FlavorTuningSettings = {
    enabled: boolean
    allow_post_edit: boolean
    respect_scope_filters: boolean
    respect_frequency_rules: boolean
    strict_locked_items: boolean
    suggestion_count: number
    macro_weight: number
    flavor_weight: number
    diversity_weight: number
    compatibility_weight: number
}

const DEFAULT_PREFS: FilterPrefs = {
    includeCategory: true,
    includeRole: false,
    includeDietType: true,
    includeMealType: false,
    checkSeason: false,
    excludeTags: false,
    excludeTagsCollision: false,
    excludeNameCollision: false,
    excludeConsecutive: true,
    limit: 5,
    useGapClosingMode: false,
    weights: {
        calories: 100,
        protein: 50,
        carbs: 20,
        fat: 20,
        mainDishCompat: 50
    },
    showSettingsPanel: false,
    ignoredWords: "ve, ile, soslu, sote, haşlama, ızgara, tava, yemeği, çorbası, salatası, ezmesi, kıyma, gram, adet, porsiyon, dilim",
    ignoredTagWords: "kahvaltılık, atıştırmalık"
}

const DEFAULT_FLAVOR_TUNING: FlavorTuningSettings = {
    enabled: true,
    allow_post_edit: true,
    respect_scope_filters: true,
    respect_frequency_rules: true,
    strict_locked_items: true,
    suggestion_count: 3,
    macro_weight: 0.4,
    flavor_weight: 0.35,
    diversity_weight: 0.15,
    compatibility_weight: 0.1,
}

const FOODS_CACHE_TTL_MS = 5 * 60 * 1000
const SETTINGS_CACHE_TTL_MS = 2 * 60 * 1000

let foodsCache: { value: any[]; fetchedAt: number } | null = null
let foodsInFlight: Promise<any[] | null> | null = null
const settingsCache = new Map<string, { value: FilterPrefs; fetchedAt: number }>()

function clampFlavorWeight(value: unknown, fallback: number, min: number, max: number) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return fallback
    return Math.min(max, Math.max(min, numeric))
}

function uniqueWordsFromName(value: string) {
    return Array.from(
        new Set(
            String(value || "")
                .toLocaleLowerCase("tr-TR")
                .replace(/[^\p{L}\p{N}\s]/gu, " ")
                .split(/\s+/)
                .map(s => s.trim())
                .filter(s => s.length >= 3)
        )
    )
}

export interface FoodAlternativeDialogProps {
    isOpen: boolean
    onClose: () => void
    originalFood: any
    onSelect: (food: any) => void
    currentMonth?: number
    nearbyUsedFoodIds?: string[]
    originalFoodToRevert?: any
    mainDishOfSlot?: any
    dailyTotals?: any
    dailyTargets?: any
    patientId?: string
    hideSettings?: boolean
    originalFoodToRevertId?: string
    // Health Data for Compatibility Checks
    activeDietRules?: DietRules
    patientDiseases?: any[]
    patientLabs?: any[]
    patientMedicationRules?: any[]
}

export function FoodAlternativeDialog({ isOpen, onClose, originalFood, onSelect, currentMonth = new Date().getMonth() + 1, nearbyUsedFoodIds = [], originalFoodToRevert, originalFoodToRevertId, mainDishOfSlot, dailyTotals, dailyTargets, patientId, hideSettings = false, activeDietRules, patientDiseases, patientLabs, patientMedicationRules }: FoodAlternativeDialogProps) {
    const [loading, setLoading] = useState(false)
    const [foods, setFoods] = useState<any[]>([])
    const [prefs, setPrefs] = useState<FilterPrefs>(DEFAULT_PREFS)
    const [flavorSettings, setFlavorSettings] = useState<FlavorTuningSettings>(DEFAULT_FLAVOR_TUNING)
    const [editingFood, setEditingFood] = useState<any>(null)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [expandedFoodId, setExpandedFoodId] = useState<string | null>(null)
    const [expandedSearchFoodId, setExpandedSearchFoodId] = useState<string | null>(null)

    const isTargetMainDish = useMemo(() => {
        if (!originalFood) return false
        const role = (originalFood.role || "").toLowerCase()
        return role.includes("ana yemek") || role.includes("anayemek") || role.includes("maindish") || role === "main"
    }, [originalFood])

    const [macroPreference, setMacroPreference] = useState<number | null>(null)
    const [portionMultiplier, setPortionMultiplier] = useState<number>(1)

    // Handle portion multiplier selection without triggering swap immediately
    const handlePortionChange = (newMultiplier: number) => {
        setPortionMultiplier(newMultiplier)
    }

    // Wrap the original onSelect to pass the portionMultiplier
    const handleSelectWithPortion = (food: any) => {
        onSelect({
            ...food,
            portion_multiplier: portionMultiplier
        })
    }

    useEffect(() => {
        if (isOpen && originalFood) {
            setPortionMultiplier(originalFood.portion_multiplier || 1)
        }
    }, [isOpen, originalFood])

    useEffect(() => {
        if (isOpen && macroPreference === null) {
            if (prefs.useGapClosingMode && dailyTotals && dailyTargets && originalFood) {
                const currentTotalWithoutOriginal = {
                    protein: (dailyTotals.protein || 0) - (originalFood.protein || 0),
                    fat: (dailyTotals.fat || 0) - (originalFood.fat || 0),
                }

                const gapP = Math.max(0, (dailyTargets.protein || 0) - currentTotalWithoutOriginal.protein)
                const gapF = Math.max(0, (dailyTargets.fat || 0) - currentTotalWithoutOriginal.fat)

                const totalGap = gapP + gapF
                if (totalGap > 0) {
                    const proteinWeight = gapP / totalGap
                    const fatWeight = gapF / totalGap
                    setMacroPreference(Math.round((fatWeight - proteinWeight) * 100))
                } else {
                    setMacroPreference(0)
                }
            } else {
                setMacroPreference(0)
            }
        }
        if (!isOpen) {
            setMacroPreference(null)
        }
    }, [isOpen, prefs.useGapClosingMode, dailyTotals, dailyTargets, originalFood, macroPreference])

    const activeMacroPreference = macroPreference ?? 0

    useEffect(() => {
        if (!isOpen) return
        const now = Date.now()
        const settingsKey = patientId ? `food_alternative_prefs_${patientId}` : 'food_alternative_prefs'

        const cachedSettings = settingsCache.get(settingsKey)
        if (cachedSettings && (now - cachedSettings.fetchedAt) < SETTINGS_CACHE_TTL_MS) {
            setPrefs(cachedSettings.value)
        } else {
            loadSettings()
        }

        if (foodsCache && (now - foodsCache.fetchedAt) < FOODS_CACHE_TTL_MS) {
            setFoods(foodsCache.value)
        } else if (foodsInFlight) {
            foodsInFlight.then((data) => {
                if (data && isOpen) setFoods(data)
            })
        } else {
            fetchFoodsFast()
        }
    }, [isOpen, patientId])

    useEffect(() => {
        if (!isOpen) return
        const settingsKey = patientId ? `food_alternative_prefs_${patientId}` : 'food_alternative_prefs'
        settingsCache.set(settingsKey, { value: prefs, fetchedAt: Date.now() })
    }, [prefs, patientId, isOpen])

    useEffect(() => {
        if (!foods || foods.length === 0) return
        foodsCache = { value: foods, fetchedAt: Date.now() }
    }, [foods])

    async function fetchFoodsFast() {
        setLoading(true)
        try {
            if (!foodsInFlight) {
                foodsInFlight = Promise.resolve(supabase.from('foods').select('*')).then(({ data, error }) => {
                    if (error) {
                        console.error("Failed to fetch foods:", error)
                        return null
                    }
                    return data || []
                })
            }
            const data = await foodsInFlight
            if (data) {
                setFoods(data)
                foodsCache = { value: data, fetchedAt: Date.now() }
            }
        } finally {
            foodsInFlight = null
            setLoading(false)
        }
    }

    async function loadSettings(isPolling = false) {
        try {
            if (!isPolling) console.log("📥 Loading settings...")
            const local = localStorage.getItem('food_alternative_prefs')
            if (local && !isPolling) {
                const parsed = JSON.parse(local)
                setPrefs({ ...DEFAULT_PREFS, ...parsed })
            }

            let dbKey = 'food_alternative_prefs'
            if (patientId) {
                dbKey = `food_alternative_prefs_${patientId}`
            }

            const { data } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', dbKey)
                .maybeSingle()

            if (data && data.value) {
                const merged = { ...DEFAULT_PREFS, ...data.value }
                if (data.value.useGapClosingMode === undefined) merged.useGapClosingMode = false
                setPrefs(merged)
                if (!isPolling) localStorage.setItem('food_alternative_prefs', JSON.stringify(merged))
            } else if (patientId) {
                const { data: globalData } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('key', 'food_alternative_prefs')
                    .maybeSingle()

                if (globalData && globalData.value) {
                    const merged = { ...DEFAULT_PREFS, ...globalData.value }
                    if (globalData.value.useGapClosingMode === undefined) merged.useGapClosingMode = false
                    setPrefs(merged)
                }
            }

            const { data: flavorData, error: flavorError } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'flavor_tuning_settings')
                .maybeSingle()

            if (!flavorError && flavorData?.value) {
                const raw = flavorData.value
                setFlavorSettings({
                    enabled: Boolean(raw.enabled ?? DEFAULT_FLAVOR_TUNING.enabled),
                    allow_post_edit: Boolean(raw.allow_post_edit ?? DEFAULT_FLAVOR_TUNING.allow_post_edit),
                    respect_scope_filters: Boolean(raw.respect_scope_filters ?? DEFAULT_FLAVOR_TUNING.respect_scope_filters),
                    respect_frequency_rules: Boolean(raw.respect_frequency_rules ?? DEFAULT_FLAVOR_TUNING.respect_frequency_rules),
                    strict_locked_items: Boolean(raw.strict_locked_items ?? DEFAULT_FLAVOR_TUNING.strict_locked_items),
                    suggestion_count: Math.round(clampFlavorWeight(raw.suggestion_count, DEFAULT_FLAVOR_TUNING.suggestion_count, 1, 6)),
                    macro_weight: clampFlavorWeight(raw.macro_weight, DEFAULT_FLAVOR_TUNING.macro_weight, 0, 1),
                    flavor_weight: clampFlavorWeight(raw.flavor_weight, DEFAULT_FLAVOR_TUNING.flavor_weight, 0, 1),
                    diversity_weight: clampFlavorWeight(raw.diversity_weight, DEFAULT_FLAVOR_TUNING.diversity_weight, 0, 1),
                    compatibility_weight: clampFlavorWeight(raw.compatibility_weight, DEFAULT_FLAVOR_TUNING.compatibility_weight, 0, 1),
                })
            } else if (!flavorError) {
                setFlavorSettings(DEFAULT_FLAVOR_TUNING)
            }
        } catch (e) {
            if (!isPolling) console.error("Settings load error:", e)
        }
    }

    async function saveSettings(newPrefs: FilterPrefs) {
        setPrefs(newPrefs)
        localStorage.setItem('food_alternative_prefs', JSON.stringify(newPrefs))

        const dbKey = patientId ? `food_alternative_prefs_${patientId}` : 'food_alternative_prefs'

        supabase
            .from('app_settings')
            .upsert({ key: dbKey, value: newPrefs })
            .then(({ error }) => {
                if (error) console.error("Settings save error:", error)
            })
    }

    async function fetchFoods() {
        setLoading(true)
        const { data, error } = await supabase.from('foods').select('*')
        if (!error && data) {
            console.log("🥗 Fetched foods for dialog:", data.length)
            setFoods(data)
        } else {
            console.error("❌ Failed to fetch foods:", error)
        }
        setLoading(false)
    }

    const targetToRevert = useMemo(() => {
        const target = originalFoodToRevert || (originalFoodToRevertId && foods.find(f => f.id === originalFoodToRevertId))
        if (target && target.id !== originalFood?.id) {
            return target
        }
        return null
    }, [originalFoodToRevert, originalFoodToRevertId, foods, originalFood])

    const normalizedOriginalFood = useMemo(() => {
        if (!originalFood) return null
        if (!originalFood.diet_type && (originalFood.keto || originalFood.lowcarb || originalFood.vegan || originalFood.vejeteryan)) {
            const types = []
            if (originalFood.keto) types.push('ketojenik')
            if (originalFood.lowcarb) types.push('lowcarb')
            if (originalFood.vegan) types.push('vegan')
            if (originalFood.vejeteryan) types.push('vejeteryan')
            return { ...originalFood, diet_type: types.join(', ') }
        }
        return originalFood
    }, [originalFood])

    const calculatedAlternatives = useMemo(() => {
        if (!foods.length || !normalizedOriginalFood) return []

        const originalFood = normalizedOriginalFood
        const isFlavorModeActive = flavorSettings.enabled && flavorSettings.allow_post_edit
        let candidates = foods.filter(f => f.id !== originalFood.id).map(f => {
            if (!f.diet_type && (f.keto || f.lowcarb || f.vegan || f.vejeteryan)) {
                const types = []
                if (f.keto) types.push('ketojenik')
                if (f.lowcarb) types.push('lowcarb')
                if (f.vegan) types.push('vegan')
                if (f.vejeteryan) types.push('vejeteryan')
                return { ...f, diet_type: types.join(', ') }
            }
            return f
        })

        const safeSplit = (val: string | string[] | null | undefined): string[] => {
            if (!val) return []
            if (Array.isArray(val)) return val.map(String).map(s => s.trim().toLowerCase())
            return String(val).toLowerCase().split(',').map(s => s.trim())
        }

        const blendWeights = {
            macro: clampFlavorWeight(flavorSettings.macro_weight, DEFAULT_FLAVOR_TUNING.macro_weight, 0, 1),
            flavor: clampFlavorWeight(flavorSettings.flavor_weight, DEFAULT_FLAVOR_TUNING.flavor_weight, 0, 1),
            diversity: clampFlavorWeight(flavorSettings.diversity_weight, DEFAULT_FLAVOR_TUNING.diversity_weight, 0, 1),
            compatibility: clampFlavorWeight(flavorSettings.compatibility_weight, DEFAULT_FLAVOR_TUNING.compatibility_weight, 0, 1),
        }
        const blendTotalWeight = blendWeights.macro + blendWeights.flavor + blendWeights.diversity + blendWeights.compatibility
        const originalTagSet = new Set(safeSplit(originalFood.compatibility_tags || originalFood.tags))
        const originalNameTokens = uniqueWordsFromName(originalFood.name || "")

        let mainDishTags: string[] = []
        let shouldUseCompatibility = false

        if (!isTargetMainDish && mainDishOfSlot && mainDishOfSlot.compatibility_tags) {
            mainDishTags = safeSplit(mainDishOfSlot.compatibility_tags)
            shouldUseCompatibility = mainDishTags.length > 0
        }

        const gapTargets = {
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0
        }

        const canUseGapMode = prefs.useGapClosingMode && dailyTotals && dailyTargets;

        if (canUseGapMode) {
            const currentTotalWithoutOriginal = {
                calories: (dailyTotals.calories || 0) - (originalFood.calories || 0),
                protein: (dailyTotals.protein || 0) - (originalFood.protein || 0),
                carbs: (dailyTotals.carbs || 0) - (originalFood.carbs || 0),
                fat: (dailyTotals.fat || 0) - (originalFood.fat || 0),
            }

            gapTargets.calories = Math.max(0, (dailyTargets.calories || 0) - currentTotalWithoutOriginal.calories)
            gapTargets.protein = Math.max(0, (dailyTargets.protein || 0) - currentTotalWithoutOriginal.protein)
            gapTargets.carbs = Math.max(0, (dailyTargets.carb || 0) - currentTotalWithoutOriginal.carbs)
            gapTargets.fat = Math.max(0, (dailyTargets.fat || 0) - currentTotalWithoutOriginal.fat)
        }

        if (prefs.includeCategory && originalFood.category) {
            const targetCats = safeSplit(originalFood.category)
            candidates = candidates.filter(f => {
                if (!f.category) return false
                const fCats = safeSplit(f.category)
                return fCats.some(c => targetCats.includes(c))
            })
        }

        if (prefs.includeRole && originalFood.role) {
            const targetRoles = safeSplit(originalFood.role)
            candidates = candidates.filter(f => {
                if (!f.role) return false
                const fRoles = safeSplit(f.role)
                return fRoles.some(r => targetRoles.includes(r))
            })
        }

        if (prefs.includeDietType && originalFood.diet_type) {
            const targetDiets = safeSplit(originalFood.diet_type)
            candidates = candidates.filter(f => {
                if (!f.diet_type) return false
                const fDiets = safeSplit(f.diet_type)
                return fDiets.some(d => targetDiets.includes(d))
            })
        }

        if (prefs.includeMealType && originalFood.meal_types) {
            const targetMeals = Array.isArray(originalFood.meal_types)
                ? originalFood.meal_types
                : safeSplit(originalFood.meal_types)

            candidates = candidates.filter(f => {
                if (!f.meal_types) return false
                const fMeals = Array.isArray(f.meal_types)
                    ? f.meal_types
                    : safeSplit(f.meal_types)
                return fMeals.some((m: string) => targetMeals.includes(m))
            })
        }

        if (prefs.checkSeason && currentMonth) {
            candidates = candidates.filter(f => {
                const sStart = f.season_start || 1
                const sEnd = f.season_end || 12
                if (sStart === 1 && sEnd === 12) return true
                if (sStart <= sEnd) {
                    return currentMonth >= sStart && currentMonth <= sEnd
                } else {
                    return currentMonth >= sStart || currentMonth <= sEnd
                }
            })
        }

        if (prefs.excludeTags && (originalFood.compatibility_tags || originalFood.tags)) {
            const targetTags = safeSplit(originalFood.compatibility_tags || originalFood.tags).filter(t => t.length > 2)
            if (targetTags.length > 0) {
                candidates = candidates.filter(f => {
                    if (!f.compatibility_tags && !f.tags) return true
                    const fTags = safeSplit(f.compatibility_tags || f.tags)
                    const hasOverlap = fTags.some(t => targetTags.includes(t))
                    return !hasOverlap
                })
            }
        }

        if (prefs.excludeNameCollision) {
            const stopWords = prefs.ignoredWords.toLowerCase().split(',').map(s => s.trim())
            const cleanName = (name: string) => name.toLowerCase()
                .replace(/[\(\)]/g, '')
                .split(' ')
                .filter(w => w.length > 2)
                .filter(w => !stopWords.includes(w))

            const targetWords = cleanName(originalFood.name)
            candidates = candidates.filter(f => {
                const fWords = cleanName(f.name)
                const overlap = fWords.some(w => targetWords.includes(w))
                return !overlap
            })
        }

        if (prefs.excludeTagsCollision) {
            const originalTags = safeSplit(originalFood.compatibility_tags || originalFood.tags)
            const ignoredTagWords = (prefs.ignoredTagWords || "").toLowerCase().split(',').map(s => s.trim())

            if (originalTags.length > 0) {
                candidates = candidates.filter(f => {
                    const fTags = safeSplit(f.compatibility_tags || f.tags)
                    const overlap = fTags.some(t => originalTags.includes(t) && !ignoredTagWords.includes(t))
                    return !overlap
                })
            }
        }

        if (prefs.excludeConsecutive && nearbyUsedFoodIds.length > 0) {
            candidates = candidates.filter(f => !nearbyUsedFoodIds.includes(f.id))
        }

        const scored = candidates.map(food => {
            let totalWeight = 0
            let totalScore = 0

            const calcScore = (target: number, actual: number, weight: number) => {
                if (weight === 0) return
                if (!target) target = 1
                const diff = Math.abs(target - (actual || 0))
                const pctDiff = Math.min(diff / target, 1)
                const score = (1 - pctDiff) * 100
                totalScore += score * weight
                totalWeight += weight
            }

            if (canUseGapMode) {
                calcScore(gapTargets.calories, food.calories, prefs.weights.calories)
                calcScore(gapTargets.protein, food.protein, prefs.weights.protein)
                calcScore(gapTargets.carbs, food.carbs, prefs.weights.carbs)
                calcScore(gapTargets.fat, food.fat, prefs.weights.fat)
            } else {
                calcScore(originalFood.calories, food.calories, prefs.weights.calories)
                calcScore(originalFood.protein, food.protein, prefs.weights.protein)
                calcScore(originalFood.carbs, food.carbs, prefs.weights.carbs)
                calcScore(originalFood.fat, food.fat, prefs.weights.fat)
            }

            if (shouldUseCompatibility && prefs.weights.mainDishCompat > 0) {
                const foodTags = safeSplit(food.compatibility_tags || food.tags)
                const matches = foodTags.filter(t => mainDishTags.some(mt => mt.includes(t) || t.includes(mt)))
                if (matches.length > 0) {
                    totalScore += 100 * prefs.weights.mainDishCompat
                    totalWeight += prefs.weights.mainDishCompat
                } else {
                    totalWeight += prefs.weights.mainDishCompat
                }
            }

            // Compatibility Check Integration
            const compatibility = checkCompatibility(food, activeDietRules, patientDiseases, patientLabs, patientMedicationRules)

            const baseScore = totalWeight > 0 ? totalScore / totalWeight : 0

            let finalScore = baseScore
            if (activeMacroPreference !== 0) {
                const proteinPriority = Math.max(0, -activeMacroPreference) / 100
                const fatPriority = Math.max(0, activeMacroPreference) / 100

                // Add a raw percentage bonus based on macro absolute values
                const bonus = Math.min(30, (food.protein * proteinPriority * 0.8) + (food.fat * fatPriority * 1.5))
                finalScore += bonus
            }

            const macroScore = Math.min(100, Math.max(0, finalScore))
            let blendedScore = macroScore

            if (isFlavorModeActive && blendTotalWeight > 0) {
                const foodTagSet = new Set(safeSplit(food.compatibility_tags || food.tags))
                const sharedTagCount = Array.from(foodTagSet).filter(tag => originalTagSet.has(tag)).length
                const tagScore = originalTagSet.size > 0
                    ? (sharedTagCount / originalTagSet.size) * 100
                    : 50

                const foodNameTokens = uniqueWordsFromName(food.name || "")
                const sharedNameTokenCount = foodNameTokens.filter(token => originalNameTokens.includes(token)).length
                const nameScore = originalNameTokens.length > 0
                    ? (sharedNameTokenCount / originalNameTokens.length) * 100
                    : 50

                const flavorScore = Math.min(100, (tagScore * 0.7) + (nameScore * 0.3))
                const diversityScore = nearbyUsedFoodIds.includes(food.id)
                    ? (flavorSettings.strict_locked_items ? 0 : 25)
                    : 100

                const warningList = Array.isArray((compatibility as any)?.warnings) ? (compatibility as any).warnings : []
                const hasHardBlock = (compatibility as any)?.compatible === false && (compatibility as any)?.severity === "block"
                const warningPenalty = warningList.filter((w: any) => w?.type === "negative").length
                const softWarningPenalty = warningList.filter((w: any) => w?.type === "warning").length

                let compatibilityScore = 100
                if (hasHardBlock) {
                    compatibilityScore = 0
                } else if ((compatibility as any)?.compatible === false || warningPenalty > 0) {
                    compatibilityScore = 45
                } else if (softWarningPenalty > 0) {
                    compatibilityScore = 72
                }

                blendedScore =
                    (
                        macroScore * blendWeights.macro +
                        flavorScore * blendWeights.flavor +
                        diversityScore * blendWeights.diversity +
                        compatibilityScore * blendWeights.compatibility
                    ) / blendTotalWeight
            }

            return {
                ...food,
                similarity: Math.min(100, Math.max(0, blendedScore)),
                _compatibility: compatibility,
            }
        })

        scored.sort((a, b) => b.similarity - a.similarity)

        const seen = new Set()
        const uniqueScored = scored.filter(f => {
            const normName = f.name.toLowerCase()
                .replace(/\s*\(.*?\)\s*/g, '')
                .replace(/\d+/g, '')
                .replace(/adet|gram|porsiyon|yemek|tatlı|kaşığı/g, '')
                .replace(/[^\w\sğüşıöç]/g, '')
                .trim()
            const key = `${normName}-${Math.round(f.calories)}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })

        return uniqueScored
    }, [foods, originalFood, prefs, nearbyUsedFoodIds, mainDishOfSlot, isTargetMainDish, JSON.stringify(dailyTotals), JSON.stringify(dailyTargets), activeDietRules, patientDiseases, patientLabs, patientMedicationRules, activeMacroPreference, flavorSettings])

    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

    useEffect(() => {
        if (isDragging) {
            const handleMouseMove = (e: MouseEvent) => {
                setPosition({
                    x: e.clientX - dragStart.x,
                    y: e.clientY - dragStart.y
                })
            }
            const handleMouseUp = () => setIsDragging(false)
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            return () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
            }
        }
    }, [isDragging, dragStart, position])

    // Update search results with compatibility check as well
    const searchResultsWithCompatibility = useMemo(() => {
        // This hook seems missing or handled in the CommandList via search term. 
        // But wait, the dialog uses `Command` component with filtering.
        // Actually, `calculatedAlternatives` is displayed directly.
        // And `foods` list is used for search.
        return []
    }, [])


    const allFoodsSortedBySimilarity = useMemo(() => {
        if (!foods.length || !normalizedOriginalFood) return []
        const calcScore = (target: number, actual: number, weight: number) => {
            if (weight === 0) return 0
            if (!target) target = 1
            const diff = Math.abs(target - (actual || 0))
            const pctDiff = Math.min(diff / target, 1)
            return (1 - pctDiff) * 100 * weight
        }

        const scored = foods.map(food => {
            let totalScore = 0
            let totalWeight = 0
            totalScore += calcScore(normalizedOriginalFood.calories, food.calories, prefs.weights.calories)
            totalWeight += prefs.weights.calories
            totalScore += calcScore(normalizedOriginalFood.protein, food.protein, prefs.weights.protein)
            totalWeight += prefs.weights.protein
            totalScore += calcScore(normalizedOriginalFood.carbs, food.carbs, prefs.weights.carbs)
            totalWeight += prefs.weights.carbs
            totalScore += calcScore(normalizedOriginalFood.fat, food.fat, prefs.weights.fat)
            totalWeight += prefs.weights.fat
            const similarity = totalWeight > 0 ? totalScore / totalWeight : 0

            // Compatibility Check for Search Results
            const compatibility = checkCompatibility(food, activeDietRules, patientDiseases, patientLabs, patientMedicationRules)

            let finalSimilarity = similarity
            if (activeMacroPreference !== 0) {
                const proteinPriority = Math.max(0, -activeMacroPreference) / 100
                const fatPriority = Math.max(0, activeMacroPreference) / 100
                const bonus = Math.min(30, (food.protein * proteinPriority * 0.8) + (food.fat * fatPriority * 1.5))
                finalSimilarity += bonus
            }

            finalSimilarity = Math.min(100, Math.max(0, finalSimilarity))

            return { ...food, similarity: finalSimilarity, _compatibility: compatibility }
        })
        return scored.sort((a, b) => b.similarity - a.similarity)
    }, [foods, normalizedOriginalFood, prefs.weights, activeDietRules, patientDiseases, patientLabs, patientMedicationRules, activeMacroPreference])

    const portionOptions = useMemo(() => {
        const meta = originalFood?.food_meta || originalFood?.meta || {}
        const min = originalFood?.min_quantity ?? meta.min_quantity ?? 0.5
        const max = originalFood?.max_quantity ?? meta.max_quantity ?? 3
        const step = originalFood?.step ?? meta.step ?? 0.5
        const options: { value: number; label: string }[] = []
        const LABELS: Record<number, string> = {
            0.25: 'Çeyrek', 0.5: 'Yarım', 0.75: 'Üç Çeyrek',
            1: 'Tam', 1.5: 'Bir Buçuk', 2: 'İki Katı',
            2.5: 'İki Buçuk', 3: 'Üç Katı'
        }
        for (let v = min; v <= max + 0.001; v = Math.round((v + step) * 100) / 100) {
            const label = LABELS[v] ? `x${v} (${LABELS[v]})` : `x${v}`
            options.push({ value: Math.round(v * 100) / 100, label })
        }
        if (options.length === 0) options.push({ value: 1, label: 'x1 (Tam)' })
        return options
    }, [originalFood])

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent
                className="sm:max-w-[500px] w-[calc(100vw-1rem)] h-auto max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl"
                showCloseButton={false}
                aria-describedby={undefined}
                style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            >
                {/* Compact header — food name + portion + close */}
                <DialogHeader
                    className="px-3 py-2.5 border-b border-emerald-100 bg-emerald-50/60 shrink-0 z-20 cursor-move select-none active:cursor-grabbing"
                    onMouseDown={(e) => {
                        setIsDragging(true)
                        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
                    }}
                >
                    <DialogTitle className="pointer-events-none">
                        <div className="sr-only">Alternatif Seçenekleri</div>
                        <div className="flex items-center gap-2 pointer-events-auto">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <RefreshCw size={14} className="text-emerald-600 shrink-0" />
                                    <span className="text-[13px] font-semibold text-emerald-800 truncate">{originalFood?.name}</span>
                                    <select
                                        value={portionMultiplier}
                                        onChange={(e) => handlePortionChange(Number(e.target.value))}
                                        className="bg-emerald-100/80 text-emerald-700 text-[11px] font-bold rounded px-1.5 py-0.5 outline-none cursor-pointer border border-emerald-200"
                                    >
                                        {portionOptions.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                    {portionMultiplier !== (originalFood?.portion_multiplier || 1) && (
                                        <button
                                            onClick={() => {
                                                if (originalFood) {
                                                    onSelect({ ...originalFood, id: originalFood.id, portion_multiplier: portionMultiplier });
                                                }
                                            }}
                                            className="text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-2 py-0.5"
                                        >
                                            Kaydet
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                                {!hideSettings && (
                                    <button
                                        onClick={() => saveSettings({ ...prefs, showSettingsPanel: !prefs.showSettingsPanel })}
                                        className={cn("p-1.5 rounded-full transition-colors", prefs.showSettingsPanel ? "bg-emerald-200 text-emerald-700" : "text-gray-400 hover:text-gray-600")}
                                    >
                                        <Settings size={14} />
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    className="p-1.5 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                </button>
                            </div>
                        </div>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-1 overflow-hidden">
                    {/* Settings panel — slides from left */}
                    {prefs.showSettingsPanel && !hideSettings && (
                        <div className="w-full md:w-[300px] border-r border-emerald-100 bg-emerald-50/30 p-3 overflow-y-auto shrink-0 space-y-2.5 text-sm [&::-webkit-scrollbar]:hidden max-h-[calc(85vh-3rem)]">
                            <div className="p-2.5 bg-white rounded-lg border shadow-sm">
                                <label htmlFor="limit" className="text-[11px] font-medium text-gray-600 flex justify-between mb-1">
                                    <span>Sonuç sayısı</span>
                                    <span className="text-emerald-600 font-bold">{prefs.limit}</span>
                                </label>
                                <input id="limit" type="range" min="1" max="50" className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-600" value={prefs.limit} onChange={(e) => saveSettings({ ...prefs, limit: Number(e.target.value) })} />
                            </div>
                            <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200 flex items-start gap-2">
                                <Checkbox id="gapMode" checked={prefs.useGapClosingMode} onCheckedChange={(c) => saveSettings({ ...prefs, useGapClosingMode: !!c })} className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600 mt-0.5" />
                                <div>
                                    <Label htmlFor="gapMode" className="cursor-pointer font-semibold text-emerald-900 text-xs">Hedef Açığını Kapat</Label>
                                    <p className="text-[10px] text-emerald-700 leading-tight mt-0.5">Günlük hedefteki açığa göre puanla.</p>
                                </div>
                            </div>
                            <div className="p-2.5 bg-white rounded-lg border shadow-sm space-y-2">
                                <h4 className="font-semibold text-[10px] text-gray-500 uppercase tracking-wider">Filtreler</h4>
                                {[
                                    { id: 'checkSeason', label: 'Mevsim Uyumu', key: 'checkSeason' as const },
                                    { id: 'cat', label: 'Kategori', key: 'includeCategory' as const },
                                    { id: 'role', label: 'Rol', key: 'includeRole' as const },
                                    { id: 'diet', label: 'Diyet Türü', key: 'includeDietType' as const },
                                    { id: 'mealType', label: 'Öğün Tipi', key: 'includeMealType' as const },
                                ].map(f => (
                                    <div key={f.id} className="flex items-center space-x-2">
                                        <Checkbox id={f.id} checked={prefs[f.key] as boolean} onCheckedChange={(c) => saveSettings({ ...prefs, [f.key]: !!c })} />
                                        <Label htmlFor={f.id} className="cursor-pointer text-xs">{f.label}</Label>
                                    </div>
                                ))}
                            </div>
                            <div className="p-2.5 bg-white rounded-lg border shadow-sm space-y-2">
                                <h4 className="font-semibold text-[10px] text-gray-500 uppercase tracking-wider">Dışlama</h4>
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="consecutive" checked={prefs.excludeConsecutive} onCheckedChange={(c) => saveSettings({ ...prefs, excludeConsecutive: !!c })} />
                                    <Label htmlFor="consecutive" className="cursor-pointer text-xs">Ardışık Gün</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="names" checked={prefs.excludeNameCollision} onCheckedChange={(c) => saveSettings({ ...prefs, excludeNameCollision: !!c })} />
                                    <Label htmlFor="names" className="cursor-pointer text-xs">İsim Benzerliği</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="tagsCollision" checked={prefs.excludeTagsCollision} onCheckedChange={(c) => saveSettings({ ...prefs, excludeTagsCollision: !!c })} />
                                    <Label htmlFor="tagsCollision" className="cursor-pointer text-xs">Etiket Benzerliği</Label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Main content */}
                    <div className={cn(
                        "flex-1 flex flex-col overflow-hidden bg-white",
                        prefs.showSettingsPanel && !hideSettings ? 'hidden md:flex' : ''
                    )}>
                        {/* Slider — flush, compact */}
                        <div className="px-3 pt-2 pb-1.5 border-b border-gray-100 bg-gray-50/50 shrink-0">
                            <div className="flex justify-between text-[10px] font-medium text-gray-400 mb-1">
                                <span className={activeMacroPreference < 0 ? "text-emerald-600 font-bold" : ""}>Proteine Yakın</span>
                                <span className={activeMacroPreference === 0 ? "text-gray-600 font-bold" : ""}>Dengeli</span>
                                <span className={activeMacroPreference > 0 ? "text-teal-600 font-bold" : ""}>Yağa Yakın</span>
                            </div>
                            <Slider defaultValue={[activeMacroPreference]} value={[activeMacroPreference]} min={-100} max={100} step={5} onValueChange={(vals) => setMacroPreference(vals[0])} />
                        </div>

                        {/* Search bar — compact */}
                        <div className="px-3 py-1.5 border-b border-gray-100 shrink-0">
                            <Popover open={searchOpen} onOpenChange={(o) => { setSearchOpen(o); if (!o) setExpandedSearchFoodId(null) }}>
                                <PopoverTrigger asChild>
                                    <button className="w-full flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-400 hover:bg-emerald-50 hover:text-gray-600 transition-colors border border-gray-100">
                                        <Search size={13} className="shrink-0" />
                                        <span className="truncate">{searchQuery || "Yemek ara (örn: kıy pat)..."}</span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[min(450px,calc(100vw-2rem))] p-0 overflow-hidden rounded-xl" align="start" sideOffset={4}>
                                    {/* Search header */}
                                    <div className="px-3 py-2 bg-teal-50/80 border-b border-teal-100">
                                        <div className="flex items-center gap-2">
                                            <Search size={14} className="text-teal-500 shrink-0" />
                                            <input
                                                className="flex-1 bg-transparent text-[13px] text-gray-800 placeholder:text-teal-400 outline-none"
                                                placeholder="Yemek ara..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                autoFocus
                                            />
                                            {searchQuery && (
                                                <button onClick={() => setSearchQuery("")} className="text-gray-400 hover:text-gray-600">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-teal-600/70 mt-0.5">Tüm yemeklerden makro benzerliğine göre arama</p>
                                    </div>
                                    {/* Search results — same style as main list */}
                                    <div className="max-h-[320px] overflow-y-auto bg-white [&::-webkit-scrollbar]:hidden">
                                        {(() => {
                                            const filtered = allFoodsSortedBySimilarity.filter(food => {
                                                if (!searchQuery) return true
                                                const terms = searchQuery.toLocaleLowerCase('tr').split(/\s+/).filter(t => t.length > 0)
                                                const valLower = food.name.toLocaleLowerCase('tr')
                                                return terms.every(term => valLower.includes(term))
                                            })
                                            if (filtered.length === 0) return <div className="py-6 text-center text-gray-400 text-sm">Yemek bulunamadı.</div>
                                            return filtered.slice(0, 30).map((food) => {
                                                const isExp = expandedSearchFoodId === food.id
                                                return (
                                                    <div key={food.id} className={cn(
                                                        "border-b transition-all mx-1.5 my-0.5 rounded-lg",
                                                        isExp ? "bg-teal-50/60 border-teal-200 ring-1 ring-teal-200 shadow-sm" : "border-transparent hover:bg-gray-50/80"
                                                    )}>
                                                        <div
                                                            className="flex items-center gap-2 px-2.5 py-2 cursor-pointer active:bg-teal-50/60 transition-colors rounded-lg"
                                                            onClick={() => setExpandedSearchFoodId(isExp ? null : food.id)}
                                                        >
                                                            <span className={cn("flex-1 text-[13px] font-medium leading-tight line-clamp-1 min-w-0", isExp ? "text-teal-800" : "text-gray-800")}>{food.name}</span>
                                                            <span className={cn(
                                                                "text-[12px] font-bold shrink-0 tabular-nums",
                                                                food.similarity > 80 ? "text-teal-600" : food.similarity > 50 ? "text-yellow-600" : "text-gray-400"
                                                            )}>%{Math.round(food.similarity)}</span>
                                                        </div>
                                                        {isExp && (
                                                            <div className="pl-3 pr-2.5 pb-2 flex items-center justify-between gap-2">
                                                                <div className="flex items-center gap-2 text-[11px]">
                                                                    <span className="font-semibold text-gray-600">{Math.round(food.calories)} kcal</span>
                                                                    <span className="text-orange-500">K:{Math.round(food.carbs)}g</span>
                                                                    <span className="text-blue-500">P:{Math.round(food.protein)}g</span>
                                                                    <span className="text-yellow-500">Y:{Math.round(food.fat)}g</span>
                                                                </div>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={(e) => { e.stopPropagation(); onSelect(food); setSearchOpen(false); setSearchQuery("") }}
                                                                    className="h-7 text-[11px] px-3 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-semibold shadow-sm"
                                                                >
                                                                    Değiştir
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })
                                        })()}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Food list */}
                        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                            {/* Revert to original */}
                            {targetToRevert && (
                                <button
                                    className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-50/80 border-b border-emerald-100 hover:bg-emerald-100/80 transition-colors text-left"
                                    onClick={() => onSelect(targetToRevert)}
                                >
                                    <RefreshCw size={13} className="text-emerald-600 shrink-0" />
                                    <span className="text-[12px] font-medium text-emerald-700 truncate flex-1">Orijinale Dön: {targetToRevert.name}</span>
                                    <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">Geri Al</span>
                                </button>
                            )}

                            {foods.length === 0 ? (
                                <div className="text-center py-10 text-gray-400 text-sm">Yükleniyor...</div>
                            ) : calculatedAlternatives.length === 0 ? (
                                <div className="text-center py-10">
                                    <AlertTriangle className="mx-auto h-6 w-6 text-yellow-400 mb-1" />
                                    <p className="text-sm text-gray-500">Eşleşen yemek bulunamadı.</p>
                                </div>
                            ) : (
                                <div>
                                    {/* Result count */}
                                    <div className="px-3 py-1.5 flex justify-between items-center text-[11px] text-gray-400 border-b border-gray-50">
                                        <span><strong className="text-gray-700">{calculatedAlternatives.length}</strong> alternatif</span>
                                    </div>

                                    {/* Food rows — like plan food rows */}
                                    {calculatedAlternatives.slice(0, prefs.limit).map((food) => {
                                        const isExpanded = expandedFoodId === food.id
                                        return (
                                            <div key={food.id} className={cn(
                                                "border-b transition-all mx-2 my-0.5 rounded-lg",
                                                isExpanded
                                                    ? "bg-emerald-50/60 border-emerald-200 ring-1 ring-emerald-200 shadow-sm"
                                                    : "border-transparent hover:bg-gray-50/80"
                                            )}>
                                                {/* Main row */}
                                                <div
                                                    className="flex items-center gap-2 px-2.5 py-2 cursor-pointer active:bg-emerald-50/60 transition-colors rounded-lg"
                                                    onClick={() => setExpandedFoodId(isExpanded ? null : food.id)}
                                                >
                                                    {/* Compatibility icon */}
                                                    <div className="w-4 shrink-0 flex items-center justify-center">
                                                        {food._compatibility && !food._compatibility.compatible ? (
                                                            <AlertTriangle size={12} className={food._compatibility.severity === 'block' ? "text-red-500" : "text-yellow-500"} />
                                                        ) : food._compatibility?.recommended ? (
                                                            <Heart size={12} fill="currentColor" className="text-emerald-500" />
                                                        ) : null}
                                                    </div>

                                                    {/* Food name — takes full width */}
                                                    <span className={cn("flex-1 text-[13px] font-medium leading-tight line-clamp-1 min-w-0", isExpanded ? "text-emerald-800" : "text-gray-800")}>{food.name}</span>

                                                    {/* Similarity badge */}
                                                    <span className={cn(
                                                        "text-[12px] font-bold shrink-0 tabular-nums",
                                                        food.similarity > 80 ? "text-emerald-600" :
                                                            food.similarity > 50 ? "text-yellow-600" : "text-gray-400"
                                                    )}>
                                                        %{Math.round(food.similarity)}
                                                    </span>
                                                </div>

                                                {/* Expanded — macros + swap button, indented under food name */}
                                                {isExpanded && (
                                                    <div className="pl-9 pr-2.5 pb-2 flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2 text-[11px]">
                                                            <span className="font-semibold text-gray-600">{Math.round(food.calories)} kcal</span>
                                                            <span className="text-orange-500">K:{Math.round(food.carbs)}g</span>
                                                            <span className="text-blue-500">P:{Math.round(food.protein)}g</span>
                                                            <span className="text-yellow-500">Y:{Math.round(food.fat)}g</span>
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            onClick={(e) => { e.stopPropagation(); handleSelectWithPortion(food) }}
                                                            className="h-7 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold shadow-sm"
                                                        >
                                                            Değiştir
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <FoodEditDialog
                    isOpen={!!editingFood}
                    onClose={() => setEditingFood(null)}
                    food={editingFood || {}}
                    onUpdate={async () => { await fetchFoodsFast(); setEditingFood(null) }}
                />
            </DialogContent>
        </Dialog>
    )
}
