"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { ArrowLeft, Info, ChevronDown, ChevronUp, Zap, Loader2, BookOpen, ExternalLink, RotateCcw, Save } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    calculateFormulaTargets,
    calculateCoefficientTargets,
    calculateKetoKlinik,
    calculateBMI,
    idealWeight,
    estimatedMonthlyChange,
    FORMULA_LABELS,
    ACTIVITY_LABELS,
    type PatientInput,
    type ActivityLevel,
    type Gender,
    type MacroResult,
} from "@/lib/nutrition/energy"

type CalcMode = 'coefficient' | 'mifflin' | 'harris' | 'keto_klinik'

const CALC_MODES: { key: CalcMode, label: string, shortLabel: string }[] = [
    { key: 'coefficient', label: 'Program Katsayısı', shortLabel: 'Katsayı' },
    { key: 'mifflin', label: 'Mifflin-St Jeor', shortLabel: 'Mifflin' },
    { key: 'harris', label: 'Harris-Benedict', shortLabel: 'Harris-B' },
    { key: 'keto_klinik', label: 'Keto Klinik', shortLabel: 'Keto' },
]

type GoalMode = 'lose' | 'maintain' | 'gain'

const GAUGE_MIN = -40, GAUGE_MAX = 40, GAUGE_RANGE = GAUGE_MAX - GAUGE_MIN

const MACRO_DEFS = [
    { key: 'carb' as const, label: 'Karbonhidrat', color: '#059669', bg: '#ecfdf5', min: 5, max: 400 },
    { key: 'protein' as const, label: 'Protein', color: '#0d9488', bg: '#f0fdfa', min: 20, max: 300 },
    { key: 'fat' as const, label: 'Yağ', color: '#10b981', bg: '#f0fdf4', min: 10, max: 250 },
] as const

