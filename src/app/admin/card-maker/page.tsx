"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/auth-context"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"
import { Search, ChefHat, ExternalLink, RefreshCw, CheckCircle2, CircleDot, Pencil, Database, Trash2, Image as ImageIcon, HelpCircle, EyeOff, Eye, Undo2 } from 'lucide-react'
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FoodEditDialog } from "@/components/diet/food-sidebar"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type FoodStatus = 'none' | 'draft' | 'published'

interface FoodItem {
    id: string
    name: string
    category: string
    role: string
    calories: number
    protein: number
    carbs: number
    fat: number
    ingredients: string
    recipe_text: string
    portion_unit: string
    ai_analysis: any
    unit: string
    meta: any
    syncStatus: FoodStatus
}

function makeSafeFileName(str: string): string {
    if (!str) return ""
    const charMap: Record<string, string> = {
        'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's',
        'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u',
        'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c',
        'I': 'i'
    }
    let safeStr = str.replace(/[ıİşŞğĞüÜöÖçÇI]/g, match => charMap[match] || match)
    safeStr = safeStr.toLowerCase().replace(/[^a-z0-9\s_.-]/g, "").trim().replace(/\s+/g, "_")
    return safeStr
}

export default function CardMakerPage() {
    const { scopeMode } = useAuth()
    const [foods, setFoods] = useState<FoodItem[]>([])
    const [filteredFoods, setFilteredFoods] = useState<FoodItem[]>([])
    const [search, setSearch] = useState('')
    const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [iframeReady, setIframeReady] = useState(false)
    const [apiKeys, setApiKeys] = useState<{ geminiKey: string | null, githubPat: string | null, usdaKey: string | null } | null>(null)
    const [sysPrompts, setSysPrompts] = useState<any | null>(null)
    const [discoverySearchSites, setDiscoverySearchSites] = useState<string>("")
    const [githubData, setGithubData] = useState<{ publishedCards: { name: string, imageUrl: string }[], draftCards: { name: string, thumbUrl: string }[] }>({ publishedCards: [], draftCards: [] })
    const [deleteTarget, setDeleteTarget] = useState<FoodItem | null>(null)
    const [editFood, setEditFood] = useState<FoodItem | null>(null)
    const [showGuide, setShowGuide] = useState(false)
    const [imagePreview, setImagePreview] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState<FoodStatus | 'all'>('all')
    const [showHidden, setShowHidden] = useState(false)
    const [hiddenFoodIds, setHiddenFoodIds] = useState<Set<string>>(new Set())
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const foodsRef = useRef<FoodItem[]>([])

    useEffect(() => {
        foodsRef.current = foods
    }, [foods])

    useEffect(() => {
        fetchFoods()
        fetchApiKeys()
        fetchSystemPrompts()
        fetchGithubSync()
        fetchDiscoverySettings()

        const handleMessage = async (event: MessageEvent) => {
            const msg = event.data;
            if (!msg || !msg.type) return;

            if (msg.type === 'CARD_MAKER_READY') {
                setIframeReady(true)
            }
            if (msg.type === 'REQUEST_FOOD_INDEX') {
                iframeRef.current?.contentWindow?.postMessage({
                    type: 'SET_FOOD_INDEX',
                    foods: foodsRef.current.map((food) => ({
                        id: food.id,
                        name: food.name || "",
                        category: food.category || ""
                    }))
                }, '*')
            }
            // When a card is saved/exported from the iframe, refresh the sync status
            if (msg.type === 'CARD_SAVED' || msg.type === 'CARD_EXPORTED') {
                fetchGithubSync()
            }

            // --- Visual Template Management ---
            if (msg.type === 'GET_VISUAL_TEMPLATES') {
                const { data } = await supabase.from('system_settings').select('value').eq('key', 'cardmaker_templates').maybeSingle()
                const templates = data?.value || []
                iframeRef.current?.contentWindow?.postMessage({ type: 'SET_VISUAL_TEMPLATES', templates }, '*')
            }

            if (msg.type === 'SAVE_VISUAL_TEMPLATE') {
                const { template } = msg
                const { data: current } = await supabase.from('system_settings').select('value').eq('key', 'cardmaker_templates').maybeSingle()
                let templates = current?.value || []
                
                // Update or Add
                const index = templates.findIndex((t: any) => t.id === template.id)
                if (index >= 0) {
                    templates[index] = template
                } else {
                    templates.push(template)
                }

                await supabase.from('system_settings').upsert({
                    key: 'cardmaker_templates',
                    value: templates,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key' })

                // Refresh iframe
                iframeRef.current?.contentWindow?.postMessage({ type: 'SET_VISUAL_TEMPLATES', templates }, '*')
            }

            if (msg.type === 'DELETE_VISUAL_TEMPLATE') {
                const { id } = msg
                const { data: current } = await supabase.from('system_settings').select('value').eq('key', 'cardmaker_templates').maybeSingle()
                let templates = current?.value || []
                
                templates = templates.filter((t: any) => t.id !== id)

                await supabase.from('system_settings').upsert({
                    key: 'cardmaker_templates',
                    value: templates,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'key' })

                // Refresh iframe
                iframeRef.current?.contentWindow?.postMessage({ type: 'SET_VISUAL_TEMPLATES', templates }, '*')
            }
        }
        window.addEventListener('message', handleMessage)
        return () => window.removeEventListener('message', handleMessage)
    }, [])

    // Re-fetch foods when scope mode changes (team/global toggle)
    useEffect(() => {
        fetchFoods()
    }, [scopeMode])

    const fetchDiscoverySettings = async () => {
        const { data } = await supabase.from('system_settings').select('value').eq('key', 'discovery_search_sites').maybeSingle()
        if (data) {
            let activeSites = ""
            if (Array.isArray(data.value)) {
                activeSites = data.value.filter((s: any) => s.enabled).map((s: any) => s.url).join(', ')
            } else if (typeof data.value === 'string') {
                activeSites = data.value
            }
            setDiscoverySearchSites(activeSites)
        }
    }

    useEffect(() => {
        if (iframeReady && apiKeys && sysPrompts && iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
                type: 'INJECT_KEYS',
                geminiKey: apiKeys.geminiKey,
                githubPat: apiKeys.githubPat,
                usdaKey: apiKeys.usdaKey,
                prompts: sysPrompts,
                discoverySearchSites: discoverySearchSites
            }, '*')
        }
    }, [iframeReady, apiKeys, sysPrompts, discoverySearchSites])

    useEffect(() => {
        if (!iframeReady || !iframeRef.current?.contentWindow) return

        const foodsIndex = foods.map((food) => ({
            id: food.id,
            name: food.name || "",
            category: food.category || ""
        }))

        iframeRef.current.contentWindow.postMessage({
            type: 'SET_FOOD_INDEX',
            foods: foodsIndex
        }, '*')
    }, [iframeReady, foods])

    // Compute sync status + sort whenever foods or githubData changes
    const sortedFoods = useCallback(() => {
        const withStatus = foods.map(food => {
            const safeName = makeSafeFileName(food.name)
            const fnClean = safeName.replace(/[^a-z0-9]/g, '')
            let syncStatus: FoodStatus = 'none'
            let cardImageUrl: string | null = null

            // Check if published (Green ✓)
            const publishedMatch = githubData.publishedCards.find(pc => {
                const pcClean = pc.name.toLowerCase().replace(/[^a-z0-9]/g, '')
                return pcClean.includes(fnClean) || fnClean.includes(pcClean)
            })

            if (publishedMatch) {
                syncStatus = 'published'
                cardImageUrl = publishedMatch.imageUrl
            } else {
                // Check if draft exists (Blue ○)
                const draftMatch = githubData.draftCards.find(dc => {
                    const dnBase = dc.name.replace(/_\d{10,}$/, '')
                    const dnClean = dnBase.toLowerCase().replace(/[^a-z0-9]/g, '')
                    return dnClean.includes(fnClean) || fnClean.includes(dnClean)
                })
                if (draftMatch) {
                    syncStatus = 'draft'
                    cardImageUrl = draftMatch.thumbUrl || null
                }
            }

            return { ...food, syncStatus, cardImageUrl: cardImageUrl || undefined }
        })

        // Sort: none first, then draft, then published
        const statusOrder: Record<FoodStatus, number> = { none: 0, draft: 1, published: 2 }
        withStatus.sort((a, b) => {
            const diff = statusOrder[a.syncStatus] - statusOrder[b.syncStatus]
            if (diff !== 0) return diff
            return (a.name || '').localeCompare(b.name || '', 'tr')
        })

        if (statusFilter !== 'all') {
            return withStatus.filter(f => f.syncStatus === statusFilter)
        }

        return withStatus
    }, [foods, githubData, statusFilter])

    async function hideFood(foodId: string) {
        try {
            const { error } = await supabase.from('foods').update({ hidden_from_cardmaker: true }).eq('id', foodId)
            if (error) throw error
            setHiddenFoodIds(prev => {
                const next = new Set(prev)
                next.add(foodId)
                return next
            })
        } catch (e: any) {
            console.error('Hide error:', e)
            alert('Gizleme hatası: ' + e.message)
        }
    }

    async function restoreFood(foodId: string) {
        try {
            const { error } = await supabase.from('foods').update({ hidden_from_cardmaker: false }).eq('id', foodId)
            if (error) throw error
            setHiddenFoodIds(prev => {
                const next = new Set(prev)
                next.delete(foodId)
                return next
            })
        } catch (e: any) {
            console.error('Restore error:', e)
            alert('Geri ekleme hatası: ' + e.message)
        }
    }
    useEffect(() => {
        const sorted = sortedFoods()
        const visible = showHidden
            ? sorted.filter(f => hiddenFoodIds.has(f.id))
            : sorted.filter(f => !hiddenFoodIds.has(f.id))
        if (!search.trim()) {
            setFilteredFoods(visible)
            return
        }
        const s = search.toLowerCase()
        setFilteredFoods(visible.filter(f => f.name?.toLowerCase().includes(s) || f.category?.toLowerCase().includes(s)))
    }, [search, sortedFoods, hiddenFoodIds, showHidden])

    async function fetchGithubSync() {
        try {
            const res = await fetch('/api/admin/github-sync-check')
            if (res.ok) {
                const data = await res.json()
                setGithubData(data)
            }
        } catch (e) {
            console.warn('GitHub sync check failed:', e)
        }
    }

    async function fetchSystemPrompts() {
        try {
            const res = await fetch('/api/admin/system-prompts')
            if (res.ok) {
                const data = await res.json()
                setSysPrompts(data.prompts)
            }
        } catch (error) {
            console.error('Error fetching system prompts:', error)
        }
    }

    async function fetchApiKeys() {
        try {
            const res = await fetch('/api/admin/card-maker-keys')
            if (res.ok) {
                const data = await res.json()
                setApiKeys(data)
            }
        } catch (error) {
            console.error("Error fetching API keys:", error)
        }
    }

    async function fetchFoods() {
        setIsLoading(true)
        try {
            // Resolve team scope for filtering
            const teamScope = await resolveTeamScopeContextFromAuth()
            // Respect UI toggle: even admin in 'team' mode should see team-filtered view
            const isTeamMode = scopeMode === 'team' || (!teamScope.canUseGlobal && !!teamScope.teamOwnerId)
            // For admin in team mode, use their own userId as teamOwnerId
            const teamOwnerId = teamScope.teamOwnerId || (isTeamMode ? teamScope.userId : null)

            const { data, error } = await supabase
                .from('foods')
                .select('*')
                .not('ingredients', 'is', null)
                .neq('ingredients', '')
                .order('name')

            if (error) throw error

            let allFoods = (data || []) as (FoodItem & { hidden_from_cardmaker?: boolean })[]

            // Client-side team filtering
            if (isTeamMode && teamOwnerId) {
                // Team mode: show ONLY this team's own foods
                allFoods = allFoods.filter(food => {
                    return food.meta?.team_owner_id === teamOwnerId
                })
            }
            
            // Build hidden IDs set from DB column
            const hiddenIds = new Set<string>()
            allFoods.forEach(f => {
                if (f.hidden_from_cardmaker) hiddenIds.add(f.id)
            })
            setHiddenFoodIds(hiddenIds)
            setFoods(allFoods as FoodItem[])
        } catch (error) {
            console.error("Error fetching foods with ingredients:", error)
        } finally {
            setIsLoading(false)
        }
    }

    function handleFoodSelect(food: FoodItem) {
        setSelectedFood(food)

        if (iframeRef.current?.contentWindow) {
            const calStr = (food.calories && food.calories > 0) ? `${Math.round(food.calories)} kcal` : "-"
            const protStr = (food.protein && food.protein > 0) ? `${food.protein} gram` : "-"
            const carbStr = (food.carbs && food.carbs > 0) ? `${food.carbs} gram` : "-"
            const fatStr = (food.fat && food.fat > 0) ? `${food.fat} gram` : "-"

            const totalServings = food.ai_analysis?.total_servings || 1
            const portionUnit = food.unit || food.portion_unit || 'porsiyon'

            iframeRef.current.contentWindow.postMessage({
                type: 'LOAD_RECIPE',
                data: {
                    title: food.name,
                    ingredients: food.ingredients,
                    preparation: food.recipe_text || "",
                    servings: `${totalServings} ${portionUnit}`,
                    macros: {
                        kalori: calStr,
                        protein: protStr,
                        karbonhidrat: carbStr,
                        yag: fatStr
                    }
                }
            }, '*')
        }
    }

    async function handleDelete() {
        if (!deleteTarget) return
        try {
            const { error } = await supabase
                .from('foods')
                .delete()
                .eq('id', deleteTarget.id)

            if (error) throw error
            setFoods(prev => prev.filter(f => f.id !== deleteTarget.id))
            if (selectedFood?.id === deleteTarget.id) setSelectedFood(null)
        } catch (error: any) {
            console.error('Delete error:', error)
            alert('Silme hatası: ' + error.message)
        } finally {
            setDeleteTarget(null)
        }
    }

    function handleEditDB(food: FoodItem) {
        setEditFood(food)
    }

    function getStatusIcon(status: FoodStatus) {
        switch (status) {
            case 'published':
                return <span title="GitHub'a yayınlandı"><CheckCircle2 size={16} className="text-green-500 shrink-0" /></span>
            case 'draft':
                return <span title="Taslak kartı mevcut"><CircleDot size={16} className="text-blue-500 shrink-0" /></span>
            default:
                return <div className="w-4 h-4 rounded-full border-2 border-dashed border-gray-300 shrink-0" title="Henüz işlenmedi" />
        }
    }

    function getStatusBadge(status: FoodStatus) {
        switch (status) {
            case 'published':
                return <span className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 rounded-full border border-green-200">Yayında</span>
            case 'draft':
                return <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-200">Taslak</span>
            default:
                return <span className="text-[10px] px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded-full border border-gray-200">Bekliyor</span>
        }
    }

    const allVisible = sortedFoods().filter(f => !hiddenFoodIds.has(f.id))
    const statusCounts = {
        none: allVisible.filter(f => f.syncStatus === 'none').length,
        draft: allVisible.filter(f => f.syncStatus === 'draft').length,
        published: allVisible.filter(f => f.syncStatus === 'published').length,
    }

    return (
        <div className="flex h-[calc(100vh-theme(spacing.16))] bg-white">
            {/* Left Sidebar - Food List */}
            <div className="w-80 border-r flex flex-col bg-gray-50 shrink-0">
                <div className="p-4 border-b bg-white">
                    <div className="flex items-center justify-between mb-1">
                        <h2 className="font-semibold text-lg flex items-center gap-2">
                            <ChefHat className="text-blue-600" size={20} />
                            Kart Yöneticisi
                        </h2>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowGuide(true)} title="Nasıl Kullanılır?">
                                <HelpCircle size={16} className="text-gray-400" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { fetchFoods(); fetchGithubSync() }} title="Yenile">
                                <RefreshCw size={14} className="text-gray-400" />
                            </Button>
                        </div>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">Malzemesi olan yemekler • Sıralama: Bekleyenler üstte</p>

                    {/* Status summary bar acts as filter */}
                    <div className="flex items-center gap-2 text-[10px] mb-3 bg-gray-100 p-1.5 rounded-md">
                        <button
                            onClick={() => setStatusFilter('all')}
                            className={`px-2 py-1 flex items-center gap-1 rounded transition-colors ${statusFilter === 'all' ? 'bg-white shadow-sm font-bold text-gray-800' : 'text-gray-500 hover:bg-gray-200'}`}
                        >
                            Tümü
                        </button>
                        <button
                            onClick={() => setStatusFilter('none')}
                            className={`px-2 py-1 flex items-center gap-1 rounded transition-colors ${statusFilter === 'none' ? 'bg-white shadow-sm font-bold text-gray-800' : 'text-gray-500 hover:bg-gray-200'}`}
                        >
                            <div className={`w-2 h-2 rounded-full border-2 border-dashed ${statusFilter === 'none' ? 'border-gray-800' : 'border-gray-400'}`} />
                            {statusCounts.none}
                        </button>
                        <button
                            onClick={() => setStatusFilter('draft')}
                            className={`px-2 py-1 flex items-center gap-1 rounded transition-colors ${statusFilter === 'draft' ? 'bg-white shadow-sm font-bold text-blue-700' : 'text-blue-600/70 hover:bg-blue-50'}`}
                        >
                            <CircleDot size={10} /> {statusCounts.draft}
                        </button>
                        <button
                            onClick={() => setStatusFilter('published')}
                            className={`px-2 py-1 flex items-center gap-1 rounded transition-colors ${statusFilter === 'published' ? 'bg-white shadow-sm font-bold text-green-700' : 'text-green-600/70 hover:bg-green-50'}`}
                        >
                            <CheckCircle2 size={10} /> {statusCounts.published}
                        </button>
                        <button
                            onClick={() => setShowHidden(!showHidden)}
                            className={`px-2 py-1 flex items-center gap-1 rounded transition-colors ml-auto ${showHidden ? 'bg-white shadow-sm font-bold text-orange-700' : 'text-orange-500/70 hover:bg-orange-50'}`}
                            title="Gizlenen yemekleri göster"
                        >
                            <EyeOff size={10} /> {hiddenFoodIds.size > 0 ? hiddenFoodIds.size : ''}
                        </button>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Yemek ara..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9 h-9 text-sm"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    {isLoading ? (
                        <div className="flex justify-center p-8">
                            <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
                        </div>
                    ) : filteredFoods.length === 0 ? (
                        <div className="text-center p-8 text-sm text-gray-500">
                            Malzemesi olan yemek bulunamadı.
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredFoods.map(food => (
                                <div
                                    key={food.id}
                                    className={`group w-full text-left p-2.5 rounded-md transition-colors text-sm cursor-pointer ${
                                        selectedFood?.id === food.id
                                            ? 'bg-blue-50 border border-blue-200'
                                            : 'hover:bg-gray-100 border border-transparent'
                                    }`}
                                    onClick={() => handleFoodSelect(food)}
                                >
                                    <div className="flex items-start gap-2">
                                        {getStatusIcon(food.syncStatus)}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-medium text-gray-900 truncate text-[13px]">{food.name}</span>
                                                {(food as any).cardImageUrl && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setImagePreview((food as any).cardImageUrl) }}
                                                        className="shrink-0 rounded overflow-hidden border border-green-200 hover:border-green-400 hover:shadow-sm transition-all"
                                                        title="Tarif kartını görüntüle"
                                                    >
                                                        <img src={(food as any).cardImageUrl} alt="kart" className="w-5 h-5 object-cover" loading="lazy" />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                {getStatusBadge(food.syncStatus)}
                                                <span className="text-[10px] text-gray-400 truncate">{food.category || 'Genel'}</span>
                                            </div>
                                        </div>

                                        {/* Action buttons - visible on hover */}
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleFoodSelect(food) }}
                                                className="p-1 rounded hover:bg-blue-100 text-blue-600"
                                                title="Kartı Hazırla"
                                            >
                                                <ImageIcon size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleEditDB(food) }}
                                                className="p-1 rounded hover:bg-amber-100 text-amber-600"
                                                title="Veritabanını Düzenle"
                                            >
                                                <Database size={14} />
                                            </button>
                                            {showHidden ? (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); restoreFood(food.id) }}
                                                    className="p-1 rounded hover:bg-green-100 text-green-600"
                                                    title="Listeye Geri Ekle"
                                                >
                                                    <Undo2 size={14} />
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); hideFood(food.id) }}
                                                        className="p-1 rounded hover:bg-orange-100 text-orange-500"
                                                        title="Listeden Gizle"
                                                    >
                                                        <EyeOff size={14} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(food) }}
                                                        className="p-1 rounded hover:bg-red-100 text-red-500"
                                                        title="Veritabanından Sil"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Area - Iframe */}
            <div className="flex-1 flex flex-col relative overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b bg-white shrink-0">
                    <div className="text-sm text-gray-600 font-medium">
                        Kart Editörü 
                        {iframeReady && apiKeys?.geminiKey ? (
                            <span className="text-green-600 ml-2 text-xs font-normal px-2 py-0.5 bg-green-50 rounded border border-green-200">API Anahtarları Aktif</span>
                        ) : (
                            <span className="text-orange-600 ml-2 text-xs font-normal px-2 py-0.5 bg-orange-50 rounded border border-orange-200">Yükleniyor...</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => window.open('/kart-maker/index.html', '_blank')}>
                            <ExternalLink size={14} /> Yeni Sekmede Aç
                        </Button>
                    </div>
                </div>
                
                <iframe 
                    ref={iframeRef}
                    src="/kart-maker/index.html" 
                    className="flex-1 w-full border-none bg-gray-50"
                    title="Card Maker"
                />
            </div>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Yemeği Sil</AlertDialogTitle>
                        <AlertDialogDescription>
                            <strong>{deleteTarget?.name}</strong> yemeğini veritabanından kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                            Evet, Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Guide Modal */}
            {/* Inline Food Edit Dialog */}
            {editFood && (
                <FoodEditDialog
                    food={editFood}
                    isOpen={!!editFood}
                    onClose={() => setEditFood(null)}
                    onUpdate={() => { fetchFoods(); setEditFood(null) }}
                />
            )}

            {showGuide && (
                <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-8" onClick={() => setShowGuide(false)}>
                    <div className="bg-white rounded-xl max-w-lg w-full max-h-[80vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="p-6 border-b flex items-center justify-between">
                            <h2 className="text-lg font-bold text-gray-900">📖 Kart Yapıcı Rehberi</h2>
                            <button onClick={() => setShowGuide(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                        </div>
                        <div className="p-6 space-y-4 text-sm text-gray-700">
                            <div>
                                <h3 className="font-bold text-gray-900 mb-1">🎯 Durum İkonları</h3>
                                <ul className="space-y-1.5 ml-1">
                                    <li className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full border-2 border-dashed border-gray-300" />
                                        <span><strong>Bekliyor:</strong> Henüz kart oluşturulmamış. Üstte sıralanır.</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <CircleDot size={12} className="text-blue-500 shrink-0" />
                                        <span><strong>Taslak:</strong> Kart taslağı GitHub&apos;a kaydedildi.</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                                        <span><strong>Yayında:</strong> Kart Lipodem paneline başarıyla gönderildi.</span>
                                    </li>
                                </ul>
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 mb-1">🛠️ Eylem Butonları</h3>
                                <ul className="space-y-1.5 ml-1">
                                    <li className="flex items-center gap-2">
                                        <ImageIcon size={12} className="text-blue-600 shrink-0" />
                                        <span><strong>Kartı Hazırla:</strong> Yemeği sağdaki editöre yükler.</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Database size={12} className="text-amber-600 shrink-0" />
                                        <span><strong>Veritabanını Düzenle:</strong> Yemeğin makro/malzeme bilgilerini düzenler.</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <Trash2 size={12} className="text-red-500 shrink-0" />
                                        <span><strong>Sil:</strong> Yemeği kalıcı olarak veritabanından kaldırır.</span>
                                    </li>
                                </ul>
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 mb-1">📋 İş Akışı</h3>
                                <ol className="list-decimal ml-5 space-y-1">
                                    <li>Soldaki listeden bir yemek seçin (tıklayın).</li>
                                    <li>Sağdaki editörde <strong>&quot;Tek Tıkla Kart Oluştur&quot;</strong> butonuna basın.</li>
                                    <li>AI otomatik olarak metin, görsel ve makroları üretecektir.</li>
                                    <li>Kartı beğendiyseniz <strong>&quot;Lipodem Paneline Aktar&quot;</strong> ile yayınlayın.</li>
                                    <li>Yayınlanan kart yeşil tik ile işaretlenir ✅</li>
                                </ol>
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 mb-1">🔬 USDA Makro Doğrulama</h3>
                                <p>AI Keşif ile oluşturulan yeni yemekler artık otomatik olarak USDA veritabanından doğrulanıyor. Bu sayede makro değerler %100 bilimsel hassasiyetle hesaplanır.</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Fullscreen Image Preview */}
            {imagePreview && (
                <div
                    className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-8 cursor-pointer"
                    onClick={() => setImagePreview(null)}
                >
                    <div className="relative max-w-2xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setImagePreview(null)}
                            className="absolute -top-3 -right-3 bg-white rounded-full w-8 h-8 flex items-center justify-center shadow-lg text-gray-600 hover:text-gray-900 z-10"
                        >✕</button>
                        <img
                            src={imagePreview}
                            alt="Tarif Kartı"
                            className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
