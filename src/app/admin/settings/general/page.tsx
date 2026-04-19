"use client"

import { useEffect, useState, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import {
    Save, Loader2, SlidersHorizontal, Wand2, Scale, Sparkles,
    Link2, ShieldCheck, Zap, ChefHat, Leaf, Heart, Target,
    Brain, AlertTriangle, Info, CheckCircle2, ArrowRight
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/auth-context"
import { resolveTeamScopeContextFromAuth } from "@/lib/team-scope"

type RegistrationSettings = {
    allow_program_selection: boolean
    allow_goal_selection: boolean
}

type FlavorTuningSettings = {
    enabled: boolean
    allow_post_edit: boolean
    respect_scope_filters: boolean
    respect_frequency_rules: boolean
    use_pattern_insights: boolean
    strict_locked_items: boolean
    suggestion_count: number
    macro_weight: number
    flavor_weight: number
    diversity_weight: number
    compatibility_weight: number
    pattern_weight: number
    pattern_min_confidence: number
    pattern_min_lift: number
    pattern_min_support: number
}

const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettings = {
    allow_program_selection: false,
    allow_goal_selection: false,
}

const DEFAULT_FLAVOR_SETTINGS: FlavorTuningSettings = {
    enabled: true,
    allow_post_edit: true,
    respect_scope_filters: true,
    respect_frequency_rules: true,
    use_pattern_insights: true,
    strict_locked_items: true,
    suggestion_count: 3,
    macro_weight: 0.4,
    flavor_weight: 0.35,
    diversity_weight: 0.15,
    compatibility_weight: 0.1,
    pattern_weight: 0.2,
    pattern_min_confidence: 0.15,
    pattern_min_lift: 1.1,
    pattern_min_support: 3,
}

// ── Preset Templates ─────────────────────────────────
type PresetTemplate = {
    id: string
    name: string
    icon: any
    description: string
    color: string
    bgGradient: string
    borderColor: string
    values: Partial<FlavorTuningSettings>
}

const PRESET_TEMPLATES: PresetTemplate[] = [
    {
        id: 'strict_clinical',
        name: 'Klinik Katı',
        icon: ShieldCheck,
        description: 'Makrolar mutlak öncelik. Lezzet ikinci planda. Diyabet, böbrek gibi hassas hastalar için.',
        color: 'text-red-600',
        bgGradient: 'from-red-50 to-rose-50',
        borderColor: 'border-red-200 hover:border-red-400',
        values: {
            macro_weight: 0.7,
            flavor_weight: 0.15,
            diversity_weight: 0.1,
            compatibility_weight: 0.05,
            pattern_weight: 0.18,
            pattern_min_confidence: 0.24,
            pattern_min_lift: 1.35,
            pattern_min_support: 5,
            suggestion_count: 2,
            respect_frequency_rules: true,
            strict_locked_items: true,
        }
    },
    {
        id: 'balanced',
        name: 'Dengeli (Varsayılan)',
        icon: Scale,
        description: 'Makro ve lezzet dengesini gözeten standart mod. Çoğu hasta için ideal.',
        color: 'text-blue-600',
        bgGradient: 'from-blue-50 to-indigo-50',
        borderColor: 'border-blue-200 hover:border-blue-400',
        values: {
            ...DEFAULT_FLAVOR_SETTINGS,
        }
    },
    {
        id: 'flavor_forward',
        name: 'Lezzet Öncelikli',
        icon: ChefHat,
        description: 'Lezzet ve çeşitlilik ön planda. Makroları gözetir ama esner. Motivasyonu düşük hastalar için.',
        color: 'text-amber-600',
        bgGradient: 'from-amber-50 to-yellow-50',
        borderColor: 'border-amber-200 hover:border-amber-400',
        values: {
            macro_weight: 0.2,
            flavor_weight: 0.45,
            diversity_weight: 0.2,
            compatibility_weight: 0.15,
            pattern_weight: 0.2,
            pattern_min_confidence: 0.12,
            pattern_min_lift: 1.0,
            pattern_min_support: 2,
            suggestion_count: 4,
            strict_locked_items: false,
        }
    },
    {
        id: 'maximum_variety',
        name: 'Maksimum Çeşitlilik',
        icon: Sparkles,
        description: 'Tekrardan kaçınma birinci öncelik. Her gün farklı tatlar. Bıkkınlık riski yüksek hastalar için.',
        color: 'text-purple-600',
        bgGradient: 'from-purple-50 to-fuchsia-50',
        borderColor: 'border-purple-200 hover:border-purple-400',
        values: {
            macro_weight: 0.25,
            flavor_weight: 0.25,
            diversity_weight: 0.35,
            compatibility_weight: 0.15,
            pattern_weight: 0.24,
            pattern_min_confidence: 0.1,
            pattern_min_lift: 1.0,
            pattern_min_support: 2,
            suggestion_count: 5,
            respect_frequency_rules: true,
            strict_locked_items: false,
        }
    },
    {
        id: 'gourmet_pairing',
        name: 'Gurme Eşleşme',
        icon: Heart,
        description: 'Ana yemek + yancı uyumu en önemli kriter. Yemek çiftleri mükemmel olmalı.',
        color: 'text-emerald-600',
        bgGradient: 'from-emerald-50 to-teal-50',
        borderColor: 'border-emerald-200 hover:border-emerald-400',
        values: {
            macro_weight: 0.25,
            flavor_weight: 0.25,
            diversity_weight: 0.1,
            compatibility_weight: 0.4,
            pattern_weight: 0.35,
            pattern_min_confidence: 0.2,
            pattern_min_lift: 1.2,
            pattern_min_support: 3,
            suggestion_count: 3,
            strict_locked_items: true,
        }
    },
    {
        id: 'aggressive_flavor',
        name: 'Ultra Esnek',
        icon: Zap,
        description: 'Makrolar neredeyse serbest. Sadece lezzet, çeşitlilik ve uyumluluk. Deneysel kullanım.',
        color: 'text-orange-600',
        bgGradient: 'from-orange-50 to-red-50',
        borderColor: 'border-orange-200 hover:border-orange-400',
        values: {
            macro_weight: 0.05,
            flavor_weight: 0.5,
            diversity_weight: 0.25,
            compatibility_weight: 0.2,
            pattern_weight: 0.3,
            pattern_min_confidence: 0.08,
            pattern_min_lift: 0.9,
            pattern_min_support: 1,
            suggestion_count: 6,
            respect_frequency_rules: false,
            strict_locked_items: false,
        }
    },
]

function isCloseNumber(a: number, b: number, epsilon = 0.0001) {
    return Math.abs(a - b) <= epsilon
}

function inferActivePreset(settings: FlavorTuningSettings): string | null {
    for (const preset of PRESET_TEMPLATES) {
        const keys = Object.keys(preset.values) as Array<keyof FlavorTuningSettings>
        const isMatch = keys.every((key) => {
            const presetValue = preset.values[key]
            const currentValue = settings[key]
            if (typeof presetValue === 'number' && typeof currentValue === 'number') {
                return isCloseNumber(currentValue, presetValue)
            }
            return currentValue === presetValue
        })
        if (isMatch) return preset.id
    }
    return null
}

function parseNumberInput(raw: string, fallback: number, min: number, max: number) {
    const normalized = raw.trim().replace(",", ".")
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
}

// ── Scenario Analysis Engine ─────────────────────────
function getScenarioAnalysis(settings: FlavorTuningSettings): {
    summary: string
    icon: any
    color: string
    bgColor: string
    scenarios: { emoji: string, title: string, description: string }[]
    warnings: string[]
    tips: string[]
} {
    const { macro_weight: mw, flavor_weight: fw, diversity_weight: dw, compatibility_weight: cw } = settings
    const total = mw + fw + dw + cw
    const mp = total > 0 ? (mw / total) * 100 : 25
    const fp = total > 0 ? (fw / total) * 100 : 25
    const dp = total > 0 ? (dw / total) * 100 : 25
    const cp = total > 0 ? (cw / total) * 100 : 25

    const scenarios: { emoji: string, title: string, description: string }[] = []
    const warnings: string[] = []
    const tips: string[] = []
    let summary = ''
    let icon = Scale
    let color = 'text-blue-600'
    let bgColor = 'bg-blue-50'

    // ── Macro dominance analysis ──
    if (mp >= 60) {
        summary = '🏥 Klinik Katı Mod — Makrolar her şeyin önünde'
        icon = ShieldCheck
        color = 'text-red-600'
        bgColor = 'bg-red-50'
        scenarios.push(
            { emoji: '🔬', title: 'Diyabet/Böbrek Hastası Senaryosu', description: 'Hasta günlük 1600 kcal / 80g protein hedefinde. Motor, havuçlu kek (lezzetli ama 45g karb) yerine haşlanmış brokoli (düşük tat ama 5g karb) seçecektir. Makro bütçesi asla aşılmaz.' },
            { emoji: '😐', title: 'Motivasyon Riski', description: 'Hasta "Her gün aynı haşlanmış tavuk" hissine kapılabilir çünkü motor lezzet yerine kalori/makro uyumunu seçer. Uzun vadede diyet bırakma riski artabilir.' },
            { emoji: '✅', title: 'Klinik Güvenlik', description: 'Hedef makroların %95-105 bandında kalma garantisi yüksek. Cerrahiye hazırlanan ya da metabolik kontrol gereken hastalar için ideal.' },
        )
        tips.push('Bu modda hasta menüsü klinik olarak güvenli ama monoton olabilir. Hastanın motivasyonunu ayrıca takip edin.')
        if (fp < 10) warnings.push('Lezzet ağırlığı çok düşük — hasta memnuniyeti ciddi şekilde düşebilir.')
    } else if (fp >= 45) {
        summary = '🍽️ Lezzet Öncelikli Mod — Hastanın damak tadı birinci öncelik'
        icon = ChefHat
        color = 'text-amber-600'
        bgColor = 'bg-amber-50'
        scenarios.push(
            { emoji: '😋', title: 'Motivasyonu Düşük Hasta', description: 'Hasta diyete başlayalı 3 hafta oldu ama isteksiz. Motor, makrodan %8-10 sapma pahasına hastanın geçmişte severek yediği ızgara köfte + piyaz gibi bir eşleşme sunacaktır.' },
            { emoji: '⚠️', title: 'Makro Sapma Riski', description: 'Protein: %101 hedefken %110\'a, yağ: %106 hedefken %115\'e çıkabilir. Bu hastaya klinik olarak kabul edilebilir mi, diyetisyenin kararıdır.' },
            { emoji: '🎯', title: 'Uzun Vadeli Uyum', description: 'Araştırmalar gösteriyor ki diyetten memnun hastalar %40 daha uzun süre programda kalıyor. Bu mod, uzun vadeli uyumu kısa vadeli makro hassasiyetine tercih eder.' },
        )
        tips.push('Hasta sevdiği yemekleri görünce diyete daha sadık kalır. Ancak ağır metabolik hastalıklarda dikkatli kullanın.')
        if (mw < 0.15) warnings.push('Makro ağırlığı çok düşük! Kalori ve protein hedeflerinden ciddi sapma olabilir.')
    } else if (dp >= 30) {
        summary = '🌈 Çeşitlilik Öncelikli Mod — Her gün farklı deneyim'
        icon = Sparkles
        color = 'text-purple-600'
        bgColor = 'bg-purple-50'
        scenarios.push(
            { emoji: '🔄', title: '"Yine mi bu?" Bıkkınlığı Önleme', description: 'Hasta 2 haftadır öğle yemeğinde tavuk göğsü yiyor. Motor, aynı makro bandında kalan ama hiç çıkmamış ton balığı salatası veya mercimek köftesi önerecektir.' },
            { emoji: '📊', title: 'Frekans Takibi', description: 'Haftada 3\'ten fazla tekrar eden gıdalar otomatik olarak puanlanır ve alternatif gıdalar öne çıkarılır. Bu, besin çeşitliliğini ve mikro besin dengesini de doğal olarak iyileştirir.' },
            { emoji: '🧠', title: 'Örüntü Kırma', description: 'Motor, hastanın "Pazartesi = makarna" gibi örüntülerini fark eder ve bilinçli olarak kırar. Yeni tatlar keşfettirme motivasyonu artar.' },
        )
        tips.push('Çeşitlilik, hastanın mikro besinleri doğal yollarla almasını da sağlar. Ancak çok sayıda farklı malzeme, alışveriş listesini uzatabilir.')
    } else if (cp >= 30) {
        summary = '🍷 Gurme Eşleşme Modu — Yemek çiftleri mükemmel olmalı'
        icon = Heart
        color = 'text-emerald-600'
        bgColor = 'bg-emerald-50'
        scenarios.push(
            { emoji: '🥩', title: 'Kuru Fasulye + Pilav Eşleşmesi', description: 'Motor, "Kuru fasulye varsa yanına pilav gelir" gibi kültürel eşleşme kurallarını bilir. Ton balığı yanına pilav yerine, ton balığı yanına salata koyar.' },
            { emoji: '🍳', title: 'Kahvaltı Uyumu', description: 'Yumurta + zeytin + peynir gibi doğal eşleşmeler öne çıkar. Motor, yumurta yanına şalgam koymak gibi uyumsuz önerilerden kaçınır.' },
            { emoji: '🌍', title: 'Bölgesel Mutfak Farkındalığı', description: 'Akdeniz mutfağı, ketojenik diyet gibi program kalıplarına uygun yemek çiftleri tercih edilir. Program kurallarıyla eşleşme önceliklidir.' },
        )
        tips.push('Bu mod, hastanın yemekten keyif almasını artırır. Ancak makro takibi gevşeyebilir, klinik izleme önemli.')
    } else {
        summary = '⚖️ Dengeli Mod — Makro, lezzet, çeşitlilik ve uyum eşit önemde'
        icon = Scale
        color = 'text-blue-600'
        bgColor = 'bg-blue-50'
        scenarios.push(
            { emoji: '🎯', title: 'Genel Amaçlı Diyet', description: 'Motor, makrodan çok sapmadan (%5-8 tolerans) mümkün olan en lezzetli ve çeşitli menüyü oluşturur. Her kriteri dengeli bir şekilde gözetir.' },
            { emoji: '🔄', title: 'Adaptive Davranış', description: 'Hasta bir gün sebze yediyse, ertesi gün protein ağırlıklı; bir gün çiğ salata yediyse ertesi gün sıcak yemek öne çıkar. Dengeleme doğal akışta gerçekleşir.' },
            { emoji: '👩‍⚕️', title: 'Diyetisyen Dostu', description: 'Değişiklik sayısı orta (3 öneri). Diyetisyen, planı incelediğinde mantıklı ve açıklanabilir değişiklikler görür. Hastayla iletişim kolaylaşır.' },
        )
        tips.push('Çoğu hasta için en güvenli başlangıç noktası budur. Bireysel ihtiyaçlara göre hafifçe kaydırabilirsiniz.')
    }

    // ── Cross-cutting warnings ──
    if (!settings.enabled) warnings.push('Lezzet Ayarı tamamen kapalı! Hastalar Gurme butonunu kullanamaz.')
    if (!settings.allow_post_edit) warnings.push('Post-edit kapalı — Plan oluşturulduktan sonra Gurme düzenlemesi yapılamaz.')
    if (!settings.respect_scope_filters) warnings.push('Program/Faz filtreleri devre dışı! Motor, hastanın programı dışındaki yemekleri de önerebilir.')
    if (!settings.respect_frequency_rules) warnings.push('Sıklık kuralları devre dışı! Aynı yemek haftada 7 kez bile gelebilir.')
    if (!settings.strict_locked_items) tips.push('Kilitli yemekler bile değiştirilebilir — hastanın diyetisyenin kilitlediği öğeleri değiştirmesine izin verilir.')
    if (settings.suggestion_count >= 5) tips.push('Yüksek öneri sayısı ('+settings.suggestion_count+') — daha fazla alternatif taranır, işlem süresi uzayabilir.')
    if (settings.suggestion_count <= 1) tips.push('Minimum öneri sayısı (1) — motor sadece en iyi tek alternatifi sunar, daha hızlı ama daha az seçenek.')

    return { summary, icon, color, bgColor, scenarios, warnings, tips }
}

// ── Slider Weight Item Component ─────────────────────
function WeightSlider({
    label,
    description,
    value,
    onChange,
    color,
    icon: Icon,
    percentage,
}: {
    label: string
    description: string
    value: number
    onChange: (v: number) => void
    color: string
    icon: any
    percentage: number
}) {
    const barColors: Record<string, string> = {
        red: 'bg-red-500',
        amber: 'bg-amber-500',
        purple: 'bg-purple-500',
        emerald: 'bg-emerald-500',
    }
    const textColors: Record<string, string> = {
        red: 'text-red-600',
        amber: 'text-amber-600',
        purple: 'text-purple-600',
        emerald: 'text-emerald-600',
    }
    const bgColors: Record<string, string> = {
        red: 'bg-red-50',
        amber: 'bg-amber-50',
        purple: 'bg-purple-50',
        emerald: 'bg-emerald-50',
    }
    const borderColors: Record<string, string> = {
        red: 'border-red-200',
        amber: 'border-amber-200',
        purple: 'border-purple-200',
        emerald: 'border-emerald-200',
    }

    return (
        <div className={cn("rounded-xl border p-4 transition-all duration-300", borderColors[color] || 'border-gray-200', bgColors[color] || 'bg-gray-50')}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bgColors[color])}>
                        <Icon className={cn("h-4 w-4", textColors[color])} />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-gray-800">{label}</p>
                        <p className="text-[11px] text-gray-500">{description}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-xs font-bold tabular-nums", textColors[color])}>
                        %{Math.round(percentage)}
                    </Badge>
                    <span className="text-xs text-gray-400 tabular-nums w-8 text-right">{value.toFixed(2)}</span>
                </div>
            </div>
            <div className="mt-3">
                <Slider
                    value={[value * 100]}
                    onValueChange={([v]) => onChange(Math.round(v) / 100)}
                    min={0}
                    max={100}
                    step={5}
                    className="w-full"
                />
            </div>
            {/* Visual weight bar */}
            <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                    className={cn("h-full rounded-full transition-all duration-500", barColors[color])}
                    style={{ width: `${Math.min(100, percentage)}%` }}
                />
            </div>
        </div>
    )
}

