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
                id, status, weight, height, birth_date, gender, activity_level, patient_goals, visibility_settings,
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
        <div className="space-y-6 pb-24">
            {/* Welcome Section - Premium Gradient & Glassmorphism */}
            <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-emerald-600 via-teal-500 to-emerald-900 p-8 text-white shadow-2xl shadow-emerald-900/20 mt-2">
                {/* Decorative Elements */}
                <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute -left-10 -bottom-10 h-48 w-48 rounded-full bg-teal-400/20 blur-2xl" />
                
                <div className="relative z-10">
                    <p className="text-sm font-semibold tracking-wide text-emerald-100/90 uppercase">{today}</p>
                    <h1 className="text-3xl font-extrabold mt-2 tracking-tight leading-tight">
                        Merhaba, {profile?.full_name?.split(' ')[0] || 'Danışan'}! 👋
                    </h1>
                    <div className="mt-4 flex items-center gap-2 bg-black/10 w-fit px-4 py-2 rounded-full border border-white/10 backdrop-blur-md">
                        <Flame className="h-4 w-4 text-emerald-300" />
                        <p className="text-sm font-medium text-emerald-50">
                            {dietType?.name || 'Sağlıklı Beslenme'} • <span className="text-white font-bold">{weekNumber}. Hafta</span>
                        </p>
                    </div>
                </div>

                {showStartWarning && (
                    <div className="relative z-10 bg-white/10 border border-white/20 text-white px-5 py-4 rounded-2xl flex items-start gap-3 mt-6 shadow-lg backdrop-blur-md">
                        <Info className="h-6 w-6 shrink-0 text-emerald-200" />
                        <p className="font-medium text-sm leading-relaxed">Programınız <strong>{planStartDate}</strong> tarihinde başlayacaktır.</p>
                    </div>
                )}

                {showEndWarning && (
                    <div className="relative z-10 bg-amber-500/20 border border-amber-400/30 text-white px-5 py-4 rounded-2xl flex items-start gap-3 mt-6 shadow-lg backdrop-blur-md">
                        <Info className="h-6 w-6 shrink-0 text-amber-200" />
                        <p className="font-medium text-sm leading-relaxed">Programınız tamamlanmıştır. Geçmiş haftaları görüntülüyorsunuz.</p>
                    </div>
                )}
            </div>

            {/* Giant "Bugün Ne Yemeliyim?" CTA - Hero Interaction */}
            <div className="pt-2">
                <Link href="/patient/plan" className="block group">
                    <div className="relative overflow-hidden bg-white rounded-[2.5rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 transform group-hover:-translate-y-1">
                        {/* Dynamic Background Pattern */}
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-purple-50/50 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                        
                        <div className="relative z-10 flex items-center justify-between">
                            <div className="flex items-center gap-5">
                                <div className="h-16 w-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 group-hover:scale-110 transition-transform duration-500">
                                    <Utensils className="h-8 w-8 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">Bugün Ne Yemeliyim?</h2>
                                    <p className="text-gray-500 font-medium mt-1">Öğünlerini ve planını gör</p>
                                </div>
                            </div>
                            <div className="bg-gray-50 p-4 rounded-full group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors duration-300">
                                <ArrowRight className="h-6 w-6 text-gray-400 group-hover:text-indigo-600 transition-colors" />
                            </div>
                        </div>
                    </div>
                </Link>
            </div>

            {/* Stats & Info Grid */}
            <div className="grid grid-cols-1 gap-6">
                
                {/* Today's Target Stats */}
                <Card className="rounded-[2rem] border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
                    <CardHeader className="border-b border-gray-50 bg-gray-50/30 pb-4 pt-6 px-6">
                        <CardTitle className="text-base font-bold text-gray-800 flex items-center gap-2">
                            <Target className="h-5 w-5 text-indigo-500" />
                            Günlük Hedeflerin
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-8 px-6 pb-8">
                        <div className="flex flex-col md:flex-row items-center gap-8">
                            {/* Calorie Ring */}
                            <div className="relative w-40 h-40 shrink-0">
                                <svg className="w-full h-full -rotate-90 drop-shadow-md" viewBox="0 0 120 120">
                                    <defs>
                                        <linearGradient id="calorieGradientPremium" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stopColor="#818cf8" />
                                            <stop offset="100%" stopColor="#4f46e5" />
                                        </linearGradient>
                                    </defs>
                                    <circle cx="60" cy="60" r="52" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                                    <circle cx="60" cy="60" r="52" fill="none" stroke="url(#calorieGradientPremium)"
                                        strokeWidth="8" strokeLinecap="round"
                                        strokeDasharray={`${2 * Math.PI * 52}`}
                                        strokeDashoffset="0" 
                                        className="animate-[dash_1.5s_ease-out_forwards]"
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-4xl font-extrabold text-gray-900 tracking-tight">{stats.calories}</span>
                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">KCAL</span>
                                </div>
                            </div>

                            {/* Macros */}
                            <div className="flex-1 w-full space-y-5">
                                {[
                                    { label: 'Protein', value: stats.protein, gradient: 'from-blue-400 to-blue-600', bg: 'bg-blue-50' },
                                    { label: 'Karb.', value: stats.carbs, gradient: 'from-amber-400 to-amber-600', bg: 'bg-amber-50' },
                                    { label: 'Yağ', value: stats.fat, gradient: 'from-rose-400 to-rose-600', bg: 'bg-rose-50' },
                                ].map(m => (
                                    <div key={m.label} className="group">
                                        <div className="flex justify-between text-sm font-semibold mb-2">
                                            <span className="text-gray-600">{m.label}</span>
                                            <span className="text-gray-900">{m.value}g</span>
                                        </div>
                                        <div className={`h-3 ${m.bg} rounded-full overflow-hidden shadow-inner`}>
                                            <div className={`h-full bg-gradient-to-r ${m.gradient} rounded-full transition-all duration-1000 ease-out`} style={{width: '100%'}} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Water Goal */}
                        <div className="mt-8 bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100/50 rounded-[1.5rem] p-5 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-4">
                                <div className="bg-white p-3 rounded-2xl shadow-sm">
                                    <Droplets className="h-6 w-6 text-blue-500" />
                                </div>
                                <div>
                                    <span className="text-sm font-bold text-blue-900 block">Günlük Su İhtiyacı</span>
                                    <span className="text-xs font-medium text-blue-600/80">Hedeflenen miktar</span>
                                </div>
                            </div>
                            <span className="text-2xl font-extrabold text-blue-700">{stats.water}L</span>
                        </div>
                    </CardContent>
                </Card>

                {/* Weight & Activity Settings */}
                <Card className="rounded-[2rem] border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
                    <CardHeader className="bg-gray-50/30 pb-4 pt-6 px-6 flex flex-row items-center justify-between border-b border-gray-50">
                        <CardTitle className="text-base font-bold text-gray-800">Değerlerin</CardTitle>
                        {!isEditing ? (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 px-4 rounded-xl text-indigo-600 hover:bg-indigo-50 font-semibold"
                                onClick={() => setIsEditing(true)}
                            >
                                <Pencil className="h-4 w-4 mr-2" />
                                Düzenle
                            </Button>
                        ) : (
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 w-9 p-0 rounded-xl text-gray-500 hover:bg-gray-100"
                                    onClick={handleCancelEdit}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                                <Button
                                    size="sm"
                                    className="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm"
                                    onClick={handleSaveChanges}
                                    disabled={saving}
                                >
                                    <Save className="h-4 w-4 mr-2" />
                                    {saving ? '...' : 'Kaydet'}
                                </Button>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="pt-6 px-6 pb-6">
                        {!isEditing ? (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-1 p-4 bg-gray-50 rounded-[1.5rem] border border-gray-100/50">
                                    <span className="text-xs font-semibold text-gray-500 flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" /> Kilon</span>
                                    <span className="text-2xl font-extrabold text-gray-900 mt-1">{displayWeight} <span className="text-sm font-semibold text-gray-400">kg</span></span>
                                </div>
                                <div className="flex flex-col gap-1 p-4 bg-gray-50 rounded-[1.5rem] border border-gray-100/50">
                                    <span className="text-xs font-semibold text-gray-500 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Aktivite</span>
                                    <span className="text-lg font-extrabold text-gray-900 mt-1 leading-tight">{currentActivityLabel}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-5">
                                <div className="space-y-2">
                                    <Label htmlFor="weight" className="text-gray-700 font-semibold text-sm ml-1">Kilo (kg)</Label>
                                    <Input
                                        id="weight"
                                        type="number"
                                        step="0.1"
                                        value={editWeight}
                                        onChange={(e) => setEditWeight(e.target.value)}
                                        className="border-gray-200 focus:border-indigo-400 h-12 rounded-xl px-4 text-base font-medium shadow-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="activity" className="text-gray-700 font-semibold text-sm ml-1">Aktivite Seviyesi</Label>
                                    <Select value={editActivity} onValueChange={setEditActivity}>
                                        <SelectTrigger className="border-gray-200 h-12 rounded-xl px-4 font-medium shadow-sm focus:ring-indigo-400">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl">
                                            {ACTIVITY_LEVELS.map(level => (
                                                <SelectItem key={level.value} value={String(level.value)} className="rounded-lg py-3">
                                                    <div className="flex flex-col">
                                                        <span className="font-semibold">{level.label}</span>
                                                        <span className="text-xs text-gray-500 mt-0.5">{level.description}</span>
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

                {/* Program Info */}
                <Card className="rounded-[2rem] border-amber-100/50 shadow-[0_8px_30px_rgb(0,0,0,0.03)] bg-gradient-to-br from-amber-50/30 to-white overflow-hidden">
                    <CardContent className="p-6">
                        <div className="flex flex-col">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <div className="bg-amber-100 p-2.5 rounded-xl text-amber-600">
                                        <FileText className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <span className="font-bold text-gray-900 text-sm block">{programName || 'Diyet Programı'}</span>
                                        <span className="text-xs font-medium text-amber-700/80">{weekDateRange || today}</span>
                                    </div>
                                </div>
                                <div className="bg-amber-100/80 text-amber-800 px-3 py-1.5 rounded-xl border border-amber-200/50 text-xs font-extrabold shadow-sm">
                                    {weekNumber}/{totalWeeks}. Hf
                                </div>
                            </div>
                            
                            {(dietType || weekTitle) && (
                                <div className="bg-white rounded-[1.5rem] p-4 shadow-sm border border-amber-50">
                                    {dietType && (
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5">
                                                <Target className="h-4 w-4 text-amber-500" />
                                            </div>
                                            <div>
                                                <span className="font-bold text-gray-900 text-sm block">{dietType.name}</span>
                                                {dietType.description && (
                                                    <span className="text-xs text-gray-500 font-medium leading-relaxed block mt-1">{dietType.description}</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {weekTitle && (
                                        <div className={cn("text-xs text-gray-600 font-semibold", dietType && "mt-3 pt-3 border-t border-gray-100")}>
                                            {weekTitle}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
