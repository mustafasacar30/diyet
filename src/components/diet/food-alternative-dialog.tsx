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

    return (
        <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
            <DialogContent
                className="sm:max-w-[850px] h-auto max-h-[85vh] flex flex-col p-0 gap-0 transition-transform duration-75 overflow-hidden rounded-xl"
                aria-describedby={undefined}
                style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
            >
                <DialogHeader
                    className="p-3 border-b bg-white cursor-move select-none active:cursor-grabbing shrink-0 z-20"
                    onMouseDown={(e) => {
                        setIsDragging(true)
                        setDragStart({
                            x: e.clientX - position.x,
                            y: e.clientY - position.y
                        })
                    }}
                >
                    <DialogTitle className="flex flex-col gap-2 pointer-events-none">
                        <div className="sr-only">Alternatif Seçenekleri</div>
                        <div className="flex items-center justify-between pointer-events-auto w-full">
                            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-2 lg:gap-4 flex-1 min-w-0 pr-2">
                                <div className="flex flex-wrap items-center gap-1 md:gap-2 leading-tight">
                                    <span className="font-semibold whitespace-nowrap text-gray-700 text-sm md:text-base">Alternatif Bul:</span>
                                    <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded text-xs md:text-sm text-balance max-w-full">{originalFood?.name}</span>
                                </div>

                                {/* Portion Selector */}
                                <div className="flex items-center bg-gray-50 border border-gray-200 rounded px-2 py-1 sm:py-0.5 shadow-sm mt-1 lg:mt-0 w-max max-w-full">
                                    <span className="text-xs text-gray-500 mr-2 font-medium hidden sm:inline">Porsiyon:</span>
                                    <select
                                        value={portionMultiplier}
                                        onChange={(e) => handlePortionChange(Number(e.target.value))}
                                        className="bg-transparent text-sm font-bold text-gray-800 outline-none cursor-pointer"
                                    >
                                        {(() => {
                                            // min_quantity, max_quantity, step are DIRECT columns on the foods table
                                            // Also check food_meta/meta as fallback for compatibility
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
                                            return options.map(o => (
                                                <option key={o.value} value={o.value}>{o.label}</option>
                                            ))
                                        })()}
                                    </select>
                                    {portionMultiplier !== (originalFood?.portion_multiplier || 1) && (
                                        <Button
                                            variant="default"
                                            size="sm"
                                            onClick={() => {
                                                if (originalFood) {
                                                    onSelect({
                                                        ...originalFood,
                                                        id: originalFood.id, // Ensure real_food_id maps correctly
                                                        portion_multiplier: portionMultiplier
                                                    });
                                                }
                                            }}
                                            className="h-6 ml-2 text-[10px] px-2 bg-green-600 hover:bg-green-700 font-bold tracking-wider rounded"
                                        >
                                            KAYDET
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                {!hideSettings && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => saveSettings({ ...prefs, showSettingsPanel: !prefs.showSettingsPanel })}
                                        className={prefs.showSettingsPanel ? "bg-gray-100" : ""}
                                    >
                                        <Settings size={16} className="mr-1" /> Kriterler
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-gray-500 hover:bg-red-50 hover:text-red-600 rounded-full"
                                    onClick={onClose}
                                >
                                    <span className="sr-only">Kapat</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                </Button>
                            </div>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-500 font-normal ml-1">
                            {prefs.useGapClosingMode ? (
                                <>
                                    <span className="text-purple-600 font-bold flex items-center gap-1">
                                        <Target size={12} /> HEDEF AÇIK:
                                    </span>
                                    {(() => {
                                        const c = (dailyTotals?.calories || 0) - (originalFood?.calories || 0)
                                        const gapKcal = Math.max(0, (dailyTargets?.calories || 0) - c)
                                        const gapP = Math.max(0, (dailyTargets?.protein || 0) - ((dailyTotals?.protein || 0) - (originalFood?.protein || 0)))
                                        const gapC = Math.max(0, (dailyTargets?.carb || 0) - ((dailyTotals?.carbs || 0) - (originalFood?.carbs || 0)))
                                        const gapF = Math.max(0, (dailyTargets?.fat || 0) - ((dailyTotals?.fat || 0) - (originalFood?.fat || 0)))
                                        return (
                                            <div className="flex flex-col gap-0.5">
                                                <div className="flex gap-2 items-center">
                                                    <span className="font-semibold text-gray-700">{Math.round(gapKcal)} kcal</span>
                                                    <span className="text-orange-600">K: {Math.round(gapC)}g</span>
                                                    <span className="text-blue-600">P: {Math.round(gapP)}g</span>
                                                    <span className="text-yellow-600">Y: {Math.round(gapF)}g</span>
                                                </div>
                                                <div className="text-[9px] text-gray-400 font-normal">
                                                    (Hedef: {dailyTargets?.calories} - Mevcut: {Math.round(c)})
                                                </div>
                                            </div>
                                        )
                                    })()}
                                </>
                            ) : (
                                <>
                                    <span>Hedef (Orijinal):</span>
                                    <span className="font-semibold text-gray-700">{Math.round((originalFood?.calories || 0) * portionMultiplier)} kcal</span>
                                    <span className="text-orange-600">K: {Math.round((originalFood?.carbs || 0) * portionMultiplier)}g</span>
                                    <span className="text-blue-600">P: {Math.round((originalFood?.protein || 0) * portionMultiplier)}g</span>
                                    <span className="text-yellow-600">Y: {Math.round((originalFood?.fat || 0) * portionMultiplier)}g</span>
                                </>
                            )}
                        </div>
                    </DialogTitle>
                </DialogHeader>

                <div className={`flex flex-1 relative ${prefs.showSettingsPanel && !hideSettings ? 'min-h-[450px]' : 'min-h-[400px]'}`}>
                    {prefs.showSettingsPanel && !hideSettings && (
                        <div className="w-full md:w-[360px] border-r bg-gray-50 p-4 max-h-[calc(85vh-4rem)] overflow-y-auto shrink-0 space-y-3 text-sm [&::-webkit-scrollbar]:hidden">
                            <div className="space-y-2">
                                <h4 className="font-semibold text-xs text-gray-900 uppercase tracking-wider">Genel</h4>
                                <div className="p-3 bg-white rounded-lg border shadow-sm">
                                    <label htmlFor="limit" className="text-xs font-medium text-gray-700 block mb-2">
                                        Maksimum Sonuç: <span className="text-blue-600 font-bold">{prefs.limit}</span>
                                    </label>
                                    <input
                                        id="limit"
                                        type="range"
                                        min="1"
                                        max="50"
                                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                        value={prefs.limit}
                                        onChange={(e) => saveSettings({ ...prefs, limit: Number(e.target.value) })}
                                    />
                                </div>
                            </div>

                            <div className="p-3 bg-purple-50 rounded-lg border border-purple-100 shadow-sm flex items-start gap-2">
                                <Checkbox
                                    id="gapMode"
                                    checked={prefs.useGapClosingMode}
                                    onCheckedChange={(c) => saveSettings({ ...prefs, useGapClosingMode: !!c })}
                                    className="data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600 mt-0.5"
                                />
                                <div>
                                    <Label htmlFor="gapMode" className="cursor-pointer font-semibold text-purple-900">Hedef Açığını Kapat</Label>
                                    <p className="text-[10px] text-purple-700 leading-tight mt-1">
                                        Alternatifler orijinal yemeğe göre değil, günlük hedefteki açığı doldurmaya göre puanlanır.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h4 className="font-semibold text-xs text-gray-900 uppercase tracking-wider">Filtreler</h4>
                                <div className="p-3 bg-white rounded-lg border shadow-sm space-y-3">
                                    <div className="flex items-center space-x-2">
                                        <Checkbox
                                            id="checkSeason"
                                            checked={prefs.checkSeason}
                                            onCheckedChange={(c) => saveSettings({ ...prefs, checkSeason: !!c })}
                                        />
                                        <div className="leading-none">
                                            <Label htmlFor="checkSeason" className="cursor-pointer">Mevsim Uyumu</Label>
                                            <div className="text-[9px] text-gray-400 mt-0.5">
                                                Şu an: {["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"][currentMonth - 1] || currentMonth + '. Ay'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox id="cat" checked={prefs.includeCategory} onCheckedChange={(c) => saveSettings({ ...prefs, includeCategory: !!c })} />
                                        <Label htmlFor="cat" className="cursor-pointer">Kategori Uyumlu</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox id="role" checked={prefs.includeRole} onCheckedChange={(c) => saveSettings({ ...prefs, includeRole: !!c })} />
                                        <Label htmlFor="role" className="cursor-pointer">Rol Uyumlu</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox id="diet" checked={prefs.includeDietType} onCheckedChange={(c) => saveSettings({ ...prefs, includeDietType: !!c })} />
                                        <Label htmlFor="diet" className="cursor-pointer">Diyet Türü Uyumlu</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Checkbox id="mealType" checked={prefs.includeMealType} onCheckedChange={(c) => saveSettings({ ...prefs, includeMealType: !!c })} />
                                        <Label htmlFor="mealType" className="cursor-pointer">Öğün Tipi Uyumlu</Label>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h4 className="font-semibold text-xs text-gray-900 uppercase tracking-wider">Dışlama</h4>
                                <div className="p-3 bg-white rounded-lg border shadow-sm space-y-3">
                                    <div className="flex items-start space-x-2">
                                        <Checkbox id="consecutive" checked={prefs.excludeConsecutive} onCheckedChange={(c) => saveSettings({ ...prefs, excludeConsecutive: !!c })} className="mt-0.5" />
                                        <div className="leading-none">
                                            <Label htmlFor="consecutive" className="block cursor-pointer">Ardışık Gün Çakışması</Label>
                                            <span className="text-[10px] text-gray-400">Yakın zamanda yenildiyse gizle</span>
                                        </div>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <Checkbox id="names" checked={prefs.excludeNameCollision} onCheckedChange={(c) => saveSettings({ ...prefs, excludeNameCollision: !!c })} className="mt-0.5" />
                                        <div className="leading-none w-full">
                                            <Label htmlFor="names" className="block cursor-pointer">İsim Benzerliği</Label>
                                            {prefs.excludeNameCollision && (
                                                <div className="mt-2">
                                                    <span className="text-[10px] font-bold text-gray-500 block mb-1">Yoksayılacaklar:</span>
                                                    <Input className="h-7 text-xs w-full" value={prefs.ignoredWords} onChange={(e) => saveSettings({ ...prefs, ignoredWords: e.target.value })} placeholder="gram, adet..." />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-start space-x-2">
                                        <Checkbox id="tagsCollision" checked={prefs.excludeTagsCollision} onCheckedChange={(c) => saveSettings({ ...prefs, excludeTagsCollision: !!c })} className="mt-0.5" />
                                        <div className="leading-none w-full">
                                            <Label htmlFor="tagsCollision" className="block cursor-pointer">Etiket Benzerliği</Label>
                                            {prefs.excludeTagsCollision && (
                                                <div className="mt-2">
                                                    <span className="text-[10px] font-bold text-gray-500 block mb-1">Yoksayılacaklar:</span>
                                                    <Input className="h-7 text-xs w-full" value={prefs.ignoredTagWords} onChange={(e) => saveSettings({ ...prefs, ignoredTagWords: e.target.value })} placeholder="ör: kahvaltılık..." />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h4 className="font-semibold text-xs text-gray-900 uppercase tracking-wider">Ağırlıklar</h4>
                                <div className="p-3 bg-white rounded-lg border shadow-sm space-y-4">
                                    {[
                                        { key: 'calories', label: 'Kalori', color: 'bg-gray-500' },
                                        { key: 'carbs', label: 'Karb (K)', color: 'bg-orange-500' },
                                        { key: 'protein', label: 'Protein (P)', color: 'bg-blue-500' },
                                        { key: 'fat', label: 'Yağ (Y)', color: 'bg-yellow-500' },
                                        { key: 'mainDishCompat', label: 'Ana Yemek Uyumu', color: 'bg-green-600' }
                                    ].map((item) => (
                                        <div key={item.key} className={`space-y-1 ${item.key === 'mainDishCompat' ? 'pt-2 border-t mt-2' : ''}`}>
                                            <div className="flex justify-between text-xs">
                                                <span className={`font-medium ${item.key === 'mainDishCompat' ? 'text-green-700' : ''}`}>{item.label}</span>
                                                <span className="text-gray-500">{prefs.weights[item.key as keyof typeof prefs.weights]}</span>
                                            </div>
                                            {(item.key !== 'mainDishCompat' || (!isTargetMainDish && mainDishOfSlot)) && (
                                                <input
                                                    type="range" min="0" max="100" step="10"
                                                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-200"
                                                    value={prefs.weights[item.key as keyof typeof prefs.weights]}
                                                    onChange={(e) => saveSettings({ ...prefs, weights: { ...prefs.weights, [item.key]: Number(e.target.value) } })}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <div
                        className={`overflow-y-auto p-4 bg-white/50 [&::-webkit-scrollbar]:hidden 
                        ${prefs.showSettingsPanel && !hideSettings
                                ? 'absolute top-0 right-0 bottom-0 left-0 md:left-[360px] border-l'
                                : 'flex-1 w-full max-h-[calc(85vh-4rem)]'
                            }`}
                    >
                        <div className="mb-4 sticky top-0 bg-white/95 backdrop-blur-sm z-30 pt-4 pb-2 px-2 -mx-2 border-b shadow-sm">
                            <div className="mb-3 px-1 border-b pb-3">
                                <div className="flex justify-between text-[10px] font-medium text-gray-500 mb-2 px-1">
                                    <span className={activeMacroPreference < 0 ? "text-blue-600 font-bold" : ""}>Protein Öncelikli Alternatifler</span>
                                    <span className={activeMacroPreference === 0 ? "text-gray-700 font-bold" : ""}>Sadece Kalori</span>
                                    <span className={activeMacroPreference > 0 ? "text-yellow-600 font-bold" : ""}>Yağ Öncelikli Alternatifler</span>
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

                            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        aria-expanded={searchOpen}
                                        className="w-full justify-between bg-white h-10 border-blue-200 hover:border-blue-400 hover:bg-blue-50 text-gray-600"
                                    >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <Search className="h-4 w-4 shrink-0 opacity-50" />
                                            {searchQuery ? searchQuery : "Akıllı Arama (Örn: 'kıy pat' -> 'Kıymalı Patlıcan')..."}
                                        </div>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[450px] p-0" align="start">
                                    <Command shouldFilter={false}>
                                        <CommandInput
                                            placeholder="Yemek ara (Örn: 'tav sal')..."
                                            value={searchQuery}
                                            onValueChange={setSearchQuery}
                                        />
                                        <CommandList>
                                            <CommandEmpty>Yemek bulunamadı.</CommandEmpty>
                                            <CommandGroup className="max-h-[300px] overflow-y-auto">
                                                {allFoodsSortedBySimilarity
                                                    .filter(food => {
                                                        if (!searchQuery) return true
                                                        const terms = searchQuery.toLocaleLowerCase('tr').split(/\s+/).filter(t => t.length > 0)
                                                        const valLower = food.name.toLocaleLowerCase('tr')
                                                        return terms.every(term => valLower.includes(term))
                                                    })
                                                    .map((food) => (
                                                        <CommandItem
                                                            key={food.id}
                                                            value={food.name}
                                                            onSelect={() => {
                                                                onSelect(food)
                                                                setSearchOpen(false)
                                                                setSearchQuery("")
                                                            }}
                                                        >
                                                            <div className="flex items-center justify-between w-full">
                                                                <div className="flex flex-col gap-0.5">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Check className={cn("h-3 w-3 text-blue-600", originalFood?.id === food.id ? "opacity-100" : "opacity-0")} />
                                                                        {/* Compatibility Indicators */}
                                                                        {food._compatibility && (
                                                                            <TooltipProvider>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger asChild>
                                                                                        <span className="cursor-help inline-flex items-center gap-0.5">
                                                                                            {!food._compatibility.compatible && <AlertTriangle size={12} className={food._compatibility.severity === 'block' ? "text-red-600" : "text-yellow-600"} />}
                                                                                            {food._compatibility.recommended && <Heart size={12} fill="currentColor" className="text-blue-600" />}
                                                                                            {food._compatibility.medicationWarning && (
                                                                                                <span className={cn(
                                                                                                    "text-[10px]",
                                                                                                    food._compatibility.medicationWarning.type === 'negative' ? "text-red-600" :
                                                                                                        food._compatibility.medicationWarning.type === 'warning' ? "text-yellow-600" : "text-green-600"
                                                                                                )}>💊</span>
                                                                                            )}
                                                                                        </span>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent side="right" align="start" sideOffset={10} collisionPadding={20} className="w-[380px] p-0 overflow-hidden shadow-2xl border-none z-[100]">
                                                                                        <div className="flex flex-col gap-2 p-2 bg-gray-50/50">
                                                                                            {food._compatibility.warnings?.length > 0 ? (
                                                                                                food._compatibility.warnings.map((w: any, wi: number) => {
                                                                                                    const isNegative = w.type === 'negative';
                                                                                                    const isPositive = w.type === 'positive';
                                                                                                    return (
                                                                                                        <div key={wi} className={cn(
                                                                                                            "rounded-xl border p-3 flex flex-col gap-2 shadow-sm",
                                                                                                            isPositive ? "bg-blue-50/50 border-blue-100" :
                                                                                                                isNegative ? "bg-red-50/50 border-red-100" : "bg-amber-50/50 border-amber-100"
                                                                                                        )}>
                                                                                                            <div className="flex items-center justify-between">
                                                                                                                <div className="flex items-center gap-2">
                                                                                                                    <span className="font-bold text-gray-700 lowercase">{w.keyword || food.name}</span>
                                                                                                                    {isPositive ? (
                                                                                                                        <CheckCircle2 size={16} className="text-green-500" />
                                                                                                                    ) : (
                                                                                                                        <MinusCircle size={16} className="text-red-500" />
                                                                                                                    )}
                                                                                                                    <span className={cn(
                                                                                                                        "font-bold",
                                                                                                                        isPositive ? "text-blue-800" : "text-gray-800"
                                                                                                                    )}>{w.sourceName}</span>
                                                                                                                </div>
                                                                                                                <div className="text-gray-400">
                                                                                                                    {w.source === 'medication' ? <Pill size={16} /> :
                                                                                                                        w.source === 'lab' ? <FlaskConical size={16} /> : <Stethoscope size={16} />}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                            <div className="space-y-1.5">
                                                                                                                {w.warning && (
                                                                                                                    <div className="flex gap-2 items-start text-[11px] leading-relaxed">
                                                                                                                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
                                                                                                                        <span className="text-gray-700 font-medium">{w.warning}</span>
                                                                                                                    </div>
                                                                                                                )}
                                                                                                                {w.info && (
                                                                                                                    <div className="flex gap-2 items-start text-[11px] leading-relaxed">
                                                                                                                        <Info size={14} className="mt-0.5 shrink-0 text-blue-600" />
                                                                                                                        <span className="text-gray-600">{w.info}</span>
                                                                                                                    </div>
                                                                                                                )}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    );
                                                                                                })
                                                                                            ) : (
                                                                                                <div className="p-4 text-center text-gray-500 italic text-xs bg-white rounded-xl border border-dashed border-gray-200">
                                                                                                    {food._compatibility.reason || "Bu hasta için herhangi bir kısıtlama veya uyarı bulunamadı."}
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                        )}
                                                                        <span className="font-medium text-gray-900">{food.name}</span>
                                                                    </div>
                                                                    <div className="text-[10px] text-gray-500 flex items-center gap-1.5 pl-5">
                                                                        <span>{Math.round(food.calories)} kcal</span>
                                                                        <span className="text-orange-600">K:{Math.round(food.carbs)}</span>
                                                                        <span className="text-blue-600">P:{Math.round(food.protein)}</span>
                                                                        <span className="text-yellow-600">Y:{Math.round(food.fat)}</span>
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <span className={cn(
                                                                        "text-xs font-bold px-1.5 py-0.5 rounded",
                                                                        food.similarity > 80 ? "bg-green-100 text-green-700" :
                                                                            food.similarity > 50 ? "bg-yellow-100 text-yellow-700" :
                                                                                "bg-gray-100 text-gray-600"
                                                                    )}>
                                                                        %{Math.round(food.similarity)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </CommandItem>
                                                    ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {targetToRevert && (
                            <div
                                className="mb-4 bg-gradient-to-r from-violet-50 to-white border border-violet-200 rounded-lg p-3 hover:border-violet-300 hover:shadow-md transition-all cursor-pointer group"
                                onClick={() => onSelect(targetToRevert)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 bg-violet-100 text-violet-600 rounded-full">
                                            <RefreshCw size={14} />
                                        </div>
                                        <div>
                                            <div className="font-bold text-violet-800 text-sm">Orijinale Dön: {targetToRevert.name}</div>
                                            <div className="text-[10px] text-violet-600/70">Bu öğün değiştirilmeden önce bu yemek vardı.</div>
                                        </div>
                                    </div>
                                    <div className="text-violet-600 text-xs font-semibold px-2 py-1 bg-violet-100 rounded">Geri Al</div>
                                </div>
                            </div>
                        )}

                        {foods.length === 0 ? (
                            <div className="text-center py-10 text-gray-500">Yemek listesi yükleniyor...</div>
                        ) : calculatedAlternatives.length === 0 ? (
                            <div className="text-center py-10">
                                <AlertTriangle className="mx-auto h-8 w-8 text-yellow-500 mb-2" />
                                <h3 className="font-medium">Eşleşen yemek bulunamadı.</h3>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <div className="text-xs text-gray-500 mb-2 flex justify-between sticky top-[68px] bg-white/95 backdrop-blur-sm z-20 py-3 border-b shadow-sm px-2">
                                    <div className="flex gap-1 items-center">
                                        <span className="font-bold text-gray-900 text-lg">{calculatedAlternatives.length}</span>
                                        <span>yemek bulundu</span>
                                    </div>
                                    <span className="font-semibold text-gray-700 w-16 text-center">Uyumluluk</span>
                                </div>
                                {calculatedAlternatives.slice(0, prefs.limit).map((food) => (
                                    <div
                                        key={food.id}
                                        className="flex items-center justify-between p-3 border rounded-lg hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm transition-all cursor-pointer group bg-white"
                                        onClick={() => handleSelectWithPortion(food)}
                                    >
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                {/* Compatibility Indicators */}
                                                {food._compatibility && (
                                                    <TooltipProvider>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="cursor-help inline-flex items-center gap-0.5">
                                                                    {!food._compatibility.compatible && <AlertTriangle size={14} className={food._compatibility.severity === 'block' ? "text-red-600" : "text-yellow-600"} />}
                                                                    {food._compatibility.recommended && <Heart size={14} fill="currentColor" className="text-blue-600" />}
                                                                    {food._compatibility.medicationWarning && (
                                                                        <span className={cn(
                                                                            "text-xs",
                                                                            food._compatibility.medicationWarning.type === 'negative' ? "text-red-600" :
                                                                                food._compatibility.medicationWarning.type === 'warning' ? "text-yellow-600" : "text-green-600"
                                                                        )}>💊</span>
                                                                    )}
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="right" align="start" sideOffset={10} collisionPadding={20} className="w-[380px] p-0 overflow-hidden shadow-2xl border-none z-[100]">
                                                                <div className="flex flex-col gap-2 p-2 bg-gray-50/50">
                                                                    {food._compatibility.warnings?.length > 0 ? (
                                                                        food._compatibility.warnings.map((w: any, wi: number) => {
                                                                            const isNegative = w.type === 'negative';
                                                                            const isPositive = w.type === 'positive';
                                                                            return (
                                                                                <div key={wi} className={cn(
                                                                                    "rounded-xl border p-3 flex flex-col gap-2 shadow-sm",
                                                                                    isPositive ? "bg-blue-50/50 border-blue-100" :
                                                                                        isNegative ? "bg-red-50/50 border-red-100" : "bg-amber-50/50 border-amber-100"
                                                                                )}>
                                                                                    <div className="flex items-center justify-between">
                                                                                        <div className="flex items-center gap-2">
                                                                                            <span className="font-bold text-gray-700 lowercase">{w.keyword || food.name}</span>
                                                                                            {isPositive ? (
                                                                                                <CheckCircle2 size={16} className="text-green-500" />
                                                                                            ) : (
                                                                                                <MinusCircle size={16} className="text-red-500" />
                                                                                            )}
                                                                                            <span className={cn(
                                                                                                "font-bold",
                                                                                                isPositive ? "text-blue-800" : "text-gray-800"
                                                                                            )}>{w.sourceName}</span>
                                                                                        </div>
                                                                                        <div className="text-gray-400">
                                                                                            {w.source === 'medication' ? <Pill size={16} /> :
                                                                                                w.source === 'lab' ? <FlaskConical size={16} /> : <Stethoscope size={16} />}
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="space-y-1.5">
                                                                                        {w.warning && (
                                                                                            <div className="flex gap-2 items-start text-[11px] leading-relaxed">
                                                                                                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
                                                                                                <span className="text-gray-700 font-medium">{w.warning}</span>
                                                                                            </div>
                                                                                        )}
                                                                                        {w.info && (
                                                                                            <div className="flex gap-2 items-start text-[11px] leading-relaxed">
                                                                                                <Info size={14} className="mt-0.5 shrink-0 text-blue-600" />
                                                                                                <span className="text-gray-600">{w.info}</span>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })
                                                                    ) : (
                                                                        <div className="p-4 text-center text-gray-500 italic text-xs bg-white rounded-xl border border-dashed border-gray-200">
                                                                            {food._compatibility.reason || "Bu hasta için herhangi bir kısıtlama veya uyarı bulunamadı."}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </TooltipProvider>
                                                )}
                                                <span className="font-medium text-gray-900">{food.name}</span>
                                                {food.similarity > 90 && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 rounded-full font-bold">Mükemmel</span>}
                                                {!hideSettings && <button className="p-1 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); setEditingFood(food) }}><Pencil size={12} /></button>}
                                            </div>
                                            <div className="text-xs text-gray-500 flex items-center gap-3">
                                                <span className="font-semibold text-gray-700">{Math.round(food.calories)} kcal</span>
                                                <span className="text-orange-600">K: {Math.round(food.carbs)}g</span>
                                                <span className="text-blue-600">P: {Math.round(food.protein)}g</span>
                                                <span className="text-yellow-600">Y: {Math.round(food.fat)}g</span>
                                            </div>
                                        </div>
                                        <div className="w-16 text-center">
                                            <div className="text-lg font-bold text-blue-600">%{Math.round(food.similarity)}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
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
