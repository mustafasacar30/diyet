'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { PlanningRule } from '@/types/planner'
import { RuleReviewWizard } from './rule-review-wizard'
import { generateRuleSentence } from '@/lib/ai/health-conflict-checker'
import {
  Send,
  Loader2,
  AlertTriangle,
  Info,
  XCircle,
  CheckCircle2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Leaf,
  Trash2,
  Play,
  Pause,
  PlusCircle,
  Activity,
  Lock,
  Star,
  ExternalLink,
} from 'lucide-react'
import Link from 'next/link'

// ─── Interfaces ───
interface ConflictInfo {
  severity: 'error' | 'warning' | 'info'
  icon: '🔴' | '🟡' | '🔵'
  existing_rule_name: string
  message: string
}

interface GenerateRuleResponse {
  success: boolean
  error?: string
  mode?: 'rule_ready' | 'clarification_needed'
  rule: {
    name: string
    description: string
    rule_type: string
    priority: number
    is_active: boolean
    definition: any
  }
  additional_rules?: any[]
  explanation: string
  conflicts: ConflictInfo[]
  suggestions: string[]
  affected_foods?: AffectedFood[]
  duplicate_warnings?: { id: string; name: string; scope: string; rule_type: string; summary: string }[]
  engine_rule_count?: number
  clarification_needed?: boolean
  clarification_target?: any
  clarification_message?: string
  budget_impact?: {
    dailyTarget: number
    existingRulesCal: number
    newRulesCal: number
    totalEstimatedCal: number
    overflowPercent: number
    overflowingRules: string[]
    recommendation: string | null
  }
}

interface AffectedFood {
  id: string
  name: string
  category: string
  role: string
  tags: string[]
}

interface SeraAssistantProps {
  patientId?: string | null
  patientName?: string
  teamOwnerId?: string | null
  programTemplateId?: string | null
  onRuleCreated: () => void
  requireApproval: boolean
  /** 'patient' (default) | 'program' | 'team' | 'global'
   *  When embedded on a dietitian panel Sera still writes rules to the current scope layer.
   *  Backend API receives this and injects the correct rules context + phase map.
   */
  scope?: 'patient' | 'program' | 'team' | 'global'
  /** Compact mode: hides the outer card wrapper (for embedding in a tab/sheet). */
  compact?: boolean
  onRedirectToChat?: (message: string) => void
  initialPrompt?: string
  onInitialPromptUsed?: () => void
}

// ─── Hasta-Dostu Örnek Promptlar (gerçek kural örnekleri) ───
const ALL_SERA_PROMPTS = [
  // Kahvaltı tercihleri
  'Sabahları mutlaka yumurta olsun',
  'Omlet ve menemen sık olsun',
  'Kahvaltıda peynir çeşidi olsun',
  'Sabahları ceviz ve badem ekle',
  'Kahvaltıda sucuk salam olmasın',
  'Yumurtalı tariflere daha çok yer ver',
  // Ekmek / karbonhidrat tercihleri
  'Akşam öğünlerinde ekmek daha fazla olsun',
  'Ekmek tamamen çıkarılsın',
  'Pilav yerine bulgur tercih ederim',
  'Makarna haftada en fazla 1 kez olsun',
  'Tam tahıllı ürünler olsun',
  // Öğle yemeği
  'Öğlen mutlaka çorba olsun',
  'Öğlen hafif salata ağırlıklı olsun',
  'Öğle yemeğinde tavuk tercih ederim',
  'Öğle yemeğinde kuru baklagil olsun',
  'Haftasonu öğle yemeklerinde sucuk olabilir',
  // Akşam yemeği
  'Akşamları hafif yemek istiyorum',
  'Akşam yemeğinde karbonhidrat az olsun',
  'Akşamları sebze ağırlıklı olsun',
  'Akşam yemeğinde hamur işi olmasın',
  'Akşamları çorba ve salata yeterli',
  // Ara öğünler
  'Ara öğünlerde meyve olsun',
  'Ara öğünde kuruyemiş tercih ederim',
  'Ara öğünlerde yoğurt istiyorum',
  'Gece atıştırmalığı olmasın',
  // Sevmediğim yemekler
  'Enginar sevmem, listelere ekleme',
  'Brokoli ve karnabahar sevmiyorum',
  'Patlıcan yemem',
  'Kereviz yemem',
  'Bamya olmasın',
  'Mantar sevmiyorum',
  'Ciğer yemem',
  'Ton balığı sevmiyorum',
  'Tahin yemem',
  'Muz yemem',
  // Et ve protein
  'Kırmızı eti haftada en fazla 2 kez istiyorum',
  'Balık haftada mutlaka 2 kez olsun',
  'Et yerine baklagil protein kaynağı olsun',
  'Somon haftada bir olsun',
  'Hindi eti tercih ederim',
  // Sebze tercihleri
  'Ispanak sık olsun',
  'Kabak seviyorum sık olsun',
  'Yeşil yapraklı sebzeler çok olsun',
  'Havuç ve biber her gün olabilir',
  // Meyve tercihleri
  'Çilek ve böğürtlen olsun',
  'Elma her gün olabilir',
  'Kuru meyve azalt',
  'Portakal veya mandalina her gün olabilir',
  // Süt ürünleri
  'Yoğurt her gün olsun',
  'Kaşar peynir yerine beyaz peynir olsun',
  'Kefir ekleyebilirsiniz',
  'Ayran her gün olsun',
  // Kuruyemiş
  'Ceviz ve badem her gün olsun',
  'Keten tohumu ve chia ekleyin',
  // Sıklık ve çeşitlilik
  'Çeşitlilik çok olsun tekrar az olsun',
  'Her gün salata olsun',
  'Hafta sonu farklı yemekler olsun',
  'Haftada 3 gün balık olsun',
  'Haftada en az 2 kez mercimek olsun',
  'Salata her öğünde olsun',
  'Peynir sabah ve akşam olsun',
  'Zeytinyağlılar haftada 3 kez olsun',
]

