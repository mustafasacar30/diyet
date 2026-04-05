"use client"

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Users, FileText, LayoutDashboard, UtensilsCrossed, ClipboardList, Eye, Shield, UserCog, Stethoscope, MessageCircle, Activity, Sparkles, ChefHat, Image as ImageIcon, Menu, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import React, { useState } from 'react'
import { UnreadListener } from '@/components/layout/unread-listener'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import AppStartupLoader from '@/components/ui/app-startup-loader'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const router = useRouter()
    const isPublicAuthPath = pathname === '/login' || pathname === '/register' || pathname?.startsWith('/auth/callback')
    const { isImpersonating, stopImpersonation, profile, signOut, user, loading, isStaff, isAdmin } = useAuth()
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
        return <AppStartupLoader displayName={startupName} title="Panel aciliyor" subtitle="Hesabiniz dogrulaniyor..." />
    }

    if (isPublicAuthPath) {
        return <>{children}</>
    }

    if (loading) {
        return <AppStartupLoader displayName={startupName} title="Veriler yukleniyor" />
    }

    if (!user) {
        return null
    }

    if (pathname === '/patient' || pathname?.startsWith('/patient/')) {
        return <>{children}</>
    }

    if (profile?.role === 'patient') {
        return <AppStartupLoader displayName={startupName} title="Hasta alanı açılıyor" subtitle="Kişisel paneliniz hazırlanıyor..." />
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
                    <span>Dikkat: Şu anda <strong>{profile?.full_name || 'Başka bir kullanıcı'}</strong> ({profile?.role}) adına sistemi görüntülüyorsunuz.</span>
                </div>
                <Button variant="outline" size="sm" className="h-7 bg-white hover:bg-amber-50 border-amber-300 text-amber-900" onClick={() => { stopImpersonation(); router.push('/admin/users') }}>Moddan Çık</Button>
            </div>
        )
    }

    // Define Groups
    const clinicalTabs = [
        { href: '/admin', label: 'Genel Bakış', icon: LayoutDashboard },
        { href: '/patients', label: 'Hastalar', icon: Users },
        { href: '/admin/messages', label: 'Mesajlar', icon: MessageCircle },
        { href: '/programs', label: 'Programlar', icon: ClipboardList },
    ]

    const knowledgeTabs = [
        { href: '/foods', label: 'Yemek Listesi', icon: UtensilsCrossed },
    ]

    const aiTabs = []
    const adminTabs = []

    if (isStaff) {
        knowledgeTabs.push({ href: '/admin/recipes', label: 'Tarif Kartları', icon: UtensilsCrossed })
        knowledgeTabs.push({ href: '/admin/diseases', label: 'Hastalıklar', icon: Activity })

        aiTabs.push({ href: '/admin/food-proposals', label: 'Yemek Önerileri', icon: Sparkles })
        aiTabs.push({ href: '/admin/food-discovery', label: 'AI Keşif', icon: ChefHat })
        aiTabs.push({ href: '/admin/card-maker', label: 'Kart Maker', icon: ImageIcon })

        if (isAdmin) {
            adminTabs.push({ href: '/admin/users', label: 'Yönetici', icon: Shield })
            adminTabs.push({ href: '/admin/dietitians', label: 'Diyetisyenler', icon: UserCog })
            adminTabs.push({ href: '/admin/doctors', label: 'Doktorlar', icon: Stethoscope })
            adminTabs.push({ href: '/admin/logs', label: 'Sistem Logları', icon: ClipboardList })
        }
    }

    const allTabs = [...clinicalTabs, ...knowledgeTabs, ...aiTabs, ...adminTabs]
    const isPatientDetail = pathname?.toLowerCase().includes('/patients/') && pathname !== '/patients'
    const targetUserId = profile?.id || user.id

    const renderNavGroup = (title: string, items: any[]) => {
        if (items.length === 0) return null;
        return (
            <div className="mb-6">
                <h4 className="px-5 text-[11px] font-bold text-slate-400/80 uppercase tracking-widest mb-3">{title}</h4>
                <div className="space-y-1">
                    {items.map(tab => {
                        const isActive = pathname === tab.href || (tab.href !== '/' && pathname?.startsWith(tab.href))
                        return (
                            <div key={tab.href} onClick={() => { router.push(tab.href); setSheetOpen(false) }}>
                                <div className={`flex items-center gap-3 px-4 py-2.5 mx-3 rounded-xl transition-all duration-200 cursor-pointer text-sm font-medium
                                    ${isActive 
                                    ? 'bg-blue-600 shadow-md shadow-blue-500/20 text-white' 
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                                    <tab.icon size={18} className={isActive ? 'text-white' : 'text-slate-500'} />
                                    <span className="flex-1">{tab.label}</span>
                                    {tab.label === 'Mesajlar' && unreadCount > 0 && (
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shadow-sm ${isActive ? 'bg-white text-blue-600' : 'bg-red-500 text-white'}`}>
                                            {unreadCount}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col bg-[#F8FAFC] overflow-hidden font-sans">
            <UnreadListener userId={targetUserId} onUpdate={setUnreadCount} />
            <ImpersonationBanner />

            <div className="flex flex-1 overflow-hidden">
                {/* BACKDROP BLUR SIDEBAR (Desktop) */}
                <aside className="hidden md:flex flex-col w-[260px] bg-white/70 backdrop-blur-3xl border-r border-slate-200/60 shrink-0 z-20 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
                    <div 
                        onClick={() => router.push('/')}
                        className="h-16 flex items-center px-6 shrink-0 cursor-pointer border-b border-slate-200/30 hover:bg-white/40 transition-colors"
                    >
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/30 mr-3">
                            <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <div className="font-bold bg-gradient-to-br from-slate-700 to-slate-900 bg-clip-text text-transparent tracking-tight text-xl">
                            Diyet Plan
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto py-6 scrollbar-hide">
                        {renderNavGroup('Klinik & Hastalar', clinicalTabs)}
                        {renderNavGroup('Veritabanı', knowledgeTabs)}
                        {renderNavGroup('Yapay Zeka', aiTabs)}
                        {renderNavGroup('Sistem', adminTabs)}
                    </div>

                    {/* Profile Section */}
                    <div className="p-4 mt-auto border-t border-slate-200/50 bg-white/40 backdrop-blur-md">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold shrink-0 shadow-inner">
                                {profile?.full_name?.charAt(0) || 'U'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{profile?.full_name}</p>
                                <p className="text-xs text-slate-500 capitalize truncate">{profile?.role === 'dietitian' ? 'Diyetisyen' : profile?.role}</p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0 h-8 w-8">
                                <LogOut size={16} />
                            </Button>
                        </div>
                    </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 flex flex-col relative z-0 min-w-0 bg-transparent">
                    {/* Mobile Header (Hidden on Desktop) */}
                    <header className={`md:hidden bg-white/80 backdrop-blur-xl border-b border-slate-200/60 flex flex-col fixed top-0 w-full z-30 transition-all ${isPatientDetail ? 'h-auto' : 'h-14'}`}>
                        <div className="flex items-center justify-between px-4 h-14 shrink-0">
                            <div className="flex items-center">
                                <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                                    <SheetTrigger asChild>
                                        <Button variant="ghost" size="icon" className="-ml-2 text-slate-600">
                                            <Menu className="h-6 w-6" />
                                        </Button>
                                    </SheetTrigger>
                                    <SheetContent side="left" className="w-[280px] p-0 flex flex-col bg-slate-50">
                                        <div className="h-16 flex items-center px-6 border-b border-slate-200/50 bg-white">
                                            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/30 mr-3">
                                                <Sparkles className="w-4 h-4 text-white" />
                                            </div>
                                            <div className="font-bold bg-gradient-to-br from-slate-700 to-slate-900 bg-clip-text text-transparent text-xl">Diyet Plan</div>
                                        </div>
                                        <div className="flex-1 overflow-y-auto py-4">
                                            {renderNavGroup('Klinik & Hastalar', clinicalTabs)}
                                            {renderNavGroup('Veritabanı', knowledgeTabs)}
                                            {renderNavGroup('Yapay Zeka', aiTabs)}
                                            {renderNavGroup('Sistem', adminTabs)}
                                        </div>
                                    </SheetContent>
                                </Sheet>
                                <div className="font-bold bg-gradient-to-br from-slate-700 to-slate-900 bg-clip-text text-transparent text-lg ml-2">Diyet Plan</div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-slate-400 hover:text-red-600 h-8 w-8">
                                <LogOut size={18} />
                            </Button>
                        </div>
                        {/* Mobile Slot for Patient Toolbar */}
                        <div id="mobile-header-actions-slot" className={`flex items-center w-full gap-2 px-2 pb-2 overflow-x-auto no-scrollbar ${isPatientDetail ? 'flex' : 'hidden'}`} />
                    </header>

                    {/* Page Container */}
                    <div className={`flex flex-col flex-1 overflow-hidden transition-all ${!isPatientDetail ? 'mt-14 md:mt-0' : 'mt-[100px] md:mt-0'}`}>
                        {/* Desktop Portal Topbar (Only for Patient Detail) */}
                        <div className={`hidden md:flex shrink-0 bg-white/40 backdrop-blur-xl border-b border-slate-200/50 transition-all z-10 ${isPatientDetail ? 'h-14 items-center px-4' : 'h-0 overflow-hidden'}`}>
                             {/* The Portal target */}
                             <div id="header-actions-slot" className="flex items-center w-full gap-2 overflow-x-auto no-scrollbar" />
                        </div>

                        {/* Page Body */}
                        <div className={`flex-1 overflow-y-auto bg-transparent ${isPatientDetail ? 'flex flex-col min-h-0' : 'p-4 md:p-6 lg:p-8'}`}>
                            {children}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    )
}
