"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MultiSelectCreatable, Option } from "@/components/ui/multi-select-creatable"
import { Loader2, Save, User, Activity, AlertCircle, Info } from "lucide-react"

export default function PatientSettingsPage() {
    const { user, profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    // Permissions State
    const [canEditProgram, setCanEditProgram] = useState(false)
    const [canEditGoals, setCanEditGoals] = useState(false)
    const [canDeleteWeek, setCanDeleteWeek] = useState(false)

    // Lookup Data
    const [programs, setPrograms] = useState<{ id: string, name: string, program_template_weeks?: any[] }[]>([])

    // Form State
    const [patientId, setPatientId] = useState<string | null>(null)
    const [formData, setFormData] = useState({
        full_name: "",
        height: "",
        weight: "",
        gender: "male",
        activity_level: "3",
        liked_foods: "",
        disliked_foods: "",
        program_template_id: "none",
        patient_goals: [] as Option[]
    })

    const GOAL_OPTIONS: Option[] = [
        { id: "Kilo Vermek", name: "Kilo Vermek" },
        { id: "Kilo Almak", name: "Kilo Almak" },
        { id: "Kilo Korumak", name: "Kilo Korumak" },
        { id: "Detoks", name: "Detoks" },
        { id: "Eliminasyon", name: "Eliminasyon" },
        { id: "Lipödem Beslenmesi", name: "Lipödem Beslenmesi" },
        { id: "Gebelik Beslenmesi", name: "Gebelik Beslenmesi" },
        { id: "Emzirme Beslenmesi", name: "Emzirme Beslenmesi" },
        { id: "Kas Gelişimi (Hipertrofi)", name: "Kas Gelişimi (Hipertrofi)" },
        { id: "Sağlıklı Yaşam", name: "Sağlıklı Yaşam" },
        { id: "Sporcu Beslenmesi", name: "Sporcu Beslenmesi" }
    ]

    useEffect(() => {
        if (user || profile) {
            loadPatientProfile()
        }
    }, [user, profile])

    const loadPatientProfile = async () => {
        try {
            setLoading(true)
            const targetId = profile?.id || user?.id
            if (!targetId) return

            // 1. Fetch Global Settings
            let globalAllowProgram = false
            let globalAllowGoal = false
            let globalAllowWeekDelete = false

            const scopeCtx = await resolveTeamScopeContextFromAuth()
            const teamModeActive = !!scopeCtx.teamOwnerId && !scopeCtx.canUseGlobal
            const settingsKey = teamModeActive
                ? `registration_settings__team_${scopeCtx.teamOwnerId}`
                : 'registration_settings'

            let settingsValue: any = null
            const { data: settingsData } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', settingsKey)
                .maybeSingle()

            if (settingsData?.value) {
                settingsValue = settingsData.value
            } else if (teamModeActive) {
                const { data: fallbackData } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('key', 'registration_settings')
                    .maybeSingle()
                if (fallbackData?.value) settingsValue = fallbackData.value
            }

            if (!settingsValue) {
                const { data: legacyData } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('id', 'registration_settings')
                    .maybeSingle()
                if (legacyData?.value) settingsValue = legacyData.value
            }

            if (settingsValue) {
                globalAllowProgram = !!settingsValue.allow_program_selection
                globalAllowGoal = !!settingsValue.allow_goal_selection
                globalAllowWeekDelete = !!settingsValue.allow_week_delete
            }

            // 2. Fetch Programs
            const { data: progData } = await supabase
                .from('program_templates')
                .select('id, name')
                .eq('is_active', true)
                .order('name')

            if (progData) setPrograms(progData)

            // 3. Fetch Patient
            const { data: patient, error: pError } = await supabase
                .from('patients')
                .select('id, full_name, height, weight, gender, activity_level, liked_foods, disliked_foods, program_template_id, patient_goals, preferences, program_templates(name)')
                .or(`id.eq.${targetId},user_id.eq.${targetId}`)
                .maybeSingle()

            if (pError || !patient) {
                setError("Kullanıcı profili bulunamadı.")
                setLoading(false)
                return
            }

            setPatientId(patient.id)

            // 4. Resolve Permissions
            const prefs = patient.preferences || {}
            setCanEditProgram(prefs.allow_program_selection !== undefined ? prefs.allow_program_selection : globalAllowProgram)
            setCanEditGoals(prefs.allow_goal_selection !== undefined ? prefs.allow_goal_selection : globalAllowGoal)
            setCanDeleteWeek(prefs.allow_week_delete !== undefined ? prefs.allow_week_delete : globalAllowWeekDelete)

            // 5. Populate Form
            const goalsArray = patient.patient_goals || []
            const goalOptions = goalsArray.map((g: string) => ({ id: g, name: g }))

            setFormData({
                full_name: patient.full_name || "",
                height: patient.height?.toString() || "",
                weight: patient.weight?.toString() || "",
                gender: patient.gender || "male",
                activity_level: patient.activity_level?.toString() || "3",
                liked_foods: patient.liked_foods ? patient.liked_foods.join(", ") : "",
                disliked_foods: patient.disliked_foods ? patient.disliked_foods.join(", ") : "",
                program_template_id: patient.program_template_id || "none",
                patient_goals: goalOptions
            })

            // If program is hidden and none selected, but a relation exists, maybe set a dummy one just for display
            if (!patient.program_template_id && patient.program_templates) {
                // Read-only display purpose handled by a separate variable if needed, but keeping simple for now
            }

        } catch (e: any) {
            console.error(e)
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        if (!patientId) return

        setSaving(true)
        setError(null)
        setSuccess(null)

        try {
            const likedArray = formData.liked_foods
                ? formData.liked_foods.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
                : []
            const dislikedArray = formData.disliked_foods
                ? formData.disliked_foods.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
                : []

            // We only update program/goals if they have permission OR if we just send back what was already there
            const updatePayload: any = {
                full_name: formData.full_name,
                height: formData.height ? parseFloat(formData.height) : null,
                weight: formData.weight ? parseFloat(formData.weight) : null,
                gender: formData.gender,
                activity_level: parseInt(formData.activity_level),
                liked_foods: likedArray,
                disliked_foods: dislikedArray
            }

            if (canEditProgram) {
                updatePayload.program_template_id = formData.program_template_id === "none" ? null : formData.program_template_id
            }

            if (canEditGoals) {
                updatePayload.patient_goals = formData.patient_goals.map(g => g.name)
            }

            const { error: updateError } = await supabase
                .from('patients')
                .update(updatePayload)
                .eq('id', patientId)

            if (updateError) throw updateError

            // Retroactive Program Phase Update Logic
            if (canEditProgram && formData.program_template_id !== "none") {
                // Fetch existing patient profile to compare old program
                const { data: currentPatient } = await supabase
                    .from('patients')
                    .select('program_template_id')
                    .eq('id', patientId)
                    .single()

                // If program actually changed or we just want to enforce it
                // Actually, since we already updated the patient table above, we can just apply the rules of the selected program
                // to the existing weeks if they confirm
                if (window.confirm("Seçtiğiniz yeni programın aşamalarını (diyet türlerini) mevcut diyet haftalarınıza uygulamak ister misiniz?\n\n(Eğer evet derseniz, şu anki planınız yeni programın kurallarına göre güncellenecektir.)")) {
                    const selectedProgram = programs.find((p: any) => p.id === formData.program_template_id)

                    if (selectedProgram) {
                        // 1. Get Active Plan
                        const { data: activePlan } = await supabase
                            .from('diet_plans')
                            .select('id')
                            .eq('patient_id', patientId)
                            .eq('status', 'active')
                            .maybeSingle()

                        if (activePlan) {
                            // 2. Get Weeks
                            const { data: existingWeeks } = await supabase
                                .from('diet_weeks')
                                .select('id, week_number')
                                .eq('diet_plan_id', activePlan.id)

                            if (existingWeeks && existingWeeks.length > 0) {
                                const rules = selectedProgram.program_template_weeks || []

                                if (rules.length > 0) {
                                    for (const week of existingWeeks) {
                                        const wNum = Number(week.week_number)
                                        const rule = rules.find((w: any) =>
                                            wNum >= Number(w.week_start) && wNum <= Number(w.week_end)
                                        )

                                        if (rule?.diet_type_id) {
                                            await supabase
                                                .from('diet_weeks')
                                                .update({ assigned_diet_type_id: rule.diet_type_id })
                                                .eq('id', week.id)
                                        }
                                    }
                                } else {
                                    // FALLBACK: If the program has NO rules defined, we should not leave the old program's diets intact.
                                    // We fetch a default/global diet type and assign it to wipe out the old program phases.
                                    console.log("No rules found for new program, applying fallback diet type")
                                    const { data: fallbackType } = await supabase
                                        .from('diet_types')
                                        .select('id')
                                        .is('patient_id', null)
                                        .limit(1)
                                        .maybeSingle()

                                    if (fallbackType) {
                                        for (const week of existingWeeks) {
                                            await supabase
                                                .from('diet_weeks')
                                                .update({ assigned_diet_type_id: fallbackType.id })
                                                .eq('id', week.id)
                                        }
                                        alert("Lütfen dikkat: Seçtiğiniz programda tanımlı hiçbir aşama (kural) bulunmadığı için mevcut diyet haftalarınız varsayılan bir protokole geçirilmiştir.")
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Sync weight/activity to active week
            if (updatePayload.weight && updatePayload.activity_level) {
                const { syncPatientWeightAndActivity } = await import('@/utils/measurement-sync')
                await syncPatientWeightAndActivity(supabase, patientId, updatePayload.weight, updatePayload.activity_level, null)
            }

            setSuccess("Profiliniz başarıyla güncellendi.")

            let isReloading = false
            if (canEditProgram) {
                isReloading = true
            }

            // Clear success message after 3 seconds or reload
            setTimeout(() => {
                if (isReloading || canEditProgram || canEditGoals) {
                    window.location.reload()
                } else {
                    setSuccess(null)
                }
            }, 1000)

        } catch (e: any) {
            console.error(e)
            setError(e.message || "Kaydetme sırasında bir hata oluştu.")
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-green-600" />
            </div>
        )
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6 pb-20">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Ayarlar</h1>
                <p className="text-gray-500 text-sm">Profil bilgilerinizi ve uygulamaya dair tercihlerinizi yönetin.</p>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-start gap-3 text-sm">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                    <div>{error}</div>
                </div>
            )}

            {success && (
                <div className="bg-green-50 text-green-700 p-4 rounded-lg text-sm font-medium border border-green-200">
                    {success}
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <User className="h-5 w-5 text-gray-500" />
                        Kişisel Bilgiler
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <Label>Ad Soyad</Label>
                        <Input
                            value={formData.full_name}
                            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label>Boy (cm)</Label>
                            <Input
                                type="number"
                                value={formData.height}
                                onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Kilo (kg)</Label>
                            <Input
                                type="number"
                                value={formData.weight}
                                onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <Label>Cinsiyet</Label>
                            <Select
                                value={formData.gender}
                                onValueChange={(val) => setFormData({ ...formData, gender: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="male">Erkek</SelectItem>
                                    <SelectItem value="female">Kadın</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Aktivite Seviyesi</Label>
                            <Select
                                value={formData.activity_level}
                                onValueChange={(val) => setFormData({ ...formData, activity_level: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
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
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <Activity className="h-5 w-5 text-gray-500" />
                        Beslenme Programı ve Hedefler
                    </CardTitle>
                    <CardDescription>
                        Uygulamanın sizin için oluşturacağı diyet planlarının temelini oluşturur.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* PROGRAM SELECTION */}
                    <div className="space-y-2">
                        <Label>Program Şablonu</Label>
                        {canEditProgram ? (
                            <Select
                                value={formData.program_template_id}
                                onValueChange={(val) => setFormData({ ...formData, program_template_id: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Bir program seçiniz" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Program Seçilmedi</SelectItem>
                                    {programs.map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="p-3 bg-gray-50 border rounded-md text-sm flex flex-col gap-2 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                <div className="font-medium text-gray-900">
                                    {programs.find(p => p.id === formData.program_template_id)?.name || "Program Belirlenmedi"}
                                </div>
                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                    <Info className="h-3 w-3" />
                                    Program değişikliği için diyetisyeninizle iletişime geçin.
                                </div>
                            </div>
                        )}
                    </div>

                    {/* GOALS SELECTION */}
                    <div className="space-y-2">
                        <Label>Hedefler</Label>
                        {canEditGoals ? (
                            <MultiSelectCreatable
                                options={GOAL_OPTIONS}
                                selected={formData.patient_goals}
                                onChange={(newGoals) => setFormData({ ...formData, patient_goals: newGoals })}
                                placeholder="Hedeflerinizi seçin..."
                            />
                        ) : (
                            <div className="p-3 bg-gray-50 border rounded-md min-h-[42px] flex flex-wrap gap-2 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                {formData.patient_goals.length > 0 ? (
                                    formData.patient_goals.map((g, i) => (
                                        <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                            {g.name}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-sm text-gray-500">Hedef belirlenmedi.</span>
                                )}
                                <div className="w-full text-xs text-gray-500 flex items-center gap-1 mt-1">
                                    <Info className="h-3 w-3" />
                                    Hedeflerinizi değiştirmek için diyetisyeninizle görüşün.
                                </div>
                            </div>
                        )}
                    </div>

                    {/* PREFERENCES */}
                    <div className="space-y-4 pt-4 border-t">
                        <div className="space-y-1">
                            <Label>Sevilen Yemekler (Virgülle ayırın)</Label>
                            <Textarea
                                placeholder="Örn: Tavuk, Ispanak..."
                                value={formData.liked_foods}
                                onChange={(e) => setFormData({ ...formData, liked_foods: e.target.value })}
                                className="resize-none"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Sevilmeyen Yemekler (Virgülle ayırın)</Label>
                            <Textarea
                                placeholder="Örn: Pırasa, Süt..."
                                value={formData.disliked_foods}
                                onChange={(e) => setFormData({ ...formData, disliked_foods: e.target.value })}
                                className="resize-none"
                            />
                        </div>
                    </div>

                    {/* PERMISSIONS (Read-Only) */}
                    <div className="space-y-4 pt-4 border-t">
                        <Label>Hesap Yetkilendirme Durumu</Label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-3 bg-gray-50 border rounded-md flex flex-col items-center justify-center text-center gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase">Program Seçimi</span>
                                <span className={cn("text-sm font-bold", canEditProgram ? "text-green-600" : "text-gray-400")}>
                                    {canEditProgram ? "Açık" : "Kapalı"}
                                </span>
                            </div>
                            <div className="p-3 bg-gray-50 border rounded-md flex flex-col items-center justify-center text-center gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase">Hedef Seçimi</span>
                                <span className={cn("text-sm font-bold", canEditGoals ? "text-green-600" : "text-gray-400")}>
                                    {canEditGoals ? "Açık" : "Kapalı"}
                                </span>
                            </div>
                            <div className="p-3 bg-gray-50 border rounded-md flex flex-col items-center justify-center text-center gap-1">
                                <span className="text-xs font-semibold text-gray-500 uppercase">Hafta Silme</span>
                                <span className={cn("text-sm font-bold", canDeleteWeek ? "text-green-600" : "text-gray-400")}>
                                    {canDeleteWeek ? "Açık" : "Kapalı"}
                                </span>
                            </div>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="bg-gray-50/50 border-t flex justify-end p-4">
                    <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Değişiklikleri Kaydet
                    </Button>
                </CardFooter>
            </Card>
        </div>
    )
}
