"use client"
import { checkCompatibility, DietRules } from "@/utils/compatibility-checker"

import { useState, useEffect, use, useMemo, useRef } from "react"
import { createPortal } from "react-dom"
import { supabase } from "@/lib/supabase"
import { applyTeamFoodOverrides, upsertTeamFoodOverride } from "@/lib/team-food-overrides"
import {
    applyTeamFoodMicronutrientOverrides,
    getFoodMicronutrientMapByScope,
    saveFoodMicronutrientsByScope
} from "@/lib/team-food-micronutrient-overrides"
import { applyTeamDietTypeOverrides } from "@/lib/team-diet-type-overrides"
import { applyProgramDietTypeOverrides } from "@/lib/program-diet-type-overrides"
import { resolveTeamScopeContextForUser } from "@/lib/team-scope"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Plus, Calendar, Save, Calculator, ChefHat, FileText, ChevronRight, ChevronLeft, MoreHorizontal, Copy, Pencil, Trash2, Sliders, X, AlertTriangle, Settings, RefreshCw, Wand2, Search, Filter, BookOpenText, Printer, ArrowLeft, Heart, Info, Archive, LayoutGrid, List, StickyNote, Activity, Menu, RotateCcw, Eraser, Grid3X3, Sparkles, Lock, Unlock, ChevronUp, ChevronDown, Camera, Image, ClipboardList, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { FoodSidebar, FoodEditDialog } from "@/components/diet/food-sidebar"
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useDroppable } from "@dnd-kit/core"
import { WeekImportDialog, ParsedDay } from '@/components/diet/week-import-dialog'
import { MealEditDialog } from "@/components/diet/meal-edit-dialog"
import { MealTemplateDialog } from "@/components/diet/meal-template-dialog"
import { useAuth } from "@/contexts/auth-context"
import { LockManagerDialog } from "@/components/diet/lock-manager-dialog"
import { PatientAssignmentDialog } from "@/components/diet/patient-assignment-dialog"
import { WeekCopyDialog } from "@/components/diet/week-copy-dialog"
import { createPatientWithAuth } from "@/actions/patient-actions"
import { PatientProfileDialog } from "@/components/diet/patient-profile-dialog"
import { useAppModal } from "@/contexts/app-modal-context"
import { PatientNotesSheet } from "@/components/diet/patient-notes-sheet"
import { PatientMeasurements } from "@/components/diet/patient-measurements"
import { DietTypesEditor } from "@/components/diet/diet-types-editor"
import { FoodAlternativeDialog } from '@/components/diet/food-alternative-dialog'
import { WeekOverrideEditor } from "@/components/planner/editors/week-override-editor"
import { NutritionalEditor } from "@/components/planner/editors/nutritional-editor"
import { RotationEditor } from "@/components/planner/editors/rotation-editor"
import { WeekLoopEditor } from "@/components/planner/editors/week-loop-editor"
import { CopiedWeekInitModal } from "@/components/planner/editors/copied-week-init-modal"
import { usePlannerMetadata } from "@/hooks/use-planner-metadata"
import { FoodSearchSelector } from '@/components/diet/food-search-selector'
import { ArchivedPlansDialog } from "@/components/diet/archived-plans-dialog"
import { useRecipeManager } from "@/hooks/use-recipe-manager"
import { findRecipeMatch } from "@/utils/recipe-matcher"
import { RecipeCardDialog } from "@/components/patient/recipe-card-dialog"
import { Planner } from "@/lib/planner/engine3"
import { AutoPlanDialog } from "@/components/diet/auto-plan-dialog"
import { SnapshotsDialog } from '@/components/diet/snapshots-dialog'
import PatientAnalysisPanel from '@/components/diet/PatientAnalysisPanel'
import { PhotoMealLogModal } from "@/components/diet/photo-meal-log-modal"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { SmartSwapDialog } from "@/components/diet/smart-swap-dialog"
import { SettingsDialog } from "@/components/planner/settings-dialog"
import { useScalableUnits, getScaledFoodName } from "@/lib/planner/portion-scaler"
import { sortFoodsByRole } from "@/utils/food-sorter"
import { PatientRulesDialog } from "@/components/planner/patient-rules-dialog"
import { useSidebar } from "@/contexts/sidebar-context"


// JavaScript getDay(): 0=Pazar, 1=Pazartesi, ..., 6=Cumartesi
const DAY_NAMES_JS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

type Patient = {
    id: string
    full_name: string
    notes: string | null
    birth_date?: string | null
    height?: number | null
    weight?: number | null
    gender?: 'male' | 'female'
    activity_level?: number
    liked_foods?: string[] | null
    disliked_foods?: string[] | null
    status?: 'active' | 'archived' // Added status
    show_meal_badges?: boolean // Badge visibility preference
    sidebar_sort_preference?: 'asc' | 'desc' | null // Sidebar sort preference
    visibility_settings?: {
        max_future_weeks: number
        allow_past: boolean
    }
    macro_target_mode?: 'calculated' | 'plan'
    patient_goals?: string[]
    program_template_id?: string | null
    program_templates?: any | null
    diet_type?: string | null
    planning_rules?: any[]
}

interface SlotConfig {
    name: string
    min_items: number
    max_items: number
}

type DietWeek = {
    id: string
    week_number: number
    title: string | null
    start_date: string | null
    end_date: string | null
    meal_types?: string[] | null
    slot_configs?: { name: string; min_items: number; max_items: number }[] | null
    weight_log?: number | null
    assigned_diet_type_id?: string | null
    activity_level_log?: number | null
}

function getNextMonday(date: Date): Date {
    const d = new Date(date)
    const day = d.getDay()
    const diff = day === 0 ? 1 : 8 - day
    d.setDate(d.getDate() + diff)
    return d
}


// Helper to format date
function formatDate(date: Date) {
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function formatShortDate(date: Date) {
    return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(date)
}

function formatDateISO(date: Date): string {
    return date.toISOString().split('T')[0]
}

function getMonday(date: Date): Date {
    const d = new Date(date)
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    d.setDate(diff)
    return d
}


// Helper Functions for Calculations
function calculateAge(birthDate?: string | null): number | null {
    if (!birthDate) return null
    const birth = new Date(birthDate)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
        age--
    }
    return age
}

function calculateBMI(weight?: number | null, height?: number | null): { value: number, label: string } | null {
    if (!weight || !height) return null
    const heightInMeters = height / 100
    const bmi = weight / (heightInMeters * heightInMeters)
    let label = ''
    if (bmi < 18.5) label = 'Zayıf'
    else if (bmi < 24.9) label = 'Normal'
    else if (bmi < 29.9) label = 'Fazla Kilolu'
    else label = 'Obez'
    return { value: parseFloat(bmi.toFixed(1)), label }
}

