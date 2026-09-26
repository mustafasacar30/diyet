
"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Loader2, Save, Trash2, AlertTriangle, ArrowRight, ArrowLeft, Info, Lightbulb, ShieldCheck, Search, X, ChevronLeft, ChevronRight, SkipForward, Check, LogOut } from "lucide-react"
import { supabase } from "@/lib/supabase"

export interface RuleReviewWizardProps {
  isOpen: boolean
  onClose: () => void
  rules: any[]
  onRuleUpdated: (ruleId: string, newDefinition: any) => Promise<void>
  onRuleDeleted: (ruleId: string) => Promise<void>
  onRuleCloned?: (rule: any, newDefinition: any) => Promise<void>
}

// ─── Constants ───

const MEAL_OPTIONS = ["KAHVALTI", "ÖĞLEN", "AKŞAM", "ARA ÖĞÜN"]
const MEAL_LABELS: Record<string, string> = {
  "KAHVALTI": "Kahvaltı", "ÖĞLEN": "Öğlen", "AKŞAM": "Akşam",
  "ARA ÖĞÜN": "Ara Öğün", "1. ARA ÖĞÜN": "1. Ara Öğün", "2. ARA ÖĞÜN": "2. Ara Öğün"
}
const DAY_LABELS: Record<number, string> = { 1: "Pzt", 2: "Sal", 3: "Çar", 4: "Per", 5: "Cum", 6: "Cmt", 7: "Paz" }

const ROLE_TR: Record<string, string> = {
  mainDish: "Ana yemek", sideDish: "Yan yemek", soup: "Çorba",
  salad: "Salata", dessert: "Tatlı", drink: "İçecek",
  breakfast: "Kahvaltılık", snack: "Atıştırmalık", appetizer: "Meze"
}

function humanizeTarget(def: any): string {
  const t = def.target || def.trigger
  if (!t) return def.name || "(hedef belirtilmemiş)"
  const v = t.value || ""

  if (t.type === "role") return ROLE_TR[v] || v
  if (t.type === "category") {
    const cleaned = v.replace(/LER$|LAR$/i, "").toLowerCase()
    const raw = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
    return `${raw.replace(/ler$/i, "").replace(/lar$/i, "")} türleri`
  }
  if (t.type === "tag") return `${v} türleri`
  if (t.type === "name_contains") return `isminde "${v}" geçen yemekler`
  if (t.type === "name_or_tag") return `${v} grubu`
  if (t.type === "food_id") return v
  return v
}

function humanizeOutcome(def: any): string {
  const o = def.outcome
  if (!o) return "(hedef yok)"
  const v = o.value || ""
  if (o.type === "role") return ROLE_TR[v] || v
  if (o.type === "category") {
    return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
  }
  if (o.type === "tag") return `${v} türleri`
  return v
}

function scopeWeeksLabel(sw: any): string | null {
  if (!sw) return null
  if (sw.starting_week) return `${sw.starting_week}. haftadan itibaren`
  if (sw.mode === "specific" && sw.weeks?.length) return `Hafta ${sw.weeks.join(", ")}`
  if (sw.mode === "repeating" && sw.every) return `Her ${sw.every} haftada bir`
  return null
}

// ─── Shared UI Atoms ───

function InlineSelect({ value, onChange, options, className }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`inline-flex h-7 min-w-[60px] w-auto px-2 bg-white border-emerald-300 text-emerald-800 font-bold text-sm rounded-md shadow-sm ${className || ""}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MealPills({ selected, onChange, locked }: { selected: string[]; onChange: (m: string[]) => void; locked: string[] }) {
  const toggle = (meal: string) => {
    if (locked.includes(meal)) return
    onChange(selected.includes(meal) ? selected.filter(m => m !== meal) : [...selected, meal])
  }
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {MEAL_OPTIONS.map(meal => {
        const isLocked = locked.includes(meal)
        const isSelected = selected.includes(meal) || isLocked
        return (
          <button key={meal} type="button" onClick={() => toggle(meal)} disabled={isLocked}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              isLocked ? "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed"
              : isSelected ? "bg-emerald-100 border-emerald-400 text-emerald-800"
              : "bg-white border-gray-200 text-gray-500 hover:border-emerald-300"
            }`}>
            {MEAL_LABELS[meal] || meal}
            {isLocked && <span className="ml-1 text-[9px]">(sabit)</span>}
          </button>
        )
      })}
    </div>
  )
}

function DayPills({ selected, onChange }: { selected: number[]; onChange: (d: number[]) => void }) {
  const toggle = (day: number) => {
    onChange(selected.includes(day) ? selected.filter(d => d !== day) : [...selected, day])
  }
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {[1, 2, 3, 4, 5, 6, 7].map(d => (
        <button key={d} type="button" onClick={() => toggle(d)}
          className={`w-9 h-7 rounded text-xs font-medium border transition-colors ${
            selected.includes(d) ? "bg-emerald-100 border-emerald-400 text-emerald-800"
            : "bg-white border-gray-200 text-gray-500 hover:border-emerald-300"
          }`}>
          {DAY_LABELS[d]}
        </button>
      ))}
    </div>
  )
}

function SmartWarning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 mt-3">
      <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
      <span>{text}</span>
    </div>
  )
}

function parseScopeWeeksInput(input: string): any {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.endsWith("...")) {
    const num = parseInt(trimmed.replace("...", ""))
    if (!isNaN(num)) return { starting_week: num }
  }
  const parts = trimmed.split(",").map(s => s.trim()).filter(Boolean)
  const weeks: number[] = []
  for (const p of parts) {
    if (p.includes("-")) {
      const [a, b] = p.split("-").map(Number)
      if (!isNaN(a) && !isNaN(b)) for (let i = a; i <= b; i++) weeks.push(i)
    } else {
      const n = parseInt(p)
      if (!isNaN(n)) weeks.push(n)
    }
  }
  if (weeks.length > 0) return { mode: "specific", weeks }
  return null
}

