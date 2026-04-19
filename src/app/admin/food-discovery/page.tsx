"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Sparkles, ArrowRight, ChefHat, Leaf, DollarSign, MapPin, Clock, Pencil } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { Settings, Save, Trash2 } from "lucide-react"
import { useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"
import { applyTeamFoodOverrides } from "@/lib/team-food-overrides"
import { FoodEditDialog } from "@/components/diet/food-sidebar"

const EXAMPLE_PROMPTS = [
    { icon: <MapPin size={14} />, text: "Denizli yöresinden, kış aylarında, ketojenik beslenmeye uygun 5 ana yemek" },
    { icon: <DollarSign size={14} />, text: "Maliyeti düşük, yüksek proteinli, sporcu beslenmesine uygun 5 kahvaltılık" },
    { icon: <Leaf size={14} />, text: "Vejetaryen, düşük karbonhidratlı, glütensiz 3 öğle yemeği" },
    { icon: <Clock size={14} />, text: "15 dakikada hazırlanabilecek, pratik, low-carb 5 akşam yemeği" },
]

function normalizeText(value: string): string {
    return (value || "")
        .toLocaleLowerCase("tr-TR")
        .replace(/\u0131/g, "i")
        .replace(/\u011f/g, "g")
        .replace(/\u00fc/g, "u")
        .replace(/\u015f/g, "s")
        .replace(/\u00f6/g, "o")
        .replace(/\u00e7/g, "c")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .trim()
}

function tokenizePrompt(prompt: string): string[] {
    const stop = new Set([
        "ve", "ile", "icin", "gibi", "olan", "uygun", "gore", "ama", "veya",
        "tarif", "tarifi", "tarifleri", "yemek", "yemekler",
        "isterim", "istiyorum", "hazirla", "farkli", "olsun", "bir", "has", "yorum"
    ])
    return Array.from(new Set(normalizeText(prompt).split(/\s+/).filter((t) => t.length >= 3 && !stop.has(t)))).slice(0, 12)
}

function scoreExistingFood(name: string, prompt: string): { score: number; match_type: "exact" | "similar"; match_source: "prompt" | "ai_suggestion" } {
    const n = normalizeText(name)
    const p = normalizeText(prompt)
    const nameTokens = new Set(n.split(/\s+/).filter((t) => t.length >= 2))
    const promptTokenList = tokenizePrompt(prompt)
    const matchedPromptTokens = promptTokenList.filter((t) => nameTokens.has(t))
    let score = 0
    let match_type: "exact" | "similar" = "similar"
    let match_source: "prompt" | "ai_suggestion" = "prompt"

    if (p && n === p) {
        score += 100
        match_type = "exact"
        match_source = "prompt"
    }
    if (p && (n.includes(p) || p.includes(n))) {
        score += 30
    }

    // Core matching: reward overlaps strongly, do not over-penalize long prompts.
    score += matchedPromptTokens.length * 26
    if (matchedPromptTokens.length >= 2) score += 120
    if (matchedPromptTokens.length === 1) score += 30
    if (matchedPromptTokens.length === 0 && promptTokenList.length > 0) score -= 15

    // Small preference for names closer in length to prompt phrase.
    const lengthDelta = Math.abs(n.length - p.length)
    score += Math.max(0, 30 - Math.min(lengthDelta, 30))

    return { score, match_type, match_source }
}

function buildClientSearchTerms(prompt: string): string[] {
    const terms = new Set<string>()
    const addTerm = (raw: string) => {
        const t = normalizeText(raw)
        if (!t || t.length < 3) return
        terms.add(t)
        if (t.length >= 4) terms.add(t.slice(0, 4))
        if (t.length >= 5) terms.add(t.slice(0, 5))
        if (t.length >= 6) terms.add(t.slice(0, 6))
    }

    tokenizePrompt(prompt).forEach(addTerm)
    normalizeText(prompt).split(/\s+/).filter((x) => x.length >= 3).forEach(addTerm)

    return Array.from(terms).slice(0, 24)
}

function toApprovalStatus(value: any): "approved" | "pending" | "unknown" {
    const s = String(value || "").toLocaleLowerCase("tr-TR").trim()
    if (!s) return "unknown"
    if (["approved", "onayli", "onaylandı", "onaylandi"].includes(s)) return "approved"
    if (["pending", "onay_bekliyor", "onay bekliyor", "bekliyor"].includes(s)) return "pending"
    return "unknown"
}

function scoreApprovedNamePriority(name: string, prompt: string): number {
    const n = normalizeText(name)
    const tokens = tokenizePrompt(prompt).slice(0, 6)
    if (!n || tokens.length === 0) return 0

    const matched = tokens.filter((t) => n.includes(t))
    let bonus = matched.length * 42
    if (matched.length >= 2) bonus += 120
    if (matched.length >= 3) bonus += 60

    const bigram = tokens.length >= 2 ? `${tokens[0]} ${tokens[1]}` : ""
    if (bigram && n.includes(bigram)) bonus += 140

    return bonus
}

function mergeFoodWithOverride(baseFood: any, override: any) {
    if (!override) return baseFood
    const merged = { ...baseFood }
    const fields = [
        "name",
        "calories",
        "protein",
        "carbs",
        "fat",
        "portion_unit",
        "tags",
        "compatibility_tags",
        "ingredients",
        "recipe_text",
    ]
    for (const field of fields) {
        if (override[field] !== null && override[field] !== undefined) {
            merged[field] = override[field]
        }
    }
    return merged
}

export default function FoodDiscoveryPage() {
    const { scopeMode } = useAuth()
    const [prompt, setPrompt] = useState("")
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<{
        success: boolean;
        count: number;
        proposals: any[];
        existingFoods?: Array<{
            id: string;
            name: string;
            calories?: number | null;
            protein?: number | null;
            carbs?: number | null;
            fat?: number | null;
            portion_unit?: string | null;
            image_url?: string | null;
            recipe_text?: string | null;
            tags?: string[] | null;
            compatibility_tags?: string[] | null;
            match_type?: "exact" | "similar";
            match_source?: "prompt" | "ai_suggestion";
            match_score?: number;
            approval_status?: "approved" | "pending" | "unknown";
            meta?: {
                pending_approval?: boolean;
                [key: string]: any;
            } | null;
        }>;
    } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [searchSites, setSearchSites] = useState<{ url: string; enabled: boolean }[]>([])
    const [newSite, setNewSite] = useState("")
    const [savingSettings, setSavingSettings] = useState(false)
    const [showSettings, setShowSettings] = useState(false)

    // New states for interaction
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
    const [proceeding, setProceeding] = useState(false)
    const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null)
    const [currentTeamOwnerId, setCurrentTeamOwnerId] = useState<string | null>(null)
    const [editingExistingFood, setEditingExistingFood] = useState<any | null>(null)
    const [existingEditOpen, setExistingEditOpen] = useState(false)

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
            const teamScope = await resolveTeamScopeContextFromAuth()
            const isTeamMode = scopeMode === 'team' || (!teamScope.canUseGlobal && !!teamScope.teamOwnerId)
            const teamOwnerId = teamScope.teamOwnerId || (isTeamMode ? teamScope.userId : null)
            setCurrentTeamOwnerId(teamOwnerId)

            const res = await fetch("/api/admin/food-discovery", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    prompt: prompt.trim(),
                    userId: teamScope.userId,
                    teamOwnerId,
                }),
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || "Bir hata oluştu")
            }

            let mergedExistingFoods = Array.isArray(data.existingFoods) ? data.existingFoods : []
            const generatedNames = Array.isArray(data.proposals)
                ? data.proposals.map((p: any) => String(p?.suggested_name || "")).filter(Boolean)
                : []
            const proposalIds = new Set(
                (Array.isArray(data.proposals) ? data.proposals : [])
                    .map((p: any) => p?.id)
                    .filter(Boolean)
            )

            // Never show newly generated proposals in "existing foods" list.
            mergedExistingFoods = mergedExistingFoods.filter((food: any) => {
                return !proposalIds.has(food?.id)
            })

            // Client-side safety fallback: mirror /foods data source when API-side matching misses.
            if (mergedExistingFoods.length === 0) {
                try {
                    const queryTerms = buildClientSearchTerms(prompt.trim())

                    let allFoods: any[] = []
                    if (queryTerms.length > 0) {
                        const chunks = queryTerms.slice(0, 12)
                        const foodResponses = await Promise.all(
                            chunks.map((term) =>
                                supabase
                                    .from("foods")
                                    .select("*")
                                    .ilike("name", `%${term.replace(/[%_]/g, "")}%`)
                                    .limit(120)
                            )
                        )

                        const overrideResponses = teamOwnerId
                            ? await Promise.all(
                                  chunks.map((term) =>
                                      supabase
                                          .from("team_food_overrides")
                                          .select("team_owner_id,base_food_id,name,calories,protein,carbs,fat,portion_unit,tags,compatibility_tags,ingredients,recipe_text")
                                          .eq("team_owner_id", teamOwnerId)
                                          .ilike("name", `%${term.replace(/[%_]/g, "")}%`)
                                          .limit(120)
                                  )
                              )
                            : []

                        const byId = new Map<string, any>()
                        for (const response of foodResponses) {
                            for (const food of response.data || []) {
                                if (food?.id) byId.set(food.id, food)
                            }
                        }

                        const overrideRows = overrideResponses.flatMap((r: any) => r.data || [])
                        const overrideByBaseId = new Map<string, any>()
                        for (const row of overrideRows) {
                            if (row?.base_food_id) overrideByBaseId.set(row.base_food_id, row)
                        }

                        const overrideBaseIds = Array.from(overrideByBaseId.keys())
                        if (overrideBaseIds.length > 0) {
                            const { data: baseFoodsForOverrides } = await supabase
                                .from("foods")
                                .select("*")
                                .in("id", overrideBaseIds)
                                .limit(400)

                            for (const baseFood of baseFoodsForOverrides || []) {
                                if (!baseFood?.id) continue
                                const merged = mergeFoodWithOverride(baseFood, overrideByBaseId.get(baseFood.id))
                                byId.set(baseFood.id, merged)
                            }
                        }

                        allFoods = Array.from(byId.values())
                    } else {
                        const { data: sampledFoods } = await supabase
                            .from("foods")
                            .select("*")
                            .not("name", "is", null)
                            .limit(400)
                        let sampled = sampledFoods || []

                        if (teamOwnerId) {
                            const { data: sampledOverrides } = await supabase
                                .from("team_food_overrides")
                                .select("team_owner_id,base_food_id,name,calories,protein,carbs,fat,portion_unit,tags,compatibility_tags,ingredients,recipe_text")
                                .eq("team_owner_id", teamOwnerId)
                                .not("name", "is", null)
                                .limit(400)

                            const overrideByBaseId = new Map<string, any>()
                            for (const row of sampledOverrides || []) {
                                if (row?.base_food_id) overrideByBaseId.set(row.base_food_id, row)
                            }

                            sampled = sampled.map((food: any) => mergeFoodWithOverride(food, overrideByBaseId.get(food.id)))
                        }

                        allFoods = sampled
                    }

                    let scopedFoods: any[] = allFoods
                    if (teamOwnerId) {
                        scopedFoods = await applyTeamFoodOverrides(scopedFoods, teamOwnerId)
                    }

                    const ranked = scopedFoods
                        .map((food) => {
                            const match = scoreExistingFood(food.name || "", prompt.trim())
                            return {
                                ...food,
                                match_type: match.match_type,
                                match_source: match.match_source,
                                match_score: match.score,
                            }
                        })
                        .filter((food) => !proposalIds.has(food?.id))
                        .filter((food) => food.match_score > 0)
                        .sort((a, b) => b.match_score - a.match_score)
                        .slice(0, 12)

                    mergedExistingFoods = ranked
                } catch (fallbackError) {
                    console.warn("Client existing-food fallback failed:", fallbackError)
                }
            }

            // Normalize final order on UI as well so closest variants stay on top.
            mergedExistingFoods = mergedExistingFoods
                .map((food: any) => {
                    const match = scoreExistingFood(food.name || "", prompt.trim())
                    return {
                        ...food,
                        match_type: food.match_type || match.match_type,
                        match_source: food.match_source || match.match_source,
                        match_score: typeof food.match_score === "number" ? food.match_score : match.score,
                    }
                })
                .filter((food: any) => !proposalIds.has(food?.id))
                .sort((a: any, b: any) => (b.match_score || 0) - (a.match_score || 0))

            // Expand candidate pool so approved top-3 can include close name variants
            // such as "Patlican Musakka (150 gr kiyma ile)" when many pending rows exist.
            try {
                const coreTokens = tokenizePrompt(prompt.trim()).slice(0, 5)
                const requiredTokenMatches = Math.min(2, coreTokens.length)
                if (requiredTokenMatches > 0) {
                    const { data: wideFoods } = await supabase
                        .from("foods")
                        .select("*")
                        .not("name", "is", null)
                        .limit(5000)

                    let wideScopedFoods: any[] = wideFoods || []
                    if (teamOwnerId) {
                        wideScopedFoods = await applyTeamFoodOverrides(wideScopedFoods, teamOwnerId)
                    }

                    const supplemental = wideScopedFoods
                        .filter((food: any) => !proposalIds.has(food?.id))
                        .map((food: any) => {
                            const match = scoreExistingFood(food.name || "", prompt.trim())
                            return {
                                ...food,
                                match_type: match.match_type,
                                match_source: match.match_source,
                                match_score: match.score,
                            }
                        })
                        .filter((food: any) => Number(food?.match_score || 0) > 0)
                        .filter((food: any) => {
                            const n = normalizeText(String(food?.name || ""))
                            const tokenMatches = coreTokens.filter((t) => n.includes(t)).length
                            return tokenMatches >= requiredTokenMatches
                        })
                        .sort((a: any, b: any) => Number(b?.match_score || 0) - Number(a?.match_score || 0))
                        .slice(0, 160)

                    if (supplemental.length > 0) {
                        const byId = new Map<string, any>()
                        for (const food of mergedExistingFoods) {
                            if (food?.id) byId.set(food.id, food)
                        }
                        for (const food of supplemental) {
                            if (!food?.id) continue
                            const prev = byId.get(food.id)
                            if (!prev || Number(food?.match_score || 0) > Number(prev?.match_score || 0)) {
                                byId.set(food.id, food)
                            }
                        }
                        mergedExistingFoods = Array.from(byId.values()).sort(
                            (a: any, b: any) => Number(b?.match_score || 0) - Number(a?.match_score || 0)
                        )
                    }
                }
            } catch (supplementError) {
                console.warn("Existing-food supplemental pool failed:", supplementError)
            }

            // Enrich approval status from food_proposals so approved/pending grouping stays accurate.
            try {
                const existingFoodIds = Array.from(
                    new Set(
                        mergedExistingFoods
                            .map((f: any) => f?.id)
                            .filter((id: any) => typeof id === "string" && id.length > 0)
                    )
                )

                if (existingFoodIds.length > 0) {
                    const { data: proposalStatuses } = await supabase
                        .from("food_proposals")
                        .select("id,status,created_at")
                        .in("id", existingFoodIds)
                        .order("created_at", { ascending: false })

                    const latestStatusByFoodId = new Map<string, "approved" | "pending" | "unknown">()
                    for (const row of proposalStatuses || []) {
                        const foodId = row?.id
                        if (!foodId || latestStatusByFoodId.has(foodId)) continue
                        latestStatusByFoodId.set(foodId, toApprovalStatus(row?.status))
                    }

                    mergedExistingFoods = mergedExistingFoods.map((food: any) => {
                        const fromProposal = latestStatusByFoodId.get(food?.id) || "unknown"
                        const fallback = food?.status === "pending" ? "pending" : "approved"
                        return {
                            ...food,
                            approval_status: fromProposal === "unknown" ? fallback : fromProposal,
                        }
                    })
                }
            } catch (approvalError) {
                console.warn("Existing-food approval enrichment failed:", approvalError)
                mergedExistingFoods = mergedExistingFoods.map((food: any) => ({
                    ...food,
                    approval_status: food?.status === "pending" ? "pending" : "approved",
                }))
            }

            // Last-resort safety net: broad local scoring when all filtered paths return empty.
            if (mergedExistingFoods.length === 0) {
                try {
                    const { data: broadFoods } = await supabase
                        .from("foods")
                        .select("*")
                        .not("name", "is", null)
                        .limit(5000)

                    let broadScoped: any[] = broadFoods || []
                    if (teamOwnerId) {
                        broadScoped = await applyTeamFoodOverrides(broadScoped, teamOwnerId)
                    }

                    mergedExistingFoods = broadScoped
                        .filter((food: any) => !proposalIds.has(food?.id))
                        .map((food: any) => {
                            const match = scoreExistingFood(food.name || "", prompt.trim())
                            return {
                                ...food,
                                match_type: match.match_type,
                                match_source: match.match_source,
                                match_score: match.score,
                            }
                        })
                        .filter((food: any) => (food.match_score || 0) > 0)
                        .sort((a: any, b: any) => (b.match_score || 0) - (a.match_score || 0))
                        .slice(0, 12)
                } catch (broadError) {
                    console.warn("Broad existing-food fallback failed:", broadError)
                }
            }

            setResult({
                ...data,
                existingFoods: mergedExistingFoods,
            })
            setCheckedIds(new Set(data.proposals.map((p: any) => p.id)))
            setExpandedIds(new Set())
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const formatMacro = (value: number | null | undefined) => Math.round(Number(value || 0))
    const isPendingApprovalFood = (food: any) =>
        (food?.approval_status
            ? String(food.approval_status).toLocaleLowerCase("tr-TR") === "pending"
            : Boolean(food?.meta?.pending_approval === true || food?.status === "pending"))

    const dedupedExistingFoods = (() => {
        const byKey = new Map<string, any>()
        for (const food of result?.existingFoods || []) {
            // Exact-name dedupe: if names are identical, show only one card.
            const key = normalizeText(String(food?.name || ""))
            if (!key) continue
            const prev = byKey.get(key)
            const currentScore = Number(food?.match_score || 0)
            const prevScore = Number(prev?.match_score || 0)
            const currentPending = isPendingApprovalFood(food)
            const prevPending = isPendingApprovalFood(prev)

            // Keep stronger match; on ties prefer approved over pending.
            if (
                !prev ||
                currentScore > prevScore ||
                (currentScore === prevScore && prevPending && !currentPending)
            ) {
                byKey.set(key, food)
            }
        }
        return Array.from(byKey.values())
    })()

    const approvedExistingFoodsAll = dedupedExistingFoods.filter((food: any) => !isPendingApprovalFood(food))
    const approvedExistingFoods = approvedExistingFoodsAll
        .sort(
            (a: any, b: any) =>
                Number(b?.match_score || 0) +
                scoreApprovedNamePriority(String(b?.name || ""), prompt) -
                (Number(a?.match_score || 0) + scoreApprovedNamePriority(String(a?.name || ""), prompt))
        )
        .slice(0, 3)
    const pendingExistingFoods = dedupedExistingFoods.filter((food: any) => isPendingApprovalFood(food))
    const orderedExistingFoods = [...approvedExistingFoods, ...pendingExistingFoods]

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

                    {!!orderedExistingFoods.length && (
                        <div className="mb-6">
                            <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">
                                Veritabaninda Bulunan Benzer Yemekler ({orderedExistingFoods.length})
                            </p>
                            <div className="flex flex-wrap gap-2 mb-2">
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                                    Onaylanmis (ilk 3): {approvedExistingFoods.length}
                                </span>
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                                    Onay bekleyen: {pendingExistingFoods.length}
                                </span>
                            </div>
                            <div className="space-y-3">
                                {orderedExistingFoods.map((food, idx) => (
                                    <div key={food.id} className={`rounded-xl p-3 flex gap-3 border ${isPendingApprovalFood(food) ? 'bg-orange-50 border-orange-200' : 'bg-sky-50 border-sky-200'}`}>
                                        {food.image_url ? (
                                            <button
                                                type="button"
                                                onClick={() => setPreviewImage({ url: food.image_url!, name: food.name })}
                                                className="shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                                title="Tarif kartini buyuk ac"
                                            >
                                                <img
                                                    src={food.image_url}
                                                    alt={food.name}
                                                    className="w-20 h-20 rounded-lg object-cover border border-amber-300"
                                                />
                                            </button>
                                        ) : (
                                            <div className="w-20 h-20 rounded-lg border border-amber-300 bg-white/70 shrink-0 flex items-center justify-center text-[10px] text-amber-700">
                                                Gorsel yok
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            {idx === approvedExistingFoods.length && pendingExistingFoods.length > 0 ? (
                                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-orange-700">
                                                    Onay bekleyen mevcut yemekler
                                                </div>
                                            ) : null}
                                            {idx === 0 && approvedExistingFoods.length > 0 ? (
                                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                                                    Onayli mevcut yemekler (isim benzerligine gore ilk 3)
                                                </div>
                                            ) : null}
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="text-sm font-semibold text-gray-900">{food.name}</p>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${food.match_type === 'exact' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-amber-100 border-amber-300 text-amber-700'}`}>
                                                    {food.match_type === 'exact' ? 'Ayni tarif' : 'Benzer tarif'}
                                                </span>
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-amber-300 text-amber-700">
                                                    {food.match_source === 'ai_suggestion' ? 'AI sonucu ile eslesti' : 'Prompt ile eslesti'}
                                                </span>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${isPendingApprovalFood(food) ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-emerald-50 border-emerald-300 text-emerald-700'}`}>
                                                    {isPendingApprovalFood(food) ? 'Onay bekliyor' : 'Onayli'}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-full border border-amber-300 bg-white text-amber-700 hover:bg-amber-100"
                                                    title="Yemegi duzelt"
                                                    onClick={() => {
                                                        setEditingExistingFood(food)
                                                        setExistingEditOpen(true)
                                                    }}
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-gray-700">
                                                <span>{formatMacro(food.calories)} kcal</span>
                                                <span className="text-blue-700">P: {formatMacro(food.protein)}g</span>
                                                <span className="text-orange-700">K: {formatMacro(food.carbs)}g</span>
                                                <span className="text-yellow-700">Y: {formatMacro(food.fat)}g</span>
                                            </div>
                                            <div className="mt-2 flex gap-2">
                                                {food.portion_unit ? (
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-amber-300 text-amber-700">
                                                        Birim: {food.portion_unit}
                                                    </span>
                                                ) : null}
                                                {food.recipe_text ? (
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                                                        Tarif karti var
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-gray-500">
                                                        Tarif metni yok
                                                    </span>
                                                )}
                                            </div>
                                            {!!food.tags?.length && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {food.tags.slice(0, 6).map((tag: string) => (
                                                        <span key={`${food.id}-tag-${tag}`} className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-amber-200 text-amber-800">
                                                            #{tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

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

            {existingEditOpen && editingExistingFood && (
                <FoodEditDialog
                    isOpen={existingEditOpen}
                    onClose={() => setExistingEditOpen(false)}
                    food={editingExistingFood}
                    teamOwnerId={currentTeamOwnerId}
                    mode="edit"
                    onUpdate={async () => {
                        const { data: refreshed } = await supabase
                            .from("foods")
                            .select("*")
                            .eq("id", editingExistingFood.id)
                            .maybeSingle()

                        if (refreshed) {
                            setResult((prev) => {
                                if (!prev?.existingFoods?.length) return prev
                                return {
                                    ...prev,
                                    existingFoods: prev.existingFoods.map((food) =>
                                        food.id === refreshed.id ? { ...food, ...refreshed } : food
                                    ),
                                }
                            })
                        }
                    }}
                />
            )}

            {previewImage && (
                <div
                    className="fixed inset-0 z-[80] bg-black/75 p-4 flex items-center justify-center"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={() => setPreviewImage(null)}
                            className="absolute right-2 top-2 z-10 bg-black/70 text-white text-xs rounded-full px-3 py-1 border border-white/30"
                        >
                            Kapat
                        </button>
                        <img
                            src={previewImage.url}
                            alt={previewImage.name}
                            className="w-full max-h-[85vh] object-contain rounded-xl border border-white/30 bg-black"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
