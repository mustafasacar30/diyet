'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Send, Leaf, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface SeraChatProps {
  patientId: string
  patientName?: string
  embedded?: boolean
  initialMessage?: string
  onInitialMessageSent?: () => void
  onRedirectToRules?: (message: string) => void
}

const ALL_QUESTIONS = [
  // Kalori & Makro
  'Bugün ne kadar kalori aldım?',
  'Protein açığımı nasıl kapatırım?',
  'Günlük yağ hedefime ne kadar kaldı?',
  'Bugün karbonhidrat hedefimi aştım mı?',
  'Kaç kalori daha alabilirim bugün?',
  'Hangi öğünde en çok kalori aldım?',
  'Protein/yağ dengem nasıl?',
  'Bugün lif alımım yeterli mi?',
  'Öğle yemeğimde kaç gram protein var?',
  'Günlük omega-3 ihtiyacımı karşılıyor muyum?',
  // Besin bilgisi
  'Avokado kaç kalori?',
  'Yumurta mı yoksa tavuk mu daha çok protein?',
  'Ceviz kaç kalori, ne kadar yemeliyim?',
  'Zeytinyağı mı tereyağı mı daha sağlıklı?',
  'Kinoa ile bulgur arasındaki fark ne?',
  'Somon balığının besin değeri nedir?',
  'Chia tohumu ne işe yarar?',
  'Keten tohumu nasıl tüketilmeli?',
  'Mercimek protein kaynağı mı sayılır?',
  'Yoğurt mu kefir mi daha faydalı?',
  'Badem sütü mü normal süt mü?',
  'Hurma kaç kalori?',
  'Ton balığı ne kadar sıklıkta yenebilir?',
  'Nohut kaç kalori, protein değeri nedir?',
  'Brokoli neden bu kadar öneriliyor?',
  'Kabak çekirdeği ne kadar yemeliyim?',
  'Ispanak mı pazı mı daha besleyici?',
  'Kırmızı et ne sıklıkla yenebilir?',
  'Hindistan cevizi yağı sağlıklı mı?',
  'Tam buğday ekmeği kalori değeri nedir?',
  // Öğün önerileri
  'Akşam yemeği önerisi ver',
  'Ara öğün önerisi',
  'Kahvaltıda ne yesem?',
  'Doyurucu ama düşük kalorili bir öğün öner',
  'Atıştırmalık önerisi var mı?',
  'Hızlı hazırlanabilecek sağlıklı yemek öner',
  'Salata çeşidi öner',
  'Protein ağırlıklı akşam yemeği ne olabilir?',
  'Hafif bir gece atıştırmalığı öner',
  'Tatlı krizinde ne yiyebilirim?',
  'Sabah tok tutan bir kahvaltı öner',
  'Ofiste yiyebileceğim sağlıklı öğün öner',
  'Çorba önerisi var mı?',
  'Smoothie tarifi önerir misin?',
  'Yumurtalı pratik yemek öner',
  'Balık yemeği önerisi',
  'Sebze ağırlıklı bir yemek öner',
  'Baklagil bazlı yemek önerisi',
  'Düşük karbonhidratlı akşam yemeği',
  'Protein bar yerine ne yiyebilirim?',
  // Su & İçecek
  'Su ne kadar içmeliyim?',
  'Yeşil çay içmeli miyim?',
  'Kahve tüketimim fazla mı?',
  'Bitki çayı önerir misin?',
  'Maden suyu içmek faydalı mı?',
  'Ayran kalorisi nedir?',
  'Limonlu su faydalı mı?',
  'Günde kaç bardak su içmeliyim?',
  'Su içmeyi nasıl artırabilirim?',
  'Detoks suyu gerçekten işe yarar mı?',
  // Porsiyon & Ölçü
  'Bir porsiyon pilav ne kadar olmalı?',
  'Yağ porsiyonum ne kadar olmalı?',
  'Günde kaç yumurta yiyebilirim?',
  'Bir avuç ceviz kaç gram gelir?',
  'Makarna porsiyonu ne kadar olmalı?',
  'Ekmek yerine ne yiyebilirim?',
  'Peynir porsiyonu ne kadar olmalı?',
  'Et porsiyonu nasıl ölçülür?',
  'Meyve porsiyonu ne kadar?',
  'Kuruyemiş günde ne kadar yenebilir?',
  // Zamanlama
  'Yemekten sonra meyve yenebilir mi?',
  'Gece yemek yemek zararlı mı?',
  'Öğün arası kaç saat olmalı?',
  'Antrenman öncesi ne yemeliyim?',
  'Antrenman sonrası ne yemeliyim?',
  'Kahvaltıyı atlamak doğru mu?',
  'Akşam yemeğini saat kaçta yemeliyim?',
  'İki öğün mü üç öğün mü daha iyi?',
  'Aralıklı oruç yapmam uygun mu?',
  'Geç saatte meyve yemek şeker yapar mı?',
  // Sağlık & Program
  'Lipödem için hangi besinler faydalı?',
  'Anti-inflamatuar beslenme nedir?',
  'Şişkinliği azaltan yiyecekler neler?',
  'Ödem yapan yiyecekler neler?',
  'Bağırsak sağlığı için ne yemeliyim?',
  'Probiyotik besinler nelerdir?',
  'Prebiyotik besinler nelerdir?',
  'İnflamasyon azaltan yiyecekler?',
  'Tuz tüketimimi nasıl azaltabilirim?',
  'Şeker isteğimi nasıl kontrol edebilirim?',
  'Gluten hassasiyetim var mı nasıl anlarım?',
  'Laktoz intoleransı belirtileri neler?',
  'Kabızlık için ne yemeliyim?',
  'Demir eksikliği için hangi besinler?',
  'B12 vitamini hangi besinlerde bulunur?',
  'D vitamini eksikliği beslenmeyle giderilebilir mi?',
  'Magnezyum hangi besinlerde var?',
  'Çinko eksikliği için ne yemeli?',
  'Kalsiyum için süt ürünleri dışında ne var?',
  'Potasyum kaynağı besinler neler?',
  // Pratik bilgiler
  'Dışarıda yemek yersem nelere dikkat edeyim?',
  'Market alışverişinde nelere dikkat etmeliyim?',
  'Yemek hazırlama (meal prep) önerileri',
  'Besin etiketlerini nasıl okumalıyım?',
  'Dondurulmuş sebze taze kadar besleyici mi?',
  'Konserve besinler sağlıklı mı?',
  'Organik mı normal mi tercih etmeliyim?',
  'Yemek pişirirken besin kaybı nasıl azaltılır?',
  'Hangi yağda pişirmek daha sağlıklı?',
  'Mikrodalgada ısıtmak besini bozar mı?',
  // Duygusal yeme & alışkanlık
  'Stresli olunca yeme isteğimi nasıl kontrol ederim?',
  'Duygusal yeme alışkanlığını nasıl kırarım?',
  'Gece atıştırma isteğimi nasıl yenerim?',
  'Porsiyon kontrolü nasıl yapılır?',
  'Tok hissetmek için ne yemeliyim?',
  'Diyet yaparken sosyal ortamlarda ne yapmalıyım?',
  'Tatil döneminde beslenme kontrolü',
  'Bayramda nasıl beslenmeliyim?',
  'Yemek yerken dikkat etmem gerekenler',
  'Motivasyonumu nasıl yüksek tutarım?',
  // Egzersiz & beslenme
  'Yürüyüş öncesi ne yemeliyim?',
  'Egzersiz sonrası protein şart mı?',
  'Spor yapmıyorsam protein ihtiyacım değişir mi?',
  'Yüzme öncesi ne yemeli?',
  'Yoga öncesi hafif yemek önerisi',
  // Eliminasyon dönemi
  'Süt ürünleri yerine ne kullanabilirim?',
  'Sütsüz kalsiyum kaynakları neler?',
  'Eliminasyon döneminde ne yiyebilirim?',
  'Sütsüz smoothie tarifi var mı?',
  'Peynir alternatifi ne olabilir?',
  'Yoğurt yerine ne yiyebilirim?',
  'Sütsüz tatlı tarifi önerir misin?',
  'Bu hafta hangi besinlerden uzak durmalıyım?',
  'Eliminasyon döneminde kahve içebilir miyim?',
  'Ghee (sade yağ) süt ürünü sayılır mı?',
  // Merak & genel
  'Glutensiz beslenme gerekli mi?',
  'Rafine şeker yerine ne kullanabilirim?',
  'Bal mı pekmez mi daha iyi?',
  'Süper besinler gerçekten süper mi?',
  'Zerdeçal gerçekten faydalı mı?',
  'Zencefil neye iyi gelir?',
  'Tarçın kan şekerini düşürür mü?',
  'Elma sirkesi gerçekten yararlı mı?',
  'Gıda takviyesi almam gerekir mi?',
  'Kolajen takviyesi beslenmeyle sağlanabilir mi?',
  'Fermente besinler neden önemli?',
  'Turşu sağlıklı mı?',
  'Ev yoğurdu mu market yoğurdu mu?',
  'Çiğ sebze mi pişmiş sebze mi daha iyi?',
  'Meyve suyu mu meyve mi tercih etmeliyim?',
  'Karbonhidrat düşmanı mı?',
  'İyi yağlar kötü yağlar neler?',
  'Trans yağ nedir, nerede bulunur?',
  'Fruktoz zararlı mı?',
  'Yapay tatlandırıcılar güvenli mi?',
  // Kilo & vücut
  'Kilo verirken kas kaybetmemek için ne yapmalıyım?',
  'Su tutulması nasıl azaltılır?',
  'Metabolizmamı hızlandırabilir miyim?',
  'Plato döneminde ne yapmalıyım?',
  'Kilo verme hızım normal mi?',
  'Bel çevremi nasıl ölçmeliyim?',
  'Yağ oranımı beslenmeyle düşürebilir miyim?',
  'Doymuş yağ mı doymamış yağ mı?',
  'Kolesterol yüksekliğinde ne yemeliyim?',
  'Tansiyon için tuz dışında nelere dikkat etmeliyim?',
  // Plan ile ilgili
  'Bugünkü planımda değişiklik yapabilir miyim?',
  'Bugünkü öğünlerim yeterli mi?',
  'Planımdaki yemeklerden hangilerini yedim?',
  'Bu hafta kaç kalori aldım?',
  'Protein hedefimi tutturabiliyor muyum?',
  'Bugün hangi besinleri henüz yemedim?',
  'Planımda eksik olan besin grubu var mı?',
  'Bu haftaki en düşük kalorili günüm hangisi?',
  'Öğle yemeğimi değiştirebilir miyim?',
  'Bugünkü yemeklerim dengeli mi?',
]