function scopeWeeksToInput(sw: any): string {
  if (!sw) return ""
  if (sw.starting_week) return `${sw.starting_week}...`
  if (sw.mode === "specific" && sw.weeks?.length) {
    const sorted = [...sw.weeks].sort((a: number, b: number) => a - b)
    const parts: string[] = []
    let i = 0
    while (i < sorted.length) {
      let j = i
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
      parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`)
      i = j + 1
    }
    return parts.join(",")
  }
  return ""
}

function ScopeWeeksEditor({ sw, onChange }: { sw: any; onChange: (newSw: any) => void }) {
  const [input, setInput] = useState(scopeWeeksToInput(sw))
  const label = scopeWeeksLabel(sw)

  const handleBlur = () => {
    const parsed = parseScopeWeeksInput(input)
    onChange(parsed)
  }

  return (
    <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
      <div className="flex items-center gap-1.5 mb-1">
        <Info className="h-3 w-3 shrink-0 text-blue-500" />
        <span className="text-[11px] font-medium text-blue-700">Hafta kapsamı</span>
        {label && <span className="text-[10px] text-blue-600 ml-auto">{label}</span>}
      </div>
      <Input
        value={input}
        onChange={e => setInput(e.target.value)}
        onBlur={handleBlur}
        placeholder="ör: 1,2,5-9 veya 3..."
        className="h-7 text-xs bg-white border-blue-200"
      />
      <p className="text-[9px] text-blue-500 mt-1 leading-snug">
        <strong>1,2,5-9</strong> · Belirli haftadan: <strong>5...</strong> · Boş = tüm haftalarda
      </p>
    </div>
  )
}

// ─── Inline Food Search ───

function FoodSearchInline({ foodsDb, selectedIds, onChange, maxItems, fallbackNames }: {
  foodsDb: { id: string; name: string }[]; selectedIds: string[];
  onChange: (ids: string[]) => void; maxItems?: number;
  fallbackNames?: Record<string, string>
}) {
  const [query, setQuery] = useState("")
  const [showResults, setShowResults] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dbLoaded = foodsDb.length > 0

  const results = useMemo(() => {
    if (!query.trim() || query.length < 2) return []
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2)
    if (words.length === 0) return []
    return foodsDb.filter(f => {
      const name = f.name.toLowerCase()
      return words.every(w => name.includes(w))
    }).slice(0, 12)
  }, [query, foodsDb])

  const selectedFoods = useMemo(() =>
    selectedIds.map(id => {
      const found = foodsDb.find(f => f.id === id)
      if (found) return found
      const fb = fallbackNames?.[id]
      if (fb) return { id, name: fb }
      if (!dbLoaded) return { id, name: "(yükleniyor...)" }
      return { id, name: `(bulunamadı)` }
    })
  , [selectedIds, foodsDb, fallbackNames, dbLoaded])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShowResults(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const addFood = (food: { id: string; name: string }) => {
    if (!selectedIds.includes(food.id)) {
      if (maxItems && selectedIds.length >= maxItems) return
      onChange([...selectedIds, food.id])
    }
    setQuery("")
    setShowResults(false)
  }

  const removeFood = (id: string) => {
    onChange(selectedIds.filter(x => x !== id))
  }

  return (
    <div className="space-y-2">
      {selectedFoods.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {!dbLoaded && selectedIds.length > 0 && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
          {selectedFoods.map(f => (
            <Badge key={f.id} variant="outline" className="text-xs bg-white pr-1 gap-1">
              {f.name}
              <button type="button" onClick={() => removeFood(f.id)} className="ml-0.5 hover:text-red-500">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative" ref={ref}>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
          <Input
            value={query}
            onChange={e => { setQuery(e.target.value); setShowResults(true) }}
            onFocus={() => setShowResults(true)}
            placeholder="Yemek ara..."
            className="h-8 pl-7 text-sm"
          />
        </div>
        {showResults && results.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {results.map(f => (
              <button key={f.id} type="button" onClick={() => addFood(f)}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-emerald-50 ${selectedIds.includes(f.id) ? "text-gray-400" : "text-gray-700"}`}>
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Category/Tag Dropdown with text fallback ───

function TargetEditor({ target, categories, onChange, label }: {
  target: { type: string; value: string }; categories: string[];
  onChange: (t: { type: string; value: string }) => void; label: string
}) {
  const isCategory = target.type === "category"
  const isTag = target.type === "tag" || target.type === "name_contains" || target.type === "name_or_tag"

  if (isCategory) {
    return (
      <div className="space-y-1">
        <span className="text-xs text-gray-500">{label}</span>
        <Select value={target.value} onValueChange={v => onChange({ ...target, value: v })}>
          <SelectTrigger className="h-8 text-sm bg-white border-emerald-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-500">{label} ({target.type === "tag" ? "etiket" : target.type === "role" ? "rol" : "metin"})</span>
      <Input
        value={target.value}
        onChange={e => onChange({ ...target, value: e.target.value })}
        className="h-8 text-sm"
        placeholder="Değer girin..."
      />
      <p className="text-[10px] text-gray-400">Virgül ile ayırarak birden fazla değer yazabilirsiniz.</p>
    </div>
  )
}

// ─── Type-Specific Sentence Editors ───

function FrequencyEditor({ rule, lockedMeals, draft, onChange, warnings, setWarnings }: {
  rule: any; lockedMeals: string[]; draft: any; onChange: (d: any) => void;
  warnings: string[]; setWarnings: (w: string[]) => void
}) {
  const def = rule.definition?.data || rule.definition || {}
  const period = def.period || "weekly"
  const targetLabel = humanizeTarget(def)

  const ruleMinCount = def.min_count ?? def.frequency ?? 1
  const ruleMaxCount = def.max_count ?? ruleMinCount

  const [minDays, setMinDays] = useState<string>(draft?.minDays || (def.random_day_count || (period === "weekly" ? ruleMinCount : 7)).toString())
  const [maxDays, setMaxDays] = useState<string>(draft?.maxDays || (period === "weekly" ? (ruleMaxCount === ruleMinCount ? "same" : ruleMaxCount.toString()) : "same"))
  const [minOcc, setMinOcc] = useState<string>(draft?.minOcc || (period !== "weekly" ? ruleMinCount.toString() : "1"))
  const [maxOcc, setMaxOcc] = useState<string>(draft?.maxOcc || (period !== "weekly" ? (ruleMaxCount === ruleMinCount ? "same" : ruleMaxCount.toString()) : "same"))
  const [dailyMax, setDailyMax] = useState<string>(draft?.dailyMax || (def.daily_max_limit?.toString() || "0"))
  const [forceInclusion, setForceInclusion] = useState<boolean>(draft?.forceInclusion ?? def.force_inclusion ?? false)
  const [selectedMeals, setSelectedMeals] = useState<string[]>(draft?.selectedMeals || def.scope_meals || [])
  const [selectedDays, setSelectedDays] = useState<number[]>(draft?.selectedDays || def.scope_days || [])
  const [exclusiveScope, setExclusiveScope] = useState<boolean>(draft?.exclusiveScope ?? def.exclusive_scope ?? false)
  const [scopeWeeks, setScopeWeeks] = useState<any>(draft?.scopeWeeks ?? def.scope_weeks ?? null)

  useEffect(() => {
    if (maxDays !== "same" && parseInt(minDays) > parseInt(maxDays)) setMaxDays("same")
  }, [minDays])

  useEffect(() => {
    if (maxOcc !== "same" && parseInt(minOcc) > parseInt(maxOcc)) setMaxOcc("same")
  }, [minOcc])

  useEffect(() => {
    const w: string[] = []
    const dMax = maxDays === "same" ? parseInt(minDays) : parseInt(maxDays)
    if (dMax >= 6 && forceInclusion) {
      w.push("Haftanın neredeyse her günü zorunlu eklemek, kalori ve makro dengenizi bozabilir. Haftada 4-5 gün daha dengeli bir seçim olabilir.")
    }
    if (dMax >= 5 && selectedMeals.length >= 3 && dailyMax === "0") {
      w.push("Birden fazla öğünde sınırsız tekrar, yüksek kalorili besinlerde makro fazlalığına yol açabilir. Günlük sınır koymanızı öneririm.")
    }
    if (forceInclusion && dMax <= 2) {
      w.push("Az günde zorla ekleme genelde gereksizdir — normal tercih modunda da motor bu sıklığı sağlar.")
    }
    setWarnings(w)
    onChange({
      type: "frequency", minDays, maxDays, minOcc, maxOcc, dailyMax,
      selectedMeals, selectedDays, forceInclusion, exclusiveScope, scopeWeeks
    })
  }, [minDays, maxDays, minOcc, maxOcc, dailyMax, selectedMeals, selectedDays, forceInclusion, exclusiveScope, scopeWeeks])

  const daysOpts = [1, 2, 3, 4, 5, 6, 7].map(n => ({ value: n.toString(), label: n.toString() }))
  const maxDaysOpts = [{ value: "same", label: "Sabit" }, ...daysOpts.map(o => ({ ...o, disabled: parseInt(o.value) <= parseInt(minDays) }))]
  const occOpts = [1, 2, 3, 4, 5].map(n => ({ value: n.toString(), label: n.toString() }))
  const maxOccOpts = [{ value: "same", label: "Sabit" }, ...occOpts.map(o => ({ ...o, disabled: parseInt(o.value) <= parseInt(minOcc) }))]

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-700 leading-relaxed">
        Haftada{" "}
        <InlineSelect value={minDays} onChange={setMinDays} options={daysOpts} />
        {maxDays !== "same" && maxDays !== minDays ? (
          <> – <InlineSelect value={maxDays} onChange={setMaxDays} options={maxDaysOpts} /> arası</>
        ) : (
          <>{" "}<InlineSelect value="same" onChange={setMaxDays} options={maxDaysOpts.map(o => o.value === "same" ? { ...o, label: `(sabit)` } : o)} /></>
        )}
        {" "}gün <strong className="text-emerald-800">{targetLabel}</strong> menünüze eklenir.
      </p>

      {(period === "daily" || period === "per_meal") && (
        <p className="text-[13px] text-gray-700 leading-relaxed">
          {period === "daily" ? "Günde toplam " : "Her öğünde "}
          <InlineSelect value={minOcc} onChange={setMinOcc} options={occOpts} />
          {maxOcc !== "same" && maxOcc !== minOcc ? (
            <> – <InlineSelect value={maxOcc} onChange={setMaxOcc} options={maxOccOpts} /> arası</>
          ) : (
            <>{" "}<InlineSelect value="same" onChange={setMaxOcc} options={maxOccOpts.map(o => o.value === "same" ? { ...o, label: `(sabit)` } : o)} /></>
          )}
          {" "}kez.
        </p>
      )}

      <div>
        <p className="text-xs text-gray-600 mb-1">Hangi öğünlerde?</p>
        <MealPills selected={selectedMeals} onChange={setSelectedMeals} locked={lockedMeals} />
        {selectedMeals.length === 0 && <p className="text-[10px] text-gray-400 mt-0.5">Boş bırakılırsa tüm öğünlerde geçerli.</p>}
      </div>

      {(selectedDays.length > 0 || def.scope_days?.length > 0) && (
        <div>
          <p className="text-xs text-gray-600 mb-1">Hangi günlerde?</p>
          <DayPills selected={selectedDays} onChange={setSelectedDays} />
          {exclusiveScope && selectedDays.length > 0 && (
            <p className="text-[10px] text-amber-600 mt-0.5">Seçili günler dışında bu yemek hiç verilmez.</p>
          )}
        </div>
      )}

      <p className="text-[13px] text-gray-700 leading-relaxed">
        Aynı gün içinde en fazla{" "}
        <InlineSelect value={dailyMax} onChange={setDailyMax} options={[
          { value: "0", label: "Sınır yok" },
          { value: "1", label: "1 kez" },
          { value: "2", label: "2 kez" },
        ]} />
        {" "}tekrarlanabilir.
      </p>

      <div className="p-2.5 rounded-lg border border-gray-200 bg-gray-50">
        <p className="text-xs text-gray-600 mb-1.5">Kalori limiti aşılırsa ne olsun?</p>
        <Select value={forceInclusion ? "force" : "respect"} onValueChange={(v) => setForceInclusion(v === "force")}>
          <SelectTrigger className="h-8 text-xs bg-white border-gray-300">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="respect">Atlanabilir — limitlere uyulsun</SelectItem>
            <SelectItem value="force">Mutlaka eklensin — limit aşılsa bile</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ScopeWeeksEditor sw={scopeWeeks} onChange={setScopeWeeks} />
      {warnings.map((w, i) => <SmartWarning key={i} text={w} />)}
    </div>
  )
}

function AffinityEditor({ rule, draft, onChange, warnings, setWarnings, categories }: {
  rule: any; draft: any; onChange: (d: any) => void;
  warnings: string[]; setWarnings: (w: string[]) => void; categories: string[]
}) {
  const def = rule.definition?.data || rule.definition || {}
  const trigger = def.trigger || { type: "tag", value: "" }
  const outcome = def.outcome || { type: "tag", value: "" }

  const inferAssociation = (prob: number) => {
    if (prob === 0) return "forbidden"
    if (prob <= 15) return "reduce"
    if (prob >= 100) return "mandatory"
    return "boost"
  }
  const rawProb = def.probability ?? 50
  const [association, setAssociation] = useState<string>(draft?.association || def.association || inferAssociation(rawProb))
  const [probability, setProbability] = useState<number>(draft?.probability ?? rawProb)
  const [direction, setDirection] = useState<string>(draft?.direction || def.direction || "one-way")
  const [triggerVal, setTriggerVal] = useState(draft?.triggerVal || trigger)
  const [outcomeVal, setOutcomeVal] = useState(draft?.outcomeVal || outcome)

  useEffect(() => {
    if (association === "mandatory") setProbability(100)
    else if (association === "forbidden") setProbability(0)
  }, [association])

  useEffect(() => {
    setWarnings([])
    onChange({ type: "affinity", association, probability, direction, triggerVal, outcomeVal })
  }, [association, probability, direction, triggerVal, outcomeVal])

  const triggerLabel = triggerVal.type === "category"
    ? (triggerVal.value?.charAt(0)?.toUpperCase() + triggerVal.value?.slice(1)?.toLowerCase())
    : triggerVal.type === "role" ? (ROLE_TR[triggerVal.value] || triggerVal.value)
    : `${triggerVal.value} türleri`
  const outcomeLabel = outcomeVal.type === "category"
    ? (outcomeVal.value?.charAt(0)?.toUpperCase() + outcomeVal.value?.slice(1)?.toLowerCase())
    : outcomeVal.type === "role" ? (ROLE_TR[outcomeVal.value] || outcomeVal.value)
    : `${outcomeVal.value} türleri`

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-700 leading-relaxed">
        Menünüzde <strong className="text-emerald-800">{triggerLabel}</strong> yer aldığında,
        yanında <strong className="text-emerald-800">{outcomeLabel}</strong>{" "}
        <InlineSelect value={association} onChange={setAssociation} options={[
          { value: "mandatory", label: "mutlaka bulunsun" },
          { value: "boost", label: "tercihen bulunsun" },
          { value: "forbidden", label: "kesinlikle bulunmasın" },
          { value: "reduce", label: "mümkünse bulunmasın" },
        ]} />
      </p>
      <p className="text-[10px] text-gray-400 leading-snug">
        {association === "mandatory" && "Her zaman birlikte yer alır — istisnasız."}
        {association === "boost" && "Sistem bu eşleşmeyi tercih eder ama zorunlu tutmaz."}
        {association === "forbidden" && "Aynı öğünde asla birlikte yer almaz."}
        {association === "reduce" && "Sistem bu eşleşmeden kaçınmaya çalışır."}
      </p>

      {(association === "boost" || association === "reduce") && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-gray-500 shrink-0">Etki:</span>
          <input type="range" min={association === "boost" ? 51 : 1} max={association === "boost" ? 99 : 49}
            value={probability} onChange={(e) => setProbability(Number(e.target.value))}
            className="flex-1 h-1.5 accent-emerald-600" />
          <span className={`text-[12px] font-bold min-w-[32px] text-right ${
            association === "boost"
              ? probability >= 85 ? "text-emerald-700" : "text-blue-600"
              : probability <= 15 ? "text-red-600" : "text-orange-500"
          }`}>%{probability}</span>
        </div>
      )}

      <p className="text-[13px] text-gray-700 leading-relaxed">
        Bu kural{" "}
        <InlineSelect value={direction} onChange={setDirection} options={[
          { value: "one-way", label: "tek yönlü" },
          { value: "two-way", label: "çift yönlü" },
        ]} />
        {" "}geçerlidir.
        <span className="block text-[10px] text-gray-400 mt-0.5">
          {direction === "two-way"
            ? `${outcomeLabel} varsa ${triggerLabel} için de aynı kural işler.`
            : `Sadece ${triggerLabel} varken ${outcomeLabel} etkilenir.`}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
        <TargetEditor target={triggerVal} categories={categories} onChange={setTriggerVal} label="Tetikleyici" />
        <TargetEditor target={outcomeVal} categories={categories} onChange={setOutcomeVal} label="Hedef" />
      </div>
    </div>
  )
}

