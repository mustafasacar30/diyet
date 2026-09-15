'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RuleDialog } from './rule-dialog'
import { PlanningRule } from '@/types/planner'
import {
  Sparkles,
  Send,
  Loader2,
  AlertTriangle,
  Info,
  XCircle,
  CheckCircle2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

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
}

interface AIRuleAssistantProps {
  scope: 'global' | 'team' | 'program' | 'patient'
  patientId?: string | null
  programTemplateId?: string | null
  teamOwnerId?: string | null
  onRuleCreated: () => void
  onScopeChange?: (scope: string) => void
  showScopeSelector?: boolean
  isPatientSelfService?: boolean
  patientName?: string
}

const RULE_TYPE_LABELS: Record<string, string> = {
  frequency: 'Sıklık / Limit',
  affinity: 'Uyum / Zıtlık',
  consistency: 'Tutarlılık Kilidi',
  fixed_meal: 'Sabit Öğün',
  nutritional: 'Makro Koşulu',
  rotation: 'Rotasyon',
  or_group: 'VEYA Grubu',
}

const SCOPE_LABELS: Record<string, string> = {
  global: 'Global',
  team: 'Takım',
  program: 'Program',
  patient: 'Hasta',
}

const EXAMPLE_PROMPTS = [
  'Muffin varsa ekmek olmasın',
  'İsminde sucuk geçenleri hafta içi verme',
  'Her kahvaltıda mutlaka yumurta olsun',
  'Seçilen çorba hafta boyunca aynı kalsın',
  'Enginar haftada en fazla 2 kez olsun',
]

const PATIENT_EXAMPLE_PROMPTS = [
  'Akşamları kırmızı et olmasın',
  'Sabahları mutlaka yumurta olsun',
  'Hafta sonları tatlı yiyebileyim',
  'Süt ürünlerini azalt',
  'Her gün salata olsun',
]