export default function PatientEnergyPage() {
    const { profile, user } = useAuth()
    const [loading, setLoading] = useState(true)
    const [showInfo, setShowInfo] = useState(false)
    const [showScience, setShowScience] = useState(false)

    const [patientId, setPatientId] = useState<string | null>(null)
    const [currentTargetMode, setCurrentTargetMode] = useState<string>('calculated')
    const [patientData, setPatientData] = useState<{
        kg: number; heightCm: number; age: number; gender: Gender;
        activityLevel: ActivityLevel; dietType: any; patientGoals: string[]
    } | null>(null)

    const [activeMode, setActiveMode] = useState<CalcMode>('coefficient')
    const [goalMode, setGoalMode] = useState<GoalMode>('lose')
    const [deficitPercent, setDeficitPercent] = useState(-30)
    const [useIdealWeight, setUseIdealWeight] = useState(true)
    const [programPhases, setProgramPhases] = useState<any[]>([])
    const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null)

    // Custom macro overrides
    const [customMacros, setCustomMacros] = useState<{ carb: number; protein: number; fat: number } | null>(null)
    const [macrosSaved, setMacrosSaved] = useState(false)
    const [savedCustomSource, setSavedCustomSource] = useState<string | null>(null)

    useEffect(() => {
        if (user && profile) loadPatientData()
    }, [user, profile])

    async function loadPatientData() {
        try {
            const targetId = profile?.id || user?.id
            if (!targetId) return

            const selectCols = 'id, weight, height, birth_date, gender, activity_level, patient_goals, macro_target_mode, preferences, program_templates(id, name, program_template_weeks(week_start, week_end, diet_type_id))'
            const [{ data: legacyMatch }, { data: directMatch }] = await Promise.all([
                supabase.from('patients').select(selectCols).eq('user_id', targetId).neq('id', targetId).limit(1).maybeSingle(),
                supabase.from('patients').select(selectCols).eq('id', targetId).maybeSingle()
            ])

            const patient = legacyMatch || directMatch
            if (!patient || !patient.weight || !patient.height) { setLoading(false); return }

            setPatientId(patient.id)
            setCurrentTargetMode((patient as any).macro_target_mode || 'calculated')

            const savedCustom = (patient as any).preferences?.custom_targets
            if (savedCustom && (patient as any).macro_target_mode === 'custom') {
                if (savedCustom.source) {
                    setActiveMode(savedCustom.source as CalcMode)
                    setSavedCustomSource(savedCustom.source)
                }
            }

            const age = patient.birth_date
                ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                : 35

            let resolvedDietType: any = null
            const allPhases: any[] = []
            const pt = Array.isArray(patient.program_templates) ? patient.program_templates[0] : patient.program_templates
            if (pt?.program_template_weeks) {
                const todayStr = new Date().toISOString().slice(0, 10)
                const weeks = Array.isArray(pt.program_template_weeks) ? pt.program_template_weeks : [pt.program_template_weeks]
                const currentWeek = weeks.find((w: any) => todayStr >= w.week_start && (!w.week_end || todayStr <= w.week_end))
                const activeWeek = currentWeek || weeks[0]

                // Collect all distinct diet_type_ids from program weeks
                const dtIds = [...new Set(weeks.map((w: any) => w.diet_type_id).filter(Boolean))] as string[]
                if (dtIds.length > 0) {
                    const { data: dtList } = await supabase.from('diet_types').select('*').in('id', dtIds)
                    if (dtList) {
                        for (const dt of dtList) allPhases.push(dt)
                        resolvedDietType = dtList.find(d => d.id === activeWeek?.diet_type_id) || dtList[0]
                    }
                }
            }
            setProgramPhases(allPhases)
            if (resolvedDietType) setSelectedPhaseId(resolvedDietType.id)

            const goals = patient.patient_goals || []
            if (goals.includes('Kilo Almak') || goals.includes('Kas Gelişimi (Hipertrofi)')) {
                setGoalMode('gain'); setDeficitPercent(15)
            } else if (goals.includes('Kilo Korumak')) {
                setGoalMode('maintain'); setDeficitPercent(0)
            }

            setPatientData({
                kg: patient.weight, heightCm: patient.height, age,
                gender: (patient.gender as Gender) || 'female',
                activityLevel: (patient.activity_level || 3) as ActivityLevel,
                dietType: resolvedDietType, patientGoals: goals,
            })
        } catch (err) {
            console.error('Energy page error:', err)
        } finally {
            setLoading(false)
        }
    }

    const patientInput = useMemo<PatientInput | null>(() => {
        if (!patientData) return null
        return { kg: patientData.kg, heightCm: patientData.heightCm, age: patientData.age, gender: patientData.gender, activityLevel: patientData.activityLevel }
    }, [patientData])

    const activeDietType = useMemo(() => {
        if (selectedPhaseId && programPhases.length > 0) {
            return programPhases.find(p => p.id === selectedPhaseId) || patientData?.dietType
        }
        return patientData?.dietType
    }, [selectedPhaseId, programPhases, patientData?.dietType])

    const results = useMemo(() => {
        if (!patientData || !patientInput) return null

        const dt = activeDietType
        const coeff = calculateCoefficientTargets({
            kg: patientData.kg, activityLevel: patientData.activityLevel,
            carbFactor: dt?.carb_factor ?? 3.0, proteinFactor: dt?.protein_factor ?? 1.0, fatFactor: dt?.fat_factor ?? 0.8,
            patientGoals: patientData.patientGoals,
        })

        const mifflin = calculateFormulaTargets(patientInput, { formula: 'mifflin', deficitPercent, carbPercent: 12, proteinPercent: 25, fatPercent: 63, useIdealWeight })
        const harris = calculateFormulaTargets(patientInput, { formula: 'harris_benedict', deficitPercent, carbPercent: 12, proteinPercent: 25, fatPercent: 63, useIdealWeight })
        const keto = calculateKetoKlinik(patientInput)

        return { coefficient: coeff, mifflin, harris, keto_klinik: keto }
    }, [patientData, patientInput, deficitPercent, useIdealWeight, activeDietType])

    const activeResult = useMemo<MacroResult | null>(() => {
        if (!results) return null
        return results[activeMode]
    }, [results, activeMode])

    // Displayed macros: custom overrides or calculated
    const displayMacros = useMemo(() => {
        if (customMacros) return customMacros
        if (!activeResult) return null
        return { carb: activeResult.carb, protein: activeResult.protein, fat: activeResult.fat }
    }, [customMacros, activeResult])

    const displayCalories = useMemo(() => {
        if (!displayMacros) return 0
        return Math.round(displayMacros.carb * 4 + displayMacros.protein * 4 + displayMacros.fat * 9)
    }, [displayMacros])

    // Reset custom macros when mode or deficit changes
    useEffect(() => {
        setCustomMacros(null)
        setMacrosSaved(false)
    }, [activeMode, deficitPercent, useIdealWeight])

    const formulaInfo = useMemo(() => {
        if (!patientInput || !results) return null
        if (activeMode === 'mifflin' || activeMode === 'harris') {
            const r = results[activeMode] as ReturnType<typeof calculateFormulaTargets>
            return { bmr: r.bmr, tdee: r.tdee, formula: r.formula, multiplier: r.activityMultiplier }
        }
        return null
    }, [patientInput, results, activeMode])

    const monthlyChange = useMemo(() => {
        if (!formulaInfo) return null
        return estimatedMonthlyChange(formulaInfo.tdee, displayCalories)
    }, [formulaInfo, displayCalories])

    const handleGoalChange = useCallback((mode: GoalMode) => {
        setGoalMode(mode)
        setDeficitPercent(mode === 'lose' ? -30 : mode === 'gain' ? 15 : 0)
    }, [])

    // ── Gauge drag ──
    const gaugeAngle = useMemo(() => Math.min(Math.max((deficitPercent - GAUGE_MIN) / GAUGE_RANGE * 180, 0), 180), [deficitPercent])
    const gaugeColor = useMemo(() => deficitPercent < -5 ? '#059669' : deficitPercent > 5 ? '#0d9488' : '#6ee7b7', [deficitPercent])

    const svgRef = useRef<SVGSVGElement>(null)
    const gaugeDragging = useRef(false)

    const pointerToDeficit = useCallback((clientX: number, clientY: number) => {
        const svg = svgRef.current
        if (!svg) return
        const rect = svg.getBoundingClientRect()
        const sx = (clientX - rect.left) / rect.width * 240
        const sy = (clientY - rect.top) / rect.height * 135
        const dx = sx - 120
        const dy = 115 - sy
        let angle = Math.atan2(dy, dx) * (180 / Math.PI)
        // When pointer goes below the arc center, clamp to nearest edge
        if (angle < 0) angle = dx < 0 ? 180 : 0
        if (angle > 180) angle = 180
        const pct = GAUGE_MAX - (angle / 180) * GAUGE_RANGE
        const clamped = Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, Math.round(pct)))
        setDeficitPercent(clamped)
        if (clamped < -5) setGoalMode('lose')
        else if (clamped > 5) setGoalMode('gain')
        else setGoalMode('maintain')
    }, [])

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            if (gaugeDragging.current) {
                e.preventDefault()
                pointerToDeficit(e.clientX, e.clientY)
            }
        }
        const onUp = () => { gaugeDragging.current = false }
        window.addEventListener('pointermove', onMove, { passive: false })
        window.addEventListener('pointerup', onUp)
        return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    }, [pointerToDeficit])

    // ── Macro bar drag ──
    const macroDragging = useRef<string | null>(null)
    const macroBarRefs = useRef<Record<string, HTMLDivElement | null>>({})

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const key = macroDragging.current
            if (!key) return
            e.preventDefault()
            const bar = macroBarRefs.current[key]
            if (!bar) return
            const rect = bar.getBoundingClientRect()
            const def = MACRO_DEFS.find(m => m.key === key)!
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            const newVal = Math.round(def.min + ratio * (def.max - def.min))

            setCustomMacros(prev => {
                const base = prev || (activeResult ? { carb: activeResult.carb, protein: activeResult.protein, fat: activeResult.fat } : { carb: 0, protein: 0, fat: 0 })
                return { ...base, [key]: newVal }
            })
            setMacrosSaved(false)
        }
        const onUp = () => { macroDragging.current = null }
        window.addEventListener('pointermove', onMove, { passive: false })
        window.addEventListener('pointerup', onUp)
        return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    }, [activeResult])

    const [saving, setSaving] = useState(false)

    const handleMacroReset = useCallback(async () => {
        if (!patientId) return
        setCustomMacros(null)
        setMacrosSaved(false)
        const { data: p } = await supabase.from('patients').select('preferences').eq('id', patientId).maybeSingle()
        if (p?.preferences) {
            const prefs = { ...p.preferences } as any
            delete prefs.custom_targets
            await supabase.from('patients').update({ macro_target_mode: 'calculated', preferences: prefs }).eq('id', patientId)
        } else {
            await supabase.from('patients').update({ macro_target_mode: 'calculated' }).eq('id', patientId)
        }
        setCurrentTargetMode('calculated')
        setSavedCustomSource(null)
    }, [patientId])

    const handleApplyTargets = useCallback(async () => {
        if (!patientId || !displayMacros) return
        setSaving(true)
        try {
            const { data: p } = await supabase.from('patients').select('preferences').eq('id', patientId).maybeSingle()
            const prefs = (p?.preferences || {}) as any
            prefs.custom_targets = {
                carb: displayMacros.carb,
                protein: displayMacros.protein,
                fat: displayMacros.fat,
                calories: displayCalories,
                source: activeMode,
                deficitPercent: (activeMode === 'mifflin' || activeMode === 'harris') ? deficitPercent : undefined,
                savedAt: new Date().toISOString(),
            }
            await supabase.from('patients').update({
                macro_target_mode: 'custom',
                preferences: prefs,
            }).eq('id', patientId)
            setCurrentTargetMode('custom')
            setSavedCustomSource(activeMode)
            setMacrosSaved(true)
            setTimeout(() => setMacrosSaved(false), 3000)
        } catch (err) {
            console.error('Save targets error:', err)
        } finally {
            setSaving(false)
        }
    }, [patientId, displayMacros, displayCalories, activeMode, deficitPercent])

    if (loading) {
        return (
            <div className="flex min-h-[55vh] items-center justify-center px-4">
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                    <span>Hesaplanıyor...</span>
                </div>
            </div>
        )
    }

    if (!patientData || !activeResult || !results || !displayMacros) {
        return (
            <div className="p-4 space-y-3">
                <Link href="/patient" className="flex items-center gap-1 text-sm text-gray-500"><ArrowLeft className="h-4 w-4" /> Geri</Link>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                    <Info className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                    <p className="text-sm text-amber-700 font-medium">Enerji hesaplaması için profil bilgileriniz (kilo, boy, yaş) gereklidir.</p>
                    <Link href="/patient/settings" className="text-sm text-emerald-600 font-semibold mt-2 inline-block">Profili Güncelle →</Link>
                </div>
            </div>
        )
    }

    const bmi = calculateBMI(patientData.kg, patientData.heightCm)
    const isFormulaMode = activeMode === 'mifflin' || activeMode === 'harris'
    const isKetoMode = activeMode === 'keto_klinik'
    const hasCustom = customMacros !== null

    return (
        <div className="space-y-2 pb-24 px-3 pt-2">
            {/* Header */}
            <div className="flex items-center gap-2">
                <Link href="/patient" className="p-1.5 rounded-lg hover:bg-gray-100"><ArrowLeft className="h-4 w-4 text-gray-500" /></Link>
                <div className="flex items-center gap-1.5 flex-1">
                    <Zap className="h-4 w-4 text-amber-500" />
                    {activeDietType && (
                        <span className="text-sm font-bold text-gray-900">{activeDietType.name}</span>
                    )}
                </div>
                <button onClick={() => setShowInfo(!showInfo)} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <Info className="h-4 w-4 text-gray-400" />
                </button>
            </div>

            {showInfo && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-[11px] text-blue-700 space-y-1">
                    <p className="font-semibold">Bu sayfa ne işe yarar?</p>
                    <p>Farklı hesaplama yöntemleriyle günlük enerji ihtiyacınızı karşılaştırabilirsiniz. Varsayılan olarak programınızın katsayıları kullanılır.</p>
                    <p className="text-blue-500">Hesaplamalar bilgilendirme amaçlıdır ve mevcut program hedeflerinizin yerini almaz.</p>
                </div>
            )}

            {/* Patient Summary */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                <div className="flex items-center justify-between text-[10px] text-emerald-700">
                    <span className="font-bold">{patientData.kg} kg · {patientData.heightCm} cm · {patientData.age} yaş · {patientData.gender === 'female' ? 'K' : 'E'}</span>
                    <span className="font-medium">BMI {bmi.toFixed(1)} · {ACTIVITY_LABELS[patientData.activityLevel].tr}</span>
                </div>
                {activeDietType && (
                    <div className="text-[10px] text-emerald-600 mt-0.5">
                        {activeDietType.name} (K:{activeDietType.carb_factor} P:{activeDietType.protein_factor} Y:{activeDietType.fat_factor})
                    </div>
                )}
            </div>

            {/* 4-Mode Tab Selector */}
            <div className="grid grid-cols-4 gap-1 bg-gray-100 rounded-xl p-1">
                {CALC_MODES.map(mode => (
                    <button
                        key={mode.key}
                        onClick={() => setActiveMode(mode.key)}
                        className={cn(
                            "py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all text-center leading-tight",
                            activeMode === mode.key
                                ? "bg-emerald-600 shadow-sm text-white"
                                : "text-gray-500 hover:text-gray-700 bg-transparent"
                        )}
                    >
                        {mode.shortLabel}
                    </button>
                ))}
            </div>

            {/* Phase selector — coefficient mode, multiple phases */}
            {activeMode === 'coefficient' && programPhases.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    {programPhases.map(phase => (
                        <button
                            key={phase.id}
                            onClick={() => setSelectedPhaseId(phase.id)}
                            className={cn(
                                "px-2.5 py-1 rounded-lg text-[9px] font-bold border transition-all",
                                selectedPhaseId === phase.id
                                    ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                                    : "bg-white border-gray-200 text-gray-400"
                            )}
                        >
                            {phase.name}
                        </button>
                    ))}
                </div>
            )}

            {/* BMR/TDEE info — formula modes */}
            {formulaInfo && (
                <div className="bg-white border border-gray-200 rounded-xl px-3 py-2">
                    <div className="flex items-end gap-2">
                        <div>
                            <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">BMR</span>
                            <div><span className="text-lg font-black text-gray-900">{formulaInfo.bmr}</span><span className="text-[9px] text-gray-400 ml-0.5">kcal</span></div>
                        </div>
                        <span className="text-[10px] text-gray-400 pb-1">× {formulaInfo.multiplier} =</span>
                        <div>
                            <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">TDEE</span>
                            <div><span className="text-lg font-extrabold text-emerald-600">{formulaInfo.tdee}</span><span className="text-[9px] text-gray-400 ml-0.5">kcal</span></div>
                        </div>
                    </div>
                    <button onClick={() => setUseIdealWeight(v => !v)} className="flex items-center gap-2 mt-1.5 w-full">
                        <div className={cn("w-7 h-4 rounded-full transition-colors relative shrink-0", useIdealWeight ? "bg-emerald-500" : "bg-gray-300")}>
                            <div className={cn("absolute top-[2px] w-3 h-3 rounded-full bg-white shadow transition-transform", useIdealWeight ? "translate-x-[14px]" : "translate-x-[2px]")} />
                        </div>
                        <span className="text-[9px] text-gray-500">
                            {useIdealWeight
                                ? <>İdeal kilo (<span className="font-bold text-emerald-600">{Math.round(idealWeight(patientData.heightCm))} kg</span>)</>
                                : <>Mevcut kilo (<span className="font-bold">{patientData.kg} kg</span>)</>
                            }
                        </span>
                    </button>
                </div>
            )}

            {/* Keto Klinik info */}
            {isKetoMode && (() => {
                const keto = results.keto_klinik
                return (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-orange-600">Ketojenik Oran Hesabı</span>
                            <span className="text-xs font-black text-orange-700">K/AK: {keto.ketoRatio}</span>
                        </div>
                        <div className="text-[10px] text-orange-600 space-y-0.5">
                            <p>Sabit karb ≤25g · Protein: 1.2–1.5 g/kg ideal kilo · Yağ: K/AK≥1.5</p>
                            <p>İdeal kilo: {keto.idealKg} kg · Referans kilo: {keto.refKg} kg</p>
                            {keto.warnings.map((w, i) => <p key={i} className="text-red-600 font-semibold">⚠ {w}</p>)}
                        </div>
                    </div>
                )
            })()}

            {/* Goal Selector — formula modes */}
            {isFormulaMode && (
                <div className="flex gap-1.5">
                    {(['lose', 'maintain', 'gain'] as GoalMode[]).map(mode => {
                        const labels: Record<GoalMode, string> = { lose: 'Kilo Ver', maintain: 'Koru', gain: 'Kas Kazan' }
                        return (
                            <button
                                key={mode}
                                onClick={() => handleGoalChange(mode)}
                                className={cn(
                                    "flex-1 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                                    goalMode === mode ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-white border-gray-200 text-gray-400"
                                )}
                            >
                                {labels[mode]}
                            </button>
                        )
                    })}
                </div>
            )}

            {/* Main Card — Gauge + Calories + Macros */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
                {/* Draggable Gauge — formula modes only */}
                {isFormulaMode && (
                    <div className="flex justify-center mb-1">
                        <div className="relative select-none" style={{ width: 220, height: 124 }}>
                            <svg ref={svgRef} viewBox="0 0 240 135" className="w-full h-full"
                                style={{ touchAction: 'none' }}
                            >
                                {/* Track background */}
                                <path d="M 25 115 A 95 95 0 0 1 215 115" fill="none" stroke="#f1f5f9" strokeWidth="16" strokeLinecap="round" />
                                {/* Colored arc */}
                                <path d="M 25 115 A 95 95 0 0 1 215 115" fill="none" stroke={gaugeColor} strokeWidth="16" strokeLinecap="round"
                                    strokeDasharray={`${(gaugeAngle / 180) * Math.PI * 95} ${Math.PI * 95}`}
                                />
                                {/* Wide invisible hit area on the arc — tap anywhere to jump */}
                                <path d="M 25 115 A 95 95 0 0 1 215 115" fill="none" stroke="transparent" strokeWidth="40"
                                    style={{ cursor: 'pointer' }}
                                    onPointerDown={(e) => {
                                        e.preventDefault()
                                        gaugeDragging.current = true
                                        pointerToDeficit(e.clientX, e.clientY)
                                    }}
                                />
                                {/* Thumb — visible dot */}
                                {(() => {
                                    const rad = (Math.PI * (180 - gaugeAngle)) / 180
                                    const cx = 120 + 95 * Math.cos(rad)
                                    const cy = 115 - 95 * Math.sin(rad)
                                    return (
                                        <>
                                            <circle cx={cx} cy={cy} r="22" fill="transparent"
                                                style={{ cursor: 'grab' }}
                                                onPointerDown={(e) => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    gaugeDragging.current = true
                                                }}
                                            />
                                            <circle cx={cx} cy={cy} r="12" fill={gaugeColor} stroke="white" strokeWidth="3" pointerEvents="none"
                                                style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}
                                            />
                                        </>
                                    )
                                })()}
                                {/* Labels */}
                                <text x="20" y="132" fontSize="9" fill="#94a3b8" textAnchor="start">-40%</text>
                                <text x="120" y="16" fontSize="9" fill="#94a3b8" textAnchor="middle">0%</text>
                                <text x="220" y="132" fontSize="9" fill="#94a3b8" textAnchor="end">+40%</text>
                            </svg>
                        </div>
                    </div>
                )}

                {/* Calorie number */}
                <div className="text-center">
                    {!isFormulaMode && <span className="text-[10px] text-gray-400 block mb-0.5">günlük kalori hedefi</span>}
                    <span className="text-3xl font-black text-gray-900 tracking-tight">
                        {displayCalories.toLocaleString('tr-TR')}
                    </span>
                    <span className="text-sm text-gray-400 ml-1">kcal</span>
                    {hasCustom && <span className="text-[10px] text-violet-500 block mt-0.5">özel ayar</span>}
                </div>

                {/* Deficit badge — formula modes */}
                {isFormulaMode && !hasCustom && (
                    <div className="flex justify-center mt-0.5 mb-1">
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            {deficitPercent > 0 ? '+' : ''}{deficitPercent}% {deficitPercent < 0 ? 'Açık' : deficitPercent > 0 ? 'Fazla' : 'Denge'}
                        </span>
                    </div>
                )}

                {/* Monthly change */}
                {isFormulaMode && monthlyChange !== null && monthlyChange !== 0 && (
                    <p className="text-center text-[10px] text-gray-400 mb-1">
                        ~<span className="font-bold text-emerald-600">{Math.abs(monthlyChange)} kg</span>/ay {monthlyChange < 0 ? 'kayıp' : 'kazanım'}
                    </p>
                )}

                {activeMode === 'coefficient' && activeDietType && !hasCustom && (
                    <p className="text-center text-[10px] text-emerald-600 mb-1">
                        {activeDietType.name} · K:{activeDietType.carb_factor} P:{activeDietType.protein_factor} Y:{activeDietType.fat_factor}
                    </p>
                )}

                {/* Draggable Macro Bars */}
                <div className="space-y-2 mt-2">
                    {MACRO_DEFS.map(m => {
                        const value = displayMacros[m.key]
                        const kcal = Math.round(value * (m.key === 'fat' ? 9 : 4))
                        const ratio = (value - m.min) / (m.max - m.min)
                        const pct = Math.max(0, Math.min(100, ratio * 100))

                        return (
                            <div key={m.key}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-semibold text-gray-600">{m.label}</span>
                                    <span className="text-sm font-extrabold text-gray-900">{value}g
                                        <span className="text-[10px] text-gray-400 font-medium ml-1">({kcal} kcal)</span>
                                    </span>
                                </div>
                                <div
                                    ref={(el) => { macroBarRefs.current[m.key] = el }}
                                    className="relative h-6 rounded-full select-none cursor-pointer"
                                    style={{ background: m.bg, touchAction: 'none' }}
                                    onPointerDown={(e) => {
                                        e.preventDefault()
                                        macroDragging.current = m.key
                                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                                        const newVal = Math.round(m.min + ratio * (m.max - m.min))
                                        setCustomMacros(prev => {
                                            const base = prev || (activeResult ? { carb: activeResult.carb, protein: activeResult.protein, fat: activeResult.fat } : { carb: 0, protein: 0, fat: 0 })
                                            return { ...base, [m.key]: newVal }
                                        })
                                        setMacrosSaved(false)
                                    }}
                                >
                                    {/* Filled portion */}
                                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: m.color, opacity: 0.3 }} />
                                    {/* Thumb dot */}
                                    <div
                                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none"
                                        style={{ left: `${pct}%` }}
                                    >
                                        <div className="w-6 h-6 rounded-full border-[2.5px] border-white shadow-lg" style={{ background: m.color }} />
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* "Bu hedefi kullan" — hide if this mode is already the active target */}
                {(() => {
                    const isAlreadyActive = (currentTargetMode === 'calculated' && activeMode === 'coefficient')
                        || (currentTargetMode === 'custom' && savedCustomSource === activeMode)
                    if (isAlreadyActive && !hasCustom) {
                        return (
                            <div className="mt-3 flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                <span className="text-[10px] text-emerald-700 font-semibold">Bu hedef aktif ✓</span>
                                {currentTargetMode === 'custom' && (
                                    <button onClick={handleMacroReset} className="text-[10px] text-emerald-500 font-bold hover:text-emerald-700">Varsayılana dön</button>
                                )}
                            </div>
                        )
                    }
                    if (!hasCustom) {
                        return (
                            <div className="mt-2">
                                <button onClick={handleApplyTargets} disabled={saving}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                                >
                                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                    Bu Hedefi Kullan
                                </button>
                            </div>
                        )
                    }
                    return null
                })()}

                {/* Apply / Reset buttons — when macros are manually adjusted */}
                {hasCustom && (
                    <div className="flex gap-2 mt-3">
                        <button onClick={handleMacroReset}
                            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border-2 border-gray-200 text-[11px] font-bold text-gray-500 hover:bg-gray-50 transition-colors"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={handleApplyTargets} disabled={saving}
                            className={cn(
                                "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold transition-colors",
                                macrosSaved
                                    ? "bg-emerald-100 border-2 border-emerald-300 text-emerald-700"
                                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                            )}
                        >
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                            {macrosSaved ? 'Hedef Kaydedildi' : 'Bu Hedefi Kullan'}
                        </button>
                    </div>
                )}
            </div>

            {/* Science section */}
            <button
                onClick={() => setShowScience(!showScience)}
                className="w-full bg-white rounded-xl border border-gray-100 shadow-sm p-3 text-left"
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-[11px] font-bold text-gray-800">Bilimsel Dayanak ve Kaynakça</span>
                    </div>
                    {showScience ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>
            </button>

            {showScience && (
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm -mt-1 overflow-hidden">
                    <div className="p-3 space-y-2 border-b border-gray-100">
                        <h3 className="text-[11px] font-bold text-gray-800">Hesaplama Yöntemleri</h3>
                        <div className="bg-emerald-50 rounded-lg p-2">
                            <p className="font-bold text-[10px] text-emerald-700 mb-0.5">Program Katsayısı (Varsayılan)</p>
                            <p className="text-[9px] text-emerald-600 leading-relaxed">Diyet türüne göre belirlenen makro katsayıları × vücut ağırlığı × aktivite düzeyi. Klinik beslenme pratiğinde yaygın kullanılan kişiselleştirilmiş bir yöntemdir.</p>
                        </div>
                        <div className="bg-emerald-50/50 rounded-lg p-2">
                            <p className="font-bold text-[10px] text-emerald-700 mb-0.5">Mifflin-St Jeor (1990)</p>
                            <p className="text-[9px] text-emerald-600 leading-relaxed">Obez bireyler dahil en tutarlı BMR denklemi. Frankenfield ve ark. (2005) sistematik derlemesinde klinik kullanım için birincil olarak önerilmiştir [1][3].</p>
                        </div>
                        <div className="bg-emerald-50/50 rounded-lg p-2">
                            <p className="font-bold text-[10px] text-emerald-700 mb-0.5">Harris-Benedict (1984 Revizyonu)</p>
                            <p className="text-[9px] text-emerald-600 leading-relaxed">Orijinal denklemin Roza-Shizgal revizyonu. Mifflin'e kıyasla genellikle %2–5 daha yüksek BMR tahmini verir [2].</p>
                        </div>
                        <div className="bg-teal-50 rounded-lg p-2">
                            <p className="font-bold text-[10px] text-teal-700 mb-0.5">Keto Klinik</p>
                            <p className="text-[9px] text-teal-600 leading-relaxed">Karb ≤25 g/gün (VLCKD). Protein 1.2–1.5 g/kg ideal kilo (KeNuT). Yağ: K/AK≥1.5 (Woodyatt-Withrow) [4][5][6].</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2">
                            <p className="font-bold text-[10px] text-gray-700 mb-0.5">İdeal Kilo ile BMR Hesabı</p>
                            <p className="text-[9px] text-gray-500 leading-relaxed">Fazla kilolu/obez bireylerde BMR formülleri mevcut kiloyla aşırı tahmin yapabilir. İdeal kilo (BMI 22.5 × boy²) ile hesaplama, hedef kilodaki enerji ihtiyacını gösterir. Klinik beslenme pratiğinde düzeltilmiş kilo kullanımı önerilmektedir [9][10].</p>
                        </div>
                    </div>

                    <div className="p-3">
                        <h3 className="text-[11px] font-bold text-gray-800 mb-2">Kaynakça (APA 6)</h3>
                        <div className="space-y-2">
                            {[
                                { authors: 'Mifflin, M. D., St Jeor, S. T., Hill, L. A., Scott, B. J., Daugherty, S. A., & Koh, Y. O.', year: '1990', title: 'A new predictive equation for resting energy expenditure in healthy individuals', journal: 'The American Journal of Clinical Nutrition', vol: '51', issue: '2', pages: '241–247', doi: '10.1093/ajcn/51.2.241', pmid: '2305711', tag: 'BMR' },
                                { authors: 'Roza, A. M., & Shizgal, H. M.', year: '1984', title: 'The Harris Benedict equation reevaluated: Resting energy requirements and the body cell mass', journal: 'The American Journal of Clinical Nutrition', vol: '40', issue: '1', pages: '168–182', doi: '10.1093/ajcn/40.1.168', pmid: '6741850', tag: 'BMR' },
                                { authors: 'Frankenfield, D., Roth-Yousey, L., & Compher, C.', year: '2005', title: 'Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: A systematic review', journal: 'Journal of the American Dietetic Association', vol: '105', issue: '5', pages: '775–789', doi: '10.1016/j.jada.2005.01.007', pmid: '15883556', tag: 'BMR' },
                                { authors: 'Muscogiuri, G., El Ghoch, M., Colao, A., Hassapidou, M., Yumuk, V., & Busetto, L.', year: '2021', title: 'European guidelines for obesity management in adults with a very low-calorie ketogenic diet: A systematic review and meta-analysis', journal: 'Obesity Facts', vol: '14', issue: '2', pages: '222–245', doi: '10.1159/000515381', pmid: '33882506', tag: 'VLCKD' },
                                { authors: 'Cannataro, R., Perri, M., Gallelli, L., Caroleo, M. C., De Sarro, G., & Cione, E.', year: '2021', title: 'Ketogenic diet acts on body remodeling and MMP-2, MMP-9, and TIMP-2 plasma levels in women affected by lipedema', journal: 'Life', vol: '11', issue: '12', pages: '1402', doi: '10.3390/life11121402', pmid: '34947944', tag: 'Lipödem' },
                                { authors: 'Zilberter, T., & Zilberter, Y.', year: '2018', title: 'Ketogenic ratio determines metabolic effects of macronutrients and prevents interpretive bias', journal: 'Frontiers in Nutrition', vol: '5', issue: '', pages: '75', doi: '10.3389/fnut.2018.00075', pmid: '30186837', tag: 'K/AK Oranı' },
                                { authors: 'Oh, R., Gilani, B., & Uppaluri, K. R.', year: '2021', title: 'Low-carbohydrate diet', journal: 'StatPearls [Internet]', vol: '', issue: '', pages: '', doi: '', pmid: '30725769', tag: 'LCD' },
                                { authors: 'Keith, L., Seo, C. A., Rowsemitt, C., Pfeffer, M., Wahi, M., Staggs, M., … & Dudek, J.', year: '2021', title: 'Ketogenic diet as a potential intervention for lipedema', journal: 'Medical Hypotheses', vol: '146', issue: '', pages: '110435', doi: '10.1016/j.mehy.2020.110435', pmid: '33317790', tag: 'Lipödem' },
                                { authors: 'Krenitsky, J.', year: '2005', title: 'Adjusted body weight, pro: Evidence to support the use of adjusted body weight in calculating calorie requirements', journal: 'Nutrition in Clinical Practice', vol: '20', issue: '4', pages: '468–473', doi: '10.1177/0115426505020004468', pmid: '16207686', tag: 'Referans Kilo' },
                                { authors: 'Institute of Medicine', year: '2005', title: 'Dietary Reference Intakes for energy, carbohydrate, fiber, fat, fatty acids, cholesterol, protein, and amino acids', journal: 'Washington, DC: National Academies Press', vol: '', issue: '', pages: '', doi: '10.17226/10490', pmid: '', tag: 'DRI' },
                            ].map((ref, i) => (
                                <div key={i} className="border-b border-gray-50 pb-1.5 last:border-0 last:pb-0">
                                    <p className="text-[9px] text-gray-600 leading-relaxed">
                                        <span className="text-gray-400 font-mono mr-0.5">[{i + 1}]</span>
                                        {ref.authors} ({ref.year}). {ref.title}. <em>{ref.journal}{ref.vol ? `, ${ref.vol}` : ''}</em>{ref.issue ? `(${ref.issue})` : ''}{ref.pages ? `, ${ref.pages}` : ''}.
                                        {ref.doi && <> <a href={`https://doi.org/${ref.doi}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:text-emerald-800 underline">DOI</a></>}
                                        {ref.pmid && <> <a href={`https://pubmed.ncbi.nlm.nih.gov/${ref.pmid}/`} target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-800 underline">PubMed</a></>}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            <p className="text-[9px] text-gray-400 text-center px-4">
                Bu hesaplamalar bilgilendirme amaçlıdır.
            </p>
        </div>
    )
}
