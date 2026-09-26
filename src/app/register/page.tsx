"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Loader2, ArrowRight, ArrowLeft, HeartPulse, User, Ruler,
    Pill, Phone, Target, Leaf, CheckCircle2, AlertCircle
} from "lucide-react"
import { registerPatientSelf } from "@/actions/patient-actions"
import { MultiSelectCreatable, Option } from "@/components/ui/multi-select-creatable"
import { getURL } from "@/utils/url"
import { PreferenceQuestionnaire, type PreferenceData } from "@/components/patient/preference-questionnaire"

// ─── Constants ───────────────────────────────────────────────

const ACTIVITY_LEVELS = [
    { value: 1, label: "Hareketsiz / Yatalak" },
    { value: 2, label: "Masa başı iş, az hareket" },
    { value: 3, label: "Hafif egzersiz, yürüyüş" },
    { value: 4, label: "Düzenli egzersiz" },
    { value: 5, label: "Yoğun spor / atlet" },
]

// ─── Component ───────────────────────────────────────────────

export default function RegisterPage() {
    const router = useRouter()
    const TOTAL_STEPS = 4

    // Step 1 — Account
    const [full_name, setFullName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [phone, setPhone] = useState("")

    // Step 2 — Physical
    const [age, setAge] = useState<number | "">("")
    const [gender, setGender] = useState<"male" | "female">("female")
    const [height, setHeight] = useState<number | "">("")
    const [weight, setWeight] = useState<number | "">("")
    const [activity_level, setActivityLevel] = useState(3)

    // Step 3 — Health
    const [diseases, setDiseases] = useState("")
    const [medications, setMedications] = useState("")
    const GOAL_OPTIONS: Option[] = [
        { id: "Lipödem Beslenmesi", name: "Lipödem Beslenmesi" },
        { id: "Kilo Vermek", name: "Kilo Vermek" },
        { id: "Kilo Korumak", name: "Kilo Korumak" },
        { id: "Detoks", name: "Detoks" },
        { id: "Sağlıklı Yaşam", name: "Sağlıklı Yaşam" },
    ]
    const [selectedGoals, setSelectedGoals] = useState<Option[]>([{ id: "Lipödem Beslenmesi", name: "Lipödem Beslenmesi" }])

    // General
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [step, setStep] = useState(1)

    const [programs, setPrograms] = useState<{ id: string; name: string }[]>([])
    const [programId, setProgramId] = useState("none")
    const [allowGoalSelection, setAllowGoalSelection] = useState(false)
    const [isGoogleComplete, setIsGoogleComplete] = useState(false)
    const [googleUserId, setGoogleUserId] = useState<string | null>(null)

    // ─── Effects ─────────────────────────────────────────────

    useEffect(() => {
        const fetchMeta = async () => {
            const { data: pData } = await supabase.from("program_templates").select("id, name").eq("is_active", true).order("name")
            if (pData) {
                setPrograms(pData)
                const dp = pData.find(p => p.name.toUpperCase().includes("LİPÖDEM") || p.name.toUpperCase().includes("LIPÖDEM") || p.name.toUpperCase().includes("LIPODEM"))
                if (dp) setProgramId(dp.id)
            }
            const { data: s } = await supabase.from("app_settings").select("value").eq("key", "registration_settings").maybeSingle()
            if (s?.value) setAllowGoalSelection(!!s.value.allow_goal_selection)
        }
        fetchMeta()
    }, [])

    useEffect(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search)
            if (params.get("complete") === "true") {
                const checkGoogleUser = async () => {
                    const { data: { user } } = await supabase.auth.getUser()
                    if (user) {
                        setIsGoogleComplete(true)
                        setGoogleUserId(user.id)
                        setFullName(user.user_metadata?.full_name || user.user_metadata?.name || "")
                        setEmail(user.email || "")
                        setStep(2)
                        window.history.replaceState({}, "", "/register")
                    }
                }
                checkGoogleUser()
            }
        }
    }, [])

    // ─── Validation & Navigation ────────────────────────────

    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

    const nextStep = () => {
        setError(null)
        if (step === 1 && !isGoogleComplete) {
            if (!full_name.trim()) { setError("Ad Soyad zorunludur."); return }
            if (!isValidEmail(email)) { setError("Geçerli bir e-posta adresi giriniz."); return }
            if (password.length < 6) { setError("Şifre en az 6 karakter olmalıdır."); return }
        }
        if (step === 2) {
            if (!age || age < 1) { setError("Yaşınızı giriniz."); return }
            if (!height || height < 50) { setError("Boyunuzu giriniz (cm)."); return }
            if (!weight || weight < 20) { setError("Kilonuzu giriniz (kg)."); return }
        }
        setStep(step + 1)
    }

    const prevStep = () => {
        setError(null)
        setStep(step - 1)
    }

    const handleGoogleLogin = async () => {
        setLoading(true)
        setError(null)
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: `${getURL()}auth/callback?next=/register?complete=true` }
            })
            if (error) throw error
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
    }

    // ─── Submit ─────────────────────────────────────────────

    const handleRegister = async (prefData?: PreferenceData) => {
        setLoading(true)
        setError(null)

        try {
            let userId: string

            if (isGoogleComplete && googleUserId) {
                userId = googleUserId
            } else {
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email, password,
                    options: { data: { full_name, role: "patient" } }
                })
                if (authError) throw authError
                if (!authData.user) throw new Error("Kayıt oluşturulamadı.")
                userId = authData.user.id
            }

            let finalProgramId: string | null = programId === "none" ? null : programId
            if (!finalProgramId) {
                const dp = programs.find(p => p.name.toUpperCase().includes("LİPÖDEM") || p.name.toUpperCase().includes("LIPODEM"))
                if (dp) finalProgramId = dp.id
            }

            const diseaseNames = diseases.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
            const medicationNames = medications.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)

            const { error: patientError } = await registerPatientSelf(userId, email, {
                full_name,
                age: Number(age) || 0,
                gender,
                height: Number(height) || 0,
                weight: Number(weight) || 0,
                activity_level,
                liked_foods: [],
                disliked_foods: [],
                disease_ids: diseaseNames,
                medication_ids: medicationNames,
                phone,
                goals: selectedGoals.map(g => g.name),
                program_template_id: finalProgramId,
                preferences: prefData || null,
            })

            if (patientError) throw new Error(patientError)
            await supabase.auth.signOut()
            setStep(5)
        } catch (err: any) {
            console.error("Register error:", err)
            setError(err.message || "Kayıt sırasında bir hata oluştu.")
        } finally {
            setLoading(false)
        }
    }

    // ─── Render ─────────────────────────────────────────────

    const stepLabels = ["Hesap", "Fiziksel", "Sağlık", "Tercihler"]

    return (
        <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 py-4 px-3">
            <div className="max-w-lg w-full">
                {/* Brand */}
                <div className="text-center mb-3">
                    <div className="inline-flex items-center gap-2 mb-1">
                        <div className="h-9 w-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-md">
                            <Leaf className="h-5 w-5 text-white" />
                        </div>
                        <span className="text-xl font-bold bg-gradient-to-r from-emerald-700 to-teal-600 bg-clip-text text-transparent">
                            Kayıt Formu
                        </span>
                    </div>
                </div>

                {/* Progress */}
                {step <= TOTAL_STEPS && (
                    <div className="flex items-center justify-center gap-0.5 mb-3 overflow-x-auto px-1 no-scrollbar">
                        {stepLabels.map((label, i) => {
                            const num = i + 1
                            const isActive = step === num
                            const isDone = step > num
                            return (
                                <div key={i} className="flex items-center gap-0.5 shrink-0">
                                    <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold transition-all ${
                                        isActive ? "bg-emerald-600 text-white shadow-sm" :
                                        isDone ? "bg-emerald-100 text-emerald-700" :
                                        "bg-gray-100 text-gray-400"
                                    }`}>
                                        {isDone ? <CheckCircle2 className="h-2.5 w-2.5" /> : <span>{num}</span>}
                                        <span>{label}</span>
                                    </div>
                                    {i < TOTAL_STEPS - 1 && <div className={`w-3 h-0.5 rounded ${isDone ? "bg-emerald-400" : "bg-gray-200"}`} />}
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden flex flex-col max-h-[80dvh]">
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                        {error && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-xl text-[13px]">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* ═══ STEP 1 — Account ═══ */}
                        {step === 1 && (
                            <div className="space-y-3.5 animate-in slide-in-from-right-2">
                                <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                                    <User className="w-4 h-4 text-emerald-600" /> Hesap Bilgileriniz
                                </h3>
                                <Button type="button" variant="outline"
                                    className="w-full font-medium h-11 rounded-xl border-gray-200 hover:bg-gray-50"
                                    onClick={handleGoogleLogin} disabled={loading}>
                                    <svg viewBox="0 0 24 24" className="mr-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                    </svg>
                                    Google ile Kayıt Ol
                                </Button>
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200" /></div>
                                    <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-2 text-gray-400">veya</span></div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700">Ad Soyad *</Label>
                                    <Input placeholder="Ayşe Yılmaz" value={full_name} onChange={e => setFullName(e.target.value)}
                                        className="h-10 rounded-xl border-gray-200 focus:border-emerald-400 focus:ring-emerald-400/20" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700">E-posta *</Label>
                                    <Input type="email" placeholder="ornek@email.com" value={email} onChange={e => setEmail(e.target.value)}
                                        className="h-10 rounded-xl border-gray-200 focus:border-emerald-400 focus:ring-emerald-400/20" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700">Şifre *</Label>
                                    <Input type="password" placeholder="En az 6 karakter" value={password} onChange={e => setPassword(e.target.value)}
                                        className="h-10 rounded-xl border-gray-200 focus:border-emerald-400 focus:ring-emerald-400/20" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700 flex items-center gap-1">
                                        <Phone className="w-3 h-3" /> Telefon
                                    </Label>
                                    <Input type="tel" placeholder="05XX XXX XX XX" value={phone} onChange={e => setPhone(e.target.value)}
                                        className="h-10 rounded-xl border-gray-200 focus:border-emerald-400 focus:ring-emerald-400/20" />
                                </div>
                            </div>
                        )}

                        {/* ═══ STEP 2 — Physical ═══ */}
                        {step === 2 && (
                            <div className="space-y-3.5 animate-in slide-in-from-right-2">
                                <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                                    <Ruler className="w-4 h-4 text-emerald-600" /> Fiziksel Bilgileriniz
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-[12px] font-semibold text-gray-700">Yaş *</Label>
                                        <Input type="number" min="1" max="120" value={age} onChange={e => setAge(Number(e.target.value))}
                                            className="h-10 rounded-xl border-gray-200 focus:border-emerald-400" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[12px] font-semibold text-gray-700">Cinsiyet *</Label>
                                        <Select value={gender} onValueChange={(v: any) => setGender(v)}>
                                            <SelectTrigger className="h-10 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="female">Kadın</SelectItem>
                                                <SelectItem value="male">Erkek</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-[12px] font-semibold text-gray-700">Boy (cm) *</Label>
                                        <Input type="number" placeholder="165" value={height} onChange={e => setHeight(Number(e.target.value))}
                                            className="h-10 rounded-xl border-gray-200 focus:border-emerald-400" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[12px] font-semibold text-gray-700">Kilo (kg) *</Label>
                                        <Input type="number" step="0.1" placeholder="70" value={weight} onChange={e => setWeight(Number(e.target.value))}
                                            className="h-10 rounded-xl border-gray-200 focus:border-emerald-400" />
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700">Aktivite Seviyesi</Label>
                                    <Select value={activity_level.toString()} onValueChange={v => setActivityLevel(Number(v))}>
                                        <SelectTrigger className="h-10 rounded-xl border-gray-200"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {ACTIVITY_LEVELS.map(l => (
                                                <SelectItem key={l.value} value={String(l.value)}>{l.value}. {l.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        )}

                        {/* ═══ STEP 3 — Health ═══ */}
                        {step === 3 && (
                            <div className="space-y-3.5 animate-in slide-in-from-right-2">
                                <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                                    <HeartPulse className="w-4 h-4 text-emerald-600" /> Sağlık Bilgileriniz
                                </h3>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700 flex items-center gap-1">
                                        <Target className="w-3 h-3 text-emerald-500" /> Hedefleriniz
                                    </Label>
                                    <MultiSelectCreatable
                                        options={allowGoalSelection ? GOAL_OPTIONS : GOAL_OPTIONS.filter(g => g.name.includes("Lipödem"))}
                                        selected={selectedGoals} onChange={setSelectedGoals}
                                        placeholder={allowGoalSelection ? "Hedef seçin..." : "Lipödem Beslenmesi"}
                                        disabled={!allowGoalSelection} emptyText="Bulunamadı." createText="ekle" />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700 flex items-center gap-1">
                                        <Pill className="w-3 h-3 text-orange-500" /> Mevcut Hastalıklarınız
                                    </Label>
                                    <Input placeholder="Ör: varis, guatr, tiroid (virgülle ayırın)" value={diseases}
                                        onChange={e => setDiseases(e.target.value)}
                                        className="h-10 rounded-xl border-gray-200 focus:border-emerald-400" />
                                    <p className="text-[10px] text-gray-400">Yoksa boş bırakabilirsiniz.</p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-[12px] font-semibold text-gray-700 flex items-center gap-1">
                                        <Pill className="w-3 h-3 text-purple-500" /> Düzenli Kullandığınız İlaçlar
                                    </Label>
                                    <Input placeholder="Ör: tansiyon ilacı, tiroid ilacı" value={medications}
                                        onChange={e => setMedications(e.target.value)}
                                        className="h-10 rounded-xl border-gray-200 focus:border-emerald-400" />
                                    <p className="text-[10px] text-gray-400">Yoksa boş bırakabilirsiniz.</p>
                                </div>
                            </div>
                        )}

                        {/* ═══ STEP 4 — Preferences (embedded questionnaire) ═══ */}
                        {step === 4 && (
                            <PreferenceQuestionnaire
                                onComplete={(data) => handleRegister(data)}
                                onCancel={() => setStep(3)}
                                loading={loading}
                                standalone={false}
                            />
                        )}

                        {/* ═══ STEP 5 — Success ═══ */}
                        {step === 5 && (
                            <div className="text-center py-10 animate-in zoom-in-95">
                                <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">Başvurunuz Alındı!</h3>
                                <p className="text-[13px] text-gray-500 max-w-xs mx-auto leading-relaxed">
                                    Kaydınız başarıyla oluşturuldu. Başvurunuz onaylandığında giriş yapabileceksiniz.
                                </p>
                                <Button className="mt-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 rounded-xl h-10 px-6"
                                    onClick={() => router.push("/login")}>
                                    Giriş Sayfasına Dön
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {step >= 1 && step < TOTAL_STEPS && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
                            {step > 1 ? (
                                <Button variant="ghost" size="sm" onClick={prevStep} disabled={loading}
                                    className="text-gray-600 h-9 rounded-xl">
                                    <ArrowLeft className="w-4 h-4 mr-1" /> Geri
                                </Button>
                            ) : (
                                <Button variant="ghost" size="sm" onClick={() => router.push("/login")} disabled={loading}
                                    className="text-gray-600 h-9 rounded-xl">
                                    Giriş Yap
                                </Button>
                            )}

                            <Button onClick={nextStep} size="sm"
                                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white h-9 rounded-xl px-5">
                                İleri <ArrowRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
