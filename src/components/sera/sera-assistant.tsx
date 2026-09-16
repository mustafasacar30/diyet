'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { PlanningRule } from '@/types/planner'
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
} from 'lucide-react'

// ─── Interfaces ───
interface ConflictInfo {
  severity: 'error' | 'warning' | 'info'
  icon: '🔴' | '🟡' | '🔵'
  existing_rule_name: string
  existing_rule_id: string
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
  explanation: string
  conflicts: ConflictInfo[]
  suggestions: string[]
  affected_foods?: AffectedFood[]
  // Clarification fields
  question?: string
  options?: string[]
  show_food_list?: boolean
  food_search_query?: string
  context?: any
}

interface AffectedFood {
  food_id: string
  food_name: string
  category: string
  role: string
  tags: string[]
}

interface SeraAssistantProps {
  patientId: string
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
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [prefillData, setPrefillData] = useState<PlanningRule | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // ─── Sera'ya Mesaj Gönder ───
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || prompt.trim().length < 3) return

    setIsLoading(true)
    setError(null)
    setAiResult(null)
    setSuccessMessage(null)

    try {
      const response = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
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
    } catch (err: any) {
      setError(err.message || 'Bağlantı hatası. Lütfen internet bağlantınızı kontrol edin.')
    } finally {
      setIsLoading(false)
    }
  }, [prompt, patientId, programTemplateId, teamOwnerId])

  // ─── Kuralı Direkt Kaydet ───
  const handleSaveDirectly = useCallback(async () => {
    if (!aiResult?.rule) return
    setIsLoading(true)

    const rule = aiResult.rule
    const ruleData = {
      name: rule.name,
      description: rule.description,
      rule_type: rule.rule_type,
      priority: rule.priority,
      is_active: !requireApproval, // Onay gerekiyorsa pasif başlar
      definition: rule.definition,
      scope: 'patient',
      patient_id: patientId || null,
      program_template_id: programTemplateId || null,
      team_owner_id: teamOwnerId || null,
      pending_global_approval: requireApproval,
    }

    try {
      const { supabase } = await import('@/lib/supabase')
      const { error } = await supabase.from('planning_rules').insert(ruleData)
      if (error) throw error

      setAiResult(null)
      setPrompt('')
      if (requireApproval) {
        setSuccessMessage('Tercihiniz kaydedildi ve diyetisyeninizin onayına sunuldu 🌿')
      } else {
        setSuccessMessage('Tercihiniz kaydedildi ve hemen uygulandı 🌿')
      }
      onRuleCreated()
    } catch (err: any) {
      setError(err.message || 'Kayıt sırasında bir hata oluştu.')
    } finally {
      setIsLoading(false)
    }
  }, [aiResult, patientId, programTemplateId, teamOwnerId, requireApproval, onRuleCreated])

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
                    onClick={handleGenerate}
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
                    {/* Tercih Özeti */}
                    <div className="p-3 bg-white border border-emerald-200 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <span className="font-medium text-sm">{aiResult.rule.name}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-600">
                          {RULE_TYPE_LABELS_FRIENDLY[aiResult.rule.rule_type] || aiResult.rule.rule_type}
                        </Badge>
                      </div>

                      {/* Açıklama */}
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {aiResult.explanation}
                      </p>
                    </div>

                    {/* Çakışma Uyarıları */}
                    {aiResult.conflicts.length > 0 && (
                      <div className="space-y-1.5">
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
                      </div>
                    )}

                    {/* Öneriler */}
                    {aiResult.suggestions.length > 0 && (
                      <div className="space-y-1">
                        {aiResult.suggestions.map((suggestion, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm text-emerald-700">
                            <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>{suggestion}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Aksiyon Butonları */}
                    <div>
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
                            <Leaf className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          {requireApproval ? 'Tercihini Kaydet' : 'Hemen Uygula'}
                        </Button>
                        <Button
                          onClick={() => { setAiResult(null); setPrompt('') }}
                          disabled={isLoading}
                          variant="outline"
                          size="sm"
                          className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        >
                          İptal
                        </Button>
                      </div>
                      {requireApproval && (
                        <p className="text-xs text-amber-600 mt-1.5">
                          🌿 Tercihiniz diyetisyeninizin onayına sunulacaktır.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
