"use client"

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Users, FileText, LayoutDashboard, UtensilsCrossed, ClipboardList, Eye, Shield, UserCog, Stethoscope, MessageCircle, Activity, Sparkles, ChefHat, Image as ImageIcon } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import React, { useState } from 'react'
import { UnreadListener } from '@/components/layout/unread-listener'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Menu } from 'lucide-react'
import AppStartupLoader from '@/components/ui/app-startup-loader'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const router = useRouter()
    const isPublicAuthPath = pathname === '/login' || pathname === '/register' || pathname?.startsWith('/auth/callback')
    const { isImpersonating, stopImpersonation, profile, signOut, user, loading } = useAuth()
    const [unreadCount, setUnreadCount] = useState(0)
    const [sheetOpen, setSheetOpen] = useState(false)
    const startupName = profile?.full_name || user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : null)



    // --- HOOKS SECTION (Must be top level) ---

    // 0. AUTHENTICATED USER ON LOGIN PAGE -> REDIRECT (allow /register for Google OAuth completion)
    React.useEffect(() => {
        if (!loading && user && pathname === '/login') {
            const target = profile?.role === 'patient' ? '/patient' : '/'
            console.log("🔄 DashboardLayout: Auth user on login page, redirecting to", target)
            router.replace(target)
        }
    }, [loading, user, pathname, profile, router])

    // 3. UNAUTHENTICATED REDIRECT
    React.useEffect(() => {
        if (!loading && !user && !isPublicAuthPath) {
            router.replace('/login')
        }
    }, [loading, user, isPublicAuthPath, router])

    // 5. PATIENT PROTECTION (Redirect from Admin routes, but allow /register for Google OAuth completion)
    React.useEffect(() => {
        if (!loading && user && profile?.role === 'patient' && !pathname?.startsWith('/patient') && pathname !== '/register' && !pathname?.startsWith('/auth/callback')) {
            router.replace('/patient')
        }
    }, [loading, user, profile, pathname, router])

    // --- RENDER EARLY RETURNS ---

    if (!loading && user && pathname === '/login') {
        return (
            <AppStartupLoader
                displayName={startupName}
                title="Panel aciliyor"
                subtitle="Hesabiniz dogrulaniyor..."
            />
        )
    }

    // 1. GUEST PAGE CHECK
    if (isPublicAuthPath) {
        return <>{children}</>
    }

    // 2. LOADING STATE
    if (loading) {
        return (
            <AppStartupLoader
                displayName={startupName}
                title="Veriler yukleniyor"
            />
        )
    }

    // 3. UNAUTHENTICATED REDIRECT

    if (!user) {
        return null
    }

    // 4. PATIENT PORTAL (Bypass Layout)
    if (pathname === '/patient' || pathname?.startsWith('/patient/')) {
        return <>{children}</>
    }

    // 5. PATIENT PROTECTION (Redirect from Admin routes)

    if (profile?.role === 'patient') {
        return (
            <AppStartupLoader
                displayName={startupName}
                title="Hasta alanı açılıyor"
                subtitle="Kişisel paneliniz hazırlanıyor..."
            />
        )
    }

    // --- ADMIN / PROFESSIONAL LAYOUT ---

    const handleLogout = async () => {
        try {
            await signOut()
            window.location.href = '/'
        } catch (error) {
            console.error("Logout error:", error)
        }
    }

    const ImpersonationBanner = () => {
        if (!isImpersonating) return null
        return (
            <div className="bg-amber-100 border-b border-amber-200 text-amber-900 px-4 py-2 flex items-center justify-between text-sm shadow-sm relative z-[60]">
                <div className="flex items-center gap-2 font-medium">
                    <Eye className="h-4 w-4" />
                    <span>
                        Dikkat: Şu anda <strong>{profile?.full_name || 'Başka bir kullanıcı'}</strong> ({profile?.role}) adına sistemi görüntülüyorsunuz.
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
                    Moddan Çık
                </Button>
            </div>
        )
    }

    const tabs = [
        { href: '/admin', label: 'Genel Bakış', icon: LayoutDashboard },
        { href: '/patients', label: 'Hastalar', icon: Users },
        { href: '/admin/messages', label: 'Mesajlar', icon: MessageCircle },
        { href: '/programs', label: 'Programlar', icon: ClipboardList },
        { href: '/foods', label: 'Yemek Listesi', icon: UtensilsCrossed },
    ]

    if (profile?.role === 'admin' || profile?.role === 'dietitian') {
        if (profile?.role === 'admin') {
            tabs.push({ href: '/admin/users', label: 'Yönetici', icon: Shield })
            tabs.push({ href: '/admin/dietitians', label: 'Diyetisyenler', icon: UserCog })
            tabs.push({ href: '/admin/doctors', label: 'Doktorlar', icon: Stethoscope })
            tabs.push({ href: '/admin/logs', label: 'Sistem Logları', icon: ClipboardList })
        }
        tabs.push({ href: '/admin/recipes', label: 'Tarif Kartları', icon: UtensilsCrossed })
        tabs.push({ href: '/admin/food-proposals', label: 'Yemek Önerileri', icon: Sparkles })
        tabs.push({ href: '/admin/food-discovery', label: 'AI Keşif', icon: ChefHat })
        tabs.push({ href: '/admin/card-maker', label: 'Kart Maker', icon: ImageIcon })
        tabs.push({ href: '/admin/diseases', label: 'Hastalıklar', icon: Activity })
    }

    const isPatientDetail = pathname?.toLowerCase().includes('/patients/') && pathname !== '/patients'

    // Determine User ID for Unread Listener
    const targetUserId = profile?.id || user.id

    console.log("DashboardLayout Path Check:", { pathname, isPatientDetail })

    return (
        <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
            {/* Listener Component - Isolated */}
            <UnreadListener userId={targetUserId} onUpdate={setUnreadCount} />

            <ImpersonationBanner />

            {/* Top Navigation */}
            <header className={`bg-white border-b flex items-center px-4 shrink-0 relative z-[100] pointer-events-auto shadow-sm ${isPatientDetail ? 'h-12 justify-between' : 'h-14'}`}>
                <div className="flex items-center">
                    {/* Mobile Menu Trigger */}
                    <div className="md:hidden mr-4">
                        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon" className="-ml-2">
                                    <Menu className="h-6 w-6" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-[280px] p-4 flex flex-col gap-4">
                                <SheetHeader className="text-left border-b pb-4">
                                    <SheetTitle className="bg-gradient-to-r from-green-600 to-teal-500 bg-clip-text text-transparent font-bold text-xl">
                                        {profile?.full_name || 'Diyet Plan'}
                                    </SheetTitle>
                                    <p className="text-sm text-muted-foreground">{profile?.role === 'dietitian' ? 'Diyetisyen' : profile?.role}</p>
                                </SheetHeader>
                                <div className="flex flex-col gap-1 overflow-y-auto flex-1">
                                    {tabs.map(tab => {
                                        const isActive = pathname === tab.href || (tab.href !== '/' && pathname?.startsWith(tab.href))
                                        return (
                                            <button
                                                key={tab.href}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setSheetOpen(false)
                                                    router.push(tab.href)
                                                }}
                                                className={`flex items-center gap-3 px-3 py-3 rounded-md transition-colors text-sm font-medium ${isActive
                                                    ? 'bg-blue-50 text-blue-700'
                                                    : 'text-gray-600 hover:bg-gray-100'
                                                    }`}
                                            >
                                                <tab.icon size={20} />
                                                {tab.label}
                                                {tab.label === 'Mesajlar' && unreadCount > 0 && (
                                                    <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                        {unreadCount}
                                                    </span>
                                                )}
                                            </button>
                                        )
                                    })}
                                </div>
                                <div className="border-t pt-4 mt-auto">
                                    <Button
                                        variant="outline"
                                        className="w-full justify-start gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        onClick={handleLogout}
                                    >
                                        <div className="h-4 w-4" /> {/* Placeholder for alignment if needed, or stick to default */}
                                        Çıkış Yap
                                    </Button>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>

                    <div
                        onClick={() => router.push('/')}
                        className={`font-bold bg-gradient-to-r from-green-600 to-teal-500 bg-clip-text text-transparent mr-8 cursor-pointer relative z-[101] pointer-events-auto hidden md:block ${isPatientDetail ? 'text-lg' : 'text-xl'}`}
                    >
                        {profile?.full_name || 'Diyet Plan'}
                    </div>

                    {/* Navigation Tabs (Desktop) */}
                    <nav className="hidden md:flex gap-1 relative z-[101] pointer-events-auto">
                        {tabs.map(tab => {
                            const isActive = pathname === tab.href || (tab.href !== '/' && pathname?.startsWith(tab.href))
                            return (
                                <button
                                    key={tab.href}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        router.push(tab.href)
                                    }}
                                    className={`rounded-md flex items-center transition-colors relative z-[102] cursor-pointer pointer-events-auto ${isPatientDetail ? 'px-3 py-1.5 text-sm gap-1.5' : 'px-4 py-2 text-sm gap-2'
                                        } ${isActive
                                            ? 'bg-blue-50 text-blue-700 font-medium'
                                            : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                >
                                    <tab.icon size={isPatientDetail ? 16 : 18} />
                                    {tab.label}
                                    {tab.label === 'Mesajlar' && unreadCount > 0 && (
                                        <span className="ml-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center flex items-center justify-center">
                                            {unreadCount}
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </nav>
                </div>

                {/* Slot for Dynamic Header Actions (Portal Target) */}
                <div id="header-actions-slot" className="flex items-center gap-2 ml-auto" />

                {/* Right Side: User Info & Logout */}
                <div className={`flex items-center gap-3 pointer-events-auto relative z-[102] ${isPatientDetail ? 'ml-4 border-l pl-4' : 'ml-auto'}`}>
                    <div className="text-right hidden md:block">
                        <div className="text-sm font-medium leading-none">{profile?.full_name || 'Kullanıcı'}</div>
                        <div className="text-xs text-muted-foreground capitalize">{profile?.role === 'dietitian' ? 'Diyetisyen' : profile?.role || ''}</div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLogout}
                        className={`text-gray-500 hover:text-red-600 hover:bg-red-50 ${isPatientDetail ? 'h-8' : ''}`}
                    >
                        Çıkış
                    </Button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 relative z-0 overflow-hidden flex flex-col bg-gray-50 min-h-0">
                <div className={`${isPatientDetail ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 overflow-auto p-4 md:p-6 w-full'}`}>
                    {children}
                </div>
            </main>
        </div>
    )
}

