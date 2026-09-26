"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Lock, Mail, Leaf, AlertCircle } from "lucide-react"
import { useDeviceSecurity } from "@/hooks/use-device-security"
import { useAuth } from "@/contexts/auth-context"
import { getURL } from "@/utils/url"
import { logPatientLogin, confirmEmailIfApproved } from "@/actions/auth-actions"
import Link from "next/link"

export default function LoginPage() {
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search)
            const errorParam = params.get('error')
            if (errorParam) {
                setError(errorParam)
                window.history.replaceState({}, '', '/login')
            }
        }
    }, [])

    const { registerDevice } = useDeviceSecurity()
    const { user, profile, loading: authLoading } = useAuth()

    useEffect(() => {
        if (!authLoading && user && profile) {
            if (profile.role === 'patient') {
                router.replace('/patient')
            } else {
                router.replace('/')
            }
        }
    }, [user, profile, authLoading, router])

    const handleGoogleLogin = async () => {
        setLoading(true)
        setError(null)
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${getURL()}auth/callback` }
            })
            if (error) throw error
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password })
            if (error) throw error

            if (data.user) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', data.user.id)
                    .single()

                const role = profile?.role || 'patient'

                if (role === 'patient') {
                    try { await logPatientLogin(data.user.id) } catch {}
                }

                if (role !== 'admin') {
                    const deviceResult = await registerDevice()
                    if (!deviceResult.success) {
                        await supabase.auth.signOut()
                        window.location.href = `/login?error=${encodeURIComponent(deviceResult.message || "Cihaz güvenlik kontrolü başarısız.")}`
                        return
                    }
                }

                router.push(role === 'patient' ? '/patient' : '/')
            }
        } catch (err: any) {
            let msg = err.message
            if (msg === "Invalid login credentials") msg = "E-posta veya şifre hatalı."
            if (msg.includes("Email not confirmed")) {
                const result = await confirmEmailIfApproved(email)
                if (result.confirmed) {
                    setError(null)
                    setLoading(true)
                    try {
                        const { data, error: retryError } = await supabase.auth.signInWithPassword({ email, password })
                        if (retryError) throw retryError
                        if (data.user) {
                            const { data: p } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
                            const r = p?.role || 'patient'
                            if (r === 'patient') { try { await logPatientLogin(data.user.id) } catch {} }
                            if (r !== 'admin') {
                                const dr = await registerDevice()
                                if (!dr.success) { await supabase.auth.signOut(); window.location.href = `/login?error=${encodeURIComponent(dr.message || "Cihaz hatası")}`; return }
                            }
                            router.push(r === 'patient' ? '/patient' : '/')
                            return
                        }
                    } catch (retryErr: any) {
                        msg = retryErr.message
                    }
                } else {
                    msg = "Başvurunuz henüz onaylanmamış. Onaylandığında giriş yapabileceksiniz."
                }
            }
            setError(msg)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-3">
            <div className="w-full max-w-sm">
                {/* Brand */}
                <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2 mb-1">
                        <div className="h-10 w-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-md">
                            <Leaf className="h-5 w-5 text-white" />
                        </div>
                    </div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-700 to-teal-600 bg-clip-text text-transparent">
                        Hoş Geldiniz
                    </h1>
                    <p className="text-[12px] text-gray-400 mt-0.5">Hesabınıza giriş yapın</p>
                </div>

                {/* Card */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                    <form onSubmit={handleLogin} className="p-5 space-y-4">
                        {error && (
                            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-xl text-[13px]">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label className="text-[12px] font-semibold text-gray-700">E-posta</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                <Input type="email" placeholder="ornek@email.com" value={email} onChange={e => setEmail(e.target.value)}
                                    className="pl-9 h-10 rounded-xl border-gray-200 focus:border-emerald-400 focus:ring-emerald-400/20" required />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-[12px] font-semibold text-gray-700">Şifre</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                                <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                                    className="pl-9 h-10 rounded-xl border-gray-200 focus:border-emerald-400 focus:ring-emerald-400/20" required />
                            </div>
                        </div>

                        <Button type="submit" disabled={loading}
                            className="w-full h-10 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold text-[13px] shadow-sm">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                            Giriş Yap
                        </Button>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-gray-200" /></div>
                            <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white px-2 text-gray-400">veya</span></div>
                        </div>

                        <Button type="button" variant="outline" disabled={loading} onClick={handleGoogleLogin}
                            className="w-full h-10 rounded-xl border-gray-200 font-medium text-[13px] hover:bg-gray-50">
                            <svg viewBox="0 0 24 24" className="mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                            Google ile Giriş Yap
                        </Button>
                    </form>

                    <div className="px-5 py-3 bg-gray-50/50 border-t border-gray-100 text-center">
                        <p className="text-[12px] text-gray-500">
                            Hesabınız yok mu?{" "}
                            <Link href="/register" className="text-emerald-600 font-semibold hover:text-emerald-700">
                                Kayıt Ol
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
