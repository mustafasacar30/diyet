"use client"

import { useAuth } from "@/contexts/auth-context"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Home, Calendar, Settings, LogOut, Utensils, Eye, MessageCircle, RotateCcw, X, TrendingUp, BarChart3, ChevronUp, ChevronDown, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { UnreadListener } from "@/components/layout/unread-listener"

export default function PatientLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { user, profile, isImpersonating, stopImpersonation, signOut } = useAuth()
    const role = profile?.role
    const router = useRouter()
    const pathname = usePathname()
    const [mounted, setMounted] = useState(false)
    const [patientDisplayInfo, setPatientDisplayInfo] = useState<{
        fullName: string
        programName: string | null
    } | null>(null)

    useEffect(() => {
        setMounted(true)
    }, [])

    // Fetch patient display info (name + program)
    useEffect(() => {
        async function fetchPatientInfo() {
            if (!user || !profile) return

            const targetId = profile.id || user.id

            // First try user_id match (legacy patients)
            let patientRecord = null

            // Reusable select string
            const selectQuery = 'id, full_name, weight, program_templates(name)'

            const { data: legacyMatch } = await supabase
                .from('patients')
                .select(selectQuery)
                .eq('user_id', targetId)
                .neq('id', targetId)
                .limit(1)
                .maybeSingle()

            if (legacyMatch) {
                patientRecord = legacyMatch
            } else {
                const { data: directMatch } = await supabase
                    .from('patients')
                    .select(selectQuery)
                    .eq('id', targetId)
                    .maybeSingle()
                patientRecord = directMatch
            }

            if (!patientRecord) {
                console.log("⚠️ No patient record found, redirecting to registration.")
                router.replace('/register')
                return
            }

            // Redirect to registration if the patient profile is incomplete (e.g., Google Auth without finishing registration)
            // Or if status is somehow not fully completed. We'll use weight as a proxy for completed registration
            // since weight is a required field in the register form step 2.
            if (!patientRecord.weight) {
                console.log("⚠️ Incomplete profile detected, redirecting to registration.")
                router.replace('/register?complete=true')
                return
            }

            // Handle relation array or object
            let programName = null
            const pt = patientRecord.program_templates
            if (pt) {
                if (Array.isArray(pt) && pt.length > 0) programName = pt[0].name
                else if (!Array.isArray(pt) && (pt as any).name) programName = (pt as any).name
            }

            setPatientDisplayInfo({
                fullName: patientRecord.full_name || 'Hasta',
                programName: programName
            })
        }

        fetchPatientInfo()
    }, [user, profile])

    useEffect(() => {
        if (mounted && role && role !== 'patient' && role !== 'admin') {
            // Optional: Redirect if not patient (allow admin for debugging)
            // router.push('/login') 
        }
    }, [role, mounted, router])

    // Removed early return to fix hook order violation
    // if (!mounted) return null

    const navItems = [
        {
            href: "/patient",
            label: "Bugün",
            icon: Home
        },
        {
            href: "/patient/plan",
            label: "Diyetim",
            icon: Calendar
        },
        // FAB placeholder - rendered separately
        {
            href: "/patient/settings",
            label: "Ayarlar",
            icon: Settings
        },
        {
            href: "/patient/messages",
            label: "Mesajlar",
            icon: MessageCircle,
            badge: true
        }
    ]

    // Unread Count Logic - Uses isolated component
    const [unreadCount, setUnreadCount] = useState(0)

    // Prevent hydration mismatch by only rendering after mount
    if (!mounted) return null

    const targetUserId = profile?.id || user?.id

    const isExpired = profile?.role === 'patient' && profile.valid_until && new Date() > new Date(profile.valid_until);

    if (isExpired) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-red-50 p-6 text-center">
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-red-100 max-w-sm w-full space-y-6">
                    <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                        <X className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 mb-2">Erişim Süreniz Dolmuştur</h1>
                        <p className="text-sm text-gray-500">
                            Sisteme giriş yapma süreniz ({new Date(profile!.valid_until!).toLocaleDateString('tr-TR')}) itibarıyla sona ermiştir. Devam etmek için lütfen diyetisyeninizle veya sistem yöneticinizle iletişime geçin.
                        </p>
                    </div>
                    <Button onClick={() => signOut()} className="w-full bg-red-600 hover:bg-red-700 text-white">
                        <LogOut className="w-4 h-4 mr-2" />
                        Çıkış Yap
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[100dvh] overflow-y-auto overflow-x-hidden w-full max-w-[100vw] bg-gray-50">
            {/* Listener Component - Isolated */}
            {targetUserId && (
                <UnreadListener userId={targetUserId} onUpdate={setUnreadCount} />
            )}
            {/* Impersonation Banner - shows when admin is viewing as patient */}
            {isImpersonating && (
                <div className="bg-amber-100 border-b border-amber-200 text-amber-900 px-4 py-2 flex items-center justify-between text-sm shadow-sm relative z-[60]">
                    <div className="flex items-center gap-2 font-medium">
                        <Eye className="h-4 w-4" />
                        <span>
                            Dikkat: <strong>{profile?.full_name}</strong> ({profile?.role}) olarak görüntülüyorsunuz.
                        </span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-7 bg-white hover:bg-amber-50 border-amber-300 text-amber-900"
                        onClick={() => {
                            stopImpersonation()
                            router.push('/admin/users')
                        }}
                    >
                        Admin'e Dön
                    </Button>
                </div>
            )}

            {/* Desktop Header */}
            {pathname !== '/patient/plan' && (
                <header className="hidden md:flex items-center justify-between px-6 py-4 bg-white border-b shadow-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                            {patientDisplayInfo?.fullName || 'Diyet Portal'}
                        </span>
                        {patientDisplayInfo?.programName && (
                            <span className="text-sm text-gray-500 px-2 py-0.5 bg-gray-100 rounded-full">
                                ({patientDisplayInfo.programName})
                            </span>
                        )}
                    </div>

                    <nav className="flex items-center gap-6">
                        {navItems.map((item) => (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "flex items-center gap-2 text-sm font-medium transition-colors hover:text-green-600",
                                    pathname === item.href ? "text-green-600" : "text-gray-600"
                                )}
                            >
                                <item.icon className="h-4 w-4" />
                                {item.label}
                                {/* Improved Badge Logic */}
                                {(item as any).badge && unreadCount > 0 && (
                                    <span className="ml-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center flex items-center justify-center">
                                        {unreadCount}
                                    </span>
                                )}
                            </Link>
                        ))}
                        
                        {/* Desktop Auto-Plan Button */}
                        <Button
                            onClick={() => {
                                if (pathname === '/patient/plan') {
                                    window.dispatchEvent(new CustomEvent('trigger-autoplan'))
                                } else {
                                    router.push('/patient/plan')
                                }
                            }}
                            className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-md shadow-indigo-200"
                            size="sm"
                        >
                            <Wand2 className="h-4 w-4 mr-2" />
                            Otomatik Planla
                        </Button>

                        <Button variant="ghost" size="sm" onClick={() => signOut()} className="text-red-500 hover:text-red-600 hover:bg-red-50">
                            <LogOut className="h-4 w-4 mr-2" />
                            Çıkış
                        </Button>
                    </nav>
                </header>
            )}

            {/* Mobile Header */}
            {pathname !== '/patient/plan' && (
                <header className="md:hidden flex items-center justify-between px-4 py-2 bg-white border-b shadow-sm sticky top-0 z-10">
                    <div className="flex flex-col">
                        <span className="text-base font-bold text-green-700 leading-tight">
                            {patientDisplayInfo?.fullName || 'Diyet Portal'}
                        </span>
                        {patientDisplayInfo?.programName && (
                            <span className="text-xs text-gray-500">
                                ({patientDisplayInfo.programName})
                            </span>
                        )}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => signOut()}>
                        <LogOut className="h-5 w-5 text-gray-500" />
                    </Button>
                </header>
            )}

            {/* Main Content */}
            <main className={cn(
                "flex-1 mb-20 md:mb-0",
                pathname === '/patient/plan'
                    ? "w-full max-w-none p-0"
                    : "container mx-auto px-4 py-2 md:py-4"
            )}>
                {children}
            </main>

            {/* Mobile Bottom Navigation */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-gray-200 z-50 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_-4px_rgba(0,0,0,0.15)]">
                <nav className="flex justify-between items-end relative h-16">
                    {/* Left nav items */}
                    {navItems.slice(0, 2).map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/patient' && pathname?.startsWith(item.href))
                        const isDiyetim = item.href === '/patient/plan'
                        const isOnDashboard = pathname === '/patient'
                        // Highlight Diyetim when user is on dashboard
                        const shouldHighlight = isDiyetim && isOnDashboard && !isActive
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all duration-300 relative",
                                    isActive
                                        ? "text-green-600"
                                        : shouldHighlight
                                            ? "text-emerald-500"
                                            : "text-gray-400 hover:text-gray-600"
                                )}
                            >
                                <item.icon className={cn(
                                    "h-5 w-5 transition-all duration-300",
                                    isActive && "scale-110",
                                    shouldHighlight && "animate-bounce"
                                )} />
                                <span className={cn(
                                    "text-[10px] font-medium transition-all",
                                    shouldHighlight && "font-bold text-emerald-600"
                                )}>{item.label}</span>
                                {isActive && (
                                    <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-green-500 rounded-full" />
                                )}
                                {shouldHighlight && (
                                    <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 flex h-2 w-2">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                    </span>
                                )}
                            </Link>
                        )
                    })}

                    {/* Center FAB Button - Auto Plan */}
                    <div className="relative -mt-5 mx-1">
                        <button
                            onClick={() => {
                                if (pathname === '/patient/plan') {
                                    // Already on plan page — trigger auto-plan
                                    window.dispatchEvent(new CustomEvent('trigger-autoplan'))
                                } else {
                                    router.push('/patient/plan')
                                }
                            }}
                            className="relative flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-[0_4px_20px_-2px_rgba(99,102,241,0.6)] hover:shadow-[0_6px_30px_-2px_rgba(99,102,241,0.8)] transition-all duration-300 hover:scale-105 active:scale-95 group"
                        >
                            {/* Glow ring */}
                            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-indigo-400 via-purple-400 to-pink-400 opacity-0 group-hover:opacity-40 blur-md transition-opacity duration-500" />
                            {/* Pulse ring - always pulse when not on plan page */}
                            {pathname !== '/patient/plan' && (
                                <span className="absolute inset-0 rounded-full animate-ping bg-indigo-400/30" style={{ animationDuration: '2s' }} />
                            )}
                            <Wand2 className="h-6 w-6 text-white relative z-10 drop-shadow-sm" />
                        </button>
                        <span className="text-[9px] font-bold text-center block mt-0.5 text-indigo-600">Planla</span>
                    </div>

                    {/* Right nav items */}
                    {navItems.slice(2).map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/patient' && pathname?.startsWith(item.href))
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                className={cn(
                                    "flex flex-col items-center gap-0.5 py-2 px-3 rounded-xl transition-all duration-300 relative",
                                    isActive
                                        ? "text-green-600"
                                        : "text-gray-400 hover:text-gray-600"
                                )}
                            >
                                <item.icon className={cn("h-5 w-5 transition-all duration-300", isActive && "scale-110")} />
                                {/* Mobile Badge */}
                                {(item as any).badge && unreadCount > 0 && (
                                    <span className="absolute top-1 right-1 bg-red-500 text-white text-[8px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-white">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                )}
                                <span className="text-[10px] font-medium">{item.label}</span>
                                {isActive && (
                                    <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-green-500 rounded-full" />
                                )}
                            </Link>
                        )
                    })}
                </nav>
            </div>
        </div>
    )
}