function ConsistencyEditor({ rule, draft, onChange, warnings, setWarnings }: {
  rule: any; draft: any; onChange: (d: any) => void;
  warnings: string[]; setWarnings: (w: string[]) => void
}) {
  const def = rule.definition?.data || rule.definition || {}
  const targetLabel = humanizeTarget(def)

  const [lockDuration, setLockDuration] = useState<string>(draft?.lockDuration || def.lock_duration || "weekly")
  const [selectedMeals, setSelectedMeals] = useState<string[]>(draft?.selectedMeals || def.scope_meals || [])

  useEffect(() => {
    setWarnings([])
    onChange({ type: "consistency", lockDuration, selectedMeals })
  }, [lockDuration, selectedMeals])

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-700 leading-relaxed">
        Listede yer alan <strong className="text-emerald-800">{targetLabel}</strong>{" "}
        <InlineSelect value={lockDuration} onChange={setLockDuration} options={[
          { value: "weekly", label: "tüm hafta" },
          { value: "daily", label: "o gün" },
        ]} />
        {" "}boyunca aynı tür olarak belirlenir.
      </p>

      <p className="text-[11px] text-gray-500 leading-relaxed">
        {lockDuration === "weekly"
          ? "Pazartesi seçilen yemek Pazar'a kadar her gün tekrar eder."
          : "Aynı gün içinde tüm öğünlerde aynı seçim korunur."}
      </p>

      {(selectedMeals.length > 0 || def.scope_meals?.length > 0) && (
        <div>
          <p className="text-xs text-gray-600 mb-1">Hangi öğünlerde?</p>
          <MealPills selected={selectedMeals} onChange={setSelectedMeals} locked={[]} />
        </div>
      )}
    </div>
  )
}

