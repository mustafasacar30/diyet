"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Lock, Mail, User } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDeviceSecurity } from "@/hooks/use-device-security"
import { useAuth } from "@/contexts/auth-context"
import { getURL } from "@/utils/url"
import { logPatientLogin } from "@/actions/auth-actions"

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [fullName, setFullName] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)

    // Check for error param on mount


    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            const errorParam = params.get('error')
            if (errorParam) {
                setError(errorParam)
                // Optional: Clean URL
                window.history.replaceState({}, '', '/login')
            }
        }
    }, [])

    const { registerDevice } = useDeviceSecurity()
    const { user, profile, loading: authLoading } = useAuth() // Use global auth state

    // Redirect if already logged in
    useEffect(() => {
        if (!authLoading && user && profile) {
            console.log("🚀 Login Page: Detected active session, redirecting...", profile.role)
            if (profile.role === 'patient') {
                router.replace('/patient')
            } else {
                router.replace('/')
            }
        }
    }, [user, profile, authLoading, router])

    // Check for error param
    const { searchParams } = new URL(typeof window !== 'undefined' ? window.location.href : 'http://localhost')
    // Actually next/navigation has useSearchParams

    // We need to use useSearchParams from next/navigation
    // But inserting it might be messy with imports.
    // Let's stick to standard URL if we can, or add the hook.

    const handleGoogleLogin = async () => {
        setLoading(true)
        setError(null)
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${getURL()}auth/callback`
                }
            })
            if (error) throw error
        } catch (err: any) {
            console.error("Google login error:", err)
            setError(err.message)
            setLoading(false)
        }
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        setSuccessMessage(null)

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            })

            if (error) throw error

            if (data.user) {
                // Fetch user role to determine redirect
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', data.user.id)
                    .single()

                const role = profile?.role || 'patient'
                
                // IP ve giriş logunu server action üzerinden ilet
                if (role === 'patient') {
                    try {
                        await logPatientLogin(data.user.id);
                    } catch (err) {
                        console.error("Login tracking error:", err);
                    }
                }

                // Device Security Check (Skip for Admins if desired, but good to track)
                if (role !== 'admin') {
                    const deviceResult = await registerDevice()
                    if (!deviceResult.success) {
                        // Block login
                        await supabase.auth.signOut()
                        // Use URL param to persist error across re-renders/auth state flushes
                        const errorMsg = deviceResult.message || "Cihaz güvenlik kontrolü başarısız."

                        // Force a hard navigation or replace to ensure state is clear
                        // Using window.location to be sure avoiding nextjs router state race conditions
                        window.location.href = `/login?error=${encodeURIComponent(errorMsg)}`
                        return // Stop execution
                    }
                }

                // Redirect based on role
                if (role === 'patient') {
                    router.push('/patient')
                } else {
                    router.push('/')
                }
            }
        } catch (err: any) {
            console.error("Login error:", err)
            let msg = err.message
            if (msg === "Invalid login credentials") msg = "E-posta veya şifre hatalı."
            if (msg.includes("Email not confirmed")) msg = "E-posta adresiniz onaylanmamış. Lütfen e-postanızı kontrol edin."

            setError(msg)
        } finally {
            // Only stop loading if we didn't redirect (window.location)
            // But we can't easily know. Safe to set false, component unmounts anyway if redirect works.
            setLoading(false)
        }
    }

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        setSuccessMessage(null)

        if (password.length < 6) {
            setError("Şifre en az 6 karakter olmalıdır.")
            setLoading(false)
            return
        }

        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        role: 'admin' // Default role for testing/dev: ADMIN
                    }
                }
            })

            if (error) throw error

            if (data.user) {
                setSuccessMessage("Kayıt başarılı! Lütfen e-posta adresinize gelen onay linkine tıklayın.")
            }
        } catch (err: any) {
            console.error("Register error:", err)
            let msg = err.message
            if (msg.includes("Password should be at least")) msg = "Şifre en az 6 karakter olmalıdır."
            if (msg.includes("For security purposes")) msg = "Çok fazla deneme yaptınız. Lütfen 60 saniye bekleyip tekrar deneyin."

            setError(msg)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="absolute inset-0 bg-grid-slate-200 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] pointer-events-none" />

            <Tabs defaultValue="login" className="w-full max-w-md relative" onValueChange={(val) => {
                if (val === "register") router.push('/register')
            }}>
                <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="login">Giriş Yap</TabsTrigger>
                    <TabsTrigger value="register">Kayıt Ol</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                    <Card className="shadow-xl border-slate-200 bg-white">
                        <CardHeader className="space-y-1 text-center pb-6">
                            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-green-600 to-teal-600 bg-clip-text text-transparent">
                                Hoş Geldiniz
                            </CardTitle>
                            <CardDescription>
                                Hesabınıza giriş yapın
                            </CardDescription>
                        </CardHeader>
                        <form onSubmit={handleLogin}>
                            <CardContent className="space-y-4">
                                {error && (
                                    <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
                                        {error}
                                    </div>
                                )}
                                {successMessage && (
                                    <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm">
                                        {successMessage}
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <Label htmlFor="email">E-posta</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="ornek@domain.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="pl-9"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">Şifre</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                        <Input
                                            id="password"
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="pl-9"
                                            required
                                        />
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="flex flex-col gap-3">
                                <Button
                                    type="submit"
                                    className="w-full bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700"
                                    disabled={loading}
                                >
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Giriş Yap"}
                                </Button>

                                <div className="relative w-full my-2">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-gray-200" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-white px-2 text-gray-500">
                                            veya
                                        </span>
                                    </div>
                                </div>

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
                                    Google ile Giriş Yap
                                </Button>
                            </CardFooter>
                        </form>
                    </Card>
                </TabsContent>

                <TabsContent value="register">
                    <Card className="shadow-xl border-slate-200 bg-white h-[400px] flex flex-col items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-teal-600 mb-4" />
                        <p className="text-gray-500 font-medium">Kayıt formuna yönlendiriliyor...</p>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