function getRandomQuestions(count: number = 6): string[] {
  const shuffled = [...ALL_QUESTIONS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-2 px-1">
      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1.2s' }} />
      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1.2s' }} />
      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1.2s' }} />
    </div>
  )
}

interface ParsedOption {
  name: string
  details: string
}

interface ParsedSwap {
  oldFood: string
  newFood: string
  dayNumber: string
  mealTime: string
}

interface ParsedMealAction {
  action: 'add' | 'remove'
  foodName: string
  dayNumber: string
  mealTime: string
  quantity?: number
}

interface ParsedBalanceSuggestion {
  foodName: string
  mealTime: string
  calories: string
  reason: string
  dayNumber: string
}

function extractOptions(text: string): { cleanText: string; options: ParsedOption[]; swap: ParsedSwap | null; mealAction: ParsedMealAction | null; balanceSuggestion: ParsedBalanceSuggestion | null } {
  const options: ParsedOption[] = []
  let swap: ParsedSwap | null = null
  let mealAction: ParsedMealAction | null = null
  let balanceSuggestion: ParsedBalanceSuggestion | null = null

  const swapRegex = /\[SWAP:\s*([^->]+)->\s*([^|]+)\|\s*(\d+)\s*\|\s*([^\]]+)\]/g
  let cleaned = text.replace(swapRegex, (_, oldFood, newFood, day, meal) => {
    swap = {
      oldFood: oldFood.trim(),
      newFood: newFood.trim(),
      dayNumber: day.trim(),
      mealTime: meal.trim(),
    }
    return ''
  })

  const addRegex = /\[ADD:\s*([^|]+)\|\s*(\d+)\s*\|\s*([^|\]]+)(?:\|\s*(\d+))?\s*\]/g
  cleaned = cleaned.replace(addRegex, (_, foodName, day, meal, qty) => {
    mealAction = { action: 'add', foodName: foodName.trim(), dayNumber: day.trim(), mealTime: meal.trim(), quantity: qty ? parseInt(qty) : undefined }
    return ''
  })

  const removeRegex = /\[REMOVE:\s*([^|]+)\|\s*(\d+)\s*\|\s*([^\]]+)\]/g
  cleaned = cleaned.replace(removeRegex, (_, foodName, day, meal) => {
    if (!mealAction) {
      mealAction = { action: 'remove', foodName: foodName.trim(), dayNumber: day.trim(), mealTime: meal.trim() }
    }
    return ''
  })

  const balanceRegex = /\[BALANCE:\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*(\d+)\]/g
  cleaned = cleaned.replace(balanceRegex, (_, foodName, mealTime, calories, reason, dayNum) => {
    balanceSuggestion = {
      foodName: foodName.trim(),
      mealTime: mealTime.trim(),
      calories: calories.trim(),
      reason: reason.trim(),
      dayNumber: dayNum.trim(),
    }
    return ''
  })

  const optionRegex = /\[SECENEK:\s*([^|]+)\|([^\]]+)\]/g
  cleaned = cleaned.replace(optionRegex, (_, name, details) => {
    options.push({ name: name.trim(), details: details.trim() })
    return ''
  }).replace(/\n{3,}/g, '\n\n').trim()

  return { cleanText: cleaned, options, swap, mealAction, balanceSuggestion }
}