// Helper to calculate targets based on resolved values
function calculateDailyTargets(weight: number, activityLevel: number, dietType?: { carb_factor?: number, protein_factor?: number, fat_factor?: number }, patientGoals?: string[]) {
    // If weight is missing, we can't calculate
    if (!weight) return null

    // Activity Multipliers
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

    // Use diet type factors from database, or fallback to general defaults
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









function containsDislikedWord(foodName: string, dislikedFoods: string[]): boolean {
    if (!dislikedFoods || dislikedFoods.length === 0) return false
    const lowerName = foodName.toLowerCase()
    return dislikedFoods.some(disliked => lowerName.includes(disliked.toLowerCase()))
}

const MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

const PALETTES = [
    { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', activeBg: 'data-[state=active]:bg-slate-200', activeText: 'data-[state=active]:text-slate-900' },
    { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200', activeBg: 'data-[state=active]:bg-red-200', activeText: 'data-[state=active]:text-red-900' },
    { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200', activeBg: 'data-[state=active]:bg-orange-200', activeText: 'data-[state=active]:text-orange-900' },
    { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200', activeBg: 'data-[state=active]:bg-amber-200', activeText: 'data-[state=active]:text-amber-900' },
    { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200', activeBg: 'data-[state=active]:bg-yellow-200', activeText: 'data-[state=active]:text-yellow-900' },
    { bg: 'bg-lime-50', text: 'text-lime-800', border: 'border-lime-200', activeBg: 'data-[state=active]:bg-lime-200', activeText: 'data-[state=active]:text-lime-900' },
    { bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-200', activeBg: 'data-[state=active]:bg-green-200', activeText: 'data-[state=active]:text-green-900' },
    { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', activeBg: 'data-[state=active]:bg-emerald-200', activeText: 'data-[state=active]:text-emerald-900' },
    { bg: 'bg-teal-50', text: 'text-teal-800', border: 'border-teal-200', activeBg: 'data-[state=active]:bg-teal-200', activeText: 'data-[state=active]:text-teal-900' },
    { bg: 'bg-cyan-50', text: 'text-cyan-800', border: 'border-cyan-200', activeBg: 'data-[state=active]:bg-cyan-200', activeText: 'data-[state=active]:text-cyan-900' },
    { bg: 'bg-sky-50', text: 'text-sky-800', border: 'border-sky-200', activeBg: 'data-[state=active]:bg-sky-200', activeText: 'data-[state=active]:text-sky-900' },
    { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200', activeBg: 'data-[state=active]:bg-blue-200', activeText: 'data-[state=active]:text-blue-900' },
    { bg: 'bg-indigo-50', text: 'text-indigo-800', border: 'border-indigo-200', activeBg: 'data-[state=active]:bg-indigo-200', activeText: 'data-[state=active]:text-indigo-900' },
    { bg: 'bg-violet-50', text: 'text-violet-800', border: 'border-violet-200', activeBg: 'data-[state=active]:bg-violet-200', activeText: 'data-[state=active]:text-violet-900' },
    { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200', activeBg: 'data-[state=active]:bg-purple-200', activeText: 'data-[state=active]:text-purple-900' },
    { bg: 'bg-fuchsia-50', text: 'text-fuchsia-800', border: 'border-fuchsia-200', activeBg: 'data-[state=active]:bg-fuchsia-200', activeText: 'data-[state=active]:text-fuchsia-900' },
    { bg: 'bg-pink-50', text: 'text-pink-800', border: 'border-pink-200', activeBg: 'data-[state=active]:bg-pink-200', activeText: 'data-[state=active]:text-pink-900' },
    { bg: 'bg-rose-50', text: 'text-rose-800', border: 'border-rose-200', activeBg: 'data-[state=active]:bg-rose-200', activeText: 'data-[state=active]:text-rose-900' },
]

function getDietTheme(name?: string) {
    if (!name) return PALETTES[0]

    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash)
    }

    const index = Math.abs(hash % PALETTES.length)
    return PALETTES[index]
}

function checkSeasonality(food: any, targetDate?: Date): { inSeason: boolean, reason?: string } {
    if (!food || !targetDate) return { inSeason: true }

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

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {

    const { showAppModal } = useAppModal()
    const { id } = use(params)
    const { isPatient } = useAuth()
    const { isSidebarCollapsed } = useSidebar()
    const [patient, setPatient] = useState<Patient | null>(null)
    const [weeks, setWeeks] = useState<DietWeek[]>([])
    const [allPlanDays, setAllPlanDays] = useState<any[]>([])
    // Stores duplicate week IDs to clean up
    const [duplicateWeekIds, setDuplicateWeekIds] = useState<string[]>([])
    const [activeWeekId, setActiveWeekId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshTrigger, setRefreshTrigger] = useState(0)
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
    const [activeMainTab, setActiveMainTab] = useState('diet')
    const [aiAnalysisSheetOpen, setAiAnalysisSheetOpen] = useState(false)
    const [editingWeek, setEditingWeek] = useState<DietWeek | null>(null)
    const [weekDialogOpen, setWeekDialogOpen] = useState(false)
    const [importDialogOpen, setImportDialogOpen] = useState(false)
    const [archivedPlansDialogOpen, setArchivedPlansDialogOpen] = useState(false)
    const [autoStartGoogleSheets, setAutoStartGoogleSheets] = useState(false)
    const [activeDragFood, setActiveDragFood] = useState<any>(null)
    const [mealTypes, setMealTypes] = useState<string[]>(['KAHVALTI', 'ÖĞLEN', 'AKŞAM', 'ARA ÖĞÜN'])
    const [slotConfigs, setSlotConfigs] = useState<SlotConfig[]>([
        { name: 'KAHVALTI', min_items: 1, max_items: 1 },
        { name: 'ÖĞLEN', min_items: 2, max_items: 4 },
        { name: 'AKŞAM', min_items: 2, max_items: 4 },
        { name: 'ARA ÖĞÜN', min_items: 1, max_items: 2 },
    ])
    const [macroTolerances, setMacroTolerances] = useState<any>(null)
    const [mealTypesDialogOpen, setMealTypesDialogOpen] = useState(false)
    // Legend Dialog State
    const [isLegendOpen, setIsLegendOpen] = useState(false)
    const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
    const [dietTypesDialogOpen, setDietTypesDialogOpen] = useState(false)
    const [patientRulesDialogOpen, setPatientRulesDialogOpen] = useState(false)
    const [lockDialogData, setLockDialogData] = useState<{ open: boolean, mode: 'lock' | 'unlock', meal: any, dayDate?: string } | null>(null)
    const [noteLockDialogData, setNoteLockDialogData] = useState<{ open: boolean, mode: 'lock' | 'unlock', note: any } | null>(null)
    const [dietPlanId, setDietPlanId] = useState<string | null>(null)
    const [foods, setFoods] = useState<any[]>([])
    const [weekCopyDialogData, setWeekCopyDialogData] = useState<{ open: boolean, week: DietWeek } | null>(null)
    const [blockedFoodDialog, setBlockedFoodDialog] = useState<{ open: boolean, food: any | null, dropData: any | null, reason: string | null }>({ open: false, food: null, dropData: null, reason: null })
    // === WEEK LOOP EDITOR ===
    const [weekLoopDialogOpen, setWeekLoopDialogOpen] = useState(false)
    const [copiedWeekInitModalOpen, setCopiedWeekInitModalOpen] = useState(false)

    // Form states for manual food addition - keeping minimal for inline editing
    const [notesSheetOpen, setNotesSheetOpen] = useState(false)
    const [isFoodSidebarVisible, setIsFoodSidebarVisible] = useState(false)

    const [profileDialogOpen, setProfileDialogOpen] = useState(false)
    const [dietTypesList, setDietTypesList] = useState<any[]>([])
    const [weeklyAvgStats, setWeeklyAvgStats] = useState<any>(null)
    const [patientProgram, setPatientProgram] = useState<any>(null)
    const [allPatientMeals, setAllPatientMeals] = useState<any[]>([])
    const isFetchingAllPatientMealsRef = useRef(false)
    const pendingAllPatientMealsFetchRef = useRef(false)
    const [showMealBadges, setShowMealBadges] = useState<boolean>(true)
    const [sidebarSortPreference, setSidebarSortPreference] = useState<'asc' | 'desc' | null>(null)
    const [patientLabs, setPatientLabs] = useState<any[]>([])
    const [patientMedicationRules, setPatientMedicationRules] = useState<any[]>([])
    const [foodMicronutrients, setFoodMicronutrients] = useState<Record<string, string[]>>({})

    // Helper for Day Initials
    const getDayInitial = (startDateStr: string, dayNumber: number) => {
        const date = new Date(startDateStr)
        date.setDate(date.getDate() + (dayNumber - 1))
        const day = date.getDay() // 0=Sun, 1=Mon...
        return ['P', 'P', 'S', 'Ç', 'P', 'C', 'C'][day]
    }

    async function toggleDayActive(dayId: string, currentState: boolean) {
        const { error } = await supabase.from('diet_days').update({ is_active: !currentState }).eq('id', dayId)
        if (!error) {
            setAllPlanDays(prev => prev.map(d => d.id === dayId ? { ...d, is_active: !currentState } : d))
            setRefreshTrigger(prev => prev + 1)
        }
    }

    // Planner Settings (Scalable Units)
    const scalableUnits = useScalableUnits()

    // Recipe Integration
    const { manualMatches, bans, cards } = useRecipeManager()
    const [recipeDialogOpen, setRecipeDialogOpen] = useState(false)
    const [selectedRecipe, setSelectedRecipe] = useState<{ url: string, name: string } | null>(null)

    // Helper to open recipe
    function handleShowRecipe(url: string, name: string) {
        console.log("Admin: handleShowRecipe called with", { url, name })
        setSelectedRecipe({ url, name })
        setRecipeDialogOpen(true)
    }

    // Auto Planner State
    const [autoPlanOpen, setAutoPlanOpen] = useState(false)
    const [generatedPlan, setGeneratedPlan] = useState<any>(null)
    const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
    const [isApplyingPlan, setIsApplyingPlan] = useState(false)
    const { user, profile } = useAuth()

    async function resolveFoodTeamOwnerId(): Promise<string | null> {
        if (!user?.id) return null
        const scope = await resolveTeamScopeContextForUser(user.id, {
            role: profile?.role || null,
            is_global_access: (profile as any)?.is_global_access === true
        })
        return scope.teamOwnerId
    }

    async function saveFoodByScope(
        foodId: string,
        updates: Record<string, any>,
        teamOwnerIdOverride?: string | null
    ) {
        const teamOwnerId = teamOwnerIdOverride ?? await resolveFoodTeamOwnerId()

        if (teamOwnerId && user?.id) {
            const { error } = await upsertTeamFoodOverride({
                teamOwnerId,
                baseFoodId: foodId,
                createdBy: user.id,
                updates
            })
            if (error) throw error

            const { data: baseFood, error: baseFoodError } = await supabase
                .from('foods')
                .select('*')
                .eq('id', foodId)
                .single()
            if (baseFoodError) throw baseFoodError

            const scopedFoods = await applyTeamFoodOverrides(baseFood ? [baseFood] : [], teamOwnerId)
            const effectiveFoods = await applyTeamFoodMicronutrientOverrides(scopedFoods, teamOwnerId)
            return effectiveFoods[0] || scopedFoods[0] || baseFood
        }

        const { data, error } = await supabase
            .from('foods')
            .update(updates)
            .eq('id', foodId)
            .select()
            .single()
        if (error) throw error
        return data
    }

    async function handleAutoGenerate(macroAdjustments?: Record<string, number>) {
        if (!activeWeekId || !patient || !user) return

        setIsGeneratingPlan(true)
        try {
            const planner = new Planner(patient.id, user.id)
            await planner.init()

            // Use active week start date and meal types
            const activeWeek = weeks.find(w => w.id === activeWeekId)
            const startDate = activeWeek?.start_date ? new Date(activeWeek.start_date) : new Date()
            // 1. Hierarchical Meal Types Priority (Ignore stale activeWeek cache)
            const weekMealTypes = mealTypes && mealTypes.length > 0 ? mealTypes : ['KAHVALTI', 'ÖĞLEN', 'AKŞAM']

            // Get diet type using the same resolution logic as the header display
            let resolvedDietType: any = null

            // 1. Try WEEK_OVERRIDE rule (Highest Priority)
            const weekOverrideRule = patient.planning_rules?.find(r =>
                r.rule_type === 'week_override' &&
                r.is_active &&
                activeWeek &&
                activeWeek.week_number >= r.definition.data.week_start &&
                activeWeek.week_number <= r.definition.data.week_end
            )

            if (weekOverrideRule?.definition.data.diet_type_id) {
                resolvedDietType = dietTypesList.find(d => d.id === weekOverrideRule.definition.data.diet_type_id)
            }

            // 2. Try program template fallback (Medium Priority)
            if (!resolvedDietType && patientProgram?.program_template_weeks && activeWeek) {
                const rule = patientProgram.program_template_weeks.find((pw: any) =>
                    activeWeek.week_number >= pw.week_start && activeWeek.week_number <= pw.week_end
                )
                if (rule?.diet_type_id) {
                    resolvedDietType = dietTypesList.find(d => d.id === rule.diet_type_id)
                }
            }

            // 3. Try explicit assignment on the week (Lowest Priority)
            if (!resolvedDietType && activeWeek?.assigned_diet_type_id) {
                resolvedDietType = dietTypesList.find(d => d.id === activeWeek.assigned_diet_type_id)
            }

            // 4. AUTO-OVERRIDE: If resolved type is global but has a patient-specific clone, use the clone
            if (resolvedDietType && !resolvedDietType.patient_id) {
                const specificOverride = dietTypesList.find(d => d.patient_id === patient.id && d.parent_diet_type_id === resolvedDietType.id)
                if (specificOverride) resolvedDietType = specificOverride
            }

            // HEAL STATE: Update DB to match dynamically resolved arrays
            await supabase.from('diet_weeks').update({
                meal_types: weekMealTypes,
                assigned_diet_type_id: resolvedDietType?.id || null
            }).eq('id', activeWeek?.id)

            // 4. Get factors from resolved diet type
            const dietTypeFactors = resolvedDietType ? {
                carb_factor: resolvedDietType.carb_factor,
                protein_factor: resolvedDietType.protein_factor,
                fat_factor: resolvedDietType.fat_factor
            } : null

            // Use week weight_log or patient weight
            const currentWeight = (activeWeek?.weight_log as number) || (patient as any)?.weight_log || (patient as any)?.weight || 70
            const activityLevel = (activeWeek?.activity_level_log as number) || (patient as any)?.activity_level || 3

            // Calculate actual targets using the formula
            const calculated = calculateDailyTargets(currentWeight, activityLevel, dietTypeFactors || undefined, patient?.patient_goals)
            const targetMacros = calculated ? {
                calories: calculated.calories,
                protein: calculated.protein,
                carbs: calculated.carb,
                fat: calculated.fat
            } : { calories: 1800, protein: 90, carbs: 180, fat: 60 }

            // Apply macro adjustments from AutoPlanDialog (P+15%, K-15%, etc.)
            if (macroAdjustments) {
                if (macroAdjustments.protein) targetMacros.protein = Math.round(targetMacros.protein * macroAdjustments.protein)
                if (macroAdjustments.carb) targetMacros.carbs = Math.round(targetMacros.carbs * macroAdjustments.carb)
                if (macroAdjustments.fat) targetMacros.fat = Math.round(targetMacros.fat * macroAdjustments.fat)
                // Recalculate calories from macros
                targetMacros.calories = targetMacros.protein * 4 + targetMacros.carbs * 4 + targetMacros.fat * 9
            }

            // 5. Get banned tags from program template restrictions
            const programBannedTags = patientProgram?.program_template_restrictions
                ?.filter((r: any) => r.restriction_type === 'banned_tag')
                .map((r: any) => r.restriction_value) || []

            // ── CROSS-WEEK ROTATION: Collect food usage from other weeks ──
            const historicalFoodCounts = new Map<string, number>()
            if (activeWeek?.id) {
                // Get the diet_plan_id from the active week
                const { data: weekRow } = await supabase
                    .from('diet_weeks')
                    .select('diet_plan_id')
                    .eq('id', activeWeek.id)
                    .maybeSingle()
                const currentPlanId = weekRow?.diet_plan_id
                if (currentPlanId) {
                    const { data: otherWeeks } = await supabase
                        .from('diet_weeks')
                        .select('id')
                        .eq('diet_plan_id', currentPlanId)
                        .neq('id', activeWeek.id)
                    if (otherWeeks && otherWeeks.length > 0) {
                        const otherWeekIds = otherWeeks.map(w => w.id)
                        const { data: otherDays } = await supabase
                            .from('diet_days')
                            .select('id')
                            .in('diet_week_id', otherWeekIds)
                        if (otherDays && otherDays.length > 0) {
                            const otherDayIds = otherDays.map(d => d.id)
                            const { data: otherMeals } = await supabase
                                .from('diet_meals')
                                .select('food_id')
                                .in('diet_day_id', otherDayIds)
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
            }

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

            // IF PATIENT: Directly Apply
            if (isPatient) {
                await handleApplyAutoPlan(plan)
            } else {
                setGeneratedPlan(plan)
                setAutoPlanOpen(true)
            }

        } catch (err) {
            console.error(err)
            alert("Plan oluşturulurken hata oluştu.")
        } finally {
            setIsGeneratingPlan(false)
        }
    }

    async function handleApplyAutoPlan(planOverride?: any) {
        const planToUse = planOverride || generatedPlan
        if (!planToUse || !activeWeekId) return
        setIsApplyingPlan(true)

        try {
            // Get Dates for the active week to map plan days (1-7) to diet_days IDs
            const { data: days } = await supabase.from('diet_days')
                .select('id, day_number')
                .eq('diet_week_id', activeWeekId)
                .order('day_number')

            if (!days || days.length === 0) throw new Error("Günler bulunamadı")

            const inserts = []

            for (const meal of planToUse.meals) {
                // meal.day is 1-based index (1=Monday... or relative to start)
                // days should be sorted by date.
                // Map meal.day (1-7) to days[meal.day - 1]

                const targetDay = days[meal.day - 1]
                if (!targetDay) continue

                // Create insert object with meal_time for proper slot placement
                // SNAPSHOT MACROS: We explicitly insert the calculated macros to ensure they appear
                // consistently, even if the food relation join fails or has 0 values temporarily.
                inserts.push({
                    diet_day_id: targetDay.id,
                    food_id: meal.food.id,
                    meal_time: meal.slot,
                    is_custom: false, // It references a real food ID

                    // Snapshot nutritional values to guarantee display matches planner calculations
                    calories: meal.food.calories || 0,
                    protein: meal.food.protein || 0,
                    carbs: meal.food.carbs || 0,
                    fat: meal.food.fat || 0,

                    portion_multiplier: meal.portion_multiplier || 1,
                    is_consumed: true,

                    // Store generation rule metadata
                    generation_meta: meal.source || null
                })
            }

            if (inserts.length > 0) {
                // 1. BACKUP / SNAPSHOT (Revert Capability)
                // Fetch current state including meals
                const { data: currentDays } = await supabase
                    .from('diet_days')
                    .select('*, diet_meals(*)')
                    .eq('diet_week_id', activeWeekId)

                if (currentDays && currentDays.length > 0) {
                    await supabase.from('diet_snapshots').insert({
                        diet_week_id: activeWeekId,
                        snapshot_data: currentDays,
                        description: `Auto-Plan Overwrite - ${new Date().toLocaleString('tr-TR')}`
                    })
                }

                // 2. DELETE EXISTING MEALS FIRST (Overwrite)
                const dayIds = days.map((d: any) => d.id)
                if (dayIds.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('diet_meals')
                        .delete()
                        .in('diet_day_id', dayIds)

                    if (deleteError) throw deleteError
                }

                // INSERT NEW MEALS
                const { error } = await supabase.from('diet_meals').insert(inserts)
                if (error) throw error

                // Switch to CALCULATED mode so the user sees diffs against the metabolic target
                if (patient?.id) {
                    await supabase.from('patients').update({ macro_target_mode: 'calculated' }).eq('id', patient.id)
                }
                fetchPatientData()

                setRefreshTrigger(prev => prev + 1)
                setAutoPlanOpen(false)
            }

        } catch (err: any) {
            console.error(err)
            alert("Hata: " + err.message)
        } finally {
            setIsApplyingPlan(false)
        }
    }

    async function handleUndo() {
        if (!activeWeekId) return
        const confirmed = await showAppModal('Onaylıyor musunuz?', 'Son değişikliği geri almak istiyor musunuz?', 'confirm')
        if (!confirmed) return

        try {
            // Get latest snapshot
            const { data: snapshots } = await supabase
                .from('diet_snapshots')
                .select('*')
                .eq('diet_week_id', activeWeekId)
                .order('created_at', { ascending: false })
                .limit(1)

            console.log('DEBUG: handleUndo - Snapshots found:', snapshots?.length)

            if (!snapshots || snapshots.length === 0) {
                await showAppModal('Dikkat', "Geri alınacak işlem bulunamadı.", 'warning')
                return
            }

            const snapshot = snapshots[0]
            const snapshotData = snapshot.snapshot_data as any[] // This is array of days with meals
            console.log('DEBUG: handleUndo - Snapshot Data:', snapshotData)

            // Restore logic
            // 1. Delete current meals
            const { data: days } = await supabase.from('diet_days')
                .select('id')
                .eq('diet_week_id', activeWeekId)

            const dayIds = days?.map(d => d.id) || []
            if (dayIds.length > 0) {
                await supabase.from('diet_meals').delete().in('diet_day_id', dayIds)
            }

            // 2. Insert meals from snapshot
            const inserts: any[] = []
            for (const day of snapshotData) {
                // Ensure day IDs match the CURRENT day IDs (snapshot might have old day objects if strict equality not guaranteed)
                // Actually, diet_days IDs are persistent, so day.id should range over the same IDs.
                // However, let's verify if day.diet_meals is present
                if (day.diet_meals && Array.isArray(day.diet_meals)) {
                    for (const meal of day.diet_meals) {
                        // Fix potential 'notes' vs 'note' or other field mismatches if schema changed
                        inserts.push({
                            diet_day_id: day.id,
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
                            // Ensure these optional fields are handled safely
                            is_consumed: meal.is_consumed || false,
                            original_food_id: meal.original_food_id || null,
                            swapped_by: meal.swapped_by || null
                        })
                    }
                }
            }

            console.log('DEBUG: handleUndo - Inserts prepared:', inserts.length, inserts)

            if (inserts.length > 0) {
                const { error } = await supabase.from('diet_meals').insert(inserts)
                if (error) {
                    console.error('DEBUG: handleUndo - Insert Error:', error)
                    throw error
                }
            }

            // Pop from stack (Delete used snapshot)
            await supabase.from('diet_snapshots').delete().eq('id', snapshot.id)

            setRefreshTrigger(prev => prev + 1)
            await fetchPatientData() // Refresh full data since fetchWeekDays is not available here
            await showAppModal('Başarılı', "Geri alındı.", 'success')

        } catch (e: any) {
            console.error('DEBUG: handleUndo - Exception:', e)
            await showAppModal('Hata', "Geri alma hatası: " + e.message, 'alert')
        }
    }

    async function handleReset() {
        if (!activeWeekId) return
        const confirmed = await showAppModal('Emin misiniz?', "Bu haftadaki TÜM yemekleri silmek istediğinize emin misiniz?", 'warning')
        if (!confirmed) return

        try {
            // 1. Snapshot current state before wiping
            const { data: currentDays } = await supabase
                .from('diet_days')
                .select('*, diet_meals(*)')
                .eq('diet_week_id', activeWeekId)

            if (currentDays && currentDays.some((d: any) => d.diet_meals.length > 0)) {
                await supabase.from('diet_snapshots').insert({
                    diet_week_id: activeWeekId,
                    snapshot_data: currentDays,
                    description: `Reset - ${new Date().toLocaleString('tr-TR')}`
                })
            }

            // 2. Delete All Meals
            const dayIds = currentDays?.map((d: any) => d.id) || []
            if (dayIds.length > 0) {
                await supabase.from('diet_meals').delete().in('diet_day_id', dayIds)
            }

            setRefreshTrigger(prev => prev + 1)
            await fetchPatientData() // Refresh full data
            await showAppModal('Başarılı', "Hafta sıfırlandı.", 'success')

        } catch (e: any) {
            console.error(e)
            await showAppModal('Hata', "Sıfırlama hatası: " + e.message, 'alert')
        }
    }

    // 1. Initial Plan Fetch
    useEffect(() => {
        if (id) {
            fetchPatientData()
        }
    }, [id])

    // Check for Lazy Initialization of Copied Weeks
    useEffect(() => {
        const aw = weeks.find(w => w.id === activeWeekId)
        if (aw && aw.weight_log === -1 && !copiedWeekInitModalOpen) {
            setCopiedWeekInitModalOpen(true)
        }
    }, [activeWeekId, weeks, copiedWeekInitModalOpen])

    const handleCopiedWeekInitSave = async (w: number, act: number) => {
        const aw = weeks.find(wk => wk.id === activeWeekId)
        if (!aw) return
        try {
            const { error } = await supabase.from('diet_weeks').update({
                weight_log: w,
                activity_level_log: act
            }).eq('id', aw.id)

            if (error) throw error
            aw.weight_log = w
            aw.activity_level_log = act
            setCopiedWeekInitModalOpen(false)
            await fetchPatientData()
        } catch (e: any) {
            console.error("Error setting copied week details", e)
            throw new Error('Hafta güncellenemedi.')
        }
    }

    // Guard to prevent double-fetch (Strict Mode / Race condition)
    const isFetching = useRef(false)
    // Guard to prevent double-create of default plan
    const creatingDefaultPlan = useRef(false)
    // Guard to prevent double-create of first week
    const creatingInitialWeek = useRef(false)

    useEffect(() => {
        if (!isFetching.current) {
            fetchPatientData()
        }
        fetchFoods()
        fetchDietTypes()
        fetchSlotSettings()
        
    }, [id])

    // Sync slotConfigs from activeWeek whenever it changes
    useEffect(() => {
        const currentActiveWeek = weeks.find(w => w.id === activeWeekId)
        if (currentActiveWeek?.slot_configs && Array.isArray(currentActiveWeek.slot_configs) && currentActiveWeek.slot_configs.length > 0) {
            setSlotConfigs(currentActiveWeek.slot_configs)
        }
    }, [activeWeekId, weeks])

    async function fetchDietTypes() {
        const { data } = await supabase.from('diet_types')
            .select('*, banned_details') // Explicitly select banned_details
            .or(`patient_id.is.null,patient_id.eq.${id}`)
            .order('name')
        if (data) {
            const teamOwnerId = await resolveFoodTeamOwnerId()
            let programTemplateId =
                patient?.program_template_id ||
                patient?.program_templates?.id ||
                null

            if (!programTemplateId && id) {
                const { data: patientProgramRef } = await supabase
                    .from('patients')
                    .select('program_template_id')
                    .eq('id', id)
                    .maybeSingle()
                programTemplateId = patientProgramRef?.program_template_id || null
            }

            let globalAndTeamMerged = await applyTeamDietTypeOverrides(
                data.filter((dt: any) => !dt.patient_id),
                teamOwnerId
            )
            if (programTemplateId) {
                globalAndTeamMerged = await applyProgramDietTypeOverrides(globalAndTeamMerged, {
                    programTemplateId,
                    teamOwnerId
                })
            }
            const patientSpecific = data.filter((dt: any) => !!dt.patient_id)
            setDietTypesList([...globalAndTeamMerged, ...patientSpecific])
        }
    }

    async function fetchSlotSettings() {
        // Fetch patient specific slot settings
        let { data } = await supabase.from('planner_settings').select('slot_config, portion_settings').eq('patient_id', id).maybeSingle()

        // 2. Fallback to Program Settings
        if (!data || !data.slot_config) {
            const progId = patient?.program_template_id || patient?.program_templates?.id
            if (progId) {
                const { data: programSettings } = await supabase
                    .from('planner_settings')
                    .select('slot_config, portion_settings')
                    .eq('scope', 'program')
                    .eq('program_template_id', progId)
                    .maybeSingle()
                if (programSettings?.slot_config) data = programSettings
            }
        }

        // 3. Fallback to Global Settings
        if (!data || !data.slot_config) {
            const { data: globalSettings } = await supabase.from('planner_settings').select('slot_config, portion_settings').eq('scope', 'global').maybeSingle()
            if (globalSettings && globalSettings.slot_config) {
                data = globalSettings
            }
        }

        if (data && data.slot_config) {
            setSlotConfigs(data.slot_config)

            // Also sync meal types if available in config to match UI
            if (Array.isArray(data.slot_config)) {
                const types = data.slot_config.map((c: any) => c.name)
                if (types.length > 0) setMealTypes(types)
            }
        }
        if (data && data.portion_settings && data.portion_settings.macro_tolerances) {
            setMacroTolerances(data.portion_settings.macro_tolerances)
        }
    }

    function isAbortLikeError(error: any): boolean {
        const text = `${error?.message || ''} ${error?.details || ''} ${error || ''}`.toLowerCase()
        return text.includes('aborterror') || text.includes('aborted')
    }

    async function fetchPatientLabs() {
        const { data } = await supabase
            .from('patient_lab_results')
            .select(`
                id, patient_id, micronutrient_id, value, measured_at, ref_min, ref_max, note,
                micronutrients (
                    id, name, unit, default_min, default_max, category, compatible_keywords, incompatible_keywords
                )
            `)
            .eq('patient_id', id)
            .order('measured_at', { ascending: false })

        if (data) {
            // Group by micronutrient_id and keep only the latest one
            const latestLabs: Record<string, any> = {}
            data.forEach(lab => {
                if (!latestLabs[lab.micronutrient_id]) {
                    latestLabs[lab.micronutrient_id] = lab
                }
            })
            setPatientLabs(Object.values(latestLabs))
        }
    }

    async function fetchPatientMedicationRules() {
        // Get patient's active medications
        const { data: patientMeds } = await supabase
            .from('patient_medications')
            .select('medication_id, medication_name')
            .eq('patient_id', id)
            .is('ended_at', null)

        if (!patientMeds || patientMeds.length === 0) {
            setPatientMedicationRules([])
            return
        }

        const medIds = patientMeds.map(pm => pm.medication_id).filter(Boolean)

        if (medIds.length === 0) {
            setPatientMedicationRules([])
            return
        }

        // Get all interaction rules for those medications
        const { data: rules } = await supabase
            .from('medication_interactions')
            .select('*, medications(name)')
            .in('medication_id', medIds)

        if (rules) {
            // Enrich with medication names from join or from patient_medications
            const enrichedRules = rules.map(rule => ({
                ...rule,
                medication_name: rule.medications?.name || patientMeds.find(pm => pm.medication_id === rule.medication_id)?.medication_name
            }))
            setPatientMedicationRules(enrichedRules)
        }
    }

    // Robust cleaner that re-checks DB
    async function handleAnalyzeAndClean(verbose = false) {
        // Silent background check
        try {
            if (!dietPlanId) {
                if (verbose) alert("Plan ID bulunamadı. Lütfen sayfayı yenileyin.")
                return
            }

            // 1. Check for Duplicate Plans (Root Cause)
            const { data: plans } = await supabase.from('diet_plans').select('id, created_at, status').eq('patient_id', id).eq('status', 'active')
            if (plans && plans.length > 1) {
                const msg = `⚠️ KRİTİK HATA: Bu hasta için ${plans.length} adet AKTİF plan bulundu!\n\nBu durum ekranın çift görünmesine neden oluyor.\n\nFazlalık planlar otomatik olarak arşivlensin mi?`
                if (verbose && confirm(msg)) {
                    // Sort by created_at (keep oldest)
                    plans.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
                    const keepId = plans[0].id
                    const archiveIds = plans.slice(1).map(p => p.id)

                    console.log(`Archiving duplicate plans: ${archiveIds.join(', ')}`)
                    await supabase.from('diet_plans').update({ status: 'archived' }).in('id', archiveIds)
                    alert("Fazlalık planlar arşivlendi. Sayfa yenileniyor...")
                    window.location.reload()
                    return
                }
            }

            const { data: allWeeks, error } = await supabase
                .from('diet_weeks')
                .select('id, week_number, created_at')
                .eq('diet_plan_id', dietPlanId)
                .order('week_number')

            if (error || !allWeeks || allWeeks.length === 0) {
                if (verbose) alert("Kontrol edilemedi: " + (error?.message || "Veri yok") + ` (PlanID: ${dietPlanId})`)
                return
            }

            // 2. Identify duplicates
            const groups = new Map<number, any[]>()
            allWeeks.forEach(w => {
                if (!groups.has(w.week_number)) groups.set(w.week_number, [])
                groups.get(w.week_number)?.push(w)
            })

            const duplicates: string[] = []
            groups.forEach((groupWeeks) => {
                if (groupWeeks.length > 1) {
                    // Sort by created_at (keep oldest)
                    groupWeeks.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
                    // Keep index 0, delete 1..n
                    for (let i = 1; i < groupWeeks.length; i++) {
                        duplicates.push(groupWeeks[i].id)
                    }
                }
            })

            if (duplicates.length === 0) {
                if (verbose) {
                    const debugInfo = allWeeks.map(w => `H${w.week_number}[${w.id.substring(0, 4)}]`).join(', ')
                    alert(`DB TEMİZ GÖRÜNÜYOR.\nToplam Kayıt: ${allWeeks.length}\nKayıtlar: ${debugInfo}\n\nEğer ekranda hala çift görüyorsanız, lütfen sayfayı yenileyin.`)
                }
                return
            }

            const msg = `${duplicates.length} adet yinelenen hafta bulundu (Week Numbers: ${Array.from(groups.keys()).filter(k => groups.get(k)?.length! > 1).join(', ')}).`
            console.log(msg)

            if (verbose && !confirm(msg + "\n\nBunları silmek istiyor musunuz?")) return

            // 3. Delete
            const { error: delError } = await supabase.from('diet_weeks').delete().in('id', duplicates)

            if (delError) {
                console.error("Clean error:", delError)
                if (verbose) alert("Silme hatası: " + delError.message + ` (PlanID: ${dietPlanId}, Duplicates: ${duplicates.join(', ')})`)
            } else {
                console.log("Duplicates cleaned. Reloading...")
                if (verbose) alert("Temizlendi! Sayfa yenileniyor.")
                window.location.reload()
            }

        } catch (err: any) {
            console.error("Auto-clean error:", err)
            if (verbose) alert("Beklenmeyen hata: " + err.message)
        }
    }

    // Auto-trigger clean on mount/change (Moved to top level to avoid Hooks error)
    useEffect(() => {
        if (dietPlanId) {
            // Short delay to allow initial fetch stability
            const timer = setTimeout(() => {
                handleAnalyzeAndClean()
            }, 1000)
            return () => clearTimeout(timer)
        }
    }, [dietPlanId])

    // Fetch all meals for cumulative count calculation
    useEffect(() => {
        if (dietPlanId && weeks.length > 0) {
            fetchAllPatientMeals()
        }
    }, [dietPlanId, weeks, refreshTrigger])

    // Calculate cumulative meal counts up to active week
    const mealCounts = useMemo(() => {
        const counts = new Map<string, number>()
        if (!activeWeekId || weeks.length === 0) return counts

        const activeWeek = weeks.find(w => w.id === activeWeekId)
        if (!activeWeek) return counts

        // Get week numbers for ordering
        const activeWeekNum = activeWeek.week_number

        for (const meal of allPatientMeals) {
            // Find which week this meal belongs to
            const mealWeek = weeks.find(w => w.id === meal.week_id)
            if (!mealWeek || mealWeek.week_number > activeWeekNum) continue

            // Use food_id if available, otherwise normalize food name
            const key = meal.food_id || (meal.custom_name || meal.foods?.name || '').toLowerCase().trim()
            if (key) {
                counts.set(key, (counts.get(key) || 0) + 1)
            }
        }
        return counts
    }, [allPatientMeals, activeWeekId, weeks])

    const customFoods = useMemo(() => {
        const uniqueCustoms = new Map<string, any>()
        allPatientMeals.forEach(meal => {
            if ((!meal.food_id || meal.is_custom) && meal.custom_name) {
                const name = meal.custom_name.trim()
                if (!uniqueCustoms.has(name.toLowerCase())) {
                    uniqueCustoms.set(name.toLowerCase(), {
                        id: `custom-${name}`,
                        name: name,
                        category: 'KAYITSIZLAR',
                        isCustom: true,
                        calories: 0, protein: 0, carbs: 0, fat: 0
                    })
                }
            }
        })
        return Array.from(uniqueCustoms.values())
    }, [allPatientMeals])

    // --- VISIBILITY FILTER ---
    const visibleWeeks = useMemo(() => {
        if (!isPatient) return weeks

        // Default Settings
        const settings = patient?.visibility_settings || { max_future_weeks: 4, allow_past: true }
        const maxFuture = typeof settings.max_future_weeks === 'number' ? settings.max_future_weeks : 4
        const allowPast = settings.allow_past !== false // Valid unless explicitly false

        const today = new Date()
        today.setHours(0, 0, 0, 0)

        // Calculate Future Limit Date
        // Current date + (maxFuture * 7) days
        // But wait, "4 future weeks" usually means 4 weeks AHEAD of current week?
        // Let's stick to simple day offset from today.
        const futureLimit = new Date(today)
        futureLimit.setDate(today.getDate() + (maxFuture * 7))

        return weeks.filter(week => {
            if (!week.start_date) return true

            const wStart = new Date(week.start_date)
            // Use end_date if available, else start + 6 days
            const wEnd = week.end_date ? new Date(week.end_date) : new Date(wStart.getTime() + 6 * 24 * 60 * 60 * 1000)

            wStart.setHours(0, 0, 0, 0)
            wEnd.setHours(0, 0, 0, 0)

            // Past Check: If explicitly disallowed AND the week has ended before today
            if (!allowPast && wEnd < today) {
                return false
            }

            // Future Check: If the week STARTS after the future limit
            if (wStart > futureLimit) {
                return false
            }

            return true
        })
    }, [weeks, isPatient, patient])

    // Ensure Active Week is Visible
    useEffect(() => {
        if (isPatient && visibleWeeks.length > 0 && activeWeekId) {
            const isVisible = visibleWeeks.find(w => w.id === activeWeekId)
            if (!isVisible) {
                // If current selection is hidden, switch to the "latest" visible week or first?
                // Usually first visible (closest to now?)
                // Or maybe the one closest to Today?
                // Let's safe pick the first one for now.
                setActiveWeekId(visibleWeeks[0].id)
            }
        }
    }, [visibleWeeks, isPatient, activeWeekId])

    useEffect(() => {
        if (activeWeekId) {
            calculateWeeklyAverage()
        }
    }, [activeWeekId, refreshTrigger, weeks])

    // Sync meal types when active week changes
    useEffect(() => {
        const currentWeek = weeks.find(w => w.id === activeWeekId)
        if (currentWeek?.meal_types && Array.isArray(currentWeek.meal_types)) {
            const newTypes = currentWeek.meal_types as string[]
            // Avoid validation loop if same
            if (JSON.stringify(newTypes) !== JSON.stringify(mealTypes)) {
                setMealTypes(newTypes)
            }
        }
    }, [activeWeekId, weeks])

    async function calculateWeeklyAverage() {
        // Use explicit FK for foods to avoid ambiguity error
        // select diet_meals(*) to get the snapshot values (calories, protein etc) directly from the row
        const { data: days, error } = await supabase
            .from('diet_days')
            .select('*, diet_meals(*, foods!diet_meals_food_id_fkey(id, name, calories, protein, carbs, fat, portion_unit, role, tags, season_start, season_end))')
            .eq('diet_week_id', activeWeekId)

        if (error) {
            console.error("Weekly Avg Calc Error:", error)
            setWeeklyAvgStats(null)
            return
        }

        if (!days || days.length === 0) {
            setWeeklyAvgStats(null)
            return
        }

        let totalCal = 0, totalPro = 0, totalCarb = 0, totalFat = 0

        // Always divide by 7 to get "Daily Average over the week"
        const count = 7

        days.forEach(day => {
            day.diet_meals?.forEach((m: any) => {
                // Replicate DietWeekGridView Logic EXACTLY
                const p = ((m.is_custom ? m.protein : m.foods?.protein) || 0) * (m.portion_multiplier || 1)
                const c = ((m.is_custom ? m.carbs : m.foods?.carbs) || 0) * (m.portion_multiplier || 1)
                const f = ((m.is_custom ? m.fat : m.foods?.fat) || 0) * (m.portion_multiplier || 1)

                // UI calculates calories from macros dynamically
                const cal = Math.round((p * 4) + (c * 4) + (f * 9))

                totalCal += cal
                totalPro += p
                totalCarb += c
                totalFat += f
            })
        })

        setWeeklyAvgStats({
            cal: totalCal / count,
            pro: totalPro / count,
            carb: totalCarb / count,
            fat: totalFat / count
        })
    }

    // Helper for Diff Formatting (Header)
    // Mode: 'target' -> returns "Target (Diff)". Diff = Target - Actual (Positive = Remaining/Under)
    // Mode: 'actual' -> returns "Actual (Diff)". Diff = Actual - Target (Positive = Over)
    const formatDiff = (actual: number, target: number, type: 'calories' | 'carb' | 'protein' | 'fat' | 'target' | 'actual', unit: string = '') => {
        const roundedActual = Math.round(actual)
        const roundedTarget = Math.round(target)
        let diff = roundedActual - roundedTarget

        let typeKey = (type === 'target' || type === 'actual') ? 'calories' : type

        const minTol = macroTolerances?.[typeKey]?.min ?? (typeKey === 'calories' ? 90 : 80)
        const maxTol = macroTolerances?.[typeKey]?.max ?? (typeKey === 'calories' ? 110 : 120)

        const minTarget = target * (minTol / 100)
        const maxTarget = target * (maxTol / 100)

        let colorClass = 'text-green-600'
        if (actual > maxTarget) colorClass = 'text-red-500'
        else if (actual < minTarget) colorClass = 'text-orange-500'

        return (
            <span className="flex items-center gap-1 cursor-help" title={`Hedef: ${roundedTarget}, Gerçekleşen: ${roundedActual}, Fark: ${diff > 0 ? '+' : ''}${diff}`}>
                <span>{roundedTarget}{unit}</span>
                <span className={`text-[10px] ${colorClass} font-normal`}>({roundedActual})</span>
            </span>
        )
    }

    // Refresh meal types and slot configs from the active week's database record
    // Called when SettingsDialog saves changes
    async function refreshMealTypesFromActiveWeek() {
        if (!activeWeekId) return
        const { data: weekData } = await supabase
            .from('diet_weeks')
            .select('meal_types, slot_configs')
            .eq('id', activeWeekId)
            .single()

        if (weekData) {
            if (weekData.meal_types) {
                setMealTypes(weekData.meal_types)
            }
            if (weekData.slot_configs) {
                setSlotConfigs(weekData.slot_configs)
            }
        }

        // If no week-level config found, try planner_settings with program fallback
        if (!weekData?.meal_types || !weekData?.slot_configs) {
            let settingsSlotConfig: any = null

            // 1. Try patient-specific settings
            const { data: patientSettings } = await supabase
                .from('planner_settings')
                .select('slot_config')
                .eq('scope', 'patient')
                .eq('patient_id', id)
                .maybeSingle()
            if (patientSettings?.slot_config) settingsSlotConfig = patientSettings.slot_config

            // 2. Try program settings
            if (!settingsSlotConfig && patientProgram?.id) {
                const { data: programSettings } = await supabase
                    .from('planner_settings')
                    .select('slot_config')
                    .eq('scope', 'program')
                    .eq('program_template_id', patientProgram.id)
                    .maybeSingle()
                if (programSettings?.slot_config) settingsSlotConfig = programSettings.slot_config
            }

            // 3. Try global settings
            if (!settingsSlotConfig) {
                const { data: globalSettings } = await supabase
                    .from('planner_settings')
                    .select('slot_config')
                    .eq('scope', 'global')
                    .maybeSingle()
                if (globalSettings?.slot_config) settingsSlotConfig = globalSettings.slot_config
            }

            if (settingsSlotConfig && Array.isArray(settingsSlotConfig)) {
                const resolvedMealTypes = settingsSlotConfig.map((c: any) => c.name || c.mealType);
                if (!weekData?.meal_types) {
                    setMealTypes(resolvedMealTypes);
                }
                if (!weekData?.slot_configs) {
                    setSlotConfigs(settingsSlotConfig)
                }
                // HEAL THE DB for stale weeks
                await supabase.from('diet_weeks').update({
                    meal_types: resolvedMealTypes,
                    slot_configs: settingsSlotConfig
                }).eq('id', activeWeekId);
            }
        }
    }

    async function fetchFoods() {
        try {
            const { data } = await supabase.from('foods').select('*').order('name')
            let teamOwnerId: string | null = null
            if (data) {
                teamOwnerId = await resolveFoodTeamOwnerId()
                const effectiveFoods = await applyTeamFoodOverrides(data, teamOwnerId)
                setFoods(effectiveFoods)
                const baseFoodIds = effectiveFoods.map((food: any) => food.base_food_id || food.id)
                const mapping = await getFoodMicronutrientMapByScope(baseFoodIds, teamOwnerId)
                setFoodMicronutrients(mapping)
            }
        } catch (error) {
            if (!isAbortLikeError(error)) {
                console.error('[fetchFoods] failed to load scoped micronutrient map:', error)
            }
        }
    }

    async function fetchAllPatientMeals() {
        if (!dietPlanId || weeks.length === 0) return
        if (isFetchingAllPatientMealsRef.current) {
            pendingAllPatientMealsFetchRef.current = true
            return
        }
        isFetchingAllPatientMealsRef.current = true

        try {
            // Batch weeks into smaller groups to avoid URL length limits
            const WEEK_BATCH_SIZE = 3
            const DAY_BATCH_SIZE = 10
            const allMeals: any[] = []

            for (let i = 0; i < weeks.length; i += WEEK_BATCH_SIZE) {
                const batchWeeks = weeks.slice(i, i + WEEK_BATCH_SIZE)
                const weekIds = batchWeeks.map(w => w.id)

                // Fetch days for this batch of weeks
                const { data: days, error: daysError } = await supabase
                    .from('diet_days')
                    .select('id, diet_week_id')
                    .in('diet_week_id', weekIds)

                if (daysError || !days || days.length === 0) continue

                const dayToWeek = new Map(days.map(d => [d.id, d.diet_week_id]))

                // Batch days too to avoid URL length limits
                for (let j = 0; j < days.length; j += DAY_BATCH_SIZE) {
                    const batchDays = days.slice(j, j + DAY_BATCH_SIZE)
                    const dayIds = batchDays.map(d => d.id)

                    // Fetch meals for these days
                    const { data: meals, error: mealsError } = await supabase
                        .from('diet_meals')
                        .select('id, diet_day_id, food_id, custom_name, is_custom')
                        .in('diet_day_id', dayIds)

                    if (mealsError) {
                        if (!isAbortLikeError(mealsError)) {
                            console.error('Meals query error:', mealsError)
                        }
                        continue
                    }
                    if (!meals) continue

                    // Map meals with week_id
                    const mealsWithWeek = meals.map(m => ({
                        ...m,
                        week_id: dayToWeek.get(m.diet_day_id)
                    }))

                    allMeals.push(...mealsWithWeek)
                }
            }

            setAllPatientMeals(allMeals)
        } catch (err) {
            if (!isAbortLikeError(err)) {
                console.error('fetchAllPatientMeals exception:', err)
            }
            setAllPatientMeals([])
        } finally {
            isFetchingAllPatientMealsRef.current = false
            if (pendingAllPatientMealsFetchRef.current) {
                pendingAllPatientMealsFetchRef.current = false
                void fetchAllPatientMeals()
            }
        }
    }

    const [patientDiseases, setPatientDiseases] = useState<any[]>([])

    // 1. Fetch Patient Data & Diet Plan
    async function fetchPatientData(inputPatientId?: string) {
        setLoading(true)
        try {
            const queryId = inputPatientId || id
            if (!queryId) throw new Error("Patient ID Missing")

            // PARALLEL FETCHING: Patient, Plan, Diseases, Labs
            // This prevents sequential waterfalls and layout shift
            const [
                { data: patientData, error: patientError },
                { data: planData, error: planError },
                { data: diseasesData, error: diseasesError },
                { data: labsData, error: labsError },
                { data: patientMedsData }
            ] = await Promise.all([
                supabase
                    .from('patients')
                    .select(`
                        *,
                        program_templates (
                            id, name, default_activity_level,
                            program_template_weeks (week_start, week_end, diet_type_id),
                            program_template_restrictions (restriction_type, restriction_value, severity)
                        )
                    `)
                    .eq('id', queryId)
                    .single(),
                supabase
                    .from('diet_plans')
                    .select('*')
                    .eq('patient_id', queryId)
                    .eq('status', 'active')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle(),
                supabase
                    .from('patient_diseases')
                    .select(`id, disease:diseases (id, name, disease_rules (id, rule_type, keywords, match_name, match_tags, keyword_metadata))`)
                    .eq('patient_id', queryId),
                supabase
                    .from('patient_lab_results')
                    .select('*, micronutrients(id, name, unit, default_min, default_max, category, compatible_keywords, incompatible_keywords)')
                    .eq('patient_id', queryId)
                    .order('measured_at', { ascending: false }),
                // Medication rules: first get patient's active medications
                supabase
                    .from('patient_medications')
                    .select('medication_id')
                    .eq('patient_id', queryId)
                    .is('ended_at', null)
            ])

            if (patientError) throw patientError

            // 1. Set Patient
            setPatient(patientData)
            setShowMealBadges(patientData.show_meal_badges !== false)
            setSidebarSortPreference(patientData.sidebar_sort_preference || null)
            if (patientData.program_templates) {
                setPatientProgram(patientData.program_templates)
            }

            // 2. Set Diseases
            if (diseasesData) {
                const mapped = diseasesData.map((d: any) => d.disease).filter(Boolean)
                setPatientDiseases(mapped)
            } else {
                setPatientDiseases([])
            }

            // 3. Set Labs
            if (labsData) {
                const latestLabs: Record<string, any> = {}
                labsData.forEach((lab: any) => {
                    if (!latestLabs[lab.micronutrient_id]) latestLabs[lab.micronutrient_id] = lab
                })
                const result = Object.values(latestLabs)
                setPatientLabs(result)
            }

            // 4. Set Medication Rules
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

            // 5. Handle Plan & Weeks (Dependent on Plan)
            if (planData) {
                setDietPlanId(planData.id)
                if (planData.meal_types) {
                    setMealTypes(planData.meal_types as string[])
                }

                // Fetch Weeks (Must wait for plan ID)
                const { data: weeksData, error: weeksError } = await supabase.from('diet_weeks').select('*').eq('diet_plan_id', planData.id).order('week_number', { ascending: true })

                if (weeksData && weeksData.length > 0) {
                    // Deduplicate logic
                    const uniqueWeeks: DietWeek[] = []
                    const duplicateIds: string[] = []
                    const seenNumbers = new Set<number>()

                    for (const week of weeksData) {
                        if (!seenNumbers.has(week.week_number)) {
                            seenNumbers.add(week.week_number)
                            uniqueWeeks.push(week)
                        } else {
                            duplicateIds.push(week.id)
                        }
                    }

                    setWeeks(uniqueWeeks)
                    setDuplicateWeekIds(duplicateIds)

                    // Fetch Days for all weeks in plan (for tab indicators)
                    const { data: daysData } = await supabase.from('diet_days').select('id, diet_week_id, day_number, is_active').in('diet_week_id', uniqueWeeks.map(w => w.id)).order('day_number', { ascending: true })
                    if (daysData) {
                        setAllPlanDays(daysData)
                    }

                    if (uniqueWeeks.length > 0) {
                        // Only change active week if not already set (or reset required)
                        // Preserve existing selection if possible
                        setActiveWeekId(prev => {
                            if (prev && uniqueWeeks.some(w => w.id === prev)) return prev
                            return uniqueWeeks[0].id
                        })

                        // Sync meal types from active/first week
                        const targetWeek = uniqueWeeks.find(w => w.id === activeWeekId) || uniqueWeeks[0]
                        if (targetWeek && targetWeek.meal_types) {
                            setMealTypes(targetWeek.meal_types as string[])
                        }
                        // If week has no slot_configs, load from planner_settings (patient → program → global)
                        if (!targetWeek?.slot_configs) {
                            // Trigger async loading with program fallback
                            setTimeout(() => refreshMealTypesFromActiveWeek(), 100)
                        } else if (targetWeek.slot_configs) {
                            setSlotConfigs(targetWeek.slot_configs)
                        }
                    }
                } else {
                    if (creatingInitialWeek.current) {
                        console.log("Already creating initial week, skipping...")
                    } else {
                        creatingInitialWeek.current = true
                        try {
                            console.log('No weeks found, creating new week!')
                            await handleAddWeek(planData.id, 1)
                        } finally {
                            creatingInitialWeek.current = false
                        }
                    }
                }
            } else {
                // No diet plan found (New Patient) - Create default plan
                // GUARD: Prevent race conditions
                if (creatingDefaultPlan.current) {
                    console.log("Already creating default plan, skipping...")
                    return
                }

                creatingDefaultPlan.current = true
                console.log('No diet plan found for patient:', queryId, '- Creating default...')

                try {
                    // Double check if plan exists (maybe created by another race)
                    const { data: existing } = await supabase.from('diet_plans').select('id').eq('patient_id', queryId).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()
                    if (existing) {
                        console.log("Race condition avoided: Plan already exists:", existing.id)
                        setDietPlanId(existing.id) // Will trigger re-fetch
                        creatingDefaultPlan.current = false
                        return
                    }

                    // Determine initial meal types based on Patient > Program > Global settings
                    let initialMealTypes = ['KAHVALTI', 'ÖĞLEN', 'AKŞAM', 'ARA ÖĞÜN']
                    let defaultSettings: any = null

                    // a. Patient Settings
                    const { data: pSet } = await supabase.from('planner_settings').select('slot_config').eq('patient_id', queryId).maybeSingle()
                    if (pSet?.slot_config) defaultSettings = pSet

                    // b. Program Settings
                    if (!defaultSettings) {
                        const progId = patientData.program_template_id || patientData.program_templates?.id
                        if (progId) {
                            const { data: progSet } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'program').eq('program_template_id', progId).maybeSingle()
                            if (progSet?.slot_config) defaultSettings = progSet
                        }
                    }

                    // c. Global Settings
                    if (!defaultSettings) {
                        const { data: globSet } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'global').maybeSingle()
                        defaultSettings = globSet
                    }

                    if (defaultSettings?.slot_config && Array.isArray(defaultSettings.slot_config) && defaultSettings.slot_config.length > 0) {
                        initialMealTypes = defaultSettings.slot_config.map((c: any) => c.name)
                    }

                    const { data: newPlan, error: createError } = await supabase.from('diet_plans').insert([{
                        patient_id: queryId,
                        title: 'Diyet Planı',
                        status: 'active',
                        meal_types: initialMealTypes
                    }]).select().single()

                    if (newPlan) {
                        console.log('Created new default plan:', newPlan.id)
                        setDietPlanId(newPlan.id)
                        setMealTypes(newPlan.meal_types)
                        setMealTypes(newPlan.meal_types)
                        // Create first week immediately
                        if (!creatingInitialWeek.current) {
                            creatingInitialWeek.current = true
                            try {
                                console.log('Triggering auto-creation of Week 1...')
                                await handleAddWeek(newPlan.id, 1, patientData)
                            } finally {
                                creatingInitialWeek.current = false
                            }
                        }
                    } else if (createError) {
                        console.error("Error creating default plan:", createError)
                    }
                } finally {
                    creatingDefaultPlan.current = false
                }
            }

        } catch (error: any) {
            console.error("Error fetching patient data:", error)
        } finally {
            setLoading(false)
            isFetching.current = false
        }
    }

    async function handleToggleArchive() {
        if (!patient) return

        const newStatus = patient.status === 'archived' ? 'active' : 'archived'
        const actionName = newStatus === 'active' ? 'Aktifleştirmek' : 'Arşivlemek'

        if (!confirm(`${patient.full_name} isimli hastayı ${actionName.toLowerCase()} istediğinize emin misiniz?`)) {
            return
        }

        const { error } = await supabase
            .from('patients')
            .update({ status: newStatus })
            .eq('id', patient.id)

        if (error) {
            console.error('Error updating patient status:', error)
            alert("Durum güncelleme hatası: " + error.message)
        } else {
            setPatient({ ...patient, status: newStatus })
        }
    }

    async function handleToggleMealBadges() {
        if (!patient) return

        const newShowBadges = !showMealBadges

        const { error } = await supabase
            .from('patients')
            .update({ show_meal_badges: newShowBadges })
            .eq('id', patient.id)

        if (error) {
            console.error('Error updating badge preference:', error)
        } else {
            setShowMealBadges(newShowBadges)
            setPatient({ ...patient, show_meal_badges: newShowBadges })
        }
    }



    async function handleSidebarSortChange(newValue: 'asc' | 'desc' | null) {
        if (!patient) return

        setSidebarSortPreference(newValue)

        const { error } = await supabase
            .from('patients')
            .update({ sidebar_sort_preference: newValue })
            .eq('id', patient.id)

        if (error) {
            console.error('Error updating sidebar sort preference:', error)
        }
    }

    async function handleCleanDuplicates() {
        if (duplicateWeekIds.length === 0) return

        if (!confirm(`${duplicateWeekIds.length} adet yinelenen (gizli) hafta kaydı bulundu. Bunları temizlemek ister misiniz?\n\n(Mevcut görünen haftalar korunacaktır.)`)) {
            return
        }

        setLoading(true)
        const { error } = await supabase.from('diet_weeks').delete().in('id', duplicateWeekIds)

        if (error) {
            alert('Silme hatası: ' + error.message)
        } else {
            alert('Yinelenen haftalar temizlendi.')
            setDuplicateWeekIds([]) // Clear local state
            setRefreshTrigger(prev => prev + 1) // Refresh
        }
        setLoading(false)
    }



    async function handleAddWeek(planId: string, weekNum: number, patientOverride?: Patient) {
        const targetPatient = patientOverride || patient

        // Check if week already exists
        const { data: existing } = await supabase.from('diet_weeks').select('*').eq('diet_plan_id', planId).eq('week_number', weekNum).maybeSingle()
        if (existing) {
            if (!weeks.find(w => w.id === existing.id)) {
                setWeeks(prev => [...prev, existing])
            }
            setActiveWeekId(existing.id)
            return existing
        }

        let startDate: Date
        const sortedWeeks = [...weeks].sort((a, b) => a.week_number - b.week_number)

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
        if (!targetPatient) {
            console.error("handleAddWeek: Patient is missing")
            return
        }

        const lastWeek = sortedWeeks[sortedWeeks.length - 1]

        // Meal Type & Slot Config Inheritance Logic
        let inheritedMealTypes = lastWeek?.meal_types || (mealTypes && mealTypes.length > 0 ? mealTypes : ['KAHVALTI', 'ÖĞLEN', 'AKŞAM', 'ARA ÖĞÜN'])
        let inheritedSlotConfigs = lastWeek?.slot_configs || null

        // If no previous week (Week 1), try to fetch global/patient/program defaults
        if (!lastWeek) {
            // Check for planner_settings with scope='patient' > 'program' > 'global'
            let usedSettings: any = null

            // 1. Patient Settings
            const { data: patientSettings } = await supabase.from('planner_settings').select('slot_config').eq('patient_id', targetPatient.id).maybeSingle()
            if (patientSettings?.slot_config) usedSettings = patientSettings

            // 2. Program Settings
            if (!usedSettings) {
                const progId = targetPatient.program_template_id || targetPatient.program_templates?.id
                if (progId) {
                    const { data: programSettings } = await supabase
                        .from('planner_settings')
                        .select('slot_config')
                        .eq('scope', 'program')
                        .eq('program_template_id', progId)
                        .maybeSingle()
                    if (programSettings?.slot_config) usedSettings = programSettings
                }
            }

            // 3. Global Settings
            if (!usedSettings) {
                const { data: globalSettings } = await supabase.from('planner_settings').select('slot_config').eq('scope', 'global').maybeSingle()
                usedSettings = globalSettings
            }

            if (usedSettings?.slot_config && Array.isArray(usedSettings.slot_config) && usedSettings.slot_config.length > 0) {
                inheritedSlotConfigs = usedSettings.slot_config
                inheritedMealTypes = usedSettings.slot_config.map((c: any) => c.name)
            }
        }

        // Inherit weight from patient's current profile, fallback to last week's log
        const inheritedWeight = patient?.weight ?? lastWeek?.weight_log ?? 0

        // Base inheritance for Diet Type and Activity
        let inheritedDietType = lastWeek?.assigned_diet_type_id ?? null
        let inheritedActivityLevel = patient?.activity_level ?? lastWeek?.activity_level_log ?? 3

        // --- PROGRAM TEMPLATE LOGIC ---
        if (patientProgram) {
            // Activity Level: Use program default if it's the first week or we don't have a previous week to inherit from
            if (weekNum === 1 || !lastWeek) {
                inheritedActivityLevel = patientProgram.default_activity_level || 3
            } else {
                // Inheritance from lastWeek is already handled above.
            }

            // Diet Type: Check program rules for this week number
            if (patientProgram.program_template_weeks) {
                const rule = patientProgram.program_template_weeks.find((pw: any) =>
                    weekNum >= pw.week_start && weekNum <= pw.week_end
                )
                if (rule && rule.diet_type_id) {
                    inheritedDietType = rule.diet_type_id
                }
            }
        }
        // -----------------------------

        const { data } = await supabase.from('diet_weeks').insert([{
            diet_plan_id: planId,
            week_number: weekNum,
            title: `${weekNum}. Hafta`,
            start_date: formatDateISO(startDate),
            end_date: formatDateISO(endDate),
            meal_types: inheritedMealTypes,
            slot_configs: inheritedSlotConfigs, // Inherit slot configs from previous week
            weight_log: inheritedWeight,
            assigned_diet_type_id: inheritedDietType,
            activity_level_log: inheritedActivityLevel
        }]).select().single()

        if (data) {
            setWeeks(prev => [...prev, data])
            setActiveWeekId(data.id)
            const daysToInsert = Array.from({ length: 7 }, (_, i) => ({
                diet_week_id: data.id,
                day_number: i + 1,
                notes: '',
                is_active: true
            }))
            await supabase.from('diet_days').insert(daysToInsert)

            // Apply Persistent Locks for New Week
            const { data: plan } = await supabase.from('diet_plans').select('persistent_locked_meals').eq('id', planId).single()
            const persistentLocks = (plan?.persistent_locked_meals as any[]) || []

            if (persistentLocks.length > 0) {
                // Fetch created days IDs to map offset -> dayId
                const { data: createdDays } = await supabase.from('diet_days').select('id, day_number').eq('diet_week_id', data.id)

                if (createdDays) {
                    const mealsToInsert: any[] = []
                    for (const lock of persistentLocks) {
                        // Find corresponding day (day_number is 1-based, lock.day_offset is 0-based)
                        const targetDay = createdDays.find(d => (d.day_number - 1) === lock.day_offset)
                        if (targetDay) {
                            mealsToInsert.push({
                                diet_day_id: targetDay.id,
                                meal_time: lock.meal_time,
                                food_id: lock.food_id,
                                portion_multiplier: lock.portion_multiplier,
                                is_locked: true,
                                sort_order: 0,
                                custom_notes: 'Otomatik Plan Kuralı'
                            })
                        }
                    }

                    if (mealsToInsert.length > 0) {
                        const { error: insertError } = await supabase.from('diet_meals').insert(mealsToInsert)
                        if (insertError) {
                            alert('Otomatik kilitli yemek ekleme hatası: ' + insertError.message)
                        } else {
                            // Success feedback (optional, distinct from week add)
                            console.log(`${mealsToInsert.length} persistent meals added.`)
                        }
                    }
                }
            }
        }
        return data
    }

    async function addNewWeek() {
        if (!patient) return;
        let planId = null;
        const { data: planData } = await supabase.from('diet_plans').select('id').eq('patient_id', id).eq('status', 'active').order('created_at', { ascending: false }).limit(1).maybeSingle()

        if (planData) {
            planId = planData.id;
        } else {
            const { data: newPlan, error: planError } = await supabase.from('diet_plans').insert([{
                patient_id: id,
                title: 'Diyet Planım',
                status: 'active',
                meal_types: (patient as any)?.preferences?.default_meal_types || ['KAHVALTI', 'ÖĞLE', 'AKŞAM', 'ARA ÖĞÜN']
            }]).select().single();
            if (planError) {
                alert('Plan oluşturulamadı: ' + planError.message);
                return;
            }
            planId = newPlan.id;
        }

        if (planId) {
            let nextWeekNum = 1;
            if (weeks.length > 0) {
                const sortedNums = weeks.map(w => w.week_number).sort((a, b) => a - b);
                const maxWeek = sortedNums[sortedNums.length - 1];
                const activeWeekObj = weeks.find(w => w.id === activeWeekId);
                const startCheckFrom = activeWeekObj ? activeWeekObj.week_number : 0;

                let gapFound: number | null = null;
                for (let i = startCheckFrom + 1; i <= maxWeek; i++) {
                    if (!sortedNums.includes(i)) {
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
            await handleAddWeek(planId, nextWeekNum);
        }
    }

    async function handleImport(parsedDays: ParsedDay[], importMode: 'append' | 'replace') {
        if (!activeWeekId || !activeWeek) return

        // Get days of the active week
        const { data: weekDays } = await supabase.from('diet_days').select('id, day_number').eq('diet_week_id', activeWeekId).order('day_number')
        if (!weekDays) return

        if (importMode === 'replace') {
            // Delete existing meals (excluding locked ones)
            // We need to know which days we are updating. parsedDays[i] maps to weekDays[i].
            const dayIdsToClear = parsedDays.map((_, i) => weekDays[i]?.id).filter(Boolean)

            if (dayIdsToClear.length > 0) {
                const { error: delError } = await supabase
                    .from('diet_meals')
                    .delete()
                    .in('diet_day_id', dayIdsToClear)
                    .eq('is_locked', false) // PRESERVE LOCKED MEALS

                if (delError) {
                    alert('Eski veriler temizlenirken hata: ' + delError.message)
                    return
                }
            }
        }

        const mealsToInsert: any[] = []
        const foodsToCreate: any[] = [] // Future: Handle unknown foods? For now we only insert matched or use a placeholder if needed.

        // Strategy: Match parsed day index to week day index
        // parsedDays[0] -> weekDays[0] (Pazartesi -> Day 1)

        for (let i = 0; i < parsedDays.length; i++) {
            const parsedDay = parsedDays[i]
            const targetDay = weekDays[i] // Simple index mapping for now. Could match by name if day_number represents day of week.

            if (!targetDay) continue // More parsed days than week days

            // Update day active status in DB
            const isActive = parsedDay.is_active !== false;
            await supabase.from('diet_days').update({ is_active: isActive }).eq('id', targetDay.id)

            if (!isActive) continue; // Skip inserting meals if day is marked inactive

            for (const meal of parsedDay.meals) {
                let sortOrderCounter = 1
                for (const food of meal.foods) {
                    if (food.matchedFoodId) {
                        mealsToInsert.push({
                            diet_day_id: targetDay.id,
                            meal_time: meal.mealName,
                            food_id: food.matchedFoodId,
                            portion_multiplier: 1,
                            sort_order: sortOrderCounter++,
                            is_locked: false
                        })
                    } else if (food.status === 'unknown') {
                        // Insert as Custom Meal (Unregistered)
                        mealsToInsert.push({
                            diet_day_id: targetDay.id,
                            meal_time: meal.mealName,
                            food_id: null, // No relation
                            custom_name: food.originalText || food.foodName,
                            calories: food.calories,
                            protein: food.protein,
                            carbs: food.carbs,
                            fat: food.fat,
                            portion_multiplier: 1,
                            sort_order: sortOrderCounter++,
                            is_locked: false,
                            is_custom: true
                        })
                    } else if (food.status === 'created') {
                        // Insert as Custom Meal (Zero-macro or newly created)
                        mealsToInsert.push({
                            diet_day_id: targetDay.id,
                            meal_time: meal.mealName,
                            food_id: null, // No relation
                            custom_name: food.originalText || food.foodName,
                            calories: food.calories,
                            protein: food.protein,
                            carbs: food.carbs,
                            fat: food.fat,
                            portion_multiplier: 1,
                            sort_order: sortOrderCounter++,
                            is_locked: false,
                            is_custom: true
                        })
                    }
                }
            }
        }

        // --- NEW: Detect and Add Missing Meal Types ---
        const importedMealTypes = new Set<string>()
        parsedDays.forEach(d => d.meals.forEach(m => importedMealTypes.add(m.mealName)))

        const currentTypesLower = mealTypes.map(t => t.toLowerCase())
        const typesToAdd: string[] = []

        importedMealTypes.forEach(type => {
            if (!currentTypesLower.includes(type.toLowerCase())) {
                typesToAdd.push(type)
            }
        })

        if (typesToAdd.length > 0) {
            console.log('Import: Found new meal types, adding to week:', typesToAdd)
            const newMealTypes = [...mealTypes, ...typesToAdd]
            // Update local state immediately explicitly
            setMealTypes(newMealTypes)
            // Persist
            await persistMealTypes(newMealTypes)
        }

        // --- Insert Meals ---
        if (mealsToInsert.length > 0) {
            console.log(`Import: Inserting ${mealsToInsert.length} meals into DB...`)
            const { error } = await supabase.from('diet_meals').insert(mealsToInsert)
            if (error) {
                console.error('Import Insert Error:', error)
                alert('İçe aktarma hatası: ' + error.message)
            } else {
                console.log('Import: Insert success!')
                setRefreshTrigger(prev => prev + 1)
                // alert('Program başarıyla içe aktarıldı.') // REMOVED
            }
        } else {
            console.warn('Import: No meals matched to insert.')
            alert('Eklenecek eşleşen besin bulunamadı.')
        }
    }

    // --- BULK IMPORT: Import multiple weeks at once ---
    async function handleBulkImport(weekData: { weekNumber: number, days: ParsedDay[], startDate?: string, endDate?: string }[]) {
        if (!dietPlanId) {
            alert('Plan bulunamadı.')
            return
        }

        console.log(`Bulk Import: Processing ${weekData.length} weeks...`)

        let firstImportedWeekId: string | null = null


        // Check if this is a "Full Plan Import" (starts from week 1)
        const isFullPlanImport = weekData.some(w => w.weekNumber === 1)

        if (isFullPlanImport) {
            // User requested: "bunları silip üzerine yeni planı giydirsin"
            console.log("Bulk Import: Full plan import detected. Cleaning existing weeks...")

            // Delete ALL weeks for this plan to start fresh
            // Optimized manual cascade to avoid timeouts
            console.log(`Bulk Import: Querying weeks for dietPlanId=${dietPlanId}`)
            const { data: weekIdsData, error: weekIdsError } = await supabase.from('diet_weeks').select('id').eq('diet_plan_id', dietPlanId)
            console.log(`Bulk Import: Found ${weekIdsData?.length || 0} weeks to delete`, weekIdsError || '')

            if (weekIdsData && weekIdsData.length > 0) {
                const weekIds = weekIdsData.map(w => w.id)
                console.log(`Bulk Import: Deleting ${weekIds.length} existing weeks...`)

                // 1. Delete Days (Cascades to Meals)
                // Batch delete to be safe
                const BATCH_SIZE = 20
                for (let i = 0; i < weekIds.length; i += BATCH_SIZE) {
                    const batchIds = weekIds.slice(i, i + BATCH_SIZE)
                    const { error: daysDelError } = await supabase.from('diet_days').delete().in('diet_week_id', batchIds)
                    if (daysDelError) {
                        console.error("Bulk Import: Days delete error:", daysDelError)
                        // Continue anyway to try deleting weeks
                    }
                }

                // 2. Delete Weeks
                const { error: weeksDelError } = await supabase.from('diet_weeks').delete().in('id', weekIds)
                if (weeksDelError) {
                    console.error("Bulk Import: Weeks delete error:", weeksDelError)
                    alert("Eski haftalar silinemedi: " + weeksDelError.message)
                    return
                }
            }



            // Clear local state
            setWeeks([])
            // small delay to ensure DB sync
            await new Promise(r => setTimeout(r, 500))
        }

        for (const week of weekData) {
            console.log(`Bulk Import: Week ${week.weekNumber}...`)

            // Find or create the week
            // IMPORTANT: When isFullPlanImport, we just deleted all weeks, so skip stale state check
            let targetWeek = null

            if (!isFullPlanImport) {
                // Only check existing weeks if NOT a full plan import
                targetWeek = weeks.find(w => w.week_number === week.weekNumber)

                // Double check DB to prevent duplicates if UI is out of sync
                if (!targetWeek) {
                    const { data: dbWeek } = await supabase.from('diet_weeks').select('*').eq('diet_plan_id', dietPlanId).eq('week_number', week.weekNumber).maybeSingle()
                    if (dbWeek) {
                        targetWeek = dbWeek
                        // Sync local state if missing
                        setWeeks(prev => [...prev, dbWeek].sort((a, b) => a.week_number - b.week_number))
                    }
                }
            }

            if (!targetWeek) {
                // Create the week
                console.log(`Bulk Import: Creating week ${week.weekNumber}...`)
                const weekStart = week.startDate ? new Date(week.startDate) : (
                    weeks.length > 0 && weeks[0].start_date
                        ? new Date(weeks[0].start_date)
                        : new Date()
                )

                if (!week.startDate) {
                    weekStart.setDate(weekStart.getDate() + (week.weekNumber - 1) * 7)
                }

                const weekEnd = week.endDate ? new Date(week.endDate) : new Date(weekStart)
                if (!week.endDate) {
                    weekEnd.setDate(weekEnd.getDate() + 6)
                }

                // --- PROGRAM TEMPLATE LOGIC FOR BULK IMPORT ---
                let dietTypeId = null
                let activityLevel = patient?.activity_level || 3

                if (patientProgram) {
                    activityLevel = patientProgram.default_activity_level || 3

                    if (patientProgram.program_template_weeks) {
                        const rule = patientProgram.program_template_weeks.find((pw: any) =>
                            week.weekNumber >= pw.week_start && week.weekNumber <= pw.week_end
                        )
                        if (rule) dietTypeId = rule.diet_type_id
                    }
                }
                // ----------------------------------------------

                const { data: newWeek, error } = await supabase
                    .from('diet_weeks')
                    .insert([{
                        diet_plan_id: dietPlanId,
                        week_number: week.weekNumber,
                        title: `${week.weekNumber}. Hafta`,
                        start_date: formatDateISO(weekStart),
                        end_date: formatDateISO(weekEnd),
                        meal_types: mealTypes,
                        assigned_diet_type_id: dietTypeId,
                        activity_level_log: activityLevel
                    }])
                    .select()
                    .single()

                if (error || !newWeek) {
                    console.error(`Week ${week.weekNumber} creation error:`, error)
                    continue
                }

                targetWeek = newWeek

                // Create days for the new week
                const daysToCreate = []
                for (let i = 0; i < 7; i++) {
                    const dayDate = new Date(weekStart)
                    dayDate.setDate(dayDate.getDate() + i)
                    
                    const dayNames = ['PAZARTESİ', 'SALI', 'ÇARŞAMBA', 'PERŞEMBE', 'CUMA', 'CUMARTESİ', 'PAZAR']
                    const currentDayName = dayNames[i]
                    const parsedDay = week.days.find((d: any) => d.dayName.toUpperCase() === currentDayName || d.dayName.toUpperCase().includes(currentDayName))
                    const isActive = parsedDay ? parsedDay.is_active !== false : true

                    daysToCreate.push({
                        diet_week_id: newWeek.id,
                        day_number: i + 1,
                        is_active: isActive
                    })
                }
                await supabase.from('diet_days').insert(daysToCreate)

                // Update local state
                setWeeks(prev => [...prev, newWeek].sort((a, b) => {
                    const aNum = a.title?.match(/(\d+)/)?.[1] || '0'
                    const bNum = b.title?.match(/(\d+)/)?.[1] || '0'
                    return parseInt(aNum, 10) - parseInt(bNum, 10)
                }))
            }

            // Now import meals for this week
            if (targetWeek) {
                if (!firstImportedWeekId) firstImportedWeekId = targetWeek.id

                // Fetch days for this week
                const { data: weekDays, error: daysError } = await supabase
                    .from('diet_days')
                    .select('*')
                    .eq('diet_week_id', targetWeek.id)
                    .order('day_number', { ascending: true })

                if (daysError) {
                    console.error(`Week ${week.weekNumber} days fetch error:`, daysError.message, daysError.code, daysError.details)
                }

                // If no days exist for this week, CREATE THEM
                let actualWeekDays = weekDays || []
                if (actualWeekDays.length === 0) {
                    console.log(`Bulk Import: Week ${week.weekNumber} has no days, creating them...`)
                    const daysToCreate = Array.from({ length: 7 }, (_, i) => ({
                        diet_week_id: targetWeek.id,
                        day_number: i + 1,
                        is_active: true
                    }))
                    const { data: createdDays, error: createDaysError } = await supabase
                        .from('diet_days')
                        .insert(daysToCreate)
                        .select()

                    if (createDaysError) {
                        console.error(`Week ${week.weekNumber} days creation error:`, createDaysError)
                        continue // Now we truly can't proceed
                    }
                    actualWeekDays = createdDays || []
                    if (actualWeekDays.length === 0) {
                        console.error(`Week ${week.weekNumber} days creation returned empty`)
                        continue
                    }
                }

                const dayNameToNumber: Record<string, number> = {
                    'PAZARTESİ': 1, 'SALI': 2, 'ÇARŞAMBA': 3, 'PERŞEMBE': 4,
                    'CUMA': 5, 'CUMARTESİ': 6, 'PAZAR': 7,
                    // Tolerant mappings for I/i issues
                    'PAZARTESI': 1, 'CARSAMBA': 3, 'PERSEMBE': 4,
                    'CUMARTESI': 6
                }

                // DELETE EXISTING MEALS first (Replace mode)
                const dayIds = actualWeekDays.map(d => d.id)
                if (dayIds.length > 0) {
                    await supabase.from('diet_meals').delete().in('diet_day_id', dayIds)
                }

                const mealsToInsert: any[] = []
                // Global sort order counter to maintain relative order across the whole week import
                // Though usually per day/meal is enough, let's keep it simple and increment
                let sortOrderCounter = 1

                for (const parsedDay of week.days) {
                    const dayNameKey = parsedDay.dayName.toLocaleUpperCase('tr-TR')
                    let dayNum = dayNameToNumber[dayNameKey]

                    // Fallback to English upper case if not found
                    if (!dayNum) {
                        dayNum = dayNameToNumber[parsedDay.dayName.toUpperCase()]
                    }

                    if (!dayNum) continue

                    const targetDay = actualWeekDays.find(d => d.day_number === dayNum)
                    if (!targetDay) continue

                    for (const meal of parsedDay.meals) {
                        for (const food of meal.foods) {
                            if (food.matchedFoodId) {
                                mealsToInsert.push({
                                    diet_day_id: targetDay.id,
                                    food_id: food.matchedFoodId,
                                    meal_time: meal.mealName.toUpperCase(),
                                    portion_multiplier: food.portionMultiplier || 1,
                                    calories: food.calories,
                                    protein: food.protein,
                                    carbs: food.carbs,
                                    fat: food.fat,
                                    sort_order: sortOrderCounter++
                                })
                            } else {
                                // Custom meal
                                mealsToInsert.push({
                                    diet_day_id: targetDay.id,
                                    food_id: null,
                                    meal_time: meal.mealName.toUpperCase(),
                                    is_custom: true,
                                    custom_name: food.foodName,
                                    portion_multiplier: 1, // Important: prevents null multiplication
                                    calories: food.calories || 0,
                                    protein: food.protein || 0,
                                    carbs: food.carbs || 0,
                                    fat: food.fat || 0,
                                    sort_order: sortOrderCounter++
                                })
                            }
                        }
                    }
                }

                if (mealsToInsert.length > 0) {
                    const { error } = await supabase.from('diet_meals').insert(mealsToInsert)
                    if (error) {
                        console.error(`Week ${week.weekNumber} meals insert error:`, error)
                    } else {
                        console.log(`Week ${week.weekNumber}: ${mealsToInsert.length} meals inserted.`)
                    }
                }
            }
        }

        console.log('Bulk Import: Complete!')
        setRefreshTrigger(prev => prev + 1)
        
        // Auto-select first week after bulk import
        if (firstImportedWeekId) {
            setActiveWeekId(firstImportedWeekId)
        } else if (isFullPlanImport) {
            setActiveWeekId(null) // Forces re-selection in fetchPatientData
        }
        
        setImportDialogOpen(false)
    }

    async function persistMealTypes(newMealTypes: string[], newSlotConfigs?: any[]) {
        setMealTypes(newMealTypes)
        if (newSlotConfigs) {
            setSlotConfigs(newSlotConfigs)
        }

        // Save to diet_plans for this patient (meal_types only for backward compatibility)
        if (dietPlanId) {
            await supabase.from('diet_plans').update({ meal_types: newMealTypes }).eq('id', dietPlanId)
        }

        // Save both meal_types AND slot_configs to the active week
        // This is the single source of truth for slot configuration
        if (activeWeekId) {
            await supabase.from('diet_weeks').update({
                meal_types: newMealTypes,
                slot_configs: newSlotConfigs || null
            }).eq('id', activeWeekId)

            // Update local state for weeks
            setWeeks(weeks.map(w => w.id === activeWeekId ? {
                ...w,
                meal_types: newMealTypes,
                slot_configs: newSlotConfigs || null
            } : w))
        }

        // NEW: Save to planner_settings for this patient so next weeks inherit this
        if (id) {
            const { error: settingsError } = await supabase.from('planner_settings').upsert({
                patient_id: id,
                scope: 'patient',
                slot_config: newSlotConfigs || [], // use singular slot_config as per schema
                // We don't have other fields here, hope upsert handles partial or we need to fetch first?
                // planner_settings might have other constrained fields.
                // Safest is to update if exists, or insert with defaults?
                // Actually maybeSingle check first is safer to avoid overwriting other fields if we use upsert without all data?
                // But upsert with just ID and changed fields SHOULD work for simple updates if row exists.
                // However, if row invalidates constraints (like user_id?), we might need more data.
                // Let's assume simple upsert is fine or check if row exists.
            }, { onConflict: 'patient_id' })

            if (settingsError) console.error("Error saving patient planner settings:", settingsError)
        }
    }

    function openWeekEditor(week: DietWeek) {
        setEditingWeek(week)
        setWeekDialogOpen(true)
    }

    async function saveWeek(weekId: string, title: string, startDate: string, endDate: string, weight: number, dietTypeId: string | null, activityLevel: number) {
        const start = new Date(startDate)
        const end = new Date(endDate)

        // Calculate new day count
        const newDayCount = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1)

        // Update week
        const { error } = await supabase.from('diet_weeks').update({
            title,
            start_date: formatDateISO(start),
            end_date: formatDateISO(end),
            weight_log: weight,
            assigned_diet_type_id: dietTypeId,
            activity_level_log: activityLevel
        }).eq('id', weekId)

        if (error) {
            alert('Hafta güncellenemedi: ' + error.message)
            return
        }

        // SYNC WEIGHT AND ACTIVITY to base profile and history
        if (id && weight && activityLevel) {
            try {
                const { syncPatientWeightAndActivityAction } = await import('@/actions/measurement-actions')
                const syncRes = await syncPatientWeightAndActivityAction(
                    id,
                    weight,
                    activityLevel,
                    weekId,
                    'Diyetisyen'
                )
                if (!syncRes.success) {
                    console.warn("Partial sync failure in saveWeek:", syncRes.errors)
                }
            } catch (syncErr) {
                console.error("Error dynamically loading measurement-sync:", syncErr)
            }
        }

        // Get existing days
        const { data: existingDays } = await supabase.from('diet_days').select('id, day_number').eq('diet_week_id', weekId).order('day_number', { ascending: true })
        const existingCount = existingDays?.length || 0

        if (newDayCount > existingCount) {
            // Add new days
            const daysToAdd = Array.from({ length: newDayCount - existingCount }, (_, i) => ({
                diet_week_id: weekId,
                day_number: existingCount + i + 1,
                notes: ''
            }))
            await supabase.from('diet_days').insert(daysToAdd)
        } else if (newDayCount < existingCount && existingDays) {
            // Remove extra days (and their meals)
            const daysToRemove = existingDays.slice(newDayCount)
            for (const day of daysToRemove) {
                await supabase.from('diet_meals').delete().eq('diet_day_id', day.id)
                await supabase.from('diet_days').delete().eq('id', day.id)
            }
        }

        setWeeks(weeks.map(w => w.id === weekId ? {
            ...w,
            title,
            start_date: formatDateISO(start),
            end_date: formatDateISO(end),
            weight_log: weight,
            assigned_diet_type_id: dietTypeId,
            activity_level_log: activityLevel
        } : w))
        setWeekDialogOpen(false)
        setEditingWeek(null)
        setRefreshTrigger(prev => prev + 1) // Refresh to show new days
    }

    async function deleteWeek(weekId: string) {
        // UI already asks for confirmation, no need for browser alert
        setLoading(true)
        try {
            console.log("Deleting week:", weekId)
            // Delete meals first - iterating days
            const { data: days } = await supabase.from('diet_days').select('id').eq('diet_week_id', weekId)
            if (days && days.length > 0) {
                for (const day of days) {
                    await supabase.from('diet_meals').delete().eq('diet_day_id', day.id)
                }
            }

            // Delete days
            const { error: dError } = await supabase.from('diet_days').delete().eq('diet_week_id', weekId)
            if (dError) {
                console.error("Error deleting days:", dError)
                throw new Error('Günler silinemedi: ' + dError.message)
            }

            // Delete week
            const { error: wError } = await supabase.from('diet_weeks').delete().eq('id', weekId)
            if (wError) {
                console.error("Error deleting week:", wError)
                throw new Error('Hafta silinemedi: ' + wError.message)
            }

            // Update State
            setWeeks(prev => {
                const newWeeks = prev.filter(w => w.id !== weekId)
                // If we deleted the active week, switch to the first available week or null
                if (activeWeekId === weekId) {
                    setActiveWeekId(newWeeks.length > 0 ? newWeeks[0].id : null)
                }
                return newWeeks
            })

            setWeekDialogOpen(false)
            setEditingWeek(null)
            console.log("Week deleted successfully")

        } catch (err: any) {
            alert(err.message)
            console.error("Delete week error:", err)
        } finally {
            setLoading(false)
        }
    }

    async function handleLockConfirm(scope: 'single' | 'week' | 'plan', deleteFuture: boolean) {
        if (!lockDialogData || !lockDialogData.meal) return

        const meal = lockDialogData.meal
        const mode = lockDialogData.mode

        if (mode === 'lock') {
            if (scope === 'single') {
                await supabase.from('diet_meals').update({ is_locked: true }).eq('id', meal.id)
            } else {
                // Propagation Logic
                const { data: dayData } = await supabase.from('diet_days').select('diet_week_id, day_number').eq('id', meal.diet_day_id).single()

                // Get week and plan info. ActiveWeekId might differ if we support multi-week view, but handled by activeWeekId usually.
                // Better to fetch week from dayData relation if possible, or use activeWeekId if we are sure meal is in active week.
                // Let's assume activeWeekId is correct for UI context.

                const { data: weekData } = await supabase.from('diet_weeks').select('start_date, diet_plan_id').eq('id', activeWeekId).single()

                if (dayData && weekData) {
                    const startDate = new Date(weekData.start_date)
                    const mealDate = new Date(startDate)
                    // day_number is 1-based. Add (day_number - 1) days.
                    mealDate.setDate(startDate.getDate() + (dayData.day_number - 1))

                    const { error } = await supabase.rpc('propagate_locked_meal', {
                        p_plan_id: weekData.diet_plan_id,
                        p_week_id: activeWeekId,
                        p_day_date: formatDateISO(mealDate),
                        p_meal_time: meal.meal_time,
                        p_food_id: meal.foods.id,
                        p_portion_multiplier: meal.portion_multiplier,
                        p_scope: scope
                    })

                    if (error) {
                        alert('Kilit yayma hatası: ' + error.message)
                    } else if (scope === 'plan') {
                        // Save to persistent_locked_meals
                        const dayOffset = (dayData.day_number - 1) % 7
                        const { data: plan } = await supabase.from('diet_plans').select('persistent_locked_meals').eq('id', weekData.diet_plan_id).single()
                        const currentLocks = (plan?.persistent_locked_meals as any[]) || []

                        // Create locks for ALL 7 days of the week since scope is 'plan'
                        const newLocks = []
                        for (let i = 0; i < 7; i++) {
                            newLocks.push({
                                day_offset: i,
                                meal_time: meal.meal_time,
                                food_id: meal.foods.id,
                                portion_multiplier: meal.portion_multiplier
                            })
                        }

                        // Remove any existing locks for this meal_time across all days (overwrite with new plan rule)
                        const updatedLocks = currentLocks.filter(l => !(l.meal_time === meal.meal_time && l.food_id === meal.foods.id))
                        updatedLocks.push(...newLocks)


                        const { error: updateError } = await supabase.from('diet_plans').update({ persistent_locked_meals: updatedLocks }).eq('id', weekData.diet_plan_id)
                        if (updateError) {
                            alert('Plan kuralı kaydetme hatası: ' + updateError.message)
                        } else {
                            // alert('DEBUG: Kilit kuralı başarıyla kaydedildi.')
                        }
                    }
                }
            }
        } else {
            // Unlock
            if (!deleteFuture) {
                await supabase.from('diet_meals').update({ is_locked: false }).eq('id', meal.id)
            } else {
                // Unlock and delete future copies
                const { data: dayData } = await supabase.from('diet_days').select('day_number').eq('id', meal.diet_day_id).single()
                const { data: weekData } = await supabase.from('diet_weeks').select('start_date, diet_plan_id').eq('id', activeWeekId).single()

                if (dayData && weekData) {
                    const startDate = new Date(weekData.start_date)
                    const mealDate = new Date(startDate)
                    mealDate.setDate(startDate.getDate() + (dayData.day_number - 1))

                    // Unlock CURRENT meal first
                    await supabase.from('diet_meals').update({ is_locked: false }).eq('id', meal.id)

                    // Delete future
                    const { error } = await supabase.rpc('delete_propagated_meals', {
                        p_plan_id: weekData.diet_plan_id,
                        p_week_id: activeWeekId,
                        p_day_date: formatDateISO(mealDate),
                        p_meal_time: meal.meal_time,
                        p_food_id: meal.foods.id
                    })

                    if (error) {
                        alert('Gelecek kilitleri silme hatası: ' + error.message)
                    } else {
                        // Also remove from persistent_locked_meals if it exists there
                        const { data: plan } = await supabase.from('diet_plans').select('persistent_locked_meals').eq('id', weekData.diet_plan_id).single()
                        if (plan && plan.persistent_locked_meals) {
                            const currentLocks = (plan.persistent_locked_meals as any[]) || []
                            // Check if this meal corresponds to a locked rule
                            const updatedLocks = currentLocks.filter(l => !(l.meal_time === meal.meal_time && l.food_id === meal.foods.id))

                            if (updatedLocks.length !== currentLocks.length) {
                                await supabase.from('diet_plans').update({ persistent_locked_meals: updatedLocks }).eq('id', weekData.diet_plan_id)
                            }
                        }
                    }
                }
            }
        }
        setLockDialogData(null)
        setRefreshTrigger(prev => prev + 1)
    }

    async function handleNoteLockConfirm(scope: 'single' | 'week' | 'plan', deleteFuture: boolean) {
        if (!noteLockDialogData || !noteLockDialogData.note) return

        const note = noteLockDialogData.note
        const mode = noteLockDialogData.mode

        if (mode === 'lock') {
            if (scope === 'single') {
                await supabase.from('diet_notes').update({ is_locked: true }).eq('id', note.id)
            } else {
                const { data: dayData } = await supabase.from('diet_days').select('day_number').eq('id', note.diet_day_id).single()
                const { data: weekData } = await supabase.from('diet_weeks').select('start_date, diet_plan_id').eq('id', activeWeekId).single()

                if (dayData && weekData) {
                    const startDate = new Date(weekData.start_date)
                    const noteDate = new Date(startDate)
                    noteDate.setDate(startDate.getDate() + (dayData.day_number - 1))

                    const { error } = await supabase.rpc('propagate_diet_note', {
                        p_plan_id: weekData.diet_plan_id,
                        p_week_id: activeWeekId,
                        p_day_date: formatDateISO(noteDate),
                        p_content: note.content,
                        p_scope: scope,
                        p_original_note_id: note.id
                    })

                    if (error) {
                        alert('Not yayma hatası: ' + error.message)
                    } else if (scope === 'plan') {
                        const { data: plan } = await supabase.from('diet_plans').select('persistent_locked_notes').eq('id', weekData.diet_plan_id).single()
                        const currentLocks = (plan?.persistent_locked_notes as any[]) || []

                        const newLocks = []
                        for (let i = 0; i < 7; i++) {
                            newLocks.push({
                                day_offset: i,
                                content: note.content,
                                original_note_id: note.id
                            })
                        }

                        const updatedLocks = currentLocks.filter(l => l.original_note_id !== note.id)
                        updatedLocks.push(...newLocks)

                        await supabase.from('diet_plans').update({ persistent_locked_notes: updatedLocks }).eq('id', weekData.diet_plan_id)
                    }
                }
            }
        } else {
            if (!deleteFuture) {
                await supabase.from('diet_notes').update({ is_locked: false }).eq('id', note.id)
            } else {
                const { data: dayData } = await supabase.from('diet_days').select('day_number').eq('id', note.diet_day_id).single()
                const { data: weekData } = await supabase.from('diet_weeks').select('start_date, diet_plan_id').eq('id', activeWeekId).single()

                if (dayData && weekData) {
                    const startDate = new Date(weekData.start_date)
                    const noteDate = new Date(startDate)
                    noteDate.setDate(startDate.getDate() + (dayData.day_number - 1))

                    await supabase.from('diet_notes').update({ is_locked: false }).eq('id', note.id)

                    const { error } = await supabase.rpc('delete_propagated_notes', {
                        p_plan_id: weekData.diet_plan_id,
                        p_week_id: activeWeekId,
                        p_day_date: formatDateISO(noteDate),
                        p_original_note_id: note.id
                    })

                    if (error) {
                        alert('Gelecek notları silme hatası: ' + error.message)
                    } else {
                        const { data: plan } = await supabase.from('diet_plans').select('persistent_locked_notes').eq('id', weekData.diet_plan_id).single()
                        if (plan && plan.persistent_locked_notes) {
                            const currentLocks = (plan.persistent_locked_notes as any[]) || []
                            const updatedLocks = currentLocks.filter(l => l.original_note_id !== note.id)
                            if (updatedLocks.length !== currentLocks.length) {
                                await supabase.from('diet_plans').update({ persistent_locked_notes: updatedLocks }).eq('id', weekData.diet_plan_id)
                            }
                        }
                    }
                }
            }
        }
        setNoteLockDialogData(null)
        setRefreshTrigger(prev => prev + 1)
    }

    async function toggleNoteLock(noteId: string, currentStatus: boolean) {
        const { data: note, error } = await supabase.from('diet_notes').select('*').eq('id', noteId).single()
        if (error || !note) {
            alert('Not verisi alınamadı')
            return
        }
        setNoteLockDialogData({
            open: true,
            mode: currentStatus ? 'unlock' : 'lock',
            note: note
        })
    }


    async function toggleMealLock(mealId: string, currentStatus: boolean) {
        // Use explicit FK to avoid ambiguity
        const { data: meal, error } = await supabase.from('diet_meals').select('*, foods!diet_meals_food_id_fkey(*)').eq('id', mealId).single()
        if (error || !meal) {
            console.error("Lock Data Fetch Error:", error)
            alert('Yemek verisi alınamadı: ' + (error?.message || 'Bilinmeyen hata'))
            return
        }
        setLockDialogData({
            open: true,
            mode: currentStatus ? 'unlock' : 'lock',
            meal: meal
        })
    }

    function getWeekLabel(week: DietWeek): string {
        if (week.start_date && week.end_date) {
            const start = formatShortDate(new Date(week.start_date))
            const end = formatShortDate(new Date(week.end_date))
            return `${week.title || week.week_number + '. Hafta'} (${start} - ${end})`
        }
        return week.title || `${week.week_number}. Hafta`
    }

    function handleDragStart(event: DragStartEvent) {
        const { active } = event
        if (active.data.current?.type === 'food') {
            setActiveDragFood(active.data.current.food)
        }
    }

    // Resizable Sidebar State
    const [sidebarWidth, setSidebarWidth] = useState(320)
    const [isResizing, setIsResizing] = useState(false)

    useEffect(() => {
        const saved = localStorage.getItem('diet_sidebar_width')
        if (saved) setSidebarWidth(parseInt(saved))
    }, [])

    function handleResizeDown(e: React.MouseEvent) {
        setIsResizing(true)
        e.preventDefault()
    }

    function handleResizeMove(e: React.MouseEvent) {
        if (!isResizing) return
        const newWidth = e.clientX
        // Min 50px (almost collapsed), Max 1200px (wide view)
        if (newWidth > 50 && newWidth < 1200) {
            setSidebarWidth(newWidth)
        }
    }

    function handleResizeUp() {
        if (isResizing) {
            setIsResizing(false)
            localStorage.setItem('diet_sidebar_width', sidebarWidth.toString())
        }
    }

    
    async function insertMealToDB(food: any, dropData: any) {
        if (!food || !dropData) return
        const { data: existingMeals } = await supabase
            .from('diet_meals')
            .select('sort_order')
            .eq('diet_day_id', dropData.dayId)
            .eq('meal_time', dropData.mealTime)
            .order('sort_order', { ascending: false })
            .limit(1)

        const nextOrder = (existingMeals?.[0]?.sort_order || 0) + 1

        const { data: insertedData, error } = await supabase.from('diet_meals').insert([{
            diet_day_id: dropData.dayId,
            food_id: food.id,
            meal_time: dropData.mealTime,
            portion_multiplier: 1,
            sort_order: nextOrder,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat,
            is_consumed: true
        }]).select()

        if (error) {
            console.error("DB INSERT ERROR:", error)
            alert(`Hata: ${error.message}`)
        } else {
            setRefreshTrigger(prev => prev + 1)
        }
    }

    async function handleDragEnd(event: DragEndEvent) {
        setActiveDragFood(null) // Clear the drag overlay
        handleResizeUp() // Ensure resize stops too if drag ends (safety)

        const { active, over } = event
        if (!over) return

        const activeType = active.data.current?.type
        const dropType = over.data.current?.type

        if (activeType === 'food' && dropType === 'meal-slot') {
            const food = active.data.current?.food
            const dropData = over.data.current

            if (!food || !dropData) return

            // Check Restrictions
            const compatibility = checkCompatibility(food, activeDietRules)
            if (!compatibility.compatible && compatibility.severity === 'block') {
                setBlockedFoodDialog({ open: true, food, dropData, reason: compatibility.reason })
                return
            }

            await insertMealToDB(food, dropData)
        }
    }

    if (loading) return <div className="p-8">Yükleniyor...</div>
    if (!patient) return <div className="p-8">Hasta bulunamadı.</div>

    const activeWeek = weeks.find(w => w.id === activeWeekId)

    // Dynamic Data from Active Week
    const currentWeight = activeWeek?.weight_log || patient.weight || 0
    const currentActivity = activeWeek?.activity_level_log || patient.activity_level || 3
    // 0. Try PATIENT SPECIFIC RULE override (Highest priority)
    let currentDietTypeObj: any = undefined

    const patientOverride = patient?.planning_rules?.find((r: any) =>
        r.rule_type === 'week_override' &&
        r.is_active &&
        activeWeek?.week_number &&
        r.definition?.data?.week_start <= activeWeek?.week_number &&
        r.definition?.data?.week_end >= activeWeek?.week_number
    )

    if (patientOverride && patientOverride.definition?.data?.diet_type_id) {
        currentDietTypeObj = dietTypesList.find(d => d.id === patientOverride.definition.data.diet_type_id)
    }

    // 1. Try program template FIRST (Dynamic priority like Patient Plan)
    if (!currentDietTypeObj && patientProgram?.program_template_weeks && activeWeek) {
        const rule = patientProgram.program_template_weeks.find((pw: any) =>
            activeWeek.week_number >= pw.week_start && activeWeek.week_number <= pw.week_end
        )
        if (rule?.diet_type_id) {
            currentDietTypeObj = dietTypesList.find(d => d.id === rule.diet_type_id)
        }
    }

    // 2. Try explicit assignment on the week if no program rule overrides it
    if (!currentDietTypeObj && activeWeek?.assigned_diet_type_id) {
        currentDietTypeObj = dietTypesList.find(d => d.id === activeWeek.assigned_diet_type_id)
    }

    // AUTO-OVERRIDE: If the week is assigned to a Global type, but a Patient-Specific override exists, USE THE OVERRIDE.
    // This ensures that even if the week points to the parent ID in the DB, the valid customization is used.
    if (currentDietTypeObj && !currentDietTypeObj.patient_id) {
        const specificOverride = dietTypesList.find(d => d.patient_id === patient.id && d.parent_diet_type_id === currentDietTypeObj.id)
        if (specificOverride) {
            currentDietTypeObj = specificOverride
        }
    }

    const displayDietType = currentDietTypeObj?.name || 'Genel'

    // Calculations
    const bmi = calculateBMI(currentWeight, patient.height)
    const age = calculateAge(patient.birth_date)


    const targets = calculateDailyTargets(currentWeight, currentActivity, currentDietTypeObj, patient?.patient_goals)

    const activeDietRules = {
        allowedTags: currentDietTypeObj?.allowed_tags || [],
        bannedKeywords: currentDietTypeObj?.banned_keywords || [],
        bannedTags: currentDietTypeObj?.banned_tags || [],
        bannedDetails: currentDietTypeObj?.banned_details || {},
        dietName: currentDietTypeObj?.name || 'Genel',
        programRestrictions: patientProgram?.program_template_restrictions || []
    }

    const sidebarReferenceDate = activeWeek?.start_date ? new Date(activeWeek.start_date) : new Date()

    // Portal component to render patient actions into sidebar slot
    const SidebarActionsPortal = () => {
        const { isSidebarCollapsed } = useSidebar()
        const [mounted, setMounted] = useState(false)
        useEffect(() => { setMounted(true) }, [])

        if (!mounted) return null
        const slot = document.getElementById('sidebar-actions-slot')
        const nameSlot = document.getElementById('sidebar-patient-name-slot')
        const mobileSlot = document.getElementById('mobile-sidebar-actions-slot')
        const mobileNameSlot = document.getElementById('mobile-sidebar-patient-name-slot')

        let namePortal = null
        if (!isSidebarCollapsed && nameSlot && patient?.full_name) {
            namePortal = createPortal(
                <div className="flex flex-col gap-3">
                    <span className="text-[13px] font-extrabold bg-gradient-to-br from-slate-700 to-slate-900 bg-clip-text text-transparent uppercase tracking-wider px-1">{patient.full_name}</span>
                    
                    {(patient.weight && patient.height) && (
                        <div className="flex flex-col gap-2 text-xs">
                            <div className="flex items-center justify-between px-3 py-2 bg-blue-50/50 text-blue-800 rounded-xl border border-blue-100/50 w-full shadow-sm">
                                <div className="flex flex-col items-center">
                                    <span className="text-[9px] uppercase tracking-widest text-blue-500 font-bold mb-0.5">Kilo</span>
                                    <span className="font-bold text-sm tracking-tight">{currentWeight} <span className="text-[10px] font-medium text-blue-600/70">kg</span></span>
                                </div>
                                <div className="w-px h-6 bg-blue-200/50"></div>
                                <div className="flex flex-col items-center">
                                    <span className="text-[9px] uppercase tracking-widest text-blue-500 font-bold mb-0.5">Boy</span>
                                    <span className="font-bold text-sm tracking-tight">{patient.height} <span className="text-[10px] font-medium text-blue-600/70">cm</span></span>
                                </div>
                                {bmi && (
                                    <>
                                        <div className="w-px h-6 bg-blue-200/50"></div>
                                        <div className={`flex flex-col items-center px-2 py-0.5 rounded-lg ${
                                            bmi.value > 25 ? 'bg-orange-100 text-orange-800' :
                                            bmi.value < 18.5 ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-green-100 text-green-800'
                                        }`}>
                                            <span className="text-[9px] uppercase tracking-widest font-bold mb-0.5">VKİ</span>
                                            <span className="font-bold text-sm tracking-tight">{bmi.value}</span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {targets && (
                                <div className={`flex flex-col gap-2 px-3 py-2 rounded-xl border shadow-sm w-full ${getDietTheme(displayDietType).bg} ${getDietTheme(displayDietType).border} ${getDietTheme(displayDietType).text}`}>
                                    <span className="text-[10px] uppercase tracking-widest font-extrabold opacity-90">{displayDietType}</span>
                                    <div className="flex flex-col gap-1 text-[10px] bg-white/40 p-2 rounded-lg border border-black/5">
                                        <div className="grid grid-cols-5 gap-1 items-center pb-1 border-b border-black/5 opacity-80 uppercase tracking-tighter font-bold">
                                            <span className="text-[7px] text-gray-400">Birim</span>
                                            <span className="text-center">Kcal</span>
                                            <span className="text-center text-orange-500">Krb</span>
                                            <span className="text-center text-blue-500">Pro</span>
                                            <span className="text-center text-yellow-600">Yağ</span>
                                        </div>
                                        <div className="grid grid-cols-5 gap-1 items-center font-bold text-gray-700">
                                            <span className="text-[8px] text-gray-500 uppercase">Hedef</span>
                                            <span className="text-center">{Math.round(targets.calories)}</span>
                                            <span className="text-center text-orange-600/80">{Math.round(targets.carb)}</span>
                                            <span className="text-center text-blue-600/80">{Math.round(targets.protein)}</span>
                                            <span className="text-center text-yellow-600/80">{Math.round(targets.fat)}</span>
                                        </div>
                                        <div className="grid grid-cols-5 gap-1 items-center font-bold">
                                            <span className="text-[8px] text-gray-500 uppercase">Gerçek</span>
                                            <span className={`text-center ${(() => {
                                                const typeKey = 'calories';
                                                const target = targets[typeKey];
                                                const actual = weeklyAvgStats?.cal || 0;
                                                const minTol = macroTolerances?.[typeKey]?.min ?? 90;
                                                const maxTol = macroTolerances?.[typeKey]?.max ?? 110;
                                                if (actual > target * (maxTol / 100)) return 'text-red-500';
                                                if (actual < target * (minTol / 100)) return 'text-orange-500';
                                                return 'text-green-600';
                                            })()}`}>{Math.round(weeklyAvgStats?.cal || 0)}</span>
                                            <span className={`text-center ${(() => {
                                                const typeKey = 'carb';
                                                const target = targets[typeKey];
                                                const actual = weeklyAvgStats?.carb || 0;
                                                const minTol = macroTolerances?.[typeKey]?.min ?? 80;
                                                const maxTol = macroTolerances?.[typeKey]?.max ?? 120;
                                                if (actual > target * (maxTol / 100)) return 'text-red-500';
                                                if (actual < target * (minTol / 100)) return 'text-orange-500';
                                                return 'text-green-600';
                                            })()}`}>{Math.round(weeklyAvgStats?.carb || 0)}</span>
                                            <span className={`text-center ${(() => {
                                                const typeKey = 'protein';
                                                const target = targets[typeKey];
                                                const actual = weeklyAvgStats?.pro || 0;
                                                const minTol = macroTolerances?.[typeKey]?.min ?? 80;
                                                const maxTol = macroTolerances?.[typeKey]?.max ?? 120;
                                                if (actual > target * (maxTol / 100)) return 'text-red-500';
                                                if (actual < target * (minTol / 100)) return 'text-orange-500';
                                                return 'text-green-600';
                                            })()}`}>{Math.round(weeklyAvgStats?.pro || 0)}</span>
                                            <span className={`text-center ${(() => {
                                                const typeKey = 'fat';
                                                const target = targets[typeKey];
                                                const actual = weeklyAvgStats?.fat || 0;
                                                const minTol = macroTolerances?.[typeKey]?.min ?? 80;
                                                const maxTol = macroTolerances?.[typeKey]?.max ?? 120;
                                                if (actual > target * (maxTol / 100)) return 'text-red-500';
                                                if (actual < target * (minTol / 100)) return 'text-orange-500';
                                                return 'text-green-600';
                                            })()}`}>{Math.round(weeklyAvgStats?.fat || 0)}</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>,
                nameSlot
            )
        }

        if (!slot) return namePortal

        const topItems = [
            { icon: Search, label: 'Yemek Ara', onClick: () => setIsFoodSidebarVisible(!isFoodSidebarVisible), active: isFoodSidebarVisible, color: 'blue' },
            { icon: LayoutGrid, label: 'Haftalık Plan', onClick: () => setActiveMainTab('diet'), active: activeMainTab === 'diet', color: 'blue' },
            { icon: Sparkles, label: isGeneratingPlan ? 'Oluşturuluyor...' : 'Otomatik Plan', onClick: () => handleAutoGenerate(), disabled: isGeneratingPlan || !activeWeekId, color: 'green' },
            { icon: Sparkles, label: 'AI Analiz', onClick: () => setAiAnalysisSheetOpen(true), color: 'purple' },
            { icon: RotateCcw, label: 'Geri Al', onClick: handleUndo, color: 'blue' },
            { icon: Eraser, label: 'Sıfırla', onClick: handleReset, color: 'red' },
            { icon: Calendar, label: 'PDF İndir', onClick: () => {}, color: 'blue' },
            { icon: ClipboardList, label: 'Vücut Ölçümleri', onClick: () => setActiveMainTab('measurements'), active: activeMainTab === 'measurements', color: 'blue' },
            { icon: StickyNote, label: 'Notlar', onClick: () => setNotesSheetOpen(true), color: 'amber' },
        ]

        const settingsItems = [
            { icon: Settings, label: 'Öğün Ayarları', onClick: () => setMealTypesDialogOpen(true), color: 'slate' },
            { icon: Activity, label: 'Diyet Türleri', onClick: () => setDietTypesDialogOpen(true), color: 'slate' },
            { icon: Sliders, label: 'Program Kuralları', onClick: () => setPatientRulesDialogOpen(true), color: 'purple' },
            { icon: Save, label: 'Şablon İşlemleri', onClick: () => setTemplateDialogOpen(true), color: 'slate' },
            { icon: RefreshCw, label: 'Geçmiş Planlar', onClick: () => setArchivedPlansDialogOpen(true), color: 'slate' },
            { icon: BookOpenText, label: 'Rehber', onClick: () => setIsLegendOpen(true), color: 'slate' },
        ]

        const toolsItems = [
            ...(activeMainTab === 'diet' ? [
                { icon: viewMode === 'grid' ? List : LayoutGrid, label: 'Görünüm', onClick: () => setViewMode(viewMode === 'grid' ? 'list' : 'grid'), active: false, color: 'slate' },
            ] : []),
            { icon: Grid3X3, label: 'Excel İçe Aktar', onClick: () => { setAutoStartGoogleSheets(false); setImportDialogOpen(true); }, color: 'green' },
            { icon: FileText, label: 'Drive İçe Aktar', onClick: () => { setAutoStartGoogleSheets(true); setImportDialogOpen(true); }, color: 'blue' },
            { icon: Sparkles, label: showMealBadges ? 'Rozetleri Gizle' : 'Rozetleri Göster', onClick: handleToggleMealBadges, color: showMealBadges ? 'blue' : 'slate' },
            { icon: patient.status === 'archived' ? RefreshCw : Archive, label: patient.status === 'archived' ? 'Hastayı Aktifleştir' : 'Hastayı Arşivle', onClick: handleToggleArchive, color: patient.status === 'archived' ? 'green' : 'slate' },
            { icon: RefreshCw, label: 'Hafta Döngüsü', onClick: () => setWeekLoopDialogOpen(true), color: 'slate' },
        ]

        const renderItem = (item: any, idx: number) => {
            const colorMap: Record<string, any> = {
                blue: { active: 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-500/20', hover: 'hover:bg-blue-50 hover:text-blue-700', icon: 'text-blue-500 group-hover:text-blue-600' },
                slate: { active: 'bg-slate-600 text-white border-slate-500', hover: 'hover:bg-slate-50 hover:text-slate-700', icon: 'text-slate-400 group-hover:text-slate-600' },
                purple: { active: 'bg-purple-600 text-white border-purple-500', hover: 'hover:bg-purple-50 hover:text-purple-700', icon: 'text-purple-500 group-hover:text-purple-600' },
                amber: { active: 'bg-amber-600 text-white border-amber-500', hover: 'hover:bg-amber-50 hover:text-amber-700', icon: 'text-amber-500 group-hover:text-amber-600' },
                green: { active: 'bg-green-600 text-white border-green-500', hover: 'hover:bg-green-50 hover:text-green-700', icon: 'text-green-500 group-hover:text-green-600' },
                red: { active: 'bg-red-600 text-white border-red-500', hover: 'hover:bg-red-50 hover:text-red-700', icon: 'text-red-400 group-hover:text-red-600' },
            }
            const colors = colorMap[item.color] || colorMap.slate
            const isActive = item.active || false

            return (
                <div key={item.label} className="relative group">
                    <button
                        onClick={item.onClick}
                        disabled={item.disabled}
                        title={isSidebarCollapsed ? item.label : undefined}
                        className={`flex items-center transition-all duration-200 cursor-pointer font-medium border
                            ${isSidebarCollapsed ? 'w-9 h-9 mx-auto justify-center rounded-lg px-0 py-0' : 'w-[calc(100%-16px)] text-[13px] py-1.5 px-3 mx-2 rounded-lg gap-2'}
                            ${isActive ? colors.active : `bg-white/10 border-transparent text-slate-600 ${colors.hover}`}
                            ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                    >
                        <item.icon size={18} className={`shrink-0 transition-all duration-200 ${isActive ? 'text-white' : colors.icon}`} />
                        {!isSidebarCollapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
                    </button>
                </div>
            )
        }

        const actionsPortal = createPortal(
            <div className="space-y-1 pb-4">
                {topItems.map(renderItem)}

                {!isSidebarCollapsed && (
                    <div className="px-6 mt-6 mb-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">AYARLAR</span>
                    </div>
                )}

                {settingsItems.map(renderItem)}

                {!isSidebarCollapsed && (
                    <div className="px-6 mt-6 mb-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ARAÇLAR & GÖRÜNÜM</span>
                    </div>
                )}

                {toolsItems.map(renderItem)}

                {!isSidebarCollapsed && (
                    <div className="px-3 pt-1">
                        <SnapshotsDialog weekId={activeWeekId} onRestore={fetchPatientData} />
                    </div>
                )}

                {(!isSidebarCollapsed && duplicateWeekIds.length > 0) && (
                    <div className="px-3 pt-2">
                        <Button
                            variant="destructive"
                            size="sm"
                            className="w-full h-9 flex items-center justify-center gap-2 animate-pulse rounded-xl"
                            onClick={handleCleanDuplicates}
                            title={`${duplicateWeekIds.length} yinelenen hafta tespit edildi`}
                        >
                            <Trash2 size={16} /> Temizle ({duplicateWeekIds.length})
                        </Button>
                    </div>
                )}
            </div>,
            slot
        )

        return (
            <>
                {namePortal}
                {actionsPortal}
            </>
        )
    }







    return (
        <>
            <Dialog open={blockedFoodDialog.open} onOpenChange={(open) => setBlockedFoodDialog(prev => ({ ...prev, open }))}>
                <DialogContent className="max-w-md bg-white p-0 border-0 shadow-2xl rounded-2xl overflow-hidden">
                    <div className="bg-red-50 p-6 text-center border-b border-red-100 flex flex-col items-center">
                        <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mb-4 shadow-sm">
                            <AlertTriangle className="text-red-600 w-8 h-8" />
                        </div>
                        <DialogTitle className="text-xl font-black text-red-700 uppercase tracking-wider">
                            Bu Yemek Engellendi!
                        </DialogTitle>
                    </div>
                    <div className="p-6">
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
                            <p className="text-[14px] text-gray-700 font-medium leading-relaxed">
                                {blockedFoodDialog.reason}
                            </p>
                        </div>
                    </div>
                    <div className="px-6 pb-6 flex gap-3">
                        <Button
                            variant="outline"
                            className="flex-1 h-12 rounded-xl text-gray-700 hover:bg-gray-50 border-gray-300 transition-colors"
                            onClick={() => setBlockedFoodDialog({ open: false, food: null, dropData: null, reason: null })}
                        >
                            <X className="w-4 h-4 mr-2 opacity-70" />
                            İptal
                        </Button>
                        <Button
                            variant="destructive"
                            className="flex-1 h-12 rounded-xl shadow-md hover:shadow-lg transition-all"
                            onClick={async () => {
                                await insertMealToDB(blockedFoodDialog.food, blockedFoodDialog.dropData);
                                setBlockedFoodDialog({ open: false, food: null, dropData: null, reason: null });
                            }}
                        >
                            <Check className="w-5 h-5 mr-2 opacity-90" />
                            Yine de Ekle
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <SidebarActionsPortal />
            <div className="flex h-full overflow-hidden" onMouseMove={handleResizeMove} onMouseUp={handleResizeUp}>
                {/* Resizable Sidebar - Only show for non-patients */}
                {/* Resizable Sidebar - Only show for non-patients */}
                {!isPatient && isFoodSidebarVisible && (
                    <>
                        <div
                            className="hidden md:flex border-r bg-white flex-col shadow-sm z-20 shrink-0 relative group"
                            style={{ width: sidebarWidth }}
                        >
                            <FoodSidebar
                                dislikedFoods={(() => {
                                    if (Array.isArray(patient?.disliked_foods)) return patient.disliked_foods;
                                    const df = patient?.disliked_foods as string | undefined;
                                    return df?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
                                })()}
                                likedFoods={(() => {
                                    if (Array.isArray(patient?.liked_foods)) return patient.liked_foods;
                                    const lf = patient?.liked_foods as string | undefined;
                                    return lf?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
                                })()}
                                activeDietRules={activeDietRules}
                                referenceDate={activeWeek?.start_date ? new Date(activeWeek.start_date) : undefined}
                                patientName={patient?.full_name}
                                onEditProfile={() => setProfileDialogOpen(true)}
                                mealCounts={mealCounts}
                                defaultSort={sidebarSortPreference}
                                onSortChange={handleSidebarSortChange}
                                customFoods={customFoods}
                                patientDiseases={patientDiseases}
                                patientLabs={patientLabs}
                                patientMedicationRules={patientMedicationRules}
                                foodMicronutrients={foodMicronutrients}
                                onSave={async (data) => { }}
                                patientId={id}
                                
                            />

                            {/* Resize Handle */}
                            <div
                                className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-400/50 active:bg-blue-600 z-50 transition-colors"
                                onMouseDown={handleResizeDown}
                            />
                        </div>

                        {/* Mobile Sidebar Trigger (Tab) */}
                        <div className="md:hidden fixed left-0 top-32 z-50">
                            <Sheet>
                                <SheetTrigger asChild>
                                    <Button className="h-24 w-8 rounded-r-lg rounded-l-none p-0 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white shadow-lg border-y border-r border-white/20 transition-transform hover:translate-x-1">
                                        <span className="transform -rotate-90 whitespace-nowrap text-xs font-bold tracking-widest">YEMEK ARA</span>
                                    </Button>
                                </SheetTrigger>
                                <SheetContent side="left" className="p-0 w-[90vw] sm:w-[400px]">
                                    <SheetHeader className="sr-only">
                                        <SheetTitle>Yemek Seçimi</SheetTitle>
                                    </SheetHeader>
                                    <FoodSidebar
                                        dislikedFoods={(() => {
                                            if (Array.isArray(patient?.disliked_foods)) return patient.disliked_foods;
                                            const df = patient?.disliked_foods as string | undefined;
                                            return df?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
                                        })()}
                                        likedFoods={(() => {
                                            if (Array.isArray(patient?.liked_foods)) return patient.liked_foods;
                                            const lf = patient?.liked_foods as string | undefined;
                                            return lf?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
                                        })()}
                                        activeDietRules={activeDietRules}
                                        referenceDate={activeWeek?.start_date ? new Date(activeWeek.start_date) : undefined}
                                        patientName={patient?.full_name}
                                        onEditProfile={() => setProfileDialogOpen(true)}
                                        mealCounts={mealCounts}
                                        defaultSort={sidebarSortPreference}
                                        onSortChange={handleSidebarSortChange}
                                        customFoods={customFoods}
                                        patientDiseases={patientDiseases}
                                        patientLabs={patientLabs}
                                        patientMedicationRules={patientMedicationRules}
                                        foodMicronutrients={foodMicronutrients}
                                        onSave={async (data) => { }}
                                        patientId={id}
                                    />
                                </SheetContent>
                            </Sheet>
                        </div>
                    </>
                )}

                <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="flex-1 flex flex-col min-w-0 bg-gray-50">
                    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        
                        {/* Compact Header for Collapsed Sidebar */}
                        {isSidebarCollapsed && (
                            <div className="flex items-center gap-4 px-6 py-2.5 bg-white border-b border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.02)] z-10 shrink-0 overflow-x-auto no-scrollbar">
                                <span className="text-sm font-extrabold bg-gradient-to-br from-slate-700 to-slate-900 bg-clip-text text-transparent uppercase tracking-wider shrink-0">{patient?.full_name}</span>
                                
                                {displayDietType && (
                                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold shrink-0 border ${getDietTheme(displayDietType).bg} ${getDietTheme(displayDietType).text} ${getDietTheme(displayDietType).border}`}>
                                        {displayDietType}
                                    </span>
                                )}

                                {(patient?.weight && patient?.height) && (
                                    <div className="flex items-center gap-3 px-3 py-1 bg-blue-50/50 border border-blue-100/50 rounded-lg shrink-0">
                                        <div className="flex items-center gap-1"><span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Kilo</span><span className="text-xs font-bold text-blue-800 tracking-tight">{currentWeight} <span className="text-[9px] font-normal opacity-70">kg</span></span></div>
                                        <div className="w-px h-3 bg-blue-200/60"></div>
                                        <div className="flex items-center gap-1"><span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Boy</span><span className="text-xs font-bold text-blue-800 tracking-tight">{patient.height} <span className="text-[9px] font-normal opacity-70">cm</span></span></div>
                                        {bmi && (
                                            <>
                                                <div className="w-px h-3 bg-blue-200/60"></div>
                                                <div className="flex items-center gap-1"><span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">VKİ</span><span className={`text-xs font-bold tracking-tight ${bmi.value > 25 ? 'text-orange-600' : bmi.value < 18.5 ? 'text-yellow-600' : 'text-green-600'}`}>{bmi.value}</span></div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {targets && (
                                    <div className="flex items-center gap-3 px-3 py-1 bg-slate-50 border border-slate-200/50 rounded-lg text-[10px] font-bold shrink-0 ml-auto shadow-sm">
                                        <span className="text-[9px] text-slate-400 uppercase tracking-widest mr-1 font-extrabold">HEDEF</span>
                                        <div className="flex items-center gap-1"><span className="text-slate-400">KCAL</span><span className="text-slate-700 tracking-tight">{Math.round(targets.calories)}</span></div>
                                        <div className="w-px h-3 bg-slate-200"></div>
                                        <div className="flex items-center gap-1"><span className="text-orange-400">KRB</span><span className="text-orange-600 tracking-tight">{Math.round(targets.carb)} g</span></div>
                                        <div className="w-px h-3 bg-slate-200"></div>
                                        <div className="flex items-center gap-1"><span className="text-blue-400">PRO</span><span className="text-blue-600 tracking-tight">{Math.round(targets.protein)} g</span></div>
                                        <div className="w-px h-3 bg-slate-200"></div>
                                        <div className="flex items-center gap-1"><span className="text-yellow-500">YAĞ</span><span className="text-yellow-600 tracking-tight">{Math.round(targets.fat)} g</span></div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex-1 overflow-hidden flex flex-col bg-white border-b">
                            <div className="flex-1 flex flex-col min-h-0">

                                <TabsContent value="diet" className="flex-1 flex flex-col min-h-0 mt-0 data-[state=active]:flex">

                                    <Tabs value={activeWeekId || ''} onValueChange={setActiveWeekId} className="flex-1 flex flex-col min-h-0">
                                        <div className="flex items-center gap-2 mb-4 shrink-0 w-full pb-1">
                                            <div className="flex-1 overflow-x-auto no-scrollbar">
                                                <TabsList className="inline-flex items-center justify-start gap-1 bg-slate-100/50 border border-slate-200/60 p-1 h-auto min-w-0 no-scrollbar custom-tabs-list flex-nowrap w-max rounded-xl">
                                                    {visibleWeeks.map((week) => {
                                                        const dt = dietTypesList.find(d => d.id === week.assigned_diet_type_id)
                                                        const abbrev = dt?.abbreviation || 'G'
                                                        const isActive = activeWeekId === week.id

                                                        const weekStart = week.start_date ? new Date(week.start_date) : null;
                                                        const weekEnd = week.end_date ? new Date(week.end_date) : null;
                                                        if (weekStart) weekStart.setHours(0,0,0,0);
                                                        if (weekEnd) weekEnd.setHours(23,59,59,999);
                                                        const now = new Date();
                                                        const isCurrentWeek = weekStart && weekEnd && (now >= weekStart && now <= weekEnd);

                                                        return (
                                                            <TabsTrigger
                                                                key={week.id}
                                                                value={week.id}
                                                                className={`
                                                                relative group flex flex-col items-start justify-center py-1.5 px-3 rounded-lg border transition-all duration-200 min-w-[90px] max-w-[160px]
                                                                ${isActive ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] border-slate-200/70' : 'border-transparent hover:bg-slate-200/50'}
                                                            `}
                                                                onDoubleClick={() => openWeekEditor(week)}
                                                            >
                                                                <div className="flex items-center justify-between w-full mb-0.5 gap-2">
                                                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                                                        <span className={`font-bold text-[11px] tracking-tight whitespace-nowrap truncate ${isActive ? 'text-blue-700' : 'text-slate-600 group-hover:text-slate-800'}`}>{week.title}</span>
                                                                        {isCurrentWeek && (
                                                                            <span className="flex h-1.5 w-1.5 relative shrink-0" title="Geçerli Hafta">
                                                                                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isActive ? 'bg-blue-400' : 'bg-slate-400'}`}></span>
                                                                                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${isActive ? 'bg-blue-500' : 'bg-slate-400'}`}></span>
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    
                                                                    {isActive && abbrev !== 'G' && (
                                                                        <span className="text-[8px] font-mono px-1 rounded bg-blue-50 text-blue-600/70 shrink-0">
                                                                            {abbrev}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {week.start_date && week.end_date && (
                                                                    <span className={`text-[9px] font-medium whitespace-nowrap ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
                                                                        {formatShortDate(new Date(week.start_date))} - {formatShortDate(new Date(week.end_date))}
                                                                    </span>
                                                                )}

                                                                <div
                                                                    className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white shadow-md border rounded-full p-0.5 cursor-pointer hover:bg-gray-100 text-gray-500 z-10"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        e.preventDefault()
                                                                    }}
                                                                >
                                                                    <DropdownMenu>
                                                                        <DropdownMenuTrigger asChild>
                                                                            <div className="h-4 w-4 flex items-center justify-center rounded-full hover:bg-gray-200">
                                                                                <MoreHorizontal size={12} />
                                                                            </div>
                                                                        </DropdownMenuTrigger>
                                                                        <DropdownMenuContent align="start">
                                                                            <DropdownMenuItem onClick={(e) => {
                                                                                e.stopPropagation()
                                                                                openWeekEditor(week)
                                                                            }}>
                                                                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                                                                <span>Düzenle</span>
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem onClick={(e) => {
                                                                                e.stopPropagation()
                                                                                setWeekCopyDialogData({ open: true, week })
                                                                            }}>
                                                                                <Copy className="mr-2 h-3.5 w-3.5" />
                                                                                <span>Başka Hastaya Kopyala</span>
                                                                            </DropdownMenuItem>
                                                                        </DropdownMenuContent>
                                                                    </DropdownMenu>
                                                                </div>
                                                            </TabsTrigger>
                                                        )
                                                    })}
                                                </TabsList>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0 ml-2 pr-1 border-l pl-3">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    onClick={addNewWeek} 
                                                    title="Yeni Hafta Ekle" 
                                                    className="h-10 px-3 rounded-xl border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 transition-all flex items-center gap-2 shrink-0 shadow-sm"
                                                >
                                                    <Plus size={16} />
                                                    <span className="text-[10px] font-bold uppercase tracking-tight">Yeni Hafta</span>
                                                </Button>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    onClick={() => setWeekLoopDialogOpen(true)} 
                                                    title="Hafta Döngüsü" 
                                                    className="h-10 px-3 rounded-xl border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 transition-all flex items-center gap-2 shrink-0 shadow-sm"
                                                >
                                                    <RefreshCw size={14} />
                                                    <span className="text-[10px] font-bold uppercase tracking-tight">Döngü</span>
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-auto pb-20">
                                            {activeWeekId ? (
                                                <>
                                                    {viewMode === 'grid' ? (

                                                        <DietWeekGridView
                                                            weekId={activeWeekId}
                                                            refreshTrigger={refreshTrigger}
                                                            startDate={activeWeek?.start_date}
                                                            mealTypes={mealTypes}
                                                            onToggleLock={toggleMealLock}
                                                            onToggleNoteLock={toggleNoteLock}
                                                            dislikedFoods={patient.disliked_foods || []}
                                                            patientDiseases={patientDiseases}
                                                            activeDietRules={activeDietRules}
                                                            targets={targets}
                                                            formatDiff={formatDiff}
                                                            macroTolerances={macroTolerances}
                                                            mealCounts={showMealBadges ? mealCounts : undefined}
                                                            showIcons={showMealBadges}
                                                            allFoods={foods}
                                                            readOnly={isPatient}
                                                            patientId={patient?.id}
                                                            macroTargetMode={patient?.macro_target_mode}
                                                            manualMatches={manualMatches}
                                                            bans={bans}
                                                            cards={cards} // Pass cards array - useRecipeManager provides this now
                                                            onShowRecipe={handleShowRecipe}
                                                            patientLabs={patientLabs}
                                                            patientMedicationRules={patientMedicationRules}
                                                            scalableUnits={scalableUnits}
                                                            patientDietType={patient?.diet_type}
                                                        />
                                                    ) : (
                                                        <DietWeekListView
                                                            weekId={activeWeekId}
                                                            refreshTrigger={refreshTrigger}
                                                            startDate={activeWeek?.start_date}
                                                            mealTypes={mealTypes}
                                                            onToggleLock={toggleMealLock}
                                                            onToggleNoteLock={toggleNoteLock}
                                                            dislikedFoods={patient.disliked_foods || []}
                                                            patientDiseases={patientDiseases}
                                                            activeDietRules={activeDietRules}
                                                            targets={targets}
                                                            formatDiff={formatDiff}
                                                            macroTolerances={macroTolerances}
                                                            mealCounts={showMealBadges ? mealCounts : undefined}
                                                            showIcons={showMealBadges}
                                                            patientId={patient?.id}
                                                            macroTargetMode={patient?.macro_target_mode}
                                                            allFoods={foods || []}
                                                            manualMatches={manualMatches}
                                                            bans={bans}
                                                            cards={cards}
                                                            onShowRecipe={handleShowRecipe}
                                                            patientLabs={patientLabs}
                                                            patientMedicationRules={patientMedicationRules}
                                                            scalableUnits={scalableUnits}
                                                            patientDietType={patient?.diet_type}
                                                        />
                                                    )}
                                                </>
                                            ) : (
                                                <div className="flex items-center justify-center h-full text-muted-foreground">Hafta seçiniz.</div>
                                            )}
                                        </div>
                                    </Tabs>
                                </TabsContent>

                                <TabsContent value="measurements" className="flex-1 flex flex-col min-h-0 mt-0 data-[state=active]:flex">
                                    <PatientMeasurements patientId={patient.id} />
                                </TabsContent>


                            </div>
                        </div>
                    </div>
                </Tabs>
            </div>

            {/* Drag Overlay - shows the dragged item on top layer */}
            <DragOverlay dropAnimation={null}>
                {activeDragFood && (
                    <div className="bg-white border-2 border-blue-500 rounded-lg shadow-2xl p-3 w-64 opacity-95">
                        <div className="font-medium text-sm text-blue-700">{activeDragFood.name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                            {Math.round(activeDragFood.calories)} kcal
                        </div>
                    </div>
                )}
            </DragOverlay>

            {/* DEBUG BAR REMOVED */}

            {/* AI Analysis Overlay */}
            <Sheet open={aiAnalysisSheetOpen} onOpenChange={setAiAnalysisSheetOpen}>
                <SheetContent side="right" className="w-full sm:max-w-[700px] md:max-w-[900px] p-0 flex flex-col">
                    <SheetHeader className="px-6 py-4 border-b bg-gray-50 shrink-0">
                        <SheetTitle className="text-purple-700 flex items-center gap-2">
                            <Sparkles size={18} />
                            AI Analizi
                        </SheetTitle>
                    </SheetHeader>
                    <div className="flex-1 overflow-y-auto bg-gray-50/30 p-4">
                        {aiAnalysisSheetOpen && <PatientAnalysisPanel patientId={patient.id} weekId={activeWeekId} />}
                    </div>
                </SheetContent>
            </Sheet>

            {/* Week Edit Dialog */}
            <Dialog open={weekDialogOpen} onOpenChange={setWeekDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Hafta Ayarları</DialogTitle>
                    </DialogHeader>
                    {editingWeek && (
                        <WeekEditForm
                            week={editingWeek}
                            resolvedDietTypeId={currentDietTypeObj?.id || ''}
                            hasActiveProgram={!!patientProgram}
                            dietTypes={dietTypesList}
                            patientDefaults={{ weight: patient.weight || 0, activity: patient.activity_level || 3 }}
                            onSave={saveWeek}
                            onDelete={deleteWeek}
                            onCancel={() => { setWeekDialogOpen(false); setEditingWeek(null); }}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Meal Types Editor Dialog (Now using Unified SettingsDialog) */}
            <SettingsDialog
                open={mealTypesDialogOpen}
                onOpenChange={setMealTypesDialogOpen}
                patientId={patient?.id}
                programTemplateId={patientProgram?.id}
                activeWeekId={activeWeekId ?? undefined}
                defaultTab="slots"
                onSettingsChanged={() => {
                    fetchPatientData()
                    setRefreshTrigger(prev => prev + 1)
                }}
            />

            {/* Diet Types Editor Dialog */}
            <Dialog open={dietTypesDialogOpen} onOpenChange={setDietTypesDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
                    <DialogHeader>
                        <DialogTitle>Diyet Türleri Ayarları</DialogTitle>
                    </DialogHeader>
                    <DietTypesEditor
                        dietTypes={dietTypesList}
                        patientId={patient?.id}
                        onUpdate={() => {
                            fetchPatientData()
                            setRefreshTrigger(prev => prev + 1)
                        }}
                    />
                </DialogContent>
            </Dialog>

            {/* Patient Rules Dialog */}
            {patient && (
                <PatientRulesDialog
                    open={patientRulesDialogOpen}
                    onOpenChange={setPatientRulesDialogOpen}
                    patientId={patient.id}
                    programTemplateId={patient?.program_template_id}
                    onRulesChanged={() => {
                        fetchPatientData()
                        setRefreshTrigger(prev => prev + 1)
                    }}
                />
            )}

            {/* Import Dialog */}
            <WeekImportDialog
                isOpen={importDialogOpen}
                onClose={() => { setImportDialogOpen(false); setAutoStartGoogleSheets(false); }}
                checkSeasonality={checkSeasonality}
                onImport={handleImport}
                weekId={activeWeekId || ''}
                allFoods={foods || []}
                patientName={patient?.full_name}
                weekNumber={weeks.findIndex(w => w.id === activeWeekId) + 1}
                autoStart={autoStartGoogleSheets}
                onBulkImport={handleBulkImport}
            />

            {/* Legend Dialog */}
            <LegendDialog isOpen={isLegendOpen} onClose={() => setIsLegendOpen(false)} />


            {/* Week Copy Dialog */}
            {
                weekCopyDialogData && (
                    <WeekCopyDialog
                        open={weekCopyDialogData.open}
                        onOpenChange={(open) => !open && setWeekCopyDialogData(null)}
                        sourceWeek={weekCopyDialogData.week}
                        sourcePatientName={patient?.full_name || ''}
                        onSuccess={() => {
                            // refreshing wouldn't hurt, but mostly irrelevant for source patient UI
                            // actually we might want to refresh if we copied TO SELF? (not supported yet really)
                        }}
                    />
                )
            }

            {/* Week Loop Dialog */}
            <WeekLoopEditor
                open={weekLoopDialogOpen}
                onOpenChange={setWeekLoopDialogOpen}
                weeks={weeks}
                planId={dietPlanId || ''}
                patient={patient}
                patientProgram={patientProgram}
                dietTypesList={dietTypesList}
                onSuccess={() => {
                    fetchPatientData()
                    setRefreshTrigger(prev => prev + 1)
                }}
            />

            <CopiedWeekInitModal 
                open={copiedWeekInitModalOpen}
                onOpenChange={setCopiedWeekInitModalOpen}
                defaultWeight={patient?.weight || null}
                defaultActivity={patient?.activity_level || null}
                onSave={handleCopiedWeekInitSave}
            />

            {/* Meal Template Dialog */}
            <MealTemplateDialog
                open={templateDialogOpen}
                onOpenChange={setTemplateDialogOpen}
                currentMealTypes={mealTypes}
                onApply={(types) => { persistMealTypes(types); setTemplateDialogOpen(false); }}
            />

            {/* Auto Plan Dialog */}
            <AutoPlanDialog
                open={autoPlanOpen}
                onOpenChange={setAutoPlanOpen}
                mealTypes={mealTypes} // Pass configured order
                plan={generatedPlan}
                onConfirm={handleApplyAutoPlan}
                loading={isApplyingPlan}
                onRegenerate={handleAutoGenerate}
                patientId={patient.id}
                programTemplateId={patientProgram?.id || null}
                activeWeekId={activeWeekId ?? undefined}
                onMealTypesChanged={refreshMealTypesFromActiveWeek}
                userId={user?.id}
            />
            {
                patient && (
                    <PatientProfileDialog
                        open={profileDialogOpen}
                        onOpenChange={setProfileDialogOpen}
                        patientId={patient.id}
                        activeWeekId={activeWeekId}
                        onSuccess={fetchPatientData}
                    />
                )
            }

            {/* Lock Manager Dialog */}
            {
                lockDialogData && lockDialogData.meal && (
                    <LockManagerDialog
                        open={lockDialogData.open}
                        onOpenChange={(open) => {
                            if (!open) setLockDialogData(null)
                        }}
                        mode={lockDialogData.mode}
                        mealName={lockDialogData.meal.foods?.name || 'Yemek'}
                        onConfirm={handleLockConfirm}
                    />
                )
            }

            {/* Note Lock Manager Dialog */}
            {
                noteLockDialogData && noteLockDialogData.note && (
                    <LockManagerDialog
                        open={noteLockDialogData.open}
                        onOpenChange={(open) => {
                            if (!open) setNoteLockDialogData(null)
                        }}
                        mode={noteLockDialogData.mode}
                        mealName="Not"
                        onConfirm={handleNoteLockConfirm}
                    />
                )
            }

            <ArchivedPlansDialog
                open={archivedPlansDialogOpen}
                onOpenChange={setArchivedPlansDialogOpen}
                patientId={patient.id}
                onPlanRestored={() => {
                    fetchPatientData()
                    setRefreshTrigger(prev => prev + 1)
                }}
            />

            <RecipeCardDialog
                isOpen={recipeDialogOpen}
                onClose={() => setRecipeDialogOpen(false)}
                cardUrl={selectedRecipe?.url || ''}
                cardName={selectedRecipe?.name || ''}
            />

            {
                patient && (
                    <PatientNotesSheet
                        open={notesSheetOpen}
                        onOpenChange={setNotesSheetOpen}
                        patientId={patient.id}
                        patientName={patient.full_name}
                    />
                )
            }
        </DndContext>
        </>
    )
}

// ================== WEEK EDIT FORM ==================
// ================== WEEK EDIT FORM ==================
function WeekEditForm({ week, resolvedDietTypeId, hasActiveProgram, dietTypes, patientDefaults, onSave, onDelete, onCancel }: {
    week: DietWeek,
    resolvedDietTypeId?: string,
    hasActiveProgram?: boolean,
    dietTypes: any[],
    patientDefaults: { weight: number, activity: number },
    onSave: (id: string, title: string, startDate: string, endDate: string, weight: number, dietTypeId: string | null, activityLevel: number) => void,
    onDelete: (id: string) => void,
    onCancel: () => void
}) {
    const [title, setTitle] = useState(week.title || `${week.week_number}. Hafta`)
    const [startDate, setStartDate] = useState(week.start_date || '')
    const [endDate, setEndDate] = useState(week.end_date || '')
    const [weight, setWeight] = useState<number>(week.weight_log || patientDefaults.weight || 0)
    // First try the dynamically resolved type (which accounts for program rules), then explicit assignment
    const [dietTypeId, setDietTypeId] = useState<string>(resolvedDietTypeId || week.assigned_diet_type_id || '')
    const [activityLevel, setActivityLevel] = useState<number>(week.activity_level_log || patientDefaults.activity || 3)
    const [confirmDelete, setConfirmDelete] = useState(false)

    useEffect(() => {
        if (confirmDelete) {
            const timer = setTimeout(() => setConfirmDelete(false), 3000)
            return () => clearTimeout(timer)
        }
    }, [confirmDelete])

    // Calculate day count
    const dayCount = startDate && endDate
        ? Math.max(1, Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1)
        : 7

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Hafta Adı</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Kilo (kg)</Label>
                    <Input
                        type="number"
                        step="0.1"
                        value={weight || ''}
                        onChange={e => setWeight(parseFloat(e.target.value) || 0)}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Diyet Türü</Label>
                    <Select value={dietTypeId} onValueChange={setDietTypeId} disabled={hasActiveProgram}>
                        <SelectTrigger>
                            <SelectValue placeholder="Seçiniz" />
                        </SelectTrigger>
                        <SelectContent>
                            {dietTypes.map(dt => (
                                <SelectItem key={dt.id} value={dt.id}>{dt.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {hasActiveProgram && (
                        <div className="text-[10px] text-blue-600 bg-blue-50 p-1.5 rounded border border-blue-100 leading-tight">
                            Hastanın aktif programı var. Özel bir diyet (İstisna) atamak için sağ üstteki Menüden <b>Program Kuralları</b> bölümünü kullanın.
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Aktivite Düzeyi</Label>
                    <Select value={String(activityLevel)} onValueChange={(val) => setActivityLevel(parseInt(val))}>
                        <SelectTrigger>
                            <SelectValue placeholder="Seçiniz" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="1">1 - Hareketsiz</SelectItem>
                            <SelectItem value="2">2 - Az Hareketli</SelectItem>
                            <SelectItem value="3">3 - Orta Hareketli</SelectItem>
                            <SelectItem value="4">4 - Çok Hareketli</SelectItem>
                            <SelectItem value="5">5 - Sporcu</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {/* Empty slot or other input */}
                <div></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Başlangıç Tarihi</Label>
                    <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>Bitiş Tarihi</Label>
                    <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
            </div>
            <p className="text-sm text-gray-500">
                Bu hafta <strong>{dayCount}</strong> gün içerecek.
                {dayCount > 7 && <span className="text-orange-500 ml-1">(Standard 7 günden fazla)</span>}
            </p>
            <DialogFooter className="flex justify-between sm:justify-between">
                <Button
                    variant="destructive"
                    onClick={() => {
                        if (confirmDelete) {
                            onDelete(week.id)
                        } else {
                            setConfirmDelete(true)
                        }
                    }}
                >
                    {confirmDelete ? (
                        "Emin misiniz?"
                    ) : (
                        <><Trash2 size={16} className="mr-2" /> Sil</>
                    )}
                </Button>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onCancel}>İptal</Button>
                    <Button onClick={() => onSave(week.id, title, startDate, endDate, weight, dietTypeId || null, activityLevel)}>Kaydet</Button>
                </div>
            </DialogFooter>
        </div>
    )
}

// Redundant MealTypesEditor removed. Using SettingsDialog instead.

// ================== HELPER COMPONENTS ==================
function MealReorderButtons({ meal, meals, onUpdate, size = 12, vertical = false }: {
    meal: any,
    meals: any[],
    onUpdate: () => void,
    size?: number,
    vertical?: boolean
}) {
    // Sort meals to find index
    const sortedMeals = [...meals].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    const index = sortedMeals.findIndex(m => m.id === meal.id)
    const isFirst = index === 0
    const isLast = index === sortedMeals.length - 1

    async function move(direction: 'up' | 'down') {
        const targetIndex = direction === 'up' ? index - 1 : index + 1
        if (targetIndex < 0 || targetIndex >= sortedMeals.length) return

        const targetMeal = sortedMeals[targetIndex]
        const currentOrder = meal.sort_order || 0
        const targetOrder = targetMeal.sort_order || 0

        // Swap orders
        await supabase.from('diet_meals').update({ sort_order: targetOrder }).eq('id', meal.id)
        await supabase.from('diet_meals').update({ sort_order: currentOrder }).eq('id', targetMeal.id)
        onUpdate()
    }

    if (meals.length <= 1) return null

    return (
        <div className={`flex ${vertical ? 'flex-col' : ''} gap-0.5`}>
            {!isFirst && (
                <button
                    className="p-0.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded"
                    onClick={(e) => { e.stopPropagation(); move('up') }}
                    title="Yukarı Taşı"
                >
                    <ChevronUp size={size} />
                </button>
            )}
            {!isLast && (
                <button
                    className="p-0.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded"
                    onClick={(e) => { e.stopPropagation(); move('down') }}
                    title="Aşağı Taşı"
                >
                    <ChevronDown size={size} />
                </button>
            )}
        </div>
    )
}

// ================== GRID VIEW MEAL SLOT (DROPPABLE) ==================
function DroppableMealSlot({ dayId, dayDate, mealType, meals, onUpdate, onToggleLock, dislikedFoods = [], activeDietRules, mealCounts, nearbyUsedFoodIds = [], allFoods = [], targets, formatDiff, dayTotals, readOnly = false, patientId, manualMatches, bans, cards, onShowRecipe, patientDiseases = [], patientLabs = [], patientMedicationRules = [], scalableUnits = [], days = [], patientDietType, showIcons = true }: {
    dayId: string,
    dayDate?: Date,
    mealType: string,
    meals: any[],
    onUpdate: () => void,
    onToggleLock: (mealId: string, currentStatus: boolean) => Promise<void>,
    dislikedFoods?: string[],
    activeDietRules?: DietRules,
    mealCounts?: Map<string, number>,
    nearbyUsedFoodIds?: string[],
    allFoods?: any[],
    targets?: any,
    formatDiff?: any,
    dayTotals?: any,
    readOnly?: boolean,
    patientId?: string,
    manualMatches?: any[],
    bans?: any[],
    cards?: any[],
    onShowRecipe?: (url: string, name: string) => void,
    patientDiseases?: any[],
    patientLabs?: any[],
    patientMedicationRules?: any[],
    scalableUnits?: string[],
    days?: any[],
    patientDietType?: string | null,
    showIcons?: boolean
}) {
    const { user, profile } = useAuth()

    async function resolveFoodTeamOwnerId(): Promise<string | null> {
        if (!user?.id) return null
        const scope = await resolveTeamScopeContextForUser(user.id, {
            role: profile?.role || null,
            is_global_access: (profile as any)?.is_global_access === true
        })
        return scope.teamOwnerId
    }

    async function saveFoodByScope(
        foodId: string,
        updates: Record<string, any>,
        teamOwnerIdOverride?: string | null
    ) {
        const teamOwnerId = teamOwnerIdOverride ?? await resolveFoodTeamOwnerId()

        if (teamOwnerId && user?.id) {
            const { error } = await upsertTeamFoodOverride({
                teamOwnerId,
                baseFoodId: foodId,
                createdBy: user.id,
                updates
            })
            if (error) throw error

            const { data: baseFood, error: baseFoodError } = await supabase
                .from('foods')
                .select('*')
                .eq('id', foodId)
                .single()
            if (baseFoodError) throw baseFoodError

            const scopedFoods = await applyTeamFoodOverrides(baseFood ? [baseFood] : [], teamOwnerId)
            const effectiveFoods = await applyTeamFoodMicronutrientOverrides(scopedFoods, teamOwnerId)
            return effectiveFoods[0] || scopedFoods[0] || baseFood
        }

        const { data, error } = await supabase
            .from('foods')
            .update(updates)
            .eq('id', foodId)
            .select()
            .single()
        if (error) throw error
        return data
    }

    const hasLockedMeal = meals.some(m => m.is_locked)
    const { setNodeRef, isOver } = useDroppable({
        id: `slot-${dayId}-${mealType}`,
        data: { type: 'meal-slot', dayId, mealTime: mealType },
        disabled: readOnly || hasLockedMeal
    })

    const [editingMeal, setEditingMeal] = useState<any>(null)
    const [alternativeDialogData, setAlternativeDialogData] = useState<{ isOpen: boolean, meal: any | null }>({ isOpen: false, meal: null })
    const [smartSwapData, setSmartSwapData] = useState<{ isOpen: boolean, matchCount: number, slotName: string, newFood: any, oldFoodName: string, targetIds: string[], targetIdsToRevert?: string[] } | null>(null)
    const [highlightedMealId, setHighlightedMealId] = useState<string | null>(null)
    const [isSearchOpen, setIsSearchOpen] = useState(false)

    // Calculate original food for revert functionality
    const originalFoodToRevert = useMemo(() => {
        if (!alternativeDialogData.meal?.original_food_id || !allFoods) return null
        const original = allFoods.find(f => f.id === alternativeDialogData.meal!.original_food_id)
        if (original && original.id !== alternativeDialogData.meal.food_id) {
            return original
        }
        return null
    }, [alternativeDialogData.meal, allFoods])

    async function handleAlternativeSelect(newFood: any) {
        if (!alternativeDialogData.meal) return

        const actualOriginalId = alternativeDialogData.meal.original_food_id || alternativeDialogData.meal.food_id
        const isRevertToOriginal = newFood.id === actualOriginalId
        const currentMeal = alternativeDialogData.meal

        // 1. Detect if this food appears anywhere in the week (across ALL meal types)
        const targetFoodId = currentMeal.original_food_id || currentMeal.food_id

        let matchingMeals: any[] = []
        if (days && days.length > 0) {
            days.forEach(d => {
                if (d.diet_meals) {
                    // Match same food across ALL meal types (not just same meal_time)
                    const found = d.diet_meals.filter((m: any) =>
                        m.original_food_id === targetFoodId || (!m.original_food_id && m.food_id === targetFoodId)
                    )
                    matchingMeals = [...matchingMeals, ...found]
                }
            })
        }

        // Filter out the current meal from matches to see if there are OTHERS
        const otherMatches = matchingMeals.filter(m => m.id !== currentMeal.id)

        let applyToAll = false
        if (otherMatches.length > 0) {
            setSmartSwapData({
                isOpen: true,
                matchCount: matchingMeals.length,
                slotName: 'Tüm Öğünler',  // Now matches across all meal types
                newFood: newFood,
                oldFoodName: (currentMeal?.foods as any)?.real_food_name || (currentMeal?.foods as any)?.name || 'Bu yemek',
                targetIds: matchingMeals.map(m => m.id),
                targetIdsToRevert: isRevertToOriginal ? matchingMeals.map(m => m.id) : undefined
            })
            return // Stop here, wait for dialog
        }

        executeSwap([currentMeal.id], newFood)
    }

    const executeSwap = async (targetIds: string[], newFood: any) => {
        if (!alternativeDialogData.meal) return
        const currentMeal = alternativeDialogData.meal
        const actualOriginalId = currentMeal.original_food_id || currentMeal.food_id
        const isRevertToOriginal = newFood.id === actualOriginalId

        // Optimistic Updates (Loop for each target)
        targetIds.forEach(id => {
            // We can't update ALL meals in local state easily without a refresh or complex reducer.
            // But for now, let's trigger onUpdate (which triggers parent refresh/re-fetch usually)
            // or check if onUpdate can handle single item.
            // The parent `onUpdate` calls `updateMeal` which updates local state.
            // We'll rely on DB update + Refresh for batch.
        })

        const { error } = await supabase.from('diet_meals').update({
            food_id: newFood.id,
            original_food_id: isRevertToOriginal ? null : actualOriginalId,
            swapped_by: isRevertToOriginal ? null : (profile?.role === 'patient' ? 'patient' : 'dietitian'),
            calories: newFood.calories,
            protein: newFood.protein,
            carbs: newFood.carbs,
            fat: newFood.fat,
            is_custom: false, custom_name: null
        }).in('id', targetIds)

        if (!error) {
            setAlternativeDialogData({ isOpen: false, meal: null })
            setSmartSwapData(null)
            onUpdate() // This usually refreshes the grid
            setHighlightedMealId(currentMeal.id)
            setTimeout(() => setHighlightedMealId(null), 10000)
        } else {
            alert("Hata: " + error.message)
        }
    }

    const handleSmartSwapConfirm = (applyToAll: boolean) => {
        if (!smartSwapData) return
        const targets = applyToAll ? smartSwapData.targetIds : [alternativeDialogData.meal.id]
        executeSwap(targets, smartSwapData.newFood)
    }

    return (
        <div ref={setNodeRef} className={cn("border rounded-md transition-all min-h-[60px]", isOver ? "bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200" : "bg-white border-gray-100")}>
            <div className="flex items-center justify-between px-2 py-1 bg-emerald-50 border-b border-emerald-100 rounded-t-md">
                <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-tighter">{mealType}</span>
                {!readOnly && (
                    <div className="flex items-center gap-1">
                        <PhotoMealLogModal
                            dayId={dayId}
                            mealTime={mealType}
                            patientDietType={patientDietType ?? undefined}
                            patientId={patientId}
                            onSave={onUpdate}
                            trigger={
                                <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-emerald-200 text-emerald-600 transition-colors" title="Fotoğraf ile Ekle">
                                    <Camera size={12} />
                                </button>
                            }
                        />
                        <FoodSearchSelector
                            open={isSearchOpen}
                            patientId={patientId}
                            onOpenChange={setIsSearchOpen}
                            foods={allFoods || []}
                            calorieGap={targets?.calories && dayTotals?.calories !== undefined ? Math.max(0, (targets.calories || 0) - (dayTotals.calories || 0)) : undefined}
                            proteinGap={targets?.protein && dayTotals?.protein !== undefined ? Math.max(0, (targets.protein || 0) - (dayTotals.protein || 0)) : undefined}
                            fatGap={targets?.fat && dayTotals?.fat !== undefined ? Math.max(0, (targets.fat || 0) - (dayTotals.fat || 0)) : undefined}
                            activeDietRules={activeDietRules}
                            patientDiseases={patientDiseases}
                            patientLabs={patientLabs}
                            patientMedicationRules={patientMedicationRules}
                            dayDate={dayDate}
                            onSelect={async (food) => {
                                setIsSearchOpen(false)
                                const { error } = await supabase.from('diet_meals').insert({
                                    diet_day_id: dayId,
                                    meal_time: mealType,
                                    food_id: food.id,
                                    portion_multiplier: 1,
                                    calories: food.calories,
                                    protein: food.protein,
                                    carbs: food.carbs,
                                    fat: food.fat,
                                    is_consumed: true
                                })
                                if (error) alert("Hata: " + error.message)
                                else onUpdate()
                            }}
                            onCreate={(name, macros) => {
                                setIsSearchOpen(false)
                                // Create a temporary meal object for editing
                                setEditingMeal({
                                    is_custom: true,
                                    custom_name: name,
                                    calories: macros?.calories || 0, protein: macros?.protein || 0, carbs: macros?.carbs || 0, fat: macros?.fat || 0,
                                    diet_day_id: dayId, // Required for subsequent insert
                                    meal_time: mealType
                                })
                            }}
                            trigger={
                                <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-emerald-200 text-emerald-600 transition-colors">
                                    <Plus size={12} />
                                </button>
                            }
                        />
                    </div>
                )}
            </div>

            <div className="p-1 space-y-1">
                {meals.length === 0 && (
                    <div className="text-[10px] text-gray-300 text-center py-2 italic select-none">
                        {isOver ? 'Bırakın...' : '-'}
                    </div>
                )}
                {sortFoodsByRole(meals, (meal: any) => meal.foods?.role || meal.role).map((meal: any, index: number) => {
                    const isCustom = meal.is_custom && !meal.food_id
                    const mealName = isCustom ? (meal.custom_name || 'Özel') : (meal.foods?.name || meal.custom_name || '')

                    const scaledFoodName = getScaledFoodName(mealName, meal.portion_multiplier || 1, scalableUnits || [])
                    const isDisliked = containsDislikedWord(mealName, dislikedFoods)
                    const compatibility = checkCompatibility(meal.foods || { name: mealName }, activeDietRules, patientDiseases, patientLabs, patientMedicationRules)

                    // Calculate quick cals directly (Admin preview)
                    // Priority: 1. Direct meal override, 2. Base food macros
                    const multiplier = meal.portion_multiplier || 1
                    const mp = (meal.protein !== null ? meal.protein : ((meal.foods?.protein || 0) * multiplier)) || 0
                    const mc = (meal.carbs !== null ? meal.carbs : ((meal.foods?.carbs || 0) * multiplier)) || 0
                    const mf = (meal.fat !== null ? meal.fat : ((meal.foods?.fat || 0) * multiplier)) || 0

                    const mealCalories = meal.calories !== null ? Math.round(meal.calories * multiplier) : Math.round((mp * 4) + (mc * 4) + (mf * 9))

                    const countKey = meal.food_id || mealName.toLowerCase().trim()
                    const count = mealCounts?.get(countKey) || 0
                    const isHighlighted = highlightedMealId === meal.id

                    const isSwapped = !!meal.original_food_id && (meal.original_food_id !== meal.food_id)
                    const swappedBy = meal.swapped_by // 'dietitian' | 'patient' | null

                    // VISUAL LOGIC
                    // Dietitian View Logic:
                    // - Patient Swap: Yellow BG + Yellow Icon
                    // - Dietitian Swap: White BG + Purple Icon

                    // Patient View Logic (implied requirement, but user focused on Dietitian view mainly):
                    // Let's assume standard behavior for now:
                    // - Patient Swap: Normal/Amber BG + Amber Icon
                    // - Dietitian Swap: Normal BG (Simulate "Original")

                    let bgClass = 'bg-white'
                    let borderClass = 'hover:border-blue-400'

                    if (isHighlighted) {
                        bgClass = 'bg-yellow-100'
                        borderClass = 'border-yellow-300'
                    } else if (isDisliked) {
                        bgClass = 'bg-red-50'
                        borderClass = 'border-red-300'
                    } else if (isSwapped) {
                        if (swappedBy === 'patient') {
                            bgClass = 'bg-amber-50'
                            borderClass = 'border-amber-300 ring-1 ring-amber-100'
                        } else {
                            // Dietitian swap: Look normal but show indicator
                            bgClass = 'bg-white'
                            // Keep default border hover
                        }
                    }

                    if (!compatibility.compatible) {
                        bgClass = 'bg-yellow-50/50'
                        borderClass = 'border-yellow-300'
                    }

                    return (
                        <div key={meal.id} className={`group relative text-xs border rounded p-1.5 transition-colors shadow-sm duration-500 ${bgClass} ${borderClass}`}>
                            {count > 1 && (
                                <span className="absolute -top-1 -left-1 bg-blue-100 text-blue-700 text-[8px] font-bold px-1 rounded-full border border-blue-200 shadow-sm z-30">
                                    {count}x
                                </span>
                            )}
                            <div className={readOnly ? "cursor-default" : "cursor-pointer"} onClick={() => !readOnly && setEditingMeal(meal)}>
                                <div className="font-medium leading-tight break-words pr-4">
                                    {showIcons && <SeasonalityIcon food={meal.foods} date={dayDate} />}
                                    {showIcons && isDisliked && <span className="mr-0.5 cursor-help" title="Hastanın sevmediği besin listesinde">🚫</span>}
                                    {/* Unified warnings tooltip (grid view) */}
                                    {showIcons && ((!compatibility.compatible || compatibility.recommended || compatibility.medicationWarning) && (compatibility.warnings?.length > 0 || compatibility.reason)) && (
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="mr-0.5 cursor-help inline-flex items-center gap-0.5">
                                                        {!compatibility.compatible && <AlertTriangle size={12} className="inline text-red-600 mb-0.5" />}
                                                        {compatibility.recommended && <Heart size={12} fill="currentColor" className="inline text-blue-600 mb-0.5" />}
                                                        {compatibility.medicationWarning && (
                                                            <>
                                                                {compatibility.medicationWarning.type === 'negative' && <span className="text-red-600 text-[10px]">💊</span>}
                                                                {compatibility.medicationWarning.type === 'warning' && <span className="text-yellow-600 text-[10px]">💊</span>}
                                                                {compatibility.medicationWarning.type === 'positive' && <span className="text-green-600 text-[10px]">💊</span>}
                                                            </>
                                                        )}
                                                    </span>
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

                                                                                        let statusIcon = '⚠️';
                                                                                        if (w.type === 'negative') statusIcon = '⛔';
                                                                                        if (w.type === 'positive') statusIcon = '✅';

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
                                                        </div>
                                                    ) : (
                                                        <div className="p-3 text-gray-600">{compatibility.reason}</div>
                                                    )}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )}
                                    {showIcons && isCustom && <span className="text-purple-500 mr-0.5 cursor-help" title="Veritabanında kayıtlı değil (Özel yemek)">✦</span>}
                                    {showIcons && meal.is_consumed && <span className="text-green-500 mr-0.5" title="Tüketildi">✓</span>}
                                    {showIcons && isSwapped && (
                                        <span title={swappedBy === 'dietitian' ? "Diyetisyen tarafından değiştirildi" : "Hasta tarafından değiştirildi"}>
                                            <RotateCcw size={10} className={`inline mr-0.5 animate-in fade-in ${swappedBy === 'dietitian' ? 'text-purple-600' : 'text-amber-600'}`} />
                                            <RotateCcw size={10} className={`inline mr-0.5 animate-in fade-in ${swappedBy === 'dietitian' ? 'text-purple-600' : 'text-amber-600'}`} />
                                        </span>
                                    )}

                                    {/* GENERATION SOURCE INDICATOR */}
                                    {showIcons && meal.generation_meta && !readOnly && (
                                        <span className="mr-0.5 cursor-help" title={`Kaynak: ${meal.generation_meta.rule || 'Otomatik'}`}>
                                            <Sparkles size={10} className="inline text-indigo-400 mb-0.5" />
                                        </span>
                                    )}

                                    <span className={isDisliked ? 'text-red-700' : 'text-gray-900'}>{scaledFoodName}</span>
                                    {/* COMPATIBILITY MATCH DEBUG INDICATOR */}
                                    {(() => {
                                        const slotMainDish = meals.find((m: any) =>
                                            m.foods?.role?.toLowerCase().includes('ana yemek') ||
                                            m.foods?.category?.toLowerCase().includes('ana yemek')
                                        )?.foods

                                        if (slotMainDish && meal.foods && slotMainDish.id !== meal.foods.id) {
                                            const targetTags = slotMainDish.compatibility_tags || []
                                            const myTags = meal.foods.tags || []

                                            const match = targetTags.find((t: string) =>
                                                myTags.some((mt: string) => mt.trim().toLowerCase() === t.trim().toLowerCase())
                                            )

                                            if (match) {
                                                return (
                                                    <span className="ml-1 inline-flex items-center px-1 py-0 rounded text-[9px] font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                                                        ({match})
                                                    </span>
                                                )
                                            }
                                        }
                                        return null
                                    })()}
                                    {showIcons && onShowRecipe && (() => {
                                        const hasCustomImage = !!meal.foods?.image_url
                                        const isUserProposal = meal.foods?.meta?.source === 'user_proposal'
                                        const skipAutoMatch = hasCustomImage || isUserProposal
                                        const matchResults = findRecipeMatch((meal.foods?.name || mealName), manualMatches || [], bans || [], cards || [], skipAutoMatch)

                                        return (
                                            <>
                                                {/* 1. Custom Image Priority */}
                                                {hasCustomImage && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            onShowRecipe(meal.foods.image_url, meal.foods.name)
                                                        }}
                                                        className="ml-1 inline-flex items-center text-indigo-600 hover:text-indigo-800"
                                                        title="Yemek Görselini Görüntüle"
                                                    >
                                                        <Image size={12} />
                                                    </button>
                                                )}

                                                {/* 2. Recipe Matches (Manual Only if hasCustomImage=true, else Auto+Manual) */}
                                                {matchResults.length > 0 && (
                                                    <>
                                                        {matchResults.map((match, idx) => (
                                                            <button
                                                                key={match.id}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    onShowRecipe(match.url, match.filename)
                                                                }}
                                                                className="ml-1 inline-flex items-center text-indigo-600 hover:text-indigo-800"
                                                                title={`Tarifi Görüntüle: ${match.filename}`}
                                                            >
                                                                <BookOpenText size={12} />
                                                                {matchResults.length > 1 && (
                                                                    <span className="text-[8px] font-bold -ml-[2px] -mb-[6px]">{idx + 1}</span>
                                                                )}
                                                            </button>
                                                        ))}
                                                    </>
                                                )}
                                            </>
                                        )
                                    })()}
                                    {showIcons && (meal.portion_multiplier || 1) !== 1 && <span className="text-blue-500 text-[9px] ml-0.5">({meal.portion_multiplier}x)</span>}
                                </div>
                                <div className="text-[9px] text-gray-500 mt-0.5">
                                    {mealCalories} kcal
                                </div>
                            </div>

                            {!readOnly && (
                                <div className="absolute top-0 right-0 p-0.5 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded border border-gray-100 shadow-sm z-10">
                                    <div className="flex gap-0.5 justify-end">
                                        <button className={`p-0.5 rounded ${meal.is_locked ? 'text-red-500 hover:bg-red-100' : 'text-gray-400 hover:text-gray-600'}`} onClick={(e) => { e.stopPropagation(); onToggleLock(meal.id, meal.is_locked || false) }} title={meal.is_locked ? "Kilidi Aç" : "Kilitle"}>
                                            {meal.is_locked ? <Lock size={10} /> : <Unlock size={10} />}
                                        </button>
                                        {!meal.is_custom && (
                                            <button className="p-0.5 hover:bg-indigo-100 text-indigo-500 rounded" onClick={(e) => { e.stopPropagation(); setAlternativeDialogData({ isOpen: true, meal: meal }) }}>
                                                <RefreshCw size={10} />
                                            </button>
                                        )}
                                        <button className="p-0.5 hover:bg-red-100 text-red-500 rounded" onClick={async (e) => {
                                            e.stopPropagation();
                                            if (!confirm("Silinsin mi?")) return;
                                            await supabase.from('diet_meals').delete().eq('id', meal.id);
                                            onUpdate();
                                        }}>
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                    <div onClick={e => e.stopPropagation()}>
                                        <MealReorderButtons meal={meal} meals={meals} onUpdate={onUpdate} size={10} vertical />
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {
                editingMeal && (
                    editingMeal.is_custom ? (
                        <FoodEditDialog
                            food={{
                                name: editingMeal.custom_name,
                                calories: editingMeal.calories,
                                protein: editingMeal.protein,
                                carbs: editingMeal.carbs,
                                fat: editingMeal.fat,
                                min_quantity: 1, max_quantity: 1, step: 0.5, multiplier: 1, category: mealType
                            }}
                            isOpen={!!editingMeal}
                            onClose={() => setEditingMeal(null)}
                            onUpdate={onUpdate}
                            mode="create"
                            onCreate={async (newFood) => {
                                if (editingMeal.id) {
                                    // Updating existing custom meal (conversion)
                                    const { error } = await supabase.from('diet_meals').update({
                                        food_id: newFood.id,
                                        is_custom: false,
                                        custom_name: null,
                                        calories: newFood.calories,
                                        protein: newFood.protein,
                                        carbs: newFood.carbs,
                                        fat: newFood.fat,
                                        portion_multiplier: 1 // Reset multiplier on conversion
                                    }).eq('id', editingMeal.id)
                                    if (!error) onUpdate()
                                } else {
                                    // Creating NEW meal from search (insert)
                                    const { error } = await supabase.from('diet_meals').insert({
                                        diet_day_id: editingMeal.diet_day_id,
                                        meal_time: editingMeal.meal_time,
                                        food_id: newFood.id,
                                        portion_multiplier: 1,
                                        calories: newFood.calories,
                                        protein: newFood.protein,
                                        carbs: newFood.carbs,
                                        fat: newFood.fat,
                                        is_consumed: true
                                    })
                                    if (error) alert("Hata: " + error.message)
                                    else onUpdate()
                                }
                            }}
                        />
                    ) : (
                        editingMeal.foods && (
                            <FoodEditDialog
                                food={{
                                    ...editingMeal.foods,
                                    calories: (editingMeal.calories ?? editingMeal.foods.calories),
                                    protein: (editingMeal.protein ?? editingMeal.foods.protein),
                                    carbs: (editingMeal.carbs ?? editingMeal.foods.carbs),
                                    fat: (editingMeal.fat ?? editingMeal.foods.fat),
                                }}
                                isOpen={!!editingMeal}
                                onClose={() => setEditingMeal(null)}
                                onUpdate={onUpdate}
                                patientId={patientId}
                                onSave={async (updatedFoodData) => {
                                    const { micronutrients, ...foodsPayload } = updatedFoodData
                                    const teamOwnerId = await resolveFoodTeamOwnerId()
                                    const savedFood = await saveFoodByScope(editingMeal.foods.id, foodsPayload, teamOwnerId)

                                    if (Array.isArray(micronutrients)) {
                                        const { error: microError } = await saveFoodMicronutrientsByScope({
                                            baseFoodId: editingMeal.foods.id,
                                            teamOwnerId,
                                            micronutrients,
                                            createdBy: user?.id || null
                                        })
                                        if (microError) throw microError
                                    }

                                    await supabase.from('diet_meals').update({ calories: null, protein: null, carbs: null, fat: null }).eq('food_id', editingMeal.foods.id)
                                    return savedFood
                                }}
                            />
                        )
                    )
                )
            }

            {
                alternativeDialogData.isOpen && alternativeDialogData.meal && (
                    <FoodAlternativeDialog
                        isOpen={alternativeDialogData.isOpen}
                        onClose={() => setAlternativeDialogData({ isOpen: false, meal: null })}
                        originalFood={{ ...alternativeDialogData.meal.foods, portion_multiplier: alternativeDialogData.meal.portion_multiplier || 1 }}
                        onSelect={handleAlternativeSelect}
                        currentMonth={dayDate ? dayDate.getMonth() + 1 : undefined}
                        nearbyUsedFoodIds={nearbyUsedFoodIds}
                        originalFoodToRevert={originalFoodToRevert}
                        patientId={patientId}
                        dailyTargets={targets}
                        dailyTotals={dayTotals}
                        // Find potential main dish in this slot to check compatibility against
                        mainDishOfSlot={meals.find(m =>
                            m.foods?.role?.toLowerCase().includes('ana yemek') ||
                            m.foods?.role?.toLowerCase().includes('main')
                        )?.foods}
                    />
                )
            }

            {/* Smart Swap Dialog - Toplu değişiklik sorusu */}
            {smartSwapData?.isOpen && (
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
            )}
        </div >
    )
}

function DietWeekGridView({ weekId, refreshTrigger, startDate, mealTypes, onToggleLock, onToggleNoteLock, dislikedFoods = [], patientDiseases = [], activeDietRules, targets, formatDiff, macroTolerances, mealCounts, allFoods = [], readOnly = false, patientId, manualMatches, bans, cards, onShowRecipe, patientLabs = [], macroTargetMode, patientMedicationRules = [], scalableUnits = [], patientDietType, showIcons = true }: {
    weekId: string,
    refreshTrigger: number,
    startDate?: string | null,
    mealTypes: string[],
    onToggleLock: (mealId: string, currentStatus: boolean) => Promise<void>,
    onToggleNoteLock: (noteId: string, currentStatus: boolean) => Promise<void>,
    dislikedFoods?: string[],
    patientDiseases?: any[],
    activeDietRules?: DietRules,
    targets?: any,
    formatDiff?: any,
    macroTolerances?: any,
    mealCounts?: Map<string, number>,
    allFoods?: any[],
    readOnly?: boolean,
    patientId?: string,
    manualMatches?: any[],
    bans?: any[],
    cards?: any[],
    onShowRecipe?: (url: string, name: string) => void,
    patientLabs?: any[],
    macroTargetMode?: string,
    patientMedicationRules?: any[],
    scalableUnits?: string[],
    patientDietType?: string | null,
    showIcons?: boolean
}) {
    const [days, setDays] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [internalRefresh, setInternalRefresh] = useState(0)

    useEffect(() => {
        fetchDays()
    }, [weekId, refreshTrigger, internalRefresh])

    async function fetchDays() {
        const { data, error } = await supabase
            .from('diet_days')
            .select(`
                                id, day_number, notes,
                                diet_meals (
                                id, meal_time, portion_multiplier, custom_notes, sort_order, is_locked, food_id,
                                custom_name, calories, protein, carbs, fat, is_custom, created_at, original_food_id, swapped_by,
                                is_consumed,
                                foods!diet_meals_food_id_fkey (
                                    *,
                                    food_micronutrients ( micronutrient_id )
                                ),

                                original_food:foods!diet_meals_original_food_id_fkey (
                                    name, calories, protein, carbs, fat
                                ),
                                generation_meta
                                ),
                                diet_notes (
                                id, content, is_locked, sort_order, original_note_id
                                )
                                `)
            .eq('diet_week_id', weekId)
            .eq('is_active', true)
            .order('day_number', { ascending: true })

        if (data) {
            const sortedData = data.map(day => ({
                ...day,
                diet_meals: day.diet_meals?.map((meal: any) => {
                    // Flatten food_micronutrients if present
                    if (meal.foods && meal.foods.food_micronutrients) {
                        meal.foods.micronutrients = meal.foods.food_micronutrients.map((fm: any) => fm.micronutrient_id)
                    }
                    return meal
                }).sort((a: any, b: any) => {
                    const diff = (a.sort_order || 0) - (b.sort_order || 0)
                    if (diff !== 0) return diff
                    const dateDiff = (a.created_at || '').localeCompare(b.created_at || '')
                    if (dateDiff !== 0) return dateDiff
                    return (a.id || '').localeCompare(b.id || '')
                })
            }))
            setDays(sortedData)
        }
        setLoading(false)
    }


    if (loading && days.length === 0) return <div className="p-8 text-center text-muted-foreground">Yükleniyor...</div>

    function getDayLabel(dayNumber: number): string {
        if (startDate) {
            const date = new Date(startDate)
            date.setDate(date.getDate() + dayNumber - 1)
            const dayName = DAY_NAMES_JS[date.getDay()]
            return `${dayName} (${formatDate(date)})`
        }
        return `${dayNumber}. Gün`
    }


    return (
        <div className="flex gap-4 min-w-max pb-4">
            {days.map((day, index) => {
                // DYNAMIC TARGET LOGIC
                const isPlanMode = macroTargetMode === 'plan'
                let dayTarget = { calories: 0, protein: 0, carbs: 0, fat: 0 }
                if (isPlanMode) {
                    dayTarget = (day.diet_meals || []).reduce((acc: any, m: any) => {
                        let mCal = 0, mPro = 0, mCarb = 0, mFat = 0
                        const swappedByPatient = m.swapped_by === 'patient'
                        const hasOriginal = !!m.original_food

                        if (swappedByPatient && hasOriginal) {
                            const f = m.original_food
                            mCal = (f.calories || 0) * (m.portion_multiplier || 1)
                            mPro = (f.protein || 0) * (m.portion_multiplier || 1)
                            mCarb = (f.carbs || 0) * (m.portion_multiplier || 1)
                            mFat = (f.fat || 0) * (m.portion_multiplier || 1)
                        } else {
                            mCal = ((m.calories > 0 ? m.calories : m.foods?.calories) || 0) * (m.portion_multiplier || 1)
                            mPro = ((m.protein > 0 ? m.protein : m.foods?.protein) || 0) * (m.portion_multiplier || 1)
                            mCarb = ((m.carbs > 0 ? m.carbs : m.foods?.carbs) || 0) * (m.portion_multiplier || 1)
                            mFat = ((m.fat > 0 ? m.fat : m.foods?.fat) || 0) * (m.portion_multiplier || 1)
                        }
                        return {
                            calories: acc.calories + mCal,
                            protein: acc.protein + mPro,
                            carbs: acc.carbs + mCarb,
                            fat: acc.fat + mFat
                        }
                    }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
                }

                const dayTotals = day.diet_meals?.reduce((acc: any, m: any) => {
                    const p = ((m.is_custom ? m.protein : m.foods?.protein) || 0) * (m.portion_multiplier || 1)
                    const c = ((m.is_custom ? m.carbs : m.foods?.carbs) || 0) * (m.portion_multiplier || 1)
                    const f = ((m.is_custom ? m.fat : m.foods?.fat) || 0) * (m.portion_multiplier || 1)
                    const cal = Math.round((p * 4) + (c * 4) + (f * 9))
                    return {
                        calories: acc.calories + cal,
                        protein: acc.protein + p,
                        carbs: acc.carbs + c,
                        fat: acc.fat + f,
                    }
                }, { calories: 0, protein: 0, carbs: 0, fat: 0 }) || { calories: 0, protein: 0, carbs: 0, fat: 0 }

                // Calculate nearby food IDs (Prev, Curr, Next days)
                const prevDay = days[index - 1]
                const nextDay = days[index + 1]
                const nearbyMeals = [
                    ...(prevDay?.diet_meals || []),
                    ...(day.diet_meals || []), // Current day
                    ...(nextDay?.diet_meals || [])
                ]
                const nearbyUsedFoodIds = Array.from(new Set(nearbyMeals.map(m => m.food_id).filter(Boolean))) as string[]



                return (
                    <div key={day.id} className="w-[220px] flex-shrink-0 flex flex-col gap-2">
                        <div className="font-semibold text-center py-2 bg-blue-50 text-blue-700 rounded-md border border-blue-100 text-sm flex flex-col gap-1">
                            <span>{getDayLabel(day.day_number)}</span>
                            {targets ? (
                                <div className="flex flex-col w-full px-1">
                                    <div className="flex justify-between w-full text-xs font-medium text-gray-700 px-1">
                                        <span className="w-10 text-center">{Math.round(isPlanMode ? dayTarget.calories : targets.calories)}</span>
                                        <span className="w-8 text-center">{Math.round(isPlanMode ? dayTarget.carbs : targets.carb)}</span>
                                        <span className="w-8 text-center">{Math.round(isPlanMode ? dayTarget.protein : targets.protein)}</span>
                                        <span className="w-8 text-center">{Math.round(isPlanMode ? dayTarget.fat : targets.fat)}</span>
                                    </div>
                                    <div className="flex justify-between w-full text-[10px] px-1 font-semibold">
                                        {(() => {
                                            const targetCal = isPlanMode ? dayTarget.calories : targets.calories
                                            const targetCarb = isPlanMode ? dayTarget.carbs : targets.carb
                                            const targetPro = isPlanMode ? dayTarget.protein : targets.protein
                                            const targetFat = isPlanMode ? dayTarget.fat : targets.fat

                                            const dCal = dayTotals.calories - targetCal
                                            const dCarb = dayTotals.carbs - targetCarb
                                            const dPro = dayTotals.protein - targetPro
                                            const dFat = dayTotals.fat - targetFat

                                            const getColor = (val: number, target: number, type: 'calories' | 'carb' | 'protein' | 'fat') => {
                                                const minTol = macroTolerances?.[type]?.min ?? (type === 'calories' ? 90 : 80)
                                                const maxTol = macroTolerances?.[type]?.max ?? (type === 'calories' ? 110 : 120)
                                                const actual = target + val
                                                if (actual > target * (maxTol / 100)) return 'text-red-600'
                                                if (actual < target * (minTol / 100)) return 'text-orange-500'
                                                return 'text-green-600'
                                            }

                                            const fmt = (val: number, target: number, type: 'calories' | 'carb' | 'protein' | 'fat') => {
                                                const r = Math.round(val)
                                                const sign = r > 0 ? '+' : ''
                                                return <span className={`w-10 text-center ${getColor(val, target, type)}`}>{sign}{r}</span>
                                            }
                                            const fmtMac = (val: number, target: number, type: 'calories' | 'carb' | 'protein' | 'fat') => {
                                                const r = Math.round(val)
                                                const sign = r > 0 ? '+' : ''
                                                return <span className={`w-8 text-center ${getColor(val, target, type)}`}>{sign}{r}</span>
                                            }

                                            return (
                                                <>
                                                    {fmt(dCal, targetCal, 'calories')}
                                                    {fmtMac(dCarb, targetCarb, 'carb')}
                                                    {fmtMac(dPro, targetPro, 'protein')}
                                                    {fmtMac(dFat, targetFat, 'fat')}
                                                </>
                                            )
                                        })()}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-[10px] font-normal text-gray-500">
                                    {Math.round(dayTotals.calories)} kcal
                                </div>
                            )}
                        </div>
                        <div className="space-y-3">
                            {mealTypes.map(type => {
                                let dayDate: Date | undefined = undefined
                                if (startDate) {
                                    dayDate = new Date(startDate)
                                    dayDate.setDate(dayDate.getDate() + (day.day_number - 1))
                                }
                                const filteredMeals = day.diet_meals?.filter((m: any) => normalizeMealType(m.meal_time) === normalizeMealType(type)) || []

                                return (
                                    <DroppableMealSlot patientDietType={patientDietType ?? undefined}
                                        key={type}
                                        dayDate={dayDate}
                                        dayId={day.id}
                                        mealType={type}
                                        meals={filteredMeals}
                                        onUpdate={() => setInternalRefresh(prev => prev + 1)}
                                        onToggleLock={onToggleLock}
                                        dislikedFoods={dislikedFoods}
                                        patientDiseases={patientDiseases}
                                        activeDietRules={activeDietRules}
                                        mealCounts={mealCounts}
                                        nearbyUsedFoodIds={nearbyUsedFoodIds}
                                        allFoods={allFoods}
                                        targets={targets}
                                        formatDiff={formatDiff}
                                        dayTotals={dayTotals}
                                        readOnly={readOnly}
                                        patientId={patientId}
                                        manualMatches={manualMatches}
                                        bans={bans}
                                        cards={cards}
                                        onShowRecipe={onShowRecipe}
                                        patientLabs={patientLabs}
                                        patientMedicationRules={patientMedicationRules}
                                        scalableUnits={scalableUnits}
                                        days={days}
                                    />
                                )
                            })}
                            <DietNoteSlot
                                dayId={day.id}
                                notes={day.diet_notes || []}
                                onUpdate={() => setInternalRefresh(prev => prev + 1)}
                                onToggleLock={onToggleNoteLock}
                            />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// ================== LIST VIEW WITH DROP ZONES ==================
function DietWeekListView({ weekId, refreshTrigger, startDate, mealTypes, onToggleLock, onToggleNoteLock, dislikedFoods = [], patientDiseases = [], activeDietRules, targets, formatDiff, macroTolerances, mealCounts, allFoods = [], readOnly = false, patientId, manualMatches, bans, cards, onShowRecipe, patientLabs = [], macroTargetMode, patientMedicationRules = [], scalableUnits = [], patientDietType, showIcons = true }: {
    weekId: string,
    refreshTrigger: number,
    startDate?: string | null,
    mealTypes: string[],
    onToggleLock: (mealId: string, currentStatus: boolean) => Promise<void>,
    onToggleNoteLock: (noteId: string, currentStatus: boolean) => Promise<void>,
    dislikedFoods?: string[],
    patientDiseases?: any[],
    activeDietRules?: DietRules,
    targets?: any,
    formatDiff?: any,
    macroTolerances?: any,
    mealCounts?: Map<string, number>,
    allFoods?: any[],
    readOnly?: boolean,
    patientId?: string,
    manualMatches?: any[],
    bans?: any[],
    cards?: any[],
    onShowRecipe?: (url: string, name: string) => void,
    patientLabs?: any[],
    macroTargetMode?: string,
    patientMedicationRules?: any[],
    scalableUnits?: string[],
    patientDietType?: string | null,
    showIcons?: boolean
}) {
    const [days, setDays] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [internalRefresh, setInternalRefresh] = useState(0)

    useEffect(() => {
        fetchDays()
    }, [weekId, refreshTrigger, internalRefresh])

    async function fetchDays() {
        const { data } = await supabase
            .from('diet_days')
            .select(`
                                    id, day_number, notes,
                                    diet_meals (
                                    id, meal_time, portion_multiplier, custom_notes, sort_order, is_locked,
                                    custom_name, calories, protein, carbs, fat, is_custom, food_id,
                                    is_consumed, original_food_id, swapped_by,
                                    foods!diet_meals_food_id_fkey (
                                        id, name, calories, protein, carbs, fat, portion_unit, role, tags, season_start, season_end,
                                        food_micronutrients ( micronutrient_id )
                                    ),
                                    original_food:foods!diet_meals_original_food_id_fkey (
                                        name, calories, protein, carbs, fat
                                    )
                                    ),
                                    diet_notes (
                                    id, content, is_locked, sort_order, original_note_id
                                    )
                                    `)
            .eq('diet_week_id', weekId)
            .eq('is_active', true)
            .order('day_number', { ascending: true })
        if (data) {
            const sortedData = data.map(day => ({
                ...day,
                diet_meals: day.diet_meals?.map((meal: any) => {
                    // Flatten food_micronutrients if present
                    if (meal.foods && meal.foods.food_micronutrients) {
                        meal.foods.micronutrients = meal.foods.food_micronutrients.map((fm: any) => fm.micronutrient_id)
                    }
                    return meal
                }).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
            }))
            setDays(sortedData)
        }
        setLoading(false)
    }

    if (loading && days.length === 0) return <div className="p-8 text-center text-muted-foreground">Yükleniyor...</div>

    function getDayLabel(dayNumber: number): string {
        if (startDate) {
            const date = new Date(startDate)
            date.setDate(date.getDate() + dayNumber - 1)
            const dayName = DAY_NAMES_JS[date.getDay()]
            return `${dayName} (${formatDate(date)})`
        }
        return `${dayNumber}. Gün`
    }

    function calcMealTotals(meals: any[]) {
        return meals.reduce((acc, m) => ({
            // Önce meal'deki değerleri kontrol et, yoksa foods'tan al
            calories: acc.calories + ((m.calories > 0 ? m.calories : m.foods?.calories) || 0) * (m.portion_multiplier || 1),
            protein: acc.protein + ((m.protein > 0 ? m.protein : m.foods?.protein) || 0) * (m.portion_multiplier || 1),
            carbs: acc.carbs + ((m.carbs > 0 ? m.carbs : m.foods?.carbs) || 0) * (m.portion_multiplier || 1),
            fat: acc.fat + ((m.fat > 0 ? m.fat : m.foods?.fat) || 0) * (m.portion_multiplier || 1),
        }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
    }

    return (
        <div className="space-y-6">
            {days.map((day, index) => {
                const allMeals = day.diet_meals || []
                const dayTotals = calcMealTotals(allMeals)

                // DYNAMIC TARGET LOGIC
                // If mode is 'plan', we calculate target based on original plan (ignoring patient swaps)
                // If mode is 'calculated', we use the static 'targets' object derived from weight
                const isPlanMode = macroTargetMode === 'plan'

                let dayTarget = { calories: 0, protein: 0, carbs: 0, fat: 0 }
                if (isPlanMode) {
                    // Sum up the *intended* plan items
                    dayTarget = allMeals.reduce((acc: any, m: any) => {
                        // If patient swapped it, revert to original values for target calculation
                        // If Dietitian swapped it (or no swap), use current values
                        let mCal = 0, mPro = 0, mCarb = 0, mFat = 0

                        const swappedByPatient = m.swapped_by === 'patient'
                        const hasOriginal = !!m.original_food

                        if (swappedByPatient && hasOriginal) {
                            // Use Original Food
                            const f = m.original_food
                            mCal = (f.calories || 0) * (m.portion_multiplier || 1)
                            mPro = (f.protein || 0) * (m.portion_multiplier || 1)
                            mCarb = (f.carbs || 0) * (m.portion_multiplier || 1)
                            mFat = (f.fat || 0) * (m.portion_multiplier || 1)
                        } else {
                            // Use Current Meal
                            mCal = ((m.calories > 0 ? m.calories : m.foods?.calories) || 0) * (m.portion_multiplier || 1)
                            mPro = ((m.protein > 0 ? m.protein : m.foods?.protein) || 0) * (m.portion_multiplier || 1)
                            mCarb = ((m.carbs > 0 ? m.carbs : m.foods?.carbs) || 0) * (m.portion_multiplier || 1)
                            mFat = ((m.fat > 0 ? m.fat : m.foods?.fat) || 0) * (m.portion_multiplier || 1)
                        }

                        return {
                            calories: acc.calories + mCal,
                            protein: acc.protein + mPro,
                            carbs: acc.carbs + mCarb,
                            fat: acc.fat + mFat
                        }
                    }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
                }
                // END DYNAMIC TARGET LOGIC

                // Calculate nearby food IDs (Prev, Curr, Next days)
                const prevDay = days[index - 1]
                const nextDay = days[index + 1]
                const nearbyMeals = [
                    ...(prevDay?.diet_meals || []),
                    ...(day.diet_meals || []), // Current day
                    ...(nextDay?.diet_meals || [])
                ]
                // Collect unique food IDs (ensure not null)
                const nearbyUsedFoodIds = Array.from(new Set(nearbyMeals.map(m => m.food_id).filter(Boolean))) as string[]

                return (
                    <div key={day.id} className="border rounded-lg overflow-hidden">
                        <div className="bg-blue-50 text-blue-700 font-semibold px-4 py-2 flex justify-between items-center">
                            <span>{getDayLabel(day.day_number)}</span>
                            {targets ? (
                                <div className="flex flex-col items-end gap-1">
                                    {/* Aligned Header Layout - Single Root Div */}
                                    <div className="flex text-xs font-medium text-gray-700">
                                        <div className="w-16 px-4 text-right">{Math.round(isPlanMode ? dayTarget.calories : targets.calories)}</div>
                                        <div className="w-16 px-4 text-right">{Math.round(isPlanMode ? dayTarget.carbs : targets.carb)}</div>
                                        <div className="w-16 px-4 text-right">{Math.round(isPlanMode ? dayTarget.protein : targets.protein)}</div>
                                        <div className="w-16 px-4 text-right">{Math.round(isPlanMode ? dayTarget.fat : targets.fat)}</div>
                                    </div>
                                    <div className="flex text-[10px] font-semibold">
                                        {(() => {
                                            const targetCal = isPlanMode ? dayTarget.calories : targets.calories
                                            const targetCarb = isPlanMode ? dayTarget.carbs : targets.carb
                                            const targetPro = isPlanMode ? dayTarget.protein : targets.protein
                                            const targetFat = isPlanMode ? dayTarget.fat : targets.fat

                                            const dCal = dayTotals.calories - targetCal
                                            const dCarb = dayTotals.carbs - targetCarb
                                            const dPro = dayTotals.protein - targetPro
                                            const dFat = dayTotals.fat - targetFat

                                            const getColor = (val: number, target: number, type: 'calories' | 'carb' | 'protein' | 'fat') => {
                                                const minTol = macroTolerances?.[type]?.min ?? (type === 'calories' ? 90 : 80)
                                                const maxTol = macroTolerances?.[type]?.max ?? (type === 'calories' ? 110 : 120)
                                                const actual = target + val
                                                if (actual > target * (maxTol / 100)) return 'text-red-600'
                                                if (actual < target * (minTol / 100)) return 'text-orange-500'
                                                return 'text-green-600'
                                            }

                                            const fmt = (val: number, target: number, type: 'calories' | 'carb' | 'protein' | 'fat') => {
                                                const r = Math.round(val)
                                                const sign = r > 0 ? '+' : ''
                                                return <div className={`w-16 px-4 text-right ${getColor(val, target, type)}`}>{sign}{r}</div>
                                            }
                                            const fmtMac = (val: number, target: number, type: 'calories' | 'carb' | 'protein' | 'fat') => {
                                                const r = Math.round(val)
                                                const sign = r > 0 ? '+' : ''
                                                return <div className={`w-16 px-4 text-right ${getColor(val, target, type)}`}>{sign}{r}</div>
                                            }

                                            return (
                                                <>
                                                    {fmt(dCal, targetCal, 'calories')}
                                                    {fmtMac(dPro, targetPro, 'protein')}
                                                    {fmtMac(dCarb, targetCarb, 'carb')}
                                                    {fmtMac(dFat, targetFat, 'fat')}
                                                </>
                                            )
                                        })()}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm font-normal text-gray-500">
                                    {Math.round(dayTotals.calories)} kcal
                                </div>
                            )}
                        </div>
                        <div className="divide-y">
                            {mealTypes.map((mealType: string) => {
                                const meals = allMeals.filter((m: any) => normalizeMealType(m.meal_time) === normalizeMealType(mealType))
                                const mealTotals = calcMealTotals(meals)

                                // Calculate date for this day
                                let dayDate: Date | undefined = undefined
                                if (startDate) {
                                    dayDate = new Date(startDate)
                                    dayDate.setDate(dayDate.getDate() + (day.day_number - 1))
                                }

                                return (
                                    <ListViewMealSlot patientDietType={patientDietType ?? undefined}
                                        key={mealType}
                                        dayId={day.id}
                                        mealType={mealType}
                                        meals={meals}
                                        mealTotals={mealTotals}
                                        onUpdate={() => setInternalRefresh(prev => prev + 1)}
                                        onToggleLock={onToggleLock}
                                        dislikedFoods={dislikedFoods}
                                        patientDiseases={patientDiseases}
                                        activeDietRules={activeDietRules}
                                        dayDate={dayDate}
                                        nearbyUsedFoodIds={nearbyUsedFoodIds}
                                        patientId={patientId}
                                        days={days}
                                        targets={targets}
                                        allFoods={allFoods}
                                        manualMatches={manualMatches}
                                        bans={bans}
                                        cards={cards}
                                        onShowRecipe={onShowRecipe}
                                        patientLabs={patientLabs}
                                        patientMedicationRules={patientMedicationRules}
                                        scalableUnits={scalableUnits}
                                    />
                                )
                            })}
                            <DietNoteSlot
                                dayId={day.id}
                                notes={day.diet_notes || []}
                                onUpdate={() => setInternalRefresh(prev => prev + 1)}
                                onToggleLock={onToggleNoteLock}
                                compact={false}
                            />
                        </div>
                    </div>
                )
            })}
        </div >
    )
}

// ================== LIST VIEW MEAL SLOT (DROPPABLE) ==================
// Helper Icon Component
function SeasonalityIcon({ food, date }: { food: any, date?: Date }) {
    if (!date) return null
    const seasonCheck = checkSeasonality(food, date)
    if (!seasonCheck.inSeason) {
        return <span className="mr-1 text-orange-500 cursor-help" title={seasonCheck.reason}>🍂</span>
    }
    return null
}

// ================== LIST VIEW MEAL SLOT (DROPPABLE) ==================
function ListViewMealSlot({ dayId, mealType, meals, mealTotals, onUpdate, onToggleLock, dislikedFoods = [], activeDietRules, dayDate, nearbyUsedFoodIds = [], patientId, days = [], targets, allFoods = [], manualMatches, bans, cards, onShowRecipe, patientDiseases = [], patientLabs = [], patientMedicationRules = [], scalableUnits = [], patientDietType, showIcons = true }: {
    dayId: string,
    mealType: string,
    meals: any[],
    mealTotals: { calories: number, protein: number, carbs: number, fat: number },
    onUpdate: () => void,
    onToggleLock: (mealId: string, currentStatus: boolean) => Promise<void>
    dislikedFoods?: string[],
    activeDietRules?: DietRules,
    dayDate?: Date,
    nearbyUsedFoodIds?: string[],
    patientId?: string,
    days?: any[],
    targets?: any,
    allFoods?: any[],
    manualMatches?: any[],
    bans?: any[],
    cards?: any[],
    onShowRecipe?: (url: string, name: string) => void,
    patientDiseases?: any[],
    patientLabs?: any[],
    patientMedicationRules?: any[],
    scalableUnits?: string[],
    patientDietType?: string,
    showIcons?: boolean
}) {
    const { user, profile } = useAuth()

    async function resolveFoodTeamOwnerId(): Promise<string | null> {
        if (!user?.id) return null
        const scope = await resolveTeamScopeContextForUser(user.id, {
            role: profile?.role || null,
            is_global_access: (profile as any)?.is_global_access === true
        })
        return scope.teamOwnerId
    }

    async function saveFoodByScope(
        foodId: string,
        updates: Record<string, any>,
        teamOwnerIdOverride?: string | null
    ) {
        const teamOwnerId = teamOwnerIdOverride ?? await resolveFoodTeamOwnerId()

        if (teamOwnerId && user?.id) {
            const { error } = await upsertTeamFoodOverride({
                teamOwnerId,
                baseFoodId: foodId,
                createdBy: user.id,
                updates
            })
            if (error) throw error

            const { data: baseFood, error: baseFoodError } = await supabase
                .from('foods')
                .select('*')
                .eq('id', foodId)
                .single()
            if (baseFoodError) throw baseFoodError

            const scopedFoods = await applyTeamFoodOverrides(baseFood ? [baseFood] : [], teamOwnerId)
            const effectiveFoods = await applyTeamFoodMicronutrientOverrides(scopedFoods, teamOwnerId)
            return effectiveFoods[0] || scopedFoods[0] || baseFood
        }

        const { data, error } = await supabase
            .from('foods')
            .update(updates)
            .eq('id', foodId)
            .select()
            .single()
        if (error) throw error
        return data
    }

    const hasLockedMeal = meals.some(m => m.is_locked)
    const { setNodeRef, isOver } = useDroppable({
        id: `list-slot-${dayId}-${mealType}`,
        data: { type: 'meal-slot', dayId, mealTime: mealType },
        disabled: hasLockedMeal
    })



    const [editingMeal, setEditingMeal] = useState<any>(null)
    const [alternativeDialogData, setAlternativeDialogData] = useState<{ isOpen: boolean, meal: any | null }>({ isOpen: false, meal: null })
    const [smartSwapData, setSmartSwapData] = useState<{ isOpen: boolean, matchCount: number, slotName: string, newFood: any, oldFoodName: string, targetIds: string[], targetIdsToRevert?: string[] } | null>(null)
    const [isSearchOpen, setIsSearchOpen] = useState(false)

    async function handleAlternativeSelect(newFood: any) {
        if (!alternativeDialogData.meal) return

        const actualOriginalId = alternativeDialogData.meal.original_food_id || alternativeDialogData.meal.food_id
        const isRevertToOriginal = newFood.id === actualOriginalId
        const currentMeal = alternativeDialogData.meal

        // 1. Detect if this meal appears in other days (Same Slot + Same Food)
        const targetFoodId = currentMeal.original_food_id || currentMeal.food_id

        let matchingMeals: any[] = []
        if (days && days.length > 0) {
            days.forEach(d => {
                if (d.diet_meals) {
                    const found = d.diet_meals.filter((m: any) =>
                        m.meal_time === currentMeal.meal_time &&
                        (m.original_food_id === targetFoodId || (!m.original_food_id && m.food_id === targetFoodId))
                    )
                    matchingMeals = [...matchingMeals, ...found]
                }
            })
        }

        const otherMatches = matchingMeals.filter(m => m.id !== currentMeal.id)

        let applyToAll = false
        if (otherMatches.length > 0) {
            setSmartSwapData({
                isOpen: true,
                matchCount: matchingMeals.length,
                slotName: currentMeal.meal_time,
                newFood: newFood,
                oldFoodName: (currentMeal?.foods as any)?.real_food_name || (currentMeal?.foods as any)?.name || 'Bu yemek',
                targetIds: matchingMeals.map(m => m.id),
                targetIdsToRevert: isRevertToOriginal ? matchingMeals.map(m => m.id) : undefined
            })
            return // Stop here, wait for dialog
        }

        executeSwap([currentMeal.id], newFood)
    }

    const executeSwap = async (targetIds: string[], newFood: any) => {
        if (!alternativeDialogData.meal) return
        const currentMeal = alternativeDialogData.meal
        const actualOriginalId = currentMeal.original_food_id || currentMeal.food_id
        const isRevertToOriginal = newFood.id === actualOriginalId

        // Update matches
        const { error } = await supabase
            .from('diet_meals')
            .update({
                food_id: newFood.id,
                original_food_id: isRevertToOriginal ? null : actualOriginalId,
                swapped_by: isRevertToOriginal ? null : (profile?.role === 'patient' ? 'patient' : 'dietitian'),
                // Reset custom overrides to ensure new food's macros are used
                calories: null,
                protein: null,
                carbs: null,
                fat: null,
                is_custom: false,
                custom_name: null
            })
            .in('id', targetIds)

        if (error) {
            alert("Değişiklik kaydedilemedi: " + error.message)
        } else {
            onUpdate()
            setAlternativeDialogData({ isOpen: false, meal: null })
            setSmartSwapData(null)
            // if (applyToAll) {
            //     alert(`${targetIds.length} öğün güncellendi.`)
            // }
        }
    }

    const handleSmartSwapConfirm = (applyToAll: boolean) => {
        if (!smartSwapData) return
        const targets = applyToAll ? smartSwapData.targetIds : [alternativeDialogData.meal.id]
        executeSwap(targets, smartSwapData.newFood)
    }

    return (
        <div
            ref={setNodeRef}
            className={`${isOver ? 'bg-blue-50 ring-2 ring-blue-300 ring-inset' : ''}`}
        >
            <div className="flex items-center justify-between px-4 py-2 bg-emerald-50 border-b border-emerald-100">
                <span className="font-medium text-emerald-700 w-24">{mealType}</span>
                <div className="flex items-center gap-1">
                    <PhotoMealLogModal
                        dayId={dayId}
                        mealTime={mealType}
                        patientDietType={patientDietType ?? undefined}
                        patientId={patientId}
                        onSave={onUpdate}
                        trigger={
                            <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-emerald-200 text-emerald-600 transition-colors" title="Fotoğraf ile Ekle">
                                <Camera size={12} />
                            </button>
                        }
                    />
                    <FoodSearchSelector
                        open={isSearchOpen}
                        patientId={patientId}
                        onOpenChange={setIsSearchOpen}
                        foods={allFoods || []}
                        calorieGap={targets?.calories ? Math.max(0, (targets.calories || 0) - (mealTotals?.calories || 0)) : undefined}
                        proteinGap={targets?.protein ? Math.max(0, (targets.protein || 0) - (mealTotals?.protein || 0)) : undefined}
                        fatGap={targets?.fat ? Math.max(0, (targets.fat || 0) - (mealTotals?.fat || 0)) : undefined}
                        activeDietRules={activeDietRules}
                        patientDiseases={patientDiseases}
                        patientLabs={patientLabs}
                        patientMedicationRules={patientMedicationRules}
                        dayDate={dayDate}
                        onSelect={async (food) => {
                            setIsSearchOpen(false)
                            const { error } = await supabase.from('diet_meals').insert({
                                diet_day_id: dayId,
                                meal_time: mealType,
                                food_id: food.id,
                                portion_multiplier: 1,
                                is_consumed: true
                            })
                            if (error) alert("Hata: " + error.message)
                            else onUpdate()
                        }}
                        onCreate={(name, macros) => {
                            setIsSearchOpen(false)
                            // Create a temporary meal object for editing
                            setEditingMeal({
                                is_custom: true,
                                custom_name: name,
                                calories: macros?.calories || 0, protein: macros?.protein || 0, carbs: macros?.carbs || 0, fat: macros?.fat || 0,
                                diet_day_id: dayId, // Required for subsequent insert
                                meal_time: mealType
                            })
                        }}
                        trigger={
                            <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-emerald-200 text-emerald-600 transition-colors">
                                <Plus size={12} />
                            </button>
                        }
                    />
                </div>
            </div>
            <table className="w-full text-sm">
                <tbody>
                    {meals.length === 0 && (
                        <tr>
                            <td className="px-4 py-3 text-gray-400 italic text-center" colSpan={6}>
                                {isOver ? '🎯 Buraya bırakın' : 'Yemek eklemek için sürükleyin'}
                            </td>
                        </tr>
                    )}
                    {meals.map((meal: any) => {
                        const isCustom = meal.is_custom
                        const mealName = isCustom ? (meal.custom_name || 'Bilinmeyen Yemek') : (meal.foods?.name || '')
                        const scaledFoodName = getScaledFoodName(mealName, meal.portion_multiplier || 1, scalableUnits || [])
                        const isDisliked = containsDislikedWord(mealName, dislikedFoods)
                        // Mock food object for custom meals to check simple rules or just skip
                        const mockFood = isCustom ? { name: mealName, tags: [] } : meal.foods
                        const compatibility = checkCompatibility(meal.foods || { name: mealName }, activeDietRules, patientDiseases, patientLabs, patientMedicationRules)

                        // Calculate seasonality if startDate is available
                        let seasonality = { inSeason: true, reason: '' }
                        // We need access to day_number here. But ListViewMealSlot receives 'meals' for a type.
                        // Actually 'dayId' is passed to ListViewMealSlot. But we need day_number from parent scope or passed down.
                        // The loop above inside DietWeekListView has 'day' object which has 'day_number'.
                        // But ListViewMealSlot is outside that scope.
                        // Let's rely on Props passed to ListViewMealSlot. We need to pass 'dayDate' to ListViewMealSlot.

                        // Wait, I need to update ListViewMealSlot signature first in a separate step or assume I'll do it.
                        // To avoid breaking, I will assume 'date' prop is passed to ListViewMealSlot.
                        // But I haven't added it yet. I should do that first. 



                        const isSwapped = !!meal.original_food_id && (meal.original_food_id !== meal.food_id)
                        const swappedBy = meal.swapped_by

                        let rowBgClass = ''
                        if (meal.is_locked) rowBgClass = 'bg-red-50/30'
                        else if (isDisliked) rowBgClass = 'bg-red-50'
                        else if (!compatibility.compatible) {
                            rowBgClass = compatibility.severity === 'block' ? 'bg-red-100' : 'bg-yellow-50'
                        }
                        else if (isSwapped) {
                            if (swappedBy === 'patient') {
                                rowBgClass = 'bg-amber-50'
                            } else {
                                // Dietitian swap: Normal background
                                rowBgClass = ''
                            }
                        }

                        return (
                            <tr key={meal.id} className={`border-t hover:bg-gray-50 group ${rowBgClass}`}>
                                <td className="px-4 py-2 w-8">
                                    {!meal.is_locked && <MealReorderButtons meal={meal} meals={meals} onUpdate={onUpdate} />}
                                </td>
                                <td className="px-2 py-2 w-16 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="flex gap-1 justify-end">
                                        <button
                                            className="p-1 hover:bg-blue-100 text-blue-500 rounded"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (meal.is_custom) {
                                                    // Trigger conversion flow
                                                    setEditingMeal(meal)
                                                } else {
                                                    setEditingMeal(meal);
                                                }
                                            }}
                                            title={meal.is_custom ? "Veritabanına Ekle / Düzenle" : "Düzenle"}
                                        >
                                            <Pencil size={12} />
                                        </button>
                                        {!meal.is_custom && (
                                            <button
                                                className="p-1 hover:bg-indigo-100 text-indigo-500 rounded"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setAlternativeDialogData({ isOpen: true, meal: meal })
                                                }}
                                                title="Alternatif Bul"
                                            >
                                                <RefreshCw size={12} />
                                            </button>
                                        )}
                                        <button
                                            className="p-1 hover:bg-red-100 text-red-500 rounded"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                if (!confirm("Yemeği silmek istediğinize emin misiniz?")) return;
                                                const { error } = await supabase.from('diet_meals').delete().eq('id', meal.id);
                                                if (error) { alert('Silme hatası: ' + error.message); } else { onUpdate(); }
                                            }}
                                            title="Kaldır"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </td>
                                <td className="px-4 py-2 flex items-center gap-2">
                                    <button
                                        onClick={() => onToggleLock(meal.id, meal.is_locked || false)}
                                        className={`p-1 rounded ${meal.is_locked ? 'text-red-500 hover:bg-red-100' : 'text-gray-300 hover:text-gray-500'}`}
                                        title={meal.is_locked ? "Kilidi Aç" : "Kilitle"}
                                    >
                                        {meal.is_locked ? <Lock size={14} /> : <Unlock size={14} />}
                                    </button>
                                    <span className={`flex items-center ${isDisliked ? 'text-red-600 font-medium' : ''}`}>
                                        {isDisliked && <span className="mr-1 cursor-help" title="Hastanın sevmediği besin listesinde">🚫</span>}
                                        {/* Unified warnings tooltip */}
                                        {((!compatibility.compatible || compatibility.recommended) && (compatibility.warnings?.length > 0 || compatibility.reason)) && (
                                            <span className="mr-1">
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <span className="cursor-help inline-flex items-center gap-0.5">
                                                                {!compatibility.compatible && <AlertTriangle size={12} className="inline text-red-600" />}
                                                                {compatibility.recommended && <Heart size={12} fill="currentColor" className="inline text-blue-600" />}
                                                                {compatibility.medicationWarning && (
                                                                    <>
                                                                        {compatibility.medicationWarning.type === 'negative' && <span className="text-red-600 text-[10px]">💊</span>}
                                                                        {compatibility.medicationWarning.type === 'warning' && <span className="text-yellow-600 text-[10px]">💊</span>}
                                                                        {compatibility.medicationWarning.type === 'positive' && <span className="text-green-600 text-[10px]">💊</span>}
                                                                    </>
                                                                )}
                                                            </span>
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

                                                                                                let statusIcon = '⚠️';
                                                                                                if (w.type === 'negative') statusIcon = '⛔';
                                                                                                if (w.type === 'positive') statusIcon = '✅';

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
                                                                </div>
                                                            ) : (
                                                                <div className="p-3 text-gray-600">{compatibility.reason}</div>
                                                            )}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </span>
                                        )}
                                        {(() => { try { return meal.custom_notes ? JSON.parse(meal.custom_notes).source === 'ai_text' : false } catch (e) { return false } })() ? (
                                            <span className="mr-1 text-purple-600 cursor-help" title="Yapay Zeka tarafından eklendi (Kelime bazlı)">
                                                <Sparkles className="inline-block w-3.5 h-3.5" />
                                            </span>
                                        ) : isCustom ? (
                                            <span className="mr-1 text-purple-600 cursor-help" title="Veritabanında kayıtlı değil (Özel yemek)">✦</span>
                                        ) : null}
                                        {meal.is_consumed && <span className="mr-1 text-green-500" title="Tüketildi">✓</span>}
                                        {!!meal.original_food_id && (meal.original_food_id !== meal.food_id) && (
                                            <span title={meal.swapped_by === 'dietitian' ? "Diyetisyen tarafından değiştirildi" : "Hasta tarafından değiştirildi"}>
                                                <RotateCcw size={10} className={`inline mr-1 ${meal.swapped_by === 'dietitian' ? 'text-purple-600' : 'text-amber-600'}`} />
                                            </span>
                                        )}
                                        {/* COMPATIBILITY MATCH DEBUG INDICATOR */}
                                        {(() => {
                                            const slotMainDish = meals.find((m: any) =>
                                                m.foods?.role?.toLowerCase().includes('ana yemek') ||
                                                m.foods?.category?.toLowerCase().includes('ana yemek')
                                            )?.foods

                                            if (slotMainDish && meal.foods && slotMainDish.id !== meal.foods.id) {
                                                const targetTags = slotMainDish.compatibility_tags || []
                                                const myTags = meal.foods.tags || []

                                                const match = targetTags.find((t: string) =>
                                                    myTags.some((mt: string) => mt.trim().toLowerCase() === t.trim().toLowerCase())
                                                )

                                                if (match) {
                                                    return (
                                                        <span className="mr-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-200 text-yellow-800 border border-yellow-300">
                                                            ({match})
                                                        </span>
                                                    )
                                                }
                                            }
                                            return null
                                        })()}
                                        {showIcons && !isCustom && <SeasonalityIcon food={meal.foods} date={dayDate} />}
                                        {scaledFoodName}
                                        {showIcons && onShowRecipe && (() => {
                                            const hasCustomImage = !!meal.foods?.image_url
                                            const isUserProposal = meal.foods?.meta?.source === 'user_proposal'
                                            const skipAutoMatch = hasCustomImage || isUserProposal
                                            const matchResults = findRecipeMatch((meal.foods?.name || mealName), manualMatches || [], bans || [], cards || [], skipAutoMatch)

                                            // Priority: Custom Image > Manual Matches > Auto Matches
                                            // If user_proposal or has custom image, Auto Matches are disabled

                                            return (
                                                <>
                                                    {/* 1. Custom Image */}
                                                    {hasCustomImage && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                onShowRecipe(meal.foods.image_url, meal.foods.name)
                                                            }}
                                                            className="ml-1 inline-flex items-center text-indigo-600 hover:text-indigo-800"
                                                            title="Yemek Görselini Görüntüle"
                                                        >
                                                            <Image size={14} />
                                                        </button>
                                                    )}

                                                    {/* 2. Recipe Matches */}
                                                    {matchResults.length > 0 && (
                                                        <>
                                                            {matchResults.map((match, idx) => (
                                                                <button
                                                                    key={match.id}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        onShowRecipe(match.url, match.filename)
                                                                    }}
                                                                    className="ml-1 inline-flex items-center text-indigo-600 hover:text-indigo-800"
                                                                    title={`Tarifi Görüntüle: ${match.filename}`}
                                                                >
                                                                    <BookOpenText size={14} />
                                                                    {matchResults.length > 1 && (
                                                                        <span className="text-[9px] font-bold -ml-[2px] -mb-[6px]">{idx + 1}</span>
                                                                    )}
                                                                </button>
                                                            ))}
                                                        </>
                                                    )}
                                                </>
                                            )
                                        })()}
                                        {showIcons && (meal.portion_multiplier || 1) !== 1 && <span className="text-blue-600 ml-1">({meal.portion_multiplier}x)</span>}
                                        {showIcons && !compatibility.compatible && <span className="text-yellow-600 ml-2 text-sm cursor-help" title={`Diyet türü/kuralları ile uyumsuz: ${compatibility.reason}`}>⚠️</span>}
                                    </span>
                                </td>
                                <td className="px-4 py-2 text-right w-16">{Math.round(((meal.calories > 0 ? meal.calories : meal.foods?.calories) || 0) * (meal.portion_multiplier || 1))}</td>
                                <td className="px-4 py-2 text-right w-16">{Math.round(((meal.carbs > 0 ? meal.carbs : meal.foods?.carbs) || 0) * (meal.portion_multiplier || 1))}g</td>
                                <td className="px-4 py-2 text-right w-16">{Math.round(((meal.protein > 0 ? meal.protein : meal.foods?.protein) || 0) * (meal.portion_multiplier || 1))}g</td>
                                <td className="px-4 py-2 text-right w-16">{Math.round(((meal.fat > 0 ? meal.fat : meal.foods?.fat) || 0) * (meal.portion_multiplier || 1))}g</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>

            {editingMeal && (
                editingMeal.is_custom ? (
                    <FoodEditDialog
                        food={{
                            name: editingMeal.custom_name,
                            calories: editingMeal.calories,
                            protein: editingMeal.protein,
                            carbs: editingMeal.carbs,
                            fat: editingMeal.fat,
                            // Defaults
                            min_quantity: 1, max_quantity: 1, step: 0.5, multiplier: 1, category: mealType
                        }}
                        isOpen={!!editingMeal}
                        onClose={() => setEditingMeal(null)}
                        onUpdate={onUpdate}
                        mode="create"
                        onCreate={async (newFood) => {
                            if (editingMeal.id) {
                                // Link the new food to this meal (guaranteed update for target)
                                const { error } = await supabase.from('diet_meals').update({
                                    food_id: newFood.id,
                                    is_custom: false,
                                    custom_name: null,
                                    calories: newFood.calories,
                                    protein: newFood.protein,
                                    carbs: newFood.carbs,
                                    fat: newFood.fat
                                }).eq('id', editingMeal.id)

                                // Then try to update others with same name (ignoring potential failure here)
                                if (!error && editingMeal.custom_name) {
                                    await supabase.from('diet_meals').update({
                                        food_id: newFood.id,
                                        is_custom: false,
                                        custom_name: null,
                                        calories: newFood.calories,
                                        protein: newFood.protein,
                                        carbs: newFood.carbs,
                                        fat: newFood.fat
                                    }).eq('custom_name', editingMeal.custom_name).is('food_id', null)
                                }
                                if (error) alert('Yemek eşleştirme hatası: ' + error.message)
                                else onUpdate()
                            } else {
                                // Creating NEW meal from search (insert)
                                const { error } = await supabase.from('diet_meals').insert({
                                    diet_day_id: editingMeal.diet_day_id,
                                    meal_time: editingMeal.meal_time,
                                    food_id: newFood.id,
                                    portion_multiplier: 1,
                                    calories: newFood.calories,
                                    protein: newFood.protein,
                                    carbs: newFood.carbs,
                                    fat: newFood.fat,
                                    is_consumed: true
                                })
                                if (error) alert("Hata: " + error.message)
                                else onUpdate()
                            }

                        }}
                        // Pass merged data for better consistency inside dialog
                        onSave={async (data) => {
                            // Custom save handler that clears overrides
                            try {
                                const { micronutrients, ...foodsPayload } = data
                                const teamOwnerId = await resolveFoodTeamOwnerId()
                                const savedFood = await saveFoodByScope(data.id, foodsPayload, teamOwnerId)

                                if (Array.isArray(micronutrients)) {
                                    const { error: microError } = await saveFoodMicronutrientsByScope({
                                        baseFoodId: data.id,
                                        teamOwnerId,
                                        micronutrients,
                                        createdBy: user?.id || null
                                    })
                                    if (microError) throw microError
                                }

                                // Clear overrides for ALL meals with this food
                                await supabase.from('diet_meals')
                                    .update({ calories: null, protein: null, carbs: null, fat: null })
                                    .eq('food_id', data.id)

                                return { error: null, data: savedFood }
                            } catch (error: any) {
                                return { error, data: null }
                            }
                        }}
                    />
                ) : (
                    editingMeal.foods && (
                        <FoodEditDialog
                            food={{
                                ...editingMeal.foods,
                                calories: (editingMeal.calories ?? editingMeal.foods.calories),
                                protein: (editingMeal.protein ?? editingMeal.foods.protein),
                                carbs: (editingMeal.carbs ?? editingMeal.foods.carbs),
                                fat: (editingMeal.fat ?? editingMeal.foods.fat),
                            }}
                            isOpen={!!editingMeal}
                            onClose={() => setEditingMeal(null)}
                            onUpdate={onUpdate}
                            patientId={patientId}
                            onSave={async (updatedFoodData) => {
                                const { micronutrients, ...foodsPayload } = updatedFoodData
                                const teamOwnerId = await resolveFoodTeamOwnerId()
                                const savedFood = await saveFoodByScope(editingMeal.foods.id, foodsPayload, teamOwnerId)

                                if (Array.isArray(micronutrients)) {
                                    const { error: microError } = await saveFoodMicronutrientsByScope({
                                        baseFoodId: editingMeal.foods.id,
                                        teamOwnerId,
                                        micronutrients,
                                        createdBy: user?.id || null
                                    })
                                    if (microError) throw microError
                                }

                                await supabase.from('diet_meals').update({ calories: null, protein: null, carbs: null, fat: null }).eq('food_id', editingMeal.foods.id)
                                return savedFood
                            }}
                        />
                    )
                )
            )}

            {/* Alternative Dialog */}
            {alternativeDialogData.isOpen && alternativeDialogData.meal && (
                <FoodAlternativeDialog
                    isOpen={alternativeDialogData.isOpen}
                    onClose={() => setAlternativeDialogData({ isOpen: false, meal: null })}
                    originalFood={{ ...alternativeDialogData.meal.foods, portion_multiplier: alternativeDialogData.meal.portion_multiplier || 1 }}
                    onSelect={handleAlternativeSelect}
                    currentMonth={dayDate ? dayDate.getMonth() + 1 : undefined}
                    nearbyUsedFoodIds={nearbyUsedFoodIds}
                    patientId={patientId}
                    dailyTargets={targets}
                    dailyTotals={(() => {
                        // Calculate Daily Totals for this day
                        if (!days || !alternativeDialogData.meal) return null
                        // iterate days to find the meal
                        for (const d of days) {
                            if (d.diet_meals?.some((m: any) => m.id === alternativeDialogData.meal.id)) {
                                // Match logic from Patient Panel
                                return d.diet_meals.reduce((acc: any, m: any) => {
                                    const mPro = ((m.is_custom ? m.protein : m.foods?.protein) || 0) * (m.portion_multiplier || 1)
                                    const mCarb = ((m.is_custom ? m.carbs : m.foods?.carbs) || 0) * (m.portion_multiplier || 1)
                                    const mFat = ((m.is_custom ? m.fat : m.foods?.fat) || 0) * (m.portion_multiplier || 1)
                                    const mCal = Math.round((mPro * 4) + (mCarb * 4) + (mFat * 9))
                                    return {
                                        calories: acc.calories + mCal,
                                        protein: acc.protein + mPro,
                                        carbs: acc.carbs + mCarb,
                                        fat: acc.fat + mFat
                                    }
                                }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
                            }
                        }
                        return null
                    })()}
                    mainDishOfSlot={(() => {
                        // Admin Panel Main Dish Detection
                        if (!days || !alternativeDialogData.meal) return null
                        for (const d of days) {
                            if (d.diet_meals?.some((m: any) => m.id === alternativeDialogData.meal.id)) {
                                // Found the day. Now find meals with same 'meal_time'
                                const slotMeals = d.diet_meals.filter((m: any) => m.meal_time === alternativeDialogData.meal.meal_time)
                                // Find main dish in this slot
                                const main = slotMeals.find((m: any) => {
                                    const role = (m.foods?.role || "").toLowerCase()
                                    return role.includes("ana yemek") || role.includes("maindish") || role === "main"
                                })
                                return main?.foods
                            }
                        }
                        return null
                    })()}
                />
            )}
        </div>
    )
}

// ================== MEAL REORDER BUTTONS ==================





function normalizeMealType(type: string) {
    if (!type) return 'DİĞER'
    const t = type.toUpperCase()
    if (t.includes('KAHVALTI')) return 'KAHVALTI'
    if (t.includes('ÖĞLE')) return 'ÖĞLEN'
    if (t.includes('AKŞAM')) return 'AKŞAM'
    return 'ARA ÖĞÜN'
}

// ================== DIET NOTE SLOT ==================
function DietNoteSlot({ dayId, notes, onUpdate, onToggleLock, compact = true }: {
    dayId: string,
    notes: any[],
    onUpdate: () => void,
    onToggleLock: (noteId: string, currentStatus: boolean) => Promise<void>,
    compact?: boolean
}) {
    // State for Dialog
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add')
    const [noteContent, setNoteContent] = useState('')
    const [activeNoteId, setActiveNoteId] = useState<string | null>(null)

    // Open Dialog for Add
    const openAddDialog = () => {
        setDialogMode('add')
        setNoteContent('')
        setActiveNoteId(null)
        setIsDialogOpen(true)
    }

    // Open Dialog for Edit
    const openEditDialog = (note: any) => {
        setDialogMode('edit')
        setNoteContent(note.content)
        setActiveNoteId(note.id)
        setIsDialogOpen(true)
    }

    async function handleSave() {
        if (!noteContent.trim()) return

        if (dialogMode === 'add') {
            const { error } = await supabase.from('diet_notes').insert({
                diet_day_id: dayId,
                content: noteContent.trim(),
                sort_order: notes.length
            })
            if (error) alert('Hata: ' + error.message)
            else {
                setIsDialogOpen(false)
                onUpdate()
            }
        } else if (dialogMode === 'edit' && activeNoteId) {
            const { error } = await supabase.from('diet_notes').update({ content: noteContent.trim() }).eq('id', activeNoteId)
            if (error) alert('Hata: ' + error.message)
            else {
                setIsDialogOpen(false)
                onUpdate()
            }
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Notu silmek istediğinize emin misiniz?')) return
        const { error } = await supabase.from('diet_notes').delete().eq('id', id)
        if (error) alert('Hata: ' + error.message)
        else onUpdate()
    }

    return (
        <div className={cn("mt-2 border-t pt-2", !compact && "mt-4 pt-4")}>
            <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                    <StickyNote size={10} /> Notlar
                </span>
                <button
                    onClick={openAddDialog}
                    className="h-4 w-4 flex items-center justify-center rounded hover:bg-amber-100 text-amber-600 transition-colors"
                >
                    <Plus size={12} />
                </button>
            </div>

            <div className="space-y-1 px-1">
                {notes.map(note => (
                    <div key={note.id} className={cn(
                        "group relative p-2 rounded-md border text-[11px] leading-snug transition-all",
                        note.is_locked ? "bg-amber-50/50 border-amber-200" : "bg-white border-gray-100 hover:border-amber-200"
                    )}>
                        <div className="pr-4 whitespace-pre-wrap text-gray-700 font-medium italic">
                            {note.content}
                        </div>
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 flex flex-col gap-0.5 transition-opacity bg-white/90 p-0.5 rounded shadow-sm border">
                            <button
                                onClick={() => onToggleLock(note.id, note.is_locked)}
                                className={cn("p-0.5 rounded", note.is_locked ? "text-red-500 hover:bg-red-50" : "text-gray-400 hover:text-amber-600")}
                                title={note.is_locked ? "Kilidi Aç" : "Kilitle"}
                            >
                                {note.is_locked ? <Lock size={10} /> : <Unlock size={10} />}
                            </button>
                            {!note.is_locked && (
                                <>
                                    <button
                                        onClick={() => openEditDialog(note)}
                                        className="p-0.5 text-gray-400 hover:text-amber-600 rounded"
                                        title="Düzenle"
                                    >
                                        <Pencil size={10} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(note.id)}
                                        className="p-0.5 text-gray-400 hover:text-red-600 rounded"
                                        title="Sil"
                                    >
                                        <Trash2 size={10} />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                ))}
                {notes.length === 0 && (
                    <div className="text-[10px] text-gray-300 italic text-center py-1">
                        Henüz not yok
                    </div>
                )}
            </div>

            {/* Note Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{dialogMode === 'add' ? 'Not Ekle' : 'Notu Düzenle'}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4">
                        <Textarea
                            value={noteContent}
                            onChange={(e) => setNoteContent(e.target.value)}
                            className="min-h-[150px]"
                            placeholder="Notunuzu buraya yazın..."
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>İptal</Button>
                        <Button onClick={handleSave}>Kaydet</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function LegendDialog({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Rehber: Simgeler ve Renkler</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm max-h-[70vh] overflow-y-auto">
                    {/* Yemek Simgeleri */}
                    <div className="space-y-2">
                        <h4 className="font-semibold text-gray-900 border-b pb-1">Yemek Simgeleri</h4>
                        <div className="grid grid-cols-1 gap-2">
                            <div className="flex items-start gap-2">
                                <span className="text-red-600 font-bold w-5 text-center shrink-0">🚫</span>
                                <div>
                                    <span className="font-medium">Sevilmeyen Besin</span>
                                    <p className="text-xs text-gray-500">Hastanın profildeki "sevmediği besinler" listesinde</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <AlertTriangle size={16} className="text-red-600 w-5 shrink-0" />
                                <div>
                                    <span className="font-medium">Uyarı</span>
                                    <p className="text-xs text-gray-500">Hastalık, diyet uyumsuzluğu veya yüksek tahlil değeri</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <Heart size={16} fill="currentColor" className="text-blue-600 w-5 shrink-0" />
                                <div>
                                    <span className="font-medium">Önerilen</span>
                                    <p className="text-xs text-gray-500">Hastalık için faydalı veya düşük tahlil değeri için zengin kaynak</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-orange-500 w-5 text-center shrink-0">🍂</span>
                                <div>
                                    <span className="font-medium">Mevsim Dışı</span>
                                    <p className="text-xs text-gray-500">Yemeğin mevsimine göre şu an uygun değil</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-green-500 font-bold w-5 text-center shrink-0">✓</span>
                                <div>
                                    <span className="font-medium">Tüketildi</span>
                                    <p className="text-xs text-gray-500">Hasta bu öğünü tükettiğini işaretledi</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <span className="text-purple-600 font-bold w-5 text-center shrink-0">✦</span>
                                <div>
                                    <span className="font-medium">Özel Yemek</span>
                                    <p className="text-xs text-gray-500">Veritabanında kayıtlı değil (el ile eklendi)</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <RotateCcw size={16} className="text-amber-600 w-5 shrink-0" />
                                <div>
                                    <span className="font-medium">Değiştirildi</span>
                                    <p className="text-xs text-gray-500">Diyetisyen veya hasta tarafından alternatif ile değiştirildi</p>
                                </div>
                            </div>
                            <div className="flex items-start gap-2">
                                <Lock size={16} className="text-red-500 w-5 shrink-0" />
                                <div>
                                    <span className="font-medium">Kilitli</span>
                                    <p className="text-xs text-gray-500">Bu öğün kilitli - otomatik değiştirilemez</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Kullanım Sayısı */}
                    <div className="space-y-2">
                        <h4 className="font-semibold text-gray-900 border-b pb-1">Kullanım Sayısı (Sidebar)</h4>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center bg-green-100 text-green-700 border border-green-300">2</span>
                                <span className="text-xs">Az (1-2)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center bg-yellow-100 text-yellow-700 border border-yellow-300">4</span>
                                <span className="text-xs">Orta (3-4)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center bg-red-100 text-red-700 border border-red-300">6</span>
                                <span className="text-xs">Çok (5+)</span>
                            </div>
                        </div>
                    </div>

                    {/* Renk Kodları */}
                    <div className="space-y-2">
                        <h4 className="font-semibold text-gray-900 border-b pb-1">Renk Kodları (Arkaplan)</h4>
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border rounded bg-white"></div>
                                <span>Normal Yemek</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border border-blue-200 rounded bg-blue-50"></div>
                                <span>Önerilen (Faydalı)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border border-yellow-300 rounded bg-yellow-50"></div>
                                <span>Uyarı / Diyet Uyumsuzluğu</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border border-red-300 rounded bg-red-50"></div>
                                <span>Sevilmeyen Besin</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border border-amber-300 rounded bg-amber-50"></div>
                                <span>Elle Değiştirilmiş Öğün</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border border-yellow-400 rounded bg-yellow-100"></div>
                                <span>Şu An Seçili</span>
                            </div>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={onClose}>Tamam</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
