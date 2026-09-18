'use client'

import { useState, useCallback, useEffect } from 'react'
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
} from 'lucide-react'

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
  clarification_needed?: boolean
  clarification_target?: any
  clarification_message?: string
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
}

// ─── Hasta-Dostu Örnek Promptlar ───
const SERA_EXAMPLE_PROMPTS = [
  'Akşamları kırmızı et olmasın',
  'Sabahları mutlaka yumurta olsun',
  'Süt ürünlerini azalt',
  'Her gün salata olsun',
  'Tahin yemem',
]

// ─── Kural Tipi Etiketleri (Hasta-Dostu) ───
const RULE_TYPE_LABELS_FRIENDLY: Record<string, string> = {
  frequency: 'Sıklık Tercihi',
  affinity: 'Yemek Uyumu',
  consistency: 'Tutarlılık',
  fixed_meal: 'Sabit Öğün',
  nutritional: 'Besin Dengesi',
  rotation: 'Çeşitlilik',
  or_group: 'Alternatifler',
}

// ─── Sera Bileşeni ───
export function SeraAssistant({
  patientId,
  patientName,
  teamOwnerId,
  programTemplateId,
  onRuleCreated,
  requireApproval,
}: SeraAssistantProps) {
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

  // Faz 3 & 5 States
  const [patientRules, setPatientRules] = useState<any[]>([])
  const [affectedFoods, setAffectedFoods] = useState<AffectedFood[]>([])
  const [selectedExceptions, setSelectedExceptions] = useState<string[]>([])
  const [isFetchingFoods, setIsFetchingFoods] = useState(false)

  // Faz 6 States
  const [simulationReport, setSimulationReport] = useState<string | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)

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
    try {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase
        .from('planning_rules')
        .select('*')
        .eq('scope', 'patient')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
      
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

    try {
      const response = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: activePrompt,
          scope: 'patient',
          patient_id: patientId,
          program_template_id: programTemplateId || undefined,
          team_owner_id: teamOwnerId || undefined,
        }),
      })

      const data = await response.json()

      if (!data.success) {
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
          scope: 'patient',
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
    const replacedIds = Array.from(new Set([
      (rule as any).replaces_rule_id,
      ...(aiResult.additional_rules || []).map((r: any) => r.replaces_rule_id),
      ...(aiResult.conflicts || []).map((c: any) => c.existing_rule_id)
    ].filter(Boolean)))

    const mealUpdateSlots: any[] = []

    // Ana Kural
    const finalDefinition = { ...rule.definition }
    if (finalDefinition.target && selectedExceptions.length > 0) {
      finalDefinition.target.exceptions = selectedExceptions
    }

    if (rule.rule_type === 'update_meal_settings') {
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
        scope: 'patient',
        patient_id: patientId || null,
        program_template_id: programTemplateId || null,
        team_owner_id: teamOwnerId || null,
        pending_global_approval: requireApproval,
      })
    }

    // Ek Kurallar
    if (aiResult.additional_rules && aiResult.additional_rules.length > 0) {
      for (const ar of aiResult.additional_rules) {
        if (ar.rule_type === 'update_meal_settings') {
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
            scope: 'patient',
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
                scope: 'patient',
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
      if (addRule.rule_type === 'update_meal_settings' && slotsToUpdate && patientId) {
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
        const ruleData = {
          name: addRule.name,
          description: addRule.description,
          rule_type: addRule.rule_type,
          priority: addRule.priority,
          is_active: !requireApproval,
          definition: { 
            ...addRule.definition, 
            _source: 'sera_assistant',
            _replaced_ids: addRule.replaces_rule_id ? [addRule.replaces_rule_id] : []
          },
          scope: 'patient',
          patient_id: patientId || null,
          program_template_id: programTemplateId || null,
          team_owner_id: teamOwnerId || null,
          pending_global_approval: requireApproval,
        }
        
        const { supabase } = await import('@/lib/supabase')
        const { error } = await supabase.from('planning_rules').insert(ruleData)
        if (error) throw error
        
        // Eğer Diyetisyen kendi ekliyorsa (direkt aktif oluyorsa), çelişenleri HEMEN ez/pause yap!
        if (!requireApproval && addRule.replaces_rule_id) {
          const { data: replacedRules } = await supabase.from('planning_rules').select('*').eq('id', addRule.replaces_rule_id)
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
                  scope: 'patient',
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
      
      setAiResult(prev => {
        if (!prev) return prev
        const newAdditional = [...(prev.additional_rules || [])]
        newAdditional.splice(index, 1)
        
        // If everything is saved, we can optionally clear the whole result
        // But for now just remove the saved rule from the list
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
              <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <p className="text-sm text-emerald-700">{successMessage}</p>
              </div>
            )}

            {/* Mesaj Kutusu */}
            {!successMessage && (
              <>
                <div className="flex gap-2">
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Bana ne tür yemekleri sevmediğini veya hangi tercihlerin olduğunu yaz..."
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

                {/* Örnek İpuçları */}
                {!aiResult && !error && !isLoading && (
                  <div className="flex flex-wrap gap-1.5">
                    {SERA_EXAMPLE_PROMPTS.slice(0, 3).map((example, i) => (
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
                      <div className="p-3 bg-white border border-emerald-200 rounded-lg space-y-2">
                        <p className="text-sm text-gray-600 leading-relaxed">
                          {aiResult.explanation}
                        </p>
                      </div>

                      {/* Hazırlanan Tercihler (Paket) */}
                      <div className="space-y-2 pt-3 mt-3">
                        <p className="text-sm font-medium text-emerald-800 mb-2 flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Onayınıza Sunulan Tercihler:
                        </p>
                        {[aiResult.rule, ...(aiResult.additional_rules || [])].map((ruleObj, idx) => (
                           <div key={idx} className="bg-emerald-50/50 p-2.5 rounded-lg border border-emerald-100 flex items-center justify-between gap-3 shadow-sm">
                             <div>
                               <p className="text-sm font-medium text-gray-800">{ruleObj.name}</p>
                               <p className="text-[11px] text-gray-500 line-clamp-1">{ruleObj.description}</p>
                             </div>
                             <div className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 shrink-0 bg-emerald-100/50 px-2 py-1 rounded-md">
                               <CheckCircle2 className="h-3 w-3" />
                               Pakete Dahil
                             </div>
                           </div>
                        ))}
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

                        {/* Simülasyon Raporu (Faz 6) */}
                        {isSimulating ? (
                          <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg space-y-2 mt-3 flex flex-col items-center justify-center py-4 shadow-sm">
                            <Loader2 className="h-5 w-5 text-blue-500 animate-spin mb-2" />
                            <p className="text-xs font-medium text-blue-800">Sistem Olası Makro ve Lezzet Etkilerini Hesaplıyor...</p>
                          </div>
                        ) : simulationReport ? (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2 mt-3 shadow-sm">
                            <p className="text-sm font-semibold text-blue-900 flex items-center gap-1.5">
                              <Activity className="h-4 w-4 text-blue-600" />
                              Kuralınızın Olası Etkileri
                            </p>
                            <div className="text-xs text-blue-800 leading-relaxed whitespace-pre-wrap">
                              {simulationReport}
                            </div>
                          </div>
                        ) : null}

                        {/* Aksiyon Butonları & Düzeltme Alanı */}
                        <div className="pt-2 border-t border-emerald-100 space-y-3">
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
                              placeholder="Ekleme veya düzeltme yapmak isterseniz yazın... (Örn: Yoğurdu da ekleyelim)"
                              className="min-h-[44px] max-h-[100px] text-sm resize-none bg-emerald-50/30 border-emerald-200 focus-visible:ring-emerald-400"
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

                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              onClick={handleSaveDirectly}
                              disabled={isLoading}
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              {isLoading ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              {requireApproval 
                                ? (aiResult.additional_rules && aiResult.additional_rules.length > 0 ? 'Tüm Tercihleri Kaydet' : 'Bu Tercihi Kaydet') 
                                : (aiResult.additional_rules && aiResult.additional_rules.length > 0 ? 'Tüm Tercihleri Uygula' : 'Bu Tercihi Uygula')}
                            </Button>
                            <Button
                              onClick={() => { setAiResult(null); setPrompt('') }}
                              disabled={isLoading}
                              variant="outline"
                              size="sm"
                              className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            >
                              Vazgeç (İptal)
                            </Button>
                          </div>
                          {requireApproval && (
                            <p className="text-xs text-amber-600 mt-1.5">
                              🌿 Tercihiniz diyetisyeninizin onayına sunulacaktır.
                            </p>
                          )}
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

      {/* ── Beslenme Tercihlerim (Faz 5) ── */}
      {patientRules.length > 0 && (
        <div className="mt-6 border border-emerald-100 bg-white rounded-xl overflow-hidden shadow-sm">
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
              if (a.is_active === b.is_active) {
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              }
              return a.is_active ? -1 : 1
            }).map((rule) => (
              <div key={rule.id} className="p-4 flex items-start justify-between gap-4 hover:bg-emerald-50/30 transition-colors">
                <div className="flex-1">
                  <details className="group">
                    <summary className="list-none cursor-pointer flex flex-col gap-1.5 focus:outline-none">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[13px] text-gray-800 leading-snug pr-2">{generateRuleSentence(rule)}</span>
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


