"use client"

import { useAuth } from "@/contexts/auth-context"
import { useEffect, useState, useRef, useMemo, type ReactNode } from "react"
import { format } from "date-fns"
import { tr } from "date-fns/locale"
import { supabase } from "@/lib/supabase"
import { getPublicProgramDetails } from '@/actions/public-db-actions'
import { applyTeamFoodOverrides } from "@/lib/team-food-overrides"
import { applyTeamFoodMicronutrientOverrides } from "@/lib/team-food-micronutrient-overrides"
import { applyTeamDietTypeOverrides } from "@/lib/team-diet-type-overrides"
import { applyProgramDietTypeOverrides } from "@/lib/program-diet-type-overrides"
import { resolveTeamScopeContextForUser } from "@/lib/team-scope"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    Calendar,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ChefHat,
    UtensilsCrossed,
    RefreshCw,
    BookOpenText,
    AlertCircle,
    LayoutGrid,
    CircleDashed,
    BarChart3,
    ArrowRight,
    ArrowRightLeft,
    RotateCcw,
    X,
    TrendingUp,
    LogOut,
    StickyNote,
    Check,
    CheckCheck,
    Eraser,
    Sparkles,
    Wand2,
    Plus,
    Trash2,
    Search,
    User,
    AlertTriangle,
    Heart,
    Info,
    Camera,
    ClipboardList,
    Scale,
    BookOpen,
    Edit2,
    FileDown,
    Loader2
} from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
// import { MealSwapSheet } from "./_components/meal-swap-sheet"
import { CopiedWeekInitModal } from "@/components/planner/editors/copied-week-init-modal"
import { FoodAlternativeDialog } from "@/components/diet/food-alternative-dialog"
import { SmartSwapDialog } from "@/components/diet/smart-swap-dialog"
import { useRecipeManager } from "@/hooks/use-recipe-manager"
import { findRecipeMatch } from "@/utils/recipe-matcher"
import { RecipeCardDialog } from "@/components/patient/recipe-card-dialog"
import { useScalableUnits, getScaledFoodName } from "@/lib/planner/portion-scaler"
import { Planner } from "@/lib/planner/engine3"
import { checkCompatibility } from "@/utils/compatibility-checker"
import { SettingsDialog } from "@/components/planner/settings-dialog"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { PhotoMealLogModal } from "@/components/diet/photo-meal-log-modal"
import { FoodSearchSelector } from "@/components/diet/food-search-selector"
import { sortFoodsByRole } from "@/utils/food-sorter"
import { BalanceConfirmModal, BalanceChange } from "@/components/diet/balance-confirm-modal"
import { generateWeeklyPlanPdf } from "@/utils/generate-weekly-pdf"

import { syncPatientWeightAndActivityAction } from "@/actions/measurement-actions"

// Types
type DietFood = {
    id: string
    food_name: string
    amount: number
    unit: string
    calories: number
    protein: number
    carbs: number
    fats: number
    real_food_id?: string
    original_food_id?: string
    role?: string
    compatibility_tags?: string
    category?: string
    portion_multiplier?: number
    fat?: number  // alias for fats
    // diet_type removed, using flags to construct it
    keto?: boolean
    lowcarb?: boolean
    vegan?: boolean
    vejeteryan?: boolean
    meal_types?: string[]
    is_consumed?: boolean
    consumed_at?: string | null
    swapped_by?: 'dietitian' | 'patient' | null
    target_calories?: number
    target_protein?: number
    target_carbs?: number
    target_fat?: number // alias target_fats logic
    is_custom?: boolean
    image_url?: string | null
    food_meta?: any
    min_quantity?: number
    max_quantity?: number
    step?: number
    portion_fixed?: boolean
}

// Helper to calculate targets
function calculateDailyTargets(weight: number, activityLevel: number, dietType?: { carb_factor?: number, protein_factor?: number, fat_factor?: number }, patientGoals?: string[]) {
    if (!weight) return null
    const userMultipliers: Record<number, number> = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.2 }
    let multiplier = userMultipliers[activityLevel] || 1.0

    // Apply Goal Multipliers
    if (patientGoals && patientGoals.length > 0) {
        if (patientGoals.includes("Kilo Vermek") || patientGoals.includes("Kilo Vermek (Yağ Yakımı)")) {
            multiplier *= 0.9
        } else if (patientGoals.includes("Kilo Almak") || patientGoals.includes("Kas Gelişimi (Hipertrofi)")) {
            multiplier *= 1.1
        }
    }

    const factors = {
        carb: dietType?.carb_factor ?? 3.0,
        protein: dietType?.protein_factor ?? 1.0,
        fat: dietType?.fat_factor ?? 0.8
    }
    const targetCarb = Math.round(weight * factors.carb * multiplier)
    const targetProtein = Math.round(weight * factors.protein * multiplier)
    const targetFat = Math.round(weight * factors.fat * multiplier)
    const totalCalories = Math.round((targetCarb * 4) + (targetProtein * 4) + (targetFat * 9))
    return { calories: totalCalories, carb: targetCarb, protein: targetProtein, fat: targetFat, multiplier }
}

type DietMeal = {
    id: string
    meal_name: string
    time: string
    diet_foods: DietFood[]
}

type DietDay = {
    id: string
    day_name: string // "Pazartesi", "Salı", etc.
    order: number
    diet_meals: DietMeal[]
    notes?: string
    diet_notes?: any[]
    total_calories?: number
    total_protein?: number
    total_carbs?: number
    total_fat?: number
    target_calories?: number
    target_protein?: number
    target_carbs?: number
    target_fat?: number
}

// ================== MACRO DASHBOARD ==================
interface MacroDashboardProps {
    totals: any
    targets: any
    macroTargetMode: string
    activeTab: 'daily' | 'weekly'
    onTabChange: (tab: 'daily' | 'weekly') => void
    isVisible: boolean
    onClose: () => void
    days: DietDay[]
    patientInfo: any
    activeWeek: any
    activeDietType: any
}

function ConcentricRings({ data, size = 96, label }: {
    data: { label: string, actual: number, target: number, color: string }[]
    size?: number
    label: string
}) {
    const cx = size / 2, cy = size / 2
    const ringW = 7, gap = 2

    const rings = data.map((d, i) => {
        const r = (size / 2) - 6 - (i * (ringW + gap))
        const circ = 2 * Math.PI * r
        const pct = d.target > 0 ? d.actual / d.target : 0
        const basePct = Math.min(pct, 1)
        const overPct = Math.max(0, pct - 1)
        return { ...d, cn: cx, r, circ, basePct, overPct, pct, i }
    })

    return (
        <div className="flex flex-col items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-black text-gray-500 tracking-widest">{label}</span>
            <svg width={size} height={size} className="transform -rotate-90 drop-shadow-sm">
                {rings.map(ring => (
                    <g key={ring.i}>
                        <circle cx={cx} cy={cy} r={ring.r} fill="none" stroke={ring.color} strokeWidth={ringW} opacity={0.15} />
                        <circle cx={cx} cy={cy} r={ring.r} fill="none" stroke={ring.color} strokeWidth={ringW}
                            strokeDasharray={ring.circ} strokeDashoffset={ring.circ - (ring.basePct * ring.circ)}
                            strokeLinecap="round" opacity={0.65} className="transition-all duration-1000" />
                        {ring.overPct > 0 && (
                            <circle cx={cx} cy={cy} r={ring.r} fill="none" stroke={ring.color} strokeWidth={ringW}
                                strokeDasharray={ring.circ} strokeDashoffset={ring.circ - (Math.min(ring.overPct, 1) * ring.circ)}
                                strokeLinecap="round" opacity={0.95} className="transition-all duration-1000" />
                        )}
                    </g>
                ))}
            </svg>
        </div>
    )
}

