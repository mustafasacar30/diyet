"use client"

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Users, FileText, LayoutDashboard, UtensilsCrossed, ClipboardList, Eye, Shield, UserCog, Stethoscope, MessageCircle, Activity, Sparkles, ChefHat, Image as ImageIcon, Menu, LogOut, ChevronLeft, ChevronRight, ScrollText, ArrowLeft, ArrowRightLeft, Settings, BarChart3, FileSpreadsheet } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import React, { useState } from 'react'
import { UnreadListener } from '@/components/layout/unread-listener'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import AppStartupLoader from '@/components/ui/app-startup-loader'
import { SidebarProvider } from '@/contexts/sidebar-context'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const router = useRouter()
    const isPublicAuthPath = pathname === '/login' || pathname === '/register' || pathname?.startsWith('/auth/callback')
    const { isImpersonating, stopImpersonation, profile, signOut, user, loading, isStaff, isAdmin, scopeMode, setScopeMode } = useAuth()
    const [unreadCount, setUnreadCount] = useState(0)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [sidebarWidth, setSidebarWidth] = useState(260)
    const [isResizing, setIsResizing] = useState(false)
    const isSidebarCollapsed = sidebarWidth <= 60
    const [sidebarMode, setSidebarMode] = useState<'main' | 'patient'>('main')

    React.useEffect(() => {
        if (!isResizing) return;
        const handleMouseMove = (e: MouseEvent) => {
            let newWidth = e.clientX;
            if (newWidth < 220 && newWidth > 120) newWidth = 220; // Snap to min width
            if (newWidth <= 120) newWidth = 52; // Collapse
            if (newWidth > 600) newWidth = 600; // Max width
            setSidebarWidth(newWidth);
        };
        const handleMouseUp = () => setIsResizing(false);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);
    const isPatientDetail = pathname?.toLowerCase().includes('/patients/') && pathname !== '/patients'
    const startupName = profile?.full_name || user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : null)

    // --- HOOKS SECTION (Must be top level) ---

    // Sync sidebar mode to patient if we enter a patient detail page
    React.useEffect(() => {
        if (isPatientDetail) {
            setSidebarMode('patient')
        } else {
            setSidebarMode('main')
        }
    }, [isPatientDetail])

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

    if (loading && pathname?.startsWith('/patient') && user) {
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
        knowledgeTabs.push({ href: '/admin/recipes', label: 'Tarif Kartları', icon: ScrollText })
        knowledgeTabs.push({ href: '/admin/diseases', label: 'Hastalıklar', icon: Activity })

        aiTabs.push({ href: '/admin/food-discovery', label: 'AI Keşif', icon: ChefHat })
        aiTabs.push({ href: '/admin/card-maker', label: 'Kart Maker', icon: ImageIcon })
        aiTabs.push({ href: '/admin/pattern-insights', label: 'Oruntu Analizi', icon: BarChart3 })
        aiTabs.push({ href: '/admin/menu-import-pool', label: 'Drive İçe Aktar', icon: FileSpreadsheet })

        if (profile?.role === 'doctor' || profile?.role === 'dietitian') {
            adminTabs.push({ href: '/admin/settings/profile', label: 'Profil Ayarlar\u0131', icon: Settings })
        }

        // Doctor team view (non-admin doctors)
        if (profile?.role === 'doctor' && !isAdmin) {
            clinicalTabs.push({ href: '/admin/teams', label: 'Takımım', icon: Users })
        }

        if (isAdmin) {
            aiTabs.unshift({ href: '/admin/food-proposals', label: 'Yemek Önerileri', icon: Sparkles })
            
            adminTabs.push({ href: '/admin/users', label: 'Yönetici', icon: Shield })
            adminTabs.push({ href: '/admin/dietitians', label: 'Diyetisyenler', icon: UserCog })
            adminTabs.push({ href: '/admin/doctors', label: 'Doktorlar', icon: Stethoscope })
            adminTabs.push({ href: '/admin/teams', label: 'Takım Yapılandırması', icon: Users })
            adminTabs.push({ href: '/admin/logs', label: 'Sistem Logları', icon: ClipboardList })
        }
    }

    const allTabs = [...clinicalTabs, ...knowledgeTabs, ...aiTabs, ...adminTabs]
    const targetUserId = profile?.id || user.id

    const renderNavGroup = (title: string, items: any[]) => {
        if (items.length === 0) return null;
        return (
            <div className="mb-6">
                {!isSidebarCollapsed && (
                    <h4 className="px-5 text-[11px] font-bold text-slate-400/80 uppercase tracking-widest mb-3 transition-opacity duration-300">
                        {title}
                    </h4>
                )}
                {isSidebarCollapsed && (
                    <div className="px-5 border-b border-slate-200/30 mb-3 mx-2" />
                )}
                <div className="space-y-1">
                    {items.map(tab => {
                        const isActive = pathname === tab.href || (tab.href !== '/' && pathname?.startsWith(tab.href))
                        return (
                            <div key={tab.href} onClick={() => { router.push(tab.href); setSheetOpen(false) }} className="relative group">
                                <div className={`flex items-center transition-all duration-300 cursor-pointer text-sm font-medium relative border
                                    ${isSidebarCollapsed ? 'w-9 h-9 mx-auto justify-center rounded-lg' : 'py-2.5 px-4 mx-3 rounded-xl gap-3'}
                                    ${isActive 
                                    ? 'bg-blue-600 shadow-lg shadow-blue-500/20 text-white border-blue-500' 
                                    : 'bg-white/10 border-transparent text-slate-600 hover:bg-white/40 hover:border-slate-200/40 hover:text-slate-900'}`}>
                                    <tab.icon size={isSidebarCollapsed ? 18 : 18} className={`shrink-0 transition-all duration-300 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-blue-600'}`} />
                                    {!isSidebarCollapsed && <span className="flex-1 truncate">{tab.label}</span>}
                                    
                                    {tab.label === 'Mesajlar' && unreadCount > 0 && (
                                        <span className={`text-[10px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center shadow-sm 
                                            ${isSidebarCollapsed ? 'absolute -top-1 -right-1 z-10 scale-75' : ''}
                                            ${isActive ? 'bg-white text-blue-600' : 'bg-red-500 text-white'}`}>
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
        <SidebarProvider initialWidth={sidebarWidth}>
            <div className="h-screen flex flex-col bg-[#F8FAFC] overflow-hidden font-sans">
            <UnreadListener userId={targetUserId} onUpdate={setUnreadCount} />
            <ImpersonationBanner />

            <div className="flex flex-1 overflow-hidden">
                {/* BACKDROP BLUR SIDEBAR (Desktop) */}
                <aside 
                    className={`hidden md:flex flex-col bg-[#F9FBFC] border-r border-slate-200/50 shrink-0 z-20 shadow-[1px_0_10px_rgba(0,0,0,0.01)] relative ${isResizing ? 'transition-none select-none' : 'transition-all duration-300'}`}
                    style={{ width: `${sidebarWidth}px` }}
                >
                    {/* Resize Handle - Elegant Thin Line */}
                    <div 
                        className="absolute top-0 -right-[0.5px] w-[1px] h-full bg-slate-200/50 z-40 group-hover:bg-blue-400/50 transition-colors" 
                    />
                    
                    <div 
                        className="absolute top-0 -right-1.5 w-3.5 h-full cursor-col-resize z-50" 
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setIsResizing(true);
                        }} 
                    />

                    {/* Toggle Button */}
                    <button 
                        onClick={() => setSidebarWidth(isSidebarCollapsed ? 260 : 52)}
                        className="absolute -right-3 top-8 w-6 h-6 bg-blue-600 border border-blue-400 hover:bg-blue-700 hover:scale-110 rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.4)] z-50 group transition-all duration-300"
                    >
                        {isSidebarCollapsed ? (
                            <ChevronRight className="w-3.5 h-3.5 text-white" />
                        ) : (
                            <ChevronLeft className="w-3.5 h-3.5 text-white" />
                        )}
                    </button>

                    <div className={`h-16 flex items-center shrink-0 border-b border-slate-200/30 transition-all duration-300 ${isSidebarCollapsed ? 'px-0 justify-center' : 'px-4'}`}>
                        {isPatientDetail && sidebarMode === 'patient' ? (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => setSidebarMode('main')}
                                className={`group flex items-center bg-blue-50/50 hover:bg-blue-100/50 border border-blue-100/50 text-blue-700 transition-all ${isSidebarCollapsed ? 'w-10 h-10 p-0 rounded-lg justify-center' : 'w-full h-10 px-3 rounded-xl gap-2'}`}
                                title="Ana Menüye Dön"
                            >
                                <ArrowLeft className={`transition-transform duration-300 group-hover:-translate-x-1 ${isSidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4'}`} />
                                {!isSidebarCollapsed && <span className="font-bold text-xs uppercase tracking-tight">Ana Menü</span>}
                            </Button>
                        ) : isPatientDetail && sidebarMode === 'main' ? (
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => setSidebarMode('patient')}
                                className={`group flex items-center bg-emerald-50/50 hover:bg-emerald-100/50 border border-emerald-100/50 text-emerald-700 transition-all ${isSidebarCollapsed ? 'w-10 h-10 p-0 rounded-lg justify-center' : 'w-full h-10 px-3 rounded-xl gap-2'}`}
                                title="Hastaya Dön"
                            >
                                <Users className={`transition-transform duration-300 group-hover:scale-110 ${isSidebarCollapsed ? 'h-5 w-5' : 'h-4 w-4'}`} />
                                {!isSidebarCollapsed && <span className="font-bold text-xs uppercase tracking-tight">Hastaya Dön</span>}
                            </Button>
                        ) : (
                            <div 
                                onClick={() => router.push('/')}
                                className={`flex items-center cursor-pointer hover:bg-white/40 transition-all duration-300 w-full ${isSidebarCollapsed ? 'justify-center' : 'gap-3'}`}
                            >
                                <div className={`rounded-xl bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/30 transition-all duration-300 ${isSidebarCollapsed ? 'w-10 h-10' : 'w-8 h-8'}`}>
                                    <Sparkles className="w-4 h-4 text-white" />
                                </div>
                                {!isSidebarCollapsed && (
                                    <div className="font-extrabold bg-gradient-to-br from-slate-700 to-slate-900 bg-clip-text text-transparent tracking-tighter text-lg uppercase transition-all duration-300">
                                        Diyet Plan
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-hidden py-6 space-y-4">
                        <div className={sidebarMode === 'main' ? 'block' : 'hidden'}>
                            {renderNavGroup('Klinik & Hastalar', clinicalTabs)}
                            {renderNavGroup('Veritabanı', knowledgeTabs)}
                            {renderNavGroup('Yapay Zeka', aiTabs)}
                            {renderNavGroup('Sistem', adminTabs)}
                        </div>

                        <div className={`px-1 ${sidebarMode === 'patient' ? 'block' : 'hidden'}`}>
                            <div id="sidebar-patient-name-slot" className="px-5 text-[11px] font-bold text-blue-600/70 uppercase tracking-widest mb-4 empty:hidden"></div>
                            {/* This is where the Portal will inject patient actions */}
                            <div id="sidebar-actions-slot" className="space-y-1" />
                        </div>
                    </div>

                    {/* Profile Section */}
                    <div className={`p-4 mt-auto border-t border-slate-200/50 bg-white/20 backdrop-blur-md transition-all duration-300 flex flex-col gap-3 ${isSidebarCollapsed ? 'px-0 items-center' : ''}`}>
                            {/* Scope Toggle for Admin-authorized Doctors */}
                            {profile?.role === 'doctor' && !!profile?.is_global_access && (
                                <div className={`flex items-center justify-between pb-3 mb-1 border-b border-slate-200/50 ${isSidebarCollapsed ? 'flex-col gap-2' : ''}`}>
                                    {!isSidebarCollapsed ? (
                                        <>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${scopeMode === 'global' ? 'text-blue-600' : 'text-slate-500'}`}>
                                                <ArrowRightLeft size={12} />
                                                {scopeMode === 'global' ? 'Global Mod' : 'Takım Modu'}
                                            </span>
                                            <Switch 
                                                checked={scopeMode === 'team'}
                                                onCheckedChange={(c) => setScopeMode(c ? 'team' : 'global')}
                                                className="scale-75 data-[state=unchecked]:bg-blue-600"
                                            />
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center gap-2 relative group" title={scopeMode === 'global' ? 'Global Mod' : 'Takım Modu'}>
                                            <Switch 
                                                checked={scopeMode === 'team'}
                                                onCheckedChange={(c) => setScopeMode(c ? 'team' : 'global')}
                                                className="scale-50 data-[state=unchecked]:bg-blue-600"
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className={`flex items-center w-full ${isSidebarCollapsed ? 'flex-col gap-3' : 'gap-3'}`}>
                                <div className={`rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 font-bold shrink-0 shadow-inner transition-all duration-300 ${isSidebarCollapsed ? 'w-8 h-8 text-xs' : 'w-10 h-10'}`}>
                                    {profile?.full_name?.charAt(0) || 'U'}
                                </div>

                                {!isSidebarCollapsed && (
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-slate-800 truncate">{profile?.full_name}</p>
                                        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{isAdmin ? 'Yönetici' : 'Diyetisyen'}</p>
                                    </div>
                                )}

                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={handleLogout} 
                                    className={`text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0 transition-all duration-300 ${isSidebarCollapsed ? 'h-9 w-9' : 'h-8 w-8'}`}
                                    title="Çıkış Yap"
                                >
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
                                        <SheetTitle className="sr-only">Menü</SheetTitle>
                                        <SheetDescription className="sr-only">Navigasyon menüsü</SheetDescription>
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
                        {/* Page Body */}
                        <div className={`flex-1 overflow-y-auto bg-transparent ${isPatientDetail ? 'flex flex-col min-h-0' : 'p-4 md:p-6 lg:p-8'}`}>
                            {children}
                        </div>
                    </div>
                </main>
            </div>
        </div>
    </SidebarProvider>
    )
}
