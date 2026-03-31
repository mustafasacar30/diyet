"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles, ArrowRight, ChefHat, Leaf, DollarSign, MapPin, Clock } from "lucide-react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { Settings, Save, Trash2 } from "lucide-react"
import { useEffect } from "react"

const EXAMPLE_PROMPTS = [
    { icon: <MapPin size={14} />, text: "Denizli yöresinden, kış aylarında, ketojenik beslenmeye uygun 5 ana yemek" },
    { icon: <DollarSign size={14} />, text: "Maliyeti düşük, yüksek proteinli, sporcu beslenmesine uygun 5 kahvaltılık" },
    { icon: <Leaf size={14} />, text: "Vejetaryen, düşük karbonhidratlı, glütensiz 3 öğle yemeği" },
    { icon: <Clock size={14} />, text: "15 dakikada hazırlanabilecek, pratik, low-carb 5 akşam yemeği" },
]

export default function FoodDiscoveryPage() {
    const [prompt, setPrompt] = useState("")
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<{ success: boolean; count: number; proposals: any[] } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [searchSites, setSearchSites] = useState<{ url: string; enabled: boolean }[]>([])
    const [newSite, setNewSite] = useState("")
    const [savingSettings, setSavingSettings] = useState(false)
    const [showSettings, setShowSettings] = useState(false)

    // New states for interaction
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
    const [proceeding, setProceeding] = useState(false)

    useEffect(() => {
        fetchSettings()
    }, [])

    const fetchSettings = async () => {
        const { data } = await supabase.from('system_settings').select('value').eq('key', 'discovery_search_sites').maybeSingle()
        if (data) {
            if (Array.isArray(data.value)) {
                setSearchSites(data.value)
            } else if (typeof data.value === 'string') {
                // Migration from legacy string
                const legacy = data.value.split(',').map(s => ({ url: s.trim(), enabled: true })).filter(s => s.url)
                setSearchSites(legacy)
            }
        }
    }

    const saveSettings = async () => {
        setSavingSettings(true)
        try {
            await supabase.from('system_settings').upsert({
                key: 'discovery_search_sites',
                value: searchSites,
                updated_at: new Date().toISOString()
            }, { onConflict: 'key' })
        } catch (err) {
            console.error(err)
        } finally {
            setSavingSettings(false)
        }
    }

    const addSite = () => {
        if (!newSite.trim()) return
        let url = newSite.trim().toLowerCase()
        if (url.startsWith('http://')) url = url.replace('http://', '')
        if (url.startsWith('https://')) url = url.replace('https://', '')
        if (url.endsWith('/')) url = url.slice(0, -1)
        
        if (!searchSites.some(s => s.url === url)) {
            setSearchSites([...searchSites, { url, enabled: true }])
        }
        setNewSite("")
    }

    const removeSite = (url: string) => {
        setSearchSites(searchSites.filter(s => s.url !== url))
    }

    const toggleSite = (url: string) => {
        setSearchSites(searchSites.map(s => s.url === url ? { ...s, enabled: !s.enabled } : s))
    }

    const handleDiscover = async () => {
        if (!prompt.trim()) return

        setLoading(true)
        setResult(null)
        setError(null)

        try {
            const res = await fetch("/api/admin/food-discovery", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: prompt.trim() }),
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || "Bir hata oluştu")
            }

            setResult(data)
            setCheckedIds(new Set(data.proposals.map((p: any) => p.id)))
            setExpandedIds(new Set())
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="container mx-auto py-8 max-w-4xl">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg">
                        <ChefHat size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">AI Yemek Keşif Motoru</h1>
                        <p className="text-sm text-gray-500">Yapay zeka ile yeni yemekler keşfedin ve veritabanınıza ekleyin</p>
                    </div>
                </div>
            </div>

            {/* Main Prompt Area */}
            <div className="bg-white rounded-2xl border-2 border-gray-100 shadow-sm p-6 mb-6">
                <label className="block text-sm font-semibold text-gray-700 mb-3">
                    <Sparkles size={14} className="inline mr-1.5 text-violet-500" />
                    Yapay Zekaya Yönergenizi Verin
                </label>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Örnek: Denizli yöresinden, şubat ayı sebzelerini düşünerek, ketojenik beslenmeye uygun, maliyeti düşük 5 akşam yemeği istiyorum. Pratik hazırlanabilecek yemekler olsun."
                    className="w-full min-h-[140px] rounded-xl border-2 border-gray-200 px-4 py-3 text-sm focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:outline-none transition-all resize-none"
                    disabled={loading}
                />

                <div className="flex items-center justify-between mt-4">
                    <p className="text-xs text-gray-400">
                        Bölge, mevsim, diyet tipi, bütçe, öğün türü, pratiklik gibi ne kadar detay verirseniz o kadar isabetli sonuçlar alırsınız.
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setShowSettings(!showSettings)}
                            className="px-3 rounded-xl border-gray-200 text-gray-500 hover:text-violet-600"
                            title="Arama Ayarları"
                        >
                            <Settings size={18} />
                        </Button>
                        <Button
                            onClick={handleDiscover}
                            disabled={loading || !prompt.trim()}
                            className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white px-6 py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    AI Üretiyor...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={16} />
                                    Yemekleri Keşfet
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Search Settings Toggle Area */}
                {showSettings && (
                    <div className="mt-4 pt-4 border-t border-gray-100 animate-in fade-in slide-in-from-top-2 duration-300">
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">
                            🔎 Dahil Edilecek Kaynaklar (Web Siteleri)
                        </label>
                        
                        <div className="flex gap-2 mb-4">
                            <input
                                value={newSite}
                                onChange={(e) => setNewSite(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addSite()}
                                placeholder="Örn: nefisyemektarifleri.com"
                                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs focus:ring-1 focus:ring-violet-500 outline-none"
                            />
                            <Button 
                                size="sm" 
                                onClick={addSite}
                                className="bg-violet-100 text-violet-700 hover:bg-violet-200 px-4"
                            >
                                Ekle
                            </Button>
                        </div>

                        {searchSites.length > 0 ? (
                            <div className="space-y-2 mb-4 max-h-[200px] overflow-y-auto pr-1">
                                {searchSites.map((site) => (
                                    <div key={site.url} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                                        <div className="flex items-center gap-3">
                                            <input 
                                                type="checkbox" 
                                                checked={site.enabled} 
                                                onChange={() => toggleSite(site.url)}
                                                className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
                                            />
                                            <span className={`text-xs font-medium ${site.enabled ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                                                {site.url}
                                            </span>
                                        </div>
                                        <button 
                                            onClick={() => removeSite(site.url)}
                                            className="text-gray-400 hover:text-red-500 transition-colors"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-4 border-2 border-dashed border-gray-100 rounded-xl mb-4">
                                <p className="text-[11px] text-gray-400 italic">Henüz site eklenmedi. Tüm internette arama yapılacak.</p>
                            </div>
                        )}

                        <div className="flex justify-between items-center bg-violet-50/50 p-3 rounded-xl border border-violet-100/50">
                            <p className="text-[10px] text-violet-600/70 max-w-[240px]">
                                Seçili siteler veritabanına kaydedilir ve Keşif motoruna kısıt olarak gönderilir.
                            </p>
                            <Button 
                                size="sm" 
                                onClick={saveSettings} 
                                disabled={savingSettings}
                                className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-6 h-9 flex gap-2"
                            >
                                {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                Ayarları Kaydet
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Example Prompts */}
            {!result && !loading && (
                <div className="mb-6">
                    <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Örnek komutlar</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {EXAMPLE_PROMPTS.map((ex, i) => (
                            <button
                                key={i}
                                onClick={() => setPrompt(ex.text)}
                                className="flex items-center gap-2 text-left text-sm text-gray-600 bg-gray-50 hover:bg-violet-50 hover:text-violet-700 border border-gray-100 hover:border-violet-200 rounded-lg px-3 py-2.5 transition-all"
                            >
                                <span className="text-gray-400">{ex.icon}</span>
                                {ex.text}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Loading State */}
            {loading && (
                <div className="bg-violet-50 border-2 border-violet-100 rounded-2xl p-8 text-center">
                    <Loader2 size={40} className="animate-spin text-violet-500 mx-auto mb-4" />
                    <p className="text-violet-700 font-medium">Yapay zeka yemekleri araştırıyor...</p>
                    <p className="text-violet-500 text-sm mt-1">Bu işlem 10-20 saniye sürebilir</p>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="bg-red-50 border-2 border-red-100 rounded-2xl p-6 text-center">
                    <p className="text-red-700 font-medium">❌ Hata Oluştu</p>
                    <p className="text-red-500 text-sm mt-1">{error}</p>
                    <Button variant="outline" onClick={() => setError(null)} className="mt-3">
                        Tekrar Dene
                    </Button>
                </div>
            )}

            {/* Success State */}
            {result && result.success && (
                <div className="bg-green-50 border-2 border-green-100 rounded-2xl p-6">
                    <div className="text-center mb-6">
                        <p className="text-green-700 font-bold text-lg">
                            ✅ {result.count} yeni yemek başarıyla keşfedildi!
                        </p>
                        <p className="text-green-600 text-sm mt-1">
                            Yemekler "Onay Bekleyenler" havuzuna eklendi. Aşağıdaki önizlemeyi kontrol edip, onay sayfasından düzenleyebilirsiniz.
                        </p>
                    </div>

                    {/* Preview Cards */}
                    <div className="space-y-3 mb-6">
                        <p className="text-xs text-gray-500 mb-2 font-medium">İstemediğiniz yemeklerin işaretini kaldırın. Çöpe atılacaklardır.</p>
                        {result.proposals.map((p: any) => {
                            const isChecked = checkedIds.has(p.id)
                            const isExpanded = expandedIds.has(p.id)

                            return (
                                <div key={p.id} className={`bg-white rounded-xl border p-4 shadow-sm transition-all ${!isChecked ? 'opacity-50 border-gray-200 bg-gray-50' : 'border-green-200'}`}>
                                    <div className="flex gap-3">
                                        <input 
                                            type="checkbox" 
                                            checked={isChecked} 
                                            onChange={() => {
                                                const next = new Set(checkedIds)
                                                if (next.has(p.id)) next.delete(p.id)
                                                else next.add(p.id)
                                                setCheckedIds(next)
                                            }}
                                            className="mt-1 w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer shrink-0"
                                        />
                                        <div className="flex-1 cursor-pointer" onClick={() => {
                                                const next = new Set(expandedIds)
                                                if (next.has(p.id)) next.delete(p.id)
                                                else next.add(p.id)
                                                setExpandedIds(next)
                                        }}>
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <h3 className={`font-semibold ${!isChecked ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                                                        {p.suggested_name}
                                                    </h3>
                                                    <div className="flex gap-3 text-xs text-gray-500 mt-1">
                                                        <span>{Math.round(p.calories)} kcal</span>
                                                        <span className={isChecked ? "text-blue-600" : ""}>P: {p.protein}g</span>
                                                        <span className={isChecked ? "text-orange-600" : ""}>K: {p.carbs}g</span>
                                                        <span className={isChecked ? "text-yellow-600" : ""}>Y: {p.fat}g</span>
                                                    </div>
                                                </div>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isChecked ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'}`}>
                                                    {isChecked ? 'Onay Bekliyor' : 'Çöpe Atılacak'}
                                                </span>
                                            </div>

                                            {isExpanded ? (
                                                <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-600 space-y-2" onClick={e => e.stopPropagation()}>
                                                    {p.ingredients && <p><span className="font-semibold text-gray-700">📝 Malzemeler:</span> {p.ingredients}</p>}
                                                    {p.recipe_text && <p><span className="font-semibold text-gray-700">👨‍🍳 Tarif:</span> {p.recipe_text}</p>}
                                                    {p.ai_analysis?.total_servings && <p><span className="font-semibold text-gray-700">🍽️ Servis:</span> {p.ai_analysis.total_servings} {p.portion_unit}</p>}
                                                </div>
                                            ) : (
                                                p.ingredients && (
                                                    <p className="text-xs text-gray-500 mt-2 truncate w-full max-w-xl">
                                                        <span className="font-medium text-gray-600">📝 Detaylar için tıklayın...</span>
                                                    </p>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Navigation */}
                    <div className="flex justify-center gap-3">
                        <Button 
                            onClick={async () => {
                                if (!result) return
                                const uncheckedIds = result.proposals.map((p: any) => p.id).filter((id: string) => !checkedIds.has(id))
                                
                                if (uncheckedIds.length > 0) {
                                    setProceeding(true)
                                    try {
                                        await supabase.from('food_proposals').delete().in('id', uncheckedIds)
                                    } catch(e) { console.error('Delete rejected items error:', e) }
                                }
                                
                                if (uncheckedIds.length === result.proposals.length) {
                                    setResult(null)
                                    setProceeding(false)
                                    setPrompt("")
                                } else {
                                    window.location.href = "/admin/food-proposals"
                                }
                            }}
                            disabled={proceeding}
                            className="bg-green-600 hover:bg-green-700 text-white rounded-xl px-6 flex items-center gap-2"
                        >
                            {proceeding ? <Loader2 size={16} className="animate-spin" /> : null}
                            {checkedIds.size > 0 ? `Seçili ${checkedIds.size} Yemeği Onay Havuzunda Gör` : 'Seçimi İptal Et ve Temizle'}
                            <ArrowRight size={16} />
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => { setResult(null); setPrompt("") }}
                            className="rounded-xl"
                        >
                            Yeni Keşif Yap
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}
