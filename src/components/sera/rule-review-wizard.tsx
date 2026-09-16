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
import { Loader2, Save, Trash2 } from "lucide-react"

export interface RuleReviewWizardProps {
  isOpen: boolean
  onClose: () => void
  rules: any[]
  onRuleUpdated: (ruleId: string, newDefinition: any) => Promise<void>
  onRuleDeleted: (ruleId: string) => Promise<void>
}

export function RuleReviewWizard({ isOpen, onClose, rules, onRuleUpdated, onRuleDeleted }: RuleReviewWizardProps) {
  // Sadece aktif ve kilitli (lock) olmayan kuralları düzenlet
  const activeRules = rules.filter(r => r.is_active && r.definition && r.rule_type !== 'lock')
  
  const [currentStep, setCurrentStep] = useState(0)
  const [frequency, setFrequency] = useState<string>("")
  const [scope, setScope] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)

  const currentRule = activeRules[currentStep]

  useEffect(() => {
    if (isOpen) setCurrentStep(0)
  }, [isOpen])

  // Kural değiştiğinde form state'ini güncelle (key={currentRule.id} ile tam senkron olur)
  useEffect(() => {
    if (currentRule && currentRule.definition) {
      setFrequency(currentRule.definition.frequency?.toString() || "1")
      const currentScope = (currentRule.definition.scopes && currentRule.definition.scopes.length > 0) 
        ? currentRule.definition.scopes[0] 
        : "TÜMÜ"
      setScope(currentScope)
    }
  }, [currentRule])

  if (!isOpen) return null

  if (activeRules.length === 0) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Gözden Geçirilecek Kural Yok</DialogTitle>
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

  if (isFinished) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[425px] text-center">
          <DialogHeader>
            <DialogTitle className="text-center text-xl text-emerald-700">Tebrikler! 🎉</DialogTitle>
            <DialogDescription className="text-center mt-4 text-base">
              Mevcut programınızı başarıyla gözden geçirdiniz. <br/><br/>
              Şimdi sıra sizde! Yeni bir tercih veya kural eklemek isterseniz, <strong>Sera Kişisel Asistanınız</strong> üzerinden yazarak devam edebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center mt-6">
            <Button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-700">Asistana Dön</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const handleNext = () => setCurrentStep(prev => prev + 1)

  const handleSaveAndNext = async () => {
    setIsLoading(true)
    try {
      const newDefinition = { ...currentRule.definition }
      if (frequency) newDefinition.frequency = parseInt(frequency)
      if (scope && scope !== "TÜMÜ") {
        newDefinition.scopes = [scope]
      } else {
        delete newDefinition.scopes
      }
      await onRuleUpdated(currentRule.id, newDefinition)
      handleNext()
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteAndNext = async () => {
    if (!window.confirm("Bu tercihi silmek istediğinize emin misiniz?")) return
    setIsLoading(true)
    try {
      await onRuleDeleted(currentRule.id)
      handleNext()
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }

  const canEditFrequency = currentRule.definition?.frequency !== undefined || currentRule.rule_type === 'frequency'
  const canEditScope = currentRule.rule_type !== 'lock' 

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-emerald-800">Programı Gözden Geçir</DialogTitle>
            <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
              {currentStep + 1} / {activeRules.length}
            </span>
          </div>
          <DialogDescription className="text-gray-600 pt-2 pb-2 border-b">
            <strong className="text-gray-900 block text-xl text-center mt-2 mb-1">{currentRule.name}</strong>
            <span className="block text-center text-sm">{currentRule.description}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="py-2" key={currentRule.id}>
          <div className="bg-emerald-50/70 p-5 rounded-xl border border-emerald-100 text-emerald-900 leading-8 text-center text-[15px] shadow-sm">
            <span>Şu anki programınıza göre bu tercihiniz, menünüzde haftada </span>
            
            {canEditFrequency ? (
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="inline-flex w-[100px] h-8 mx-1 bg-white border-emerald-200 text-emerald-800 font-bold focus:ring-emerald-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map(num => (
                    <SelectItem key={num} value={num.toString()}>{num === 0 ? "Hiç" : `${num} gün`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="font-bold mx-1 border-b border-emerald-300">sabit sayıda</span>
            )}
            
            <span> ve </span>
            
            {canEditScope ? (
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="inline-flex w-[150px] h-8 mx-1 bg-white border-emerald-200 text-emerald-800 font-bold focus:ring-emerald-400">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TÜMÜ">Farketmez</SelectItem>
                  <SelectItem value="KAHVALTI" disabled>Kahvaltı (Sabit)</SelectItem>
                  <SelectItem value="ÖĞLEN">Öğlen</SelectItem>
                  <SelectItem value="AKŞAM">Akşam</SelectItem>
                  <SelectItem value="ARA ÖĞÜN">Ara Öğün</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <span className="font-bold mx-1 border-b border-emerald-300">kilitli öğünde</span>
            )}
            <span> yer alacaktır. </span>
            
            <div className="mt-4 pt-4 border-t border-emerald-100 text-[12px] text-emerald-600/80 leading-tight">
              Tercihinizi değiştirmek için yukarıdaki seçeneklere tıklayabilir veya mevcut haliyle bırakmak için "Aynen Kalsın" diyerek devam edebilirsiniz.
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row sm:justify-between items-center gap-2 mt-2">
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={handleDeleteAndNext} 
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
            Tercihi Sil
          </Button>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleNext} 
              disabled={isLoading}
              className="w-full sm:w-auto"
            >
              Aynen Kalsın
            </Button>
            <Button 
              onClick={handleSaveAndNext} 
              disabled={isLoading} 
              size="sm"
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              {isLastStep ? "Güncelle & Bitir" : "Güncelle & İlerle"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
