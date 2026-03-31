"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles, ArrowRight, ChefHat, Leaf, DollarSign, MapPin, Clock } from "lucide-react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { Settings, Save } from "lucide-react"
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
    const [searchSites, setSearchSites] = useState("")
    const [savingSettings, setSavingSettings] = useState(false)
    const [showSettings, setShowSettings] = useState(false)

    useEffect(() => {
        fetchSettings()
    }, [])

    const fetchSettings = async () => {
        const { data } = await supabase.from('system_settings').select('value').eq('key', 'discovery_search_sites').maybeSingle()
        if (data) setSearchSites(data.value)
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
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                            🔎 Dahil Edilecek Kaynaklar (Web Siteleri)
                        </label>
                        <div className="flex gap-2">
                            <input
                                value={searchSites}
                                onChange={(e) => setSearchSites(e.target.value)}
                                placeholder="Örn: nefisyemektarifleri.com, yemek.com, lezzet.com.tr"
                                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs focus:ring-1 focus:ring-violet-500 outline-none"
                            />
                            <Button 
                                size="sm" 
                                onClick={saveSettings} 
                                disabled={savingSettings}
                                className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-3 h-auto"
                            >
                                {savingSettings ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            </Button>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1.5">
                            Boş bırakırsanız AI genel bir araştırma yapar. Virgülle ayırarak alan adlarını ekleyebilirsiniz.
                        </p>
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
                        {result.proposals.map((p: any) => (
                            <div key={p.id} className="bg-white rounded-xl border border-green-200 p-4 shadow-sm">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{p.suggested_name}</h3>
                                        <div className="flex gap-3 text-xs text-gray-500 mt-1">
                                            <span>{Math.round(p.calories)} kcal</span>
                                            <span className="text-blue-600">P: {p.protein}g</span>
                                            <span className="text-orange-600">K: {p.carbs}g</span>
                                            <span className="text-yellow-600">Y: {p.fat}g</span>
                                        </div>
                                    </div>
                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                                        Onay Bekliyor
                                    </span>
                                </div>
                                {p.ingredients && (
                                    <p className="text-xs text-gray-500 mt-2 border-t pt-2">
                                        <span className="font-medium text-gray-600">📝 Malzemeler:</span> {p.ingredients}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Navigation */}
                    <div className="flex justify-center gap-3">
                        <Link href="/admin/food-proposals">
                            <Button className="bg-green-600 hover:bg-green-700 text-white rounded-xl px-6 flex items-center gap-2">
                                Onay Bekleyenler Sayfasına Git
                                <ArrowRight size={16} />
                            </Button>
                        </Link>
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