function FixedMealEditor({ rule, draft, onChange, warnings, setWarnings, foodsDb }: {
  rule: any; draft: any; onChange: (d: any) => void;
  warnings: string[]; setWarnings: (w: string[]) => void; foodsDb: { id: string; name: string }[]
}) {
  const def = rule.definition?.data || rule.definition || {}
  const targetSlot = def.target_slot || ""
  const [foodIds, setFoodIds] = useState<string[]>(draft?.foodIds || def.foods || [])
  const [scopeDays, setScopeDays] = useState<number[]>(draft?.scopeDays || def.scope_days || [])
  const [mode, setMode] = useState<string>(draft?.mode || def.selection_mode || "all")
  const [scopeWeeks, setScopeWeeks] = useState<any>(draft?.scopeWeeks ?? def.scope_weeks ?? null)
  const [extraFoods, setExtraFoods] = useState<Record<string, string>>({})

  // Fetch names for food IDs not found in bulk-loaded foodsDb
  // Some rules store food names instead of UUIDs — detect and handle both
  useEffect(() => {
    if (foodsDb.length === 0 || foodIds.length === 0) return
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    const missingUuids = foodIds.filter(id => isUuid(id) && !foodsDb.find(f => f.id === id))
    if (missingUuids.length === 0) return
    supabase.from("foods").select("id, name").in("id", missingUuids).then(({ data }) => {
      if (data && data.length > 0) {
        const map: Record<string, string> = {}
        data.forEach(f => { map[f.id] = f.name })
        setExtraFoods(map)
      }
    })
  }, [foodIds, foodsDb])

  // Build fallback names: rule's food_names field, or treat non-UUID entries as literal food names
  const fallbackNames = useMemo(() => {
    const map: Record<string, string> = { ...extraFoods }
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    foodIds.forEach(id => {
      if (!isUuid(id) && !map[id]) {
        map[id] = id
      }
    })
    if (def.food_names && Array.isArray(def.food_names)) {
      const ids = def.foods || []
      def.food_names.forEach((name: string, i: number) => {
        if (ids[i] && !map[ids[i]]) map[ids[i]] = name
      })
    }
    return map
  }, [def.food_names, def.foods, extraFoods, foodIds])

  useEffect(() => {
    setWarnings([])
    onChange({ type: "fixed_meal", scopeDays, mode, foodIds, scopeWeeks })
  }, [scopeDays, mode, foodIds, scopeWeeks])

  const slotLabel = MEAL_LABELS[targetSlot] || targetSlot

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-700 leading-relaxed">
        <strong className="text-emerald-800">{slotLabel}</strong> öğününe aşağıdaki yemekler{" "}
        <InlineSelect value={mode} onChange={setMode} options={[
          { value: "all", label: "hepsi birlikte" },
          { value: "random", label: "her gün rastgele biri" },
          { value: "rotate", label: "sırayla dönüşümlü" },
          { value: "by_day", label: "güne göre atanmış" },
        ]} />
        {" "}olarak eklenir.
      </p>

      <div className="text-[10px] text-gray-400 bg-gray-50 rounded px-2 py-1 border border-gray-100">
        {mode === "all" && "Her gün listedeki tüm yemekler birlikte eklenir."}
        {mode === "random" && "Her gün listeden rastgele biri seçilir."}
        {mode === "rotate" && "Sırayla birer tane: Pzt birincisi, Sal ikincisi…"}
        {mode === "by_day" && "Her gün için hangi yemeğin geleceği belirlenmiştir."}
      </div>

      <div>
        <p className="text-xs text-gray-600 mb-1">Yemekler:</p>
        <FoodSearchInline foodsDb={foodsDb} selectedIds={foodIds} onChange={setFoodIds} fallbackNames={fallbackNames} />
      </div>

      <div>
        <p className="text-xs text-gray-600 mb-1">Hangi günlerde?</p>
        <DayPills selected={scopeDays} onChange={setScopeDays} />
        {scopeDays.length === 0 && <p className="text-[10px] text-gray-400 mt-0.5">Boş bırakılırsa her gün uygulanır.</p>}
      </div>

      <ScopeWeeksEditor sw={scopeWeeks} onChange={setScopeWeeks} />
    </div>
  )
}

