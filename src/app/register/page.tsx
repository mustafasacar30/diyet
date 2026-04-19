"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, ArrowRight, ArrowLeft, HeartPulse, User, Ruler, Activity, Apple, ActivitySquare, Pill } from "lucide-react"
import { registerPatientSelf } from "@/actions/patient-actions"
import { MultiSelectCreatable, Option } from "@/components/ui/multi-select-creatable"
import { Phone, Target } from "lucide-react"
import { getURL } from "@/utils/url"

export default function RegisterPage() {
    const router = useRouter()

    // Auth fields
    const [full_name, setFullName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [phone, setPhone] = useState("")

    // Profile Fields
    const [age, setAge] = useState<number | "">("")
    const [gender, setGender] = useState<"male" | "female">("male")
    const [height, setHeight] = useState<number | "">("")
    const [weight, setWeight] = useState<number | "">("")
    const [activity_level, setActivityLevel] = useState<number>(3)
    const [liked_foods, setLikedFoods] = useState("")
    const [disliked_foods, setDislikedFoods] = useState("")

    // DB Fetched Fields
    const [diseases, setDiseases] = useState<Option[]>([])
    const [selectedDiseases, setSelectedDiseases] = useState<Option[]>([])

    const [medications, setMedications] = useState<Option[]>([])
    const [selectedMedications, setSelectedMedications] = useState<Option[]>([])

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)
    const [step, setStep] = useState(1) // 1: Hesabınız, 2: Vücut & Aktivite, 3: Hastalık & İlaç & Tercihler

    // Pre-defined goals
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
    const [selectedGoals, setSelectedGoals] = useState<Option[]>([])

    // Programs
    const [programs, setPrograms] = useState<{ id: string, name: string }[]>([])
    const [programId, setProgramId] = useState<string>('none')

    // App Settings
    const [allowProgramSelection, setAllowProgramSelection] = useState(false)
    const [allowGoalSelection, setAllowGoalSelection] = useState(false)

    // Google OAuth completion mode
    const [isGoogleComplete, setIsGoogleComplete] = useState(false)
    const [googleUserId, setGoogleUserId] = useState<string | null>(null)

    useEffect(() => {
        const fetchMeta = async () => {
            const { data: dData } = await supabase.from('diseases').select('*').order('name')
            if (dData) setDiseases(dData)

            const { data: mData } = await supabase.from('medications').select('*').order('name')
            if (mData) setMedications(mData)

            const { data: pData } = await supabase.from('program_templates').select('id, name').eq('is_active', true).order('name')
            if (pData) {
                setPrograms(pData)
                const defaultProgram = pData.find(p => p.name.toUpperCase().includes('LİPÖDEM') || p.name.toUpperCase().includes('LIPÖDEM') || p.name.toUpperCase().includes('LIPODEM'))
                if (defaultProgram) {
                    setProgramId(defaultProgram.id)
                }
            }

            // Fetch app settings
            let settingsValue: any = null
            const { data: settingsData } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'registration_settings')
                .maybeSingle();
            if (settingsData?.value) {
                settingsValue = settingsData.value
            } else {
                const { data: legacySettingsData } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('id', 'registration_settings')
                    .maybeSingle();
                if (legacySettingsData?.value) settingsValue = legacySettingsData.value
            }

            if (settingsValue) {
                setAllowProgramSelection(!!settingsValue.allow_program_selection);
                const canSelectGoals = !!settingsValue.allow_goal_selection;
                setAllowGoalSelection(canSelectGoals);

                if (!canSelectGoals) {
                    // Pre-select Lipödem Beslenmesi goal and lock it
                    const lipodemGoal = GOAL_OPTIONS.find(g => g.name.includes("Lipödem"));
                    if (lipodemGoal) {
                        setSelectedGoals([lipodemGoal]);
                    }
                }
            } else {
                // If it doesn't exist, default to restricting
                const lipodemGoal = GOAL_OPTIONS.find(g => g.name.includes("Lipödem"));
                if (lipodemGoal) {
                    setSelectedGoals([lipodemGoal]);
                }
            }
        }
        fetchMeta()
    }, [])

    // Detect Google OAuth completion mode
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            const isComplete = params.get('complete')

            if (isComplete === 'true') {
                // User came back from Google OAuth, check if authenticated
                const checkGoogleUser = async () => {
                    const { data: { user } } = await supabase.auth.getUser()
                    if (user) {
                        setIsGoogleComplete(true)
                        setGoogleUserId(user.id)
                        setFullName(user.user_metadata?.full_name || user.user_metadata?.name || '')
                        setEmail(user.email || '')
                        setStep(2) // Skip to body/activity step
                        // Clean URL
                        window.history.replaceState({}, '', '/register')
                    }
                }
                checkGoogleUser()
            }
        }
    }, [])



    const nextStep = () => {
        if (step === 1 && !isGoogleComplete && (!full_name || !email || password.length < 6)) {
            setError("Lütfen ad, e-posta ve en az 6 karakterli şifre giriniz.")
            return
        }
        setError(null)
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
                provider: 'google',
                options: {
                    redirectTo: `${getURL()}auth/callback?next=/register?complete=true`
                }
            })
            if (error) throw error
        } catch (err: any) {
            console.error("Google login error:", err)
            setError(err.message)
            setLoading(false)
        }
    }

    const handleRegister = async () => {
        setLoading(true)
        setError(null)

        try {
            let userId: string
            let userEmail: string

            if (isGoogleComplete && googleUserId) {
                // Google OAuth user - already authenticated, skip signUp
                userId = googleUserId
                userEmail = email
            } else {
                // Email/password registration
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name,
                            role: 'patient'
                        }
                    }
                })

                if (authError) throw authError
                if (!authData.user) throw new Error("Kayıt oluşturulamadı.")

                userId = authData.user.id
                userEmail = email
            }

            // Determine final program ID (fallback to LİPÖDEM if none selected)
            let finalProgramId: string | null = programId === 'none' ? null : programId
            if (programId === 'none') {
                const defaultProgram = programs.find(p => p.name.toUpperCase().includes('LİPÖDEM') || p.name.toUpperCase().includes('LIPODEM'))
                if (defaultProgram) {
                    finalProgramId = defaultProgram.id
                    console.log("Defaulting to LİPÖDEM program:", finalProgramId)
                }
            }

            // Call server action to create/update the profile details under "pending" status
            const { error: patientError } = await registerPatientSelf(userId, userEmail, {
                full_name,
                age: Number(age) || 0,
                gender,
                height: Number(height) || 0,
                weight: Number(weight) || 0,
                activity_level,
                liked_foods: liked_foods.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
                disliked_foods: disliked_foods.split(/[\n,]+/).map(s => s.trim()).filter(Boolean),
                disease_ids: selectedDiseases.map(d => d.id),
                medication_ids: selectedMedications.map(m => m.id),
                phone: phone,
                goals: selectedGoals.map(g => g.name),
                program_template_id: finalProgramId
            })

            if (patientError) throw new Error(patientError)

            setSuccessMessage("Kaydınız başarıyla oluşturuldu! Diyetisyeninizin onayından sonra giriş yapabileceksiniz.")
            setStep(4) // Final success screen

            // Sign out the user so they can't access things until approved
            await supabase.auth.signOut()

        } catch (err: any) {
            console.error("Register error:", err)
            setError(err.message || "Oluşturma sırasında bir hata meydana geldi.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50 py-4 sm:py-12 px-2 sm:px-6 lg:px-8">
            <div className="absolute inset-0 bg-grid-slate-200 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] pointer-events-none" />

            <Card className="max-w-xl w-full relative z-10 shadow-xl border-slate-200 bg-white flex flex-col max-h-[96dvh]">
                <CardHeader className="text-center pb-2">
                    <CardTitle className="text-3xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                        Hasta Kayıt Formu
                    </CardTitle>
                    <CardDescription className="text-sm mt-2">
                        {step === 4 ? "Kayıt Tamamlandı" : `Adım ${step} / 3: Detaylı Profilinizi Oluşturun`}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6 overflow-y-auto flex-1 min-h-[50vh] pl-4 py-4 pr-3 sm:px-6 
                    [&::-webkit-scrollbar]:w-1.5
                    [&::-webkit-scrollbar-track]:bg-teal-50
                    [&::-webkit-scrollbar-thumb]:bg-teal-500/80 hover:[&::-webkit-scrollbar-thumb]:bg-teal-600
                    [&::-webkit-scrollbar-thumb]:rounded-full
                ">
                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                            {error}
                        </div>
                    )}

                    {step === 1 && (
                        <div className="space-y-4 animate-in slide-in-from-right-2">
                            <h3 className="text-lg font-medium text-gray-900 border-b pb-2 flex items-center gap-2">
                                <User className="w-5 h-5 text-teal-600" /> Hesap Bilgileriniz
                            </h3>

                            <Button
                                type="button"
                                variant="outline"
                                className="w-full font-medium"
                                onClick={handleGoogleLogin}
                                disabled={loading}
                            >
                                <svg viewBox="0 0 24 24" className="mr-2 h-5 w-5" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Google ile Hızlı Kayıt Ol
                            </Button>

                            <div className="relative w-full my-4">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t border-gray-200" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-white px-2 text-gray-500">
                                        veya e-posta ile kayıt ol
                                    </span>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="fullName">Ad Soyad</Label>
                                <Input id="fullName" placeholder="Örn: Ayşe Yılmaz" value={full_name} onChange={e => setFullName(e.target.value)} className="bg-amber-50/30" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">E-posta Adresi</Label>
                                <Input id="email" type="email" placeholder="ornek@domain.com" value={email} onChange={e => setEmail(e.target.value)} className="bg-amber-50/30" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Şifre</Label>
                                <Input id="password" type="password" placeholder="En az 6 karakter" value={password} onChange={e => setPassword(e.target.value)} className="bg-amber-50/30" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone" className="flex items-center gap-1">
                                    <Phone className="w-4 h-4 text-gray-500" /> Telefon Numarası
                                </Label>
                                <Input id="phone" type="tel" placeholder="05XX XXX XX XX" value={phone} onChange={e => setPhone(e.target.value)} className="bg-amber-50/30" />
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4 animate-in slide-in-from-right-2">
                            <h3 className="text-lg font-medium text-gray-900 border-b pb-2 flex items-center gap-2">
                                <Ruler className="w-5 h-5 text-teal-600" /> Fiziksel Bilgileriniz
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Yaş</Label>
                                    <Input type="number" min="1" max="120" value={age} onChange={e => setAge(Number(e.target.value))} className="bg-amber-50/30" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Cinsiyet</Label>
                                    <Select value={gender} onValueChange={(val: any) => setGender(val)}>
                                        <SelectTrigger className="bg-amber-50/30"><SelectValue placeholder="Seçiniz" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="male">Erkek</SelectItem>
                                            <SelectItem value="female">Kadın</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Boy (cm)</Label>
                                    <Input type="number" value={height} onChange={e => setHeight(Number(e.target.value))} className="bg-amber-50/30" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Kilo (kg)</Label>
                                    <Input type="number" step="0.1" value={weight} onChange={e => setWeight(Number(e.target.value))} className="bg-amber-50/30" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Fiziksel Aktivite Seviyesi</Label>
                                <Select value={activity_level.toString()} onValueChange={val => setActivityLevel(Number(val))}>
                                    <SelectTrigger className="bg-amber-50/30"><SelectValue placeholder="Aktivite Seviyesi" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">1: Hareketsiz/Yatalak</SelectItem>
                                        <SelectItem value="2">2: Çok Hafif Aktivite (Masa başı)</SelectItem>
                                        <SelectItem value="3">3: Hafif Aktivite (Ara sıra yürüyüş)</SelectItem>
                                        <SelectItem value="4">4: Orta Aktivite (Düzenli egzersiz)</SelectItem>
                                        <SelectItem value="5">5: Yoğun Aktivite (Sporcu)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4 animate-in slide-in-from-right-2">
                            <h3 className="text-lg font-medium text-gray-900 border-b pb-2 flex items-center gap-2">
                                <HeartPulse className="w-5 h-5 text-teal-600" /> Sağlık ve Beslenme
                            </h3>

                            <div className="space-y-2">
                                <Label className="flex items-center gap-1 font-semibold text-teal-700">Beslenme Programı (İsteğe Bağlı)</Label>
                                <Select value={programId} onValueChange={(v) => {
                                    if (allowProgramSelection) setProgramId(v)
                                }}>
                                    <SelectTrigger disabled={!allowProgramSelection} className="bg-amber-50/30">
                                        <SelectValue placeholder="Bir beslenme programı seçin" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Seçilmedi</SelectItem>
                                        {programs.map(p => {
                                            const isLipodem = p.name.toUpperCase().includes('LİPÖDEM') || p.name.toUpperCase().includes('LIPÖDEM') || p.name.toUpperCase().includes('LIPODEM');
                                            // Only show non-lipodem programs if allowed, or if it IS lipodem
                                            if (!allowProgramSelection && !isLipodem) return null;

                                            return (
                                                <SelectItem key={p.id} value={p.id} disabled={!allowProgramSelection && !isLipodem}>
                                                    {p.name}
                                                </SelectItem>
                                            )
                                        })}
                                    </SelectContent>
                                </Select>
                                {!allowProgramSelection && (
                                    <p className="text-xs text-muted-foreground mt-1 text-purple-600">
                                        Sadece Lipödem Beslenmesi programına kayıt olabilirsiniz.
                                    </p>
                                )}
                                <p className="text-xs text-gray-500">Diyetisyeniniz tarafından oluşturulan size özel programın temelini belirler.</p>
                            </div>

                            <div className="space-y-3">
                                <Label className="flex items-center gap-1"><Target className="w-4 h-4 text-blue-500" /> Hedefleriniz</Label>
                                <MultiSelectCreatable
                                    options={!allowGoalSelection ? GOAL_OPTIONS.filter(g => g.name.includes('Lipödem')) : GOAL_OPTIONS}
                                    selected={selectedGoals}
                                    onChange={setSelectedGoals}
                                    placeholder={!allowGoalSelection ? "Sistem tarafından belirlendi" : "Hedef seçin veya yazın..."}
                                    disabled={!allowGoalSelection}
                                    emptyText="Listede bulunamadı."
                                    createText="olarak hedeflerime ekle"
                                />
                            </div>

                            <div className="space-y-3">
                                <Label className="flex items-center gap-1"><ActivitySquare className="w-4 h-4 text-orange-500" /> Mevcut Hastalıklarınız (Varsa)</Label>
                                <MultiSelectCreatable
                                    options={diseases}
                                    selected={selectedDiseases}
                                    onChange={setSelectedDiseases}
                                    placeholder="Hastalık arayın veya yeni ekleyin..."
                                    emptyText="Hastalık bulunamadı."
                                    createText="olarak hastalığı listeye ekle"
                                />
                            </div>

                            <div className="space-y-3">
                                <Label className="flex items-center gap-1"><Pill className="w-4 h-4 text-purple-500" /> Düzenli Kullandığınız İlaçlar (Varsa)</Label>
                                <MultiSelectCreatable
                                    options={medications}
                                    selected={selectedMedications}
                                    onChange={setSelectedMedications}
                                    placeholder="İlaç arayın veya yeni ekleyin..."
                                    emptyText="İlaç bulunamadı."
                                    createText="olarak ilacı listeye ekle"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="flex items-center gap-1"><Apple className="w-4 h-4 text-green-500" /> Sevdiğiniz Yemekler</Label>
                                <Textarea placeholder="Virgül ile ayırarak yazabilirsiniz" value={liked_foods} onChange={e => setLikedFoods(e.target.value)} className="bg-amber-50/30" />
                            </div>

                            <div className="space-y-2">
                                <Label className="flex items-center gap-1"><Apple className="w-4 h-4 text-red-500" /> Sevmediğiniz / Alerjiniz Olan Besinler</Label>
                                <Textarea placeholder="Virgül ile ayırarak yazabilirsiniz" value={disliked_foods} onChange={e => setDislikedFoods(e.target.value)} className="bg-amber-50/30" />
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="text-center py-8 animate-in zoom-in-95">
                            <div className="mx-auto w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mb-4">
                                <User className="w-8 h-8 text-teal-600" />
                            </div>
                            <h3 className="text-xl font-medium text-gray-900 mb-2">Başvurunuz Alındı</h3>
                            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                                {successMessage}
                            </p>
                            <Button className="mt-6" onClick={() => router.push('/login')}>
                                Giriş Sayfasına Dön
                            </Button>
                        </div>
                    )}
                </CardContent>

                {step < 4 && (
                    <CardFooter className="flex justify-between bg-gray-50/50 py-3 sm:py-4 border-t shrink-0">
                        {step > 1 ? (
                            <Button variant="outline" onClick={prevStep} disabled={loading}>
                                <ArrowLeft className="w-4 h-4 mr-2" /> Geri
                            </Button>
                        ) : (
                            <Button variant="outline" onClick={() => router.push('/login')} disabled={loading}>
                                İptal
                            </Button>
                        )}

                        {step < 3 ? (
                            <Button onClick={nextStep} className="bg-teal-600 hover:bg-teal-700 text-white">
                                İleri <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        ) : (
                            <Button onClick={handleRegister} className="bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-700 hover:to-cyan-700" disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Kaydı Tamamla"}
                            </Button>
                        )}
                    </CardFooter>
                )}
            </Card>
        </div>
    )
}