export function AIRuleAssistant({
  scope: initialScope,
  patientId,
  programTemplateId,
  teamOwnerId,
  onRuleCreated,
  onScopeChange,
  showScopeSelector = false,
  isPatientSelfService = false,
  patientName,
}: AIRuleAssistantProps) {
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [aiResult, setAiResult] = useState<GenerateRuleResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [prefillData, setPrefillData] = useState<PlanningRule | null>(null)
  const [scope, setScope] = useState(initialScope)

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || prompt.trim().length < 3) return

    setIsLoading(true)
    setError(null)
    setAiResult(null)

    try {
      const response = await fetch('/api/ai/generate-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          scope,
          patient_id: scope === 'patient' ? patientId : undefined,
          program_template_id: scope === 'program' ? programTemplateId : undefined,
          team_owner_id: teamOwnerId || undefined,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        setError(data.error || 'Bilinmeyen bir hata oluştu.')
        return
      }

      setAiResult(data)
    } catch (err: any) {
      setError(err.message || 'Bağlantı hatası.')
    } finally {
      setIsLoading(false)
    }
  }, [prompt, scope, patientId, programTemplateId, teamOwnerId])

  const handleOpenRuleDialog = useCallback(() => {
    if (!aiResult?.rule) return

    const rule = aiResult.rule
    setPrefillData({
      id: '',
      name: rule.name,
      description: rule.description,
      rule_type: rule.rule_type as any,
      priority: rule.priority,
      is_active: true,
      definition: rule.definition,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      scope,
      patient_id: scope === 'patient' ? (patientId || undefined) : undefined,
      program_template_id: scope === 'program' ? (programTemplateId || undefined) : undefined,
      team_owner_id: teamOwnerId || undefined,
    } as any)
    setRuleDialogOpen(true)
  }, [aiResult, scope, patientId, programTemplateId, teamOwnerId])

  const handleRuleDialogSuccess = useCallback(() => {
    setRuleDialogOpen(false)
    setPrefillData(null)
    setAiResult(null)
    setPrompt('')
    setIsExpanded(false)
    onRuleCreated()
  }, [onRuleCreated])

  const handleScopeChange = useCallback((newScope: string) => {
    setScope(newScope as any)
    onScopeChange?.(newScope)
  }, [onScopeChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }, [handleGenerate])

  return (
    <>
      {/* ── Ana Bileşen ── */}
      <div className="border border-purple-200 bg-gradient-to-r from-purple-50/50 to-indigo-50/50 rounded-xl overflow-hidden">
        {/* Başlık Çubuğu */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-purple-50/80 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-medium text-purple-700">
              AI Kural Asistanı
            </span>
            <Badge variant="outline" className="text-[10px] border-purple-200 text-purple-500 px-1.5 py-0">
              Beta
            </Badge>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-purple-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-purple-400" />
          )}
        </button>

        {/* Genişletilmiş İçerik */}
        {isExpanded && (
          <div className="px-4 pb-4 space-y-3">
            {/* Kapsam Seçici (opsiyonel) */}
            {showScopeSelector && !isPatientSelfService && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Kapsam:</span>
                <Select value={scope} onValueChange={handleScopeChange}>
                  <SelectTrigger className="h-7 w-[120px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">🌍 Global</SelectItem>
                    <SelectItem value="team">👥 Takım</SelectItem>
                    {programTemplateId && (
                      <SelectItem value="program">📋 Program</SelectItem>
                    )}
                    {patientId && (
                      <SelectItem value="patient">🧑 Hasta</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Prompt Kutusu */}
            <div className="flex gap-2">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Doğal dilde kural isteğinizi yazın... Örn: 'Muffin varsa ekmek olmasın'"
                className="min-h-[40px] max-h-[100px] text-sm resize-none bg-white"
                rows={1}
                disabled={isLoading}
              />
              <Button
                onClick={handleGenerate}
                disabled={isLoading || prompt.trim().length < 3}
                size="sm"
                className="bg-purple-600 hover:bg-purple-700 text-white px-3 shrink-0 self-end"
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
                {(isPatientSelfService ? PATIENT_EXAMPLE_PROMPTS : EXAMPLE_PROMPTS).slice(0, 3).map((example, i) => (
                  <button
                    key={i}
                    onClick={() => setPrompt(example)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-purple-200 text-purple-600 hover:bg-purple-100 transition-colors cursor-pointer"
                  >
                    &ldquo;{example}&rdquo;
                  </button>
                ))}
              </div>
            )}

            {/* Yükleniyor */}
            {isLoading && (
              <div className="flex items-center gap-2 py-3 justify-center text-purple-600">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Kural analiz ediliyor ve oluşturuluyor...</span>
              </div>
            )}

            {/* Hata */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* ── AI Sonuç Kartı ── */}
            {aiResult && (
              <div className="space-y-3">
                {/* Kural Özeti */}
                <div className="p-3 bg-white border border-purple-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="font-medium text-sm">{aiResult.rule.name}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {RULE_TYPE_LABELS[aiResult.rule.rule_type] || aiResult.rule.rule_type}
                    </Badge>
                  </div>

                  {/* Açıklama */}
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {aiResult.explanation}
                  </p>

                  {/* Kapsam */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400">Kapsam:</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        scope === 'patient' ? 'border-amber-300 text-amber-600' :
                        scope === 'program' ? 'border-indigo-300 text-indigo-600' :
                        scope === 'team' ? 'border-purple-300 text-purple-600' :
                        'border-blue-300 text-blue-600'
                      }`}
                    >
                      {SCOPE_LABELS[scope]}
                    </Badge>
                    <span className="text-[10px] text-gray-400 ml-2">Öncelik:</span>
                    <Badge variant="outline" className="text-[10px]">
                      {aiResult.rule.priority}
                    </Badge>
                  </div>
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
                      <div key={i} className="flex items-start gap-2 text-sm text-purple-600">
                        <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span>{suggestion}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Aksiyon Butonları */}
                <div>
                  <div className="flex items-center gap-2 pt-1">
                    {isPatientSelfService ? (
                      <Button
                        onClick={handleOpenRuleDialog}
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <span>🔔 Onay İçin Kaydet</span>
                      </Button>
                    ) : (
                      <Button
                        onClick={handleOpenRuleDialog}
                        size="sm"
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                        Kuralı Düzenle ve Kaydet
                      </Button>
                    )}
                    <Button
                      onClick={() => { setAiResult(null); setPrompt('') }}
                      variant="outline"
                      size="sm"
                    >
                      İptal
                    </Button>
                  </div>
                  {isPatientSelfService && (
                    <p className="text-xs text-amber-600 mt-1">💡 Kuralınız diyetisyeninizin onayına sunulacaktır.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Prefilled RuleDialog ── */}
      <RuleDialog
        open={ruleDialogOpen}
        onOpenChange={(open) => {
          setRuleDialogOpen(open)
          if (!open) setPrefillData(null)
        }}
        initialData={null}
        prefillData={prefillData}
        onSuccess={handleRuleDialogSuccess}
        patientId={scope === 'patient' ? (patientId || undefined) : undefined}
        programTemplateId={scope === 'program' ? (programTemplateId || undefined) : undefined}
        teamOwnerId={teamOwnerId || undefined}
      />
    </>
  )
}