function formatMessage(text: string): React.ReactNode[] {
  const cleaned = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#{1,3}\s+/gm, '')

  const parts: React.ReactNode[] = []
  const lines = cleaned.split('\n')
  let currentBlock: string[] = []

  function flushBlock(idx: number) {
    if (currentBlock.length === 0) return
    const blockText = currentBlock.join('\n').trim()
    if (blockText) {
      parts.push(
        <span key={`block-${idx}`}>
          {renderInlineStyles(blockText)}
        </span>
      )
    }
    currentBlock = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      flushBlock(i)
    } else {
      currentBlock.push(line)
    }
  }
  flushBlock(lines.length)

  return parts
}

function renderInlineStyles(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const allCapsRegex = /\b([A-ZÇĞİÖŞÜ]{2,}(?:\s+[A-ZÇĞİÖŞÜ]{2,})*)\b/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = allCapsRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    nodes.push(
      <strong key={`bold-${match.index}`} className="font-semibold text-emerald-700">
        {match[1]}
      </strong>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function splitIntoBubbles(content: string): string[] {
  const cleaned = content.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#{1,3}\s+/gm, '')
  const paragraphs = cleaned.split(/\n\n+/).map(p => p.trim()).filter(Boolean)

  if (paragraphs.length <= 1) return [cleaned]

  const bubbles: string[] = []
  let current = ''

  for (const para of paragraphs) {
    const isOption = para.includes('[SECENEK:')
    if (!current) {
      current = para
    } else if (isOption || (current + '\n\n' + para).length < 300) {
      current += '\n\n' + para
    } else {
      bubbles.push(current)
      current = para
    }
  }
  if (current) bubbles.push(current)

  return bubbles
}

const RULE_PATTERNS = [
  /olsun\b/, /olmasın\b/, /eklenmesi/, /çıkar/, /kaldır/, /koyma/,
  /istemi?yorum/, /istemem/,
  /sevmi?yorum/, /sevmem/, /sevmiyorum/,
  /yemem/, /yiyemem/, /yemiyorum/, /yiyemiyorum/,
  /alerjim/, /haftada\s*(\d|bir|iki|üç|dört|beş)/, /günde\s*(\d|bir|iki|üç)/,
  /sık\s*(olsun|gelsin)/, /az\s*(olsun|gelsin)/, /tercih\s*ederim/,
  /verme\b/, /vermeyiniz/, /yapma\b/, /koymayın/,
  /azalt/, /arttır/, /daha\s*(az|çok|fazla)\s*(olsun|gelsin)/,
  /hiç\s*(olmasın|verme|koyma|istemem|istemiyorum)/,
]

function isRuleRequest(text: string): boolean {
  const q = text.toLowerCase()
  return RULE_PATTERNS.some(p => p.test(q))
}

function loadSession(patientId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(`sera-chat-${patientId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
  } catch { return [] }
}

function saveSession(patientId: string, messages: ChatMessage[]) {
  try {
    const toSave = messages.slice(-50)
    localStorage.setItem(`sera-chat-${patientId}`, JSON.stringify(toSave))
  } catch {}
}

export function SeraChat({ patientId, patientName, embedded, initialMessage, onInitialMessageSent, onRedirectToRules }: SeraChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadSession(patientId))
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [sentFirstMessage, setSentFirstMessage] = useState(() => loadSession(patientId).length > 0)
  const [revealedBubbles, setRevealedBubbles] = useState<Record<string, number>>(() => {
    const loaded = loadSession(patientId)
    const initial: Record<string, number> = {}
    for (const m of loaded) {
      if (m.role === 'assistant' && m.content) {
        initial[m.id] = splitIntoBubbles(m.content).length
      }
    }
    return initial
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const quickQuestions = useMemo(() => getRandomQuestions(embedded ? 4 : 6), [embedded])

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      saveSession(patientId, messages)
    }
  }, [messages, isStreaming, patientId])

  const initialMessageSentRef = useRef<string | null>(null)
  useEffect(() => {
    if (initialMessage && !isStreaming && initialMessageSentRef.current !== initialMessage) {
      initialMessageSentRef.current = initialMessage
      sendMessage(initialMessage)
      onInitialMessageSent?.()
    }
  }, [initialMessage])

  useEffect(() => {
    if (isStreaming) return
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.content) return
    if (revealedBubbles[lastMsg.id] !== undefined) return

    const bubbles = splitIntoBubbles(lastMsg.content)
    if (bubbles.length <= 1) {
      setRevealedBubbles(prev => ({ ...prev, [lastMsg.id]: bubbles.length }))
      return
    }
    let count = 1
    setRevealedBubbles(prev => ({ ...prev, [lastMsg.id]: count }))
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let i = 1; i < bubbles.length; i++) {
      const delay = 400 + Math.random() * 600
      const t = setTimeout(() => {
        count++
        setRevealedBubbles(prev => ({ ...prev, [lastMsg.id]: count }))
        scrollToBottom()
      }, delay * i)
      timers.push(t)
    }
    return () => timers.forEach(clearTimeout)
  }, [isStreaming, messages])

  async function sendMessage(text?: string) {
    const messageText = (text || input).trim()
    if (!messageText || isStreaming) return

    if (onRedirectToRules && isRuleRequest(messageText)) {
      onRedirectToRules(messageText)
      setInput('')
      return
    }

    const isFirst = !sentFirstMessage
    if (!sentFirstMessage) setSentFirstMessage(true)

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    }

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setIsStreaming(true)

    const chatHistory = [...messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }))

    try {
      abortRef.current = new AbortController()

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory, patientId, isFirstMessage: isFirst }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Bağlantı hatası' }))
        setMessages(prev =>
          prev.map(m => m.id === assistantMsg.id ? { ...m, content: `Hata: ${err.error || 'Bir sorun oluştu'}` } : m)
        )
        setIsStreaming(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)

          if (data === '[DONE]') break

          try {
            const parsed = JSON.parse(data)
            if (parsed.text) {
              accumulated += parsed.text
              setMessages(prev =>
                prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
              )
            }
            if (parsed.error) {
              accumulated += `\nHata: ${parsed.error}`
              setMessages(prev =>
                prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
              )
            }
          } catch {}
        }
      }
      // Check for swap command in the completed response
      const swapMatch = accumulated.match(/\[SWAP:\s*([^->]+)->\s*([^|]+)\|\s*(\d+)\s*\|\s*([^\]]+)\]/)
      if (swapMatch) {
        const [, oldFood, newFood, dayNum, mealTime] = swapMatch
        try {
          const swapRes = await fetch('/api/ai/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patientId,
              action: 'swap',
              dayNumber: parseInt(dayNum.trim()),
              mealTime: mealTime.trim(),
              oldFoodName: oldFood.trim(),
              newFoodName: newFood.trim(),
            }),
          })
          const swapData = await swapRes.json()
          if (swapData.success) {
            let successMsg = `\n\n${swapData.oldFood} -> ${swapData.newFood} (${swapData.newMacros.calories} kcal, P:${swapData.newMacros.protein}g)`
            if (swapData.dailyBefore && swapData.dailyAfter) {
              const diff = swapData.dailyAfter.calories - swapData.dailyBefore.calories
              const sign = diff >= 0 ? '+' : ''
              successMsg += `\nGünlük: ${swapData.dailyAfter.calories} kcal (${sign}${diff}), P:${swapData.dailyAfter.protein}g`
            }
            accumulated += successMsg
          } else {
            accumulated += `\n\nDeğişiklik yapılamadı: ${swapData.error}`
          }
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
          )
        } catch {
          accumulated += '\n\nDeğişiklik kaydedilirken bağlantı hatası oluştu.'
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
          )
        }
      }

      // Check for ADD command
      const addMatch = accumulated.match(/\[ADD:\s*([^|]+)\|\s*(\d+)\s*\|\s*([^|\]]+)(?:\|\s*(\d+))?\s*\]/)
      if (addMatch) {
        const [, foodName, dayNum, mealTime, qty] = addMatch
        const quantity = qty ? parseInt(qty.trim()) : 1
        try {
          const res = await fetch('/api/ai/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patientId,
              action: 'add',
              foodName: foodName.trim(),
              dayNumber: parseInt(dayNum.trim()),
              mealTime: mealTime.trim(),
              quantity,
            }),
          })
          const data = await res.json()
          if (data.success) {
            let successMsg = `\n\n${data.food} eklendi (${data.foodMacros.calories} kcal, P:${data.foodMacros.protein}g C:${data.foodMacros.carbs}g F:${data.foodMacros.fat}g)`
            if (data.dailyBefore && data.dailyAfter) {
              const diff = data.dailyAfter.calories - data.dailyBefore.calories
              successMsg += `\nGünlük toplam: ${data.dailyBefore.calories} -> ${data.dailyAfter.calories} kcal (+${diff}), P:${data.dailyAfter.protein}g`
            }
            if (data.balanceSuggestion) {
              const bs = data.balanceSuggestion
              successMsg += `\n[BALANCE: ${bs.removeFoodName} | ${bs.removeMealTime} | ${bs.removeMacros.calories} kcal | ${bs.reason} | ${dayNum.trim()}]`
            }
            accumulated += successMsg
          } else {
            accumulated += `\n\nEkleme yapılamadı: ${data.error}`
          }
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
          )
        } catch {
          accumulated += '\n\nEkleme kaydedilirken bağlantı hatası oluştu.'
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
          )
        }
      }

      // Check for REMOVE command
      const removeMatch = accumulated.match(/\[REMOVE:\s*([^|]+)\|\s*(\d+)\s*\|\s*([^\]]+)\]/)
      if (removeMatch) {
        const [, foodName, dayNum, mealTime] = removeMatch
        try {
          const res = await fetch('/api/ai/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patientId,
              action: 'remove',
              foodName: foodName.trim(),
              dayNumber: parseInt(dayNum.trim()),
              mealTime: mealTime.trim(),
            }),
          })
          const data = await res.json()
          if (data.success) {
            let successMsg = `\n\n${data.food} çıkarıldı (${data.removedMacros.calories} kcal, P:${data.removedMacros.protein}g)`
            if (data.dailyBefore && data.dailyAfter) {
              const diff = data.dailyAfter.calories - data.dailyBefore.calories
              successMsg += `\nGünlük toplam: ${data.dailyBefore.calories} -> ${data.dailyAfter.calories} kcal (${diff}), P:${data.dailyAfter.protein}g`
            }
            accumulated += successMsg
          } else {
            accumulated += `\n\nÇıkarma yapılamadı: ${data.error}`
          }
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
          )
        } catch {
          accumulated += '\n\nÇıkarma kaydedilirken bağlantı hatası oluştu.'
          setMessages(prev =>
            prev.map(m => m.id === assistantMsg.id ? { ...m, content: accumulated } : m)
          )
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m => m.id === assistantMsg.id
            ? { ...m, content: m.content || 'Bağlantı hatası oluştu. Tekrar deneyin.' }
            : m
          )
        )
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function clearChat() {
    if (isStreaming) {
      abortRef.current?.abort()
    }
    setMessages([])
    setSentFirstMessage(false)
    setRevealedBubbles({})
    try { localStorage.removeItem(`sera-chat-${patientId}`) } catch {}
  }

  const hasMessages = messages.length > 0

  return (
    <div className={cn(
      "flex flex-col h-full min-h-0 overflow-hidden",
      embedded ? "bg-slate-50" : "bg-slate-50 rounded-2xl border border-slate-200"
    )}>
      {/* Chat messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2.5 py-2 space-y-0.5 min-h-0">
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center text-center px-3 py-4">
            <p className="text-[13px] text-slate-500 mb-3">
              Merhaba{patientName ? ` ${patientName.split(' ')[0]}` : ''}! Besinler, kalori veya öğün önerileri sorabilirsiniz.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 max-w-sm">
              {quickQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="flex justify-end mb-1">
                <div className="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px] leading-relaxed bg-[#d9fdd3] text-gray-900 rounded-tr-none shadow-sm">
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                </div>
              </div>
            )
          }

          if (!msg.content && isStreaming) {
            return (
              <div key={msg.id} className="flex justify-start mb-1">
                <div className="max-w-[80%] rounded-lg px-3 py-1 text-[13px] bg-white rounded-tl-none shadow-sm">
                  <TypingIndicator />
                </div>
              </div>
            )
          }

          if (!msg.content) return null

          const isLastAssistant = isStreaming && msg.id === messages[messages.length - 1]?.id
          const bubbles = isLastAssistant ? [msg.content] : splitIntoBubbles(msg.content)
          const revealed = revealedBubbles[msg.id] ?? bubbles.length
          const visibleBubbles = isLastAssistant ? bubbles : bubbles.slice(0, revealed)

          return visibleBubbles.map((bubble, idx) => {
            const { cleanText, options, swap, mealAction, balanceSuggestion } = isLastAssistant
              ? { cleanText: bubble, options: [] as ParsedOption[], swap: null, mealAction: null, balanceSuggestion: null }
              : extractOptions(bubble)

            // Check for action result messages in cleanText
            const swapSuccessMatch = cleanText.match(/(.+?) -> (.+?) \((\d+ kcal.+)\)/)
            const addSuccessMatch = cleanText.match(/(.+?) eklendi \((.+?)\)/)
            const removeSuccessMatch = cleanText.match(/(.+?) çıkarıldı \((.+?)\)/)
            const dailyTotalMatch = cleanText.match(/Günlük toplam: (\d+) -> (\d+) kcal \(([^)]+)\), P:(\d+)g/)
            const dailyLineMatch = cleanText.match(/Günlük: (\d+) kcal \(([^)]+)\), P:(\d+)g/)
            const actionErrorMatch = cleanText.match(/(?:Değişiklik|Ekleme|Çıkarma) yapılamadı: (.+)/)
            const hasActionResult = swapSuccessMatch || addSuccessMatch || removeSuccessMatch || actionErrorMatch
            const textWithoutResult = hasActionResult
              ? cleanText
                  .replace(/(\n\n)?[\s\S]*? -> [\s\S]*? \([\s\S]*?\)(\nGünlük:[\s\S]*)?$/, '')
                  .replace(/(\n\n)?[\s\S]*? eklendi \([\s\S]*?\)(\nGünlük toplam:[\s\S]*)?$/, '')
                  .replace(/(\n\n)?[\s\S]*? çıkarıldı \([\s\S]*?\)(\nGünlük toplam:[\s\S]*)?$/, '')
                  .replace(/(\n\n)?(?:Değişiklik|Ekleme|Çıkarma) yapılamadı:[\s\S]*$/, '')
                  .replace(/(\n\n)?(?:Değişiklik|Ekleme|Çıkarma) kaydedilirken:[\s\S]*$/, '')
                  .trim()
              : cleanText

            return (
            <div key={`${msg.id}-${idx}`} className="flex flex-col items-start gap-1 mb-1 animate-bubble-in" style={{ animationDelay: `${idx * 100}ms` }}>
              {textWithoutResult && (
              <div className="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px] leading-relaxed bg-white text-gray-900 rounded-tl-none shadow-sm">
                <div className="whitespace-pre-wrap break-words space-y-1">
                  {formatMessage(textWithoutResult).map((node, i) => (
                    <p key={i}>{node}</p>
                  ))}
                </div>
              </div>
              )}
              {swapSuccessMatch && (
                <div className="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-tl-none shadow-sm">
                  <div className="flex items-center gap-1.5 font-medium text-[12px]">
                    <span>✓</span>
                    <span>{swapSuccessMatch[1]} → {swapSuccessMatch[2]}</span>
                  </div>
                  <p className="text-[11px] text-emerald-600">{swapSuccessMatch[3]}</p>
                  {dailyLineMatch && (
                    <p className="text-[10px] text-emerald-500">Günlük: {dailyLineMatch[1]} kcal ({dailyLineMatch[2]}), P:{dailyLineMatch[3]}g</p>
                  )}
                </div>
              )}
              {addSuccessMatch && (
                <div className="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px] bg-blue-50 border border-blue-200 text-blue-800 rounded-tl-none shadow-sm">
                  <div className="flex items-center gap-1.5 font-medium text-[12px]">
                    <span>+</span>
                    <span>{addSuccessMatch[1]} eklendi</span>
                  </div>
                  <p className="text-[11px] text-blue-600">{addSuccessMatch[2]}</p>
                  {dailyTotalMatch && (
                    <p className="text-[10px] text-blue-500">Günlük: {dailyTotalMatch[1]} → {dailyTotalMatch[2]} kcal ({dailyTotalMatch[3]}), P:{dailyTotalMatch[4]}g</p>
                  )}
                </div>
              )}
              {removeSuccessMatch && (
                <div className="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px] bg-amber-50 border border-amber-200 text-amber-800 rounded-tl-none shadow-sm">
                  <div className="flex items-center gap-1.5 font-medium text-[12px]">
                    <span>−</span>
                    <span>{removeSuccessMatch[1]} çıkarıldı</span>
                  </div>
                  <p className="text-[11px] text-amber-600">{removeSuccessMatch[2]}</p>
                  {dailyTotalMatch && (
                    <p className="text-[10px] text-amber-500">Günlük: {dailyTotalMatch[1]} → {dailyTotalMatch[2]} kcal ({dailyTotalMatch[3]}), P:{dailyTotalMatch[4]}g</p>
                  )}
                </div>
              )}
              {actionErrorMatch && (
                <div className="max-w-[80%] rounded-lg px-3 py-1.5 text-[13px] bg-red-50 border border-red-200 text-red-700 rounded-tl-none shadow-sm">
                  <div className="flex items-center gap-1.5 font-medium text-[12px]">
                    <span>✗</span>
                    <span>{actionErrorMatch[1]}</span>
                  </div>
                </div>
              )}
              {balanceSuggestion && (
                <div className="max-w-[80%] rounded-lg overflow-hidden border border-orange-200 bg-orange-50 rounded-tl-none shadow-sm">
                  <div className="px-3 py-1.5 bg-orange-100 border-b border-orange-200">
                    <p className="text-[11px] font-semibold text-orange-800">Dengeleme Önerisi</p>
                    <p className="text-[10px] text-orange-600">{balanceSuggestion.reason}</p>
                  </div>
                  <div className="px-3 py-2">
                    <p className="text-[13px] text-orange-900">
                      {balanceSuggestion.mealTime} öğününden <span className="font-medium">{balanceSuggestion.foodName}</span> çıkarılsın mı?
                    </p>
                    <p className="text-[10px] text-orange-600">−{balanceSuggestion.calories}</p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/ai/swap', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                patientId,
                                action: 'remove',
                                foodName: balanceSuggestion!.foodName,
                                dayNumber: parseInt(balanceSuggestion!.dayNumber),
                                mealTime: balanceSuggestion!.mealTime,
                              }),
                            })
                            const rData = await res.json()
                            if (rData.success) {
                              const rmMsg = `\n\n${rData.food} çıkarıldı (${rData.removedMacros.calories} kcal, P:${rData.removedMacros.protein}g)`
                                + (rData.dailyBefore && rData.dailyAfter
                                  ? `\nGünlük toplam: ${rData.dailyBefore.calories} -> ${rData.dailyAfter.calories} kcal (${rData.dailyAfter.calories - rData.dailyBefore.calories}), P:${rData.dailyAfter.protein}g`
                                  : '')
                              setMessages(prev => prev.map(m =>
                                m.id === msg.id ? { ...m, content: m.content.replace(/\[BALANCE:[^\]]+\]/, '') + rmMsg } : m
                              ))
                            }
                          } catch { /* silent */ }
                        }}
                        disabled={isStreaming}
                        className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50"
                      >
                        Evet, Çıkar
                      </button>
                      <button
                        onClick={() => {
                          setMessages(prev => prev.map(m =>
                            m.id === msg.id ? { ...m, content: m.content.replace(/\[BALANCE:[^\]]+\]/, '') } : m
                          ))
                        }}
                        className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-white border border-orange-300 text-orange-700 hover:bg-orange-50 transition-colors"
                      >
                        Hayır
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {options.length > 0 && (
                <div className="flex flex-col gap-1 w-full max-w-[80%]">
                  {options.map((opt, oi) => (
                    <button
                      key={oi}
                      onClick={() => sendMessage(`${opt.name} ile değiştirmek istiyorum`)}
                      disabled={isStreaming}
                      className="w-full text-left rounded-lg px-3 py-2 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-colors disabled:opacity-50 group"
                    >
                      <span className="text-[13px] font-medium text-emerald-800 group-hover:text-emerald-900">{opt.name}</span>
                      <span className="block text-[10px] text-emerald-600/80">{opt.details}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )})
        })}
      </div>

      {/* Input area */}
      <div className={cn(
        "shrink-0 border-t border-slate-100 bg-white px-2.5 py-2",
        embedded ? "pb-2" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      )}>
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Sera'ya bir soru sorun..."
            rows={1}
            className="flex-1 resize-none rounded-full border border-slate-200 bg-slate-50 px-3.5 py-2 text-[13px] placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 focus:border-emerald-400 max-h-24"
            style={{ minHeight: '38px' }}
          />
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isStreaming}
            size="icon"
            className="h-[38px] w-[38px] rounded-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {hasMessages && (
          <div className="flex justify-center mt-1">
            <button
              onClick={clearChat}
              className="text-[10px] text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
            >
              <Trash2 className="h-2.5 w-2.5" />
              Sohbeti temizle
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