function RotationEditor({ rule, draft, onChange, warnings, setWarnings, foodsDb }: {
  rule: any; draft: any; onChange: (d: any) => void;
  warnings: string[]; setWarnings: (w: string[]) => void; foodsDb: { id: string; name: string }[]
}) {
  const def = rule.definition?.data || rule.definition || {}
  const targetLabel = humanizeTarget(def)
  const items = def.items || []

  const [mode, setMode] = useState<string>(draft?.mode || def.mode || "sequential")
  const [nonConsecutive, setNonConsecutive] = useState<boolean>(draft?.nonConsecutive ?? def.non_consecutive ?? true)
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set(draft?.excludedIndices || []))

  const resolvedItems = useMemo(() =>
    items.map((it: any) => {
      const found = foodsDb.find(f => f.id === it.food_id)
      return { ...it, resolvedName: found?.name || it.food_name || "?" }
    })
  , [items, foodsDb])

  const toggleExclude = (idx: number) => {
    setExcludedIndices(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  useEffect(() => {
    setWarnings([])
    onChange({ type: "rotation", mode, nonConsecutive, excludedIndices: [...excludedIndices] })
  }, [mode, nonConsecutive, excludedIndices])

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-700 leading-relaxed">
        <strong className="text-emerald-800">{targetLabel}</strong> haftalararası{" "}
        <InlineSelect value={mode} onChange={setMode} options={[
          { value: "sequential", label: "sırayla" },
          { value: "random_no_repeat", label: "rastgele (tekrarsız)" },
        ]} />
        {" "}dönüşüm yaparak menünüzde yer alır.
      </p>

      {resolvedItems.length > 0 && (
        <div>
          <p className="text-xs text-gray-600 mb-1">Rotasyondaki yemekler <span className="text-[10px] text-gray-400">(istemediğinizi kaldırın)</span></p>
          <div className="flex flex-wrap gap-1">
            {resolvedItems.map((it: any, i: number) => {
              const excluded = excludedIndices.has(i)
              return (
                <button key={i} type="button" onClick={() => toggleExclude(i)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                    excluded
                      ? "bg-red-50 border-red-200 text-red-400 line-through"
                      : "bg-white border-gray-200 text-gray-700 hover:border-emerald-300"
                  }`}>
                  {excluded ? <X className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5 text-emerald-500" />}
                  {it.resolvedName}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 p-2 rounded-lg border bg-gray-50 border-gray-200">
        <Checkbox id={`nc_${rule.id}`} checked={nonConsecutive}
          onCheckedChange={(c) => setNonConsecutive(c === true)}
          className="data-[state=checked]:bg-emerald-600" />
        <Label htmlFor={`nc_${rule.id}`} className="text-xs cursor-pointer">
          Ardışık haftalarda aynı yemek tekrarlanmasın
        </Label>
      </div>
    </div>
  )
}

function NutritionalEditor({ rule, draft, onChange, warnings, setWarnings, foodsDb }: {
  rule: any; draft: any; onChange: (d: any) => void;
  warnings: string[]; setWarnings: (w: string[]) => void; foodsDb: { id: string; name: string }[]
}) {
  const def = rule.definition?.data || rule.definition || {}
  const condition = def.condition || {}
  const action = def.action || {}
  const macroLabel: Record<string, string> = { protein: "Protein", fat: "Yağ", carbs: "Karbonhidrat", calories: "Kalori" }
  const opLabel: Record<string, string> = { "<": "altına düştüğünde", ">": "üstüne çıktığında" }

  const [urgency, setUrgency] = useState<string>(draft?.urgency || "normal")
  const fallbackFoods = action.foods && action.foods.length > 0
    ? action.foods
    : action.target?.value ? [action.target.value] : []
  const [foodIds, setFoodIds] = useState<string[]>(draft?.foodIds || fallbackFoods)
  const [extraFoods, setExtraFoods] = useState<Record<string, string>>({})

  useEffect(() => {
    if (foodsDb.length === 0 || foodIds.length === 0) return
    const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    const missingUuids = foodIds.filter(id => isUuid(id) && !foodsDb.find(f => f.id === id))
    if (missingUuids.length === 0) {
      const nameMap: Record<string, string> = {}
      foodIds.forEach(id => { if (!isUuid(id)) nameMap[id] = id })
      if (Object.keys(nameMap).length > 0) setExtraFoods(nameMap)
      return
    }
    supabase.from("foods").select("id, name").in("id", missingUuids).then(({ data }) => {
      const map: Record<string, string> = {}
      if (data) data.forEach(f => { map[f.id] = f.name })
      foodIds.forEach(id => { if (!isUuid(id)) map[id] = id })
      setExtraFoods(map)
    })
  }, [foodIds, foodsDb])

  useEffect(() => {
    setWarnings([])
    onChange({ type: "nutritional", urgency, foodIds })
  }, [urgency, foodIds])

  const targetSlot = MEAL_LABELS[action.target_slot || def.target_slot] || ""

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-700 leading-relaxed">
        Günlük <strong className="text-emerald-800">{macroLabel[condition.macro] || condition.macro || "besin değeri"}</strong> hedefiniz{" "}
        {condition.value ? `${condition.value}${condition.macro === "calories" ? " kcal" : "g"} ` : "belirlenen seviyenin "}
        {opLabel[condition.operator] || "sapma gösterdiğinde"}, sistem{" "}
        <InlineSelect value={urgency} onChange={setUrgency} options={[
          { value: "normal", label: "standart hassasiyetle" },
          { value: "high", label: "katı hedeflemeyle" },
        ]} />
        {" "}telafi yemeği ekler.
      </p>

      <p className="text-[11px] text-gray-500 leading-relaxed">
        {urgency === "high"
          ? <>Hedeften <strong className="text-orange-600">± %5</strong> bile sapma olursa müdahale edilir.</>
          : <>Hedeften <strong className="text-blue-600">± %20</strong> sapma olursa müdahale edilir — günlük salınımlara toleranslı.</>}
      </p>

      <div>
        <p className="text-xs text-gray-600 mb-1">Telafi yemekleri:</p>
        <FoodSearchInline foodsDb={foodsDb} selectedIds={foodIds} onChange={setFoodIds} fallbackNames={extraFoods} />
      </div>

      {targetSlot && (
        <p className="text-[11px] text-gray-500">Hedef öğün: <strong>{targetSlot}</strong></p>
      )}
    </div>
  )
}

function OrGroupEditor({ rule, draft, onChange, warnings, setWarnings }: {
  rule: any; draft: any; onChange: (d: any) => void;
  warnings: string[]; setWarnings: (w: string[]) => void
}) {
  const def = rule.definition?.data || rule.definition || {}
  const options = def.options || []
  const [activeOption, setActiveOption] = useState<number | null>(draft?.activeOption ?? null)

  useEffect(() => {
    setWarnings([])
    onChange({ type: "or_group", activeOption })
  }, [activeOption])

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-gray-700 leading-relaxed">
        Bu kuralda <strong className="text-emerald-800">{options.length} alternatif</strong> var.
        Her hafta bunlardan biri dönüşümlü uygulanır.
      </p>
      {options.length > 0 && (
        <div className="space-y-1">
          {options.map((opt: any, i: number) => {
            const target = humanizeTarget({ target: opt.target })
            const count = opt.min_count === opt.max_count
              ? `haftada ${opt.min_count ?? "?"} gün`
              : `haftada ${opt.min_count ?? "?"} – ${opt.max_count ?? "?"} gün`
            return (
              <div key={i} className="text-[12px] text-gray-600 bg-white rounded-lg border border-gray-100 px-2.5 py-1.5 flex items-center gap-2">
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5 shrink-0">{i + 1}</span>
                <span><strong className="text-gray-800">{target}</strong> — {count}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="text-[10px] text-gray-400 bg-gray-50 rounded p-2 border border-gray-100">
        Bu alternatifler diyetisyeniniz tarafından belirlenmiştir.
        Grubu silmek isterseniz aşağıdaki sil butonunu kullanabilirsiniz.
      </div>
    </div>
  )
}

// ─── Main Component ───

export function RuleReviewWizard({ isOpen, onClose, rules, onRuleUpdated, onRuleDeleted, onRuleCloned }: RuleReviewWizardProps) {
  const [activeRules, setActiveRules] = useState<any[]>([])
  const [isStarted, setIsStarted] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, any>>({})
  const [currentDraftData, setCurrentDraftData] = useState<any>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [forceBypassWarning, setForceBypassWarning] = useState(false)
  const [foodsDb, setFoodsDb] = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<string[]>([])

  const handleNextRef = useRef<((action: "update" | "skip" | "delete") => void) | null>(null)

  const lockedMeals = useMemo(() => rules
    .filter(r => r.is_active && (r.rule_type === "consistency" || r.description?.toLowerCase().includes("sabit")))
    .flatMap(r => {
      const meals = r.definition?.scope_meals || r.definition?.data?.scope_meals || []
      if (meals.length === 0 && (r.name?.toLowerCase().includes("sabah") || r.description?.toLowerCase().includes("sabah"))) {
        return ["KAHVALTI"]
      }
      return meals
    }), [rules])

  // Keyboard nav hook — must be before early returns
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if ((e.target as HTMLElement)?.closest("[role='listbox']")) return
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        setCurrentStep(prev => Math.max(0, prev - 1))
        setForceBypassWarning(false)
        setWarnings([])
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        handleNextRef.current?.("skip")
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  useEffect(() => {
    if (isOpen) {
      const fil = rules.filter(r => r.is_active && r.definition && r.rule_type !== "lock")
      setActiveRules(fil)
      setCurrentStep(0)
      setIsStarted(false)
      setDrafts({})
      setCurrentDraftData(null)
      setWarnings([])
      setForceBypassWarning(false)

      supabase.from("foods").select("id, name, category").limit(10000).then(({ data }) => {
        if (data) {
          setFoodsDb(data.map(f => ({ id: f.id, name: f.name })))
          const cats = [...new Set(data.map(f => f.category).filter(Boolean))] as string[]
          setCategories(cats.sort())
        }
      })
    }
  }, [isOpen])

  if (!isOpen) return null

  if (activeRules.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Gözden Geçirilecek Tercih Yok</DialogTitle>
            <DialogDescription>Şu anda düzenlenebilecek aktif bir tercihiniz bulunmuyor.</DialogDescription>
          </DialogHeader>
          <DialogFooter><Button onClick={onClose}>Kapat</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const isFinished = currentStep >= activeRules.length

  const handleApplyAllChanges = async () => {
    setIsSaving(true)
    try {
      for (const rule of activeRules) {
        const draft = drafts[rule.id]
        if (!draft || draft.action === "skip") continue

        if (draft.action === "delete") {
          await onRuleDeleted(rule.id)
        } else if (draft.action === "update" && draft.data) {
          const def = { ...(rule.definition?.data || rule.definition) }

          if (draft.data.type === "frequency") {
            const pd = def.period || "weekly"
            const dMin = parseInt(draft.data.minDays)
            const dMax = draft.data.maxDays === "same" ? dMin : parseInt(draft.data.maxDays)
            const oMin = parseInt(draft.data.minOcc)
            const oMax = draft.data.maxOcc === "same" ? oMin : parseInt(draft.data.maxOcc)

            if (pd === "weekly") {
              def.min_count = dMin; def.max_count = dMax; delete def.scope_days
            } else {
              def.min_count = oMin; def.max_count = oMax
              if (dMax < 7) def.random_day_count = dMax; else delete def.random_day_count
            }

            if (draft.data.selectedMeals.length > 0) def.scope_meals = draft.data.selectedMeals; else delete def.scope_meals
            if (draft.data.selectedDays?.length > 0) def.scope_days = draft.data.selectedDays; else delete def.scope_days
            if (draft.data.dailyMax !== "0") def.daily_max_limit = parseInt(draft.data.dailyMax); else delete def.daily_max_limit
            if (draft.data.forceInclusion) def.force_inclusion = true; else delete def.force_inclusion
            if (draft.data.exclusiveScope) def.exclusive_scope = true; else delete def.exclusive_scope
            if (draft.data.scopeWeeks) def.scope_weeks = draft.data.scopeWeeks; else delete def.scope_weeks
          }
          else if (draft.data.type === "affinity") {
            def.association = draft.data.association
            def.probability = draft.data.probability ?? def.probability ?? 50
            def.direction = draft.data.direction
            if (draft.data.triggerVal) def.trigger = draft.data.triggerVal
            if (draft.data.outcomeVal) def.outcome = draft.data.outcomeVal
          }
          else if (draft.data.type === "consistency") {
            def.lock_duration = draft.data.lockDuration
            if (draft.data.selectedMeals?.length > 0) def.scope_meals = draft.data.selectedMeals
          }
          else if (draft.data.type === "fixed_meal") {
            if (draft.data.scopeDays?.length > 0) def.scope_days = draft.data.scopeDays; else delete def.scope_days
            def.selection_mode = draft.data.mode
            if (draft.data.foodIds) def.foods = draft.data.foodIds
            if (draft.data.scopeWeeks) def.scope_weeks = draft.data.scopeWeeks; else delete def.scope_weeks
          }
          else if (draft.data.type === "rotation") {
            def.mode = draft.data.mode
            def.non_consecutive = draft.data.nonConsecutive
            if (draft.data.excludedIndices?.length > 0 && def.items) {
              def.items = def.items.filter((_: any, i: number) => !draft.data.excludedIndices.includes(i))
            }
          }
          else if (draft.data.type === "nutritional") {
            if (draft.data.foodIds && draft.data.foodIds.length > 0) {
              if (!def.action) def.action = {}
              def.action.foods = draft.data.foodIds
            }
          }

          const newDefinition = rule.definition?.data ? { ...rule.definition, data: def } : def
          if (rule.source_rule_id && onRuleCloned) {
            await onRuleCloned(rule, newDefinition)
          } else {
            await onRuleUpdated(rule.id, newDefinition)
          }
        }
      }
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Finished Screen ───
  if (isFinished) {
    const changes = activeRules.filter(r => drafts[r.id]?.action === "update")
    const deletes = activeRules.filter(r => drafts[r.id]?.action === "delete")
    const skips = activeRules.filter(r => !drafts[r.id] || drafts[r.id]?.action === "skip")

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-center text-xl text-emerald-700 flex items-center justify-center gap-2">
              <ShieldCheck className="h-6 w-6" /> Gözden Geçirme Tamamlandı
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {changes.length > 0 && (
              <div className="text-sm">
                <span className="font-medium text-emerald-700">{changes.length} kural güncellendi</span>
                <div className="mt-1 space-y-0.5">
                  {changes.map(r => <div key={r.id} className="text-xs text-gray-500 pl-3">• {r.name}</div>)}
                </div>
              </div>
            )}
            {deletes.length > 0 && (
              <div className="text-sm">
                <span className="font-medium text-red-600">{deletes.length} kural silinecek</span>
                <div className="mt-1 space-y-0.5">
                  {deletes.map(r => <div key={r.id} className="text-xs text-gray-500 pl-3">• {r.name}</div>)}
                </div>
              </div>
            )}
            {skips.length > 0 && (
              <div className="text-xs text-gray-400">{skips.length} kural değiştirilmeden bırakıldı</div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setCurrentStep(activeRules.length - 1)} disabled={isSaving}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Geri Dön
            </Button>
            <Button onClick={handleApplyAllChanges} disabled={isSaving} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Kaydet
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ─── Intro Screen ───
  if (!isStarted) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[400px] p-5">
          <DialogHeader>
            <DialogTitle className="text-center text-lg text-emerald-800">Tercihlerinizi Gözden Geçirin</DialogTitle>
            <DialogDescription className="text-center text-xs leading-relaxed text-gray-600 mt-2">
              Beslenme kurallarınızı adım adım gözden geçirin.
              Düzenleyin, atlayın veya silin — değişiklikler sonda kaydedilir.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-between text-[11px] text-gray-500 px-1 mt-3">
            <span className="font-medium">{activeRules.length} tercih</span>
            <span className="flex gap-1 flex-wrap justify-end">
              {activeRules.filter(r => r.rule_type === "frequency").length > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">Sıklık</Badge>}
              {activeRules.filter(r => r.rule_type === "affinity").length > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">Uyum</Badge>}
              {activeRules.filter(r => r.rule_type === "consistency").length > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">Kilit</Badge>}
              {activeRules.filter(r => r.rule_type === "fixed_meal").length > 0 && <Badge variant="outline" className="text-[9px] px-1.5 py-0">Sabit</Badge>}
            </span>
          </div>
          <Button onClick={() => setIsStarted(true)} className="w-full mt-3 bg-emerald-600 hover:bg-emerald-700 h-10 text-sm">
            Başlayalım <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </DialogContent>
      </Dialog>
    )
  }

  const handleSaveAndExit = async () => {
    if (currentDraftData) {
      setDrafts(prev => ({ ...prev, [activeRules[currentStep].id]: { action: "update", data: currentDraftData } }))
    }
    await handleApplyAllChanges()
  }

  // ─── Step Screen ───
  const currentRule = activeRules[currentStep]
  const currentDraftAction = drafts[currentRule.id]?.action
  const rt = currentRule.rule_type

  const handleNext = (action: "update" | "skip" | "delete") => {
    if (action === "update" && warnings.length > 0 && !forceBypassWarning) {
      setForceBypassWarning(true)
      return
    }
    setDrafts(prev => ({
      ...prev,
      [currentRule.id]: { action, data: currentDraftData }
    }))
    setForceBypassWarning(false)
    setWarnings([])
    setCurrentStep(prev => prev + 1)
  }

  const typeLabels: Record<string, string> = {
    frequency: "Sıklık", affinity: "Uyum", consistency: "Kilit",
    fixed_meal: "Sabit Öğün", rotation: "Rotasyon",
    nutritional: "Makro", or_group: "VEYA Grubu"
  }

  // Keep ref in sync with latest handleNext
  handleNextRef.current = handleNext

  const editorProps = {
    rule: currentRule,
    draft: drafts[currentRule.id]?.data,
    onChange: setCurrentDraftData,
    warnings,
    setWarnings
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] min-h-[50vh] flex flex-col overflow-hidden p-0">
        <div className="shrink-0 px-4 pt-3 pb-2 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <DialogTitle className="text-emerald-800 text-sm font-bold">Gözden Geçir</DialogTitle>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[9px] font-medium px-1.5 py-0">{typeLabels[rt] || rt}</Badge>
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                {currentStep + 1}/{activeRules.length}
              </span>
            </div>
          </div>
          <h3 className="text-[15px] font-semibold text-gray-900 leading-tight">{currentRule.name}</h3>
          {currentRule.description && (
            <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{currentRule.description}</p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5" key={currentRule.id}>
          <div className="bg-white p-3 rounded-lg border border-emerald-100/80 relative">
            {currentDraftAction && (
              <div className="absolute top-1.5 right-1.5 text-[8px] uppercase font-bold px-1 py-0.5 rounded bg-gray-200 text-gray-500">
                {currentDraftAction === "delete" ? "Silinecek" : currentDraftAction === "skip" ? "Atlanacak" : "Güncellenecek"}
              </div>
            )}

            {rt === "frequency" && <FrequencyEditor {...editorProps} lockedMeals={lockedMeals} />}
            {rt === "affinity" && <AffinityEditor {...editorProps} categories={categories} />}
            {rt === "consistency" && <ConsistencyEditor {...editorProps} />}
            {rt === "fixed_meal" && <FixedMealEditor {...editorProps} foodsDb={foodsDb} />}
            {rt === "rotation" && <RotationEditor {...editorProps} foodsDb={foodsDb} />}
            {rt === "nutritional" && <NutritionalEditor {...editorProps} foodsDb={foodsDb} />}
            {rt === "or_group" && <OrGroupEditor {...editorProps} />}

            {forceBypassWarning && warnings.length > 0 && (
              <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-lg flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0 mt-0.5" />
                <span className="text-[11px] text-orange-800">Emin misiniz? Tekrar basarak devam edebilirsiniz.</span>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-1">
            <button onClick={() => { setCurrentStep(prev => Math.max(0, prev - 1)); setForceBypassWarning(false); setWarnings([]) }} disabled={currentStep === 0}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-white disabled:opacity-30 transition-colors" title="Geri">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => handleNext("delete")} disabled={!!currentRule.source_rule_id}
              className="w-8 h-8 rounded-lg border border-red-200 flex items-center justify-center text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors" title="Sil">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => handleNext("skip")}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-white transition-colors" title="Atla">
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleNext("update")}
              className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-xs font-medium flex items-center gap-1 hover:bg-emerald-700 transition-colors" title="Güncelle">
              <Check className="h-3.5 w-3.5" /> Kaydet
            </button>
            <button onClick={handleSaveAndExit} disabled={isSaving}
              className="h-8 px-2.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-medium flex items-center gap-1 hover:bg-emerald-50 disabled:opacity-50 transition-colors" title="Kaydet ve Çık">
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
