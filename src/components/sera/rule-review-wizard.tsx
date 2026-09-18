
"use client"

import { useState, useEffect } from "react"
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
import { Loader2, Save, Trash2, AlertTriangle, ArrowRight, ArrowLeft } from "lucide-react"

export interface RuleReviewWizardProps {
  isOpen: boolean
  onClose: () => void
  rules: any[]
  onRuleUpdated: (ruleId: string, newDefinition: any) => Promise<void>
  onRuleDeleted: (ruleId: string) => Promise<void>
  onRuleCloned?: (rule: any, newDefinition: any) => Promise<void>
}

// ----------------- Helpers -----------------
const generateRangeOptions = (max: number) => {
  const options = [];
  for (let i = 1; i <= max; i++) {
    options.push({ value: `${i}-${i}`, label: `${i}` });
    if (i < max) {
      options.push({ value: `${i}-${i+1}`, label: `${i} - ${i+1}` });
    }
  }
  return options;
}

// ----------------- Rule Renderers -----------------

function FrequencyRuleEditor({ rule, lockedMeals, draft, onChange, onAlertCheck }: { rule: any, lockedMeals: string[], draft: any, onChange: (d: any) => void, onAlertCheck: (v: boolean) => void }) {
  const def = rule.definition?.data || rule.definition || {}
  const period = def.period || 'weekly'
  const isDaily = period === 'daily'
  const isPerMeal = period === 'per_meal'
  const isWeekly = period === 'weekly'
  
  const ruleMinCount = def.min_count || def.frequency || 1
  const ruleMaxCount = def.max_count || ruleMinCount
  
  let initDaysMin = "7";
  let initDaysMax = "same";
  
  if (draft?.daysCount) {
    const parts = draft.daysCount.split('-');
    initDaysMin = parts[0];
    initDaysMax = parts[1] === parts[0] ? "same" : (parts[1] || "same");
  } else if (def.random_day_count) {
    initDaysMin = def.random_day_count.toString();
    initDaysMax = "same";
  } else if (def.scope_days) {
    initDaysMin = def.scope_days.length.toString();
    initDaysMax = "same";
  } else if (isWeekly) {
    initDaysMin = ruleMinCount.toString();
    initDaysMax = ruleMaxCount === ruleMinCount ? "same" : ruleMaxCount.toString();
  }
  
  let initOccMin = "1";
  let initOccMax = "same";
  
  if (draft?.occurrences) {
    const parts = draft.occurrences.split('-');
    initOccMin = parts[0];
    initOccMax = parts[1] === parts[0] ? "same" : (parts[1] || "same");
  } else if (!isWeekly) {
    initOccMin = ruleMinCount.toString();
    initOccMax = ruleMaxCount === ruleMinCount ? "same" : ruleMaxCount.toString();
  }
  
  const [minDays, setMinDays] = useState<string>(initDaysMin)
  const [maxDays, setMaxDays] = useState<string>(initDaysMax)
  const [minOcc, setMinOcc] = useState<string>(initOccMin)
  const [maxOcc, setMaxOcc] = useState<string>(initOccMax)
  const [dailyMax, setDailyMax] = useState<string>(draft?.dailyMax || (def.daily_max_limit?.toString() || "0"))
  const [forceInclusion, setForceInclusion] = useState<boolean>(draft?.forceInclusion ?? def.force_inclusion ?? false)
  const [selectedMeals, setSelectedMeals] = useState<string[]>(draft?.selectedMeals || def.scope_meals || def.scopes || [])

  // Auto-correct ranges if min > max
  useEffect(() => {
    if (maxDays !== "same" && parseInt(minDays) > parseInt(maxDays)) {
      setMaxDays("same");
    }
  }, [minDays]);
  
  useEffect(() => {
    if (maxOcc !== "same" && parseInt(minOcc) > parseInt(maxOcc)) {
      setMaxOcc("same");
    }
  }, [minOcc]);

  useEffect(() => {
    const dMax = maxDays === "same" ? parseInt(minDays) : parseInt(maxDays)
    if (dMax >= 5 && selectedMeals.length >= 3 && dailyMax === "0") {
      onAlertCheck(true)
    } else {
      onAlertCheck(false)
    }

    onChange({
      type: 'frequency',
      daysCount: `${minDays}-${maxDays === "same" ? minDays : maxDays}`,
      occurrences: `${minOcc}-${maxOcc === "same" ? minOcc : maxOcc}`,
      dailyMax,
      selectedMeals,
      forceInclusion
    })
  }, [minDays, maxDays, minOcc, maxOcc, dailyMax, selectedMeals, forceInclusion])

  const toggleMeal = (meal: string) => {
    if (lockedMeals.includes(meal)) return;
    setSelectedMeals(prev => prev.includes(meal) ? prev.filter(m => m !== meal) : [...prev, meal])
  }

  const mealOptions = ["KAHVALTI", "ÖĞLEN", "AKŞAM", "ARA ÖĞÜN"]
  const daysOptions = [1, 2, 3, 4, 5, 6, 7];
  const occOptions = [1, 2, 3, 4, 5];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 justify-center flex-wrap">
        
        <div className="flex flex-col items-center gap-2">
          <span className="text-[15px] text-gray-700">Bu tercih menünüzde <strong>haftada</strong></span>
          <div className="flex items-center gap-2">
            <Select value={minDays} onValueChange={setMinDays}>
              <SelectTrigger className="w-[70px] h-9 bg-white border-emerald-200 text-emerald-800 font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {daysOptions.map(num => (
                  <SelectItem key={num} value={num.toString()}>{num}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-gray-500 font-medium">-</span>
            <Select value={maxDays} onValueChange={setMaxDays}>
              <SelectTrigger className="w-[100px] h-9 bg-white border-emerald-200 text-emerald-800 font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same">Sabit</SelectItem>
                {daysOptions.map(num => (
                  <SelectItem key={num} value={num.toString()} disabled={num <= parseInt(minDays)}>{num}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[15px] text-gray-700">gün</span>
          </div>
        </div>
        
        {(isDaily || isPerMeal) && (
          <div className="flex flex-col items-center gap-2">
            <span className="text-[15px] text-gray-700">{isDaily ? "günde (toplam)" : "her öğünde"}</span>
            <div className="flex items-center gap-2">
              <Select value={minOcc} onValueChange={setMinOcc}>
                <SelectTrigger className="w-[70px] h-9 bg-white border-emerald-200 text-emerald-800 font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {occOptions.map(num => (
                    <SelectItem key={num} value={num.toString()}>{num}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-gray-500 font-medium">-</span>
              <Select value={maxOcc} onValueChange={setMaxOcc}>
                <SelectTrigger className="w-[100px] h-9 bg-white border-emerald-200 text-emerald-800 font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="same">Sabit</SelectItem>
                  {occOptions.map(num => (
                    <SelectItem key={num} value={num.toString()} disabled={num <= parseInt(minOcc)}>{num}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[15px] text-gray-700">kez yer alacaktır.</span>
            </div>
          </div>
        )}
        {isWeekly && <span className="text-[15px] text-gray-700 mt-1">yer alacaktır.</span>}
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-emerald-100">
        <span className="text-[14px] text-gray-700 font-medium mb-1">Hangi öğünlerde çıkmasını istersiniz?</span>
        <div className="grid grid-cols-2 gap-3">
          {mealOptions.map(meal => {
            const isLocked = lockedMeals.includes(meal)
            const isChecked = selectedMeals.includes(meal) || isLocked
            const bgClass = isLocked ? 'bg-gray-100 border-gray-200 opacity-60 cursor-not-allowed' : 'bg-white hover:bg-emerald-50 border-emerald-100 cursor-pointer'
            return (
              <div 
                key={meal} 
                className={`flex items-center space-x-2 border rounded-lg p-3 transition-colors ${bgClass}`}
                onClick={() => !isLocked && toggleMeal(meal)}
              >
                <Checkbox 
                  id={meal} 
                  checked={isChecked} 
                  disabled={isLocked}
                  className={isLocked ? 'data-[state=checked]:bg-gray-400 border-gray-300' : 'data-[state=checked]:bg-emerald-600'}
                />
                <div className="grid gap-1 leading-none cursor-pointer">
                  <Label htmlFor={meal} className="text-sm font-medium cursor-pointer">
                    {meal.replace("ÖĞLEN", "Öğlen").replace("AKŞAM", "Akşam").replace("ARA ÖĞÜN", "Ara Öğün").replace("KAHVALTI", "Kahvaltı")}
                  </Label>
                  {isLocked && <p className="text-[10px] text-gray-500">Rezerve (Sabit)</p>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-emerald-100">
        <div className="flex items-center justify-between">
          <span className="text-[14px] text-gray-700 font-medium">Aynı gün içinde maksimum:</span>
          <Select value={dailyMax} onValueChange={setDailyMax}>
            <SelectTrigger className="w-[120px] h-9 bg-white border-emerald-200 text-emerald-800 font-bold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Sınır Yok</SelectItem>
              <SelectItem value="1">Sadece 1 kez</SelectItem>
              <SelectItem value="2">En fazla 2 kez</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2 pt-4 border-t border-emerald-100">
        <div className="flex items-start space-x-3 bg-orange-50/50 p-3 rounded-lg border border-orange-100">
          <Checkbox 
            id="force_inc" 
            checked={forceInclusion} 
            onCheckedChange={(c) => setForceInclusion(c === true)}
            className="mt-1 data-[state=checked]:bg-orange-500 border-orange-300"
          />
          <div className="grid gap-1.5 leading-none cursor-pointer">
            <Label htmlFor="force_inc" className="text-sm font-bold text-orange-900 cursor-pointer">
              Kesinlikle Uygula (Zorunlu Kıl)
            </Label>
            <p className="text-[11px] text-orange-700 leading-relaxed">
              Kalori limitleri aşılsa veya toleranslar dolsa bile, bu yiyeceği menüye <b>zorla</b> ekler. <br/>Sadece diyetisyen onaylı veya çok kritik tercihler için işaretleyin.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function AffinityRuleEditor({ rule, draft, onChange, onAlertCheck }: { rule: any, draft: any, onChange: (d: any) => void, onAlertCheck: (v: boolean) => void }) {
  const def = rule.definition?.data || rule.definition || {}
  
  const [association, setAssociation] = useState<string>(draft?.association || def.association || "boost")
  
  useEffect(() => {
    onAlertCheck(false)
    onChange({
      type: 'affinity',
      association
    })
  }, [association])

  return (
    <div className="flex flex-col gap-4 py-4 px-2">
      <div className="bg-emerald-50 text-emerald-800 p-4 rounded-lg text-sm mb-2 text-center border border-emerald-100">
        Bu tercih, <strong>Eşlik Etme (Birliktelik)</strong> kuralıdır. Bir yiyecek veya özellik menüde yer aldığında, belirtilen hedefin de eklenmesini tetikler.
      </div>
      
      <div className="flex flex-col gap-2">
        <span className="text-[14px] text-gray-700 font-medium">Birliktelik Koşulu:</span>
        <Select value={association} onValueChange={setAssociation}>
          <SelectTrigger className="w-full h-10 bg-white border-emerald-200 text-emerald-800 font-bold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mandatory">Zorunlu Birliktelik (Mutlaka eklensin)</SelectItem>
            <SelectItem value="boost">Teşvik Et (Eklenmesi desteklensin)</SelectItem>
            <SelectItem value="forbidden">Zıtlık / Yasak (Kesinlikle eklenmesin)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function NutritionalRuleEditor({ rule, draft, onChange, onAlertCheck }: { rule: any, draft: any, onChange: (d: any) => void, onAlertCheck: (v: boolean) => void }) {
  const def = rule.definition?.data || rule.definition || {}
  
  const [urgency, setUrgency] = useState<string>(draft?.urgency || "normal")
  
  useEffect(() => {
    onAlertCheck(false)
    onChange({
      type: 'nutritional',
      urgency 
    })
  }, [urgency])

  return (
    <div className="flex flex-col gap-4 py-4 px-2">
      <div className="bg-emerald-50 text-emerald-800 p-4 rounded-lg text-sm mb-2 text-center border border-emerald-100">
        Bu tercih, <strong>Besin Değeri (Nutritional)</strong> destek kuralıdır. Günlük protein, kalori veya vitamin hedefleriniz eksik kaldığında, sistemin bu yiyeceği otomatik eklemesini sağlar.
      </div>
      
      <div className="flex flex-col gap-2">
        <span className="text-[14px] text-gray-700 font-medium">Ekleme Hassasiyeti:</span>
        <Select value={urgency} onValueChange={setUrgency}>
          <SelectTrigger className="w-full h-10 bg-white border-emerald-200 text-emerald-800 font-bold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Standart Telafi (Hedef 20% saparsa)</SelectItem>
            <SelectItem value="high">Katı Hedefleme (Hedef 5% saparsa)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function ConsistencyRuleEditor({ rule, draft, onChange, onAlertCheck }: { rule: any, draft: any, onChange: (d: any) => void, onAlertCheck: (v: boolean) => void }) {
  const def = rule.definition?.data || rule.definition || {}
  
  const [lockDuration, setLockDuration] = useState<string>(draft?.lockDuration || def.lock_duration || "weekly")
  
  useEffect(() => {
    onAlertCheck(false)
    onChange({
      type: 'consistency',
      lockDuration
    })
  }, [lockDuration])

  return (
    <div className="flex flex-col gap-4 py-4 px-2">
      <div className="bg-emerald-50 text-emerald-800 p-4 rounded-lg text-sm mb-2 text-center border border-emerald-100">
        Bu tercih, <strong>Sabitleme (Tutarlılık)</strong> kuralıdır. Seçilen yemeğin sürekli değişmesi yerine, belirli bir süre boyunca aynı kalmasını (kilitlenmesini) sağlar.
      </div>
      
      <div className="flex flex-col gap-2">
        <span className="text-[14px] text-gray-700 font-medium">Sabitlenme Süresi (Kilit):</span>
        <Select value={lockDuration} onValueChange={setLockDuration}>
          <SelectTrigger className="w-full h-10 bg-white border-emerald-200 text-emerald-800 font-bold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Hafta Boyunca Sabit (Pzt-Paz aynı kalsın)</SelectItem>
            <SelectItem value="daily">Gün Boyunca Sabit (Aynı gün öğünlerde değişmesin)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function ReadOnlyRuleViewer({ rule, draft, onChange }: { rule: any, draft: any, onChange: (d: any) => void }) {
  useEffect(() => {
    onChange({ type: 'readonly' })
  }, [])

  return (
    <div className="flex flex-col gap-4 text-center py-6 px-2">
      <div className="mx-auto bg-gray-100 p-3 rounded-full mb-2">
        <AlertTriangle className="h-8 w-8 text-gray-600" />
      </div>
      <h3 className="text-lg font-bold text-gray-800">Özel Kural Tipi: {rule.rule_type}</h3>
      <p className="text-sm text-gray-600 leading-relaxed">
        Bu kural (örneğin Fixed Meal veya Rotation), oldukça kompleks bir yapıya sahip. 
        Sihirbaz üzerinden doğrudan ayarlarını bozmamak için sadece okuma modunda görüntülenmektedir.
        <br/><br/>
        Dilerseniz bu kuralı <strong>Atla (Aynen Kalsın)</strong> diyerek geçebilir veya <strong>Sil</strong> butonuna tıklayarak tamamen iptal edebilirsiniz.
      </p>
    </div>
  )
}

// ----------------- Main Component -----------------

export function RuleReviewWizard({ isOpen, onClose, rules, onRuleUpdated, onRuleDeleted, onRuleCloned }: RuleReviewWizardProps) {
  
  const [activeRules, setActiveRules] = useState<any[]>([])
  const [isStarted, setIsStarted] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  
  const [drafts, setDrafts] = useState<Record<string, any>>({})
  const [currentDraftData, setCurrentDraftData] = useState<any>(null)
  const [hasAlert, setHasAlert] = useState(false)
  const [forceBypassAlert, setForceBypassAlert] = useState(false)

  const lockedMeals = rules
    .filter(r => r.is_active && (r.rule_type === 'consistency' || r.description?.toLowerCase().includes('sabit')))
    .flatMap(r => {
      const meals = r.definition?.scope_meals || r.definition?.data?.scope_meals || []
      if (meals.length === 0 && (r.name?.toLowerCase().includes('sabah') || r.description?.toLowerCase().includes('sabah'))) {
        return ['KAHVALTI']
      }
      return meals
    })

  useEffect(() => {
    if (isOpen) {
      const fil = rules.filter(r => r.is_active && r.definition && r.rule_type !== 'lock')
      setActiveRules(fil)
      setCurrentStep(0)
      setIsStarted(false)
      setDrafts({})
      setCurrentDraftData(null)
      setHasAlert(false)
      setForceBypassAlert(false)
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
          <DialogFooter>
            <Button onClick={onClose}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const isLastStep = currentStep === activeRules.length - 1
  const isFinished = currentStep >= activeRules.length

  const handleApplyAllChanges = async () => {
    setIsSaving(true)
    try {
      for (const rule of activeRules) {
        const draft = drafts[rule.id]
        if (!draft || draft.action === 'skip') continue;

        if (draft.action === 'delete') {
          await onRuleDeleted(rule.id)
        } else if (draft.action === 'update' && draft.data) {
          const def = { ...(rule.definition?.data || rule.definition) }
          
          if (draft.data.type === 'frequency') {
            const pd = def.period || 'weekly'
            
            const [occMin, occMax] = draft.data.occurrences.split('-').map(Number)
            const [daysMin, daysMax] = draft.data.daysCount.split('-').map(Number)
            
            if (pd === 'weekly') {
               def.min_count = daysMin
               def.max_count = daysMax
               delete def.scope_days 
            } else {
               def.min_count = occMin
               def.max_count = occMax
               if (daysMax < 7) {
                  def.random_day_count = daysMax
               } else {
                  delete def.random_day_count
               }
            }
  
            if (draft.data.selectedMeals.length > 0) {
              def.scope_meals = draft.data.selectedMeals
            } else {
              delete def.scope_meals
            }
  
            if (draft.data.dailyMax !== "0") {
              def.daily_max_limit = parseInt(draft.data.dailyMax)
            } else {
              delete def.daily_max_limit
            }
            
            if (draft.data.forceInclusion) {
              def.force_inclusion = true
            } else {
              delete def.force_inclusion
            }
          } 
          else if (draft.data.type === 'affinity') {
            def.association = draft.data.association
          }
          else if (draft.data.type === 'consistency') {
            def.lock_duration = draft.data.lockDuration
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

  if (isFinished) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px] text-center">
          <DialogHeader>
            <DialogTitle className="text-center text-2xl text-emerald-700">Tebrikler! 🎉</DialogTitle>
            <DialogDescription className="text-center mt-4 text-base leading-relaxed">
              Tüm kuralları gözden geçirdiniz. Seçimleriniz kaydedilmeye hazır.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center mt-6 gap-3">
            <Button variant="outline" onClick={() => setCurrentStep(activeRules.length - 1)} disabled={isSaving}>Geri Dön</Button>
            <Button onClick={handleApplyAllChanges} disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Tüm Değişiklikleri Kaydet
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  if (!isStarted) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[450px] text-center p-8">
          <DialogHeader>
            <DialogTitle className="text-center text-2xl text-emerald-800 mb-2">Programınızı Gözden Geçirelim</DialogTitle>
            <DialogDescription className="text-center text-base leading-relaxed text-gray-600">
              Sizin için oluşturduğumuz beslenme tercihlerini adım adım gözden geçireceğiz. 
              Tüm kurallarınızı (sıklık, eşlik etme, sabitleme) tek tek düzenleyebilir veya istemediklerinizi silebilirsiniz.
              <br/><br/>Değişiklikleriniz ancak <strong>en son adımda kaydedilecektir</strong>, o zamana kadar istediğiniz gibi ileri-geri yapabilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center mt-8">
            <Button onClick={() => setIsStarted(true)} className="bg-emerald-600 hover:bg-emerald-700 w-full text-md h-12 shadow-md flex items-center gap-2">
              Sihirbaza Başla <ArrowRight className="w-5 h-5"/>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const currentRule = activeRules[currentStep]
  const currentDraftAction = drafts[currentRule.id]?.action
  const rt = currentRule.rule_type

  const handleNext = (action: 'update' | 'skip' | 'delete') => {
    if (action === 'update' && hasAlert && !forceBypassAlert) {
        setForceBypassAlert(true)
        return
    }
    setDrafts(prev => ({
        ...prev,
        [currentRule.id]: { action, data: currentDraftData }
    }))
    setForceBypassAlert(false)
    setCurrentStep(prev => prev + 1)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-emerald-800">Programı Gözden Geçir</DialogTitle>
            <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full border border-emerald-200">
              Adım {currentStep + 1} / {activeRules.length}
            </span>
          </div>
          <DialogDescription className="text-gray-600 pt-3 pb-3 border-b">
            <strong className="text-gray-900 block text-lg text-center mb-1">{currentRule.name}</strong>
            <span className="block text-center text-sm">{currentRule.description}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="py-2" key={currentRule.id}>
          <div className="bg-emerald-50/50 p-6 rounded-xl border border-emerald-100 shadow-sm flex flex-col gap-5 relative">
            
            {currentDraftAction && (
               <div className="absolute top-2 right-2 text-[10px] uppercase font-bold px-2 py-1 rounded bg-gray-200 text-gray-600">
                  {currentDraftAction === 'delete' ? 'Silinecek' : currentDraftAction === 'skip' ? 'Atlanacak' : 'Güncellenecek'}
               </div>
            )}

            {rt === 'frequency' && <FrequencyRuleEditor rule={currentRule} lockedMeals={lockedMeals} draft={drafts[currentRule.id]?.data} onChange={setCurrentDraftData} onAlertCheck={setHasAlert} />}
            {rt === 'affinity' && <AffinityRuleEditor rule={currentRule} draft={drafts[currentRule.id]?.data} onChange={setCurrentDraftData} onAlertCheck={setHasAlert} />}
            {rt === 'nutritional' && <NutritionalRuleEditor rule={currentRule} draft={drafts[currentRule.id]?.data} onChange={setCurrentDraftData} onAlertCheck={setHasAlert} />}
            {rt === 'consistency' && <ConsistencyRuleEditor rule={currentRule} draft={drafts[currentRule.id]?.data} onChange={setCurrentDraftData} onAlertCheck={setHasAlert} />}
            {!['frequency','affinity','nutritional','consistency'].includes(rt) && <ReadOnlyRuleViewer rule={currentRule} draft={drafts[currentRule.id]?.data} onChange={setCurrentDraftData} />}

            {hasAlert && !forceBypassAlert && rt === 'frequency' && (
              <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                <div className="text-[12px] text-orange-800 leading-tight">
                  <strong>Emin misiniz?</strong> Seçtiğiniz yoğunluk hedeflerinizi zorlayabilir. Devam etmek için tekrar 'Güncelle & İlerle'ye basın.
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:justify-between items-center gap-2 mt-4">
          <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="icon" onClick={() => setCurrentStep(prev => Math.max(0, prev - 1))} disabled={currentStep === 0} className="w-10 h-10 shrink-0" title="Geri Dön">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleNext('delete')} disabled={!!currentRule.source_rule_id} className="w-full sm:w-auto opacity-90 hover:opacity-100 flex-1" title={currentRule.source_rule_id ? "Sistem kuralları silinemez (Aynen Kalsın diyerek atlayın)" : "Tercihi Sil"}>
                <Trash2 className="h-4 w-4 mr-1" />
                Sil
              </Button>
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" size="sm" onClick={() => handleNext('skip')} className="w-full sm:w-auto flex-1 bg-white">
              Atla
            </Button>
            <Button onClick={() => handleNext('update')} disabled={currentDraftData?.type === 'readonly'} size="sm" className="w-full sm:w-auto flex-1 bg-emerald-600 hover:bg-emerald-700 shadow-md">
              <Save className="h-4 w-4 mr-1" />
              Güncelle
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