function getRandomSeraPrompts(count: number = 5): string[] {
  const shuffled = [...ALL_SERA_PROMPTS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

const SERA_EXAMPLE_PROMPTS = getRandomSeraPrompts(5)

// ─── Kural Tipi Etiketleri (Hasta-Dostu) ───
const RULE_TYPE_LABELS_FRIENDLY: Record<string, string> = {
  frequency: 'Sıklık Tercihi',
  affinity: 'Yemek Uyumu',
  consistency: 'Tutarlılık',
  fixed_meal: 'Sabit Öğün',
  nutritional: 'Besin Dengesi',
  rotation: 'Çeşitlilik',
  or_group: 'Alternatifler',
  preference_score: 'Yemek Tercihi',
}

// ─── Sera Bileşeni ───
export function SeraAssistant({
  patientId,
  patientName,
  teamOwnerId,
  programTemplateId,
  onRuleCreated,
  requireApproval,
  scope = 'patient',
  compact = false,
  onRedirectToChat,
  initialPrompt,
  onInitialPromptUsed,
}: SeraAssistantProps) {
  const effectiveScope = scope
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [aiResult, setAiResult] = useState<GenerateRuleResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [isSummaryOpen, setIsSummaryOpen] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isRulesExpanded, setIsRulesExpanded] = useState(false)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [prefillData, setPrefillData] = useState<PlanningRule | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [showPreferenceBanner, setShowPreferenceBanner] = useState(false)
  const [showRuleBanner, setShowRuleBanner] = useState(false)

  // Faz 3 & 5 States
  const [patientRules, setPatientRules] = useState<any[]>([])
  const [affectedFoods, setAffectedFoods] = useState<AffectedFood[]>([])
  const [selectedExceptions, setSelectedExceptions] = useState<string[]>([])
  const [isFetchingFoods, setIsFetchingFoods] = useState(false)

  // Faz 6 States
  const [simulationReport, setSimulationReport] = useState<string | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)

  // ─── initialPrompt (sohbetten yönlendirme) ───
  const initialPromptUsedRef = useRef<string | null>(null)
  const shouldAutoGenerate = useRef(false)
  useEffect(() => {
    if (initialPrompt && initialPromptUsedRef.current !== initialPrompt) {
      initialPromptUsedRef.current = initialPrompt
      setPrompt(initialPrompt)
      shouldAutoGenerate.current = true
      onInitialPromptUsed?.()
    }
  }, [initialPrompt])

  // ─── Sera'ya Mesaj Gönder ───
  const [clarificationInput, setClarificationInput] = useState('')

  // ─── Makro Simülasyon (Faz 6) ───
  useEffect(() => {
    if (aiResult?.rule && !aiResult.clarification_needed) {
      const runSimulation = async () => {
        setIsSimulating(true)
        setSimulationReport(null)
        try {
          const rulesToSimulate = [aiResult.rule, ...(aiResult.additional_rules || [])]
          const res = await fetch('/api/ai/simulate-impact-v3', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rules: rulesToSimulate, patient_id: patientId })
          })
          const data = await res.json()
          if (data.success && data.simulation_report) {
            setSimulationReport(data.simulation_report)
          }
        } catch (err) {
          console.error("Simulation error", err)
        } finally {
          setIsSimulating(false)
        }
      }
      runSimulation()
    } else {
      setSimulationReport(null)
      setIsSimulating(false)
    }
  }, [aiResult, patientId])

  // ─── Kuralları Çekme ───
  const fetchPatientRules = useCallback(async () => {
    if (!patientId) return
    try {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase
        .from('planning_rules')
        .select('*')
        .eq('scope', 'patient')
        .eq('patient_id', patientId)
        .order('sort_order', { ascending: true })

      if (data) setPatientRules(data)
    } catch (e) {
      console.error('Error fetching patient rules:', e)
    }
  }, [patientId])

  useEffect(() => {
    fetchPatientRules()
  }, [fetchPatientRules])

  const togglePatientRuleStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { supabase } = await import('@/lib/supabase')
      await supabase.from('planning_rules').update({ is_active: !currentStatus }).eq('id', id)
      fetchPatientRules()
      onRuleCreated()
    } catch (e) {
      console.error('Error toggling rule:', e)
    }
  }

  const updatePatientRule = async (id: string, newDefinition: any) => {
    try {
      const { supabase } = await import('@/lib/supabase')
      await supabase.from('planning_rules').update({ definition: newDefinition }).eq('id', id)
      fetchPatientRules()
      onRuleCreated()
    } catch (e) {
      console.error('Error updating rule:', e)
    }
  }

  const clonePatientRule = async (rule: any, newDefinition: any) => {
    try {
      const { supabase } = await import('@/lib/supabase')
      
      const newDesc = (rule.description || '') + ' (Otomatik olarak duraklatıldı)'
      await supabase.from('planning_rules').update({ is_active: false, description: newDesc }).eq('id', rule.id)
      
      const { id, created_at, updated_at, is_active, ...clonedData } = rule
      
      clonedData.source_rule_id = null 
      clonedData.scope = 'patient'
      clonedData.definition = newDefinition
      if(clonedData.definition.data) {
          clonedData.definition.data._source = 'sera_assistant'
      } else {
          clonedData.definition._source = 'sera_assistant'
      }
      
      await supabase.from('planning_rules').insert([clonedData])
      
      fetchPatientRules()
      onRuleCreated()
    } catch (e) {
      console.error('Error cloning rule:', e)
    }
  }

  const handleSummarize = async () => {
    setIsSummaryOpen(true)
    setSummaryLoading(true)
    setSummaryText(null)
    try {
      const res = await fetch('/api/ai/summarize-program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId })
      })
      const data = await res.json()
      if (data.success) {
        setSummaryText(data.summary)
      } else {
        setSummaryText("Özet oluşturulurken bir hata oluştu: " + data.error)
      }
    } catch (err) {
      setSummaryText("Bağlantı hatası.")
    } finally {
      setSummaryLoading(false)
    }
  }

  const deletePatientRule = async (id: string) => {
    try {
      const { supabase } = await import('@/lib/supabase')
      await supabase.from('planning_rules').delete().eq('id', id)
      fetchPatientRules()
      onRuleCreated()
    } catch (e) {
      console.error('Error deleting rule:', e)
    }
  }

  // ─── Etkilenen Yemekleri Çekme ───
  const fetchAffectedFoods = async (target: any) => {
    if (!target?.type || !target?.value) return
    setIsFetchingFoods(true)
    try {
      const res = await fetch('/api/ai/affected-foods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: target.type, target_value: target.value })
      })
      const data = await res.json()
      if (data.success && data.affected_foods) {
        setAffectedFoods(data.affected_foods)
        // By default, no exceptions selected (all affected)
        setSelectedExceptions([])
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsFetchingFoods(false)
    }
  }

  // ─── Sera'ya Mesaj Gönder ───
  const handleGenerate = useCallback(async (additionalPrompt?: string) => {
    const basePrompt = prompt.trim()

    if (!additionalPrompt && onRedirectToChat) {
      const q = basePrompt.toLowerCase()
      const isRule = [
        /olsun\b/, /olmasın\b/, /eklenmesi/, /çıkar/, /kaldır/, /koyma/,
        /istemi?yorum/, /istemem/,
        /sevmi?yorum/, /sevmem/, /sevmiyorum/,
        /yemem/, /yiyemem/, /yemiyorum/, /yiyemiyorum/,
        /alerjim/, /haftada\s*(\d|bir|iki|üç|dört|beş)/, /günde\s*(\d|bir|iki|üç)/,
        /sık\s*(olsun|gelsin)/, /az\s*(olsun|gelsin)/, /tercih\s*ederim/,
        /verme\b/, /vermeyiniz/, /yapma\b/, /koymayın/,
        /azalt/, /arttır/, /daha\s*(az|çok|fazla)\s*(olsun|gelsin)/,
        /hiç\s*(olmasın|verme|koyma|istemem|istemiyorum)/,
      ].some(p => p.test(q))

      if (!isRule) {
        onRedirectToChat(basePrompt)
        setPrompt('')
        return
      }
    }

    const activePrompt = additionalPrompt
      ? `Orijinal İsteğim: "${basePrompt}"\n\nSera'nın Notu/Sorusu (Varsa): "${aiResult?.clarification_message || 'Yok'}"\n\nBenim Ek Düzeltmem/Revizyonum: "${additionalPrompt.trim()}"\n\nGörev: Orijinal isteğimle bu son düzeltmemi/cevabımı HARMANLAYARAK benim "Nihai İsteğimi" anla. Ve bu nihai isteğe göre TÜM KURALLARI (iptal edilmeyen geçerli eski isteklerimi de dahil ederek) EKSİKSİZ BİR TAM LİSTE halinde yeniden oluştur. Aksi halde eski kurallarım ekrandan silinir!`
      : basePrompt

    if (!activePrompt || activePrompt.length < 3) return

    setIsLoading(true)
    setError(null)
    if (!additionalPrompt) {
        setAiResult(null)
    }
    setSuccessMessage(null)
    setShowPreferenceBanner(false)
    setShowRuleBanner(false)

    try {
      const response = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: activePrompt,
          scope: effectiveScope,
          patient_id: patientId,
          program_template_id: programTemplateId || undefined,
          team_owner_id: teamOwnerId || undefined,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        if (onRedirectToChat && response.status === 422) {
          onRedirectToChat(basePrompt)
          setPrompt('')
          return
        }
        setError(data.error || 'Bir sorun oluştu, lütfen tekrar deneyin.')
        return
      }

      setAiResult(data)
      if (additionalPrompt) {
          // Keep original prompt but clear clarification input
          setClarificationInput('')
      }
      if (data.rule && !data.clarification_needed && data.rule.definition?.target) {
        fetchAffectedFoods(data.rule.definition.target)
      }
    } catch (err: any) {
      setError(err.message || 'Bağlantı hatası. Lütfen internet bağlantınızı kontrol edin.')
    } finally {
      setIsLoading(false)
    }
  }, [prompt, patientId, programTemplateId, teamOwnerId, aiResult])

  // Auto-generate when redirected from chat
  useEffect(() => {
    if (shouldAutoGenerate.current && prompt && !isLoading) {
      shouldAutoGenerate.current = false
      handleGenerate()
    }
  })

  // ─── Suggestion'ı Pakete Ekle ───
  const handleAppendSuggestion = async (suggestion: string) => {
    if (!aiResult) return
    setIsLoading(true)
    setError(null)
    
    const appendPrompt = `Aşağıdaki ek isteğimi yerine getirecek bir beslenme kuralı üret:\n\nİstek: "${suggestion}"`
    
    try {
      const response = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: appendPrompt,
          scope: effectiveScope,
          patient_id: patientId,
          program_template_id: programTemplateId || undefined,
          team_owner_id: teamOwnerId || undefined,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        setError(data.error || 'Ek istek oluşturulurken bir sorun oluştu.')
        return
      }
      
      setAiResult(prev => {
        if (!prev) return prev
        const updatedSuggestions = (prev.suggestions || []).filter(s => s !== suggestion)
        const newAdditionalRules = [...(prev.additional_rules || [])]
        
        if (data.rule) {
          newAdditionalRules.push(data.rule)
        }
        if (data.additional_rules && data.additional_rules.length > 0) {
           newAdditionalRules.push(...data.additional_rules)
        }
        
        return {
          ...prev,
          suggestions: updatedSuggestions,
          additional_rules: newAdditionalRules
        }
      })
      
    } catch (err: any) {
      setError(err.message || 'Bağlantı hatası.')
    } finally {
      setIsLoading(false)
    }
  }

  // ─── Kuralı Direkt Kaydet ───
  const handleSaveDirectly = useCallback(async () => {
    if (!aiResult?.rule) return
    setIsLoading(true)

    const rule = aiResult.rule
    const rulesToInsert = []
    
    // Çelişen/Eski kural ID'lerini toplayıp Kuralın içine (definition._replaced_ids) gömüyoruz ki Diyetisyen onayladığında iptal edilsin!
    // API artık aynı hedefe sahip TÜM aktif kuralları definition._replaced_ids'e önceden koyuyor —
    // bunu da toplama sonuçlarına dahil et ki hiçbir çakışan kural aktif kalmasın.
    const apiReplacedIds = ((rule.definition as any)?._replaced_ids || []) as string[]
    const additionalReplacedIds = (aiResult.additional_rules || []).flatMap((ar: any) => (ar.definition?._replaced_ids || []) as string[])
    const replacedIds = Array.from(new Set([
      ...apiReplacedIds,
      ...additionalReplacedIds,
      (rule as any).replaces_rule_id,
      ...(aiResult.additional_rules || []).map((r: any) => r.replaces_rule_id),
      ...(aiResult.conflicts || []).map((c: any) => c.existing_rule_id)
    ].filter(Boolean)))

    const mealUpdateSlots: any[] = []
    const preferenceScoreUpdates: Array<{ keyword: string; score: number; match_mode?: string }> = []

    // Ana Kural
    const finalDefinition = { ...rule.definition }
    if (finalDefinition.target && selectedExceptions.length > 0) {
      finalDefinition.target.exceptions = selectedExceptions
    }

    if (rule.rule_type === 'preference_score') {
      const def = finalDefinition.data || finalDefinition
      preferenceScoreUpdates.push({ keyword: def.keyword, score: def.score, match_mode: def.match_mode })
    } else if (rule.rule_type === 'update_meal_settings') {
      const slots = finalDefinition.data?.slots || finalDefinition.slots;
      if (slots) mealUpdateSlots.push(...slots)
    } else {
      rulesToInsert.push({
        name: rule.name,
        description: rule.description,
        rule_type: rule.rule_type,
        priority: rule.priority,
        is_active: !requireApproval,
        definition: { ...finalDefinition, _source: 'sera_assistant', _replaced_ids: replacedIds },
        scope: effectiveScope,
        patient_id: patientId || null,
        program_template_id: programTemplateId || null,
        team_owner_id: teamOwnerId || null,
        pending_global_approval: requireApproval,
      })
    }

    // Ek Kurallar
    if (aiResult.additional_rules && aiResult.additional_rules.length > 0) {
      for (const ar of aiResult.additional_rules) {
        if (ar.rule_type === 'preference_score') {
          const arDef = ar.definition?.data || ar.definition
          preferenceScoreUpdates.push({ keyword: arDef.keyword, score: arDef.score, match_mode: arDef.match_mode })
        } else if (ar.rule_type === 'update_meal_settings') {
          const arSlots = ar.definition?.data?.slots || ar.definition?.slots;
          if (arSlots) mealUpdateSlots.push(...arSlots)
        } else {
          rulesToInsert.push({
            name: ar.name,
            description: ar.description,
            rule_type: ar.rule_type,
            priority: ar.priority,
            is_active: !requireApproval,
            definition: { ...ar.definition, _source: 'sera_assistant' },
            scope: effectiveScope,
            patient_id: patientId || null,
            program_template_id: programTemplateId || null,
            team_owner_id: teamOwnerId || null,
            pending_global_approval: requireApproval,
          })
        }
      }
    }

    try {
      const { supabase } = await import('@/lib/supabase')
      
      if (rulesToInsert.length > 0) {
        const { error } = await supabase.from('planning_rules').insert(rulesToInsert)
        if (error) throw error
      }

      // Preference score updates (food_score_overrides)
      if (preferenceScoreUpdates.length > 0) {
        for (const psu of preferenceScoreUpdates) {
          const scoreRes = await fetch('/api/food-score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keyword: psu.keyword,
              score: psu.score,
              scope: effectiveScope,
              patient_id: patientId || null,
              program_template_id: programTemplateId || null,
              team_owner_id: teamOwnerId || null,
            })
          })
          const scoreData = await scoreRes.json()
          if (!scoreData.success) console.warn('Preference score update warning:', scoreData.error)
        }
      }

      if (mealUpdateSlots.length > 0 && patientId) {
        const mealRes = await fetch('/api/ai/update-meals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: patientId,
            program_template_id: programTemplateId || null,
            team_owner_id: teamOwnerId || null,
            slots: mealUpdateSlots
          })
        })
        const mealData = await mealRes.json()
        if (!mealData.success) throw new Error(mealData.error || "Öğün ayarları güncellenemedi.")
      }

      // Eğer çelişen/ezilen eski kurallar varsa, onları HEMEN ez/pause yap (Onaya düşse bile hastanın eski kuralını durdururuz)
      if (replacedIds.length > 0) {
        console.log("Auto-pausing replaced rules directly from Sera:", replacedIds)
        const { data: replacedRules } = await supabase.from('planning_rules').select('*').in('id', replacedIds)
        
        if (replacedRules) {
          for (const repRule of replacedRules) {
            const pauseReason = `(Yeni bir tercih oluşturulduğu için bu kural otomatik olarak duraklatıldı.)\n\n${repRule.description || ''}`;
            
            if (repRule.scope === 'patient') {
              // Hasta kuralıysa doğrudan update ile kapat
              await supabase.from('planning_rules').update({ 
                  is_active: false,
                  description: pauseReason
              }).eq('id', repRule.id)
            } else {
              // Global/Team kuralıysa hasta için override (tombstone) oluştur
              await supabase.from('planning_rules').insert({
                name: repRule.name,
                description: pauseReason,
                rule_type: repRule.rule_type,
                priority: repRule.priority,
                is_active: false,
                definition: repRule.definition,
                scope: effectiveScope,
                patient_id: patientId || null,
                team_owner_id: teamOwnerId || null,
                source_rule_id: repRule.id,
                sort_order: repRule.sort_order
              })
            }
          }
        }
      }

      setAiResult(null)
      setPrompt('')
      setAffectedFoods([])
      setSelectedExceptions([])

      if (requireApproval) {
        setSuccessMessage('Tercihiniz kaydedildi ve diyetisyeninizin onayına sunuldu 🌿')
      } else {
        setSuccessMessage('Tercihiniz kaydedildi ve hemen uygulandı 🌿')
      }

      if (preferenceScoreUpdates.length > 0) {
        setShowPreferenceBanner(true)
      } else {
        setShowRuleBanner(true)
      }

      fetchPatientRules()
      onRuleCreated()
    } catch (err: any) {
      setError(err.message || 'Kayıt sırasında bir hata oluştu.')
    } finally {
      setIsLoading(false)
    }
  }, [aiResult, patientId, programTemplateId, teamOwnerId, requireApproval, onRuleCreated, selectedExceptions, fetchPatientRules])
  // ─── Ek Kuralı Kaydet ───
  const handleSaveAdditionalRule = async (addRule: any, index: number) => {
    setIsLoading(true)
    
    try {
      const slotsToUpdate = addRule.definition?.data?.slots || addRule.definition?.slots;
      if (addRule.rule_type === 'preference_score') {
        const def = addRule.definition?.data || addRule.definition
        const scoreRes = await fetch('/api/food-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: def.keyword,
            score: def.score,
            scope: effectiveScope,
            patient_id: patientId || null,
            program_template_id: programTemplateId || null,
            team_owner_id: teamOwnerId || null,
          })
        })
        const scoreData = await scoreRes.json()
        if (!scoreData.success) throw new Error(scoreData.error || "Tercih skoru güncellenemedi.")
      } else if (addRule.rule_type === 'update_meal_settings' && slotsToUpdate && patientId) {
         const mealRes = await fetch('/api/ai/update-meals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               patient_id: patientId,
               program_template_id: programTemplateId || null,
               team_owner_id: teamOwnerId || null,
               slots: slotsToUpdate
            })
         })
         const mealData = await mealRes.json()
         if (!mealData.success) throw new Error(mealData.error || "Öğün ayarları güncellenemedi.")
      } else {
        // API artık definition._replaced_ids içine tüm çakışan aktif kural id'lerini koyuyor.
        // Bunu Sera'nın tek replaces_rule_id'siyle birleştir (her ikisini de kabul et).
        const apiReplacedIds = ((addRule.definition as any)?._replaced_ids || []) as string[]
        const singleReplaceId = addRule.replaces_rule_id
        const allReplacedIds = Array.from(new Set([...apiReplacedIds, singleReplaceId].filter(Boolean))) as string[]

        const ruleData = {
          name: addRule.name,
          description: addRule.description,
          rule_type: addRule.rule_type,
          priority: addRule.priority,
          is_active: !requireApproval,
          definition: {
            ...addRule.definition,
            _source: 'sera_assistant',
            _replaced_ids: allReplacedIds
          },
          scope: effectiveScope,
          patient_id: patientId || null,
          program_template_id: programTemplateId || null,
          team_owner_id: teamOwnerId || null,
          pending_global_approval: requireApproval,
        }

        const { supabase } = await import('@/lib/supabase')
        const { error } = await supabase.from('planning_rules').insert(ruleData)
        if (error) throw error

        // Diyetisyen kendi ekliyorsa (direkt aktif oluyorsa), çelişenleri HEMEN ez/pause yap!
        if (!requireApproval && allReplacedIds.length > 0) {
          const { data: replacedRules } = await supabase.from('planning_rules').select('*').in('id', allReplacedIds)
          if (replacedRules && replacedRules.length > 0) {
            for (const repRule of replacedRules) {
              if (repRule.scope === 'patient') {
                await supabase.from('planning_rules').update({ is_active: false }).eq('id', repRule.id)
              } else {
                await supabase.from('planning_rules').insert({
                  name: repRule.name,
                  description: repRule.description,
                  rule_type: repRule.rule_type,
                  priority: repRule.priority,
                  is_active: false,
                  definition: repRule.definition,
                  scope: effectiveScope,
                  patient_id: patientId,
                  team_owner_id: teamOwnerId || null,
                  source_rule_id: repRule.id,
                  sort_order: repRule.sort_order
                })
              }
            }
          }
        }
      }

      fetchPatientRules()
      onRuleCreated()

      if (addRule.rule_type === 'preference_score') {
        setShowPreferenceBanner(true)
      } else {
        setShowRuleBanner(true)
      }

      setAiResult(prev => {
        if (!prev) return prev
        const newAdditional = [...(prev.additional_rules || [])]
        newAdditional.splice(index, 1)

        if (!prev.rule && newAdditional.length === 0) {
           setPrompt('')
           return null
        }
        return { ...prev, additional_rules: newAdditional }
      })
    } catch (e: any) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }


  // ─── Enter Tuşu ───
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }, [handleGenerate])

  return (
    <>
      {/* ── Sera Ana Bileşen ── */}
      <div className="border border-emerald-200 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 rounded-xl overflow-hidden">
        {/* Başlık Çubuğu */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-emerald-50/80 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Leaf className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-semibold text-emerald-800">
              Sera
            </span>
            <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-600 px-1.5 py-0">
              Kişisel
            </Badge>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-emerald-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-emerald-500" />
          )}
        </button>

        {/* Genişletilmiş İçerik */}
        {isExpanded && (
          <div className="px-4 pb-4 space-y-3">

            {/* Başarı Mesajı */}
            {successMessage && (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-emerald-700">{successMessage}</p>
                </div>

                {showPreferenceBanner && (
                  <Link href="/patient/preferences">
                    <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-100/70 transition-colors group">
                      <Star className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-amber-800">Yemek tercihlerinizi inceleyebilir ve dilediğinizde değiştirebilirsiniz.</p>
                        <span className="text-xs text-amber-600 font-medium flex items-center gap-1 mt-1 group-hover:underline">
                          Yemek Tercihlerim <ExternalLink className="h-3 w-3" />
                        </span>
                      </div>
                    </div>
                  </Link>
                )}

                {showRuleBanner && (
                  <div className="flex items-start gap-2.5 p-3 bg-amber-50/70 border border-amber-100 rounded-lg">
                    <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <p className="text-[13px] text-amber-700">Aşağıdaki <strong>Beslenme Tercihlerim</strong> bölümünden size özel program kurallarınızı inceleyebilirsiniz.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mesaj Kutusu — her zaman göster */}
            <div className="flex gap-2">
              <Textarea
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); if (successMessage) setSuccessMessage(null) }}
                onKeyDown={handleKeyDown}
                placeholder="Sen de isteklerini belirt... (örn: enginar sevmem)"
                className="min-h-[44px] max-h-[100px] text-sm resize-none bg-white border-emerald-200 focus-visible:ring-emerald-400 placeholder:text-emerald-400/60"
                rows={1}
                disabled={isLoading}
              />
              <Button
                onClick={() => handleGenerate()}
                disabled={isLoading || prompt.trim().length < 3}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 shrink-0 self-end"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>

            {!successMessage && (
              <>

                {/* Örnek İpuçları */}
                {!aiResult && !error && !isLoading && (
                  <div className="flex flex-wrap gap-1.5">
                    {SERA_EXAMPLE_PROMPTS.slice(0, 4).map((example, i) => (
                      <button
                        key={i}
                        onClick={() => setPrompt(example)}
                        className="text-[11px] px-2.5 py-1 rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                      >
                        &ldquo;{example}&rdquo;
                      </button>
                    ))}
                  </div>
                )}

                {/* Sera Düşünüyor */}
                {isLoading && (
                  <div className="flex items-center gap-2 py-3 justify-center text-emerald-700">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Sera notlarınızı inceliyor...</span>
                  </div>
                )}

                {/* Hata */}
                {error && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                {/* ── Sera Sonuç Kartı ── */}
                {aiResult && (
                  <div className="space-y-3">
                    {aiResult.clarification_needed ? (
                      /* ── Netleştirme İhtiyacı ── */
                      <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-lg space-y-3">
                        <div className="flex items-start gap-2">
                          <Leaf className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm text-emerald-800 font-medium">Talebinizi daha net anlayabilmem için şunu cevaplayabilir misiniz?</p>
                            <p className="text-base font-medium text-emerald-900 mt-2 p-2 bg-white/60 rounded-md border border-emerald-100 shadow-sm">{aiResult.clarification_message || "Bu kuralı uygulamak için hangi yemekleri kastettiğinizi biraz daha detaylandırabilir misiniz?"}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Textarea
                            value={clarificationInput}
                            onChange={(e) => setClarificationInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault()
                                  handleGenerate(clarificationInput)
                                }
                            }}
                            placeholder="Cevabınızı buraya yazın..."
                            className="min-h-[44px] max-h-[100px] text-sm resize-none bg-white border-emerald-200 focus-visible:ring-emerald-400"
                            rows={1}
                            disabled={isLoading}
                          />
                          <Button
                            onClick={() => handleGenerate(clarificationInput)}
                            disabled={isLoading || clarificationInput.trim().length < 2}
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 shrink-0 self-end"
                          >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          </Button>
                        </div>
                        <div className="pt-1">
                          <Button
                            onClick={() => { setAiResult(null); setPrompt(''); setClarificationInput('') }}
                            disabled={isLoading}
                            variant="ghost"
                            size="sm"
                            className="text-emerald-600 hover:bg-emerald-100 h-7 text-xs px-2"
                          >
                            İptal Et
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* ── Normal Kural Sonucu ── */
                      <>
                      {/* Sera'nın Yanıtı */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-sm text-gray-600 leading-relaxed">
                          {aiResult.explanation}
                        </p>
                      </div>

                      {/* Hazırlanan Tercihler — belirgin kart */}
                      <div className="mt-3 rounded-xl border-2 border-emerald-400 bg-white overflow-hidden shadow-sm">
                        <div className="px-3 py-2 bg-emerald-600 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                          <p className="text-xs font-semibold text-white">Onayınıza Sunulan Tercihler</p>
                        </div>
                        <div className="p-3 space-y-2">
                          {[aiResult.rule, ...(aiResult.additional_rules || [])].map((ruleObj, idx) => (
                            <div key={idx} className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <p className="text-[13px] font-semibold text-gray-800 leading-snug">{ruleObj.name}</p>
                                <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full shrink-0">
                                  Dahil
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-500 leading-relaxed">{ruleObj.description}</p>
                            </div>
                          ))}

                          {/* Onay Butonları */}
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              onClick={handleSaveDirectly}
                              disabled={isLoading}
                              size="sm"
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md animate-[pulse_2s_ease-in-out_infinite] hover:animate-none h-10 text-sm font-semibold"
                            >
                              {isLoading ? (
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                              )}
                              {requireApproval
                                ? (aiResult.additional_rules && aiResult.additional_rules.length > 0 ? 'Tüm Tercihleri Kaydet' : 'Tercihi Kaydet')
                                : (aiResult.additional_rules && aiResult.additional_rules.length > 0 ? 'Tüm Tercihleri Uygula' : 'Tercihi Uygula')}
                            </Button>
                            <Button
                              onClick={() => { setAiResult(null); setPrompt('') }}
                              disabled={isLoading}
                              variant="ghost"
                              size="sm"
                              className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 h-10"
                            >
                              Vazgeç
                            </Button>
                          </div>
                          {requireApproval && (
                            <p className="text-[11px] text-amber-600 text-center">
                              Tercihiniz diyetisyeninizin onayına sunulacaktır.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Çakışma Uyarıları */}
                      {aiResult.conflicts && aiResult.conflicts.length > 0 && (
                        <div className="space-y-1.5 pt-3 border-t border-emerald-50 mt-3">
                          {aiResult.conflicts.map((conflict, i) => (
                            <div
                              key={i}
                              className={`flex items-start gap-2 p-2.5 rounded-lg border text-sm ${
                                conflict.severity === 'error'
                                  ? 'bg-red-50 border-red-200 text-red-700'
                                  : conflict.severity === 'warning'
                                  ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                                  : 'bg-blue-50 border-blue-200 text-blue-700'
                              }`}
                            >
                              {conflict.severity === 'error' ? (
                                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                              ) : (
                                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                              )}
                              <span>{conflict.message}</span>
                            </div>
                          ))}
                          {aiResult.conflicts.some(c => c.severity === 'error') && (
                            <div className="text-xs text-red-600 font-medium px-2 py-1 flex gap-1.5 items-start bg-white/50 rounded border border-red-100">
                              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>Bu tercihi onayladığınızda, yukarıda belirtilen çelişkili eski kurallarınız otomatik olarak duraklatılacaktır.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Duplikat Uyarısı */}
                      {aiResult.duplicate_warnings && aiResult.duplicate_warnings.length > 0 && (
                        <div className="pt-3 border-t border-amber-100 mt-3">
                          <div className="p-2.5 rounded-lg border border-amber-300 bg-amber-50 text-sm">
                            <div className="flex items-center gap-1.5 font-medium text-amber-800 mb-1.5">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              Benzer kural zaten mevcut
                            </div>
                            <div className="space-y-1 ml-5">
                              {aiResult.duplicate_warnings.map((dw, i) => {
                                const scopeLabels: Record<string, string> = { global: 'Genel', team: 'Takım', program: 'Program', patient: 'Kişisel' }
                                return (
                                  <div key={i} className="text-amber-700 text-xs">
                                    <span className="font-medium">"{dw.name}"</span>
                                    <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-[10px] font-medium">{scopeLabels[dw.scope] || dw.scope}</span>
                                  </div>
                                )
                              })}
                            </div>
                            <p className="text-xs text-amber-700 mt-2 ml-5">
                              Onayladığınızda eski kural(lar) otomatik duraklatılıp yenisi devreye girecek.
                            </p>
                          </div>
                        </div>
                      )}


                      {/* Bütçe Etki Uyarısı (Karar Destek) */}
                      {aiResult.budget_impact && aiResult.budget_impact.overflowPercent > 15 && (
                        <div className={`mt-3 p-3 rounded-lg border ${
                          aiResult.budget_impact.overflowPercent > 30
                            ? 'bg-red-50 border-red-200'
                            : 'bg-amber-50 border-amber-200'
                        }`}>
                          <div className="flex items-start gap-2">
                            <Activity className={`h-4 w-4 mt-0.5 shrink-0 ${
                              aiResult.budget_impact.overflowPercent > 30 ? 'text-red-500' : 'text-amber-500'
                            }`} />
                            <div className="space-y-1 text-sm">
                              <p className={`font-medium ${
                                aiResult.budget_impact.overflowPercent > 30 ? 'text-red-800' : 'text-amber-800'
                              }`}>
                                Makro Bütçe Uyarısı
                              </p>
                              <p className={aiResult.budget_impact.overflowPercent > 30 ? 'text-red-700' : 'text-amber-700'}>
                                Tüm aktif kuralların tahmini günlük etkisi: ~{aiResult.budget_impact.totalEstimatedCal} kcal
                                (hedef: {aiResult.budget_impact.dailyTarget} kcal, aşım: %{aiResult.budget_impact.overflowPercent})
                              </p>
                              {aiResult.budget_impact.recommendation && (
                                <p className={`text-xs ${
                                  aiResult.budget_impact.overflowPercent > 30 ? 'text-red-600' : 'text-amber-600'
                                }`}>
                                  {aiResult.budget_impact.recommendation}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1.5">
                                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      aiResult.budget_impact.overflowPercent > 30 ? 'bg-red-500' : 'bg-amber-500'
                                    }`}
                                    style={{ width: `${Math.min(100, (aiResult.budget_impact.totalEstimatedCal / aiResult.budget_impact.dailyTarget) * 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-500 shrink-0">
                                  {Math.round((aiResult.budget_impact.totalEstimatedCal / aiResult.budget_impact.dailyTarget) * 100)}%
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Öneriler */}
                      {aiResult.suggestions && aiResult.suggestions.length > 0 && (
                        <div className="space-y-1.5 pt-3 border-t border-emerald-50 mt-3">
                          <p className="text-sm font-medium text-emerald-800 mb-1 flex items-center gap-1.5">
                            <Lightbulb className="h-4 w-4 text-emerald-600" />
                            Dilerseniz şu ek düzenlemeleri de yapabiliriz:
                          </p>
                          {aiResult.suggestions.map((suggestion, i) => (
                            <div key={i} className="flex items-start justify-between gap-2 text-sm text-emerald-700 ml-5 group">
                              <div className="flex items-start gap-2">
                                <span className="text-emerald-400 mt-0.5">•</span>
                                <span>{suggestion}</span>
                              </div>
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-6 text-[10px] px-2 transition-opacity bg-emerald-100 hover:bg-emerald-200 text-emerald-700 shrink-0 mt-0.5"
                                onClick={() => handleAppendSuggestion(suggestion)}
                                disabled={isLoading}
                              >
                                Bunu da Yap
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                        {/* İstisnalar (Affected Foods) */}
                        {!isFetchingFoods && affectedFoods.length > 0 && (
                          <div className="p-3 bg-emerald-50/30 border border-emerald-100 rounded-lg space-y-2 mt-2">
                            <p className="text-xs font-medium text-emerald-800">
                              Kurala Dahil Olan Yemekler
                              <span className="font-normal text-emerald-600 block mt-0.5">Aşağıdakilerden kalmasını (kuraldan hariç tutulmasını) istediklerinizi seçebilirsiniz.</span>
                            </p>
                            <div className="max-h-[120px] overflow-y-auto space-y-2 pr-2">
                              {affectedFoods.map((f) => (
                                <div key={f.id} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={f.id}
                                    checked={selectedExceptions.includes(f.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setSelectedExceptions(prev => [...prev, f.id])
                                      } else {
                                        setSelectedExceptions(prev => prev.filter(id => id !== f.id))
                                      }
                                    }}
                                    className="border-emerald-300 data-[state=checked]:bg-emerald-600"
                                  />
                                  <label
                                    htmlFor={f.id}
                                    className="text-xs font-medium leading-none cursor-pointer"
                                  >
                                    {f.name}
                                  </label>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {isFetchingFoods && (
                          <div className="p-3 text-center text-xs text-emerald-600">
                            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
                            Yemek listesi çekiliyor...
                          </div>
                        )}

                        {/* Aksiyon Butonları & Düzeltme Alanı */}
                        <div className="pt-2 space-y-3">
                          <div className="flex gap-2">
                            <Textarea
                              value={clarificationInput}
                              onChange={(e) => setClarificationInput(e.target.value)}
                              onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleGenerate(clarificationInput)
                                  }
                              }}
                              placeholder="Düzeltme veya ekleme yazın... (Örn: Yoğurdu da ekle)"
                              className="min-h-[48px] max-h-[100px] text-sm resize-none bg-white border-2 border-emerald-300 focus-visible:ring-emerald-400 focus-visible:border-emerald-500 shadow-sm"
                              rows={1}
                              disabled={isLoading}
                            />
                            <Button
                              onClick={() => handleGenerate(clarificationInput)}
                              disabled={isLoading || clarificationInput.trim().length < 2}
                              size="sm"
                              className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 shrink-0 self-end h-[44px]"
                              title="Değişikliği Gönder"
                            >
                              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </Button>
                          </div>

                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Beslenme Tercihlerim ── */}
      {patientRules.length > 0 && (
        <div className={`border border-emerald-100 bg-white rounded-xl overflow-hidden shadow-sm ${compact ? "mt-3" : "mt-6"}`}>
          <div className="bg-emerald-50/50 px-4 py-3 border-b border-emerald-100 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" className="flex-1 h-9 text-xs bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200" onClick={handleSummarize}>
                Programımı Özetle
              </Button>
              <Button size="sm" variant="outline" className="flex-1 h-9 text-xs bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => setIsWizardOpen(true)}>
                Gözden Geçir
              </Button>
            </div>
            <div
              className="flex items-center justify-between cursor-pointer hover:bg-emerald-100/50 transition-colors py-1 -mx-2 px-2 rounded-lg"
              onClick={() => setIsRulesExpanded(!isRulesExpanded)}
            >
              <h3 className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                Beslenme Tercihlerim
                <Badge variant="outline" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none">
                  {patientRules.length} Tercih
                </Badge>
              </h3>
              {isRulesExpanded ? <ChevronUp className="h-5 w-5 text-emerald-600" /> : <ChevronDown className="h-5 w-5 text-emerald-600" />}
            </div>
          </div>
          {isRulesExpanded && (
            <div className="divide-y divide-emerald-50">
              {[...patientRules].sort((a, b) => {
              // 1. Aktif kurallar üstte
              if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
              // 2. Diyetisyenin belirlediği sort_order (yukarıdan aşağıya öncelik)
              const aOrder = Number((a as any).sort_order)
              const bOrder = Number((b as any).sort_order)
              const aOrderVal = Number.isFinite(aOrder) ? aOrder : Number.MAX_SAFE_INTEGER
              const bOrderVal = Number.isFinite(bOrder) ? bOrder : Number.MAX_SAFE_INTEGER
              if (aOrderVal !== bOrderVal) return aOrderVal - bOrderVal
              // 3. Priority desc
              const aPri = Number(a.priority) || 0
              const bPri = Number(b.priority) || 0
              if (aPri !== bPri) return bPri - aPri
              // 4. Son eklenen üstte (tie-breaker)
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            }).map((rule) => (
              <div key={rule.id} className="px-3 py-2.5 flex items-start justify-between gap-3 hover:bg-emerald-50/30 transition-colors">
                <div className="flex-1">
                  <details className="group">
                    <summary className="list-none cursor-pointer flex flex-col gap-1.5 focus:outline-none">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[13px] text-gray-800 leading-snug pr-2 line-clamp-3">{generateRuleSentence(rule)}</span>
                          {!rule.is_active && rule.pending_global_approval && (
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200 bg-amber-50 shrink-0">
                              Onay Bekliyor
                            </Badge>
                          )}
                          {rule.is_active && (
                            <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200 bg-emerald-50 shrink-0">
                              Aktif
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-emerald-600/70 group-open:hidden transition-opacity">
                          Sistem kayıtlarını görmek için tıklayın...
                        </span>
                      </summary>
                      <div className="mt-3 pl-3 border-l-2 border-emerald-200/50">
                        <div className="text-xs font-semibold text-gray-700 bg-gray-50 inline-block px-2 py-0.5 rounded border border-gray-100 mb-1">
                          Sistem Kaydı: {rule.name}
                        </div>
                      <p className="text-xs text-gray-500 leading-relaxed">{rule.description}</p>
                    </div>
                  </details>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!rule.is_active && rule.pending_global_approval}
                    className={`h-8 w-8 ${rule.is_active ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' : (rule.description?.includes('otomatik olarak duraklatıldı') ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100' : 'text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50')}`}
                    onClick={() => {
                      if (rule.pending_global_approval) return
                      if (!rule.is_active || window.confirm('Bu tercih beslenme programınıza uygun şekilde planlanmıştı. Duraklatmak istediğinize emin misiniz?')) {
                        togglePatientRuleStatus(rule.id, rule.is_active)
                      }
                    }}
                    title={!rule.is_active && rule.pending_global_approval ? "Diyetisyen onayı bekleniyor" : (!rule.is_active && rule.description?.includes('otomatik olarak duraklatıldı') ? "Bu kural yeni bir tercih tarafından ezildiği için otomatik duraklatıldı. Aktif etmek için tıklayın." : (rule.is_active ? "Tercihi Duraklat" : "Tercihi Aktif Et"))}
                  >
                    {rule.is_active ? <Pause className="h-4 w-4" /> : (rule.description?.includes('otomatik olarak duraklatıldı') ? <Lock className="h-4 w-4 opacity-80" /> : <Play className="h-4 w-4" />)}
                  </Button>
                  
                  {(!rule.source_rule_id) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => {
                        if (window.confirm('Bu tercihi tamamen silmek istediğinize emin misiniz? (Dilerseniz silmek yerine duraklatabilirsiniz)')) {
                          deletePatientRule(rule.id)
                        }
                      }}
                      title="Tercihi Tamamen Sil"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            </div>
          )}
        </div>
      )}

      <RuleReviewWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          rules={patientRules}
          onRuleUpdated={updatePatientRule}
          onRuleDeleted={deletePatientRule}
          onRuleCloned={clonePatientRule}
        />

      {/* Program Özeti Modalı */}
      <Dialog open={isSummaryOpen} onOpenChange={setIsSummaryOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-emerald-800 text-lg">Program Özeti</DialogTitle>
          </DialogHeader>
          <div className="py-2 max-h-[65vh] overflow-y-auto pr-1">
            {summaryLoading ? (
              <div className="flex flex-col items-center justify-center space-y-4 py-8">
                <Loader2 className="h-8 w-8 text-emerald-600 animate-spin" />
                <p className="text-sm font-medium text-emerald-800">Sera programınızı diyetisyen gözüyle yorumluyor...</p>
              </div>
            ) : (
              <div className="text-[15px] text-gray-700 leading-relaxed space-y-4 whitespace-pre-wrap p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
                {summaryText}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setIsSummaryOpen(false)} className="bg-emerald-600 hover:bg-emerald-700">Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}


