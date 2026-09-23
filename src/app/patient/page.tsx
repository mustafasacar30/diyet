"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowRight, Calendar, Droplets, Flame, Utensils, Scale, Activity, Save, Pencil, X, FileText, Target, Info, Loader2 } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
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
    const router = useRouter()
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
    const [canUseAI, setCanUseAI] = useState(false)

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
        let shouldStopLoading = true;
        try {
            const targetId = profile?.id || user?.id
            console.log("📍🛡 Dashboard: Looking for patient with ID:", targetId)

            if (!targetId) {
                setLoading(false)
                return
            }

            // Smart patient lookup (same as plan/page.tsx)
            // Priority 1: user_id match (legacy patients like HACER with existing plans)
            // Priority 2: id match (new patients created via portal)
            const patientQueryStr = `
                id, status, weight, height, birth_date, gender, activity_level, patient_goals, visibility_settings, preferences,
                program_templates (
                    id, name, default_activity_level,
                    program_template_weeks (week_start, week_end, diet_type_id)
                )
            `

            const [
                { data: legacyMatch },
                { data: directMatch }
            ] = await Promise.all([
                supabase.from('patients').select(patientQueryStr).eq('user_id', targetId).neq('id', targetId).limit(1).maybeSingle(),
                supabase.from('patients').select(patientQueryStr).eq('id', targetId).maybeSingle()
            ])

            let patientRecord = legacyMatch || directMatch
            
            if (legacyMatch) {
                console.log("📍🛡 Dashboard: Found legacy patient via user_id:", patientRecord?.id)
            } else if (directMatch) {
                console.log("📍🛡 Dashboard: Found patient via id:", patientRecord?.id)
            }

            if (!patientRecord) {
                console.error("Patient not found for targetId:", targetId)
                shouldStopLoading = false;
                router.replace('/register')
                return
            }

            // Also check here to avoid a split-second flicker of "Onay Bekliyor"
            if (!patientRecord.weight) {
                console.log("📍❓ Incomplete profile detected, redirecting to registration.")
                shouldStopLoading = false;
                router.replace('/register?complete=true')
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

            // Sera (AI Asistan) izin kontrolü
            const prefs = (patient as any).preferences || {}
            const patientAllowAI = prefs.allow_ai_rule_assistant
            if (patientAllowAI === true) {
                setCanUseAI(true)
            } else if (patientAllowAI === false) {
                setCanUseAI(false)
            } else {
                // null veya undefined = global ayarı kontrol et
                const { data: globalRow } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('key', 'registration_settings')
                    .maybeSingle()
                setCanUseAI(Boolean(globalRow?.value?.allow_ai_rule_assistant))
            }

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
                const [
                    { data: baseType },
                    { data: overrideType }
                ] = await Promise.all([
                    supabase.from('diet_types').select('*').eq('id', targetDietTypeId).single(),
                    supabase.from('diet_types').select('*').eq('patient_id', patient.id).eq('parent_diet_type_id', targetDietTypeId).maybeSingle()
                ])

                if (baseType) {
                    resolvedDietType = overrideType || baseType
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
            if (shouldStopLoading) {
                setLoading(false)
            }
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
        <div className="space-y-2 pb-24">
            {/* Welcome Header + Program Info — merged */}
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 shadow-sm mt-1">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-semibold tracking-wide text-emerald-500 uppercase">{today}</p>
                        <h1 className="text-lg font-bold text-emerald-800 tracking-tight">
                            Merhaba, {profile?.full_name?.split(' ')[0] || 'Danışan'}! 👋
                        </h1>
                    </div>
                </div>
                {/* Program info inline */}
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                        <Flame className="h-3 w-3 text-emerald-600" />
                        <span className="text-[10px] font-medium text-emerald-700">
                            {dietType?.name || 'Sağlıklı Beslenme'}
                        </span>
                    </div>
                    <div className="flex items-center gap-1 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-200">
                        <Calendar className="h-3 w-3 text-emerald-600" />
                        <span className="text-[10px] font-bold text-emerald-700">{weekNumber}/{totalWeeks}. Hafta</span>
                    </div>
                    {weekDateRange && (
                        <span className="text-[10px] text-emerald-500">{weekDateRange}</span>
                    )}
                </div>

                {showStartWarning && (
                    <div className="bg-emerald-100 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-lg flex items-start gap-2 mt-2">
                        <Info className="h-3.5 w-3.5 shrink-0 text-emerald-600 mt-0.5" />
                        <p className="font-medium text-[11px] leading-relaxed">Programınız <strong>{planStartDate}</strong> tarihinde başlayacaktır.</p>
                    </div>
                )}

                {showEndWarning && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg flex items-start gap-2 mt-2">
                        <Info className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
                        <p className="font-medium text-[11px] leading-relaxed">Programınız tamamlanmıştır.</p>
                    </div>
                )}
            </div>

            {/* Main CTA — Bugün Ne Yemeliyim */}
            <Link href="/patient/plan" className="block group">
                <div className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 hover:shadow-md transition-all flex items-center gap-2.5">
                    <div className="h-9 w-9 bg-emerald-500 rounded-lg flex items-center justify-center shadow-sm shrink-0">
                        <Utensils className="h-4 w-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-[13px] font-bold text-gray-900">Bugün Ne Yemeliyim?</h2>
                        <p className="text-[10px] text-gray-400 font-medium">Öğünlerini ve planını gör</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-gray-300 shrink-0 group-hover:text-emerald-500 transition-colors" />
                </div>
            </Link>

            {/* Günlük Hedefler — compact inline */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                    <Target className="h-3 w-3 text-emerald-500" />
                    <span className="text-[11px] font-bold text-gray-800">Günlük Hedeflerin</span>
                </div>
                <div className="flex items-center gap-3">
                    {/* Calorie Ring */}
                    <div className="relative w-16 h-16 shrink-0">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                            <defs>
                                <linearGradient id="calorieGradientPremium" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#34d399" />
                                    <stop offset="100%" stopColor="#059669" />
                                </linearGradient>
                            </defs>
                            <circle cx="60" cy="60" r="52" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                            <circle cx="60" cy="60" r="52" fill="none" stroke="url(#calorieGradientPremium)"
                                strokeWidth="10" strokeLinecap="round"
                                strokeDasharray={`${2 * Math.PI * 52}`}
                                strokeDashoffset="0"
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-sm font-extrabold text-gray-900">{stats.calories}</span>
                            <span className="text-[8px] font-bold text-gray-400 uppercase">KCAL</span>
                        </div>
                    </div>

                    {/* Macros */}
                    <div className="flex-1 space-y-2">
                        {[
                            { label: 'Protein', value: stats.protein, color: 'bg-blue-500', bg: 'bg-blue-100' },
                            { label: 'Karb.', value: stats.carbs, color: 'bg-amber-500', bg: 'bg-amber-100' },
                            { label: 'Yağ', value: stats.fat, color: 'bg-rose-500', bg: 'bg-rose-100' },
                        ].map(m => (
                            <div key={m.label}>
                                <div className="flex justify-between text-[11px] font-semibold mb-0.5">
                                    <span className="text-gray-500">{m.label}</span>
                                    <span className="text-gray-800">{m.value}g</span>
                                </div>
                                <div className={`h-1.5 ${m.bg} rounded-full overflow-hidden`}>
                                    <div className={`h-full ${m.color} rounded-full`} style={{width: '100%'}} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Water */}
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <Droplets className="h-4 w-4 text-blue-500" />
                        <span className="text-xs font-extrabold text-blue-700">{stats.water}L</span>
                        <span className="text-[8px] text-blue-400 font-semibold">SU</span>
                    </div>
                </div>
            </div>

            {/* Bilgilerini Güncelle — merged values + edit */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-gray-800">Bilgilerin</span>
                    {!isEditing ? (
                        <button
                            className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1 hover:text-emerald-700"
                            onClick={() => setIsEditing(true)}
                        >
                            <Pencil className="h-3 w-3" /> Düzenle
                        </button>
                    ) : (
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded text-gray-500" onClick={handleCancelEdit}>
                                <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" className="h-7 px-2.5 rounded bg-emerald-600 text-white text-[11px] font-semibold" onClick={handleSaveChanges} disabled={saving}>
                                <Save className="h-3 w-3 mr-1" />{saving ? '...' : 'Kaydet'}
                            </Button>
                        </div>
                    )}
                </div>
                {!isEditing ? (
                    <div className="flex items-center gap-3">
                        <div className="flex-1 flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100/50">
                            <Scale className="h-3.5 w-3.5 text-gray-400" />
                            <div>
                                <span className="text-[10px] text-gray-400 block">Kilo</span>
                                <span className="text-sm font-bold text-gray-900">{displayWeight} kg</span>
                            </div>
                        </div>
                        <div className="flex-1 flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100/50">
                            <Activity className="h-3.5 w-3.5 text-gray-400" />
                            <div>
                                <span className="text-[10px] text-gray-400 block">Aktivite</span>
                                <span className="text-sm font-bold text-gray-900">{currentActivityLabel}</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="weight" className="text-gray-700 font-semibold text-[11px]">Kilo (kg)</Label>
                            <Input id="weight" type="number" step="0.1" value={editWeight} onChange={(e) => setEditWeight(e.target.value)}
                                className="border-gray-200 focus:border-emerald-400 h-9 rounded-lg px-3 text-sm font-medium" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="activity" className="text-gray-700 font-semibold text-[11px]">Aktivite Seviyesi</Label>
                            <Select value={editActivity} onValueChange={setEditActivity}>
                                <SelectTrigger className="border-gray-200 h-9 rounded-lg px-3 font-medium focus:ring-emerald-400">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="rounded-lg">
                                    {ACTIVITY_LEVELS.map(level => (
                                        <SelectItem key={level.value} value={String(level.value)} className="rounded-md py-2">
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-sm">{level.label}</span>
                                                <span className="text-xs text-gray-500">{level.description}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}
            </div>

            {/* Sera Tanıtım Kartı — yeşil tema */}
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm">
                <div className="p-3">
                    <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
                            <span className="text-sm">🌿</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-[12px] font-bold text-gray-900">Sera — Beslenme Asistanın</h3>
                            <p className="text-[10px] text-gray-500 leading-snug">
                                İsteklerini belirt, listelerin sana özel hazırlansın.
                            </p>
                        </div>
                    </div>

                    {/* Sera'nın Önerileri — her açılışta değişir */}
                    <div className="mt-2 flex flex-wrap gap-1">
                        {(typeof window !== 'undefined' ? (() => {
                            const tips = [
                                'Yumurtalı tariflere daha çok yer ver',
                                'Akşam öğünlerinde ekmek daha fazla olsun',
                                'Enginar sevmem, listelere ekleme',
                                'Süt ürünlerini azalt',
                                'Kızartma olmasın',
                                'Balık haftada 2 kez olsun',
                                'Sebze ağırlıklı akşamlar istiyorum',
                                'Kuruyemiş ara öğünlerde olsun',
                                'Çeşitlilik çok olsun tekrar az olsun',
                                'Hafif akşam yemeği tercih ederim',
                                'Pratik hazırlanabilir yemekler olsun',
                                'Baklagil protein kaynağı olarak ekle',
                            ]
                            return tips.sort(() => Math.random() - 0.5).slice(0, 3)
                        })() : ['Yumurtalı tariflere yer ver', 'Kızartma olmasın', 'Balık haftada 2 kez']).map((tip, i) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white text-emerald-700 border border-emerald-200">
                                &ldquo;{tip}&rdquo;
                            </span>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                        <Link href="/patient/assistant" className="flex-1">
                            <div className="bg-emerald-600 text-white text-[10px] font-bold py-1.5 px-3 rounded-lg text-center shadow-sm hover:bg-emerald-700 transition-all">
                                Sera ile Konuş
                            </div>
                        </Link>
                        <Link href="/patient/preferences" className="shrink-0">
                            <div className="bg-white text-emerald-600 text-[10px] font-semibold py-1.5 px-2.5 rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-all">
                                Tercihlerimi Ayarla
                            </div>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Yemek Tercihlerim Kartı */}
            <Link href="/patient/preferences" className="block">
                <div className="rounded-xl bg-amber-50 border border-amber-200 shadow-sm p-3 flex items-center gap-3 hover:bg-amber-100/60 transition-colors">
                    <div className="h-8 w-8 bg-amber-500 rounded-lg flex items-center justify-center shrink-0">
                        <span className="text-sm">⭐</span>
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-[12px] font-bold text-gray-900">Yemek Tercihlerim</h3>
                        <p className="text-[10px] text-gray-500 leading-snug">
                            Hangi yemekleri daha çok veya az istediğini belirle
                        </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-amber-400 shrink-0" />
                </div>
            </Link>
        </div>
    )
}
