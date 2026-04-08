"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowRight, Calendar, Droplets, Flame, Utensils, Scale, Activity, Save, Pencil, X, FileText, Target, Info, Camera, Beaker, Ruler, LayoutDashboard, Loader2 } from "lucide-react"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import LabResultsGrid from "@/components/diet/LabResultsGrid"
import PatientNotesEditor from "@/components/diet/PatientNotesEditor"
import { PatientMeasurements } from "@/components/diet/patient-measurements"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

const ACTIVITY_LEVELS = [
    { value: 1, label: 'Sedanter', description: 'Masa başı iş, az hareket', multiplier: 0.8 },
    { value: 2, label: 'Hafif Aktif', description: 'Hafif egzersiz, haftada 1-2 gün', multiplier: 0.9 },
    { value: 3, label: 'Orta Aktif', description: 'Orta egzersiz, haftada 3-5 gün', multiplier: 1.0 },
    { value: 4, label: 'Aktif', description: 'Yoğun egzersiz, haftada 6-7 gün', multiplier: 1.1 },
    { value: 5, label: 'Çok Aktif', description: 'Profesyonel atlet seviyesi', multiplier: 1.2 },
]

export default function PatientDashboardPage() {
    const { profile, user } = useAuth()
    const today = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isEditing, setIsEditing] = useState(false)

    // Patient Data
    const [patientId, setPatientId] = useState<string | null>(null)
    const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
    const [weight, setWeight] = useState<number>(70)
    const [weekWeight, setWeekWeight] = useState<number | null>(null)
    const [activityLevel, setActivityLevel] = useState<number>(3)
    const [dietType, setDietType] = useState<any>(null)
    const [patientStatus, setPatientStatus] = useState<string | null>(null)
    const [patientGoals, setPatientGoals] = useState<string[]>([])

    // Program Details
    const [programName, setProgramName] = useState<string | null>(null)
    const [weekNumber, setWeekNumber] = useState<number>(1)
    const [totalWeeks, setTotalWeeks] = useState<number>(1)
    const [weekTitle, setWeekTitle] = useState<string | null>(null)
    const [weekDateRange, setWeekDateRange] = useState<string | null>(null)

    // Edit Form State
    const [editWeight, setEditWeight] = useState<string>("")
    const [editActivity, setEditActivity] = useState<string>("3")

    const [stats, setStats] = useState({
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        water: 2.5,
        mealCount: 0
    })

    // New States for Start Date Warning
    const [showStartWarning, setShowStartWarning] = useState(false)
    const [showEndWarning, setShowEndWarning] = useState(false)
    const [planStartDate, setPlanStartDate] = useState<string | null>(null)

    useEffect(() => {
        // Wait for profile to be loaded before fetching
        // This fixes the race condition where dashboard fetches before impersonation profile loads
        if (user && profile) {
            fetchDashboardData()
        }
    }, [user, profile])

    // Calorie Calculation Logic (Matches Admin Panel's calculateDailyTargets)
    function calculateTargets(patientWeight: number, patientActivity: number, dietTypeData: any, patientGoals?: string[]) {
        const activityMultipliers: Record<number, number> = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.2 }
        let actMultiplier = activityMultipliers[patientActivity] || 1.0

        // Apply Goal Multipliers
        if (patientGoals && patientGoals.length > 0) {
            if (patientGoals.includes("Kilo Vermek") || patientGoals.includes("Kilo Vermek (Yağ Yakımı)")) {
                actMultiplier *= 0.9
            } else if (patientGoals.includes("Kilo Almak") || patientGoals.includes("Kas Gelişimi (Hipertrofi)")) {
                actMultiplier *= 1.1
            }
        }

        // Use diet type factors or defaults (same as admin page)
        const factors = {
            carb: dietTypeData?.carb_factor ?? 3.0,
            protein: dietTypeData?.protein_factor ?? 1.0,
            fat: dietTypeData?.fat_factor ?? 0.8
        }

        const carbs = Math.round(patientWeight * factors.carb * actMultiplier)
        const protein = Math.round(patientWeight * factors.protein * actMultiplier)
        const fat = Math.round(patientWeight * factors.fat * actMultiplier)
        const calories = Math.round((carbs * 4) + (protein * 4) + (fat * 9))
        const water = parseFloat((patientWeight * 0.033).toFixed(1))

        return { calories, protein, carbs, fat, water }
    }

    async function fetchDashboardData() {
        setLoading(true)
        try {
            const targetId = profile?.id || user?.id
            console.log("🔍 Dashboard: Looking for patient with ID:", targetId)

            if (!targetId) {
                setLoading(false)
                return
            }

            // Smart patient lookup (same as plan/page.tsx)
            // Priority 1: user_id match (legacy patients like HACER with existing plans)
            // Priority 2: id match (new patients created via portal)
            let patientRecord = null

            // First try user_id match
            const { data: legacyMatch } = await supabase
                .from('patients')
                .select(`
                    id, status, weight, height, birth_date, gender, activity_level, patient_goals, visibility_settings,
                    program_templates (
                        id, name, default_activity_level,
                        program_template_weeks (week_start, week_end, diet_type_id)
                    )
                `)
                .eq('user_id', targetId)
                .neq('id', targetId) // Exclude if id also matches
                .limit(1)
                .maybeSingle()

            if (legacyMatch) {
                patientRecord = legacyMatch
                console.log("📋 Dashboard: Found legacy patient via user_id:", patientRecord.id)
            } else {
                // Fallback: try id match
                const { data: directMatch } = await supabase
                    .from('patients')
                    .select(`
                        id, status, weight, height, birth_date, gender, activity_level, patient_goals, visibility_settings,
                        program_templates (
                            id, name, default_activity_level,
                            program_template_weeks (week_start, week_end, diet_type_id)
                        )
                    `)
                    .eq('id', targetId)
                    .maybeSingle()

                patientRecord = directMatch
                console.log("📋 Dashboard: Found patient via id:", patientRecord?.id)
            }

            if (!patientRecord) {
                console.error("Patient not found for targetId:", targetId)
                setLoading(false)
                // Redirect if fully missing
                window.location.href = '/register'
                return
            }

            // Also check here to avoid a split-second flicker of "Onay Bekliyor"
            if (!patientRecord.weight) {
                console.log("⚠️ Incomplete profile detected, redirecting to registration.")
                window.location.href = '/register?complete=true'
                return
            }

            const patient = patientRecord

            setPatientId(patient.id)
            setPatientStatus(patient.status)
            setPatientGoals(patient.patient_goals || [])
            const patientWeight = patient.weight || 70
            const patientActivity = patient.activity_level || 3
            setWeight(patientWeight)
            setActivityLevel(patientActivity)
            setEditWeight(String(patientWeight))
            setEditActivity(String(patientActivity))

            // Set program name if available
            const programData = patient.program_templates
            if (programData) {
                // Handle both single object and array cases
                const pt = Array.isArray(programData) ? programData[0] : programData
                if (pt?.name) {
                    setProgramName(pt.name)
                }
            }

            // 2. Get Active Plan & All Weeks
            const { data: plan } = await supabase
                .from('diet_plans')
                .select('id, diet_weeks(*)')
                .eq('patient_id', patient.id)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

            let currentWeek: any = null
            let effectiveWeight = patientWeight
            let effectiveActivity = patientActivity
            let resolvedDietType: any = null

            if (plan && plan.diet_weeks && plan.diet_weeks.length > 0) {
                setTotalWeeks(plan.diet_weeks.length)

                const sortedWeeks = [...plan.diet_weeks].sort((a: any, b: any) => a.week_number - b.week_number)

                // Find current week (today falls within start-end range)
                const now = new Date()
                const year = now.getFullYear()
                const month = String(now.getMonth() + 1).padStart(2, '0')
                const day = String(now.getDate()).padStart(2, '0')
                const todayStr = `${year}-${month}-${day}` // Local YYYY-MM-DD

                console.log("📅 Dashboard Date Debug (Local):", { todayStr })

                // Reset warning state
                setShowStartWarning(false)

                currentWeek = sortedWeeks.find((w: any) => {
                    const start = w.start_date
                    const end = w.end_date || new Date(new Date(start).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

                    const isCurrent = todayStr >= start && todayStr <= end
                    return isCurrent
                })

                // Fallback Logic
                if (!currentWeek) {
                    if (sortedWeeks.length > 0) {
                        // Find the closest week by start_date to today
                        const todayTime = new Date(todayStr).getTime()
                        let closestWeek = sortedWeeks[0]
                        let minDiff = Math.abs(new Date(sortedWeeks[0].start_date).getTime() - todayTime)

                        for (const w of sortedWeeks) {
                            const diff = Math.abs(new Date(w.start_date).getTime() - todayTime)
                            if (diff < minDiff) {
                                minDiff = diff
                                closestWeek = w
                            }
                        }

                        currentWeek = closestWeek

                        if (todayStr < closestWeek.start_date) {
                            console.log("ℹ️ Plan hasn't started yet. Showing closest future week.")
                            setShowStartWarning(true)
                            setPlanStartDate(new Date(closestWeek.start_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }))
                        } else {
                            console.warn("⚠️ No current week found! Falling back to closest past week.")
                            setShowEndWarning(true)
                        }
                    }
                }

                if (currentWeek) {
                    setCurrentWeekId(currentWeek.id)
                    setWeekNumber(currentWeek.week_number)
                    setWeekTitle(currentWeek.title)

                    // Format date range
                    if (currentWeek.start_date) {
                        const start = new Date(currentWeek.start_date)
                        const end = currentWeek.end_date
                            ? new Date(currentWeek.end_date)
                            : new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000)
                        setWeekDateRange(
                            `${start.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}`
                        )
                    }

                    // Use week's weight_log if available
                    if (currentWeek.weight_log) {
                        setWeekWeight(currentWeek.weight_log)
                        effectiveWeight = currentWeek.weight_log
                        setEditWeight(String(currentWeek.weight_log))
                    }

                    // Use week's activity_level_log if available
                    if (currentWeek.activity_level_log) {
                        setActivityLevel(currentWeek.activity_level_log)
                        effectiveActivity = currentWeek.activity_level_log
                        setEditActivity(String(currentWeek.activity_level_log))
                    }

                    // (Step 3 merged below into Priority System)
                }
            }

            // 3. Resolve Diet Type Priority System (Matches plan/page.tsx)
            // Priority 1: Program Template Rules matching week number
            // Priority 2: Assigned diet_type_id on the specific week
            // Priority 3: Program Template Rule (Week 1 fallback)

            let targetDietTypeId = null

            // Priority 1
            if (patient.program_templates) {
                const pt = Array.isArray(patient.program_templates) ? patient.program_templates[0] : patient.program_templates
                if (pt && pt.program_template_weeks) {
                    const pWeeks = Array.isArray(pt.program_template_weeks)
                        ? pt.program_template_weeks
                        : [pt.program_template_weeks]

                    const targetWeekNum = currentWeek ? currentWeek.week_number : 1

                    const rule = pWeeks.find((pw: any) => targetWeekNum >= pw.week_start && targetWeekNum <= pw.week_end)
                    if (rule && rule.diet_type_id) {
                        targetDietTypeId = rule.diet_type_id
                    }
                }
            }

            // Priority 2
            if (!targetDietTypeId && currentWeek?.assigned_diet_type_id) {
                targetDietTypeId = currentWeek.assigned_diet_type_id
            }

            // Priority 3
            if (!targetDietTypeId && patient.program_templates) {
                const pt = Array.isArray(patient.program_templates) ? patient.program_templates[0] : patient.program_templates
                if (pt && pt.program_template_weeks) {
                    const pWeeks = Array.isArray(pt.program_template_weeks)
                        ? pt.program_template_weeks
                        : [pt.program_template_weeks]
                    if (pWeeks.length > 0 && pWeeks[0].diet_type_id) {
                        targetDietTypeId = pWeeks[0].diet_type_id
                    }
                }
            }

            // Finally: Resolve the diet type and check for Patient-Specific Overrides
            if (targetDietTypeId) {
                const { data: baseType } = await supabase
                    .from('diet_types')
                    .select('*')
                    .eq('id', targetDietTypeId)
                    .single()

                if (baseType) {
                    resolvedDietType = baseType

                    // Check for override
                    const { data: overrideType } = await supabase
                        .from('diet_types')
                        .select('*')
                        .eq('patient_id', patient.id)
                        .eq('parent_diet_type_id', baseType.id)
                        .maybeSingle()

                    if (overrideType) {
                        resolvedDietType = overrideType
                    }

                    setDietType(resolvedDietType)
                }
            }

            // 5. Calculate Targets with resolved values
            const calcTargets = calculateTargets(effectiveWeight, effectiveActivity, resolvedDietType, patient.patient_goals)

            setStats({
                ...calcTargets,
                mealCount: 0
            })

        } catch (error) {
            console.error("Dashboard error:", error)
        } finally {
            setLoading(false)
        }
    }

    // ADD IMPORT (this will be handled by a later tool request if needed, but I'll add it above)
    async function handleSaveChanges() {
        if (!patientId) return

        setSaving(true)
        try {
            const newWeight = parseFloat(editWeight) || weight
            const newActivity = parseInt(editActivity) || activityLevel

            const { syncPatientWeightAndActivityAction } = await import('@/actions/measurement-actions')
            const result = await syncPatientWeightAndActivityAction(
                patientId,
                newWeight,
                newActivity,
                currentWeekId,
                'Hasta'
            )

            if (!result.success) {
                console.error("Sync partial/full failure:", result.errors)
                alert("Bazı veriler güncellenirken hata oluştu: " + result.errors.join(", "))
            }

            // Update local state
            setWeight(newWeight)
            setWeekWeight(newWeight)
            setActivityLevel(newActivity)

            // Recalculate stats
            const newStats = calculateTargets(newWeight, newActivity, dietType, patientGoals)
            setStats({ ...newStats, mealCount: 0 })

            setIsEditing(false)
        } catch (error) {
            console.error("Save error:", error)
        } finally {
            setSaving(false)
        }
    }

    function handleCancelEdit() {
        setEditWeight(String(weekWeight || weight))
        setEditActivity(String(activityLevel))
        setIsEditing(false)
    }

    const currentActivityLabel = ACTIVITY_LEVELS.find(a => a.value === activityLevel)?.label || 'Orta Aktif'
    const displayWeight = weekWeight || weight

    if (loading) {
        return (
            <div className="flex min-h-[55vh] items-center justify-center px-4">
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                    <span>Veriler yukleniyor...</span>
                </div>
            </div>
        )
    }

    if (patientStatus === 'pending') {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center h-[70vh] bg-white rounded-3xl shadow-sm border border-gray-100 mt-6 mx-auto max-w-3xl">
                <div className="bg-amber-100 p-6 rounded-full mb-8 relative">
                    <div className="absolute top-0 right-0 w-4 h-4 bg-amber-500 rounded-full animate-ping"></div>
                    <Info className="w-16 h-16 text-amber-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-800 mb-4">Hesabınız Onay Bekliyor</h2>
                <p className="text-gray-500 max-w-lg mx-auto mb-8 text-lg">
                    Kayıt işleminiz sistemimize başarıyla ulaştı ancak panelinize erişebilmek için diyetisyeniniz tarafından onaylanmanız gerekiyor. Onay işlemi tamamlandıktan sonra diyet planınızı görüntüleyebilirsiniz.
                </p>
                <div className="flex gap-4">
                    <Button variant="outline" size="lg" className="border-amber-200 text-amber-700 hover:bg-amber-50 rounded-xl" onClick={() => window.location.reload()}>
                        Durumu Kontrol Et
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Welcome Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                    Merhaba, {profile?.full_name?.split(' ')[0] || 'Danışan'}! 👋
                </h1>
                <p className="text-gray-500">
                    Bugün kendin için harika bir gün yaratabilirsin.
                </p>

                {showStartWarning && (
                    <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl flex items-center gap-3 mt-2 shadow-sm">
                        <Info className="h-5 w-5 shrink-0" />
                        <p className="font-medium">Programınız <strong>{planStartDate}</strong> tarihinde başlayacaktır.</p>
                    </div>
                )}

                {showEndWarning && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-center gap-3 mt-2 shadow-sm">
                        <Info className="h-5 w-5 shrink-0" />
                        <p className="font-medium">Programınız tamamlanmıştır. Geçmiş haftaları görüntülüyorsunuz.</p>
                    </div>
                )}
            </div>

            <Tabs defaultValue="overview" className="space-y-6">
                <TabsList className="flex w-full overflow-x-auto justify-start lg:justify-center mb-4 bg-gray-100/50 p-1 rounded-xl [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    <TabsTrigger value="overview" className="shrink-0 text-xs sm:text-sm rounded-lg data-[state=active]:bg-emerald-500 data-[state=active]:text-white transition-colors px-3 py-2 sm:px-4"><LayoutDashboard className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 shrink-0" />Özet</TabsTrigger>
                    <TabsTrigger value="labs" className="shrink-0 text-xs sm:text-sm rounded-lg data-[state=active]:bg-blue-500 data-[state=active]:text-white transition-colors px-3 py-2 sm:px-4"><Beaker className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 shrink-0" />Tahliller</TabsTrigger>
                    <TabsTrigger value="imaging" className="shrink-0 text-xs sm:text-sm rounded-lg data-[state=active]:bg-purple-500 data-[state=active]:text-white transition-colors px-3 py-2 sm:px-4"><Camera className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 shrink-0" />Görüntüleme</TabsTrigger>
                    <TabsTrigger value="measurements" className="shrink-0 text-xs sm:text-sm rounded-lg data-[state=active]:bg-orange-500 data-[state=active]:text-white transition-colors px-3 py-2 sm:px-4"><Ruler className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 shrink-0" />Ölçümler</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6">
                    {/* Weight & Activity Card */}
                    <Card className="border-purple-100 bg-gradient-to-br from-purple-50 to-white shadow-sm">
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg text-purple-900">Kilo & Aktivite</CardTitle>
                                    <CardDescription className="text-purple-600">
                                        Bu haftaki değerleriniz
                                    </CardDescription>
                                </div>
                                {!isEditing ? (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-purple-600 hover:bg-purple-100"
                                        onClick={() => setIsEditing(true)}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                ) : (
                                    <div className="flex gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-green-600 hover:bg-green-100"
                                            onClick={handleSaveChanges}
                                            disabled={saving}
                                        >
                                            <Save className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-gray-500 hover:bg-gray-100"
                                            onClick={handleCancelEdit}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {!isEditing ? (
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                    <div className="flex flex-col items-center p-4 bg-white rounded-xl shadow-sm border border-purple-50">
                                        <Scale className="h-6 w-6 text-purple-500 mb-2" />
                                        <span className="text-2xl font-bold text-gray-900">{displayWeight}</span>
                                        <span className="text-xs text-gray-500">kg</span>
                                    </div>
                                    <div className="flex flex-col items-center p-4 bg-white rounded-xl shadow-sm border border-purple-50">
                                        <Activity className="h-6 w-6 text-purple-500 mb-2" />
                                        <span className="text-lg font-bold text-gray-900">{currentActivityLabel}</span>
                                        <span className="text-xs text-gray-500">Aktivite Seviyesi</span>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4 mt-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="weight" className="text-purple-900">Kilo (kg)</Label>
                                        <Input
                                            id="weight"
                                            type="number"
                                            step="0.1"
                                            value={editWeight}
                                            onChange={(e) => setEditWeight(e.target.value)}
                                            className="border-purple-200 focus:border-purple-400"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="activity" className="text-purple-900">Aktivite Seviyesi</Label>
                                        <Select value={editActivity} onValueChange={setEditActivity}>
                                            <SelectTrigger className="border-purple-200">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {ACTIVITY_LEVELS.map(level => (
                                                    <SelectItem key={level.value} value={String(level.value)}>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{level.label}</span>
                                                            <span className="text-xs text-gray-500">{level.description}</span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Program & Diet Type Info Card */}
                    <Card className="border-amber-100 bg-gradient-to-br from-amber-50 to-white shadow-sm">
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg text-amber-900 flex items-center gap-2">
                                        <FileText className="h-5 w-5" />
                                        {programName || 'Diyet Programı'}
                                    </CardTitle>
                                    <CardDescription className="text-amber-600">
                                        {weekDateRange || today}
                                    </CardDescription>
                                </div>
                                <div className="bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-sm font-semibold">
                                    {weekNumber}. Hafta / {totalWeeks}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="flex flex-col gap-2 mt-2">
                                {dietType && (
                                    <div className="flex items-center gap-3 p-3 bg-white rounded-xl shadow-sm border border-amber-50">
                                        <Target className="h-5 w-5 text-amber-600" />
                                        <div>
                                            <span className="font-semibold text-gray-900">{dietType.name}</span>
                                            {dietType.description && (
                                                <p className="text-xs text-gray-500">{dietType.description}</p>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {weekTitle && (
                                    <div className="text-sm text-gray-600 px-1 font-medium">
                                        {weekTitle}
                                    </div>
                                )}
                                {dietType && (
                                    <div className="grid grid-cols-3 gap-2 text-center text-xs mt-2">
                                        <div className="bg-amber-50 rounded-lg p-2">
                                            <span className="font-bold text-amber-800">K: {dietType.carb_factor}</span>
                                            <p className="text-gray-500">g/kg</p>
                                        </div>
                                        <div className="bg-amber-50 rounded-lg p-2">
                                            <span className="font-bold text-amber-800">P: {dietType.protein_factor}</span>
                                            <p className="text-gray-500">g/kg</p>
                                        </div>
                                        <div className="bg-amber-50 rounded-lg p-2">
                                            <span className="font-bold text-amber-800">Y: {dietType.fat_factor}</span>
                                            <p className="text-gray-500">g/kg</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Today's Summary Card */}
                    <Card className="border-green-100 bg-gradient-to-br from-green-50 to-white shadow-sm">
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-lg text-green-900">{today}</CardTitle>
                                    <CardDescription className="text-green-600">
                                        {dietType ? `${dietType.name} Hedefleri` : 'Günlük Hedefler'}
                                    </CardDescription>
                                </div>
                                <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                                    <Calendar className="h-5 w-5 text-green-700" />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-3 gap-4 mt-2">
                                <div className="flex flex-col items-center p-3 bg-white rounded-xl shadow-sm border border-green-50">
                                    <Flame className="h-5 w-5 text-orange-500 mb-1" />
                                    <span className="text-lg font-bold text-gray-900">{stats.calories}</span>
                                    <span className="text-xs text-gray-500">Kcal Hedef</span>
                                </div>
                                <div className="flex flex-col items-center p-3 bg-white rounded-xl shadow-sm border border-blue-50">
                                    <Droplets className="h-5 w-5 text-blue-500 mb-1" />
                                    <span className="text-lg font-bold text-gray-900">{stats.water}L</span>
                                    <span className="text-xs text-gray-500">Su Hedefi</span>
                                </div>
                                <div className="flex flex-col items-center p-3 bg-white rounded-xl shadow-sm border border-red-50">
                                    <Utensils className="h-5 w-5 text-red-500 mb-1" />
                                    <div className="text-lg font-bold text-gray-900 flex flex-col items-center leading-none gap-1 mt-1">
                                        <span className="text-xs font-normal text-gray-400">P: {stats.protein}g</span>
                                        <span className="text-xs font-normal text-gray-400">K: {stats.carbs}g</span>
                                        <span className="text-xs font-normal text-gray-400">Y: {stats.fat}g</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Quick Actions */}
                    <div className="grid gap-4 md:grid-cols-2">
                        <Link href="/patient/plan">
                            <Card className="hover:border-green-200 transition-colors cursor-pointer h-full">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <span className="p-2 bg-blue-50 rounded-lg text-blue-600">📅</span>
                                        Diyet Planım
                                    </CardTitle>
                                    <CardDescription>
                                        Bu haftaki beslenme programını incele.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button variant="ghost" className="w-full justify-between group px-0 hover:bg-transparent">
                                        Plana Git
                                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                                    </Button>
                                </CardContent>
                            </Card>
                        </Link>

                        <Link href="/patient/meals">
                            <Card className="hover:border-green-200 transition-colors cursor-pointer h-full">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <span className="p-2 bg-orange-50 rounded-lg text-orange-600">🍽️</span>
                                        Öğün Takibi
                                    </CardTitle>
                                    <CardDescription>
                                        Yediğin öğünleri işaretle ve takip et.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button variant="ghost" className="w-full justify-between group px-0 hover:bg-transparent">
                                        Öğünleri Gör
                                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                                    </Button>
                                </CardContent>
                            </Card>
                        </Link>

                        <Link href="/patient/messages">
                            <Card className="hover:border-blue-200 transition-colors cursor-pointer h-full">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <span className="p-2 bg-purple-50 rounded-lg text-purple-600">💬</span>
                                        Mesajlar
                                    </CardTitle>
                                    <CardDescription>
                                        Diyetisyeninle iletişime geç.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Button variant="ghost" className="w-full justify-between group px-0 hover:bg-transparent">
                                        Sohbete Git
                                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                                    </Button>
                                </CardContent>
                            </Card>
                        </Link>
                    </div>
                </TabsContent>

                <TabsContent value="labs" className="space-y-6">
                    {patientId ? (
                        <LabResultsGrid patientId={patientId} readOnly={true} />
                    ) : (
                        <div className="text-center py-8 text-gray-400 italic">Hastaya ait tahlil bulunamadı.</div>
                    )}
                </TabsContent>

                <TabsContent value="imaging" className="space-y-6">
                    {patientId ? (
                        <PatientNotesEditor
                            patientId={patientId}
                            type="imaging"
                            title="Görüntüleme Tetkikleri"
                            icon={<Camera className="h-4 w-4 text-purple-600" />}
                            readOnly={true}
                            showTitle={true}
                        />
                    ) : (
                        <div className="text-center py-8 text-gray-400 italic">Görüntüleme tetkiki bulunamadı.</div>
                    )}
                </TabsContent>

                <TabsContent value="measurements" className="flex-1 flex flex-col min-h-[400px] mt-0 data-[state=active]:flex">
                    {patientId ? (
                        <PatientMeasurements patientId={patientId} readOnly={false} />
                    ) : (
                        <div className="text-center py-8 text-gray-400 italic">Ölçüm verisi bulunamadı.</div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    )
}