function MacroDashboard({ totals, targets, isVisible, onClose, days, patientInfo }: MacroDashboardProps) {
    const tCals = targets?.calories || 0, tCarb = targets?.carb || targets?.carbs || 0, tProt = targets?.protein || 0, tFat = targets?.fat || 0
    const dCals = Math.round(totals.calories || 0), dCarb = Math.round(totals.carbs || 0), dProt = Math.round(totals.protein || 0), dFat = Math.round(totals.fat || 0)
    const [isDailyBalanceHintActive, setIsDailyBalanceHintActive] = useState(false)
    const [isWeeklyBalanceHintActive, setIsWeeklyBalanceHintActive] = useState(false)
    const dailyHintShown = useRef(false)
    const weeklyHintShown = useRef(false)
    const deviationThresholdPct = 10

    const getDeviationPercent = (actual: number, target: number) => {
        if (target <= 0) return 0
        return ((actual - target) / target) * 100
    }

    const hasDailyLargeDeviation =
        Math.abs(getDeviationPercent(dCals, tCals)) > deviationThresholdPct
    const showFlavorTune = patientInfo?.visibility_settings?.show_flavor_tune !== false

    useEffect(() => {
        if (!isVisible || !targets || !hasDailyLargeDeviation) {
            setIsDailyBalanceHintActive(false)
            return
        }

        if (dailyHintShown.current) return;
        dailyHintShown.current = true;

        setIsDailyBalanceHintActive(true)
        window.setTimeout(() => {
            setIsDailyBalanceHintActive(false)
        }, 2000)
    }, [isVisible, targets, hasDailyLargeDeviation])

    const wAvg = (() => {
        if (!days || days.length === 0) return { calories: 0, protein: 0, carbs: 0, fat: 0 }
        let c = 0, p = 0, k = 0, f = 0, n = 0
        days.forEach((d: any) => {
            const meals = d.diet_meals || []
            let dc = 0, dp = 0, dk = 0, df = 0, has = false
            meals.forEach((m: any) => {
                m.diet_foods.forEach((fd: any) => {
                    if (fd.is_consumed) {
                        const mult = fd.amount || fd.portion_multiplier || 1
                        dc += (Number(fd.calories) || 0) * mult; dp += (Number(fd.protein) || 0) * mult
                        dk += (Number(fd.carbs) || 0) * mult; df += (Number(fd.fat || fd.fats) || 0) * mult; has = true
                    }
                })
            })
            if (has) { c += dc; p += dp; k += dk; f += df; n++ }
        })
        return n === 0 ? { calories: 0, protein: 0, carbs: 0, fat: 0 } : { calories: Math.round(c / n), protein: Math.round(p / n), carbs: Math.round(k / n), fat: Math.round(f / n) }
    })()

    const hasWeeklyLargeDeviation =
        Math.abs(getDeviationPercent(wAvg.calories, tCals)) > deviationThresholdPct

    useEffect(() => {
        if (!isVisible || !targets || !hasWeeklyLargeDeviation) {
            setIsWeeklyBalanceHintActive(false)
            return
        }

        if (weeklyHintShown.current) return;
        weeklyHintShown.current = true;

        setIsWeeklyBalanceHintActive(true)
        window.setTimeout(() => {
            setIsWeeklyBalanceHintActive(false)
        }, 2000)
    }, [isVisible, targets, hasWeeklyLargeDeviation])

    if (!isVisible || !targets) return null

    // Softer modern colors
    const colors = { fat: '#FBBF24', prot: '#60A5FA', carb: '#F87171' }

    const dRings = [
        { label: 'Yağ', actual: dFat, target: tFat, color: colors.fat },
        { label: 'Prot', actual: dProt, target: tProt, color: colors.prot },
        { label: 'KH', actual: dCarb, target: tCarb, color: colors.carb },
    ]
    const wRings = [
        { label: 'Yağ', actual: wAvg.fat, target: tFat, color: colors.fat },
        { label: 'Prot', actual: wAvg.protein, target: tProt, color: colors.prot },
        { label: 'KH', actual: wAvg.carbs, target: tCarb, color: colors.carb },
    ]

    const Row = ({ lbl, act, tgt, clr }: { lbl: string, act: number, tgt: number, clr: string }) => {
        const pct = tgt > 0 ? Math.round((act / tgt) * 100) : 0
        return (
            <div className="flex items-center justify-between py-0.5">
                <div className="flex items-center gap-1 sm:gap-1.5 w-[24px] sm:w-[42px] shrink-0">
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0" style={{ background: clr }} />
                    <span className="text-[11px] sm:text-[11px] font-bold text-gray-600 tracking-tighter sm:tracking-normal">{lbl}</span>
                </div>
                <div className="flex items-center justify-end gap-0.5 sm:gap-1 flex-1 min-w-0">
                    <div className="flex items-baseline gap-px sm:gap-0.5 min-w-0">
                        <span className="text-[12px] sm:text-[11px] font-bold tabular-nums text-gray-800 leading-none">{act}</span>
                        <span className="text-[10px] sm:text-[12px] text-gray-400">/</span>
                        <span className="text-[11px] sm:text-[10px] text-gray-500 tabular-nums leading-none truncate">{Math.round(tgt)}<span className="hidden sm:inline">g</span></span>
                    </div>
                    <span className={cn("text-[11px] sm:text-[10px] font-black tabular-nums text-right ml-0.5 shrink-0", pct > 105 ? "text-red-500" : pct >= 95 ? "text-green-600" : "text-gray-400")}>
                        %{pct}
                    </span>
                </div>
            </div>
        )
    }

    const dCalPct = tCals > 0 ? Math.round((dCals / tCals) * 100) : 0
    const wCalPct = tCals > 0 ? Math.round((wAvg.calories / tCals) * 100) : 0

    return (
        <div className="relative w-full px-1 sm:px-0 z-20">
            <Card className="overflow-hidden shadow-sm border border-gray-100 bg-white backdrop-blur-md rounded-xl p-1 sm:p-2.5 mx-0 sm:mx-1 mb-2 min-w-0">
                <div className="flex flex-col gap-2">
                    {/* Top Row: Daily and Weekly Rings Side by Side */}
                    <div className="flex flex-row items-stretch gap-1 sm:gap-3">
                        {/* Daily Cell */}
                        <div className="flex-1 flex items-center gap-1 sm:gap-3 bg-gray-50/50 rounded-lg sm:rounded-xl p-1 sm:p-2.5 border border-gray-100/50 min-w-0">
                            <div className="shrink-0 scale-90 sm:scale-100 origin-left">
                                <ConcentricRings data={dRings} label="GÜNLÜK" size={64} />
                            </div>
                            <div className="flex-1 flex flex-col justify-center gap-0 sm:gap-1 min-w-0 -ml-1 sm:ml-0">
                                <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                                    <span className="text-[11px] sm:text-[11px] font-black text-gray-400 uppercase tracking-tight sm:tracking-wide">Kalori</span>
                                    <div className="flex items-baseline gap-0.5 min-w-0">
                                        <span className="text-[10px] sm:text-sm font-black text-gray-800 tabular-nums leading-none">{dCals}</span>
                                        <span className="text-[10px] sm:text-[12px] text-gray-400">/</span>
                                        <span className="text-[11px] sm:text-[11px] text-gray-500 tabular-nums leading-none truncate">{Math.round(tCals)}</span>
                                    </div>
                                </div>
                                <div className="w-full h-px bg-gray-200/50 my-0.5" />
                                <Row lbl="KH" act={dCarb} tgt={tCarb} clr={colors.carb} />
                                <Row lbl="Pro" act={dProt} tgt={tProt} clr={colors.prot} />
                                <Row lbl="Yağ" act={dFat} tgt={tFat} clr={colors.fat} />
                            </div>
                        </div>

                        {/* Weekly Cell */}
                        <div className="flex-1 flex items-center gap-1 sm:gap-3 bg-gray-50/50 rounded-lg sm:rounded-xl p-1 sm:p-2.5 border border-gray-100/50 relative min-w-0 pr-6 sm:pr-8">
                            <div className="shrink-0 scale-90 sm:scale-100 origin-left">
                                <ConcentricRings data={wRings} label="HAFTALIK" size={64} />
                            </div>
                            <div className="flex-1 flex flex-col justify-center gap-0 sm:gap-1 min-w-0 -ml-1 sm:ml-0">
                                <div className="flex items-center justify-between mb-0.5 sm:mb-1">
                                    <span className="text-[11px] sm:text-[11px] font-black text-gray-400 uppercase tracking-tight sm:tracking-wide">Kalori</span>
                                    <div className="flex items-baseline gap-0.5 min-w-0">
                                        <span className="text-[10px] sm:text-sm font-black text-gray-800 tabular-nums leading-none">{wAvg.calories}</span>
                                        <span className="text-[10px] sm:text-[12px] text-gray-400">/</span>
                                        <span className="text-[11px] sm:text-[11px] text-gray-500 tabular-nums leading-none truncate">{Math.round(tCals)}</span>
                                    </div>
                                </div>
                                <div className="w-full h-px bg-gray-200/50 my-0.5" />
                                <Row lbl="KH" act={wAvg.carbs} tgt={tCarb} clr={colors.carb} />
                                <Row lbl="Pro" act={wAvg.protein} tgt={tProt} clr={colors.prot} />
                                <Row lbl="Yağ" act={wAvg.fat} tgt={tFat} clr={colors.fat} />
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-1 right-1 h-10 w-10 min-w-[40px] text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full"
                                onClick={onClose}
                            >
                                <X size={12} />
                            </Button>
                        </div>
                    </div>

                    {/* Bottom Row: Full Width Daily/Weekly Vibrant Progress Bars with Dengele Buttons */}
                    <div className="w-full flex flex-col sm:flex-row items-stretch gap-2 mt-0.5">
                        {/* Weekly Progress Bar & Buttons */}
                        <div className="flex-1 flex flex-row items-center gap-2">
                            <div className="relative flex-1 h-5 sm:h-4.5 rounded-md overflow-hidden bg-gray-100 shrink-0 border-r-4 border-gray-400/30">
                                {/* Battery Cap Effect */}
                                <div className="absolute right-0 top-1/4 bottom-1/4 w-1 bg-gray-400/50 rounded-l-sm z-30" />

                                {(() => {
                                    const targetCalsNum = Math.round(tCals)
                                    const avgVal = Math.max(wAvg.calories, targetCalsNum) || 1
                                    const targetPosPct = (targetCalsNum / avgVal) * 100
                                    const actualPosPct = (wAvg.calories / avgVal) * 100
                                    const isOvershoot = wAvg.calories > targetCalsNum

                                    return (
                                        <div className="relative w-full h-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
                                            {/* Base progress with 3D gradient */}
                                            <div className={cn("absolute top-0 left-0 h-full transition-all duration-1000 ease-in-out shadow-[0_1px_3px_rgba(0,0,0,0.2)]",
                                                wCalPct >= 85 ? "bg-gradient-to-b from-green-300 via-green-500 to-green-600" :
                                                    wCalPct >= 50 ? "bg-gradient-to-b from-orange-300 via-orange-500 to-orange-600" :
                                                        "bg-gradient-to-b from-blue-300 via-blue-500 to-blue-600")}
                                                style={{ width: `${Math.min(actualPosPct, targetPosPct)}%` }}>
                                                {/* Glossy highlight */}
                                                <div className="absolute top-0 left-0 right-0 h-1/3 bg-white/20" />
                                            </div>

                                            {/* Overshoot Indicator */}
                                            {isOvershoot && (
                                                <div className="absolute top-0 h-full transition-all duration-1000 ease-in-out bg-gradient-to-b from-red-400 via-red-600 to-red-700 shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
                                                    style={{ left: `${targetPosPct}%`, width: `${actualPosPct - targetPosPct}%` }}>
                                                    <div className="absolute top-0 left-0 right-0 h-1/3 bg-white/20" />
                                                </div>
                                            )}

                                            {/* Centered Label - Faded */}
                                            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                                                <span className="text-[12px] font-black text-gray-800/20 tracking-widest uppercase">HAFTALIK ORTALAMA</span>
                                            </div>

                                            <div className="absolute inset-0 flex items-center px-3 text-xs font-bold z-10 text-shadow-sm pointer-events-none">
                                                <div className="flex items-center gap-1.5 drop-shadow-sm text-gray-900 absolute left-3">
                                                    <span className="font-black text-white mix-blend-difference">{wAvg.calories}</span>
                                                    <span className="text-[10px] uppercase tracking-tighter text-white/90 mix-blend-difference mt-[1px]">ort.</span>
                                                </div>

                                                {isOvershoot ? (
                                                    <div className="absolute flex items-center gap-1.5 drop-shadow-sm"
                                                        style={{ left: `${targetPosPct}%`, transform: 'translateX(-100%)', paddingRight: '12px' }}>
                                                        <span className="font-bold text-white mix-blend-difference">{targetCalsNum}</span>
                                                        <span className="text-[10px] uppercase tracking-tighter text-white/80 mix-blend-difference mt-[1px]">hedef</span>
                                                    </div>
                                                ) : (
                                                    <div className="absolute flex items-center gap-1.5 drop-shadow-sm right-3 text-gray-800">
                                                        <span className="font-bold">{targetCalsNum}</span>
                                                        <span className="text-[10px] uppercase tracking-tighter text-gray-600 mt-[1px]">hedef</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Target Line Divider */}
                                            {isOvershoot && (
                                                <div className="absolute top-0 bottom-0 w-[2px] bg-white/60 z-20" style={{ left: `${targetPosPct}%` }} />
                                            )}
                                        </div>
                                    )
                                })()}
                            </div>
                            <button
                                onClick={() => {
                                    setIsWeeklyBalanceHintActive(false);
                                    const event = new CustomEvent('trigger-weekly-balance');
                                    window.dispatchEvent(event);
                                }}
                                className={cn(
                                    "relative h-8 px-3 rounded-md text-xs font-bold transition-all flex justify-center items-center gap-1.5 shadow-[0_4px_20px_-2px_rgba(34,197,94,0.4)] hover:shadow-[0_6px_30px_-2px_rgba(34,197,94,0.6)] bg-gradient-to-br from-teal-500 via-green-500 to-emerald-500 hover:from-teal-600 hover:via-green-600 hover:to-emerald-600 text-white shrink-0 hover:scale-[1.02] active:scale-95",
                                    isWeeklyBalanceHintActive && "animate-bounce scale-110 ring-4 ring-emerald-300/90 ring-offset-2 ring-offset-white shadow-[0_0_0_5px_rgba(52,211,153,0.25),0_0_28px_8px_rgba(16,185,129,0.55)]"
                                )}
                                title="Haftalık Makro Dengele"
                            >
                                {isWeeklyBalanceHintActive && (
                                    <span className="absolute -top-1 -right-1 inline-flex h-3.5 w-3.5">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/90"></span>
                                        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-white"></span>
                                    </span>
                                )}
                                <Scale size={16} />
                                <span className={cn("sm:inline", isWeeklyBalanceHintActive ? "inline" : "hidden")}>DENGELE</span>
                            </button>
                            {showFlavorTune && (
                                <button
                                    onClick={() => {
                                        const event = new CustomEvent('trigger-weekly-flavor');
                                        window.dispatchEvent(event);
                                    }}
                                    className="relative h-8 px-3 rounded-md text-xs font-bold transition-all flex justify-center items-center gap-1.5 shadow-[0_4px_20px_-2px_rgba(249,115,22,0.35)] hover:shadow-[0_6px_30px_-2px_rgba(249,115,22,0.55)] bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 hover:from-amber-600 hover:via-orange-600 hover:to-red-600 text-white shrink-0 hover:scale-[1.02] active:scale-95"
                                    title="Haftalık Lezzet Ayarı"
                                >
                                    <UtensilsCrossed size={16} />
                                    <span className="hidden sm:inline">LEZZET</span>
                                </button>
                            )}
                        </div>

                        {/* Daily Progress Bar & Buttons */}
                        <div className="flex-1 flex flex-row items-center gap-2">
                            <div className="relative flex-1 h-5 sm:h-4.5 rounded-md overflow-hidden bg-gray-100 shrink-0 border-r-4 border-gray-400/30">
                                {/* Battery Cap Effect */}
                                <div className="absolute right-0 top-1/4 bottom-1/4 w-1 bg-gray-400/50 rounded-l-sm z-30" />

                                {(() => {
                                    const targetCalsNum = Math.round(tCals)
                                    const maxVal = Math.max(dCals, targetCalsNum) || 1
                                    const targetPosPct = (targetCalsNum / maxVal) * 100
                                    const actualPosPct = (dCals / maxVal) * 100
                                    const isOvershoot = dCals > targetCalsNum

                                    return (
                                        <div className="relative w-full h-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
                                            {/* Base progress with 3D gradient */}
                                            <div className={cn("absolute top-0 left-0 h-full transition-all duration-1000 ease-in-out shadow-[0_1px_3px_rgba(0,0,0,0.2)]",
                                                dCalPct >= 85 ? "bg-gradient-to-b from-green-300 via-green-500 to-green-600" :
                                                    dCalPct >= 50 ? "bg-gradient-to-b from-orange-300 via-orange-500 to-orange-600" :
                                                        "bg-gradient-to-b from-blue-300 via-blue-500 to-blue-600")}
                                                style={{ width: `${Math.min(actualPosPct, targetPosPct)}%` }}>
                                                {/* Glossy highlight */}
                                                <div className="absolute top-0 left-0 right-0 h-1/3 bg-white/20" />
                                            </div>

                                            {/* Overshoot Indicator */}
                                            {isOvershoot && (
                                                <div className="absolute top-0 h-full transition-all duration-1000 ease-in-out bg-gradient-to-b from-red-400 via-red-600 to-red-700 shadow-[0_1px_3px_rgba(0,0,0,0.2)]"
                                                    style={{ left: `${targetPosPct}%`, width: `${actualPosPct - targetPosPct}%` }}>
                                                    <div className="absolute top-0 left-0 right-0 h-1/3 bg-white/20" />
                                                </div>
                                            )}

                                            {/* Centered Label */}
                                            <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                                                <span className="text-[10px] font-black text-gray-800/40 tracking-widest uppercase">GÜNLÜK</span>
                                            </div>

                                            <div className="absolute inset-0 flex items-center px-3 text-xs font-bold z-10 text-shadow-sm pointer-events-none">
                                                <div className="flex items-center gap-1.5 drop-shadow-sm text-gray-900 absolute left-3">
                                                    <span className="font-black text-white mix-blend-difference">{dCals}</span>
                                                    <span className="text-[10px] uppercase tracking-tighter text-white/90 mix-blend-difference mt-[1px]">alınan</span>
                                                </div>

                                                {isOvershoot ? (
                                                    <div className="absolute flex items-center gap-1.5 drop-shadow-sm"
                                                        style={{ left: `${targetPosPct}%`, transform: 'translateX(-100%)', paddingRight: '12px' }}>
                                                        <span className="font-bold text-white mix-blend-difference">{targetCalsNum}</span>
                                                        <span className="text-[10px] uppercase tracking-tighter text-white/80 mix-blend-difference mt-[1px]">hedef</span>
                                                    </div>
                                                ) : (
                                                    <div className="absolute flex items-center gap-1.5 drop-shadow-sm right-3 text-gray-800">
                                                        <span className="font-bold">{targetCalsNum}</span>
                                                        <span className="text-[10px] uppercase tracking-tighter text-gray-600 mt-[1px]">hedef</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Target Line Divider */}
                                            {isOvershoot && (
                                                <div className="absolute top-0 bottom-0 w-[2px] bg-white/60 z-20" style={{ left: `${targetPosPct}%` }} />
                                            )}
                                        </div>
                                    )
                                })()}
                            </div>
                            <button
                                onClick={() => {
                                    setIsDailyBalanceHintActive(false);
                                    const event = new CustomEvent('trigger-daily-balance');
                                    window.dispatchEvent(event);
                                }}
                                className={cn(
                                    "relative h-8 px-3 rounded-md text-xs font-bold transition-all flex justify-center items-center gap-1.5 shadow-[0_4px_20px_-2px_rgba(99,102,241,0.4)] hover:shadow-[0_6px_30px_-2px_rgba(99,102,241,0.6)] bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white shrink-0 hover:scale-[1.02] active:scale-95",
                                    isDailyBalanceHintActive && "animate-bounce scale-110 ring-4 ring-fuchsia-300/90 ring-offset-2 ring-offset-white shadow-[0_0_0_5px_rgba(232,121,249,0.25),0_0_28px_8px_rgba(168,85,247,0.55)]"
                                )}
                                title="Günlük Makro Dengele"
                            >
                                {isDailyBalanceHintActive && (
                                    <span className="absolute -top-1 -right-1 inline-flex h-3.5 w-3.5">
                                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/90"></span>
                                        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-white"></span>
                                    </span>
                                )}
                                <Scale size={16} />
                                <span className={cn("sm:inline", isDailyBalanceHintActive ? "inline" : "hidden")}>DENGELE</span>
                            </button>
                            {showFlavorTune && (
                                <button
                                    onClick={() => {
                                        const event = new CustomEvent('trigger-daily-flavor');
                                        window.dispatchEvent(event);
                                    }}
                                    className="relative h-8 px-3 rounded-md text-xs font-bold transition-all flex justify-center items-center gap-1.5 shadow-[0_4px_20px_-2px_rgba(249,115,22,0.35)] hover:shadow-[0_6px_30px_-2px_rgba(249,115,22,0.55)] bg-gradient-to-br from-amber-500 via-orange-500 to-red-500 hover:from-amber-600 hover:via-orange-600 hover:to-red-600 text-white shrink-0 hover:scale-[1.02] active:scale-95"
                                    title="Günlük Lezzet Ayarı"
                                >
                                    <UtensilsCrossed size={16} />
                                    <span className="hidden sm:inline">LEZZET</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    )
}





// ================== WEEKLY PERFORMANCE REPORT ==================
function WeeklyPerformanceReport({ days, patientInfo, activeWeek, activeDietType, isInternal = false }: { days: DietDay[], patientInfo: any, activeWeek: any, activeDietType: any, isInternal?: boolean }) {
    const [metric, setMetric] = useState<'calories' | 'protein' | 'carbs' | 'fat'>('calories')

    const metrics = [
        { id: 'calories', label: 'Kalori', color: 'bg-gray-400', unit: ' kcal' },
        { id: 'protein', label: 'Protein', color: 'bg-blue-500', unit: 'g' },
        { id: 'carbs', label: 'Karbonhidrat', color: 'bg-red-500', unit: 'g' },
        { id: 'fat', label: 'Yağ', color: 'bg-yellow-500', unit: 'g' },
    ]

    const selectedMetric = metrics.find(m => m.id === metric)!

    const dailyData = days.map(day => {
        // Calculate Actuals
        const totals = day.diet_meals.reduce((acc, m) => {
            return m.diet_foods.reduce((accInner, f) => {
                if (!f.is_consumed) return accInner
                return {
                    calories: accInner.calories + ((Number(f.calories) || 0) * (f.amount || 1)),
                    protein: accInner.protein + ((Number(f.protein) || 0) * (f.amount || 1)),
                    carbs: accInner.carbs + ((Number(f.carbs) || 0) * (f.amount || 1)),
                    fat: accInner.fat + ((Number(f.fat || (f as any).fats) || 0) * (f.amount || 1))
                }
            }, acc)
        }, { calories: 0, protein: 0, carbs: 0, fat: 0 })

        // Calculate Target
        let target = 0
        if (patientInfo?.macro_target_mode === 'plan') {
            // Plan Mode: Sum of meal targets for THIS day
            target = day.diet_meals.reduce((sum, m) => {
                return sum + m.diet_foods.reduce((fSum, f) => {
                    const val = metric === 'calories' ? (Number((f as any).target_calories) || 0) :
                        metric === 'protein' ? (Number((f as any).target_protein) || 0) :
                            metric === 'carbs' ? (Number((f as any).target_carbs) || 0) :
                                (Number((f as any).target_fats) || Number((f as any).target_fat) || 0)
                    return fSum + val
                }, 0)
            }, 0)
        } else if (patientInfo?.weight) {
            // Calculated Mode: Use Formula with Week Logs if available
            const effectiveWeight = activeWeek?.weight_log || patientInfo.weight
            const effectiveActivity = activeWeek?.activity_level_log || activeWeek?.activity_level || patientInfo.activity_level || 3

            const calculated = calculateDailyTargets(
                effectiveWeight,
                effectiveActivity,
                activeDietType,
                patientInfo?.patient_goals
            )
            if (calculated) {
                target = metric === 'calories' ? calculated.calories :
                    metric === 'protein' ? calculated.protein :
                        metric === 'carbs' ? calculated.carb :
                            calculated.fat
            }
        }

        return {
            name: day.day_name.slice(0, 3),
            actual: totals[metric as keyof typeof totals],
            target
        }
    })

    // Calculate baseline only for Y-Axis label display if needed (average of daily targets)
    const targetBaseline = dailyData.length > 0
        ? dailyData.reduce((acc, d) => acc + d.target, 0) / dailyData.length
        : 0

    const maxVal = Math.max(...dailyData.map(d => Math.max(d.actual, d.target, 1)))

    return (
        <Card className="overflow-hidden shadow-md border-none ring-1 ring-gray-100 mt-6">
            <CardHeader className="p-4 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2 text-green-700">
                    <BarChart3 size={18} />
                    <CardTitle className="text-sm font-bold uppercase">Haftalık Rapor</CardTitle>
                </div>
                <Select value={metric} onValueChange={(v: any) => setMetric(v)}>
                    <SelectTrigger className="w-[140px] h-8 text-[11px] font-bold">
                        <SelectValue placeholder="Metrik Seçin" />
                    </SelectTrigger>
                    <SelectContent>
                        {metrics.map(m => (
                            <SelectItem key={m.id} value={m.id} className="text-[11px] font-bold">
                                {m.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </CardHeader>
            <CardContent className="p-4 pt-0">
                <div className="h-56 flex items-end justify-around gap-2 pb-6 border-b border-gray-50 relative mt-4 ml-8">
                    {/* Y-Axis Target Label */}
                    {targetBaseline > 0 && (
                        <div
                            className="absolute -left-10 px-1 py-0.5 bg-green-50 text-green-700 text-[12px] font-bold rounded border border-green-100 whitespace-nowrap z-30"
                            style={{ bottom: `${(targetBaseline / maxVal) * 100}%`, transform: 'translateY(50%)' }}
                        >
                            {Math.round(targetBaseline)}{selectedMetric.unit}
                        </div>
                    )}

                    {dailyData.map((d, i) => {
                        const actualHeight = (d.actual / maxVal) * 100
                        const targetPos = (d.target / maxVal) * 100
                        const isOver = d.actual > d.target

                        return (
                            <div key={i} className="flex-1 flex flex-col items-center group relative h-full justify-end">
                                {/* Vertical Projection Line (Delta) */}
                                {d.actual > 0 && d.target > 0 && (
                                    <div
                                        className={cn(
                                            "absolute w-[1px] border-l border-dotted z-10 transition-all duration-500",
                                            isOver ? "border-red-400" : "border-green-400"
                                        )}
                                        style={{
                                            bottom: `${Math.min(actualHeight, targetPos)}%`,
                                            height: `${Math.abs(actualHeight - targetPos)}%`,
                                            left: '50%'
                                        }}
                                    />
                                )}

                                {/* Target Line Override/Iz Dusum */}
                                <div
                                    className="absolute left-0 right-0 border-t border-dashed border-green-500/30 z-10 transition-all duration-500"
                                    style={{ bottom: `${targetPos}%` }}
                                    title={`Hedef: ${Math.round(d.target)}${selectedMetric.unit}`}
                                />
                                {/* Actual Bar */}
                                <div
                                    className={cn(
                                        "w-full max-w-[28px] rounded-t-sm transition-all duration-1000 relative z-20 shadow-sm hover:brightness-90 hover:scale-x-110",
                                        selectedMetric.color,
                                        isOver && "ring-2 ring-red-400 ring-offset-1"
                                    )}
                                    style={{ height: `${actualHeight}%` }}
                                >
                                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-900/90 text-white text-[10px] px-2 py-0.5 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-40 font-bold backdrop-blur-sm">
                                        {Math.round(d.actual)}{selectedMetric.unit}
                                        {isOver && <span className="text-red-300 ml-1">(+{Math.round(d.actual - d.target)})</span>}
                                    </div>
                                </div>
                                <span className="absolute -bottom-6 text-[10px] font-bold text-gray-500 uppercase tracking-tighter">{d.name}</span>
                            </div>
                        )
                    })}
                </div>
                <div className="flex justify-between items-center mt-8 text-[10px]">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                            <div className={cn("w-2 h-2 rounded-full", selectedMetric.color)} />
                            <span className="font-bold text-gray-600 uppercase">Tüketilen</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-0.5 border-t-2 border-dashed border-green-400" />
                            <span className="font-bold text-gray-600 uppercase">Yönelim/Hedef</span>
                        </div>
                    </div>
                    <div className="text-gray-400 italic">
                        Ortalama: {Math.round(dailyData.reduce((acc, d) => acc + d.actual, 0) / (dailyData.length || 1))}{selectedMetric.unit}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

// Date helpers for plan generation
function getMonday(date: Date): Date {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    d.setDate(diff)
    return d
}

function getNextMonday(date: Date): Date {
    const d = getMonday(date)
    d.setDate(d.getDate() + 7)
    return d
}

function formatDateISO(date: Date): string {
    return date.toISOString().split('T')[0]
}

function CascadeButton({ globalIndex, onClick, showSwapUI, className }: { globalIndex: number, onClick: (e: any) => void, showSwapUI: boolean, className?: string }) {
    const [isSpinning, setIsSpinning] = useState(false);
    useEffect(() => {
        const startTimer = setTimeout(() => setIsSpinning(true), globalIndex * 150 + 100);
        const endTimer = setTimeout(() => setIsSpinning(false), globalIndex * 150 + 1100);
        return () => { clearTimeout(startTimer); clearTimeout(endTimer); }
    }, [globalIndex]);

    return (
        <button
            onClick={onClick}
            className={cn(
                className,
                "absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-1000 border",
                isSpinning ? "bg-emerald-500 text-white border-emerald-500 rotate-[360deg] shadow-lg shadow-emerald-500/40" : "bg-white/50 border-slate-200 text-slate-500 hover:bg-white/80 hover:text-slate-700 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] rotate-0",
                showSwapUI && "text-amber-500 border-amber-200/50 hover:bg-amber-50/80 hover:text-amber-600"
            )}
        >
            {showSwapUI ? <RotateCcw size={13} strokeWidth={2.5} /> : <RefreshCw size={13} strokeWidth={2.5} className={cn(isSpinning && "animate-spin")} />}
        </button>
    );
}

export default function PatientPlanPage() {
    const { user, profile, signOut } = useAuth()
    const scalableUnits = useScalableUnits()
    const [loading, setLoading] = useState(true)
    const [activePlan, setActivePlan] = useState<any>(null)
    const [weekDays, setWeekDays] = useState<DietDay[]>([])
    const [selectedDayIndex, setSelectedDayIndex] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [allWeeks, setAllWeeks] = useState<any[]>([])
    const [totalWeekCount, setTotalWeekCount] = useState(0)
    const [currentWeekId, setCurrentWeekId] = useState<string | null>(null) // Real-time current week
    const [currentWeekNumber, setCurrentWeekNumber] = useState<number | null>(null) // Real-time current week number
    const [activeWeek, setActiveWeek] = useState<any>(null)
    const [patientStatus, setPatientStatus] = useState<string | null>(null)
    const [patientInfo, setPatientInfo] = useState<any>(null) // For targets
    const [pdfBranding, setPdfBranding] = useState<{ logoUrl: string | null, footerText: string | null } | null>(null)
    const [activeDietType, setActiveDietType] = useState<any>(null) // For targets
    const [patientDietTypes, setPatientDietTypes] = useState<any[]>([]) // For override
    const [dietTypesList, setDietTypesList] = useState<any[]>([]) // Global list
    const [patientProgram, setPatientProgram] = useState<any>(null) // For Fallback Logic
    const [patientDiseases, setPatientDiseases] = useState<any[]>([])
    const [patientLabs, setPatientLabs] = useState<any[]>([])
    const [patientMedicationRules, setPatientMedicationRules] = useState<any[]>([])
    const initialDaySelected = useRef(false)

    // Swipe to change day
    const touchStartX = useRef<number | null>(null)
    const touchStartY = useRef<number | null>(null)

    const onTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.targetTouches[0].clientX
        touchStartY.current = e.targetTouches[0].clientY
    }

    const onTouchMove = (e: React.TouchEvent) => {
        if (touchStartX.current === null || touchStartY.current === null) return
        const touchEndX = e.targetTouches[0].clientX
        const touchEndY = e.targetTouches[0].clientY
        
        const distanceX = touchStartX.current - touchEndX
        const distanceY = Math.abs(touchStartY.current - touchEndY)
        
        if (distanceY > Math.abs(distanceX)) {
            touchStartX.current = null
            touchStartY.current = null
            return
        }
    }

    const onTouchEnd = (e: React.TouchEvent) => {
        if (touchStartX.current === null || touchStartY.current === null) return
        
        const touchEndX = e.changedTouches[0].clientX
        const distanceX = touchStartX.current - touchEndX
        
        if (distanceX > 60) {
            setSelectedDayIndex(prev => prev < weekDays.length - 1 ? prev + 1 : 0)
        } else if (distanceX < -60) {
            setSelectedDayIndex(prev => prev > 0 ? prev - 1 : weekDays.length - 1)
        }
        
        touchStartX.current = null
        touchStartY.current = null
    }

    // Recipe Integration
    const { manualMatches, bans, cards } = useRecipeManager()
    const [selectedRecipe, setSelectedRecipe] = useState<{ url: string, name: string } | null>(null)
    const [recipeDialogOpen, setRecipeDialogOpen] = useState(false)

    // Swap State
    // We need the WHOLE meal (slot) context for Main Dish detection
    const [swapSheetOpen, setSwapSheetOpen] = useState(false)
    const [foodToSwap, setFoodToSwap] = useState<{ mealId: string, food: DietFood, slotFoods?: DietFood[] } | null>(null)

    let globalFoodIdx = 0;
    const [smartSwapData, setSmartSwapData] = useState<{ isOpen: boolean, matchCount: number, slotName: string, newFood: any, oldFoodName: string, targetIds: string[], originalId: string | null, matchingCoords: any[] } | null>(null)
    // Store original custom food state before swapping (for revert)
    const [originalCustomFoods, setOriginalCustomFoods] = useState<Map<string, DietFood>>(new Map())
    const [dashboardTab, setDashboardTab] = useState<'daily' | 'weekly'>('daily')
    const [isDashboardVisible, setIsDashboardVisible] = useState(true)

    const [autoPlanEligibility, setAutoPlanEligibility] = useState<{
        isEligible: boolean;
        remainingCount: number | null;
        nextAvailableTime: Date | null;
        limitPeriodHours: number | null;
    }>({ isEligible: true, remainingCount: null, nextAvailableTime: null, limitPeriodHours: null })

    const resolveFoodTeamOwnerId = async (): Promise<string | null> => {
        if (!user?.id) return null
        const scope = await resolveTeamScopeContextForUser(user.id, {
            role: profile?.role || null,
            is_global_access: (profile as any)?.is_global_access === true
        })
        return scope.teamOwnerId
    }

    const checkAutoPlanEligibility = async (patientId: string, limitCount: number | null, limitHours: number | null) => {
        if (!patientId || !limitCount || !limitHours) {
            setAutoPlanEligibility({ isEligible: true, remainingCount: null, nextAvailableTime: null, limitPeriodHours: null })
            return
        }

        const timeThreshold = new Date(Date.now() - (limitHours * 60 * 60 * 1000)).toISOString()
        const { count, data, error } = await supabase
            .from('patient_activity_logs')
            .select('created_at', { count: 'exact', head: false })
            .eq('patient_id', patientId)
            .eq('action_type', 'auto_plan_generated')
            .gte('created_at', timeThreshold)
            .order('created_at', { ascending: true })

        if (error || count === null) {
            console.error("Error checking auto plan limit", error)
            setAutoPlanEligibility({ isEligible: true, remainingCount: null, nextAvailableTime: null, limitPeriodHours: null })
            return
        }

        const isEligible = count < limitCount
        let nextAvailableTime: Date | null = null
        if (!isEligible && data && data.length > 0) {
            const oldestLogTime = new Date(data[0].created_at).getTime()
            nextAvailableTime = new Date(oldestLogTime + (limitHours * 60 * 60 * 1000))
        }

        setAutoPlanEligibility({
            isEligible,
            remainingCount: Math.max(0, limitCount - count),
            nextAvailableTime,
            limitPeriodHours: limitHours
        })
    }

    // Patient Weight & Activity Edit State
    const [isWeightModalOpen, setIsWeightModalOpen] = useState(false)
    const [editWeight, setEditWeight] = useState<string>('')
    const [editActivity, setEditActivity] = useState<string>('3')
    const [measurementDefs, setMeasurementDefs] = useState<any[]>([])
    const [editMeasurements, setEditMeasurements] = useState<Record<string, string>>({})
    const [isSavingMeasurements, setIsSavingMeasurements] = useState(false)

    const capitalizeSentenceFirstTR = (value?: ReactNode) => {
        if (typeof value !== 'string') return value ?? ''
        const text = value.trim()
        if (!text) return ''
        return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1)
    }

    const openWeightModal = async () => {
        // Resolve Display Weight
        const displayWeight = (activeWeek?.weight_log !== undefined && activeWeek.weight_log !== -1)
            ? activeWeek.weight_log
            : patientInfo?.weight;

        // Resolve Display Activity
        const displayActivity = (activeWeek?.activity_level_log !== undefined && activeWeek.activity_level_log !== null)
            ? activeWeek.activity_level_log
            : (activeWeek?.activity_level || patientInfo?.activity_level || 3);

        setEditWeight((displayWeight || '').toString());
        setEditActivity(displayActivity.toString());

        // Fetch existing measurements for this week from patient_measurements
        if (activeWeek?.id && patientInfo?.id) {
            const { data } = await supabase
                .from('patient_measurements')
                .select('values')
                .eq('patient_id', patientInfo.id)
                .contains('values', { _diet_week_id: activeWeek.id })
                .maybeSingle();
            
            if (data?.values) {
                const measurements: Record<string, string> = {};
                Object.entries(data.values).forEach(([key, val]) => {
                    if (!key.startsWith('_')) {
                        measurements[key] = val?.toString() || '';
                    }
                });
                setEditMeasurements(measurements);
            } else {
                setEditMeasurements({});
            }
        }

        setIsWeightModalOpen(true)
    }

    const saveWeightActivity = async () => {
        if (!activeWeek?.id || !patientInfo?.id) return
        setIsSavingMeasurements(true)
        try {
            const weightVal = parseFloat(editWeight) || 0
            const activityVal = parseInt(editActivity) || 3

            // Prepare measurements object
            const measurementsToSave: Record<string, number> = {}
            Object.entries(editMeasurements).forEach(([id, val]) => {
                const num = parseFloat(val)
                if (!isNaN(num)) measurementsToSave[id] = num
            })

            const { success, errors } = await syncPatientWeightAndActivityAction(
                patientInfo.id,
                weightVal,
                activityVal,
                activeWeek.id,
                'Hasta',
                measurementsToSave,
                activeWeek.week_number
            )

            if (!success) throw new Error(errors.join(', '))
            
            setIsWeightModalOpen(false)
            setRefreshTrigger(prev => prev + 1)
            // Also update local patient info to keep UI in sync if needed, 
            // but refreshTrigger should handle it via re-fetch in parent.
        } catch (err: any) {
            console.error(err)
            await showAppModal('Hata', 'Kaydedilirken hata oluştu: ' + err.message, 'alert')
        } finally {
            setIsSavingMeasurements(false)
        }
    }

    // Lazy Initialization for Copied Weeks
    const [copiedWeekInitModalOpen, setCopiedWeekInitModalOpen] = useState(false)
    
    useEffect(() => {
        if (activeWeek && activeWeek.weight_log === -1 && !copiedWeekInitModalOpen) {
            setCopiedWeekInitModalOpen(true)
        }
    }, [activeWeek, copiedWeekInitModalOpen])

    const handleCopiedWeekInitSave = async (w: number, act: number) => {
        if (!activeWeek?.id) return
        try {
            const { error } = await supabase.from('diet_weeks').update({
                weight_log: w,
                activity_level_log: act
            }).eq('id', activeWeek.id)

            if (error) throw error
            activeWeek.weight_log = w
            activeWeek.activity_level_log = act
            setCopiedWeekInitModalOpen(false)
            setRefreshTrigger(prev => prev + 1)
        } catch (e: any) {
            console.error("Error setting copied week details", e)
            throw new Error('Hafta güncellenemedi.')
        }
    }

    // Auto-Plan & History States
    const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
    const [isApplyingPlan, setIsApplyingPlan] = useState(false)
    const [isPdfGenerating, setIsPdfGenerating] = useState(false)
    const [isTuneLoading, setIsTuneLoading] = useState(false)
    const [tuneLoadMode, setTuneLoadMode] = useState<'balance' | 'flavor'>('balance')
    const [tuneLoadScope, setTuneLoadScope] = useState<'daily' | 'weekly'>('weekly')
    const [tuneLoadStep, setTuneLoadStep] = useState<'analyzing' | 'applying'>('analyzing')
    const [tuneMessageIndex, setTuneMessageIndex] = useState(0)
    const [tuneProgress, setTuneProgress] = useState(8)
    const [tuneEtaSec, setTuneEtaSec] = useState<number | null>(null)
    const [tuneStepStartedAt, setTuneStepStartedAt] = useState(0)
    const [refreshTrigger, setRefreshTrigger] = useState(0)
    const [planningPhase, setPlanningPhase] = useState<'idle' | 'confirm' | 'planning' | 'success'>('idle')
    const [planningProgress, setPlanningProgress] = useState(0)
    const [pdfMessageIndex, setPdfMessageIndex] = useState(0)
    const pdfMessages = useMemo(() => {
        const weekNum = activeWeek?.week_number || 1
        const dietName = activeDietType?.name || 'Beslenme'
        const startDate = activeWeek?.start_date ? format(new Date(activeWeek.start_date), 'd MMMM', { locale: tr }) : '...'
        const endDate = activeWeek?.end_date ? format(new Date(activeWeek.end_date), 'd MMMM yyyy', { locale: tr }) : '...'
        
        return [
            `${weekNum}. Hafta (${dietName} Programı) verileriniz analiz ediliyor...`,
            `${startDate} - ${endDate} tarihlerini kapsayan listeniz hazırlanıyor...`,
            `Seçilen yemekler için interaktif tarif kartları eşleştiriliyor...`,
            `Vücut ölçümleriniz ve gelişim grafiği rapora işleniyor...`,
            `Size özel ${dietName} yönergeleri PDF dosyasına aktarılıyor...`,
            `Logo, yemek listesi ve tarifler son kontrolle birleştiriliyor...`
        ]
    }, [activeWeek, activeDietType])

    // PDF Message Cycle
    useEffect(() => {
        if (!isPdfGenerating) {
            setPdfMessageIndex(0)
            return
        }
        const timer = setInterval(() => {
            setPdfMessageIndex(prev => (prev + 1) % pdfMessages.length)
        }, 1800)
        return () => clearInterval(timer)
    }, [isPdfGenerating, pdfMessages])

    const planningMessages = useMemo(() => ([
        "Hasta bilgileri inceleniyor...",
        "Sağlık öyküsü ve kısıtlar kontrol ediliyor...",
        "Uyumsuz öğeler belirleniyor...",
        "Öğün kuralları hazırlanıyor...",
        "Sevilen/sevilmeyen tercihler uygulanıyor...",
        "Mevsim uygunluğu denetleniyor...",
        "Makro hedefler dengeleniyor...",
        "Alternatif kombinasyonlar değerlendiriliyor...",
        "Haftaya özel öğün dağılımı planlanıyor...",
        "Son kontroller yapılıyor..."
    ]), [])
    const [planningMessageIndex, setPlanningMessageIndex] = useState(0)
    const tuneMessages = useMemo(() => {
        if (tuneLoadStep === 'applying') {
            return [
                'Seçtiğiniz değişiklikler uygulanıyor...',
                'Öğün satırları güncelleniyor...',
                'Makro değerleri yeniden hesaplanıyor...',
                'Liste yenileniyor...'
            ]
        }
        if (tuneLoadMode === 'flavor') {
            return [
                'Lezzet uyumu analiz ediliyor...',
                'Öğün içi kombinasyonlar taranıyor...',
                'Kilitli öğeler kontrol ediliyor...',
                'En uygun değişiklikler hazırlanıyor...'
            ]
        }
        return [
            'Makro sapmaları analiz ediliyor...',
            'Dengeleme seçenekleri hesaplanıyor...',
            'Öğün limitleri kontrol ediliyor...',
            'Öneriler hazırlanıyor...'
        ]
    }, [tuneLoadMode, tuneLoadStep])

    useEffect(() => {
        if (!isTuneLoading) {
            setTuneMessageIndex(0)
            return
        }
        const timer = setInterval(() => {
            setTuneMessageIndex(prev => (prev + 1) % tuneMessages.length)
        }, 1300)
        return () => clearInterval(timer)
    }, [isTuneLoading, tuneMessages])

    useEffect(() => {
        if (!isTuneLoading) {
            setTuneProgress(8)
            setTuneEtaSec(null)
            return
        }

        const expectedMs = tuneLoadStep === 'analyzing'
            ? (
                tuneLoadMode === 'flavor'
                    ? (tuneLoadScope === 'weekly' ? 9000 : 6000)
                    : (tuneLoadScope === 'weekly' ? 7000 : 4500)
            )
            : (
                tuneLoadMode === 'flavor'
                    ? 5000
                    : 3500
            )

        const segStart = tuneLoadStep === 'analyzing' ? 8 : 72
        const segEnd = tuneLoadStep === 'analyzing' ? 72 : 96

        const tick = () => {
            const startedAt = tuneStepStartedAt || Date.now()
            const elapsed = Math.max(0, Date.now() - startedAt)
            const ratio = Math.min(1, elapsed / expectedMs)
            const nextProgress = segStart + ((segEnd - segStart) * ratio)
            setTuneProgress(nextProgress)
            const eta = Math.max(0, Math.ceil((expectedMs - elapsed) / 1000))
            setTuneEtaSec(eta)
        }

        tick()
        const intervalId = setInterval(tick, 250)
        return () => clearInterval(intervalId)
    }, [isTuneLoading, tuneLoadMode, tuneLoadScope, tuneLoadStep, tuneStepStartedAt])

    // Global Themed App Modal State (replaces alerts/confirms)
    type AppModalState = {
        isOpen: boolean;
        type: 'alert' | 'confirm' | 'success' | 'warning';
        title: string;
        message: React.ReactNode;
        resolve: ((val: boolean) => void) | null;
    }
    const [appModal, setAppModal] = useState<AppModalState>({ isOpen: false, type: 'alert', title: '', message: '', resolve: null });

    const showAppModal = (title: string, message: React.ReactNode, type: AppModalState['type'] = 'alert'): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setAppModal({ isOpen: true, type, title, message, resolve });
        });
    };

    // Balance Confirmation Modal State
    const [balanceModal, setBalanceModal] = useState<{
        isOpen: boolean;
        title: string;
        changes: BalanceChange[];
        initialTotals: { calories: number; protein: number; fat: number; carbs: number; };
        targetMacros: { calories: number; protein: number; fat: number; carbs: number; };
        macroDisplayDivisor: number;
        defaultSelectAll: boolean;
        resolve: ((approvedChanges: BalanceChange[] | null) => void) | null;
    }>({
        isOpen: false,
        title: '',
        changes: [],
        initialTotals: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        targetMacros: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        macroDisplayDivisor: 1,
        defaultSelectAll: false,
        resolve: null
    })

    const showBalanceModal = (
        title: string,
        changes: BalanceChange[],
        initialTotals: { calories: number; protein: number; fat: number; carbs: number; },
        targetMacros: { calories: number; protein: number; fat: number; carbs: number; },
        options?: { defaultSelectAll?: boolean; macroDisplayDivisor?: number }
    ): Promise<BalanceChange[] | null> => {
        return new Promise((resolve) => {
            setBalanceModal({
                isOpen: true,
                title,
                changes,
                initialTotals,
                targetMacros,
                macroDisplayDivisor: Math.max(1, Number(options?.macroDisplayDivisor || 1)),
                defaultSelectAll: Boolean(options?.defaultSelectAll),
                resolve
            })
        })
    }

    const plannerRef = useRef<Planner | null>(null)
    const plannerInitPromiseRef = useRef<Promise<Planner> | null>(null)
    const plannerKeyRef = useRef<string>('')

    useEffect(() => {
        plannerRef.current = null
        plannerInitPromiseRef.current = null
        plannerKeyRef.current = ''
    }, [patientInfo?.id, user?.id, activePlan?.patient_id])

    // Pre-warm planner in background to reduce first-click wait on auto-plan/balance flows.
    useEffect(() => {
        const pid = activePlan?.patient_id || patientInfo?.id
        const uid = user?.id
        if (!pid || !uid) return
        getPlannerInstance(pid, uid).catch(() => {
            // Keep UI responsive even if warm-up fails; normal flow will retry on demand.
        })
    }, [activePlan?.patient_id, patientInfo?.id, user?.id])

    async function getPlannerInstance(patientId: string, userId: string) {
        const cacheKey = `${patientId}:${userId}`
        if (plannerRef.current && plannerKeyRef.current === cacheKey) {
            return plannerRef.current
        }
        if (plannerInitPromiseRef.current && plannerKeyRef.current === cacheKey) {
            return plannerInitPromiseRef.current
        }

        const planner = new Planner(patientId, userId)
        plannerKeyRef.current = cacheKey
        plannerInitPromiseRef.current = planner.init().then(() => {
            plannerRef.current = planner
            return planner
        }).catch((err) => {
            plannerRef.current = null
            plannerInitPromiseRef.current = null
            plannerKeyRef.current = ''
            throw err
        })
        return plannerInitPromiseRef.current
    }

    // Foods database for adding new meals
    const [allFoods, setAllFoods] = useState<any[]>([])
    const [inlineSearchOpen, setInlineSearchOpen] = useState<string | null>(null)
    const [expandedFoodId, setExpandedFoodId] = useState<string | null>(null)
    const [isMealTemplateModalOpen, setIsMealTemplateModalOpen] = useState(false)
    const [isEditingWeek, setIsEditingWeek] = useState(false)
    const macroPrioritiesCacheRef = useRef<{
        patientId: string
        fetchedAt: number
        value: { protein: number; carb: number; fat: number }
    } | null>(null)

    // Animation sequences
    const [highlightSequence, setHighlightSequence] = useState<{ activeIndex: number, isActive: boolean }>({ activeIndex: -1, isActive: false })
    const [weekHighlight, setWeekHighlight] = useState(false)

    // Trigger initial highlights on mount
    useEffect(() => {
        setHighlightSequence({ activeIndex: 0, isActive: true })
    }, [])

    // Progress the meal highlight sequence (cascade)
    useEffect(() => {
        if (!highlightSequence.isActive || highlightSequence.activeIndex < 0) return

        const duration = highlightSequence.activeIndex === 0 ? 3000 : 2000
        const timer = setTimeout(() => {
            setHighlightSequence(prev => {
                if (prev.activeIndex >= 6) return { activeIndex: -1, isActive: false }
                return { activeIndex: prev.activeIndex + 1, isActive: true }
            })
        }, duration)

        return () => clearTimeout(timer)
    }, [highlightSequence])

    // Trigger week marker highlight when active week changes
    useEffect(() => {
        if (activeWeek?.id) {
            setWeekHighlight(true)
            const timer = setTimeout(() => setWeekHighlight(false), 3000)
            return () => clearTimeout(timer)
        }
    }, [activeWeek?.id])

    // Fetch Measurement Definitions for the modal
    useEffect(() => {
        const fetchDefs = async () => {
            if (!patientInfo?.id) return
            const { data } = await supabase
                .from('measurement_definitions')
                .select('*')
                .or(`patient_id.is.null,patient_id.eq.${patientInfo.id}`)
                .eq('is_active', true)
                .order('sort_order', { ascending: true })
            
            if (data) {
                // Remove Weight from body measurements display as it has its own field
                setMeasurementDefs(data.filter(d => 
                    !(d.name.toLowerCase().includes('kilo') || d.name.toLowerCase() === 'ağırlık')
                ))
            }
        }
        fetchDefs()
    }, [patientInfo?.id])

    // Initialize dashboard state from preferences
    useEffect(() => {
        if (patientInfo?.preferences?.is_dashboard_visible !== undefined) {
            setIsDashboardVisible(patientInfo.preferences.is_dashboard_visible)
        }
    }, [patientInfo?.preferences])

    const toggleDashboard = async () => {
        const newState = !isDashboardVisible
        setIsDashboardVisible(newState)

        // Save to DB
        if (patientInfo?.id) {
            const newPreferences = { ...patientInfo.preferences, is_dashboard_visible: newState }

            await supabase
                .from('patients')
                .update({ preferences: newPreferences })
                .eq('id', patientInfo.id)
        }
    }

    const initialFetchKeyRef = useRef<string>("")
    useEffect(() => {
        if (user) {
            const fetchKey = `${user.id}:${profile?.id || ""}:${refreshTrigger}`
            if (initialFetchKeyRef.current === fetchKey) return
            initialFetchKeyRef.current = fetchKey
            // Keep the currently active week focused when a refresh is triggered (background refresh)
            fetchActivePlan(activeWeek?.id, true)
        }
        // Exclude activeWeek?.id from deps to prevent loop, we only want to trigger on user/refresh
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, profile?.id, refreshTrigger])

    // Listen for FAB button trigger from layout
    const autoGenRef = useRef<() => void>(() => { })
    useEffect(() => {
        const handler = () => autoGenRef.current()
        window.addEventListener('trigger-autoplan', handler)
        return () => window.removeEventListener('trigger-autoplan', handler)
    }, [])

    // Keep loading experience lively while plan is generated
    useEffect(() => {
        if (planningPhase !== 'planning') {
            setPlanningMessageIndex(0)
            return
        }

        const messageTimer = setInterval(() => {
            setPlanningMessageIndex(prev => (prev + 1) % planningMessages.length)
        }, 1400)

        const progressTimer = setInterval(() => {
            setPlanningProgress(prev => {
                if (prev >= 94) return prev
                if (prev < 35) return Math.min(94, prev + 2)
                if (prev < 70) return Math.min(94, prev + 1.5)
                return Math.min(94, prev + 1)
            })
        }, 320)

        return () => {
            clearInterval(messageTimer)
            clearInterval(progressTimer)
        }
    }, [planningPhase, planningMessages])

    async function fetchActivePlan(targetWeekId?: string, isBackgroundRefresh: boolean = false) {
        let scopedPatientRecord: any = null

        try {
            if (!isBackgroundRefresh) setLoading(true)

            const targetId = profile?.id || user?.id
            console.log("[PatientPlan] Looking for patient with ID:", targetId)

            if (!targetId) return

            // Step 1: Find the patient record linked to this auth user
            // Priority 1: user_id match (legacy patients with added login - these have actual plans)
            // Priority 2: id match (new patients created via portal)

            let patientError = null

            // First try user_id match (legacy patients like HACER with existing plans)
            const { data: legacyMatch, error: legacyError } = await supabase
                .from('patients')
                .select(`
                    id, status, full_name, user_id, weight, activity_level, macro_target_mode, preferences, program_template_id, patient_goals, can_self_plan, visibility_settings, auto_plan_limit_count, auto_plan_limit_period_hours,
                    planning_rules (*),
                    program_templates (
                        id, name, default_activity_level,
                        program_template_weeks (week_start, week_end, diet_type_id),
                        program_template_restrictions (restriction_type, restriction_value, severity)
                    )
                `)
                .eq('user_id', targetId)
                .neq('id', targetId) // Exclude if id also matches (avoid duplicates)
                .limit(1)
                .maybeSingle()

            if (legacyMatch) {
                scopedPatientRecord = legacyMatch
                console.log("[PatientPlan] Found legacy patient via user_id:", scopedPatientRecord)
            } else {
                // Fallback: try id match (new patients)
                const { data: directMatch, error: directError } = await supabase
                    .from('patients')
                    .select(`
                        id, status, full_name, user_id, weight, activity_level, macro_target_mode, preferences, program_template_id, patient_goals, can_self_plan, visibility_settings, auto_plan_limit_count, auto_plan_limit_period_hours,
                        planning_rules (*),
                        program_templates (
                            id, name, default_activity_level,
                            program_template_weeks (week_start, week_end, diet_type_id),
                            program_template_restrictions (restriction_type, restriction_value, severity)
                        )
                    `)
                    .eq('id', targetId)
                    .maybeSingle()

                scopedPatientRecord = directMatch
                patientError = directError
                console.log("[PatientPlan] Found patient via id:", scopedPatientRecord)
            }

            console.log("[PatientPlan] Final patient record:", scopedPatientRecord, patientError)

            if (!scopedPatientRecord) {
                console.error("Patient record not found:", patientError)
                setError(`Hasta kaydınız bulunamadı. (Auth ID: ${user?.id?.substring(0, 8)}...)`)
                setLoading(false)
                return
            }

            const actualPatientId = scopedPatientRecord.id
            setPatientStatus(scopedPatientRecord.status)

            try {
                const brandingRes = await fetch('/api/patient/pdf-branding', { method: 'GET' })
                if (brandingRes.ok) {
                    const branding = await brandingRes.json()
                    if (branding?.logoUrl || branding?.footerText) {
                        setPdfBranding({
                            logoUrl: branding?.logoUrl || null,
                            footerText: branding?.footerText || null,
                        })
                    } else {
                        setPdfBranding(null)
                    }
                } else {
                    setPdfBranding(null)
                }
            } catch (brandingError) {
                console.warn('PDF branding fetch failed', brandingError)
                setPdfBranding(null)
            }

            // Save patient info immediately for targets & planner
            setPatientInfo({
                id: scopedPatientRecord.id,
                weight: scopedPatientRecord.weight,
                activity_level: scopedPatientRecord.activity_level,
                macro_target_mode: (scopedPatientRecord as any).macro_target_mode || 'calculated',
                preferences: scopedPatientRecord.preferences || {},
                program_template_id: (scopedPatientRecord as any).program_template_id,
                patient_goals: scopedPatientRecord.patient_goals || [],
                planning_rules: scopedPatientRecord.planning_rules || []
            })
            
            // Limit kontrolünü çağır
            await checkAutoPlanEligibility(actualPatientId, scopedPatientRecord.auto_plan_limit_count, scopedPatientRecord.auto_plan_limit_period_hours)


            // Step 2: Get Active Plan & Health Data using the actual patient ID
            const [
                { data: plan, error: planError },
                { data: pTypes },
                { data: diseasesData },
                { data: labsData },
                { data: patientMedsData }
            ] = await Promise.all([
                supabase
                    .from('diet_plans')
                    .select('*')
                    .eq('patient_id', actualPatientId)
                    .eq('status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle(),
                supabase
                    .from('diet_types')
                    .select('*')
                    .or(`patient_id.eq.${actualPatientId},patient_id.is.null`),
                supabase
                    .from('patient_diseases')
                    .select(`id, disease:diseases (id, name, disease_rules (id, rule_type, keywords, match_name, match_tags, keyword_metadata))`)
                    .eq('patient_id', actualPatientId),
                supabase
                    .from('patient_lab_results')
                    .select('*, micronutrients(id, name, unit, default_min, default_max, category, compatible_keywords, incompatible_keywords)')
                    .eq('patient_id', actualPatientId)
                    .order('measured_at', { ascending: false }),
                supabase
                    .from('patient_medications')
                    .select('medication_id')
                    .eq('patient_id', actualPatientId)
                    .is('ended_at', null)
            ])

            let effectiveDietTypes = pTypes || []
            if (effectiveDietTypes.length > 0) {
                const teamOwnerId = await resolveFoodTeamOwnerId()
                const programTemplateId =
                    (scopedPatientRecord as any).program_template_id ||
                    scopedPatientRecord?.program_templates?.id ||
                    null

                let globalTeamProgramMerged = await applyTeamDietTypeOverrides(
                    effectiveDietTypes.filter((dt: any) => !dt.patient_id),
                    teamOwnerId
                )
                if (programTemplateId) {
                    globalTeamProgramMerged = await applyProgramDietTypeOverrides(globalTeamProgramMerged, {
                        programTemplateId,
                        teamOwnerId
                    })
                }
                const patientSpecific = effectiveDietTypes.filter((dt: any) => !!dt.patient_id)
                effectiveDietTypes = [...globalTeamProgramMerged, ...patientSpecific]
            }

            // Process Diseases
            if (diseasesData) {
                const mapped = diseasesData.map((d: any) => d.disease).filter(Boolean)
                setPatientDiseases(mapped)
            }

            // Process Labs
            if (labsData) {
                const latestLabs: Record<string, any> = {}
                labsData.forEach((lab: any) => {
                    if (!latestLabs[lab.micronutrient_id]) latestLabs[lab.micronutrient_id] = lab
                })
                setPatientLabs(Object.values(latestLabs))
            }

            // Process Medication Rules
            if (patientMedsData && patientMedsData.length > 0) {
                const medIds = patientMedsData.map((pm: any) => pm.medication_id).filter(Boolean)
                if (medIds.length > 0) {
                    const { data: rules } = await supabase
                        .from('medication_interactions')
                        .select('*, medications(name)')
                        .in('medication_id', medIds)

                    if (rules) {
                        const enrichedRules = rules.map((rule: any) => ({
                            ...rule,
                            medication_name: rule.medications?.name
                        }))
                        setPatientMedicationRules(enrichedRules)
                    }
                }
            }

            if (planError || !plan) {
                // Fallback: try to fetch any plan
                console.log("No active plan found, trying to fetch any plan")
                const { data: anyPlan } = await supabase
                    .from('diet_plans')
                    .select('*')
                    .eq('patient_id', actualPatientId)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()

                if (anyPlan) {
                    await fetchAllWeeks(anyPlan.id, effectiveDietTypes)
                    setActivePlan(anyPlan)
                    return
                }

                // If completely no plan, auto-create a default one so patient can auto-plan
                console.log("No plan ever existed. Auto-creating a default plan for self-service.")

                // 1. Get default diet type from patient's program (Phase 1)
                let defaultTypeId = null;
                if (scopedPatientRecord.program_templates?.program_template_weeks?.length > 0) {
                    const sorted = [...scopedPatientRecord.program_templates.program_template_weeks].sort((a, b) => a.week_start - b.week_start);
                    defaultTypeId = sorted[0].diet_type_id;
                    console.log("Auto-plan using program diet_type:", defaultTypeId);
                }

                // Fallback
                if (!defaultTypeId) {
                    let { data: defaultType } = await supabase.from('diet_types').select('id').is('patient_id', null).ilike('name', '%low%').limit(1).maybeSingle();
                    if (!defaultType) {
                        const { data: fallback } = await supabase.from('diet_types').select('id').is('patient_id', null).limit(1).maybeSingle();
                        defaultType = fallback;
                    }
                    defaultTypeId = defaultType?.id || null;
                }

                // 2. Fetch default Planner Settings for slot configs
                let usedSettings: any = null;
                const progId = scopedPatientRecord.program_template_id;
                if (progId) {
                    const { data: progSet } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'program').eq('program_template_id', progId).maybeSingle();
                    if (progSet?.slot_config) usedSettings = progSet;
                }
                if (!usedSettings) {
                    const { data: globSet } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'global').maybeSingle();
                    usedSettings = globSet;
                }

                let slotConfigs = usedSettings?.slot_config || null;
                let mealTypes = usedSettings?.slot_config ? usedSettings.slot_config.map((c: any) => c.name) : ['KAHVALTI', 'ÖĞLE', 'AKŞAM', 'ARA ÖĞÜN'];

                const { data: newPlan, error: planInsertError } = await supabase
                    .from('diet_plans')
                    .insert({
                        patient_id: actualPatientId,
                        status: 'active',
                        title: 'Başlangıç Planı'
                    })
                    .select()
                    .single()

                if (planInsertError) {
                    console.error("Error inserting auto-plan:", planInsertError);
                    setError(`Plan oluşturulamadı: ${planInsertError.message}`);
                    setLoading(false);
                    return;
                }

                if (newPlan) {
                    const today = new Date();
                    const day = today.getDay();
                    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Get Monday
                    const monday = new Date(today.setDate(diff));
                    const nextWeek = new Date(monday);
                    nextWeek.setDate(nextWeek.getDate() + 6);

                    const { data: newWeek, error: weekInsertError } = await supabase.from('diet_weeks').insert({
                        diet_plan_id: newPlan.id, // Fixed: was plan_id
                        week_number: 1,
                        title: '1. Hafta (Başlangıç)',
                        start_date: monday.toISOString().split('T')[0],
                        end_date: nextWeek.toISOString().split('T')[0],
                        assigned_diet_type_id: defaultTypeId,
                        weight_log: scopedPatientRecord.weight,
                        activity_level_log: scopedPatientRecord.activity_level || 3,
                        slot_configs: slotConfigs,
                        meal_types: mealTypes
                    }).select().single()

                    if (weekInsertError || !newWeek) {
                        console.error("Error inserting auto-week:", weekInsertError);
                        setError(`Hafta oluşturulamadı: ${weekInsertError?.message}`);
                        setLoading(false);
                        return;
                    }

                    // --- Auto-generate 7 days for the new week ---
                    const daysToInsert = []
                    for (let i = 0; i < 7; i++) {
                        daysToInsert.push({
                            diet_week_id: newWeek.id,
                            day_number: i + 1,
                            notes: ''
                        })
                    }
                    await supabase.from('diet_days').insert(daysToInsert)

                    // Re-fetch everything cleanly, focusing on the new week
                    fetchActivePlan(newWeek.id)
                    return
                }

                setError("Beklenmeyen bir hata oluştu: Plan oluşturulamadı.")
                setLoading(false)
                return
            }

            setActivePlan(plan)


            if (effectiveDietTypes) {
                setDietTypesList(effectiveDietTypes)
                setPatientDietTypes(effectiveDietTypes.filter((d: any) => d.patient_id === actualPatientId))
            }

            // SET ACTIVE PROGRAM IF ANY (from nested fetch)
            let patientProgramData = null

            if (scopedPatientRecord.program_template_id) {
                const progResult = await getPublicProgramDetails(scopedPatientRecord.program_template_id)
                if (progResult?.data) {
                    patientProgramData = progResult.data
                    setPatientProgram(patientProgramData)
                } else if (scopedPatientRecord.program_templates) {
                    patientProgramData = scopedPatientRecord.program_templates
                    setPatientProgram(patientProgramData)
                }
            } else if (scopedPatientRecord.program_templates) {
                patientProgramData = scopedPatientRecord.program_templates
                setPatientProgram(patientProgramData)
            }

            await fetchAllWeeks(plan.id, effectiveDietTypes, patientProgramData, scopedPatientRecord, targetWeekId, isBackgroundRefresh)

        } catch (err) {
            console.error("Error fetching plan:", err)
            setError("Plan yüklenirken bir hata oluştu.")
            if (!isBackgroundRefresh) setLoading(false)
        }
    }


    async function fetchAllWeeks(planId: string, pDietTypes: any[] = [], pProgram: any = null, patientRecord: any = null, targetWeekId?: string, isBackgroundRefresh: boolean = false) { // Receive overrides & program
        const { data: weeks, error: weeksError } = await supabase
            .from('diet_weeks')
            .select(`
                *,
                diet_days(*),
                assigned_diet_type:diet_types!assigned_diet_type_id(*)
            `)
            .eq('diet_plan_id', planId)
            .order('week_number', { ascending: true })

        if (weeksError || !weeks || weeks.length === 0) {
            setError("Bu plana ait hafta bulunamadı.")
            if (!isBackgroundRefresh) setLoading(false)
            return
        }

        // --- DUPLICATE HANDLING (Fix for Double Week Issue) ---
        // Group by week_number to find duplicates
        const weekGroups = new Map<number, any[]>()
        weeks.forEach((w: any) => {
            if (!weekGroups.has(w.week_number)) weekGroups.set(w.week_number, [])
            weekGroups.get(w.week_number)?.push(w)
        })

        const uniqueWeeks: any[] = []

        weekGroups.forEach((duplicates, weekNum) => {
            if (duplicates.length === 1) {
                uniqueWeeks.push(duplicates[0])
            } else {
                console.warn(`[PatientPlan] Duplicate weeks found for week ${weekNum}:`, duplicates)
                console.log("[PatientPlan] Duplicate dump:", duplicates.map(d => ({
                    id: d.id,
                    created: d.created_at,
                    hasType: !!d.assigned_diet_type_id,
                    typeID: d.assigned_diet_type_id
                })))

                // Priority Strategy:
                // 1. Has Assigned Diet Type ID (MOST IMPORTANT)
                // 2. Created Last (Newest)

                duplicates.sort((a, b) => {
                    // Check Assigned Diet Type
                    const aHasType = !!a.assigned_diet_type_id
                    const bHasType = !!b.assigned_diet_type_id

                    if (aHasType && !bHasType) return -1 // a comes first
                    if (!aHasType && bHasType) return 1  // b comes first

                    // If both or neither, check created_at (Newest first)
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                })

                const bestWeek = duplicates[0]
                console.log(`[PatientPlan] Resolved duplicate week ${weekNum}. Selected ID: ${bestWeek.id} (hasType: ${!!bestWeek.assigned_diet_type_id})`)
                uniqueWeeks.push(bestWeek)
            }
        })

        // Use the CLEANED list for further processing
        const cleanWeeks = uniqueWeeks.sort((a, b) => a.week_number - b.week_number)
        // -----------------------------------------------------

        const vis = patientRecord?.visibility_settings || {}
        const allowPast = vis.allow_past ?? false
        const allowFuture = vis.allow_future ?? false
        const maxPastWeeks = vis.max_past_weeks ?? 2
        const maxFutureWeeks = vis.max_future_weeks ?? 2

        // Find Current Week index (for auto-selection)
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const todayStr = `${year}-${month}-${day}`

        // Find the focused week index
        let currentWeekIdx = -1
        let realCurrentIdx = cleanWeeks.findIndex((w: any) => {
            const start = w.start_date
            const end = w.end_date || new Date(new Date(start).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
            return todayStr >= start && todayStr <= end
        })

        if (realCurrentIdx !== -1) {
            setCurrentWeekId(cleanWeeks[realCurrentIdx].id)
            setCurrentWeekNumber(cleanWeeks[realCurrentIdx].week_number)
        }

        if (targetWeekId) {
            currentWeekIdx = cleanWeeks.findIndex(w => w.id === targetWeekId)
        }

        if (currentWeekIdx === -1) {
            currentWeekIdx = realCurrentIdx

            // If no exact match, find closest past week
            if (currentWeekIdx === -1) {
                // Find last week that has already started
                for (let i = cleanWeeks.length - 1; i >= 0; i--) {
                    if (cleanWeeks[i].start_date && cleanWeeks[i].start_date <= todayStr) {
                        currentWeekIdx = i
                        break
                    }
                }
                // If still not found, default to first week
                if (currentWeekIdx === -1) currentWeekIdx = 0
            }
        }

        let current = cleanWeeks[currentWeekIdx] || null

        // Apply visibility window
        let minIdx = 0
        let maxIdx = cleanWeeks.length - 1

        if (!allowPast) {
            minIdx = Math.max(0, currentWeekIdx - maxPastWeeks)
        }
        if (!allowFuture) {
            maxIdx = Math.min(cleanWeeks.length - 1, currentWeekIdx + maxFutureWeeks)
        }

        let finalWeeks = cleanWeeks.slice(minIdx, maxIdx + 1)
        if (finalWeeks.length === 0 && weeks.length > 0) {
            finalWeeks = [weeks[0]]
        }

        // If current not found in finalWeeks (e.g. today is Sunday, next week starts Monday), 
        // default to last available visible week.
        if (!current && finalWeeks.length > 0) {
            current = finalWeeks[finalWeeks.length - 1]
        }

        const sortedWeeks = finalWeeks.sort((a, b) => a.week_number - b.week_number)
        setTotalWeekCount(cleanWeeks.length) // Store REAL total before filtering
        setAllWeeks(sortedWeeks)

        if (current) {
            setActiveWeek(current)

            // Auto-Override Logic
            // ---------------------------------------------------------------------------
            // Priority: 
            // 1. WEEK_OVERRIDE rule (Highest Priority)
            // 2. Program Template Rule
            // 3. Specifically assigned on week
            // 4. Default Factors

            let selectedType: any = null;

            // 1. Try WEEK_OVERRIDE rule
            const weekOverrideRule = patientRecord.planning_rules?.find((r: any) =>
                r.rule_type === 'week_override' &&
                r.is_active &&
                current.week_number >= r.definition.data.week_start &&
                current.week_number <= r.definition.data.week_end
            )

            if (weekOverrideRule?.definition.data.diet_type_id) {
                selectedType = pDietTypes.find((d: any) => d.id === weekOverrideRule.definition.data.diet_type_id)
            }

            // 2. Try to get Diet Type from Program Template Rules
            if (!selectedType && pProgram && pProgram.program_template_weeks) {
                const rule = pProgram.program_template_weeks.find((pw: any) =>
                    current.week_number >= pw.week_start && current.week_number <= pw.week_end
                )
                if (rule?.diet_type_id) {
                    let progType = pDietTypes.find((d: any) => d.id === rule.diet_type_id)
                    if (!progType) {
                        const { data: globalType } = await supabase.from('diet_types').select('*').eq('id', rule.diet_type_id).maybeSingle()
                        if (globalType) {
                            const teamOwnerId = await resolveFoodTeamOwnerId()
                            const [effectiveGlobalType] = await applyTeamDietTypeOverrides([globalType], teamOwnerId)
                            let baseGlobalType = effectiveGlobalType || globalType
                            if (pProgram?.id) {
                                const [programScopedType] = await applyProgramDietTypeOverrides([baseGlobalType], {
                                    programTemplateId: pProgram.id,
                                    teamOwnerId
                                })
                                baseGlobalType = programScopedType || baseGlobalType
                            }
                            const override = pDietTypes.find((d: any) => d.parent_diet_type_id === baseGlobalType.id)
                            progType = override || baseGlobalType
                        }
                    }
                    if (progType) {
                        console.log("[PatientPlan] Program priority match via template rule:", progType.name)
                        selectedType = progType
                    }
                }
            }

            // 3. If NO higher priority matches, use the specifically assigned diet type on the week
            if (!selectedType) {
                selectedType = current.assigned_diet_type || current.diet_types
                if (Array.isArray(selectedType)) {
                    selectedType = selectedType[0]
                }
                if (selectedType && !selectedType.patient_id) {
                    const override = pDietTypes.find((d: any) => d.parent_diet_type_id === selectedType.id)
                    if (override) {
                        console.log("[PatientPlan] Auto-override applied:", selectedType.name, "->", override.name)
                        selectedType = override
                    }
                }
                if (!selectedType && current.assigned_diet_type_id) {
                    const directPrivate = pDietTypes.find((d: any) => d.id === current.assigned_diet_type_id)
                    if (directPrivate) {
                        console.log("[PatientPlan] Direct private diet type via ID:", directPrivate.name)
                        selectedType = directPrivate
                    }
                }
            }

            // Removed redundant NO diet type check as it was folded into step 1.

            // 3.5. [PATIENT-SPECIFIC FALLBACK] If no type found yet, use patient's custom diet type
            // This mirrors the Admin Panel's dropdown default behavior
            if (!selectedType && pDietTypes?.length > 0) {
                // pDietTypes contains diet types WHERE patient_id = this patient
                // Use the first one as the patient's "default" diet type
                selectedType = pDietTypes[0]
                if (selectedType) {
                    console.log("[PatientPlan] Patient-specific diet type found:", selectedType.name)
                }
            }

            // 4. [FINAL FALLBACK] If still no type, use DEFAULT factors (Admin Logic Mirror)
            // Admin Panel uses: C:3.0, P:1.0, F:0.8 if no type is found.
            if (!selectedType) {
                console.log("[PatientPlan] Default diet type fallback applied")
                selectedType = {
                    id: 'default-fallback',
                    name: 'Genel (Varsayılan)',
                    carb_factor: 3.0,
                    protein_factor: 1.0,
                    fat_factor: 0.8,
                    is_default: true // Custom flag for debug
                }
            }

            if (selectedType) {
                setActiveDietType(selectedType)
            }
            // 5. [NEW] PRE-FETCH SLOT SETTINGS TO PREVENT UI GLITCHES ON STALE WEEKS
            let resolvedMealTypes = current.meal_types;

            // If the week doesn't have meal_types cached or it's empty, fetch the true active settings dynamically
            if (!resolvedMealTypes || resolvedMealTypes.length === 0) {
                let usedSettings: any = null
                // a. Patient Settings
                const { data: patientSettings } = await supabase.from('planner_settings').select('slot_config').eq('patient_id', patientRecord?.id).maybeSingle()
                if (patientSettings?.slot_config) usedSettings = patientSettings

                // b. Program Settings
                if (!usedSettings && pProgram) {
                    const { data: programSettings } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'program').eq('program_template_id', pProgram.id).maybeSingle()
                    if (programSettings?.slot_config) usedSettings = programSettings
                }

                // c. Global Settings
                if (!usedSettings) {
                    const { data: globalSettings } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'global').maybeSingle()
                    if (globalSettings?.slot_config) usedSettings = globalSettings
                }

                if (usedSettings?.slot_config && Array.isArray(usedSettings.slot_config)) {
                    resolvedMealTypes = usedSettings.slot_config.map((c: any) => c.name || c.mealType)
                } else {
                    resolvedMealTypes = ['KAHVALTI', 'ÖĞLE', 'AKŞAM', 'ARA ÖĞÜN']; // Final absolute fallback
                }

                // Self-Heal the database week seamlessly
                await supabase.from('diet_weeks').update({ meal_types: resolvedMealTypes }).eq('id', current.id);
            }

            // ---------------------------------------------------------------------------
            // Pass fresh instances to avoid state race condition
            await fetchWeekDays(current.id, patientRecord, selectedType, resolvedMealTypes)
        } else {
            if (!isBackgroundRefresh) setLoading(false)
        }
    }

    async function fetchWeekDays(weekId: string, customPatientInfo?: any, customDietType?: any, customMealTypes?: string[]) {
        // 3. Get Days and Meals
        // Schema: diet_meals has food_id -> foods, not a separate diet_foods table
        // Use foods!food_id to specify which FK to use (there's also original_food_id)
        const { data: days, error: daysError } = await supabase
            .from('diet_days')
            .select(`
                id,
                        day_number,
                        notes,
                        diet_meals(
                            id,
                            created_at,
                            meal_time,
                            sort_order,
                            portion_multiplier,
                            custom_name,
                            custom_notes,
                            calories,
                            protein,
                            carbs,
                            fat,
                            is_custom,
                            is_consumed,
                            consumed_at,
                            food_id,
                            original_food_id,
                            swapped_by,
                            foods!food_id(
                                id,
                                name,
                                calories,
                                protein,
                                carbs,
                                fat,
                                portion_unit,
                                standard_amount,
                                role,
                                compatibility_tags,
                                category,
                                keto,
                                lowcarb,
                                vegan,
                                vejeteryan,
                                meal_types,
                                meta,
                                min_quantity,
                                max_quantity,
                                step,
                                portion_fixed,
                                max_weekly_freq,
                                priority_score,
                                tags,
                                season_start, season_end
                            ),
                            original_foods: foods!original_food_id(
                                id,
                                name,
                                calories,
                                protein,
                                carbs,
                                fat
                            )
                        ),
                        diet_notes(
                            id,
                            content,
                            is_locked,
                            sort_order
                        )
                            `)
            .eq('diet_week_id', weekId)
            .order('day_number', { ascending: true })
            .order('sort_order', { referencedTable: 'diet_meals', ascending: true })

        // DEBUG logs intentionally minimized for performance and clean console output

        // DEBUG: Check first meal of first day to see if foods are joined
        // first meal debug log removed

        if (daysError) {
            console.error("Days error", daysError)
            setError("Günler yüklenemedi: " + daysError.message)
            setLoading(false)
            return
        }

        let currentDays = days

        // AUTO-REPAIR: If week exists but has no days (e.g. from a past interrupted creation), create them now
        if (currentDays && currentDays.length === 0) {
            console.log("[PatientPlan] Week has no days. Starting auto-repair...")
            const weekRecord = allWeeks.find((w: any) => w.id === weekId);
            if (weekRecord?.start_date) {
                const daysToInsert = [];
                for (let i = 0; i < 7; i++) {
                    daysToInsert.push({
                        diet_week_id: weekId,
                        day_number: i + 1,
                        notes: ''
                    });
                }
                try {
                    const { data: newDays, error: insertError } = await supabase.from('diet_days').insert(daysToInsert).select();
                    if (insertError) {
                        console.error("Otomatik onarım başarısız (Supabase hatası):", insertError);
                        alert(`Günler oluşturulamadı: ${insertError.message}`);
                    } else if (newDays) {
                        // Re-fetch cleanly to get all relations (diet_meals arrays etc.)
                        console.log("[PatientPlan] Auto-repair done. Reloading week days...")
                        await fetchWeekDays(weekId, customPatientInfo, customDietType, customMealTypes);
                        return; // Stop execution here, the recursive call handles the rest
                    }
                } catch (err: any) {
                    console.error("Otomatik onarım sırasında beklenmeyen hata:", err);
                    alert(`Günler eklenirken hata: ${err.message}`);
                }
            }
        }

        if (currentDays) {
            // MANUAL JOIN FALLBACK:
            // If DB join failed (RLS issues etc), manually fetch foods and attach them
            const missingFoodIds = new Set<string>()
            currentDays.forEach((day: any) => {
                day.diet_meals?.forEach((meal: any) => {
                    // Check if foods is missing OR if foods exists but has no nutrition data (e.g. only name loaded)
                    const isFoodMissing = !meal.foods
                    const isNutritionMissing = meal.foods && (meal.foods.calories === undefined || meal.foods.calories === null)

                    if ((isFoodMissing || isNutritionMissing) && meal.food_id) {
                        missingFoodIds.add(meal.food_id)
                    }
                })
            })

            let foodMap = new Map<string, any>()
            if (missingFoodIds.size > 0) {
                console.log("[PatientPlan] Missing foods detected, fetching manually:", missingFoodIds.size)
                const { data: manualFoods } = await supabase
                    .from('foods')
                    .select('id, name, calories, protein, carbs, fat, portion_unit, standard_amount, role, category, keto, lowcarb, vegan, vejeteryan, compatibility_tags, meal_types, min_quantity, max_quantity, step, portion_fixed, max_weekly_freq, priority_score, tags, season_start, season_end')
                    .in('id', Array.from(missingFoodIds))

                if (manualFoods) {
                    const teamOwnerId = await resolveFoodTeamOwnerId()
                    const scopedFoods = await applyTeamFoodOverrides(manualFoods, teamOwnerId)
                    const effectiveFoods = await applyTeamFoodMicronutrientOverrides(scopedFoods, teamOwnerId)
                    effectiveFoods.forEach(f => foodMap.set(f.id, f))
                }
            }

            // Transform data to display format
            const sortedDays = currentDays.map((day: any) => {
                // Group meals by meal_time (e.g., "KAHVALTI", "ÖĞLE", "AKŞAM")
                const mealsByType = new Map<string, any[]>()

                // PRE-FILL with week's default meal types or the dynamically resolved ones
                const defaultMeals = customMealTypes || (allWeeks.find(w => w.id === weekId)?.meal_types || ['KAHVALTI', 'ÖĞLE', 'AKŞAM', 'ARA ÖĞÜN']);
                defaultMeals.forEach((m: string) => mealsByType.set(m, []));

                // HEAL EXISTING UI GHOST SLOTS (e.g. if 'ÖĞLE' and 'ÖĞLEN' both exist but 'ÖĞLE' is empty)
                // We will do this after parsing all meals.

                let totalCalories = 0
                let totalProtein = 0
                let totalCarbs = 0
                let totalFats = 0

                // Sort meals by sort_order first, then created_at, then id (Matching Admin Logic)
                const dayMeals = (day.diet_meals || []).sort((a: any, b: any) => {
                    const diff = (a.sort_order || 0) - (b.sort_order || 0)
                    if (diff !== 0) return diff
                    // created_at fallback
                    const dateDiff = (a.created_at || '').localeCompare(b.created_at || '')
                    if (dateDiff !== 0) return dateDiff
                    // id fallback
                    return (a.id || '').localeCompare(b.id || '')
                })

                for (const meal of dayMeals) {
                    // Apply manual join if needed
                    const isFoodMissing = !meal.foods
                    const isNutritionMissing = meal.foods && (meal.foods.calories === undefined || meal.foods.calories === null)

                    if ((isFoodMissing || isNutritionMissing) && meal.food_id) {
                        const manualFood = foodMap.get(meal.food_id)
                        if (manualFood) {
                            meal.foods = manualFood
                        }
                    }

                    const mealType = meal.meal_time || 'DİĞER'
                    if (!mealsByType.has(mealType)) {
                        mealsByType.set(mealType, [])
                    }

                    // Get food info from foods table or custom fields
                    const foodName = meal.is_custom
                        ? meal.custom_name
                        : (meal.foods?.name || 'Bilinmeyen Öğün')

                    // PRIORITY: 1. Meal Overrides (from sheet or manual), 2. Food Base Macros
                    // FIX: If meal overrides are 0 (and not custom), fallback to food macros
                    // This handles cases where DB has 0 for override columns instead of null
                    const hasZeroOverride = !meal.is_custom && (meal.protein === 0 || meal.protein === null) && (meal.calories === 0 || meal.calories === null)

                    const multiplier = Number(meal.portion_multiplier) || 1

                    const protein = (meal.protein !== null && !hasZeroOverride) ? (Number(meal.protein) || 0) : ((Number(meal.foods?.protein) || 0) * multiplier)
                    const carbs = (meal.carbs !== null && !hasZeroOverride) ? (Number(meal.carbs) || 0) : ((Number(meal.foods?.carbs) || 0) * multiplier)
                    const fats = (meal.fat !== null && !hasZeroOverride) ? (Number(meal.fat) || 0) : ((Number(meal.foods?.fat) || 0) * multiplier)

                    const calculatedCals = Math.round((protein * 4) + (carbs * 4) + (fats * 9))
                    const calories = (meal.calories !== null && !hasZeroOverride) ? (Number(meal.calories) || calculatedCals) : calculatedCals

                    if (meal.is_consumed) {
                        totalCalories += calories
                        totalProtein += protein
                        totalCarbs += carbs
                        totalFats += fats
                    }

                    // TARGET MACROS: Use ORIGINAL food only if PATIENT swapped
                    // - Dietitian swaps become the "original" for patient (use current foods)
                    // - Patient swaps: use original_foods to show deviation from dietitian's plan
                    const isPatientSwap = meal.swapped_by === 'patient' && meal.original_foods
                    const targetFood = isPatientSwap ? meal.original_foods : meal.foods

                    // For target calculation, use meal-level overrides (set by dietitian) first,
                    // then fall back to food DB values. This ensures target = what dietitian set.
                    const targetMultiplier = meal.portion_multiplier || 1

                    // If patient swapped: use original food's base macros (no meal override applies)
                    // If NOT patient swapped: use meal overrides if set, else food DB values
                    let tProtein: number, tCarbs: number, tFats: number, tCalories: number

                    if (isPatientSwap) {
                        // Patient swap: target is based on ORIGINAL food's macros
                        tProtein = (Number(targetFood?.protein) || 0) * targetMultiplier
                        tCarbs = (Number(targetFood?.carbs) || 0) * targetMultiplier
                        tFats = (Number(targetFood?.fat) || 0) * targetMultiplier
                        tCalories = (Number(targetFood?.calories) || 0) * targetMultiplier || Math.round((tProtein * 4) + (tCarbs * 4) + (tFats * 9))
                    } else {
                        // No patient swap: target = what's displayed = meal overrides or food DB
                        // This matches lines 984-987 exactly (same priority as display values)
                        tProtein = (meal.protein !== null ? Number(meal.protein) : (Number(meal.foods?.protein) || 0)) * targetMultiplier
                        tCarbs = (meal.carbs !== null ? Number(meal.carbs) : (Number(meal.foods?.carbs) || 0)) * targetMultiplier
                        tFats = (meal.fat !== null ? Number(meal.fat) : (Number(meal.foods?.fat) || 0)) * targetMultiplier
                        tCalories = meal.calories !== null ? Number(meal.calories) * targetMultiplier : Math.round((tProtein * 4) + (tCarbs * 4) + (tFats * 9))
                    }
                    // Final fallback: use current display calories if still 0
                    if (!tCalories && calories > 0) tCalories = calories

                    mealsByType.get(mealType)!.push({
                        id: meal.id,
                        food_name: foodName,
                        amount: Number(meal.portion_multiplier) || 1,
                        unit: meal.foods?.portion_unit || 'porsiyon',
                        calories: calories,
                        protein: protein,
                        carbs: carbs,
                        fats: fats,
                        target_calories: tCalories,
                        target_protein: tProtein,
                        target_carbs: tCarbs,
                        target_fat: tFats,
                        fixed_calories: tCalories, // FORCE FRESH PROPERTY
                        fixed_protein: tProtein,
                        fixed_carbs: tCarbs,
                        fixed_fat: tFats,
                        standard_amount: meal.foods?.standard_amount || 100,
                        real_food_id: meal.food_id, // Changed from meal.foods?.id
                        original_food_id: meal.original_food_id,
                        swapped_by: meal.swapped_by, // Added
                        role: meal.foods?.role,
                        compatibility_tags: meal.foods?.compatibility_tags,
                        category: meal.foods?.category,
                        keto: meal.foods?.keto,
                        lowcarb: meal.foods?.lowcarb,
                        vegan: meal.foods?.vegan,
                        vejeteryan: meal.foods?.vejeteryan,
                        meal_types: meal.foods?.meal_types,
                        is_consumed: meal.is_consumed,
                        consumed_at: meal.consumed_at,
                        is_custom: meal.is_custom,
                        food_meta: meal.foods?.meta,
                        min_quantity: meal.foods?.min_quantity,
                        max_quantity: meal.foods?.max_quantity,
                        step: meal.foods?.step,
                        portion_fixed: meal.foods?.portion_fixed,
                        custom_notes: meal.custom_notes
                    })
                }

                // HEAL EXISTING UI GHOST SLOTS
                // If a day has real DB meals under "ÖĞLEN", and "ÖĞLE" is empty, remove the empty "ÖĞLE" (stale fallback ghost)
                if (mealsByType.has('ÖĞLEN') && mealsByType.get('ÖĞLEN')!.length > 0) {
                    if (mealsByType.has('ÖĞLE') && mealsByType.get('ÖĞLE')!.length === 0) {
                        mealsByType.delete('ÖĞLE');
                    }
                }

                // If a day has real DB meals under "ARA ÖĞÜN 1" or "ARA ÖĞÜN 2", and "ARA ÖĞÜN" is empty, remove the generic empty one
                const hasSpecificSnack = (mealsByType.has('ARA ÖĞÜN 1') && mealsByType.get('ARA ÖĞÜN 1')!.length > 0) ||
                    (mealsByType.has('ARA ÖĞÜN 2') && mealsByType.get('ARA ÖĞÜN 2')!.length > 0) ||
                    (mealsByType.has('ARA ÖĞÜN 3') && mealsByType.get('ARA ÖĞÜN 3')!.length > 0);
                if (hasSpecificSnack && mealsByType.has('ARA ÖĞÜN') && mealsByType.get('ARA ÖĞÜN')!.length === 0) {
                    mealsByType.delete('ARA ÖĞÜN');
                }

                // Convert to display format
                const mealOrder = ['KAHVALTI', 'ARA ÖĞÜN', 'ARA ÖĞÜN 1', 'ÖĞLE', 'ÖĞLEN', 'ARA ÖĞÜN 2', 'AKŞAM', 'GECEGECİ', 'GECE', 'ARA ÖĞÜN 3', 'DİĞER']
                const diet_meals = Array.from(mealsByType.entries())
                    .sort((a, b) => mealOrder.indexOf(a[0]) - mealOrder.indexOf(b[0]))
                    .map(([mealType, foods], idx) => ({
                        id: `${day.id} - ${mealType}`,
                        meal_name: mealType.charAt(0) + mealType.slice(1).toLowerCase(),
                        meal_time: mealType, // Keep original uppercase for DB operations
                        time: mealType === 'KAHVALTI' ? '08:00' :
                            mealType.includes('ÖĞLE') ? '12:30' :
                                mealType === 'AKŞAM' ? '19:00' :
                                    mealType === 'ARA ÖĞÜN' ? '10:30' : '15:00',
                        diet_foods: foods.map(f => ({
                            ...f,
                            // Ensure target_calories propagates
                            target_calories: f.target_calories
                        }))
                    }))

                // Generate Turkish day name from day_number
                const dayNames = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
                const dayName = dayNames[(day.day_number - 1) % 7] || `${day.day_number}.Gün`

                // Calculate targets dynamically if needed
                const dayTarget = calculateDailyTargets(
                    (customPatientInfo || patientInfo)?.weight || 70,
                    (customPatientInfo || patientInfo)?.activity_level || 3,
                    (customDietType || activeDietType),
                    (customPatientInfo || patientInfo)?.patient_goals
                )

                return {
                    id: day.id,
                    day_name: dayName,
                    order: day.day_number,
                    notes: day.notes,
                    diet_notes: day.diet_notes || [],
                    total_calories: Math.round(totalCalories),
                    total_protein: Math.round(totalProtein),
                    total_carbs: Math.round(totalCarbs),
                    total_fat: Math.round(totalFats),
                    target_calories: dayTarget?.calories,
                    target_protein: dayTarget?.protein,
                    target_carbs: dayTarget?.carb,
                    target_fat: dayTarget?.fat,
                    diet_meals
                }
            })

            setWeekDays(sortedDays)

            // Only auto-select today on the very first load
            if (!initialDaySelected.current && sortedDays.length > 0) {
                const todayName = new Date().toLocaleDateString('tr-TR', { weekday: 'long' })
                const todayIndex = sortedDays.findIndex(d => d.day_name.toLowerCase() === todayName.toLowerCase())
                if (todayIndex >= 0) setSelectedDayIndex(todayIndex)
                initialDaySelected.current = true
            }
        }

        setLoading(false)
    }

    const currentDay = weekDays[selectedDayIndex]

    const activeWeekIndex = allWeeks.findIndex(w => w.id === activeWeek?.id)

    // Listen for custom trigger-daily-balance event since handleDailyBalance isn't passed as a prop
    // This MUST be called at the top-level of the component to obey Rules of Hooks
    useEffect(() => {
        const handleCustomBalanceTrigger = () => {
            handleDailyBalance()
        }
        const handleCustomDailyFlavorTrigger = () => {
            handleAutoBalance('flavor', selectedDayIndex + 1)
        }
        const handleCustomWeeklyBalanceTrigger = () => {
            handleAutoBalance()
        }
        const handleCustomWeeklyFlavorTrigger = () => {
            handleAutoBalance('flavor')
        }
        window.addEventListener('trigger-daily-balance', handleCustomBalanceTrigger)
        window.addEventListener('trigger-daily-flavor', handleCustomDailyFlavorTrigger)
        window.addEventListener('trigger-weekly-balance', handleCustomWeeklyBalanceTrigger)
        window.addEventListener('trigger-weekly-flavor', handleCustomWeeklyFlavorTrigger)
        return () => {
            window.removeEventListener('trigger-daily-balance', handleCustomBalanceTrigger)
            window.removeEventListener('trigger-daily-flavor', handleCustomDailyFlavorTrigger)
            window.removeEventListener('trigger-weekly-balance', handleCustomWeeklyBalanceTrigger)
            window.removeEventListener('trigger-weekly-flavor', handleCustomWeeklyFlavorTrigger)
        }
    }, [patientInfo, currentDay, originalCustomFoods, activeWeek, selectedDayIndex]) // Removed dailyTargets from dep array since it's computed in render
    // Handler for Swap Click
    const handleSwapClick = (mealId: string, food: DietFood, slotFoods: DietFood[]) => {
        // mealId here is the SLOT ID (e.g. "dayId-Ogle")
        // food.id is the diet_meals ID (DB Row)
        setFoodToSwap({ mealId, food, slotFoods })
        setSwapSheetOpen(true)
    }

    // Handler for Swap Confirm (Real DB Update)
    const handleSwapConfirm = async (newFood: any) => {
        if (!foodToSwap) return

        const isRevert = newFood.id === foodToSwap.food.original_food_id
        const originalId = isRevert ? null : (foodToSwap.food.original_food_id || foodToSwap.food.real_food_id)

        // --- SMART SWAP LOGIC ---
        // 1. Identify Context
        const currentFoodId = foodToSwap.food.real_food_id
        const currentFoodName = foodToSwap.food.food_name

        // 2. Find ALL Matches - Match same food across ALL meal types
        // IMPORTANT: Skip null food_id matching (custom/photo foods should swap individually)
        let matchingFoodIds: string[] = []
        let matchingCoords: { dayIndex: number, slotIndex: number, foodIndex: number }[] = []

        if (currentFoodId) {
            // Normal food: find all instances across the week
            weekDays.forEach((d, dIdx) => {
                d.diet_meals.forEach((slot: any, sIdx: number) => {
                    slot.diet_foods.forEach((f: any, fIdx: number) => {
                        if (f.real_food_id === currentFoodId) {
                            matchingFoodIds.push(f.id)
                            matchingCoords.push({ dayIndex: dIdx, slotIndex: sIdx, foodIndex: fIdx })
                        }
                    })
                })
            })
        } else {
            // Custom/photo food (no food_id): only match this specific item
            matchingFoodIds = [foodToSwap.food.id]
            // Find coords for this specific food
            weekDays.forEach((d, dIdx) => {
                d.diet_meals.forEach((slot: any, sIdx: number) => {
                    slot.diet_foods.forEach((f: any, fIdx: number) => {
                        if (f.id === foodToSwap.food.id) {
                            matchingCoords.push({ dayIndex: dIdx, slotIndex: sIdx, foodIndex: fIdx })
                        }
                    })
                })
            })
        }

        const otherMatches = matchingFoodIds.filter(id => id !== foodToSwap.food.id)

        // If there are other matches, show SmartSwapDialog
        if (otherMatches.length > 0) {
            setSmartSwapData({
                isOpen: true,
                matchCount: matchingFoodIds.length,
                slotName: 'Tüm Öğünler',  // Now matches across all meal types
                newFood: newFood,
                oldFoodName: (foodToSwap.food as any).real_food_name || (foodToSwap.food as any).name || (foodToSwap.food as any).food_name || 'Bu yemek',
                targetIds: matchingFoodIds,
                originalId: originalId ?? null,
                matchingCoords: matchingCoords
            })
            return // Stop here, wait for dialog
        }

        // No other matches, just swap this one
        executeSwap([foodToSwap.food.id], newFood, originalId ?? null, matchingCoords.filter(c => weekDays[c.dayIndex].diet_meals[c.slotIndex].diet_foods[c.foodIndex].id === foodToSwap.food.id))
    }

    const executeSwap = async (targetIds: string[], newFood: any, originalId: string | null, coordsToUpdate: { dayIndex: number, slotIndex: number, foodIndex: number }[]) => {
        if (!foodToSwap) return
        const isRevert = newFood.id === foodToSwap.food.original_food_id
        // ------------------------

        let backupNotesStr: string | null = null;
        try {
            const existingNotes = typeof (foodToSwap.food as any).custom_notes === 'string'
                ? JSON.parse((foodToSwap.food as any).custom_notes)
                : ((foodToSwap.food as any).custom_notes || {});

            const origMult = existingNotes._orig_mult !== undefined
                ? existingNotes._orig_mult
                : (foodToSwap.food.amount || foodToSwap.food.portion_multiplier || 1);

            const backupObj: any = {
                ...existingNotes,
                _orig_mult: origMult
            };

            if (foodToSwap.food.is_custom) {
                backupObj._is_backup = true;
                backupObj.food_name = foodToSwap.food.food_name;
                backupObj.calories = foodToSwap.food.calories;
                backupObj.protein = foodToSwap.food.protein;
                backupObj.carbs = foodToSwap.food.carbs;
                backupObj.fat = foodToSwap.food.fats || (foodToSwap.food as any).fat || 0;
            }

            backupNotesStr = JSON.stringify(backupObj);
        } catch (e) {
            console.error("Backup notes parse error", e)
        }

        // Save original custom food state before swapping (for revert)
        const newCustomFoodMap = new Map(originalCustomFoods)
        coordsToUpdate.forEach(coord => {
            const day = weekDays[coord.dayIndex]
            if (day) {
                const mealSlot = day.diet_meals[coord.slotIndex]
                if (mealSlot) {
                    const oldFood = mealSlot.diet_foods[coord.foodIndex]
                    if (oldFood.is_custom && !newCustomFoodMap.has(oldFood.id)) {
                        // Store the original custom food state for revert
                        newCustomFoodMap.set(oldFood.id, { ...oldFood })
                    }
                }
            }
        })
        setOriginalCustomFoods(newCustomFoodMap)

        // 1. Optimistic UI Update
        const updatedDays = [...weekDays]

        coordsToUpdate.forEach(coord => {
            const day = updatedDays[coord.dayIndex]
            if (day) {
                const mealSlot = day.diet_meals[coord.slotIndex]
                if (mealSlot) {
                    const oldFood = mealSlot.diet_foods[coord.foodIndex]
                    mealSlot.diet_foods[coord.foodIndex] = {
                        ...oldFood,
                        real_food_id: newFood.id,
                        food_name: newFood.name,
                        original_food_id: originalId ?? undefined,
                        calories: newFood.calories,
                        protein: newFood.protein,
                        carbs: newFood.carbs,
                        fats: newFood.fat || newFood.fats || 0,
                        amount: newFood.portion_multiplier || 1,
                        portion_multiplier: newFood.portion_multiplier || 1,
                        swapped_by: isRevert ? null : 'patient',
                        is_custom: false,       // Alternative food = not custom
                        food_meta: undefined,    // Clear user_proposal meta
                        custom_notes: backupNotesStr, // Preserve original custom metadata as backup
                        _was_custom: oldFood.is_custom ? true : undefined, // Track for revert button
                    } as any
                }
            }
        })

        setWeekDays(updatedDays)
        setSwapSheetOpen(false)
        setSmartSwapData(null)

        // 2. Update Database
        const { error } = await supabase
            .from('diet_meals')
            .update({
                food_id: newFood.id,
                original_food_id: originalId,
                // Reset overrides when swapping
                calories: null,
                protein: null,
                carbs: null,
                fat: null,
                is_custom: false,
                custom_name: null,
                custom_notes: backupNotesStr,
                portion_multiplier: newFood.portion_multiplier || 1,
                swapped_by: isRevert ? null : 'patient'
            })
            .in('id', targetIds)

        if (error) {
            alert("Değişiklik kaydedilemedi: " + error.message)
            // Rollback on error
            fetchWeekDays(activeWeek.id)
            return
        }

        setFoodToSwap(null)
    }

    const handleSmartSwapConfirm = (applyToAll: boolean) => {
        if (!smartSwapData || !foodToSwap) return
        const targets = applyToAll ? smartSwapData.targetIds : [foodToSwap.food.id]
        const coordsToUpdate = applyToAll
            ? smartSwapData.matchingCoords
            : smartSwapData.matchingCoords.filter((c: any) => weekDays[c.dayIndex].diet_meals[c.slotIndex].diet_foods[c.foodIndex].id === foodToSwap.food.id)
        executeSwap(targets, smartSwapData.newFood, smartSwapData.originalId, coordsToUpdate)
    }

    const handleRevert = async (mealSlotId: string, dietFood: DietFood) => {
        // Check if this was originally a custom/photo food
        let originalCustom = originalCustomFoods.get(dietFood.id)

        if (!originalCustom && (dietFood as any).custom_notes) {
            try {
                const notes = typeof (dietFood as any).custom_notes === 'string' ? JSON.parse((dietFood as any).custom_notes) : (dietFood as any).custom_notes;
                if (notes._is_backup) {
                    originalCustom = {
                        food_name: notes.food_name,
                        calories: notes.calories,
                        protein: notes.protein,
                        carbs: notes.carbs,
                        fats: notes.fat,
                        custom_notes: notes.custom_notes
                    } as any;
                }
            } catch (e) { }
        }

        if (originalCustom) {
            // Revert to custom/photo food
            let finalNotes = null;
            if ((originalCustom as any).custom_notes && Object.keys((originalCustom as any).custom_notes).length > 0) {
                finalNotes = typeof (originalCustom as any).custom_notes === 'string' ? (originalCustom as any).custom_notes : JSON.stringify((originalCustom as any).custom_notes);
            }

            const { error } = await supabase
                .from('diet_meals')
                .update({
                    food_id: null,
                    original_food_id: null,
                    swapped_by: null, // Reset so it doesn't show the "swapped" UI
                    is_custom: true,
                    custom_name: originalCustom.food_name,
                    calories: originalCustom.calories,
                    protein: originalCustom.protein,
                    carbs: originalCustom.carbs,
                    fat: originalCustom.fats || (originalCustom as any).fat || 0,
                    custom_notes: finalNotes,
                    is_consumed: originalCustom.is_consumed ?? true,
                    consumed_at: originalCustom.consumed_at || new Date().toISOString(),
                })
                .eq('id', dietFood.id)

            if (error) {
                alert("Geri alma işlemi başarısız: " + error.message)
            } else {
                // Remove from tracked custom foods
                const newMap = new Map(originalCustomFoods)
                newMap.delete(dietFood.id)
                setOriginalCustomFoods(newMap)
                await fetchWeekDays(activeWeek.id)
            }
            return
        }

        // Normal revert: go back to original food_id
        if (!dietFood.original_food_id) return

        let origMult = 1;
        let finalNotes = null;
        try {
            if ((dietFood as any).custom_notes) {
                const notes = typeof (dietFood as any).custom_notes === 'string'
                    ? JSON.parse((dietFood as any).custom_notes)
                    : (dietFood as any).custom_notes;

                if (notes._orig_mult !== undefined) {
                    origMult = notes._orig_mult;
                }

                // Keep other notes but remove backup/swap metadata
                delete notes._orig_mult;
                delete notes._is_backup;
                delete notes.food_name;

                if (Object.keys(notes).length > 0) {
                    finalNotes = JSON.stringify(notes);
                }
            }
        } catch (e) { }

        const { error } = await supabase
            .from('diet_meals')
            .update({
                food_id: dietFood.original_food_id,
                original_food_id: null,
                swapped_by: null,
                // Reset overrides
                calories: null,
                protein: null,
                carbs: null,
                fat: null,
                is_custom: false,
                custom_name: null,
                portion_multiplier: origMult,
                custom_notes: finalNotes
            })
            .eq('id', dietFood.id)

        if (error) {
            alert("Geri alma işlemi başarısız: " + error.message)
        } else {
            await fetchWeekDays(activeWeek.id)
        }
    }

    const toggleMealConsumed = async (mealId: string, currentStatus: boolean) => {
        const { error } = await supabase
            .from('diet_meals')
            .update({
                is_consumed: !currentStatus,
                consumed_at: !currentStatus ? new Date().toISOString() : null
            })
            .eq('id', mealId)

        if (error) {
            alert("Hata: " + error.message)
        } else {
            // Refresh
            await fetchWeekDays(activeWeek.id)
        }
    }

    // Toggle all foods in the current day as consumed/not consumed
    const toggleAllDayConsumed = async (markAsConsumed: boolean) => {
        if (!currentDay) return
        const allFoodIds = currentDay.diet_meals.flatMap(m => m.diet_foods.map(f => f.id))
        if (allFoodIds.length === 0) return

        const { error } = await supabase
            .from('diet_meals')
            .update({
                is_consumed: markAsConsumed,
                consumed_at: markAsConsumed ? new Date().toISOString() : null
            })
            .in('id', allFoodIds)

        if (error) {
            alert("Hata: " + error.message)
        } else {
            await fetchWeekDays(activeWeek.id)
        }
    }

    // Fetch all foods for the add meal dialog
    const fetchFoods = async () => {
        if (allFoods.length > 0) return // Already fetched

        const teamOwnerId = await resolveFoodTeamOwnerId()
        const { data, error } = await supabase
            .from('foods')
            .select('id, name, calories, protein, carbs, fat, vejeteryan, meal_types, tags, compatibility_tags, min_quantity, max_quantity, step, portion_fixed, max_weekly_freq, priority_score, season_start, season_end')
            .order('name')

        if (error) {
            console.error('Foods fetch error:', error)
            // Try without order as fallback
            const { data: fallbackData, error: fallbackError } = await supabase
                .from('foods')
                .select('id, name, calories, protein, carbs, fat, vejeteryan, meal_types, tags, compatibility_tags, min_quantity, max_quantity, step, portion_fixed, max_weekly_freq, priority_score, season_start, season_end')

            if (fallbackData && !fallbackError) {
                const scopedFallbackFoods = await applyTeamFoodOverrides(fallbackData, teamOwnerId)
                const effectiveFallbackFoods = await applyTeamFoodMicronutrientOverrides(scopedFallbackFoods, teamOwnerId)
                setAllFoods(effectiveFallbackFoods.sort((a, b) => a.name.localeCompare(b.name, 'tr')))
            } else {
                console.error('Foods fallback fetch error:', fallbackError)
            }
        } else if (data) {
            const scopedFoods = await applyTeamFoodOverrides(data, teamOwnerId)
            const effectiveFoods = await applyTeamFoodMicronutrientOverrides(scopedFoods, teamOwnerId)
            setAllFoods(effectiveFoods)
        }
    }


    // Delete a meal
    const handleDeleteMeal = async (mealId: string) => {
        if (!confirm('Bu yemeği silmek istediğinize emin misiniz?')) return
        try {
            const { error } = await supabase.from('diet_meals').delete().eq('id', mealId)
            if (error) throw error
            if (activeWeek) await fetchWeekDays(activeWeek.id)
        } catch (e: any) {
            console.error("Delete error:", e)
            alert('Hata: ' + e.message)
        }
    }

    const handleWeekChange = async (weekId: string) => {
        const week = allWeeks.find(w => w.id === weekId)
        if (!week) return

        setActiveWeek(week)
        setLoading(true)

        // RE-RUN DIET DETERMINATION LOGIC
        // ---------------------------------------------------------------------------
        let selectedType = week.assigned_diet_type

        // 1. If we have a joined Type, checks if it needs Override
        if (selectedType && !selectedType.patient_id) {
            const override = patientDietTypes.find((d: any) => d.parent_diet_type_id === selectedType.id)
            if (override) {
                selectedType = override
            }
        }

        // 2. [FALLBACK] If joined type is NULL, but we have an ID
        if (!selectedType && week.assigned_diet_type_id) {
            const directPrivate = patientDietTypes.find((d: any) => d.id === week.assigned_diet_type_id)
            if (directPrivate) {
                selectedType = directPrivate
            }
        }

        // 3. [NEW FALLBACK] If NO diet type on Week, use PROGRAM rules
        if (!selectedType && !week.assigned_diet_type_id && patientProgram && patientProgram.program_template_weeks) {
            const rule = patientProgram.program_template_weeks.find((pw: any) =>
                week.week_number >= pw.week_start && week.week_number <= pw.week_end
            )

            if (rule?.diet_type_id) {
                let progType = patientDietTypes.find((d: any) => d.id === rule.diet_type_id)

                if (!progType) {
                    const { data: globalType } = await supabase
                        .from('diet_types')
                        .select('*')
                        .eq('id', rule.diet_type_id)
                        .maybeSingle()

                    if (globalType) {
                        const teamOwnerId = await resolveFoodTeamOwnerId()
                        const [effectiveGlobalType] = await applyTeamDietTypeOverrides([globalType], teamOwnerId)
                        let baseGlobalType = effectiveGlobalType || globalType
                        if (patientInfo?.program_template_id) {
                            const [programScopedType] = await applyProgramDietTypeOverrides([baseGlobalType], {
                                programTemplateId: patientInfo.program_template_id,
                                teamOwnerId
                            })
                            baseGlobalType = programScopedType || baseGlobalType
                        }
                        const override = patientDietTypes.find((d: any) => d.parent_diet_type_id === baseGlobalType.id)
                        progType = override || baseGlobalType
                    }
                }

                if (progType) {
                    selectedType = progType
                }
            }
        }

        setActiveDietType(selectedType || null) // Reset to null if not found (defaults to 1558 logic but at least consistent)
        // ---------------------------------------------------------------------------

        await fetchWeekDays(week.id)
        setLoading(false)
    }

    const dailyTargets = (() => {
        if (patientInfo?.macro_target_mode === 'plan' && currentDay) {
            console.log("[PatientPlan] Using PLAN mode targets for day:", currentDay.day_name)
            // FIX: Use target_* values (based on ORIGINAL foods) for targets, not current foods
            // This ensures swapped foods don't change the target
            const planTotals = currentDay.diet_meals.reduce((acc, m) => {
                return m.diet_foods.reduce((accInner, f) => {
                    // Use target values if available (original food macros), fallback to current
                    const cals = Number((f as any).target_calories) || Number((f as any).calories) || 0
                    const prot = Number((f as any).target_protein) || Number((f as any).protein) || 0
                    const carb = Number((f as any).target_carbs) || Number((f as any).carbs) || 0
                    const fat = Number((f as any).target_fats || (f as any).target_fat) || Number((f as any).fats || (f as any).fat) || 0

                    return {
                        calories: accInner.calories + cals,
                        protein: accInner.protein + prot,
                        carbs: accInner.carbs + carb,
                        fat: accInner.fat + fat
                    }
                }, acc)
            }, { calories: 0, protein: 0, carbs: 0, fat: 0 })

            return planTotals
        }

        // Mode 2: Calculated Targets (Formula)
        if (patientInfo?.weight) {
            // Priority: Week Log > Patient Profile (Ignore -1 magic flag)
            const effectiveWeight = (activeWeek?.weight_log && activeWeek.weight_log !== -1) ? activeWeek.weight_log : patientInfo.weight
            const effectiveActivity = (activeWeek?.activity_level_log && activeWeek?.activity_level_log !== null) 
                ? activeWeek.activity_level_log 
                : (activeWeek?.activity_level || patientInfo.activity_level || 3)

            return calculateDailyTargets(
                effectiveWeight,
                effectiveActivity,
                activeDietType,
                patientInfo?.patient_goals
            )
        }
        return null
    })()

    const dailyTotals = (() => {
        if (!currentDay) return { calories: 0, protein: 0, carbs: 0, fat: 0 }

        const res = currentDay.diet_meals.reduce((acc, m) => {
            return m.diet_foods.reduce((accInner, f) => {
                if (!f.is_consumed) return accInner
                return {
                    calories: accInner.calories + ((Number(f.calories) || 0) * (f.amount || f.portion_multiplier || 1)),
                    protein: accInner.protein + ((Number(f.protein) || 0) * (f.amount || f.portion_multiplier || 1)),
                    carbs: accInner.carbs + ((Number(f.carbs) || 0) * (f.amount || f.portion_multiplier || 1)),
                    fat: accInner.fat + ((Number(f.fat || (f as any).fats) || 0) * (f.amount || f.portion_multiplier || 1))
                }
            }, acc)
        }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
        return res
    })()

    if (loading) {
        return (
            <div className="relative min-h-screen w-full overflow-hidden bg-slate-950">
                <img
                    src="/kapak-lite.jpg"
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-slate-900/35 via-slate-900/35 to-slate-950/55" />
                <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/25 bg-slate-900/45 px-5 py-3 text-sm text-white shadow-xl backdrop-blur-md">
                        <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
                        <span>Plan verileri yukleniyor...</span>
                    </div>
                </div>
            </div>
        )
    }

    if (error) {
        const canSelfPlan = patientInfo?.can_self_plan === true

        return (
            <div className="flex flex-col h-full bg-gradient-to-b from-gray-50 to-white min-h-screen p-4 pb-24 items-center">
                {/* Hero Card */}
                <div className="max-w-md w-full mt-8">
                    <div className={cn(
                        "rounded-2xl overflow-hidden shadow-xl",
                        canSelfPlan
                            ? "bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500"
                            : "bg-red-50 border border-red-200"
                    )}>
                        <div className="p-8 text-center">
                            {canSelfPlan ? (
                                <>
                                    <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm mb-4 mx-auto">
                                        <Wand2 className="h-10 w-10 text-white animate-pulse" />
                                        <span className="absolute inset-0 rounded-full animate-ping bg-white/10" style={{ animationDuration: '2s' }} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-2">Diyet Planınız Hazır Değil</h3>
                                    <p className="text-white/80 text-sm mb-6">Diyetisyeninizin belirlediği kurallara göre otomatik olarak haftalık planınız oluşturulacak</p>
                                    <Button
                                        className="bg-white text-purple-700 hover:bg-white/90 w-full py-6 text-lg font-bold rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.02] active:scale-95"
                                        onClick={handleCreatePlanAndWeek}
                                        disabled={isApplyingPlan}
                                    >
                                        {isApplyingPlan ? <RefreshCw className="h-5 w-5 animate-spin mr-2" /> : <Wand2 className="h-5 w-5 mr-2" />}
                                        ✨ İlk Planını Oluştur
                                    </Button>
                                </>
                            ) : (
                                <div className="py-4">
                                    <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-3" />
                                    <p className="text-center text-red-700 font-medium">{error}</p>
                                    <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">
                                        Tekrar Dene
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Feature Tips - Only show for self-plan users */}
                    {canSelfPlan && (
                        <div className="mt-6 space-y-3">
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider text-center mb-2">Neler yapabilirsiniz?</p>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center mb-2">
                                        <Scale className="h-4 w-4 text-amber-600" />
                                    </div>
                                    <p className="text-xs font-semibold text-gray-700">Dengeleme</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">Hedef makrolara yaklaşmak için otomatik ayarlama</p>
                                </div>
                                <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center mb-2">
                                        <RefreshCw className="h-4 w-4 text-blue-600" />
                                    </div>
                                    <p className="text-xs font-semibold text-gray-700">Yemek Değiştir</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">Beğenmediğiniz yemekleri alternatiflerle değiştirin</p>
                                </div>
                                <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center mb-2">
                                        <Camera className="h-4 w-4 text-green-600" />
                                    </div>
                                    <p className="text-xs font-semibold text-gray-700">Fotoğraf Ekle</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">Fotoğraflarla öğünlerinize yemek ekleyin</p>
                                </div>
                                <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center mb-2">
                                        <X className="h-4 w-4 text-red-600" />
                                    </div>
                                    <p className="text-xs font-semibold text-gray-700">Tik Kaldır</p>
                                    <p className="text-[10px] text-gray-400 mt-0.5">İstemediğiniz yemeklerin tikini kaldırıp kalori ayarlayın</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    const weeklyTotals = (() => {
        if (!weekDays || weekDays.length === 0) return { calories: 0, protein: 0, carbs: 0, fat: 0 }
        let c = 0, p = 0, k = 0, f = 0, count = 0
        weekDays.forEach((d: any) => {
            const meals = d.diet_meals || []
            if (meals.length > 0) {
                let dayC = 0, dayP = 0, dayK = 0, dayF = 0
                let hasConsumed = false
                meals.forEach((m: any) => {
                    m.diet_foods.forEach((food: any) => {
                        if (food.is_consumed) {
                            dayC += (Number(food.calories) || 0) * (food.amount || food.portion_multiplier || 1)
                            dayP += (Number(food.protein) || 0) * (food.amount || food.portion_multiplier || 1)
                            dayK += (Number(food.carbs) || 0) * (food.amount || food.portion_multiplier || 1)
                            dayF += (Number(food.fat || (food as any).fats) || 0) * (food.amount || food.portion_multiplier || 1)
                            hasConsumed = true
                        }
                    })
                })
                if (hasConsumed) {
                    c += dayC; p += dayP; k += dayK; f += dayF; count++
                }
            }
        })
        if (count === 0) return { calories: 0, protein: 0, carbs: 0, fat: 0 }
        return {
            calories: Math.round(c / count),
            protein: Math.round(p / count),
            carbs: Math.round(k / count),
            fat: Math.round(f / count)
        }
    })()



    // --- AUTO-PLAN & HISTORY HANDLERS ---

    // Keep ref updated for FAB event listener
    autoGenRef.current = () => handleAutoGenerate()

    async function handleAutoGenerate() {
        if (!user || !patientInfo) {
            console.warn("[handleAutoGenerate] Early exit: missing user/patient context.");
            return;
        }

        if (!autoPlanEligibility.isEligible && autoPlanEligibility.nextAvailableTime) {
            const timeDiff = autoPlanEligibility.nextAvailableTime.getTime() - Date.now();
            const hours = Math.floor(timeDiff / (1000 * 60 * 60));
            const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
            let timeStr = '';
            if (hours > 0) timeStr += `${hours} saat `;
            timeStr += `${minutes} dakika`;
            
            await showAppModal('Limit Doldu', `Otomatik plan oluşturma limitinize ulaştınız.\n\nYeni plan hakkınız ${timeStr} sonra yenilenecektir.`, 'warning');
            return;
        }

        if (!activeWeek?.id || !activePlan?.patient_id) {
            console.log("[PatientPlan] Active week missing, creating...");
            await handleCreatePlanAndWeek();
        }

        // Show custom confirmation modal
        setPlanningPhase('confirm')
    }

    async function executeAutoGenerate() {
        if (!activeWeek?.id || !activePlan?.patient_id || !user || !patientInfo) return
        const plannerPatientId = activePlan?.patient_id || patientInfo?.id
        if (!plannerPatientId) return

        const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
        const perfStartedAt = perfNow()
        const perfSteps: Array<{ name: string; ms: number }> = []
        const perfMark = (name: string, started: number) => {
            perfSteps.push({ name, ms: perfNow() - started })
        }

        setPlanningPhase('planning')
        setPlanningProgress(0)
        setIsGeneratingPlan(true)
        try {
            let t = perfNow()
            const planner = await getPlannerInstance(plannerPatientId, user.id)
            perfMark('planner_instance', t)
            setPlanningProgress(10)

            const startDate = activeWeek.start_date ? new Date(activeWeek.start_date) : new Date()

            // Fetch Global/Program Settings for Slot Config
            // Fallback to defaults if not found
            let slotConfigs = [
                { id: "kahvalti", time: "08:00", mealType: "KAHVALTI", is_active: true },
                { id: "ara-1", time: "10:30", mealType: "ARA ÖĞÜN", is_active: true },
                { id: "ogle", time: "12:30", mealType: "ÖĞLE", is_active: true },
                { id: "ara-2", time: "15:30", mealType: "ARA ÖĞÜN", is_active: true },
                { id: "aksam", time: "19:00", mealType: "AKŞAM", is_active: true }
            ]

            // Fetch settings hierarchically: Patient > Program > Global
            let usedSettings: any = null

            // 1. Patient Settings
            t = perfNow()
            const { data: patientSettings } = await supabase
                .from('planner_settings')
                .select('slot_config')
                .eq('patient_id', activePlan.patient_id)
                .maybeSingle()
            perfMark('settings_patient_slot_config', t)
            if (patientSettings?.slot_config) usedSettings = patientSettings

            // 2. Program Settings
            if (!usedSettings) {
                const progId = patientInfo?.program_template_id
                if (progId) {
                    t = perfNow()
                    const { data: programSettings } = await supabase
                        .from('planner_settings')
                        .select('slot_config')
                        .eq('scope', 'program')
                        .eq('program_template_id', progId)
                        .maybeSingle()
                    perfMark('settings_program_slot_config', t)
                    if (programSettings?.slot_config) usedSettings = programSettings
                }
            }

            // 3. Global Settings
            if (!usedSettings) {
                t = perfNow()
                const { data: globalSettings } = await supabase
                    .from('planner_settings')
                    .select('slot_config')
                    .eq('scope', 'global')
                    .maybeSingle()
                perfMark('settings_global_slot_config', t)
                if (globalSettings?.slot_config) usedSettings = globalSettings
            }

            if (usedSettings?.slot_config) {
                slotConfigs = usedSettings.slot_config
            }

            let weekMealTypes = activeWeek?.meal_types || ['KAHVALTI', 'ÖĞLE', 'AKŞAM', 'ARA ÖĞÜN']
            if (usedSettings?.slot_config && Array.isArray(usedSettings.slot_config)) {
                weekMealTypes = usedSettings.slot_config.map((c: any) => c.name || c.mealType)
            }

            // Get diet type using the same resolution logic as the header display
            let resolvedDietType: any = null

            // 0. Try PATIENT SPECIFIC RULE override (Highest priority)
            const patientOverride = patientInfo?.planning_rules?.find((r: any) =>
                r.rule_type === 'week_override' &&
                activeWeek?.week_number &&
                r.definition?.week_start <= activeWeek?.week_number &&
                r.definition?.week_end >= activeWeek?.week_number
            )

            if (patientOverride && patientOverride.definition?.diet_type_id) {
                resolvedDietType = dietTypesList.find(d => d.id === patientOverride.definition.diet_type_id)
            }

            // 1. Try program template fallback
            if (!resolvedDietType && patientProgram?.program_template_weeks && activeWeek) {
                const rule = patientProgram.program_template_weeks.find((pw: any) =>
                    activeWeek.week_number >= pw.week_start && activeWeek.week_number <= pw.week_end
                )
                if (rule?.diet_type_id) {
                    resolvedDietType = dietTypesList.find(d => d.id === rule.diet_type_id)
                }
            }

            // 2. Try explicit assignment on the week
            if (!resolvedDietType && activeWeek?.assigned_diet_type_id) {
                resolvedDietType = dietTypesList.find(d => d.id === activeWeek.assigned_diet_type_id)
            }

            // 3. AUTO-OVERRIDE
            if (resolvedDietType && !resolvedDietType.patient_id) {
                const specificOverride = dietTypesList.find(d => d.patient_id === patientInfo.id && d.parent_diet_type_id === resolvedDietType.id)
                if (specificOverride) resolvedDietType = specificOverride
            }

            // HEAL STATE: Update DB to match dynamically resolved arrays
            const nextAssignedDietTypeId = resolvedDietType?.id || null
            const mealTypesChanged = JSON.stringify(activeWeek?.meal_types || []) !== JSON.stringify(weekMealTypes || [])
            const assignedDietTypeChanged = (activeWeek?.assigned_diet_type_id || null) !== nextAssignedDietTypeId
            if (mealTypesChanged || assignedDietTypeChanged) {
                t = perfNow()
                await supabase.from('diet_weeks').update({
                    meal_types: weekMealTypes,
                    assigned_diet_type_id: nextAssignedDietTypeId
                }).eq('id', activeWeek?.id)
                perfMark('update_week_settings', t)
            }
            setPlanningProgress(30)

            // 4. Get factors from resolved diet type
            const dietTypeFactors = resolvedDietType ? {
                carb_factor: resolvedDietType.carb_factor,
                protein_factor: resolvedDietType.protein_factor,
                fat_factor: resolvedDietType.fat_factor
            } : null

            // Use week weight_log or patient weight
            const currentWeight = (activeWeek?.weight_log !== undefined && activeWeek.weight_log !== -1 ? activeWeek.weight_log as number : null) || (patientInfo as any)?.weight_log || (patientInfo as any)?.weight || 70
            const activityLevel = (activeWeek?.activity_level_log !== undefined && activeWeek.activity_level_log !== null ? activeWeek.activity_level_log as number : null) || (patientInfo as any)?.activity_level || 3

            // Calculate actual targets using the formula
            const calculated = calculateDailyTargets(currentWeight, activityLevel, dietTypeFactors || undefined, patientInfo?.patient_goals)
            const targetMacros = calculated ? {
                calories: calculated.calories,
                protein: calculated.protein,
                carbs: calculated.carb,
                fat: calculated.fat
            } : { calories: 1800, protein: 90, carbs: 180, fat: 60 }

            // 5. Get banned tags from program template restrictions
            const programBannedTags = patientProgram?.program_template_restrictions
                ?.filter((r: any) => r.restriction_type === 'banned_tag')
                .map((r: any) => r.restriction_value) || []

            // â”€â”€ CROSS-WEEK ROTATION: Collect food usage from other weeks â”€â”€
            const historicalFoodCounts = new Map<string, number>()
            if (activeWeek?.id && activePlan?.id) {
                t = perfNow()
                const { data: otherWeeks } = await supabase
                    .from('diet_weeks')
                    .select('id')
                    .eq('diet_plan_id', activePlan.id)
                    .neq('id', activeWeek.id)
                perfMark('history_fetch_other_weeks', t)
                if (otherWeeks && otherWeeks.length > 0) {
                    const otherWeekIds = otherWeeks.map(w => w.id)
                    t = perfNow()
                    const { data: otherDays } = await supabase
                        .from('diet_days')
                        .select('id')
                        .in('diet_week_id', otherWeekIds)
                    perfMark('history_fetch_other_days', t)
                    if (otherDays && otherDays.length > 0) {
                        const otherDayIds = otherDays.map(d => d.id)
                        t = perfNow()
                        const { data: otherMeals } = await supabase
                            .from('diet_meals')
                            .select('food_id')
                            .in('diet_day_id', otherDayIds)
                        perfMark('history_fetch_other_meals', t)
                        if (otherMeals) {
                            for (const m of otherMeals) {
                                if (m.food_id) {
                                    historicalFoodCounts.set(m.food_id, (historicalFoodCounts.get(m.food_id) || 0) + 1)
                                }
                            }
                        }
                    }
                }
            }

            // Generate
            t = perfNow()
            const plan = await planner.generateWeeklyPlan(
                startDate,
                weekMealTypes,
                slotConfigs,
                targetMacros,
                resolvedDietType, // Pass full object for tag support
                programBannedTags,
                historicalFoodCounts,
                activeWeek?.week_number || 1 // Week number for scope_weeks filtering
            )
            perfMark('planner_generate_weekly_plan', t)

            // Direct Apply for Patient
            t = perfNow()
            await handleApplyAutoPlan(plan)
            perfMark('apply_auto_plan', t)

        } catch (err: any) {
            console.error(err)
            alert("Plan oluşturma hatası: " + err.message)
        } finally {
            const totalMs = perfNow() - perfStartedAt
            const slowest = [...perfSteps].sort((a, b) => b.ms - a.ms).slice(0, 3)
            console.info('[executeAutoGenerate] total_ms=', Math.round(totalMs))
            if (slowest.length > 0) {
                console.table(slowest.map((s) => ({ step: s.name, ms: Math.round(s.ms) })))
            }
            setIsGeneratingPlan(false)
        }
    }

    async function handleApplyAutoPlan(planToUse: any) {
        if (!planToUse || !activeWeek?.id) return
        setIsApplyingPlan(true)

        try {
            const { data: days } = await supabase.from('diet_days')
                .select('id, day_number')
                .eq('diet_week_id', activeWeek.id)
                .order('day_number')

            if (!days || days.length === 0) throw new Error("Günler bulunamadı")

            const inserts: any[] = []

            for (const meal of planToUse.meals) {
                const targetDay = days[meal.day - 1]
                if (!targetDay) continue

                inserts.push({
                    diet_day_id: targetDay.id,
                    food_id: meal.food.id,
                    meal_time: meal.slot,
                    is_custom: false,
                    calories: meal.food.calories || 0,
                    protein: meal.food.protein || 0,
                    carbs: meal.food.carbs || 0,
                    fat: meal.food.fat || 0,
                    portion_multiplier: meal.portion_multiplier || 1,
                    is_consumed: true,
                    consumed_at: new Date().toISOString()
                })
            }

            if (inserts.length > 0) {
                const dayIds = days.map((d: any) => d.id)

                // 1. SNAPSHOT (Backup) - only fetch heavy payload if week currently has meals.
                if (dayIds.length > 0) {
                    const { count: existingMealCount } = await supabase
                        .from('diet_meals')
                        .select('id', { count: 'exact', head: true })
                        .in('diet_day_id', dayIds)

                    if ((existingMealCount || 0) > 0) {
                        const { data: currentDays } = await supabase
                            .from('diet_days')
                            .select('*, diet_meals(*)')
                            .eq('diet_week_id', activeWeek.id)

                        if (currentDays && currentDays.some((d: any) => d.diet_meals.length > 0)) {
                            await supabase.from('diet_snapshots').insert({
                                diet_week_id: activeWeek.id,
                                snapshot_data: currentDays,
                                description: `Auto-Plan Overwrite - ${new Date().toLocaleString('tr-TR')}`
                            })
                        }
                    }
                }

                // 2. DELETE EXISTING
                if (dayIds.length > 0) {
                    await supabase.from('diet_meals').delete().in('diet_day_id', dayIds)
                }

                // 3. INSERT NEW
                const { error } = await supabase.from('diet_meals').insert(inserts)
                if (error) throw error

                // Force calculated mode if not already
                if (patientInfo?.id && patientInfo.macro_target_mode !== 'calculated') {
                    await supabase.from('patients').update({ macro_target_mode: 'calculated' }).eq('id', patientInfo.id)
                }

                // Log the activity to trace auto_plan limit
                let clientIp = 'Bilinmiyor';
                try {
                    const controller = new AbortController()
                    const timeout = setTimeout(() => controller.abort(), 800)
                    const ipRes = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
                    clearTimeout(timeout)
                    const ipData = await ipRes.json();
                    clientIp = ipData.ip || 'Bilinmiyor';
                } catch {
                    // Ignore ip fetch error
                }

                await supabase.from('patient_activity_logs').insert({
                    patient_id: patientInfo.id,
                    action_type: 'auto_plan_generated',
                    metadata: {
                        ip_address: clientIp
                    }
                })
                // Re-calculate the limits seamlessly
                const scopedPatient = await supabase.from('patients').select('auto_plan_limit_count, auto_plan_limit_period_hours').eq('id', patientInfo.id).single()
                if(scopedPatient.data) {
                    await checkAutoPlanEligibility(patientInfo.id, scopedPatient.data.auto_plan_limit_count, scopedPatient.data.auto_plan_limit_period_hours)
                }

                setPlanningPhase('success')
                setRefreshTrigger(prev => prev + 1)

                // Trigger cascading highlight animation after new plan is generated
                setHighlightSequence({ activeIndex: 0, isActive: true })

                // Also refresh days explicitly
                await fetchWeekDays(activeWeek.id)
            }

        } catch (err: any) {
            console.error(err)
            alert("Uygulama Hatası: " + err.message)
        } finally {
            setIsApplyingPlan(false)
            setIsGeneratingPlan(false)
            setPlanningProgress(100)
        }
    }

    async function handleDeleteWeek(weekId: string) {
        if (!confirm("Bu haftayı ve tüm öğünlerini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.")) return

        setIsApplyingPlan(true)
        try {
            // 1. Delete meals
            const { data: days } = await supabase.from('diet_days').select('id').eq('diet_week_id', weekId)
            if (days && days.length > 0) {
                for (const day of days) {
                    await supabase.from('diet_meals').delete().eq('diet_day_id', day.id)
                }
            }

            // 2. Delete days
            await supabase.from('diet_days').delete().eq('diet_week_id', weekId)

            // 3. Delete week
            await supabase.from('diet_weeks').delete().eq('id', weekId)

            // 4. Update UI state
            setAllWeeks(prev => prev.filter(w => w.id !== weekId))
            setTotalWeekCount(prev => prev - 1)

            if (activeWeek?.id === weekId) {
                // If we deleted the active week, reload
                window.location.reload()
            }
        } catch (err: any) {
            console.error(err)
            alert("Hafta silinirken hata oluştu: " + err.message)
        } finally {
            setIsApplyingPlan(false)
        }
    }

    async function handleUpdateWeek(weekId: string, title: string, startDate: string, endDate: string) {
        setIsApplyingPlan(true)
        try {
            const { error } = await supabase
                .from('diet_weeks')
                .update({
                    title: title || `${activeWeek?.week_number}. Hafta`,
                    start_date: startDate || null,
                    end_date: endDate || null
                })
                .eq('id', weekId)

            if (error) throw error

            setRefreshTrigger(prev => prev + 1)
            await fetchActivePlan(weekId)
            setIsEditingWeek(false)
            await showAppModal('Başarılı', 'Hafta bilgileri güncellendi.', 'success')
        } catch (err: any) {
            console.error('Update week error:', err)
            await showAppModal('Hata', 'Hafta güncellenirken hata oluştu: ' + err.message, 'alert')
        } finally {
            setIsApplyingPlan(false)
        }
    }

    async function handleAddWeek(planId: string, weekNum: number) {
        if (!patientInfo) return null

        let startDate: Date
        const sortedWeeks = [...allWeeks].sort((a, b) => a.week_number - b.week_number)

        if (weekNum === 1) {
            startDate = getMonday(new Date())
        } else {
            // Find an anchor week
            const anchorWeek = sortedWeeks.find(w => w.week_number < weekNum);
            // Fallback to the last available max week if no smaller anchor exists (rare, but just in case)
            const fallbackAnchor = sortedWeeks[sortedWeeks.length - 1];

            if (anchorWeek && anchorWeek.start_date) {
                // Determine start date relative to the anchor
                const anchorDate = new Date(anchorWeek.start_date);
                const weekDiff = weekNum - anchorWeek.week_number;
                startDate = new Date(anchorDate);
                startDate.setDate(startDate.getDate() + (weekDiff * 7));

                // Ensure it's Monday just in case
                startDate = getMonday(startDate);
            } else if (fallbackAnchor && fallbackAnchor.start_date) {
                const anchorDate = new Date(fallbackAnchor.start_date);
                const weekDiff = weekNum - fallbackAnchor.week_number;
                startDate = new Date(anchorDate);
                startDate.setDate(startDate.getDate() + (weekDiff * 7));
                startDate = getMonday(startDate);
            } else {
                startDate = getMonday(new Date());
                startDate.setDate(startDate.getDate() + (weekNum - 1) * 7);
            }
        }

        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + 6)

        const lastWeek = allWeeks[allWeeks.length - 1]
        let inheritedMealTypes = lastWeek?.meal_types || ['KAHVALTI', 'ÖĞLE', 'AKŞAM', 'ARA ÖĞÜN']
        let inheritedSlotConfigs = lastWeek?.slot_configs || null

        // If no last week (Week 1), try to fetch global/patient/program defaults
        if (!lastWeek) {
            let usedSettings: any = null

            // 1. Patient Settings
            const { data: pSet } = await supabase.from('planner_settings').select('slot_config').eq('patient_id', patientInfo.id).maybeSingle()
            if (pSet?.slot_config) usedSettings = pSet

            // 2. Program Settings
            if (!usedSettings) {
                const progId = patientInfo?.program_template_id
                if (progId) {
                    const { data: progSet } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'program').eq('program_template_id', progId).maybeSingle()
                    if (progSet?.slot_config) usedSettings = progSet
                }
            }

            // 3. Global Settings
            if (!usedSettings) {
                const { data: globSet } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'global').maybeSingle()
                usedSettings = globSet
            }

            if (usedSettings?.slot_config && Array.isArray(usedSettings.slot_config) && usedSettings.slot_config.length > 0) {
                inheritedSlotConfigs = usedSettings.slot_config
                inheritedMealTypes = usedSettings.slot_config.map((c: any) => c.name)
            } else if (patientInfo.preferences?.default_meal_types) {
                // Legacy Fallback
                inheritedMealTypes = patientInfo.preferences.default_meal_types
            }
        }

        const inheritedWeight = lastWeek?.weight_log ?? patientInfo.weight ?? 0
        let inheritedDietType = lastWeek?.assigned_diet_type_id ?? null
        let inheritedActivityLevel = lastWeek?.activity_level_log ?? patientInfo.activity_level ?? 3

        if (patientProgram) {
            if (weekNum === 1 || !lastWeek) {
                inheritedActivityLevel = patientProgram.default_activity_level || 3
            }
            if (patientProgram.program_template_weeks) {
                const rule = patientProgram.program_template_weeks.find((pw: any) =>
                    weekNum >= pw.week_start && weekNum <= pw.week_end
                )
                if (rule && rule.diet_type_id) {
                    inheritedDietType = rule.diet_type_id
                }
            }
        }

        const { data, error } = await supabase.from('diet_weeks').insert([{
            diet_plan_id: planId,
            week_number: weekNum,
            title: `${weekNum}. Hafta`,
            start_date: formatDateISO(startDate),
            end_date: formatDateISO(endDate),
            meal_types: inheritedMealTypes,
            slot_configs: inheritedSlotConfigs,
            weight_log: inheritedWeight,
            assigned_diet_type_id: inheritedDietType,
            activity_level_log: inheritedActivityLevel
        }]).select().single()

        if (error || !data) {
            console.error("Yeni hafta ekleme hatası:", error)
            alert("Hafta oluşturulamadı: " + error?.message)
            return null
        }

        // --- Auto-generate 7 days for the new week ---
        const daysToInsert = []
        for (let i = 0; i < 7; i++) {
            daysToInsert.push({
                diet_week_id: data.id,
                day_number: i + 1,
                notes: ''
            })
        }
        const { error: daysError } = await supabase.from('diet_days').insert(daysToInsert)
        if (daysError) {
            console.error("Hafta günleri oluşturulamadı:", daysError)
            // Soft fail, user can still see week but might need to refresh
        }

        return data
    }

    async function handleCreatePlanAndWeek() {
        if (!patientInfo) return
        setIsApplyingPlan(true)
        setError(null) // Clear error to replace UI if it succeeds
        try {
            let planId = activePlan?.id
            if (!planId) {
                // Check once more to prevent race conditions
                const { data: existingPlan } = await supabase.from('diet_plans').select('id').eq('patient_id', patientInfo.id).eq('status', 'active').maybeSingle()
                if (existingPlan) {
                    planId = existingPlan.id
                } else {
                    const { data: newPlan, error: planError } = await supabase.from('diet_plans').insert([{
                        patient_id: patientInfo.id,
                        title: 'Diyet Planım',
                        status: 'active',
                        meal_types: patientInfo.preferences?.default_meal_types || ['KAHVALTI', 'ÖĞLE', 'AKŞAM', 'ARA ÖĞÜN']
                    }]).select().single()
                    if (planError) throw planError
                    planId = newPlan.id
                }
            }

            // SMART GAP DETECTION
            let nextWeekNum = 1;
            if (allWeeks.length > 0) {
                // Query the DB for the REAL max week_number (allWeeks may exclude future weeks)
                const { data: weekNumsRow } = await supabase
                    .from('diet_weeks')
                    .select('week_number')
                    .eq('diet_plan_id', planId);

                const dbWeekNums = weekNumsRow ? weekNumsRow.map(w => w.week_number).sort((a, b) => a - b) : allWeeks.map(w => w.week_number).sort((a, b) => a - b);
                const maxWeek = dbWeekNums.length > 0 ? dbWeekNums[dbWeekNums.length - 1] : 0;

                const startCheckFrom = activeWeek ? activeWeek.week_number : 0;

                let gapFound: number | null = null;
                for (let i = startCheckFrom + 1; i <= maxWeek; i++) {
                    if (!dbWeekNums.includes(i)) {
                        gapFound = i;
                        break;
                    }
                }

                if (gapFound !== null) {
                    if (confirm(`${gapFound}. hafta eksik görünüyor. Araya ${gapFound}. hafta olarak eklensin mi?\n\n(İptal derseniz sona ${maxWeek + 1}. hafta eklenecektir)`)) {
                        nextWeekNum = gapFound;
                    } else {
                        nextWeekNum = maxWeek + 1;
                    }
                } else {
                    nextWeekNum = maxWeek + 1;
                }
            }

            const newWeek = await handleAddWeek(planId, nextWeekNum)

            if (newWeek) {
                setAllWeeks(prev => {
                    const next = [...prev, newWeek];
                    return next.sort((a, b) => a.week_number - b.week_number);
                });
                setTotalWeekCount(prev => prev + 1)
                setActiveWeek(newWeek)
                setWeekHighlight(true)
                await fetchActivePlan(newWeek.id) // Reload full state focusing on this week
            }
        } catch (error: any) {
            console.error(error)
            alert("Plan başlatılırken bir sorun oluştu.")
        } finally {
            setIsApplyingPlan(false)
        }
    }

    // ================== SMART WEEKLY MACRO BALANCER (ENGINE-BASED) ==================
    async function handleAutoBalance(mode: 'balance' | 'flavor' = 'balance', targetDay?: number) {
        if (!weekDays || weekDays.length === 0 || !dailyTargets) {
            await showAppModal('Hata', 'Haftalık veriler veya hedef makrolar yüklenemedi.', 'warning')
            return
        }
        if (!patientInfo?.id || !user?.id) {
            await showAppModal('Hata', 'Hasta veya kullanıcı bilgisi bulunamadı.', 'warning')
            return
        }

        const targetCals = dailyTargets.calories || 0
        const targetProt = dailyTargets.protein || 0
        const targetCarbs = (dailyTargets as any).carbs ?? (dailyTargets as any).carb ?? 0
        const targetFat = dailyTargets.fat || 0

        if (targetCals <= 0) {
            await showAppModal('Hata', 'Hedef kalori hesaplanamadı.', 'warning')
            return
        }

        setTuneLoadMode(mode)
        setTuneLoadScope(targetDay ? 'daily' : 'weekly')
        setTuneLoadStep('analyzing')
        setTuneStepStartedAt(Date.now())
        setIsTuneLoading(true)

        try {
            // â”€â”€ 1. BUILD PLAN OBJECT FROM weekDays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            const planMeals: any[] = []
            const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

            weekDays.forEach((day: any, dayIdx: number) => {
                const dayNum = dayIdx + 1
                day.diet_meals.forEach((slot: any) => {
                    const slotName = slot.meal_name || slot.meal_time || 'ÖĞLEN'
                        ; (slot.diet_foods || []).forEach((f: DietFood) => {
                            planMeals.push({
                                day: dayNum,
                                dayName: day.day_name || DAY_NAMES[dayIdx] || `Gün ${dayNum}`,
                                slot: slotName,
                                food: {
                                    id: f.real_food_id || (f as any).food_id || f.id,
                                    name: f.food_name || (f as any).foods?.name || 'Bilinmeyen',
                                    calories: Number(f.calories) || 0,
                                    protein: Number(f.protein) || 0,
                                    fat: Number(f.fats || (f as any).fat) || 0,
                                    carbs: Number(f.carbs) || 0,
                                    role: f.role || (f as any).foods?.role || 'sideDish',
                                    portion_fixed: f.portion_fixed || false,
                                    is_custom: f.is_custom || false,
                                    min_quantity: f.min_quantity,
                                    max_quantity: f.max_quantity,
                                    step: f.step,
                                    max_weekly_freq: (f as any).foods?.max_weekly_freq,
                                    priority_score: (f as any).foods?.priority_score,
                                    tags: (f as any).foods?.tags || [],
                                    season_start: (f as any).foods?.season_start,
                                    season_end: (f as any).foods?.season_end,
                                    category: f.category || (f as any).foods?.category,
                                },
                                portion_multiplier: f.amount || 1,
                                // Store DB record id for applying changes later
                                _dbId: f.id,
                                _slotIdx: slot.id,
                            })
                        })
                })
            })

            const plan = {
                meals: planMeals,
                targetMacros: {
                    calories: targetCals,
                    protein: targetProt,
                    carbs: targetCarbs,
                    fat: targetFat,
                },
                settings: null, // Engine will load its own settings
            }

            // â”€â”€ 2. CALL ENGINE balancePlan() / applyFlavorTune() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            const planner = await getPlannerInstance(patientInfo.id, user.id)
            const { plan: balanced, changes } = mode === 'flavor'
                ? await planner.applyFlavorTune(plan, targetDay ? 'daily' : 'weekly', targetDay)
                : await planner.balancePlan(plan, 'weekly')

            if (changes.length === 0) {
                // Calculate and show current state
                const daysWithFood = weekDays.filter((d: any) => d.diet_meals.some((s: any) => s.diet_foods.length > 0))
                let totalP = 0, totalC = 0, totalF = 0
                daysWithFood.forEach((day: any) => {
                    day.diet_meals.forEach((slot: any) => {
                        slot.diet_foods.forEach((f: DietFood) => {
                            const mult = f.amount || 1
                            totalP += (Number(f.protein) || 0) * mult
                            totalC += (Number(f.carbs) || 0) * mult
                            totalF += (Number(f.fats || (f as any).fat) || 0) * mult
                        })
                    })
                })
                const n = daysWithFood.length || 1
                const avgP = Math.round(((totalP / n) / targetProt) * 100)
                const avgC = Math.round(((totalC / n) / targetCarbs) * 100)
                const avgF = Math.round(((totalF / n) / targetFat) * 100)

                await showAppModal('Analiz Sonucu', `⚖️ Değişiklik gerekmiyor veya yapılabilecek değişiklik yok.\n\nProtein: %${avgP} | Karb: %${avgC} | Yağ: %${avgF}\nTüm makrolar tolerans aralığında veya porsiyonlar sınırda.`, 'warning')
                return
            }

            // â”€â”€ 3. CATEGORIZE CHANGES FOR DISPLAY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            if (mode === 'flavor') {
                const balancedMeals = balanced.meals || []
                const scopedOriginalMeals = targetDay
                    ? planMeals.filter((m: any) => m.day === targetDay)
                    : planMeals
                const scopedBalancedMeals = targetDay
                    ? balancedMeals.filter((m: any) => m.day === targetDay)
                    : balancedMeals

                const dayNameByNumber = new Map<number, string>()
                weekDays.forEach((d: any, idx: number) => dayNameByNumber.set(idx + 1, d.day_name || `Gün ${idx + 1}`))

                const getMacros = (meal: any) => {
                    const mult = Number(meal?.portion_multiplier || 1)
                    const food = meal?.food || {}
                    return {
                        calories: (Number(food.calories) || 0) * mult,
                        protein: (Number(food.protein) || 0) * mult,
                        carbs: (Number(food.carbs) || 0) * mult,
                        fat: (Number(food.fat) || 0) * mult,
                    }
                }

                const initialTotals = scopedOriginalMeals.reduce((acc: any, m: any) => {
                    const mac = getMacros(m)
                    acc.calories += mac.calories
                    acc.protein += mac.protein
                    acc.carbs += mac.carbs
                    acc.fat += mac.fat
                    return acc
                }, { calories: 0, protein: 0, fat: 0, carbs: 0 })

                const dayCount = targetDay
                    ? 1
                    : Math.max(1, new Set(scopedOriginalMeals.map((m: any) => m.day)).size || weekDays.length || 7)
                const isWeeklyFlavor = !targetDay
                const displayDivisor = isWeeklyFlavor ? dayCount : 1

                const bySlot = (meals: any[]) => {
                    const map = new Map<string, any[]>()
                    meals.forEach((m: any) => {
                        const key = `${m.day}__${m.slot}`
                        const arr = map.get(key) || []
                        arr.push(m)
                        map.set(key, arr)
                    })
                    return map
                }

                const originalBySlot = bySlot(scopedOriginalMeals)
                const balancedBySlot = bySlot(scopedBalancedMeals)
                const allSlotKeys = new Set<string>([...originalBySlot.keys(), ...balancedBySlot.keys()])

                const flavorChanges: BalanceChange[] = []
                let changeSeq = 0

                allSlotKeys.forEach((slotKey) => {
                    const originalSlot = [...(originalBySlot.get(slotKey) || [])]
                    const balancedSlot = [...(balancedBySlot.get(slotKey) || [])]

                    const usedOriginal = new Set<number>()
                    const usedBalanced = new Set<number>()

                    // Exact food match => potential portion change
                    balancedSlot.forEach((bMeal: any, bIdx: number) => {
                        const oIdx = originalSlot.findIndex((oMeal: any, idx: number) => !usedOriginal.has(idx) && oMeal.food?.id === bMeal.food?.id)
                        if (oIdx === -1) return

                        usedOriginal.add(oIdx)
                        usedBalanced.add(bIdx)

                        const oMeal = originalSlot[oIdx]
                        const oldMult = Number(oMeal.portion_multiplier || 1)
                        const newMult = Number(bMeal.portion_multiplier || 1)
                        if (Math.abs(newMult - oldMult) <= 0.01 || !oMeal._dbId) return

                        const oldMac = getMacros(oMeal)
                        const newMac = getMacros(bMeal)
                        flavorChanges.push({
                            id: `flavor-${++changeSeq}`,
                            type: 'portion',
                            foodId: String(oMeal._dbId),
                            foodName: bMeal.food?.name || oMeal.food?.name || 'Yemek',
                            detail: `Porsiyon: ${oldMult.toFixed(2)}x -> ${newMult.toFixed(2)}x`,
                            slotName: bMeal.slot,
                            day: bMeal.day,
                            dayName: bMeal.dayName || dayNameByNumber.get(Number(bMeal.day)),
                            originalMultiplier: oldMult,
                            newMultiplier: newMult,
                            diffCals: newMac.calories - oldMac.calories,
                            diffProt: newMac.protein - oldMac.protein,
                            diffCarbs: newMac.carbs - oldMac.carbs,
                            diffFat: newMac.fat - oldMac.fat,
                        })
                    })

                    // Remaining original + remaining balanced => swaps
                    const remainingOriginalIdx = originalSlot
                        .map((_, idx) => idx)
                        .filter((idx) => !usedOriginal.has(idx))
                    const remainingBalancedIdx = balancedSlot
                        .map((_, idx) => idx)
                        .filter((idx) => !usedBalanced.has(idx))

                    const swapCount = Math.min(remainingOriginalIdx.length, remainingBalancedIdx.length)
                    for (let i = 0; i < swapCount; i++) {
                        const oMeal = originalSlot[remainingOriginalIdx[i]]
                        const bMeal = balancedSlot[remainingBalancedIdx[i]]
                        if (!oMeal?._dbId || !bMeal?.food?.id) continue

                        const oldMac = getMacros(oMeal)
                        const newMac = getMacros(bMeal)

                        flavorChanges.push({
                            id: `flavor-${++changeSeq}`,
                            type: 'swap',
                            foodId: String(oMeal._dbId),
                            foodName: oMeal.food?.name || 'Yemek',
                            detail: `${oMeal.food?.name || 'Yemek'} -> ${bMeal.food?.name || 'Yeni yemek'}`,
                            slotName: bMeal.slot,
                            day: bMeal.day,
                            dayName: bMeal.dayName || dayNameByNumber.get(Number(bMeal.day)),
                            newFood: { ...bMeal.food, _originalFoodId: oMeal.food?.id },
                            diffCals: newMac.calories - oldMac.calories,
                            diffProt: newMac.protein - oldMac.protein,
                            diffCarbs: newMac.carbs - oldMac.carbs,
                            diffFat: newMac.fat - oldMac.fat,
                        })

                        usedOriginal.add(remainingOriginalIdx[i])
                        usedBalanced.add(remainingBalancedIdx[i])
                    }

                    // Remaining balanced => adds
                    balancedSlot.forEach((bMeal: any, bIdx: number) => {
                        if (usedBalanced.has(bIdx) || !bMeal?.food?.id) return
                        const mac = getMacros(bMeal)
                        flavorChanges.push({
                            id: `flavor-${++changeSeq}`,
                            type: 'add',
                            foodName: bMeal.food?.name || 'Yeni yemek',
                            detail: `${bMeal.slot} öğününe eklenecek`,
                            slotName: bMeal.slot,
                            day: bMeal.day,
                            dayName: bMeal.dayName || dayNameByNumber.get(Number(bMeal.day)),
                            newFood: bMeal.food,
                            diffCals: mac.calories,
                            diffProt: mac.protein,
                            diffCarbs: mac.carbs,
                            diffFat: mac.fat,
                        })
                    })

                    // Remaining original => removes
                    originalSlot.forEach((oMeal: any, oIdx: number) => {
                        if (usedOriginal.has(oIdx) || !oMeal?._dbId) return
                        const oldMac = getMacros(oMeal)
                        flavorChanges.push({
                            id: `flavor-${++changeSeq}`,
                            type: 'remove',
                            foodId: String(oMeal._dbId),
                            foodName: oMeal.food?.name || 'Yemek',
                            detail: `${oMeal.slot} öğününden kaldırılacak`,
                            slotName: oMeal.slot,
                            day: oMeal.day,
                            dayName: oMeal.dayName || dayNameByNumber.get(Number(oMeal.day)),
                            diffCals: -oldMac.calories,
                            diffProt: -oldMac.protein,
                            diffCarbs: -oldMac.carbs,
                            diffFat: -oldMac.fat,
                        })
                    })
                })

                if (flavorChanges.length === 0) {
                    await showAppModal('Analiz Sonucu', 'Lezzet ayarı için uygulanabilir değişiklik bulunamadı.', 'warning')
                    return
                }

                const flavorTitle = targetDay
                    ? `${dayNameByNumber.get(targetDay) || 'Gün'} Lezzet Ayarı`
                    : 'Haftalık Lezzet Ayarı'

                const modalTargetTotals = {
                    calories: isWeeklyFlavor ? (targetCals * dayCount) : targetCals,
                    protein: isWeeklyFlavor ? (targetProt * dayCount) : targetProt,
                    carbs: isWeeklyFlavor ? (targetCarbs * dayCount) : targetCarbs,
                    fat: isWeeklyFlavor ? (targetFat * dayCount) : targetFat,
                }

                setIsTuneLoading(false)
                const approvedFlavorChanges = await showBalanceModal(
                    flavorTitle,
                    flavorChanges,
                    initialTotals,
                    modalTargetTotals,
                    { defaultSelectAll: true, macroDisplayDivisor: displayDivisor }
                )

                if (!approvedFlavorChanges || approvedFlavorChanges.length === 0) return

                setTuneLoadStep('applying')
                setTuneStepStartedAt(Date.now())
                setIsTuneLoading(true)

                let applied = 0
                const failedOps: string[] = []

                const runWithRetry = async (
                    op: () => any,
                    label: string
                ): Promise<boolean> => {
                    let lastError: any = null
                    for (let attempt = 1; attempt <= 2; attempt++) {
                        const { error } = await op()
                        if (!error) return true
                        lastError = error
                        if (attempt === 1) {
                            await new Promise((resolve) => setTimeout(resolve, 250))
                        }
                    }
                    failedOps.push(`${label}: ${lastError?.message || 'Bilinmeyen hata'}`)
                    return false
                }

                const applyTasks: Array<Promise<boolean>> = approvedFlavorChanges.map((c) => {
                    if (c.type === 'portion' && c.newMultiplier !== undefined && c.foodId) {
                        return runWithRetry(
                            () => supabase
                                .from('diet_meals')
                                .update({ portion_multiplier: c.newMultiplier, swapped_by: 'ai_flavor' })
                                .eq('id', c.foodId),
                            `Porsiyon (${c.foodName})`
                        )
                    }
                    if (c.type === 'swap' && c.foodId && c.newFood?.id) {
                        return runWithRetry(
                            () => supabase
                                .from('diet_meals')
                                .update({
                                    food_id: c.newFood.id,
                                    original_food_id: c.newFood._originalFoodId || null,
                                    portion_multiplier: 1,
                                    swapped_by: 'ai_flavor',
                                    calories: c.newFood.calories || null,
                                    protein: c.newFood.protein || null,
                                    fat: c.newFood.fat || c.newFood.fats || null,
                                    carbs: c.newFood.carbs || null,
                                })
                                .eq('id', c.foodId),
                            `Değişim (${c.foodName})`
                        )
                    }
                    if (c.type === 'add' && c.newFood?.id && c.day && c.slotName) {
                        const targetDayId = weekDays[(Number(c.day) || 1) - 1]?.id
                        if (!targetDayId) return Promise.resolve(false)
                        return runWithRetry(
                            () => supabase
                                .from('diet_meals')
                                .insert({
                                    diet_day_id: targetDayId,
                                    food_id: c.newFood.id,
                                    meal_time: c.slotName,
                                    portion_multiplier: 1,
                                    calories: c.newFood.calories,
                                    protein: c.newFood.protein,
                                    fat: c.newFood.fat || c.newFood.fats || 0,
                                    carbs: c.newFood.carbs,
                                    is_consumed: true,
                                    is_custom: false,
                                    swapped_by: 'ai_flavor',
                                }),
                            `Ekleme (${c.foodName})`
                        )
                    }
                    if (c.type === 'remove' && c.foodId) {
                        return runWithRetry(
                            () => supabase.from('diet_meals').delete().eq('id', c.foodId),
                            `Silme (${c.foodName})`
                        )
                    }
                    return Promise.resolve(false)
                })

                const applyResults = await Promise.all(applyTasks)
                applied = applyResults.filter(Boolean).length

                await fetchWeekDays(activeWeek.id)
                if (failedOps.length > 0) {
                    const preview = failedOps.slice(0, 3).map((x) => `• ${x}`).join('\n')
                    await showAppModal(
                        'Kısmi Uygulandı',
                        `✅ ${applied}/${approvedFlavorChanges.length} değişiklik uygulandı.\n\nUygulanamayanlar:\n${preview}${failedOps.length > 3 ? `\n• ... +${failedOps.length - 3} adet daha` : ''}`,
                        'warning'
                    )
                } else {
                    await showAppModal('Başarılı', `✅ ${applied}/${approvedFlavorChanges.length} değişiklik uygulandı!`, 'success')
                }
                return
            }
            const portionChanges = changes.filter(c => c.includes('↓') || c.includes('↑'))
            const swapChanges = changes.filter(c => c.includes('🔄'))
            const addChanges = changes.filter(c => c.includes('➕'))
            const removeChanges = changes.filter(c => c.includes('➖'))

            let detailLines = ''
            if (portionChanges.length > 0) {
                detailLines += '\n⚖️ Porsiyon Ayarları:\n'
                detailLines += portionChanges.map(c => `  ${c}`).join('\n')
            }
            if (swapChanges.length > 0) {
                detailLines += '\n\n🔄 Yemek Değişiklikleri:\n'
                detailLines += swapChanges.map(c => `  ${c}`).join('\n')
            }
            if (addChanges.length > 0) {
                detailLines += '\n\n➕ Eklenen Yemekler:\n'
                detailLines += addChanges.map(c => `  ${c}`).join('\n')
            }
            if (removeChanges.length > 0) {
                detailLines += '\n\n➖ Çıkarılan Yemekler:\n'
                detailLines += removeChanges.map(c => `  ${c}`).join('\n')
            }

            setIsTuneLoading(false)
            const confirmed = await showAppModal('Onaylıyor musunuz?', `Önerilen düzeltmeler (${changes.length} değişiklik):${detailLines}`, 'confirm')
            if (!confirmed) return

            setTuneLoadStep('applying')
            setTuneStepStartedAt(Date.now())
            setIsTuneLoading(true)
            // â”€â”€ 4. APPLY CHANGES TO DATABASE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            let applied = 0
            const balancedMeals = balanced.meals || []

            // Build a map of original DB IDs from the original plan
            const originalDbMap = new Map<string, any>()
            planMeals.forEach(m => {
                const key = `${m.day}_${m.slot}_${m.food.id}`
                originalDbMap.set(key, m)
            })
            const operations: PromiseLike<boolean>[] = []

            // Apply portion changes: Compare balanced vs original
            for (const bMeal of balancedMeals) {
                const key = `${bMeal.day}_${bMeal.slot}_${bMeal.food?.id}`
                const original = originalDbMap.get(key)
                if (original && original._dbId) {
                    const oldMult = original.portion_multiplier || 1
                    const newMult = bMeal.portion_multiplier || 1
                    if (Math.abs(newMult - oldMult) > 0.01) {
                        operations.push(
                            supabase
                                .from('diet_meals')
                                .update({ portion_multiplier: newMult })
                                .eq('id', original._dbId)
                                .then(({ error }) => !error)
                        )
                    }
                }
            }

            // Apply swaps: foods in balanced that replaced originals
            for (const bMeal of balancedMeals) {
                const key = `${bMeal.day}_${bMeal.slot}_${bMeal.food?.id}`
                const original = originalDbMap.get(key)
                // If no original match but same day+slot exists with a different food = swap
                if (!original) {
                    // Find original meal in same day+slot that was swapped OUT
                    const swappedOut = planMeals.find(m =>
                        m.day === bMeal.day && m.slot === bMeal.slot &&
                        m.food.id !== bMeal.food?.id &&
                        !balancedMeals.some((bm: any) => bm.food?.id === m.food.id && bm.day === m.day && bm.slot === m.slot)
                    )
                    if (swappedOut?._dbId && bMeal.food?.id) {
                        operations.push(
                            supabase
                                .from('diet_meals')
                                .update({
                                    food_id: bMeal.food.id,
                                    original_food_id: swappedOut.food.id,
                                    portion_multiplier: bMeal.portion_multiplier || 1,
                                    swapped_by: 'ai_balanced',
                                    calories: bMeal.food.calories || null,
                                    protein: bMeal.food.protein || null,
                                    fat: bMeal.food.fat || null,
                                    carbs: bMeal.food.carbs || null,
                                })
                                .eq('id', swappedOut._dbId)
                                .then(({ error }) => !error)
                        )
                    }
                }
            }

            // Apply adds: meals in balanced not present in original
            for (const bMeal of balancedMeals) {
                if (bMeal.source?.type === 'balance_add' && bMeal.food?.id) {
                    // Find the diet_day_id for this day
                    const dayIdx = (bMeal.day || 1) - 1
                    const targetDayId = weekDays[dayIdx]?.id
                    if (targetDayId) {
                        operations.push(
                            supabase.from('diet_meals').insert({
                                diet_day_id: targetDayId,
                                food_id: bMeal.food.id,
                                meal_time: bMeal.slot,
                                portion_multiplier: bMeal.portion_multiplier || 1,
                                calories: bMeal.food.calories,
                                protein: bMeal.food.protein,
                                fat: bMeal.food.fat || 0,
                                carbs: bMeal.food.carbs,
                                is_consumed: true,
                                is_custom: false,
                                swapped_by: 'ai_balanced'
                            }).then(({ error }) => !error)
                        )
                    }
                }
            }

            // Apply removes: meals in original not present in balanced
            for (const original of planMeals) {
                const stillExists = balancedMeals.some((bm: any) =>
                    bm.day === original.day && bm.slot === original.slot && bm.food?.id === original.food.id
                )
                if (!stillExists && original._dbId) {
                    operations.push(
                        supabase.from('diet_meals').delete().eq('id', original._dbId).then(({ error }) => !error)
                    )
                }
            }

            if (operations.length > 0) {
                const results = await Promise.allSettled(operations)
                applied = results.filter(r => r.status === 'fulfilled' && r.value).length
            }

            await fetchWeekDays(activeWeek.id)
            await showAppModal('Başarılı', `✅ ${applied}/${changes.length} değişiklik uygulandı!`, 'success')
        } catch (err: any) {
            console.error('Auto-balance error:', err)
            await showAppModal('Hata', 'Dengeleme sırasında hata: ' + err.message, 'alert')
        } finally {
            setIsTuneLoading(false)
        }
    }

    // ================== DAILY MACRO BALANCER (Greedy Simulation) ==================
    async function handleDailyBalance() {
        if (!currentDay || !dailyTargets) {
            await showAppModal('Hata', 'Günlük veriler veya hedef makrolar yüklenemedi.', 'warning')
            return
        }
        setTuneLoadMode('balance')
        setTuneLoadScope('daily')
        setTuneLoadStep('analyzing')
        setTuneStepStartedAt(Date.now())
        setIsTuneLoading(true)

        const targetCals = dailyTargets.calories || Math.round(
            ((dailyTargets.protein || 0) * 4) +
            (((dailyTargets as any).carbs ?? (dailyTargets as any).carb ?? 0) * 4) +
            ((dailyTargets.fat || 0) * 9)
        )
        const targetProt = dailyTargets.protein || 0
        const targetFat = dailyTargets.fat || 0
        const targetCarbs = (dailyTargets as any).carbs ?? (dailyTargets as any).carb ?? 0

        // Fetch macro priorities
        let macroPriorities = { protein: 5, carb: 5, fat: 5 }
        try {
            const cache = macroPrioritiesCacheRef.current
            const now = Date.now()
            const isFresh = Boolean(
                cache &&
                patientInfo?.id &&
                cache.patientId === patientInfo.id &&
                (now - cache.fetchedAt) < (5 * 60 * 1000)
            )

            if (isFresh && cache) {
                macroPriorities = cache.value
            } else {
                let pSettings = null
                if (patientInfo?.id) {
                    const { data } = await supabase
                        .from('planner_settings')
                        .select('macro_priorities')
                        .eq('scope', 'patient')
                        .eq('patient_id', patientInfo.id)
                        .maybeSingle()
                    if (data?.macro_priorities) pSettings = data
                }
                if (!pSettings) {
                    const { data } = await supabase
                        .from('planner_settings')
                        .select('macro_priorities')
                        .eq('scope', 'global')
                        .maybeSingle()
                    if (data?.macro_priorities) pSettings = data
                }
                if (pSettings?.macro_priorities) macroPriorities = pSettings.macro_priorities
                if (patientInfo?.id) {
                    macroPrioritiesCacheRef.current = {
                        patientId: patientInfo.id,
                        fetchedAt: now,
                        value: macroPriorities
                    }
                }
            }
        } catch (e) { /* defaults */ }

        // 1. Gather editable foods
        type MutableFood = {
            id: string,
            name: string,
            baseCals: number,
            baseProt: number,
            baseFat: number,
            baseCarbs: number,
            currentMult: number,
            minMult: number,
            maxMult: number,
            step: number,
            isFixed: boolean,
            isCustom: boolean,
            slotName: string,
            role: string
        }

        const mutableFoods: MutableFood[] = []
        let initialCals = 0, initialProt = 0, initialFat = 0, initialCarbs = 0

        currentDay.diet_meals.forEach((slot: any) => {
            slot.diet_foods.forEach((f: DietFood) => {
                const mult = f.amount || 1
                const bCals = Number(f.calories) || 0
                const bProt = Number(f.protein) || 0
                const bFat = Number(f.fats || (f as any).fat) || 0
                const bCarbs = Number(f.carbs) || 0

                initialCals += bCals * mult
                initialProt += bProt * mult
                initialFat += bFat * mult
                initialCarbs += bCarbs * mult

                mutableFoods.push({
                    id: f.id,
                    name: f.food_name,
                    baseCals: bCals,
                    baseProt: bProt,
                    baseFat: bFat,
                    baseCarbs: bCarbs,
                    currentMult: mult,
                    minMult: f.min_quantity ?? 0.5,
                    maxMult: f.max_quantity ?? 2.0,
                    step: f.step ?? 0.5,
                    isFixed: !!f.portion_fixed,
                    isCustom: !!f.is_custom,
                    slotName: slot.meal_time || slot.time || '',
                    role: f.role || (f as any).foods?.role || f.category || (f as any).foods?.kategori || ''
                })
            })
        })

        if (mutableFoods.length === 0) {
            setIsTuneLoading(false)
            return
        }

        // 2. Score Function
        // Lower is better. Calorie deviations are heavily penalized to prevent massive overshoots.
        const calculateScore = (state: { mult: number }[]) => {
            let cC = 0, cP = 0, cF = 0, cK = 0
            for (let i = 0; i < mutableFoods.length; i++) {
                const m = state[i].mult
                const f = mutableFoods[i]
                cC += f.baseCals * m
                cP += f.baseProt * m
                cF += f.baseFat * m
                cK += f.baseCarbs * m
            }

            const getErr = (actual: number, target: number) => target > 0 ? ((actual - target) / target) * 100 : 0

            const calErr = getErr(cC, targetCals)
            const protErr = getErr(cP, targetProt)
            const fatErr = getErr(cF, targetFat)
            const carbErr = getErr(cK, targetCarbs)

            // OVER-CALORIE BRICK WALL: Exceeding calories by > 3% triggers an impossibly high penalty
            // This prevents Dengele from bumping calories aggressively just to meet macro percentages
            const calPenalty = calErr > 3 ? 99999 + (calErr * 100) : calErr > 0 ? (calErr * 25) : (Math.abs(calErr) * 12)

            return calPenalty +
                (Math.abs(protErr) * macroPriorities.protein) +
                (Math.abs(fatErr) * macroPriorities.fat) +
                (Math.abs(carbErr) * macroPriorities.carb)
        }

        let currentState = mutableFoods.map(f => ({ mult: f.currentMult }))
        let currentScore = calculateScore(currentState)

        // Initial check
        const iProtPct = targetProt > 0 ? Math.round((initialProt / targetProt) * 100) : 100
        const iFatPct = targetFat > 0 ? Math.round((initialFat / targetFat) * 100) : 100
        const iCarbsPct = targetCarbs > 0 ? Math.round((initialCarbs / targetCarbs) * 100) : 100
        const iCalsPct = targetCals > 0 ? Math.round((initialCals / targetCals) * 100) : 100

        if (iProtPct >= 95 && iProtPct <= 105 && iFatPct >= 95 && iFatPct <= 105 && iCarbsPct >= 95 && iCarbsPct <= 105) {
            setIsTuneLoading(false)
            await showAppModal('Harika!', `✅ ${currentDay.day_name} zaten dengeli!\nProtein: %${iProtPct} | Karb: %${iCarbsPct} | Yağ: %${iFatPct}`, 'success')
            return
        }

        // 3. Hill Climbing Iteration
        const MAX_ITER = 20
        let changesMade = 0

        for (let iter = 0; iter < MAX_ITER; iter++) {
            let bestSimScore = currentScore
            let bestMove: { index: number, newMult: number } | null = null

            for (let i = 0; i < mutableFoods.length; i++) {
                const f = mutableFoods[i]
                if (f.isFixed || f.isCustom) continue

                const curMult = currentState[i].mult

                // Try increasing
                const multUp = Math.round((curMult + f.step) * 100) / 100
                if (multUp <= f.maxMult + 0.01) {
                    const simState = [...currentState]
                    simState[i] = { mult: multUp }
                    const scoreUp = calculateScore(simState)
                    // Must strictly improve score by a meaningful margin
                    if (scoreUp < bestSimScore - 0.1) {
                        bestSimScore = scoreUp
                        bestMove = { index: i, newMult: multUp }
                    }
                }

                // Try decreasing
                const multDown = Math.round((curMult - f.step) * 100) / 100
                if (multDown >= f.minMult - 0.01) {
                    const simState = [...currentState]
                    simState[i] = { mult: multDown }
                    const scoreDown = calculateScore(simState)
                    if (scoreDown < bestSimScore - 0.1) {
                        bestSimScore = scoreDown
                        bestMove = { index: i, newMult: multDown }
                    }
                }
            }

            if (!bestMove) break // Local optimum reached

            // Apply the best move
            currentState[bestMove.index].mult = bestMove.newMult
            currentScore = bestSimScore
            changesMade++
        }

        // 4. Compile Actions
        const changes: BalanceChange[] = []
        let finalCals = 0, finalProt = 0, finalFat = 0, finalCarbs = 0

        for (let i = 0; i < mutableFoods.length; i++) {
            const f = mutableFoods[i]
            const finalMult = currentState[i].mult

            finalCals += f.baseCals * finalMult
            finalProt += f.baseProt * finalMult
            finalFat += f.baseFat * finalMult
            finalCarbs += f.baseCarbs * finalMult

            if (Math.abs(finalMult - f.currentMult) > 0.01) {
                const dir = finalMult > f.currentMult ? '↑' : '↓'
                
                const multDiff = finalMult - f.currentMult
                
                changes.push({
                    id: Math.random().toString(36).substring(7),
                    type: 'portion',
                    foodId: f.id,
                    foodName: f.name,
                    newMultiplier: finalMult,
                    detail: `x${f.currentMult} → x${finalMult} (${dir})`,
                    diffCals: f.baseCals * multDiff,
                    diffProt: f.baseProt * multDiff,
                    diffFat: f.baseFat * multDiff,
                    diffCarbs: f.baseCarbs * multDiff
                })
            }
        }

        let fProtPct = targetProt > 0 ? Math.round((finalProt / targetProt) * 100) : 100
        let fFatPct = targetFat > 0 ? Math.round((finalFat / targetFat) * 100) : 100
        let fCarbsPct = targetCarbs > 0 ? Math.round((finalCarbs / targetCarbs) * 100) : 100
        let fCalsPct = targetCals > 0 ? Math.round((finalCals / targetCals) * 100) : 100

        // --- TOP UP LOGIC: Add missing foods if calorie deficit is too large (> %10) ---
        if (fCalsPct < 90 && patientInfo?.id && user?.id) {
            try {
                const availableSlots = Array.from(new Set(currentDay.diet_meals.map((m: any) => m.meal_time)))
                const topUpSlot = (availableSlots.includes('ARA ÖĞÜN') ? 'ARA ÖĞÜN' : (availableSlots[availableSlots.length - 1] || 'AKŞAM')) as string

                const plannerPid = activePlan?.patient_id || patientInfo?.id
                if (!plannerPid) throw new Error('Hasta ID bulunamadı')
                const planner = await getPlannerInstance(plannerPid, user.id);
                // Gather existing week foods for frequency checks
                const existingFoods: any[] = []
                if (activeWeek?.week_days) {
                    for (const day of activeWeek.week_days) {
                        for (const meal of day.diet_meals || []) {
                            for (const f of meal.diet_foods || []) {
                                if (f.foods) existingFoods.push(f.foods)
                            }
                        }
                    }
                }

                const slotItems = currentDay.diet_meals.filter((m: any) => m.meal_time === topUpSlot).flatMap((m: any) => m.diet_foods)

                const topUpFood = await planner.generateDayTopUp(
                    targetCals - finalCals,
                    topUpSlot,
                    slotItems,
                    null, // Use patient default active Diet Types
                    [],
                    existingFoods
                )

                if (topUpFood) {
                    changes.push({
                        id: Math.random().toString(36).substring(7),
                        type: 'add',
                        foodName: topUpFood.name,
                        detail: `Eklenecek (${topUpSlot}): ${Math.round(topUpFood.calories)} kcal`,
                        newFood: topUpFood,
                        slotName: topUpSlot,
                        diffCals: topUpFood.calories || 0,
                        diffProt: topUpFood.protein || 0,
                        diffFat: topUpFood.fat || topUpFood.fats || 0,
                        diffCarbs: topUpFood.carbs || 0
                    })

                    finalCals += topUpFood.calories || 0;
                    finalProt += topUpFood.protein || 0;
                    finalFat += topUpFood.fat || topUpFood.fats || 0;
                    finalCarbs += topUpFood.carbs || 0;

                    fProtPct = targetProt > 0 ? Math.round((finalProt / targetProt) * 100) : 100
                    fFatPct = targetFat > 0 ? Math.round((finalFat / targetFat) * 100) : 100
                    fCarbsPct = targetCarbs > 0 ? Math.round((finalCarbs / targetCarbs) * 100) : 100
                    fCalsPct = targetCals > 0 ? Math.round((finalCals / targetCals) * 100) : 100
                }
            } catch (err) {
                console.warn("Dengele eksik tamamlama hatası:", err)
            }
        }
        // -------------------------------------------------------------------------------

        // --- STAGE 2: ALTERNATIVE TWEAKS (Holistic Macro Balancing) ---
        const deviations = [
            { macro: 'Kalori', pct: fCalsPct, diff: fCalsPct - 100, field: 'baseCals' as const },
            { macro: 'Protein', pct: fProtPct, diff: fProtPct - 100, field: 'baseProt' as const },
            { macro: 'Karb', pct: fCarbsPct, diff: fCarbsPct - 100, field: 'baseCarbs' as const },
            { macro: 'Yağ', pct: fFatPct, diff: fFatPct - 100, field: 'baseFat' as const }
        ];

        // Sort by absolute deviation (worst offender first)
        deviations.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
        
        const worstDeviation = deviations[0];

        // If the worst deviation is substantial (> 10% off target)
        if (Math.abs(worstDeviation.diff) > 10) {
            
            if (worstDeviation.diff > 0) {
                // IT IS TOO HIGH: Find optional removals, prioritizing items high in the offending macro
                const removalCandidates = mutableFoods
                    .filter((f: any) => {
                        return ['snack', 'drink', 'dessert', 'sideDish', 'nuts'].includes(f.role) || f.slotName === 'ARA ÖĞÜN' || f.role.includes('yan');
                    })
                    .sort((a: any, b: any) => {
                        const valA = a[worstDeviation.field] * a.currentMult;
                        const valB = b[worstDeviation.field] * b.currentMult;
                        return valB - valA;
                    });

                // Offer up to 3 optional candidate removals
                const topCandidates = removalCandidates.slice(0, 3);
                
                for (const targetRemoval of topCandidates) {
                    // Only add if not already scheduled for removal
                    if (changes.some(c => c.type === 'remove' && c.foodId === targetRemoval.id)) continue;

                    changes.push({
                        id: Math.random().toString(36).substring(7),
                        type: 'remove',
                        foodId: targetRemoval.id,
                        foodName: targetRemoval.name,
                        detail: `Aşırı Yüksek ${worstDeviation.macro} Düşürmek İçin Alternatif Çıkarma (${targetRemoval.slotName})`,
                        slotName: targetRemoval.slotName,
                        diffCals: -(targetRemoval.baseCals * targetRemoval.currentMult),
                        diffProt: -(targetRemoval.baseProt * targetRemoval.currentMult),
                        diffFat: -(targetRemoval.baseFat * targetRemoval.currentMult),
                        diffCarbs: -(targetRemoval.baseCarbs * targetRemoval.currentMult),
                        isAlternative: true
                    });
                }
            } else {
                // IT IS TOO LOW: Find optional portion increases, prioritizing items high in the needed macro
                const increaseCandidates = mutableFoods
                    .sort((a: any, b: any) => {
                        const valA = a[worstDeviation.field];
                        const valB = b[worstDeviation.field];
                        return valB - valA; // Sort by density of that macro
                    });

                const topCandidates = increaseCandidates.slice(0, 2); // Offer up to 2 portion increases
                
                for (const targetIncrease of topCandidates) {
                    // Suggest increasing portion by 50% or smaller depending on size
                    let extraMult = 0.5;
                    if (targetIncrease.currentMult < 0.5) extraMult = 0.25;

                    // If we ALREADY have a primary portion change for this food, we increment on top of the 'newMultiplier'
                    let baseMultToUse = targetIncrease.currentMult;
                    const existingChange = changes.find(c => c.type === 'portion' && c.foodId === targetIncrease.id && !c.isAlternative);
                    if (existingChange && existingChange.newMultiplier) {
                        baseMultToUse = existingChange.newMultiplier;
                    }

                    const finalProposedMult = baseMultToUse + extraMult;

                    changes.push({
                        id: Math.random().toString(36).substring(7),
                        type: 'portion',
                        foodId: targetIncrease.id,
                        foodName: targetIncrease.name,
                        detail: `Eksik ${worstDeviation.macro} Tamamlamak İçin Porsiyon Artırma (x${baseMultToUse} → x${finalProposedMult} ↑)`,
                        slotName: targetIncrease.slotName,
                        newMultiplier: finalProposedMult,
                        diffCals: targetIncrease.baseCals * extraMult,
                        diffProt: targetIncrease.baseProt * extraMult,
                        diffFat: targetIncrease.baseFat * extraMult,
                        diffCarbs: targetIncrease.baseCarbs * extraMult,
                        isAlternative: true
                    });
                }
            }
        }
        // --------------------------------------------------------------------

        const isImproved = currentScore < calculateScore(mutableFoods.map(f => ({ mult: f.currentMult }))) - 1 || changes.some(c => c.type === 'add' || c.type === 'remove')

        if (changes.length === 0 || !isImproved) {
            setIsTuneLoading(false)
            await showAppModal('Analiz Sonucu', `📊 ${currentDay.day_name}:\nKalori: %${iCalsPct}\nProtein: %${iProtPct} | Karb: %${iCarbsPct} | Yağ: %${iFatPct}\n\nPorsiyon değişimi veya yemek eklemesiyle/çıkarmasıyla daha iyi bir denge bulunamadı.`, 'warning')
            return
        }

        setIsTuneLoading(false)
        const approvedChanges = await showBalanceModal(
            `${currentDay.day_name} İyileştirilecek`,
            changes,
            { calories: initialCals, protein: initialProt, fat: initialFat, carbs: initialCarbs },
            { calories: targetCals, protein: targetProt, fat: targetFat, carbs: targetCarbs },
            { defaultSelectAll: true }
        )

        if (!approvedChanges || approvedChanges.length === 0) return

        try {
            setTuneLoadStep('applying')
            setTuneStepStartedAt(Date.now())
            setIsTuneLoading(true)
            let applied = 0
            for (const c of approvedChanges) {
                if (c.type === 'portion' && c.newMultiplier !== undefined && c.foodId) {
                    const { error } = await supabase.from('diet_meals').update({ portion_multiplier: c.newMultiplier }).eq('id', c.foodId)
                    if (!error) applied++
                } else if (c.type === 'add' && c.newFood && c.slotName) {
                    const { error } = await supabase.from('diet_meals').insert({
                        diet_day_id: currentDay.id,
                        food_id: c.newFood.id,
                        meal_time: c.slotName,
                        portion_multiplier: 1,
                        calories: c.newFood.calories,
                        protein: c.newFood.protein,
                        fat: c.newFood.fat || c.newFood.fats || 0,
                        carbs: c.newFood.carbs,
                        is_consumed: true,
                        is_custom: false,
                        swapped_by: 'ai_balanced'
                    })
                    if (!error) applied++
                } else if (c.type === 'remove' && c.foodId) {
                    const { error } = await supabase.from('diet_meals').delete().eq('id', c.foodId)
                    if (!error) applied++
                }
            }
            await fetchWeekDays(activeWeek.id)
            await showAppModal('Başarılı', `✅ ${applied} değişiklik başarıyla uygulandı!`, 'success')
        } catch (err: any) {
            await showAppModal('Hata', 'Kayıt sırasında hata: ' + err.message, 'alert')
        } finally {
            setIsTuneLoading(false)
        }
    }


    async function handleUndo() {
        if (!activeWeek?.id) return
        const confirmed = await showAppModal('Onaylıyor musunuz?', 'Son işlemi geri almak istiyor musunuz?', 'confirm')
        if (!confirmed) return

        try {
            const { data: snapshots } = await supabase
                .from('diet_snapshots')
                .select('*')
                .eq('diet_week_id', activeWeek.id)
                .order('created_at', { ascending: false })
                .limit(1)

            console.log('[PatientPlan] Undo snapshots found:', snapshots?.length)

            if (!snapshots || snapshots.length === 0) {
                alert("Geri alınacak işlem bulunamadı.")
                return
            }

            const snapshot = snapshots[0]
            const snapshotData = snapshot.snapshot_data as any[]
            // detailed snapshot payload log removed

            // Delete current
            const { data: days } = await supabase.from('diet_days').select('id').eq('diet_week_id', activeWeek.id)
            const dayIds = days?.map(d => d.id) || []
            if (dayIds.length > 0) {
                await supabase.from('diet_meals').delete().in('diet_day_id', dayIds)
            }

            // Restore from snapshot
            const inserts: any[] = []
            for (const day of snapshotData) {
                if (day.diet_meals && Array.isArray(day.diet_meals)) {
                    for (const meal of day.diet_meals) {
                        inserts.push({
                            diet_day_id: day.id, // Ensure ID matches (snapshot stores actual day IDs)
                            food_id: meal.food_id,
                            meal_time: meal.meal_time,
                            is_custom: meal.is_custom,
                            custom_name: meal.custom_name,
                            calories: meal.calories,
                            protein: meal.protein,
                            carbs: meal.carbs,
                            fat: meal.fat,
                            portion_multiplier: meal.portion_multiplier,
                            custom_notes: meal.custom_notes || (meal as any).notes,
                            is_consumed: meal.is_consumed || false,
                            original_food_id: meal.original_food_id || null,
                            swapped_by: meal.swapped_by || null
                        })
                    }
                }
            }

            console.log('[PatientPlan] Undo inserts prepared:', inserts.length)

            if (inserts.length > 0) {
                const { error } = await supabase.from('diet_meals').insert(inserts)
                if (error) {
                    console.error('DEBUG: Patient handleUndo - Insert Error:', error)
                    throw error
                }
            }

            await supabase.from('diet_snapshots').delete().eq('id', snapshot.id)

            await showAppModal('Başarılı', "Geri alındı.", 'success')
            setRefreshTrigger(prev => prev + 1)
            await fetchWeekDays(activeWeek.id)

        } catch (e: any) {
            console.error('DEBUG: Patient handleUndo - Exception:', e)
            await showAppModal('Hata', "Geri alma hatası: " + e.message, 'alert')
        }
    }

    async function handleReset() {
        if (!activeWeek?.id) return
        const confirmed = await showAppModal('Emin misiniz?', 'Bu haftayı tamamen sıfırlamak istediğinize emin misiniz?', 'warning')
        if (!confirmed) return

        try {
            // Snapshot first
            const { data: currentDays } = await supabase
                .from('diet_days')
                .select('*, diet_meals(*)')
                .eq('diet_week_id', activeWeek.id)

            if (currentDays && currentDays.some((d: any) => d.diet_meals.length > 0)) {
                await supabase.from('diet_snapshots').insert({
                    diet_week_id: activeWeek.id,
                    snapshot_data: currentDays,
                    description: `Reset - ${new Date().toLocaleString('tr-TR')}`
                })
            }

            const dayIds = currentDays?.map((d: any) => d.id) || []
            if (dayIds.length > 0) {
                await supabase.from('diet_meals').delete().in('diet_day_id', dayIds)
            }

            await showAppModal('Başarılı', "Hafta sıfırlandı.", 'success')
            setRefreshTrigger(prev => prev + 1)
            await fetchWeekDays(activeWeek.id)

        } catch (e: any) {
            console.error(e)
            await showAppModal('Hata', "Sıfırlama hatası: " + e.message, 'alert')
        }
    }

    if (patientStatus === 'pending') {
        return (
            <div className="flex flex-col h-full bg-gray-50 min-h-screen p-4 items-center justify-center">
                <div className="flex flex-col items-center justify-center p-8 text-center bg-white rounded-3xl shadow-sm border border-gray-100 max-w-2xl w-full">
                    <div className="bg-blue-50 p-6 rounded-full mb-6 relative">
                        <div className="absolute top-0 right-0 w-4 h-4 bg-blue-500 rounded-full animate-ping"></div>
                        <ClipboardList className="w-16 h-16 text-blue-600" />
                    </div>
                    <h2 className="text-3xl font-bold text-gray-800 mb-4">Diyet Planınız Hazırlanıyor</h2>
                    <p className="text-gray-500 text-lg mb-8">
                        Kayıt işleminiz alındı! Diyetisyeniniz hesabınızı onayladıktan sonra size özel beslenme programınızı bu sayfada görüntüleyebileceksiniz. Lütfen bir süre sonra tekrar kontrol edin.
                    </p>
                    <Button variant="default" size="lg" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-8" onClick={() => window.location.reload()}>
                        Sayfayı Yenile
                    </Button>
                </div>
            </div>
        )
    }

    const currentTotals = dashboardTab === 'daily' ? dailyTotals : weeklyTotals

    return (
        <div className="flex flex-col h-full bg-gray-50 min-h-screen">
            {/* Custom Sticky Header - Redesigned Mobile-First Layout */}
            <header className="relative sm:sticky sm:top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-100 shadow-sm px-4 py-4 shrink-0">
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">

                    <div className="flex flex-col min-w-0 flex-1">
                        {/* Line 1: İsim (Program) & Kilo */}
                        <div className="flex items-center justify-between mb-1.5 min-w-0">
                            <h1 className="text-sm sm:text-base font-extrabold text-gray-900 leading-tight truncate mr-2">
                                {profile?.full_name || patientInfo?.full_name || 'Diyet Planım'}
                                <span className="text-[10px] sm:text-xs font-semibold text-gray-400 ml-1.5">
                                    ({patientProgram?.name || 'Program'})
                                </span>
                            </h1>
                            
                            {/* Kilo / Aktivite Badge */}
                            {(activeWeek?.weight_log || patientInfo?.weight) && (
                                <Button 
                                    variant="ghost" 
                                    onClick={openWeightModal}
                                    className="flex items-center gap-1 h-7 sm:h-8 bg-slate-100/80 hover:bg-emerald-50 px-2 rounded-lg border border-slate-200/50 hover:border-emerald-200 transition-all group shrink-0"
                                >
                                    <span className="text-xs sm:text-sm font-bold text-slate-700 group-hover:text-emerald-700">
                                        {activeWeek?.weight_log || patientInfo?.weight}kg
                                    </span>
                                    <Edit2 className="w-2.5 h-2.5 text-slate-400 group-hover:text-emerald-500" />
                                </Button>
                            )}
                        </div>

                        {/* Line 2: Breadcrumb Style (Diet -> Week Selection) */}
                        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                            {activeDietType?.name && (
                                <div className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] sm:text-[11px] font-bold border border-emerald-100/50 truncate shrink-0 max-w-[120px] sm:max-w-none">
                                    {activeDietType.name}
                                </div>
                            )}

                            <ChevronRight className="h-3 w-3 text-slate-300 shrink-0" />

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button 
                                        variant="outline" 
                                        className="h-7 sm:h-8 px-1.5 bg-white border-slate-200 shadow-sm hover:border-emerald-400 hover:bg-emerald-50/30 text-slate-700 rounded-lg flex items-center gap-1 transition-all group min-w-0 overflow-hidden"
                                    >
                                        <Calendar className="h-3 w-3 text-emerald-600 shrink-0" />
                                        <div className="flex items-center gap-1 truncate">
                                            <span className="text-[11px] sm:text-xs font-bold whitespace-nowrap">
                                                {activeWeek?.week_number || 1}. Hafta
                                            </span>
                                            {activeWeek?.start_date && (
                                                <span className="text-[12px] sm:text-[10px] font-medium text-slate-500 whitespace-nowrap">
                                                    {new Date(activeWeek.start_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                                                    {activeWeek.end_date ? ` - ${new Date(activeWeek.end_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}` : ''}
                                                </span>
                                            )}
                                        </div>
                                        <ChevronDown className="h-3 w-3 text-slate-400 group-hover:text-emerald-500 transition-colors shrink-0" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="center" className="w-64 max-h-[60vh] overflow-y-auto p-1.5 rounded-xl border-emerald-100 shadow-xl">
                                    <div className="px-2 py-1.5 mb-1 text-[10px] font-black text-emerald-600 uppercase tracking-widest bg-emerald-50 rounded-lg">
                                        Hafta Seçimi
                                    </div>
                                    {allWeeks.sort((a, b) => (b.week_number || 0) - (a.week_number || 0)).map((w) => (
                                        <DropdownMenuItem
                                            key={w.id}
                                            onClick={() => handleWeekChange(w.id)}
                                            className={cn(
                                                "flex flex-col items-start gap-1 py-2.5 px-3 rounded-lg cursor-pointer transition-all",
                                                activeWeek?.id === w.id 
                                                    ? "bg-emerald-50 text-emerald-900 border border-emerald-100" 
                                                    : w.id === currentWeekId 
                                                        ? "bg-blue-50/30 border border-dashed border-blue-200" 
                                                        : "hover:bg-gray-50"
                                            )}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold">{w.week_number}. Hafta</span>
                                                    {w.id === currentWeekId && (
                                                        <span className="text-[12px] font-black bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md uppercase tracking-tighter">Mevcut</span>
                                                    )}
                                                    {currentWeekNumber !== null && w.week_number === currentWeekNumber + 1 && (
                                                        <span className="text-[12px] font-black bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md uppercase tracking-tighter">Gelecek</span>
                                                    )}
                                                </div>
                                                {activeWeek?.id === w.id && <Check className="h-3 w-3 text-emerald-600" />}
                                            </div>
                                            {w.start_date && (
                                                <span className="text-[10px] text-gray-400">
                                                    {new Date(w.start_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                                                    {w.end_date ? ` - ${new Date(w.end_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}` : ''}
                                                </span>
                                            )}
                                        </DropdownMenuItem>
                                    ))}

                                    <DropdownMenuSeparator className="my-1.5 bg-emerald-50" />

                                    <DropdownMenuItem
                                        onClick={handleCreatePlanAndWeek}
                                        disabled={isApplyingPlan}
                                        className="flex items-center gap-2 py-2.5 px-3 rounded-lg cursor-pointer text-emerald-700 font-bold hover:bg-emerald-50 transition-all"
                                    >
                                        <Plus className="h-4 w-4 bg-emerald-100 rounded-full p-0.5" />
                                        <span className="text-xs">Yeni Hafta Ekle</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => setIsEditingWeek(true)}
                                        className="flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer text-indigo-700 font-bold hover:bg-indigo-50 transition-all"
                                    >
                                        <Edit2 className="h-4 w-4 bg-indigo-100 rounded-full p-0.5" />
                                        <span className="text-xs">Hafta Tarihlerini Düzenle</span>
                                    </DropdownMenuItem>

                                    {patientInfo?.preferences?.allow_week_delete && (
                                        <DropdownMenuItem
                                            onClick={() => handleDeleteWeek(activeWeek!.id)}
                                            className="flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer text-red-600 font-bold hover:bg-red-50 transition-all mt-1"
                                        >
                                            <Trash2 className="h-4 w-4 bg-red-100 rounded-full p-0.5" />
                                            <span className="text-xs">Haftayı Sil</span>
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>

                        </div>
                    </div>

                    {/* Right: Actions Menu */}
                    <div className="flex items-center gap-2 shrink-0">
                        <Button
                            onClick={() => window.dispatchEvent(new CustomEvent('trigger-autoplan'))}
                            className="hidden sm:flex h-9 sm:h-10 px-3 sm:px-4 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-md shadow-indigo-200/50 rounded-xl font-bold text-xs sm:text-sm items-center gap-1.5 transition-all"
                        >
                            <Wand2 className="h-4 w-4" />
                            <span>Otomatik Planla</span>
                        </Button>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-100 hover:border-emerald-200 transition-all group p-0 shadow-sm">
                                    <LayoutGrid className="h-4 w-4 sm:h-5 sm:w-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 p-1.5 rounded-xl border-slate-100 shadow-xl">

                                <DropdownMenuItem
                                    onClick={() => setIsMealTemplateModalOpen(true)}
                                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer text-indigo-700 font-bold hover:bg-indigo-50 transition-all"
                                >
                                    <ClipboardList className="h-4 w-4" />
                                    <span className="text-xs">Öğün Düzeni Seç</span>
                                </DropdownMenuItem>

                                <DropdownMenuSeparator className="my-1 bg-slate-50" />

                                <DropdownMenuItem
                                    onClick={handleUndo}
                                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer text-blue-700 font-bold hover:bg-blue-50 transition-all"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    <span className="text-xs">Geri Al</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={handleReset}
                                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer text-red-600 font-bold hover:bg-red-50 transition-all"
                                >
                                    <Eraser className="h-4 w-4" />
                                    <span className="text-xs">Haftayı Sıfırla</span>
                                </DropdownMenuItem>

                                <DropdownMenuSeparator className="my-1 bg-slate-50" />

                                <DropdownMenuItem
                                    onClick={() => signOut()}
                                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer text-slate-600 font-bold hover:bg-red-50 hover:text-red-700 transition-all"
                                >
                                    <LogOut className="h-4 w-4" />
                                    <span className="text-xs">Çıkış Yap</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </header>

            {/* Compute if week has any foods */}
            {(() => {
                const weekHasFoods = weekDays?.some(day =>
                    day.diet_meals.some((m: any) => (m.diet_foods?.length || 0) > 0)
                ) || false

                if (!weekHasFoods) {
                    // â”€â”€ EMPTY WEEK: Show only onboarding â”€â”€
                    return (
                        <div className="flex-1 flex flex-col items-center px-4 pt-6 pb-28">
                            {/* Elegant Hero Card */}
                            <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-emerald-950 mb-8">
                                <div className="p-8 text-center relative">
                                    {/* Subtle glow */}
                                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10" />
                                    <div className="relative">
                                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 backdrop-blur-sm mb-4 mx-auto border border-emerald-500/30">
                                            <Wand2 className="h-8 w-8 text-emerald-400 animate-pulse" />
                                        </div>
                                        <h3 className="text-xl font-bold text-white mb-2">Haftalık Planınız Boş</h3>
                                        <p className="text-gray-400 text-sm mb-5">
                                            Aşağıdaki <span className="text-emerald-400 font-semibold">✨ Planla</span> butonuna basarak<br />otomatik plan oluşturun
                                        </p>
                                        <div className="flex justify-center">
                                            <div className="animate-bounce text-emerald-500/60">
                                                <ChevronDown className="h-6 w-6" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Feature Tips */}
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider text-center mb-3">Plan oluşturduktan sonra neler yapabilirsiniz?</p>
                            <div className="w-full max-w-md space-y-2">
                                <div className="bg-white rounded-xl p-3 border border-indigo-100 shadow-sm flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                                        <Search className="h-4 w-4 text-indigo-600" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-700">Yemek Ara ve Ekle</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Öğünün altındaki arama kutusuyla veritabanında olmayan yemekleri ismini yazarak bile eklerseniz, yapay zeka makrolarını hesaplayıp planınıza kaydeder.</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-blue-100 shadow-sm flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                                        <Camera className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-700">Fotoğrafla Ekle</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Öğün başlığındaki 📷 simgesine tıklayarak yemeğinizin fotoğrafıyla ekleyin</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-amber-100 shadow-sm flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                        <Scale className="h-4 w-4 text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-700">Hafta & Gün Dengeleme</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Makroları hedefe yaklaştırmak için ⚖️ Dengele butonunu kullanın</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-green-100 shadow-sm flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                                        <ArrowRightLeft className="h-4 w-4 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-700">Yemek Değiştir & Tik Kaldır</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Beğenmediğiniz yemekleri alternatiflerle değiştirin veya yemek istemediğinizin tikini kaldırarak güncel makroları anında görün. Eksik makroları tamamlamak için arama kutusunu kullanın.</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-purple-100 shadow-sm flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                                        <BarChart3 className="h-4 w-4 text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-700">Makro Grafikleri</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Günlük ve haftalık grafiklerden hedef makrolara ne kadar yaklaştığınızı görün</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-xl p-3 border border-rose-100 shadow-sm flex items-start gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-rose-100 flex items-center justify-center shrink-0">
                                        <BookOpen className="h-5 w-5 text-rose-600" />
                                    </div>
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-700">Pratik Tarifler</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Yemeklerin yanındaki 📖 ikonuna tıklayarak pratik hazırlama tariflerine ve malzeme detaylarına anında ulaşın.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                // â”€â”€ WEEK HAS FOODS: Show normal UI â”€â”€
                return (
                    <>

                        {/* â”€â”€ STICKY TOP REGION (Day Selector + Dashboard + Menu Header) â”€â”€ */}
                        <div className="sticky top-0 sm:top-[74px] z-[40] bg-gray-50 flex flex-col shadow-[0_4px_10px_-5px_rgba(0,0,0,0.1)] rounded-b-xl border-b border-gray-200/60 pb-1.5 transition-all">
                            
                            {/* Day Selector & Action Buttons (Combined) */}
                            <div className="bg-white border-b border-gray-100 px-2 py-1.5 flex items-center justify-between shadow-sm z-50 rounded-t-xl sm:rounded-none">
                                
                                <div className="flex items-center">
                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => setSelectedDayIndex(prev => prev > 0 ? prev - 1 : weekDays.length - 1)}
                                        className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                                    >
                                        <ChevronLeft className="h-5 w-5" />
                                    </Button>
                                    
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" className="h-8 font-black text-xs sm:text-base text-emerald-700 uppercase hover:bg-emerald-50 px-2 flex gap-1">
                                                {currentDay?.day_name}
                                                <ChevronDown className="h-3 w-3 opacity-50" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start" className="w-40">
                                            {weekDays.map((day, index) => (
                                                <DropdownMenuItem 
                                                    key={day.id} 
                                                    onClick={() => setSelectedDayIndex(index)}
                                                    className={cn("font-bold uppercase", selectedDayIndex === index ? "bg-emerald-50 text-emerald-700" : "text-gray-600")}
                                                >
                                                    {day.day_name}
                                                </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => setSelectedDayIndex(prev => prev < weekDays.length - 1 ? prev + 1 : 0)}
                                        className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                                    >
                                        <ChevronRight className="h-5 w-5" />
                                    </Button>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                    {(() => {
                                        const allDayConsumed = currentDay?.diet_meals.every(m =>
                                            m.diet_foods.every(f => f.is_consumed)
                                        ) || false
                                        return (
                                            <button
                                                onClick={() => toggleAllDayConsumed(!allDayConsumed)}
                                                className={cn(
                                                    "h-8 px-2 sm:px-2.5 rounded-lg text-[10px] sm:text-[11px] font-bold transition-all flex items-center gap-1 border shadow-sm cursor-pointer",
                                                    allDayConsumed
                                                        ? "bg-green-100 border-green-200 text-green-700 hover:bg-green-200"
                                                        : "bg-white border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300"
                                                )}
                                                title={allDayConsumed ? "Tümünü Kaldır" : "Tümünü Seç"}
                                            >
                                                <CheckCheck size={14} />
                                                <span>SEÇ</span>
                                            </button>
                                        )
                                    })()}


                                    {/* PDF Download Button */}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 px-2 sm:px-3 bg-white border-red-200 shadow-sm hover:border-red-400 hover:bg-red-50 text-red-600 rounded-lg transition-all shrink-0 flex items-center gap-1.5"
                                        disabled={isPdfGenerating}
                                        onClick={async () => {
                                            try {
                                                setIsPdfGenerating(true)
                                                await generateWeeklyPlanPdf({
                                                    patientName: profile?.full_name || patientInfo?.full_name || 'Hasta',
                                                    weekNumber: activeWeek?.week_number || 1,
                                                    startDate: activeWeek?.start_date,
                                                    endDate: activeWeek?.end_date,
                                                    days: weekDays,
                                                    logoUrl: pdfBranding?.logoUrl,
                                                    footerText: pdfBranding?.footerText,
                                                    manualMatches: manualMatches || [],
                                                    bans: bans || [],
                                                    cards: cards || [],
                                                })
                                            } catch (err: any) {
                                                console.error('PDF oluşturma hatası:', err)
                                                await showAppModal('Hata', 'PDF oluştururken bir hata oluştu: ' + err.message, 'alert')
                                            } finally {
                                                setIsPdfGenerating(false)
                                            }
                                        }}
                                    >
                                        <FileDown className={cn("h-3.5 w-3.5 sm:h-4 w-4", isPdfGenerating && "animate-bounce")} />
                                        <span className="text-[10px] sm:text-xs font-bold whitespace-nowrap">
                                            {isPdfGenerating ? 'İndiriliyor...' : 'PDF'}
                                        </span>
                                    </Button>
                                </div>
                            </div>

                            {/* Macro Dashboard */}
                            <div className="px-1 z-40 relative">
                                <MacroDashboard
                                    totals={currentTotals}
                                    targets={dailyTargets}
                                    macroTargetMode="fixed"
                                    activeTab={dashboardTab}
                                    onTabChange={setDashboardTab}
                                    isVisible={isDashboardVisible}
                                    onClose={() => setIsDashboardVisible(false)}
                                    days={weekDays}
                                    patientInfo={patientInfo}
                                    activeWeek={activeWeek}
                                    activeDietType={activeDietType}
                                />
                            </div>
                        </div>

                        {/* Meals List - Contents */}
                        <div 
                            className="space-y-6 px-1.5 pb-32 mt-4" 
                            style={{ zIndex: 1, position: 'relative' }}
                            onTouchStart={onTouchStart}
                            onTouchMove={onTouchMove}
                            onTouchEnd={onTouchEnd}
                        >

                            {currentDay?.diet_meals.map((meal: any, mealIdx) => (
                                <Card key={meal.id} className="meal-section-container overflow-hidden border border-gray-200 shadow-sm bg-white mb-0 p-0 gap-0">
                                    <div className="pt-2 px-1.5 pb-2">
                                        {/* Unified Header & Content */}
                                        <div className="flex flex-col gap-0.5">
                                            {/* Meal Badge Header */}
                                            <div className="flex items-center justify-between mb-0">
                                                <div className={cn(
                                                    "px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider inline-flex items-center gap-1.5",
                                                    meal.meal_name.toLowerCase().includes('ara')
                                                        ? "bg-indigo-100 text-indigo-700"
                                                        : "bg-orange-100 text-orange-700"
                                                )}>
                                                    {meal.meal_name}
                                                    <span className="w-1 h-1 rounded-full bg-current opacity-50" />
                                                    <span className="text-[11px] opacity-70 font-bold">{meal.time}</span>
                                                </div>



                                                {/* Removed Daily Total Calories Badge from here */}
                                            </div>

                                            {/* Food List */}
                                            <div className="flex flex-col mt-0">
                                                {sortFoodsByRole(meal.diet_foods, (food: any) => food.role || food.foods?.role).map((food: any, idx: number) => {
                                                    const isSwappedByPatient = (food.original_food_id && food.swapped_by === 'patient') || originalCustomFoods.has(food.id) || (food as any)._was_custom || (() => {
                                                        try {
                                                            if (!food.custom_notes) return false;
                                                            const notes = typeof food.custom_notes === 'string' ? JSON.parse(food.custom_notes) : food.custom_notes;
                                                            return notes._is_backup === true;
                                                        } catch (e) { return false; }
                                                    })();
                                                    const showSwapUI = isSwappedByPatient
                                                    // Helper to determine the true source type
                                                    const getSourceType = (f: any) => {
                                                        let source = ''
                                                        try {
                                                            const notes = typeof f.custom_notes === 'string' ? JSON.parse(f.custom_notes) : (f.custom_notes || {})
                                                            source = notes.source || ''
                                                        } catch (e) { }

                                                        const isAiSearch = source === 'ai_text' || source === 'patient_ai_search'

                                                        // Handle various ways a photo log might be represented:
                                                        const isPhoto = source === 'ai_photo' || source === 'legacy_photo' ||
                                                            (food.is_custom && !isAiSearch && (food.swapped_by === 'patient' && food.original_food_id === null))

                                                        const isPatientSwap = food.swapped_by === 'patient' && food.original_food_id !== null

                                                        if (isAiSearch) return 'ai_search'
                                                        if (isPhoto) return 'photo'
                                                        if (isPatientSwap) return 'swap'
                                                        return 'default'
                                                    }

                                                    const sourceType = getSourceType(food)

                                                    const currentGlobalIdx = globalFoodIdx++;

                                                    return (
                                                        <div key={food.id} className="contents">
                                                        {/* === MOBILE FOOD ROW === */}
                                                        <div className={cn(
                                                            "md:hidden relative rounded-xl transition-all duration-200 mt-2 ml-3",
                                                            food.swapped_by === 'patient' && "ring-1 ring-blue-100/50",
                                                            idx !== meal.diet_foods.length - 1 && "mb-3"
                                                        )}>

                                                            {/* Main Card Content */}
                                                            <div 
                                                                className={cn(
                                                                    "py-3 pl-2 pr-2 rounded-xl cursor-pointer active:scale-[0.99] transition-all min-h-[3rem]",
                                                                    expandedFoodId === food.id ? "bg-slate-50/80 shadow-md ring-1 ring-slate-200/80" : "bg-white shadow-sm ring-1 ring-gray-100 hover:bg-gray-50/50",
                                                                    !food.is_consumed && "opacity-60 grayscale-[0.2]",
                                                                    food.swapped_by === 'patient' && "bg-blue-50/30"
                                                                )}
                                                                onClick={() => setExpandedFoodId(prev => prev === food.id ? null : food.id)}
                                                            >
                                                                <div className="flex items-center gap-2.5 relative">
                                                                    {/* Toggle Consumed Button */}
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            toggleMealConsumed(food.id, food.is_consumed || false)
                                                                        }}
                                                                        className={cn(
                                                                            "w-6 h-6 shrink-0 rounded-full flex items-center justify-center shadow-sm transition-colors border -ml-5",
                                                                            food.is_consumed 
                                                                                ? "bg-emerald-500 text-white border-emerald-600" 
                                                                                : "bg-white text-gray-300 border-gray-200 hover:bg-gray-50"
                                                                        )}
                                                                    >
                                                                        {food.is_consumed && <Check size={12} strokeWidth={3} />}
                                                                    </button>

                                                                    {/* Food Name */}
                                                                    <span className="text-[13px] font-medium leading-snug text-gray-800 flex-1">
                                                                        {food.swapped_by === 'patient' && (
                                                                            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 mr-1.5 align-middle">
                                                                                <User size={9} strokeWidth={3} />
                                                                            </span>
                                                                        )}
                                                                        {capitalizeSentenceFirstTR(getScaledFoodName(food.food_name, food.amount || 1, scalableUnits))}
                                                                    </span>

                                                                    {/* Floating Alternative Button (Truly Transparent & Centered) */}
                                                                    <CascadeButton
                                                                        globalIndex={currentGlobalIdx}
                                                                        showSwapUI={showSwapUI}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            if (showSwapUI) {
                                                                                handleRevert(meal.id, food)
                                                                            } else {
                                                                                handleSwapClick(meal.id, food, meal.diet_foods)
                                                                            }
                                                                        }}
                                                                    />
                                                                </div>

                                                                {/* Expanded Detail Panel */}
                                                                {expandedFoodId === food.id && (
                                                                    <div className="w-full mt-3 animate-in slide-in-from-top-2 fade-in duration-200 flex flex-col gap-2">
                                                                        {(() => {
                                                                            const matchResults = findRecipeMatch(
                                                                                food.food_name,
                                                                                manualMatches || [],
                                                                                bans || [],
                                                                                cards || [],
                                                                                !!(food.image_url || food.food_meta?.source === 'user_proposal' || food.is_custom)
                                                                            )
                                                                            
                                                                            return (
                                                                                <>
                                                                                    {/* Recipe Card (if any) */}
                                                                                    {matchResults.length > 0 && (
                                                                                        <div 
                                                                                            className="bg-emerald-50 rounded-xl p-3 flex items-center justify-between border border-emerald-100 cursor-pointer hover:bg-emerald-100 transition-colors shadow-sm"
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation()
                                                                                                setSelectedRecipe({ url: matchResults[0].url, name: matchResults[0].filename })
                                                                                                setRecipeDialogOpen(true)
                                                                                            }}
                                                                                        >
                                                                                            <div className="flex flex-col gap-0.5">
                                                                                                <span className="text-sm font-bold text-emerald-700">Tarifi Görüntüle</span>
                                                                                                <span className="text-[11px] font-medium text-emerald-600/80">{matchResults[0].filename}</span>
                                                                                            </div>
                                                                                            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                                                                                <BookOpenText size={16} />
                                                                                            </div>
                                                                                        </div>
                                                                                    )}

                                                                                    {/* Simple Macros with Delete Button */}
                                                                                    <div className="flex justify-between items-center w-full pt-2 border-t border-gray-100/80">
                                                                                        <div className="flex flex-wrap justify-center items-center gap-x-3 gap-y-1 text-[11px] font-medium text-gray-500 flex-1">
                                                                                            <span><strong className="text-gray-800 font-bold">{Math.round((food.calories || 0) * (food.amount || food.portion_multiplier || 1))}</strong> kcal</span>
                                                                                            <span>P: <strong className="text-gray-800 font-bold">{Math.round((food.protein || 0) * (food.amount || food.portion_multiplier || 1))}g</strong></span>
                                                                                            <span>K: <strong className="text-gray-800 font-bold">{Math.round((food.carbs || 0) * (food.amount || food.portion_multiplier || 1))}g</strong></span>
                                                                                            <span>Y: <strong className="text-gray-800 font-bold">{Math.round((food.fat || (food as any).fats || 0) * (food.amount || food.portion_multiplier || 1))}g</strong></span>
                                                                                        </div>
                                                                                        <button 
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation()
                                                                                                handleDeleteMeal(food.id)
                                                                                            }}
                                                                                            className="shrink-0 ml-2 w-7 h-7 bg-red-50 hover:bg-red-100 text-red-500 border border-red-100 rounded-full flex items-center justify-center shadow-sm transition-colors"
                                                                                            title="Yemeği Sil"
                                                                                        >
                                                                                            <Trash2 size={13} strokeWidth={2.5} />
                                                                                        </button>
                                                                                    </div>
                                                                                </>
                                                                            )
                                                                        })()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* === DESKTOP FOOD ROW === */}
                                                        <div key={food.id} className={cn(
                                                            "hidden md:flex items-center justify-between px-1 py-1.5 hover:bg-gray-50 transition-colors group rounded-md -mx-1",
                                                            food.swapped_by === 'patient' && "bg-blue-50/50 hover:bg-blue-100/50 border-blue-100/30 ring-1 ring-blue-100/20",
                                                            idx === meal.diet_foods.length - 1 && "pb-0",
                                                            idx !== meal.diet_foods.length - 1 && "border-b border-gray-50"
                                                        )}>
                                                            <div className="flex items-center gap-2 pr-1">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        toggleMealConsumed(food.id, food.is_consumed || false)
                                                                    }}
                                                                    className={cn(
                                                                        "w-7 h-7 shrink-0 rounded-full border-2 flex items-center justify-center transition-all duration-200 active:scale-90",
                                                                        (() => {
                                                                            if (food.is_consumed) {
                                                                                if (sourceType === 'ai_search') return "bg-gradient-to-br from-purple-400 to-purple-600 border-purple-500 text-white shadow-md shadow-purple-200"
                                                                                if (sourceType === 'photo') return "bg-gradient-to-br from-blue-400 to-blue-600 border-blue-500 text-white shadow-md shadow-blue-200"
                                                                                if (sourceType === 'swap') return "bg-gradient-to-br from-blue-400 to-blue-600 border-blue-500 text-white shadow-md shadow-blue-200"
                                                                                return "bg-gradient-to-br from-green-400 to-green-600 border-green-500 text-white shadow-md shadow-green-200"
                                                                            } else {
                                                                                if (sourceType === 'ai_search') return "border-purple-300 bg-white text-transparent hover:border-purple-400 hover:bg-purple-50 active:bg-purple-100"
                                                                                if (sourceType === 'photo') return "border-blue-300 bg-white text-transparent hover:border-blue-400 hover:bg-blue-50 active:bg-blue-100"
                                                                                if (sourceType === 'swap') return "border-blue-300 bg-white text-transparent hover:border-blue-400 hover:bg-blue-50 active:bg-blue-100"
                                                                                return "border-gray-300 bg-white text-transparent hover:border-green-400 hover:bg-green-50 active:bg-green-100"
                                                                            }
                                                                        })()
                                                                    )}
                                                                    style={{
                                                                        transform: food.is_consumed ? 'scale(1)' : 'scale(1)',
                                                                    }}
                                                                >
                                                                    {(() => {
                                                                        if (sourceType === 'ai_search') {
                                                                            return (
                                                                                <Sparkles
                                                                                    className={cn(
                                                                                        "w-4 h-4 transition-all duration-200",
                                                                                        food.is_consumed ? "scale-100 opacity-100" : "scale-50 opacity-0"
                                                                                    )}
                                                                                    strokeWidth={2}
                                                                                />
                                                                            )
                                                                        } else if (sourceType === 'photo') {
                                                                            return (
                                                                                <Camera
                                                                                    className={cn(
                                                                                        "w-4 h-4 transition-all duration-200",
                                                                                        food.is_consumed ? "scale-100 opacity-100" : "scale-50 opacity-0"
                                                                                    )}
                                                                                    strokeWidth={2}
                                                                                />
                                                                            )
                                                                        } else {
                                                                            return (
                                                                                <Check
                                                                                    className={cn(
                                                                                        "w-4 h-4 transition-all duration-200",
                                                                                        food.is_consumed ? "scale-100 opacity-100" : "scale-50 opacity-0"
                                                                                    )}
                                                                                    strokeWidth={3}
                                                                                />
                                                                            )
                                                                        }
                                                                    })()}
                                                                </button>
                                                            </div>

                                                            <div className="flex flex-col cursor-pointer flex-1 min-w-0 justify-center h-full pr-3 relative" onClick={() => handleSwapClick(meal.id, food, meal.diet_foods)}>
                                                                <div className="flex items-center gap-2">
                                                                    {food.swapped_by === 'patient' && (
                                                                        <div className="flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 shrink-0 shadow-sm border border-blue-200" title="Hasta tarafından eklendi veya değiştirildi">
                                                                            <User size={10} strokeWidth={3} />
                                                                        </div>
                                                                    )}
                                                                    {(() => {
                                                                        const hasCustomImage = !!food.image_url
                                                                        const isUserProposal = food.food_meta?.source === 'user_proposal'
                                                                        const skipAutoMatch = hasCustomImage || isUserProposal || !!food.is_custom
                                                                        const matchResults = findRecipeMatch(
                                                                            food.food_name,
                                                                            manualMatches || [],
                                                                            bans || [],
                                                                            cards || [],
                                                                            skipAutoMatch
                                                                        )

                                                                        if (matchResults.length > 0) {
                                                                            return (
                                                                                <div className="flex -space-x-1 shrink-0">
                                                                                    {matchResults.map((match, mIdx) => (
                                                                                        <Button
                                                                                            key={match.id}
                                                                                            variant="ghost"
                                                                                            size="icon"
                                                                                            className="h-4 w-4 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 shrink-0 relative"
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation()
                                                                                                setSelectedRecipe({ url: match.url, name: match.filename })
                                                                                                setRecipeDialogOpen(true)
                                                                                            }}
                                                                                            title={`Tarifi Görüntüle: ${match.filename}`}
                                                                                        >
                                                                                            <BookOpenText className="h-3 w-3" />
                                                                                            {matchResults.length > 1 && (
                                                                                                <span className="absolute bottom-0 right-0 text-[6px] font-bold bg-white/80 rounded-full px-0.5 leading-none border border-amber-200">
                                                                                                    {mIdx + 1}
                                                                                                </span>
                                                                                            )}
                                                                                        </Button>
                                                                                    ))}
                                                                                </div>
                                                                            )
                                                                        }
                                                                        return null
                                                                    })()}

                                                                        <span
                                                                            className={cn(
                                                                            "font-medium text-sm transition-colors leading-tight whitespace-normal text-left",
                                                                            findRecipeMatch(food.food_name, manualMatches || [], bans || [], cards || [], !!(food.image_url || food.food_meta?.source === 'user_proposal' || food.is_custom)).length > 0
                                                                                ? "text-gray-900 group-hover:text-green-700 cursor-pointer"
                                                                                : "text-gray-900 group-hover:text-green-700"
                                                                        )}
                                                                        onClick={(e) => {
                                                                            const matchResults = findRecipeMatch(
                                                                                food.food_name,
                                                                                manualMatches || [],
                                                                                bans || [],
                                                                                cards || [],
                                                                                !!(food.image_url || food.food_meta?.source === 'user_proposal' || food.is_custom)
                                                                            )
                                                                            if (matchResults.length > 0) {
                                                                                e.stopPropagation()
                                                                                setSelectedRecipe({ url: matchResults[0].url, name: matchResults[0].filename })
                                                                                setRecipeDialogOpen(true)
                                                                            }
                                                                        }}
                                                                    >

                                                                        {capitalizeSentenceFirstTR(getScaledFoodName(food.food_name, food.amount || 1, scalableUnits))}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1 shrink-0">
                                                                <div className="flex flex-col items-end justify-center h-full min-w-[3rem]">
                                                                    <span className="text-[11px] font-bold text-gray-700 tabular-nums leading-none">
                                                                        {Math.round((food.calories || 0) * (food.amount || food.portion_multiplier || 1))}
                                                                        <span className="text-[11px] text-gray-400">kcal</span>
                                                                    </span>
                                                                    <div className="flex gap-1 text-[11px] text-gray-400 font-medium leading-none mt-1">
                                                                        <span>P{Math.round((food.protein || 0) * (food.amount || food.portion_multiplier || 1))}</span>
                                                                        <span>K{Math.round((food.carbs || 0) * (food.amount || food.portion_multiplier || 1))}</span>
                                                                        <span>Y{Math.round((food.fat || (food as any).fats || 0) * (food.amount || food.portion_multiplier || 1))}</span>
                                                                    </div>
                                                                </div>

                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        if (showSwapUI) {
                                                                            handleRevert(meal.id, food)
                                                                        } else {
                                                                            handleSwapClick(meal.id, food, meal.diet_foods)
                                                                        }
                                                                    }}
                                                                    className={cn(
                                                                        "h-8 w-8 min-w-[32px] rounded-full transition-all ml-1",
                                                                        showSwapUI
                                                                            ? "bg-amber-50 text-amber-600 hover:bg-amber-100 ring-1 ring-amber-200"
                                                                            : "text-gray-300 hover:text-green-600 hover:bg-green-50"
                                                                    )}
                                                                    title={showSwapUI ? "Orijinale Dön" : "Alternatifiyle Değiştir"}
                                                                >
                                                                    {showSwapUI ? <RotateCcw size={16} className="animate-in fade-in zoom-in duration-300" /> : <ArrowRightLeft size={16} />}
                                                                </Button>

                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        handleDeleteMeal(food.id)
                                                                    }}
                                                                    className="h-8 w-8 min-w-[32px] rounded-full text-gray-300 hover:text-red-600 hover:bg-red-50 transition-all ml-1"
                                                                    title="Yemeği Sil"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        </div>
                                                    )

                                                })}
                                            </div>
                                        </div>

                                        {/* Inline Search + Add Food Button */}
                                        {(() => {
                                            // Calculate calorie gap for this day
                                            const consumedCals = meal.diet_foods.reduce((acc: number, f: any) => {
                                                if (!f.is_consumed) return acc
                                                const multiplier = Number(f.amount || f.portion_multiplier) || 1
                                                return acc + ((Number(f.calories) || 0) * multiplier)
                                            }, 0)
                                            const targetCals = dailyTargets?.calories || 2000
                                            const dayConsumed = currentDay?.diet_meals?.reduce((acc: number, m: any) => {
                                                return m.diet_foods.reduce((accInner: number, f: any) => {
                                                    if (!f.is_consumed) return accInner
                                                    const multiplier = Number(f.amount || f.portion_multiplier) || 1
                                                    return accInner + ((Number(f.calories) || 0) * multiplier)
                                                }, acc)
                                            }, 0) || 0
                                            const gap = Math.max(0, targetCals - dayConsumed)

                                            const targetProtein = dailyTargets?.protein || 0
                                            const dayProtein = currentDay?.diet_meals?.reduce((acc: number, m: any) => {
                                                return m.diet_foods.reduce((accInner: number, f: any) => {
                                                    if (!f.is_consumed) return accInner
                                                    const multiplier = Number(f.amount || f.portion_multiplier) || 1
                                                    return accInner + ((Number(f.protein) || 0) * multiplier)
                                                }, acc)
                                            }, 0) || 0
                                            const pGap = Math.max(0, targetProtein - dayProtein)

                                            const targetFat = dailyTargets?.fat || 0
                                            const dayFat = currentDay?.diet_meals?.reduce((acc: number, m: any) => {
                                                return m.diet_foods.reduce((accInner: number, f: any) => {
                                                    if (!f.is_consumed) return accInner
                                                    const multiplier = Number(f.amount || f.portion_multiplier) || 1
                                                    return accInner + (((Number(f.fat) || Number((f as any).fats)) || 0) * multiplier)
                                                }, acc)
                                            }, 0) || 0
                                            const fGap = Math.max(0, targetFat - dayFat)
                                            return (
                                                <div className="mt-3 ml-3 md:mt-2 md:ml-0 flex items-center gap-1.5">
                                                    <FoodSearchSelector
                                                        open={inlineSearchOpen === `${currentDay!.id}-${meal.meal_time}`}
                                                        patientId={patientInfo?.id}
                                                        onOpenChange={(open) => {
                                                            if (open) {
                                                                fetchFoods()
                                                                setInlineSearchOpen(`${currentDay!.id}-${meal.meal_time}`)
                                                            } else {
                                                                setInlineSearchOpen(null)
                                                            }
                                                        }}
                                                        foods={allFoods || []}
                                                        calorieGap={gap}
                                                        proteinGap={pGap}
                                                        fatGap={fGap}
                                                        onSelect={async (food) => {
                                                            setInlineSearchOpen(null)
                                                            const { data: existingMeals } = await supabase
                                                                .from('diet_meals')
                                                                .select('sort_order')
                                                                .eq('diet_day_id', currentDay!.id)
                                                                .eq('meal_time', meal.meal_time)
                                                                .order('sort_order', { ascending: false })
                                                                .limit(1)
                                                            const nextOrder = (existingMeals?.[0]?.sort_order || 0) + 1
                                                            const { error } = await supabase.from('diet_meals').insert([{
                                                                diet_day_id: currentDay!.id,
                                                                food_id: food.id,
                                                                meal_time: meal.meal_time,
                                                                portion_multiplier: 1,
                                                                sort_order: nextOrder,
                                                                is_consumed: true,
                                                                consumed_at: new Date().toISOString(),
                                                                swapped_by: 'patient',
                                                                calories: food.calories,
                                                                protein: food.protein,
                                                                carbs: food.carbs,
                                                                fat: food.fat
                                                            }])
                                                            if (error) alert("Hata: " + error.message)
                                                            else if (activeWeek) await fetchWeekDays(activeWeek.id)
                                                        }}
                                                        onCreate={async (name, foodData: any, source?: string) => {
                                                            setInlineSearchOpen(null)
                                                            const { data: existingMeals } = await supabase
                                                                .from('diet_meals')
                                                                .select('sort_order')
                                                                .eq('diet_day_id', currentDay!.id)
                                                                .eq('meal_time', meal.meal_time)
                                                                .order('sort_order', { ascending: false })
                                                                .limit(1)
                                                            const nextOrder = (existingMeals?.[0]?.sort_order || 0) + 1

                                                            if (foodData) {
                                                                const p = foodData.protein || 0
                                                                const c = foodData.carbs || 0
                                                                const f = foodData.fat || 0
                                                                const calories = foodData.calories || Math.round((p * 4) + (c * 4) + (f * 9))

                                                                const { error: proposalError } = await supabase.from('food_proposals').insert({
                                                                    user_id: user?.id || profile?.id || null,
                                                                    suggested_name: foodData.food_name || name,
                                                                    calories,
                                                                    protein: p,
                                                                    carbs: c,
                                                                    fat: f,
                                                                    portion_unit: foodData.unit || 'porsiyon',
                                                                    status: 'pending',
                                                                    ai_analysis: { source: source || 'patient_ai_search', query: name }
                                                                })
                                                                if (proposalError) console.error("Proposal error:", proposalError)

                                                                const newMealData: any = {
                                                                    diet_day_id: currentDay!.id,
                                                                    meal_time: meal.meal_time,
                                                                    portion_multiplier: 1,
                                                                    sort_order: nextOrder,
                                                                    is_consumed: true,
                                                                    consumed_at: new Date().toISOString(),
                                                                    swapped_by: 'patient',
                                                                    is_custom: true,
                                                                    custom_name: foodData.food_name || name,
                                                                    calories,
                                                                    protein: p,
                                                                    carbs: c,
                                                                    fat: f
                                                                }

                                                                if (source === 'ai_text') {
                                                                    newMealData.custom_notes = JSON.stringify({ source: 'ai_text' })
                                                                }

                                                                const { error } = await supabase.from('diet_meals').insert([newMealData])

                                                                if (error) alert("Hata: " + error.message)
                                                                else if (activeWeek) fetchWeekDays(activeWeek.id)
                                                            } else {
                                                                const { error } = await supabase.from('diet_meals').insert([{
                                                                    diet_day_id: currentDay!.id,
                                                                    meal_time: meal.meal_time,
                                                                    portion_multiplier: 1,
                                                                    sort_order: nextOrder,
                                                                    is_consumed: true,
                                                                    consumed_at: new Date().toISOString(),
                                                                    swapped_by: 'patient',
                                                                    is_custom: true,
                                                                    custom_name: name,
                                                                    calories: 0,
                                                                    protein: 0,
                                                                    carbs: 0,
                                                                    fat: 0
                                                                }])

                                                                if (error) alert("Hata: " + error.message)
                                                                else if (activeWeek) fetchWeekDays(activeWeek.id)
                                                            }
                                                        }}
                                                        trigger={null}
                                                        variant="inline"
                                                    />
                                                    <button
                                                        onClick={(e) => {
                                                            setInlineSearchOpen(`${currentDay!.id}-${meal.meal_time}`);
                                                            // Scroll the meal container into view
                                                            setTimeout(() => {
                                                                const mealContainer = e.currentTarget.closest('.meal-section-container');
                                                                if (mealContainer) {
                                                                    mealContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                                }
                                                            }, 100);
                                                        }}
                                                        className={cn(
                                                            "py-3 px-3 rounded-xl transition-all flex items-center justify-center group shrink-0 bg-white shadow-sm ring-1 ring-gray-100 hover:bg-gray-50/50 cursor-pointer",
                                                            (meal.diet_foods.length === 0 || (highlightSequence.isActive && highlightSequence.activeIndex === mealIdx))
                                                                ? "border-yellow-400 bg-yellow-100/80 text-yellow-800 animate-pulse ring-2 ring-yellow-200 ring-offset-1"
                                                                : "text-gray-400 hover:text-green-600"
                                                        )}
                                                        title="Metin ile Ara"
                                                    >
                                                        <Plus size={18} className="group-hover:scale-110 transition-transform" />
                                                    </button>
                                                    <PhotoMealLogModal
                                                        dayId={currentDay!.id}
                                                        mealTime={meal.meal_time}
                                                        patientDietType={activeDietType?.name || patientInfo?.diet_type}
                                                        patientId={patientInfo?.id || ''}
                                                        onSave={() => {
                                                            setRefreshTrigger(prev => prev + 1)
                                                            if (activeWeek) fetchWeekDays(activeWeek.id)
                                                        }}
                                                        trigger={
                                                            <button 
                                                                className={cn(
                                                                    "py-3 px-3 rounded-xl transition-all flex items-center justify-center group shrink-0 bg-white shadow-sm ring-1 ring-gray-100 hover:bg-gray-50/50 cursor-pointer",
                                                                    (meal.diet_foods.length === 0 || (highlightSequence.isActive && highlightSequence.activeIndex === mealIdx))
                                                                        ? "border-blue-400 bg-blue-100/80 text-blue-800 animate-pulse ring-2 ring-blue-200 ring-offset-1"
                                                                        : "text-gray-400 hover:text-blue-600"
                                                                )}
                                                                title="Fotoğraf ile Ekle"
                                                            >
                                                                <Camera size={18} className="group-hover:scale-110 transition-transform" />
                                                            </button>
                                                        }
                                                    />
                                                </div>
                                            )
                                        })()}
                                    </div>
                                </Card>
                            ))}

                            {/* NOTES SECTION */}
                            {currentDay && (currentDay.notes || (currentDay.diet_notes && currentDay.diet_notes.length > 0)) && (
                                <div className="mx-2 mb-2 mt-4 space-y-2">
                                    {currentDay.notes && (
                                        <div className="p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
                                            <div className="flex items-start gap-2">
                                                <StickyNote className="h-4 w-4 text-green-600 mt-1 shrink-0" />
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-green-700 uppercase mb-1">DİYETİSYEN NOTU</span>
                                                    <p className="text-sm text-gray-700 leading-relaxed italic">{currentDay.notes}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {currentDay.diet_notes?.map((note: any) => (
                                        <div key={note.id} className="p-3 bg-amber-50/50 rounded-xl border border-amber-100/50 shadow-sm">
                                            <div className="flex items-start gap-2">
                                                <StickyNote className="h-4 w-4 text-amber-600 mt-1 shrink-0" />
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-amber-700 uppercase mb-1">GÜNLÜK TAVSİYE</span>
                                                    <p className="text-[11px] text-gray-700 leading-relaxed italic whitespace-pre-wrap">{note.content}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Food Alternative Dialog */}
                        {
                            swapSheetOpen && foodToSwap && (
                                <FoodAlternativeDialog
                                    isOpen={swapSheetOpen}
                                    onClose={() => setSwapSheetOpen(false)}
                                    originalFood={{
                                        id: foodToSwap.food.real_food_id,
                                        name: foodToSwap.food.food_name,
                                        calories: foodToSwap.food.calories,
                                        protein: foodToSwap.food.protein,
                                        carbs: foodToSwap.food.carbs,
                                        fat: foodToSwap.food.fats,
                                        portion_unit: foodToSwap.food.unit,
                                        portion_multiplier: foodToSwap.food.amount || foodToSwap.food.portion_multiplier || 1,
                                        role: foodToSwap.food.role,
                                        category: foodToSwap.food.category,
                                        diet_type: [
                                            foodToSwap.food.keto ? 'ketojenik' : '',
                                            foodToSwap.food.lowcarb ? 'lowcarb' : '',
                                            foodToSwap.food.vegan ? 'vegan' : '',
                                            foodToSwap.food.vejeteryan ? 'vejeteryan' : ''
                                        ].filter(Boolean).join(', '),
                                        meal_types: foodToSwap.food.meal_types,
                                        compatibility_tags: foodToSwap.food.compatibility_tags,
                                        food_meta: foodToSwap.food.food_meta || (foodToSwap.food as any).foods?.food_meta,
                                        min_quantity: foodToSwap.food.min_quantity ?? (foodToSwap.food as any).foods?.min_quantity,
                                        max_quantity: foodToSwap.food.max_quantity ?? (foodToSwap.food as any).foods?.max_quantity,
                                        step: foodToSwap.food.step ?? (foodToSwap.food as any).foods?.step
                                    }}
                                    onSelect={handleSwapConfirm}
                                    patientId={activePlan?.patient_id}
                                    // Pass Calculated Context for "Goal Gap" and "Main Dish" logic
                                    dailyTotals={(() => {
                                        return currentDay?.diet_meals.reduce((acc, m) => {
                                            // Note: f.amount holds the portion_multiplier value from data transformation (line 366)
                                            const mCal = m.diet_foods.reduce((a, f) => a + ((f.calories || 0) * (f.amount || 1)), 0)
                                            const mPro = m.diet_foods.reduce((a, f) => a + ((f.protein || 0) * (f.amount || 1)), 0)
                                            const mCarb = m.diet_foods.reduce((a, f) => a + ((f.carbs || 0) * (f.amount || 1)), 0)
                                            const mFat = m.diet_foods.reduce((a, f) => a + (((f.fat || f.fats || 0) as number) * (f.amount || 1)), 0)
                                            return {
                                                calories: acc.calories + mCal,
                                                protein: acc.protein + mPro,
                                                carbs: acc.carbs + mCarb,
                                                fat: acc.fat + mFat
                                            }
                                        }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
                                    })()}
                                    dailyTargets={(() => {
                                        if (patientInfo?.weight) {
                                            return calculateDailyTargets(
                                                patientInfo.weight,
                                                activeWeek?.activity_level || patientInfo.activity_level || 3,
                                                activeDietType,
                                                patientInfo?.patient_goals
                                            )
                                        }
                                        return null
                                    })()}
                                    // Health Data
                                    activeDietRules={activeDietType}
                                    patientDiseases={patientDiseases}
                                    patientLabs={patientLabs}
                                    patientMedicationRules={patientMedicationRules}
                                    mainDishOfSlot={(() => {
                                        // Find potential main dish in the SAME meal slot
                                        // Looks for role "ana yemek"
                                        if (!foodToSwap.slotFoods || foodToSwap.slotFoods.length === 0) {
                                            return null
                                        }

                                        const mainDish = foodToSwap.slotFoods.find(f => {
                                            const role = (f.role || "").toLowerCase()
                                            return role.includes("ana yemek") || role.includes("maindish") || role === "main"
                                        })
                                        return mainDish
                                    })()}
                                    nearbyUsedFoodIds={(() => {
                                        // Collect all foods used in this week
                                        if (!weekDays) return []
                                        const ids = new Set<string>()
                                        weekDays.forEach(day => {
                                            day.diet_meals.forEach(m => {
                                                m.diet_foods.forEach(f => {
                                                    if (f.real_food_id) ids.add(f.real_food_id)
                                                })
                                            })
                                        })
                                        return Array.from(ids)
                                    })()}
                                    originalFoodToRevertId={foodToSwap.food.original_food_id}
                                    hideSettings={true}
                                />
                            )
                        }

                        {/* Smart Swap Dialog - Toplu değişiklik sorusu */}
                        {
                            smartSwapData?.isOpen && (
                                <SmartSwapDialog
                                    isOpen={smartSwapData.isOpen}
                                    onClose={() => setSmartSwapData(null)}
                                    onConfirmSingle={() => handleSmartSwapConfirm(false)}
                                    onConfirmAll={() => handleSmartSwapConfirm(true)}
                                    matchCount={smartSwapData.matchCount}
                                    slotName={smartSwapData.slotName}
                                    newFoodName={smartSwapData.newFood?.name || ''}
                                    oldFoodName={smartSwapData.oldFoodName || ''}
                                />
                            )
                        }

                        {
                            selectedRecipe && (
                                <RecipeCardDialog
                                    isOpen={recipeDialogOpen}
                                    onClose={() => setRecipeDialogOpen(false)}
                                    cardUrl={selectedRecipe.url}
                                    cardName={selectedRecipe.name}
                                />
                            )
                        }

                        {
                            isMealTemplateModalOpen && (
                                <SettingsDialog
                                    open={isMealTemplateModalOpen}
                                    onOpenChange={setIsMealTemplateModalOpen}
                                    patientId={patientInfo?.id}
                                    programTemplateId={patientInfo?.program_template_id}
                                    activeWeekId={activeWeek?.id}
                                    defaultTab="slots"
                                    hideRevertButton={true}
                                    slotsOnly={true}
                                    onSettingsChanged={async () => {
                                        await fetchActivePlan()
                                    }}
                                />
                            )
                        }

                        {
                            isEditingWeek && activeWeek && (
                                <Dialog open={isEditingWeek} onOpenChange={setIsEditingWeek}>
                                    <DialogContent className="sm:max-w-[425px]">
                                        <DialogHeader>
                                            <DialogTitle>Hafta Düzenle</DialogTitle>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="space-y-2">
                                                <Label>Hafta Adı</Label>
                                                <Input
                                                    id="week-title"
                                                    defaultValue={activeWeek.title || `${activeWeek.week_number}. Hafta`}
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Başlangıç Tarihi</Label>
                                                    <Input
                                                        type="date"
                                                        id="week-start-date"
                                                        defaultValue={activeWeek.start_date ? new Date(activeWeek.start_date).toISOString().split('T')[0] : ''}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Bitiş Tarihi</Label>
                                                    <Input
                                                        type="date"
                                                        id="week-end-date"
                                                        defaultValue={activeWeek.end_date ? new Date(activeWeek.end_date).toISOString().split('T')[0] : ''}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button variant="outline" onClick={() => setIsEditingWeek(false)}>İptal</Button>
                                            <Button
                                                onClick={() => {
                                                    const title = (document.getElementById('week-title') as HTMLInputElement).value;
                                                    const start = (document.getElementById('week-start-date') as HTMLInputElement).value;
                                                    const end = (document.getElementById('week-end-date') as HTMLInputElement).value;
                                                    handleUpdateWeek(activeWeek.id, title, start, end);
                                                }}
                                            >
                                                Kaydet
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            )
                        }

                    </>
                )
            })()}

            {/* Animated Planning Modal - UPDATED THEME */}
            {planningPhase !== 'idle' && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-emerald-500/20 rounded-3xl p-8 w-full max-w-sm shadow-[0_0_40px_-10px_rgba(16,185,129,0.3)] overflow-hidden relative">
                        {/* Subtle background glow */}
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-teal-500/10 pointer-events-none" />

                        {planningPhase === 'confirm' && (
                            <div className="flex flex-col items-center text-center animate-in fade-in zoom-in duration-300 relative z-10">
                                <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mb-5 text-amber-400 border border-amber-500/30">
                                    <AlertTriangle size={32} />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">Otomatik Planlama</h3>
                                <p className="text-sm text-gray-400 mb-8">Bu hafta için otomatik plan oluşturulsun mu? Mevcut hazırlanan öğünler tamamen silinip yeniden yazılacaktır.</p>
                                <div className="flex w-full gap-3">
                                    <Button variant="ghost" className="flex-1 rounded-xl text-gray-300 hover:text-white hover:bg-slate-800" onClick={() => setPlanningPhase('idle')}>İptal</Button>
                                    <Button className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/50" onClick={executeAutoGenerate}>Tamam, Oluştur</Button>
                                </div>
                            </div>
                        )}

                        {planningPhase === 'planning' && (
                            <div className="flex flex-col items-center text-center py-4 animate-in fade-in zoom-in-95 duration-500 relative z-10">
                                <div className="relative w-24 h-24 mb-8">
                                    {/* Outer rotating ring */}
                                    <div className="absolute inset-0 rounded-full border-4 border-slate-800 border-t-emerald-500 animate-spin"></div>
                                    <div className="absolute inset-2 rounded-full border-4 border-slate-800 border-b-teal-400 animate-[spin_2s_linear_reverse_infinite] opacity-50"></div>
                                    {/* Inner pulsing icon */}
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <Wand2 size={36} className="text-emerald-400 animate-bounce" />
                                    </div>
                                </div>
                                <h3 className="text-lg font-bold text-white mb-3">Planınız Hazırlanıyor...</h3>

                                {/* Dynamic progress messaging */}
                                <div className="h-6 overflow-hidden mb-6">
                                    <p className="text-sm text-emerald-400/80 font-medium animate-pulse">
                                        {planningMessages[planningMessageIndex]}
                                    </p>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden shadow-inner">
                                    <div
                                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500 ease-out rounded-full relative"
                                        style={{ width: `${planningProgress}%` }}
                                    >
                                        <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite] w-full" style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)' }}></div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {planningPhase === 'success' && (
                            <div className="flex flex-col items-center text-center py-2 animate-in fade-in zoom-in-95 duration-500 relative z-10">
                                <div className="w-20 h-20 bg-emerald-500/20 rounded-2xl flex items-center justify-center mb-6 text-emerald-400 border border-emerald-500/30 relative group">
                                    <Check size={40} className="animate-[spring_0.5s_ease-out]" />
                                    <div className="absolute inset-0 rounded-2xl border border-emerald-400 animate-ping opacity-30"></div>
                                </div>
                                <h3 className="text-2xl font-bold text-white mb-2">Hazır</h3>
                                <p className="text-gray-400 mb-8">Haftalık beslenme planınız hazırlandı.</p>
                                <Button
                                    className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-6 text-lg shadow-[0_0_20px_-5px_rgba(16,185,129,0.5)] transition-all hover:scale-[1.02]"
                                    onClick={() => setPlanningPhase('idle')}
                                >
                                    Plana Göz At
                                </Button>
                            </div>
                        )}

                    </div>
                </div>
            )}

            {/* PDF Generation Loader Overlay */}
            {isPdfGenerating && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-red-500/20 rounded-3xl p-8 w-full max-w-sm shadow-[0_0_50px_-10px_rgba(239,68,68,0.2)] overflow-hidden relative">
                        {/* Subtle background glow */}
                        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-orange-500/10 pointer-events-none" />
                        
                        <div className="flex flex-col items-center text-center py-4 relative z-10">
                            <div className="relative w-24 h-24 mb-8">
                                {/* Outer rotating rings */}
                                <div className="absolute inset-0 rounded-full border-4 border-slate-800 border-t-red-500 animate-spin"></div>
                                <div className="absolute inset-2 rounded-full border-4 border-slate-800 border-b-orange-400 animate-[spin_2s_linear_reverse_infinite] opacity-50"></div>
                                <div className="absolute inset-4 rounded-full border-2 border-slate-700/30 animate-[pulse_1.5s_ease-in-out_infinite]"></div>
                                
                                {/* Inner pulsing icon */}
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <FileDown size={36} className="text-red-400 animate-bounce" />
                                </div>
                            </div>
                            
                            <h3 className="text-xl font-bold text-white mb-3">PDF Dosyanız Hazırlanıyor</h3>
                            <div className="h-10 overflow-hidden mb-6">
                                <p className="text-sm text-gray-400 font-medium animate-pulse leading-snug">
                                    {pdfMessages[pdfMessageIndex]}
                                </p>
                            </div>
                            
                            {/* Loading Progress Bar Indicator (Infinite) */}
                            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden shadow-inner">
                                <div className="h-full bg-gradient-to-r from-red-500 to-orange-400 rounded-full w-full animate-[shimmer_1.5s_infinite]" 
                                     style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)' }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Balance / Flavor Loader Overlay */}
            {isTuneLoading && (
                <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/65 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-emerald-500/20 rounded-3xl p-8 w-full max-w-sm shadow-[0_0_50px_-10px_rgba(16,185,129,0.25)] overflow-hidden relative">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-teal-500/10 pointer-events-none" />

                        <div className="flex flex-col items-center text-center py-4 relative z-10">
                            <div className="relative w-24 h-24 mb-8">
                                <div className="absolute inset-0 rounded-full border-4 border-slate-800 border-t-emerald-500 animate-spin"></div>
                                <div className="absolute inset-2 rounded-full border-4 border-slate-800 border-b-teal-400 animate-[spin_2s_linear_reverse_infinite] opacity-50"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    {tuneLoadMode === 'flavor'
                                        ? <UtensilsCrossed size={34} className="text-emerald-400 animate-pulse" />
                                        : <Scale size={34} className="text-emerald-400 animate-pulse" />}
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-white mb-2">
                                {tuneLoadMode === 'flavor'
                                    ? `${tuneLoadScope === 'daily' ? 'Günlük' : 'Haftalık'} Lezzet Ayarı`
                                    : `${tuneLoadScope === 'daily' ? 'Günlük' : 'Haftalık'} Dengeleme`}
                            </h3>
                            <p className="text-sm text-emerald-300/85 mb-6 min-h-5">
                                {tuneMessages[tuneMessageIndex]}
                            </p>

                            <div className="w-full mb-2 text-[11px] text-emerald-200/80 flex items-center justify-between">
                                <span>Aşama: {tuneLoadStep === 'analyzing' ? 'Analiz' : 'Uygulama'}</span>
                                <span>{Math.round(tuneProgress)}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden shadow-inner">
                                <div
                                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300 ease-out relative"
                                    style={{ width: `${Math.max(8, Math.min(98, tuneProgress))}%` }}
                                ></div>
                            </div>
                            <p className="text-[11px] text-emerald-200/70 mt-2 min-h-4">
                                {tuneEtaSec !== null ? `Yaklaşık ${Math.max(1, tuneEtaSec)} sn kaldı` : 'Hazırlanıyor...'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Global Themed App Modal for Alerts and Confirms */}
            {appModal.isOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-emerald-500/20 rounded-3xl p-7 w-full max-w-sm shadow-[0_0_40px_-10px_rgba(16,185,129,0.3)] overflow-hidden relative animate-in zoom-in-95 duration-200">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-teal-500/10 pointer-events-none" />

                        <div className="flex flex-col items-center text-center relative z-10">
                            {/* Icon based on type */}
                            <div className={cn(
                                "w-16 h-16 rounded-2xl flex items-center justify-center mb-5 border",
                                appModal.type === 'success' ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                                    appModal.type === 'warning' || appModal.type === 'confirm' ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
                                        "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"
                            )}>
                                {appModal.type === 'success' && <Check size={32} />}
                                {(appModal.type === 'warning' || appModal.type === 'confirm') && <AlertTriangle size={32} />}
                                {appModal.type === 'alert' && <Info size={32} />}
                            </div>

                            <h3 className="text-xl font-bold text-white mb-3">{appModal.title}</h3>

                            <div className="text-sm text-gray-300 mb-8 max-h-[40vh] overflow-y-auto w-full px-2" style={{ whiteSpace: 'pre-line' }}>
                                {appModal.message}
                            </div>

                            <div className="flex w-full gap-3 mt-auto">
                                {appModal.type === 'confirm' && (
                                    <Button variant="ghost" className="flex-1 rounded-xl text-gray-300 hover:text-white hover:bg-slate-800" onClick={() => { appModal.resolve?.(false); setAppModal(prev => ({ ...prev, isOpen: false })) }}>İptal</Button>
                                )}
                                <Button
                                    className={cn(
                                        "flex-1 rounded-xl text-white shadow-lg transition-all hover:scale-[1.02]",
                                        appModal.type === 'success' ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/50" :
                                            appModal.type === 'confirm' ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/50" :
                                                "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/50"
                                    )}
                                    onClick={() => { appModal.resolve?.(true); setAppModal(prev => ({ ...prev, isOpen: false })) }}
                                >
                                    {appModal.type === 'confirm' ? "Onayla" : "Tamam"}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Copied Week Initialization Modal */}
            <CopiedWeekInitModal 
                open={copiedWeekInitModalOpen}
                onOpenChange={setCopiedWeekInitModalOpen}
                defaultWeight={patientInfo?.weight || null}
                defaultActivity={patientInfo?.activity_level || null}
                onSave={handleCopiedWeekInitSave}
                isPatientApp={true}
            />

            {/* Weight / Activity Modal */}
            <Dialog open={isWeightModalOpen} onOpenChange={setIsWeightModalOpen}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle>Kilo ve Aktivite Güncelle</DialogTitle>
                        <DialogDescription className="text-xs text-gray-400">
                            Haftalık gelişiminizi takip etmek için güncel bilgilerinizi giriniz.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-1 max-h-[80vh] overflow-y-auto px-1 scrollbar-hide">
                        <div className="space-y-1">
                            <Label className="text-emerald-700 font-bold text-[11px] uppercase tracking-tight">Güncel Kilonuz (kg)</Label>
                            <Input 
                                type="number" 
                                value={editWeight} 
                                onChange={e => setEditWeight(e.target.value)} 
                                placeholder="Örn: 75"
                                className="border-emerald-100 focus:ring-emerald-500 h-9 text-base"
                            />
                        </div>

                        {measurementDefs.length > 0 && (
                            <div className="pt-1 space-y-2">
                                <Label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Vücut Ölçümleri</Label>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                                    {measurementDefs.map(def => (
                                        <div key={def.id} className="space-y-0.5">
                                            <Label className="text-[10px] font-bold text-gray-600 truncate block">
                                                {def.name} {def.unit ? `(${def.unit})` : ''}
                                            </Label>
                                            <Input 
                                                type="number"
                                                value={editMeasurements[def.id] || ''}
                                                onChange={e => setEditMeasurements(prev => ({ ...prev, [def.id]: e.target.value }))}
                                                placeholder="-"
                                                className="h-8 text-sm px-2"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="space-y-1 pt-2">
                            <div className="flex items-baseline justify-between px-1">
                                <Label className="text-emerald-700 font-bold text-[11px] uppercase tracking-tight">Günlük Aktivite Seviyeniz</Label>
                                {editActivity && <span className="text-[10px] font-bold text-amber-600 animate-pulse">Seçildi</span>}
                            </div>
                            <Select value={editActivity} onValueChange={setEditActivity}>
                                <SelectTrigger className={cn(
                                    "transition-all h-10 border-2",
                                    editActivity 
                                        ? "bg-amber-50 border-amber-300 text-amber-900 font-semibold shadow-sm" 
                                        : "border-emerald-100 bg-emerald-50/30"
                                )}>
                                    <SelectValue placeholder="Seçiniz..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">Sedanter (Masa başı iş, az egzersiz)</SelectItem>
                                    <SelectItem value="2">Hafif Aktif (1-3 gün/hafta spor)</SelectItem>
                                    <SelectItem value="3">Orta Aktif (3-5 gün/hafta spor)</SelectItem>
                                    <SelectItem value="4">Çok Aktif (6-7 gün/hafta spor)</SelectItem>
                                    <SelectItem value="5">Aşırı Aktif (Fiziksel iş veya çok sert spor)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter className="flex-row gap-2 pt-2 border-t mt-2">
                        <Button variant="ghost" className="flex-1 h-10" onClick={() => setIsWeightModalOpen(false)}>İptal</Button>
                        <Button onClick={saveWeightActivity} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white h-10 font-bold">Kaydet</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Balance Confirm Modal */}
            <BalanceConfirmModal
                isOpen={balanceModal.isOpen}
                title={balanceModal.title}
                changes={balanceModal.changes}
                initialTotals={balanceModal.initialTotals}
                targetMacros={balanceModal.targetMacros}
                macroDisplayDivisor={balanceModal.macroDisplayDivisor}
                defaultSelectAll={balanceModal.defaultSelectAll}
                onClose={() => {
                    balanceModal.resolve?.(null)
                    setBalanceModal(prev => ({ ...prev, isOpen: false }))
                }}
                onConfirm={(approvedChanges) => {
                    balanceModal.resolve?.(approvedChanges)
                    setBalanceModal(prev => ({ ...prev, isOpen: false }))
                }}
            />

            {/* Floating ÖZET Button */}
            <Button
                onClick={toggleDashboard}
                className={cn(
                    "fixed right-4 bottom-20 z-50 h-14 w-14 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col items-center justify-center border-2 transition-all hover:scale-105 active:scale-95",
                    isDashboardVisible
                        ? "bg-white border-purple-100 text-gray-600 hover:bg-gray-50"
                        : "bg-gradient-to-tr from-purple-600 to-indigo-500 border-purple-400/50 text-white shadow-[0_8px_30px_rgba(147,51,234,0.3)]"
                )}
            >
                <BarChart3 className="h-6 w-6" />
                <span className="text-[9px] font-bold mt-0.5">ÖZET</span>
            </Button>
        </div>
    )
}