// ── Main Component ───────────────────────────────────
export default function GeneralSettingsPage() {
    const { scopeMode } = useAuth()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [registrationSettings, setRegistrationSettings] = useState<RegistrationSettings>(DEFAULT_REGISTRATION_SETTINGS)
    const [flavorSettings, setFlavorSettings] = useState<FlavorTuningSettings>(DEFAULT_FLAVOR_SETTINGS)
    const [activePreset, setActivePreset] = useState<string | null>(null)
    const [saveSuccess, setSaveSuccess] = useState(false)

    useEffect(() => {
        loadSettings()
    }, [scopeMode])

    const resolveRegistrationSettingsKey = async () => {
        const scopeCtx = await resolveTeamScopeContextFromAuth()
        const canToggleForAdminDoctor =
            scopeMode === 'team' &&
            scopeCtx.role === 'doctor' &&
            scopeCtx.canUseGlobal &&
            !!scopeCtx.userId

        const effectiveTeamOwnerId = canToggleForAdminDoctor
            ? scopeCtx.userId
            : scopeCtx.teamOwnerId

        const teamModeActive =
            scopeMode === 'team' &&
            !!effectiveTeamOwnerId &&
            (
                !scopeCtx.canUseGlobal ||
                canToggleForAdminDoctor ||
                scopeCtx.role === 'dietitian'
            )

        if (teamModeActive && effectiveTeamOwnerId) {
            return {
                key: `registration_settings__team_${effectiveTeamOwnerId}`,
                fallbackKey: 'registration_settings'
            }
        }

        return {
            key: 'registration_settings',
            fallbackKey: null as string | null
        }
    }

    const resolveFlavorSettingsKey = async () => {
        const scopeCtx = await resolveTeamScopeContextFromAuth()
        const canToggleForAdminDoctor =
            scopeMode === 'team' &&
            scopeCtx.role === 'doctor' &&
            scopeCtx.canUseGlobal &&
            !!scopeCtx.userId

        const effectiveTeamOwnerId = canToggleForAdminDoctor
            ? scopeCtx.userId
            : scopeCtx.teamOwnerId

        const teamModeActive =
            scopeMode === 'team' &&
            !!effectiveTeamOwnerId &&
            (
                !scopeCtx.canUseGlobal ||
                canToggleForAdminDoctor ||
                scopeCtx.role === 'dietitian'
            )

        if (teamModeActive && effectiveTeamOwnerId) {
            return {
                key: `flavor_tuning_settings__team_${effectiveTeamOwnerId}`,
                fallbackKey: 'flavor_tuning_settings'
            }
        }

        return {
            key: 'flavor_tuning_settings',
            fallbackKey: null as string | null
        }
    }

    const loadSettings = async () => {
        setLoading(true)
        try {
            const { key: registrationKey, fallbackKey: registrationFallbackKey } = await resolveRegistrationSettingsKey()
            let registration: any = null
            const { data: registrationRow } = await supabase
                .from("app_settings")
                .select("value")
                .eq("key", registrationKey)
                .maybeSingle()

            if (registrationRow?.value) {
                registration = registrationRow.value
            } else if (registrationFallbackKey) {
                const { data: fallbackRegistrationRow } = await supabase
                    .from("app_settings")
                    .select("value")
                    .eq("key", registrationFallbackKey)
                    .maybeSingle()
                if (fallbackRegistrationRow?.value) registration = fallbackRegistrationRow.value
            }

            if (registration) {
                setRegistrationSettings({
                    allow_program_selection: Boolean(registration.allow_program_selection),
                    allow_goal_selection: Boolean(registration.allow_goal_selection),
                })
            }

            const { key: flavorKey, fallbackKey } = await resolveFlavorSettingsKey()
            let flavor: any = null
            const { data: flavorRow } = await supabase
                .from("app_settings")
                .select("value")
                .eq("key", flavorKey)
                .maybeSingle()

            if (flavorRow?.value) {
                flavor = flavorRow.value
            } else if (fallbackKey) {
                const { data: fallbackRow } = await supabase
                    .from("app_settings")
                    .select("value")
                    .eq("key", fallbackKey)
                    .maybeSingle()
                if (fallbackRow?.value) flavor = fallbackRow.value
            }

            if (flavor) {
                const nextFlavorSettings: FlavorTuningSettings = {
                    enabled: Boolean(flavor.enabled),
                    allow_post_edit: Boolean(flavor.allow_post_edit ?? true),
                    respect_scope_filters: Boolean(flavor.respect_scope_filters ?? true),
                    respect_frequency_rules: Boolean(flavor.respect_frequency_rules ?? true),
                    use_pattern_insights: Boolean(flavor.use_pattern_insights ?? true),
                    strict_locked_items: Boolean(flavor.strict_locked_items ?? true),
                    suggestion_count: parseNumberInput(String(flavor.suggestion_count ?? 3), 3, 1, 6),
                    macro_weight: parseNumberInput(String(flavor.macro_weight ?? 0.4), 0.4, 0, 1),
                    flavor_weight: parseNumberInput(String(flavor.flavor_weight ?? 0.35), 0.35, 0, 1),
                    diversity_weight: parseNumberInput(String(flavor.diversity_weight ?? 0.15), 0.15, 0, 1),
                    compatibility_weight: parseNumberInput(String(flavor.compatibility_weight ?? 0.1), 0.1, 0, 1),
                    pattern_weight: parseNumberInput(String(flavor.pattern_weight ?? 0.2), 0.2, 0, 1),
                    pattern_min_confidence: parseNumberInput(String(flavor.pattern_min_confidence ?? 0.15), 0.15, 0, 1),
                    pattern_min_lift: parseNumberInput(String(flavor.pattern_min_lift ?? 1.1), 1.1, 0.1, 10),
                    pattern_min_support: parseNumberInput(String(flavor.pattern_min_support ?? 3), 3, 1, 999),
                }
                setFlavorSettings(nextFlavorSettings)
                setActivePreset(inferActivePreset(nextFlavorSettings))
            } else {
                setFlavorSettings(DEFAULT_FLAVOR_SETTINGS)
                setActivePreset(inferActivePreset(DEFAULT_FLAVOR_SETTINGS))
            }
        } finally {
            setLoading(false)
        }
    }

    const saveSettings = async () => {
        setSaving(true)
        setSaveSuccess(false)
        try {
            const flavorNormalized: FlavorTuningSettings = {
                ...flavorSettings,
                suggestion_count: parseNumberInput(String(flavorSettings.suggestion_count), 3, 1, 6),
                macro_weight: parseNumberInput(String(flavorSettings.macro_weight), 0.4, 0, 1),
                flavor_weight: parseNumberInput(String(flavorSettings.flavor_weight), 0.35, 0, 1),
                diversity_weight: parseNumberInput(String(flavorSettings.diversity_weight), 0.15, 0, 1),
                compatibility_weight: parseNumberInput(String(flavorSettings.compatibility_weight), 0.1, 0, 1),
                pattern_weight: parseNumberInput(String(flavorSettings.pattern_weight), 0.2, 0, 1),
                pattern_min_confidence: parseNumberInput(String(flavorSettings.pattern_min_confidence), 0.15, 0, 1),
                pattern_min_lift: parseNumberInput(String(flavorSettings.pattern_min_lift), 1.1, 0.1, 10),
                pattern_min_support: parseNumberInput(String(flavorSettings.pattern_min_support), 3, 1, 999),
            }

            const { key: registrationKey } = await resolveRegistrationSettingsKey()
            const { key: flavorKey } = await resolveFlavorSettingsKey()
            const { error } = await supabase.from("app_settings").upsert([
                {
                    key: registrationKey,
                    value: registrationSettings,
                    updated_at: new Date().toISOString(),
                },
                {
                    key: flavorKey,
                    value: flavorNormalized,
                    updated_at: new Date().toISOString(),
                },
            ])

            if (error) {
                alert("Kaydetme basarisiz: " + error.message)
                return
            }

            setFlavorSettings(flavorNormalized)
            setActivePreset(inferActivePreset(flavorNormalized))
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 3000)
        } finally {
            setSaving(false)
        }
    }

    const toggleRegistration = (key: keyof RegistrationSettings, checked: boolean) => {
        setRegistrationSettings(prev => ({ ...prev, [key]: checked }))
    }

    const toggleFlavor = (key: keyof Omit<FlavorTuningSettings, "suggestion_count" | "macro_weight" | "flavor_weight" | "diversity_weight" | "compatibility_weight" | "pattern_weight" | "pattern_min_confidence" | "pattern_min_lift" | "pattern_min_support">, checked: boolean) => {
        setFlavorSettings(prev => ({ ...prev, [key]: checked }))
        setActivePreset(null)
    }

    const updateWeight = (key: 'macro_weight' | 'flavor_weight' | 'diversity_weight' | 'compatibility_weight', value: number) => {
        setFlavorSettings(prev => ({ ...prev, [key]: value }))
        setActivePreset(null)
    }

    const applyPreset = (preset: PresetTemplate) => {
        setFlavorSettings(prev => ({
            ...prev,
            ...preset.values,
        }))
        setActivePreset(preset.id)
    }

    // ── Computed Analysis ──
    const total = flavorSettings.macro_weight + flavorSettings.flavor_weight + flavorSettings.diversity_weight + flavorSettings.compatibility_weight
    const macroPct = total > 0 ? (flavorSettings.macro_weight / total) * 100 : 25
    const flavorPct = total > 0 ? (flavorSettings.flavor_weight / total) * 100 : 25
    const diversityPct = total > 0 ? (flavorSettings.diversity_weight / total) * 100 : 25
    const compatPct = total > 0 ? (flavorSettings.compatibility_weight / total) * 100 : 25

    const analysis = useMemo(() => getScenarioAnalysis(flavorSettings), [flavorSettings])

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const AnalysisIcon = analysis.icon
    const settingsScopeLabel = scopeMode === 'team' ? 'Takım' : 'Global'

    return (
        <div className="container mx-auto max-w-5xl space-y-6 p-6">
            <div>
                <h1 className="text-3xl font-bold">Genel Ayarlar</h1>
                <p className="text-muted-foreground">
                    Kayıt izinleri ve {settingsScopeLabel.toLowerCase()} Lezzet Ayarı kriterleri burada yönetilir.
                </p>
            </div>

            {/* ── Registration Settings ── */}
            <Card>
                <CardHeader>
                    <CardTitle>Hasta Kayıt Formu İzinleri ({settingsScopeLabel})</CardTitle>
                    <CardDescription>
                        Hastalar kayıt olurken program/hedef seçimlerinin açık veya kapalı olmasını belirleyin.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <Label htmlFor="program-selection" className="text-base font-semibold">
                                Program Seçme Yetkisi
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Açıksa hasta kayıtta program seçebilir. Kapalıysa varsayılan program kullanılır.
                            </p>
                        </div>
                        <Switch
                            id="program-selection"
                            checked={registrationSettings.allow_program_selection}
                            onCheckedChange={checked => toggleRegistration("allow_program_selection", checked)}
                        />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <Label htmlFor="goal-selection" className="text-base font-semibold">
                                Hedef Seçme Yetkisi
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Açıksa hasta hedef seçebilir. Kapalıysa sistem varsayılan hedefle devam eder.
                            </p>
                        </div>
                        <Switch
                            id="goal-selection"
                            checked={registrationSettings.allow_goal_selection}
                            onCheckedChange={checked => toggleRegistration("allow_goal_selection", checked)}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* ── Flavor Tuning – Presets ── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-amber-500" />
                        Hızlı Profiller
                    </CardTitle>
                    <CardDescription>
                        Bir profil seçerek tüm ağırlıkları tek tıkla ayarlayın. Sonra ince ayar yapabilirsiniz.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {PRESET_TEMPLATES.map(preset => {
                            const Icon = preset.icon
                            const isActive = activePreset === preset.id
                            return (
                                <button
                                    key={preset.id}
                                    onClick={() => applyPreset(preset)}
                                    className={cn(
                                        "relative text-left rounded-xl border-2 p-4 transition-all duration-300 hover:shadow-md",
                                        `bg-gradient-to-br ${preset.bgGradient}`,
                                        isActive
                                            ? `${preset.borderColor.split(' ')[0]} ring-2 ring-offset-2 ring-current shadow-lg scale-[1.02]`
                                            : preset.borderColor
                                    )}
                                >
                                    {isActive && (
                                        <div className="absolute top-2 right-2">
                                            <CheckCircle2 className={cn("h-5 w-5", preset.color)} />
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2 mb-2">
                                        <Icon className={cn("h-5 w-5", preset.color)} />
                                        <h3 className="font-bold text-sm text-gray-800">{preset.name}</h3>
                                    </div>
                                    <p className="text-[11px] text-gray-600 leading-relaxed">{preset.description}</p>
                                </button>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* ── Flavor Tuning – Main Controls ── */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <SlidersHorizontal className="h-5 w-5" />
                        Lezzet Ayarı ({settingsScopeLabel})
                    </CardTitle>
                    <CardDescription>
                        Oto-plan sonrası önerilerde makro, lezzet, çeşitlilik ve uyumluluk dengesini detaylı ayarlayın.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Toggle Switches */}
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-xl border bg-white p-4 space-y-4">
                            <h4 className="font-bold text-sm text-gray-700 flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-blue-500" />
                                Güvenlik Kontrolleri
                            </h4>
                            {[
                                { id: 'flavor-enabled', key: 'enabled' as const, label: 'Lezzet Ayarı Aktif', desc: 'Ana anahtar: Kapalıysa tüm Gurme butonları devre dışı' },
                                { id: 'flavor-post-edit', key: 'allow_post_edit' as const, label: 'Post-edit önerileri', desc: 'Plan oluşturulduktan sonra düzenleme izni' },
                                { id: 'flavor-scope', key: 'respect_scope_filters' as const, label: 'Program/Faz filtresi', desc: 'Yalnızca hastanın programa uygun gıdalar' },
                                { id: 'flavor-frequency', key: 'respect_frequency_rules' as const, label: 'Sıklık kuralları', desc: 'Haftalık tekrar limitine uy' },
                                { id: 'flavor-pattern-insights', key: 'use_pattern_insights' as const, label: 'Örüntü içgörüleri', desc: 'Geçmiş kombinasyon metriklerini skora kat' },
                                { id: 'flavor-locked', key: 'strict_locked_items' as const, label: 'Kilitli öğeleri koru', desc: 'Diyetisyenin kilitlediği yemeklere dokunma' },
                            ].map(item => (
                                <div key={item.id} className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <Label htmlFor={item.id} className="text-sm font-semibold cursor-pointer">{item.label}</Label>
                                        <p className="text-[11px] text-gray-400 truncate">{item.desc}</p>
                                    </div>
                                    <Switch
                                        id={item.id}
                                        checked={flavorSettings[item.key] as boolean}
                                        onCheckedChange={checked => toggleFlavor(item.key, checked)}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="rounded-xl border bg-white p-4 space-y-4">
                            <h4 className="font-bold text-sm text-gray-700 flex items-center gap-2">
                                <Target className="h-4 w-4 text-indigo-500" />
                                Öneri Sayısı
                            </h4>
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm">Taranacak öneri adedi</Label>
                                    <Badge variant="outline" className="text-sm font-bold tabular-nums">
                                        {flavorSettings.suggestion_count}
                                    </Badge>
                                </div>
                                <Slider
                                    value={[flavorSettings.suggestion_count]}
                                    onValueChange={([v]) => {
                                        setFlavorSettings(prev => ({ ...prev, suggestion_count: v }))
                                        setActivePreset(null)
                                    }}
                                    min={1}
                                    max={6}
                                    step={1}
                                />
                                <div className="flex justify-between text-[10px] text-gray-400">
                                    <span>1 (Hızlı)</span>
                                    <span>3 (Dengeli)</span>
                                    <span>6 (Kapsamlı)</span>
                                </div>
                                <p className="text-[11px] text-gray-500 leading-relaxed">
                                    {flavorSettings.suggestion_count <= 2
                                        ? '🚀 Hızlı tarama: Sadece en iyi alternatifler değerlendirilir. İşlem süresi kısa.'
                                        : flavorSettings.suggestion_count <= 4
                                            ? '⚖️ Dengeli tarama: Makul sayıda alternatif karşılaştırılır. Çoğu senaryo için ideal.'
                                            : '🔍 Kapsamlı tarama: Tüm olası kombinasyonlar taranır. Daha iyi sonuç, daha uzun süre.'}
                                </p>
                            </div>

                            {/* Pie-like weight summary */}
                            <div className="mt-4 pt-4 border-t">
                                <h4 className="font-bold text-sm text-gray-700 mb-3">Ağırlık Dağılımı</h4>
                                <div className="flex rounded-full overflow-hidden h-3 bg-gray-100">
                                    <div className="bg-red-500 transition-all duration-500" style={{ width: `${macroPct}%` }} title={`Makro: %${Math.round(macroPct)}`} />
                                    <div className="bg-amber-500 transition-all duration-500" style={{ width: `${flavorPct}%` }} title={`Lezzet: %${Math.round(flavorPct)}`} />
                                    <div className="bg-purple-500 transition-all duration-500" style={{ width: `${diversityPct}%` }} title={`Çeşitlilik: %${Math.round(diversityPct)}`} />
                                    <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${compatPct}%` }} title={`Uyumluluk: %${Math.round(compatPct)}`} />
                                </div>
                                <div className="flex justify-between mt-1.5 text-[10px] text-gray-400">
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Makro</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Lezzet</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> Çeşitlilik</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Uyumluluk</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Weight Sliders */}
                    <div className="grid gap-3 sm:grid-cols-2">
                        <WeightSlider
                            label="Makro Ağırlığı"
                            description="Kalori/protein/yağ/karb hedeflerine sadakat"
                            value={flavorSettings.macro_weight}
                            onChange={v => updateWeight('macro_weight', v)}
                            color="red"
                            icon={Scale}
                            percentage={macroPct}
                        />
                        <WeightSlider
                            label="Lezzet Ağırlığı"
                            description="Hastanın damak tadına ve tercihlerine uyum"
                            value={flavorSettings.flavor_weight}
                            onChange={v => updateWeight('flavor_weight', v)}
                            color="amber"
                            icon={ChefHat}
                            percentage={flavorPct}
                        />
                        <WeightSlider
                            label="Çeşitlilik Ağırlığı"
                            description="Tekrardan kaçınma ve farklı gıda keşfi"
                            value={flavorSettings.diversity_weight}
                            onChange={v => updateWeight('diversity_weight', v)}
                            color="purple"
                            icon={Sparkles}
                            percentage={diversityPct}
                        />
                        <WeightSlider
                            label="Uyumluluk Ağırlığı"
                            description="Ana yemek + yancı eşleşme kalitesi"
                            value={flavorSettings.compatibility_weight}
                            onChange={v => updateWeight('compatibility_weight', v)}
                            color="emerald"
                            icon={Link2}
                            percentage={compatPct}
                        />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 rounded-xl border bg-white p-4">
                        <div className="space-y-3">
                            <h4 className="font-bold text-sm text-gray-700 flex items-center gap-2">
                                <Brain className="h-4 w-4 text-violet-500" />
                                Örüntü Eşikleri
                                <span
                                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-500 cursor-help"
                                    title="Örüntü metrikleri, geçmişte birlikte görülen yemek kombinasyonlarını (support/confidence/lift) skora dahil eder."
                                >
                                    ?
                                </span>
                            </h4>
                            <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Örüntü ağırlığı</Label>
                                <Slider
                                    value={[Math.round((flavorSettings.pattern_weight || 0) * 100)]}
                                    onValueChange={([v]) => {
                                        setFlavorSettings(prev => ({ ...prev, pattern_weight: Math.round(v) / 100 }))
                                        setActivePreset(null)
                                    }}
                                    min={0}
                                    max={100}
                                    step={5}
                                />
                                <p className="text-[11px] text-gray-500">
                                    Geçmiş kombinasyonların öneri skoruna etkisi.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Minimum confidence</Label>
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] text-gray-500">Kural güvenirliği eşiği</p>
                                    <Badge variant="outline" className="text-[11px] tabular-nums">{flavorSettings.pattern_min_confidence.toFixed(2)}</Badge>
                                </div>
                                <Slider
                                    value={[Math.round((flavorSettings.pattern_min_confidence || 0) * 100)]}
                                    onValueChange={([v]) => {
                                        setFlavorSettings(prev => ({ ...prev, pattern_min_confidence: Math.round(v) / 100 }))
                                        setActivePreset(null)
                                    }}
                                    min={0}
                                    max={100}
                                    step={1}
                                />
                                <p className="text-[11px] text-gray-500">
                                    Hover ipucu: Düşük olursa daha fazla ama daha zayıf örüntü kabul edilir.
                                </p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            <h4 className="font-bold text-sm text-gray-700 flex items-center gap-2">
                                <Link2 className="h-4 w-4 text-teal-500" />
                                Güven Filtresi
                                <span
                                    className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-500 cursor-help"
                                    title="Lift, birlikte görülmenin rastgele beklenenden ne kadar güçlü olduğunu gösterir. Support ise veri içinde kaç kez görüldüğünü gösterir."
                                >
                                    ?
                                </span>
                            </h4>
                            <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Minimum lift</Label>
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] text-gray-500">Beklenenin üstü bağ gücü</p>
                                    <Badge variant="outline" className="text-[11px] tabular-nums">{flavorSettings.pattern_min_lift.toFixed(2)}</Badge>
                                </div>
                                <Slider
                                    value={[Math.round((flavorSettings.pattern_min_lift || 0.1) * 100)]}
                                    onValueChange={([v]) => {
                                        setFlavorSettings(prev => ({ ...prev, pattern_min_lift: Math.max(0.1, Math.round(v) / 100) }))
                                        setActivePreset(null)
                                    }}
                                    min={10}
                                    max={300}
                                    step={5}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs text-gray-600">Minimum support (adet)</Label>
                                <div className="flex items-center justify-between">
                                    <p className="text-[11px] text-gray-500">Minimum birlikte görünme sayısı</p>
                                    <Badge variant="outline" className="text-[11px] tabular-nums">{Math.round(flavorSettings.pattern_min_support)}</Badge>
                                </div>
                                <Slider
                                    value={[Math.round(flavorSettings.pattern_min_support || 1)]}
                                    onValueChange={([v]) => {
                                        setFlavorSettings(prev => ({ ...prev, pattern_min_support: Math.max(1, Math.round(v)) }))
                                        setActivePreset(null)
                                    }}
                                    min={1}
                                    max={30}
                                    step={1}
                                />
                            </div>
                            <p className="text-[11px] text-gray-500">
                                Düşük güvenilirlikteki eşleşmeler filtrelenir.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-4 py-3 text-[12px] text-violet-900">
                        <p className="font-semibold mb-1">Gurme Editöre Etkisi</p>
                        <p>
                            Bu üç slider, lezzet değişimlerinde "hangi öneriyi neden seçtiğini" etkiler.
                            Eşikler yükseldikçe modalda daha güçlü ve daha az sayıda örüntü kaynağı görünür.
                            Eşikler düşerse çeşit artar, ama bazı önerilerin güveni daha düşük olabilir.
                        </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-700 space-y-2">
                        <p className="font-semibold text-slate-800">Hızlı Profiller ve Alt 4 Slider İlişkisi</p>
                        <p>Hızlı profil seçimi artık üstteki 4 ağırlıkla birlikte alttaki örüntü ve güven filtrelerini de eşler.</p>
                        <p><span className="font-medium">Klinik Katı:</span> confidence/lift/support artar. Daha az ama daha güvenilir örüntü önerisi gelir.</p>
                        <p><span className="font-medium">Ultra Esnek:</span> eşikler düşer. Alternatif sayısı artar, fakat örüntü güven kalitesi daha değişken olabilir.</p>
                        <p><span className="font-medium">Gurme Eşleşme:</span> pattern ağırlığı artar; uyumluluk ve geçmiş kombinasyon etkisi belirginleşir.</p>
                    </div>
                </CardContent>
            </Card>

            {/* ── Live Scenario Analysis ── */}
            <Card className="overflow-hidden">
                <div className={cn("px-6 py-4 flex items-center gap-3 border-b", analysis.bgColor)}>
                    <AnalysisIcon className={cn("h-6 w-6", analysis.color)} />
                    <div>
                        <h3 className="font-bold text-base text-gray-900">{analysis.summary}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Bu ayarlarla Gurme Editör şu şekilde davranacaktır:
                        </p>
                    </div>
                </div>
                <CardContent className="pt-5 space-y-4">
                    {/* Scenarios */}
                    <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-3">
                        {analysis.scenarios.map((scenario, i) => (
                            <div key={i} className="rounded-xl border bg-white p-4 hover:shadow-md transition-shadow">
                                <div className="flex items-start gap-2 mb-2">
                                    <span className="text-xl">{scenario.emoji}</span>
                                    <h4 className="font-bold text-sm text-gray-800 pt-0.5">{scenario.title}</h4>
                                </div>
                                <p className="text-[12px] text-gray-600 leading-relaxed">{scenario.description}</p>
                            </div>
                        ))}
                    </div>

                    {/* Warnings */}
                    {analysis.warnings.length > 0 && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
                            <h4 className="font-bold text-sm text-amber-800 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                Dikkat Edilmesi Gerekenler
                            </h4>
                            {analysis.warnings.map((w, i) => (
                                <div key={i} className="flex items-start gap-2 text-[12px] text-amber-700">
                                    <ArrowRight className="h-3 w-3 mt-0.5 shrink-0" />
                                    <span>{w}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Tips */}
                    {analysis.tips.length > 0 && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2">
                            <h4 className="font-bold text-sm text-blue-800 flex items-center gap-2">
                                <Info className="h-4 w-4" />
                                Uzman İpuçları
                            </h4>
                            {analysis.tips.map((t, i) => (
                                <div key={i} className="flex items-start gap-2 text-[12px] text-blue-700">
                                    <Brain className="h-3 w-3 mt-0.5 shrink-0" />
                                    <span>{t}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        💡 Not: Ağırlıkların toplamı 1 olmak zorunda değildir. Motor bu değerleri otomatik normalize eder.
                        Önemli olan göreceli büyüklüklerdir; makro ağırlığı 0.7 ve lezzet 0.3 ise (toplam 1.0), makro ağırlığı
                        7 ve lezzet 3 (toplam 10) ile aynı etkiyi yaratır.
                    </div>
                </CardContent>
                <CardFooter className="bg-gray-50 border-t">
                    <div className="flex items-center gap-3 ml-auto">
                        {saveSuccess && (
                            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium animate-in fade-in duration-300">
                                <CheckCircle2 className="h-4 w-4" />
                                Ayarlar kaydedildi!
                            </span>
                        )}
                        <Button onClick={saveSettings} disabled={saving} size="lg">
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Ayarları Kaydet
                        </Button>
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}
