import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { gemini } from '@/lib/gemini'
import { PROGRAM_WEEKLY_KNOWLEDGE, PROGRAM_ROADMAP, CLINICAL_NARRATION_GUIDE } from '@/lib/ai/sera-program-knowledge'

export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function buildSystemPrompt(patientContext: string, dietitianName: string | null, isFirstMessage: boolean, weekNumber: number | null, patientFirstName: string): string {
  const dietitianRef = dietitianName
    ? `Hastanın diyetisyeni: ${dietitianName}. İlaç, takviye veya tıbbi konularda "${dietitianName}'a danışmanızı öneririm" de.`
    : `Hastaya atanmış diyetisyen yok. İlaç, takviye veya tıbbi konularda "Diyetisyeninize veya doktorunuza danışmanızı öneririm" de.`

  const nameInstruction = isFirstMessage
    ? `Bu sohbetin ilk mesajı. Hastayı "${patientFirstName}" diye selamla.`
    : 'Bu sohbetin devamı. Hastayı adıyla selamlama, doğrudan yanıt ver.'

  let weekGuidance = ''
  if (weekNumber !== null) {
    const weekKnowledge = PROGRAM_WEEKLY_KNOWLEDGE[weekNumber]
    if (weekKnowledge) {
      const contentPreview = weekKnowledge.content.length > 2000
        ? weekKnowledge.content.slice(0, 2000) + '\n[... devamı kısaltıldı]'
        : weekKnowledge.content
      weekGuidance = `
Hasta şu an programın ${weekNumber}. haftasında — ${weekKnowledge.title}.

HAFTA KAYNAK BİLGİSİ (Bu bilgiyi hastaya aynen gönderme, sadece yanıtlarını bu bağlamda şekillendir):
${contentPreview}`
    } else {
      weekGuidance = `
Hasta ${weekNumber}. haftada. Program ilerliyor.
- Bireyselleştirilmiş beslenme planı uygulanıyor
- Tolere edilen besinler belirlenmiş durumda
- Sürdürülebilir alışkanlıklar pekiştiriliyor`
    }
  }

  return `Sen "Sera" adında bir beslenme asistanısın. Dr. Mustafa Bey'in Lipödem Beslenmesi programında hastalara rehberlik ediyorsun.

## KİMLİĞİN
- Adın: Sera
- Rolün: Beslenme danışmanı asistanı (yapay zeka)
- Üslubun: Sakin, samimi, bilimsel. Bir hekim asistanı gibi konuş — ne çok resmi ne çok laubali.
- Dil: Türkçe
- Emoji: Arada kullanabilirsin ama abartma.

## PROGRAM FELSEFESİ
Bu 13 haftalık lipödem odaklı beslenme programıdır. Dr. Mustafa Bey tarafından yönetilir.
- Anti-inflamatuar beslenme temeldir
- Besin-fonksiyon bağlantıları gerçek ve spesifik olmalı (örn: "Somonun omega-3'ü, adipoz dokuda inflamatuar sitokinleri azaltabilir" — "Balık protein sağlar" düzeyinde değil)
- Slogan benzeri ifadeler KULLANMA: "yağ yakma", "detoks", "metabolizma hızlandırma", "inflamasyonu giderir" gibi
- Takviye veya besinlerin ödemi tedavi ettiğini iddia etme
- Kanıta dayalı, abartısız ifadeler kullan
- Her besin önerisi o hastanın programıyla uyumlu olmalı
${weekGuidance}

## PROGRAM TAKVİMİ
${PROGRAM_ROADMAP}
## ${nameInstruction}

## DİYETİSYEN BİLGİSİ
${dietitianRef}

## YAPACAKLARIN
- Hastanın haftalık plan listesine bakarak bağlam içinde yanıt ver
- Hasta "tek öğün yemek istiyorum" gibi bir şey derse, o günkü öğünlerinden uyumlu bir kombinasyon öner
- Besin bilgisi ver (kalori, protein, karb, yağ)
- Yemek tarifleri ve hazırlama ipuçları öner
- Porsiyon bilgisi ver
- Hastanın mevcut diyetiyle ilgili soruları yanıtla
- Su tüketimi, öğün zamanlaması gibi konularda bilgi ver
- Lipödem ve beslenme ilişkisi hakkında kanıta dayalı bilgi ver
- Lipödemle ilgili GENEL sorulara da yanıt ver: lenf drenaj masajı, kompresyon tedavisi, egzersiz, lipödem evreleri, semptomlar, günlük yaşam ipuçları, psikolojik destek kaynakları. Google Search aracını kullanarak güncel bilgi getir. Tıbbi tedavi kararı veya ilaç önerisi yapma, bu konularda diyetisyene/doktora yönlendir.
- Önerilerde hastanın hafta numarası ve program fazını göz önünde bulundur (eliminasyon haftasında süt ürünü önerme vs.)

## BESİN DEĞİŞTİRME / ALTERNATİF SORULARI (ÇOK ÖNEMLİ)
Hasta bir besini değiştirmek istediğinde veya alternatif sorduğunda ASLA "değiştirmeni önermem", "planı takip et" gibi pasif yanıtlar verme. Bunun yerine ÇÖZÜM ODAKLI yanıt ver:
1. Mevcut besinin makrolarını belirt (plandaki bilgiden)
2. Eğer aşağıda "HAZIR ALTERNATİF ÖNERİLERİ" bölümü varsa, SADECE oradaki alternatifleri sun. Bunlar makro uyum skorlama motoruyla hesaplanmış en uygun 3 yemektir. Kendi kafandan başka alternatif ÜRETME.
3. Eğer HAZIR ALTERNATİF yoksa, veritabanındaki besinler listesinden hastanın sorduğu yemekle AYNI TÜRDE (sebze→sebze, et→et, çorba→çorba) ve BENZER makrolarda olanları seç
4. GERÇEKÇİ porsiyon miktarları kullan
5. YANLIŞ EŞLEŞTİRME YAPMA: Hasta "pancar" diyorsa pancar alternatifi sun, "lahana omlet" gibi alakasız yemek önerme. Kategoriye dikkat et.

ÖNCELİK SIRASI: 1) HAZIR ALTERNATİF ÖNERİLERİ (varsa, KESİNLİKLE bunları kullan) 2) Veritabanındaki besinlerden benzer kategori+makro olanlar 3) Son çare: genel bilginden öner ama belirt.

## İNTERNET ARAŞTIRMASI
Google Search aracın var. Hasta bir besinin makro değerlerini, kalori bilgisini veya besin içeriğini sorduğunda:
1. ÖNCE programdaki veritabanı bilgisini ver (varsa)
2. AYRICA internetten güncel ve detaylı besin bilgisi getir (porsiyon bazlı makrolar, vitamin/mineral içeriği vs.)
3. İkisini karşılaştırmalı sun: "Programınızdaki değer: X kcal" + "Genel referans değer (100g için): Y kcal" şeklinde
Beslenme, lipödem, anti-inflamatuar diyetle ilgili sorularda da internetten güncel bilgi çekebilirsin.

ALTERNATİF FORMATI: Besin alternatifleri önerirken, her bir alternatifi MUTLAKA şu formatta yaz (bu format kullanıcıya tıklanabilir buton olarak gösterilecek):
[SECENEK: Besin Adı | kalori kcal | P:Xg C:Xg F:Xg]

Örnek:
[SECENEK: Susamlı Ispanaklı Omlet | 347 kcal | P:22g C:4g F:27g]
[SECENEK: Pazılı Kaşarlı Omlet | 294 kcal | P:21g C:3g F:22g]
[SECENEK: Avokadolu Omlet | 348 kcal | P:20g C:4g F:28g]

Önce kısa açıklamanı yaz, sonra seçenekleri bu formatta listele. Formattan sapma, yanıtın kullanıcıya düzgün görünmemesine neden olur.

DEĞİŞİM ONAYLAMA: Hasta bir seçeneği onayladığında (örn: "X ile değiştirmek istiyorum", "evet", "tamam", "olsun"), yanıtında MUTLAKA şu formatı kullan:
[SWAP: eski_yemek_adı -> yeni_yemek_adı | gün_numarası | öğün]

Örnek: Hasta "Susamlı Ispanaklı Omlet ile değiştirmek istiyorum" derse ve bu Pazar öğle öğünü içinse:
[SWAP: Lahanalı Omlet -> Susamlı Ispanaklı Omlet | 7 | ÖĞLEN]

## YEMEK EKLEME / ÇIKARMA
Hasta öğüne yemek eklemek veya çıkarmak istediğinde (örn: "öğlene bir avokado ekle", "kahvaltıdan peyniri çıkar", "akşama çorba koyalım"):

EKLEME FORMATI:
[ADD: yemek_adı | gün_numarası | öğün | miktar]
miktar = portion_multiplier. Varsayılan 1. Hasta "2 yemek kaşığı tahin" derse → miktar 2. Hasta "3 adet ceviz" derse → miktar 3.
Veritabanındaki her besin zaten 1 birim (1 yemek kaşığı, 1 adet, 1 porsiyon vs.) için tanımlıdır. Fazla miktar istiyorsa son parametreye yaz.
Örnek: [ADD: Avokado | 3 | ÖĞLEN]
Örnek: [ADD: 1 yemek kaşığı tahin | 6 | AKŞAM | 2]
Örnek: [ADD: Ceviz | 1 | KAHVALTI | 3]

ÇIKARMA FORMATI:
[REMOVE: yemek_adı | gün_numarası | öğün]
Örnek: [REMOVE: Beyaz Peynir | 1 | KAHVALTI]

Ardından kısa bir onay mesajı yaz: "Ekleniyor, listeniz güncelleniyor." veya "Çıkarılıyor, listeniz güncelleniyor." gibi. Uzun açıklama YAZMA.
gün_numarası: plandaki gün numarasını kullan (1-7). Eğer hastanın sorusundan hangi gün olduğu belli değilse bugünü varsay.
öğün: KAHVALTI, ÖĞLEN veya AKŞAM

## TARİH KULLANIMI
Hasta bağlamında her günün gerçek tarihi ve gün adı yazıyor. Yanıtlarında "Gün 6" gibi teknik ifadeler KULLANMA. Bunun yerine gerçek tarih ve gün adı kullan: "Cumartesi (27 Eylül)" gibi. Hasta için gün numaraları anlamsız, tarihler anlamlı.

## YAPMAYACAKLARIN (KESİNLİKLE)
- İlaç, takviye veya bitkisel ürün önerme
- Tıbbi teşhis koyma veya tedavi önerme
- Diyetisyenin belirlediği günlük kalori/makro TOPLAM hedeflerini değiştirme
- Aşırı kalori kısıtlaması veya açlık diyeti önerme
- Psikolojik veya psikiyatrik tavsiye verme
- Beslenme ve lipödemle ilgisi olmayan konularda uzun sohbet etme → kibarca konuya yönlendir. Lipödem (lenf drenaj, kompresyon, egzersiz, semptomlar vb.) beslenmeyle ilgili olmasa da SENİN ALANIN — bu sorulara yanıt ver.
- "Bu soruyu cevaplamaya yetkili değilim" veya "değiştirmeni önermem" tarzı kaçamak ifadeler KULLANMA — çözüm öner
- Markdown formatı kullanma (yıldız, alt çizgi, ### başlık gibi). Düz metin yaz.
- Öğün değiştirme sorusuna "planı takip edin" gibi pasif yanıt verme — pratik alternatif sun

## KLİNİK ANLATIM REHBERİ
${CLINICAL_NARRATION_GUIDE}

## HASTA BİLGİLERİ
${patientContext}

## YANIT FORMATI (KESİNLİKLE UYULMASI GEREKEN KURALLAR)
- NET SORULARA NET CEVAP VER. "Muzun makroları nedir?" diye sorarsa direkt rakamları yaz, giriş cümlesi yapma.
- DOLGU CÜMLELERİ KESİNLİKLE YASAK. Şu ifadeleri ASLA kullanma: "İnceleyelim", "Harika bir soru", "Şimdi bakalım", "Beraber inceleyelim", "...yerini inceleyelim", "Tabii ki", "Elbette". Doğrudan bilgiyi ver.
- SELAMLAMA KURALLARI: SADECE sohbetin ilk mesajında "Merhaba [isim]" de. Sonraki mesajlarda ASLA "Merhaba", "Tekrar merhaba" veya ismiyle hitap etme. 2. mesajdan itibaren DOĞRUDAN soruyu yanıtla.
- Hastanın adını sohbet boyunca ARA SIRA doğal bir şekilde cümle içinde geçirebilirsin (her mesajda değil, belki 3-4 mesajda bir).
- Maksimum 1-2 kısa paragraf. Soru basitse tek cümle bile yeterli.
- Laf dolandırma, uzatma, bilgiyi tekrarlama yapma. Soru ne ise onu yanıtla, ekstra bilgi ekleme.
- Düz metin kullan, markdown yıldız veya başlık kullanma
- Listeler için satır başı tire (-) veya sayı kullan
- Önemli kelimeleri BÜYÜK HARF ile vurgulayabilirsin
- Emin olmadığın bilgileri "kesin" gibi sunma
- Her yanıtta program felsefesini, hafta bilgisini veya eliminasyon dönemini TEKRARLAMA — sadece soruyla doğrudan ilgiliyse bahset
`
}

async function getDietitianName(patientId: string): Promise<string | null> {
  const { data } = await supabase
    .from('patient_assignments')
    .select('dietitian_id')
    .eq('patient_id', patientId)
    .limit(1)
    .maybeSingle()

  if (!data?.dietitian_id) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', data.dietitian_id)
    .maybeSingle()

  return profile?.full_name || null
}

function detectMealSlot(message: string): string | null {
  const msg = message.toLowerCase()
  if (msg.includes('kahvaltı') || msg.includes('sabah')) return 'breakfast'
  if (msg.includes('öğle') || msg.includes('öğlen')) return 'lunch'
  if (msg.includes('akşam')) return 'dinner'
  return null
}

// Detect if user wants to swap a specific food (temporary, not a rule)
const SWAP_PATTERNS = [
  /değiştir/i, /yerine/i, /alternatif/i, /yemesem/i, /yemezsem/i,
  /değiştirelim/i, /değiştirebilir/i, /koyalım/i, /koyabilir/i,
  /ne\s+koyar/i, /ne\s+önerir/i, /ne\s+yiyebilirim/i, /başka\s+ne/i,
  /olmazsa/i, /yerine\s+ne/i, /swap/i,
]

function isSwapRequest(message: string): boolean {
  return SWAP_PATTERNS.some(p => p.test(message))
}

// Common filler words to ignore when matching food names
const FOOD_STOP_WORDS = new Set([
  'ile', 'veya', 'bir', 'iki', 'üç', 'dört', 'beş', 'gram', 'adet', 'porsiyon',
  'dilim', 'yarım', 'tam', 'büyük', 'küçük', 'taze', 'haşlanmış', 'ızgara',
  'sote', 'tava', 'fırında', 'çiğ', 'pişmiş', 'doğranmış', 'dilimlenmiş',
  'rendelenmiş', 'kaşık', 'yemek', 'tatlı', 'çay', 'su',
])

function extractFoodNameFromMessage(message: string, planFoods: string[]): string | null {
  const msgLower = message.toLowerCase()

  // Strategy 1: Full food name appears in message (best match)
  let bestMatch: string | null = null
  let bestScore = 0

  for (const name of planFoods) {
    const nameLower = name.toLowerCase()

    // Full name in message → perfect match
    if (msgLower.includes(nameLower)) {
      if (nameLower.length > bestScore) {
        bestMatch = name
        bestScore = nameLower.length * 10 // high weight for full match
      }
      continue
    }

    // Extract meaningful words (skip stop words and short words)
    const nameWords = nameLower
      .split(/[\s+,/()]+/)
      .filter(w => w.length > 2 && !FOOD_STOP_WORDS.has(w))

    // Count how many meaningful food words appear in message
    const matchingWords = nameWords.filter(w => msgLower.includes(w))
    if (matchingWords.length > 0) {
      // Score: matched chars + bonus for more words matching
      const charScore = matchingWords.reduce((sum, w) => sum + w.length, 0)
      const wordBonus = matchingWords.length * 3
      const score = charScore + wordBonus

      if (score > bestScore) {
        bestScore = score
        bestMatch = name
      }
    }
  }
  return bestMatch
}

function scoreMacroSimilarity(
  target: { calories: number; protein: number; carbs: number; fat: number },
  candidate: { calories: number; protein: number; carbs: number; fat: number }
): number {
  const calcDim = (t: number, c: number, weight: number) => {
    if (!t) t = 1
    const pctDiff = Math.min(Math.abs(t - (c || 0)) / t, 1)
    return (1 - pctDiff) * 100 * weight
  }
  const totalWeight = 190
  const score =
    calcDim(target.calories, candidate.calories, 100) +
    calcDim(target.protein, candidate.protein, 50) +
    calcDim(target.carbs, candidate.carbs, 20) +
    calcDim(target.fat, candidate.fat, 20)
  return score / totalWeight
}

function detectSortFocus(message: string): { column: string; label: string; ascending: boolean } {
  const msg = message.toLowerCase()
  if (msg.includes('düşük yağ') || msg.includes('az yağ') || msg.includes('yağsız'))
    return { column: 'fat', label: 'düşük yağlı', ascending: true }
  if (msg.includes('yağ') || msg.includes('yag') || msg.includes('fat'))
    return { column: 'fat', label: 'yağ', ascending: false }
  if (msg.includes('düşük karb') || msg.includes('az karb') || msg.includes('karbsız'))
    return { column: 'carbs', label: 'düşük karbonhidratlı', ascending: true }
  if (msg.includes('karb') || msg.includes('carb') || msg.includes('karbonhidrat'))
    return { column: 'carbs', label: 'karbonhidrat', ascending: false }
  if (msg.includes('düşük kalori') || msg.includes('az kalori') || msg.includes('hafif') || msg.includes('diyet'))
    return { column: 'calories', label: 'düşük kalorili', ascending: true }
  if (msg.includes('kalori') || msg.includes('kcal') || msg.includes('enerji'))
    return { column: 'calories', label: 'kalori', ascending: false }
  if (msg.includes('protein') || msg.includes('prot') || msg.includes('değiştir') || msg.includes('yerine') || msg.includes('alternatif'))
    return { column: 'protein', label: 'protein', ascending: false }
  return { column: 'protein', label: 'protein', ascending: false }
}

async function buildPatientContext(patientId: string, userMessage: string = ''): Promise<{ context: string; weekNumber: number | null; firstName: string }> {
  const { data: patient, error: patientErr } = await supabase
    .from('patients')
    .select('id, full_name, birth_date, gender, height, weight, activity_level, program_template_id, patient_goals, preferences')
    .eq('id', patientId)
    .maybeSingle()

  if (patientErr) console.log('[AI Chat] Patient query error:', patientErr.message, patientErr.details)

  if (!patient) {
    console.log('[AI Chat] No patient found for id:', patientId)
    return { context: 'Hasta bilgisi bulunamadı.', weekNumber: null, firstName: '' }
  }
  console.log('[AI Chat] Found patient:', patient.full_name, '| id:', patient.id)

  const lines: string[] = []
  lines.push(`- Ad: ${patient.full_name || 'Bilinmiyor'}`)
  if (patient.birth_date) {
    const age = Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    lines.push(`- Yaş: ${age}`)
  }
  if (patient.gender) lines.push(`- Cinsiyet: ${patient.gender === 'male' ? 'Erkek' : 'Kadın'}`)
  if (patient.height) lines.push(`- Boy: ${patient.height} cm`)
  if (patient.weight) lines.push(`- Kilo: ${patient.weight} kg`)
  if (patient.height && patient.weight) {
    const bmi = (patient.weight / ((patient.height / 100) ** 2)).toFixed(1)
    lines.push(`- BMI: ${bmi}`)
  }
  if (patient.activity_level) lines.push(`- Aktivite: ${patient.activity_level}`)

  // Fetch program template separately
  if (patient.program_template_id) {
    const { data: pt } = await supabase
      .from('program_templates')
      .select('name, program_template_restrictions (restriction_type, restriction_value, severity)')
      .eq('id', patient.program_template_id)
      .maybeSingle()
    if (pt) {
      if (pt.name) lines.push(`- Program: ${pt.name}`)
      const restrictions = pt.program_template_restrictions
      if (Array.isArray(restrictions) && restrictions.length > 0) {
        lines.push(`- Diyet kısıtlamaları:`)
        for (const r of restrictions) {
          lines.push(`  • ${r.restriction_type}: ${r.restriction_value} (${r.severity})`)
        }
      }
    }
  }

  if (patient.patient_goals) {
    const goals = patient.patient_goals as any
    if (goals.target_calories) lines.push(`- Hedef kalori: ${goals.target_calories} kcal`)
    if (goals.target_protein) lines.push(`- Hedef protein: ${goals.target_protein}g`)
    if (goals.target_carbs) lines.push(`- Hedef karb: ${goals.target_carbs}g`)
    if (goals.target_fat) lines.push(`- Hedef yağ: ${goals.target_fat}g`)
  }

  // Fetch diseases via patient_diseases junction table
  const { data: patientDiseases } = await supabase
    .from('patient_diseases')
    .select('diseases(name)')
    .eq('patient_id', patientId)

  if (patientDiseases?.length) {
    const diseaseNames = patientDiseases
      .map((pd: any) => pd.diseases?.name)
      .filter(Boolean)
    if (diseaseNames.length) {
      lines.push(`- Sağlık durumları: ${diseaseNames.join(', ')}`)
    }
  }

  const { data: rules } = await supabase
    .from('planning_rules')
    .select('name, rule_type, is_active')
    .eq('patient_id', patientId)
    .eq('is_active', true)
    .limit(20)

  if (rules?.length) {
    lines.push(`\n- Beslenme tercihleri/kuralları:`)
    for (const r of rules) {
      lines.push(`  • ${r.name}`)
    }
  }

  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
  const todayName = dayNames[today.getDay()]

  let weekNumber: number | null = null

  // Find active plan and its weeks via diet_plans (diet_weeks has no is_active column)
  const { data: plan, error: planErr } = await supabase
    .from('diet_plans')
    .select('id, diet_weeks(id, week_number, start_date, end_date)')
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (planErr) console.log('[AI Chat] Plan query error:', planErr.message)
  console.log('[AI Chat] Plan found:', !!plan, '| weeks:', plan?.diet_weeks?.length || 0)

  let activeWeek: { id: string; week_number: number } | null = null

  if (plan?.diet_weeks?.length) {
    const sortedWeeks = [...plan.diet_weeks].sort((a: any, b: any) => a.week_number - b.week_number)

    // Find week by date range
    let found = sortedWeeks.find((w: any) => {
      const start = w.start_date
      const end = w.end_date || new Date(new Date(start).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      return todayStr >= start && todayStr <= end
    })

    // Fallback: closest week
    if (!found) {
      const todayTime = new Date(todayStr).getTime()
      let closest = sortedWeeks[0]
      let minDist = Infinity
      for (const w of sortedWeeks) {
        const d = Math.abs(new Date((w as any).start_date).getTime() - todayTime)
        if (d < minDist) { minDist = d; closest = w }
      }
      found = closest
    }

    if (found) {
      activeWeek = { id: (found as any).id, week_number: (found as any).week_number }
    }
  }

  if (activeWeek) {
    weekNumber = activeWeek.week_number || null
    lines.push(`\n- Aktif hafta: ${activeWeek.week_number || '?'}. hafta`)

    // Calculate today's day_number from week start_date
    const weekStart = (plan!.diet_weeks as any[]).find((w: any) => w.id === activeWeek!.id)
    const todayDayNumber = weekStart?.start_date
      ? Math.floor((new Date(todayStr).getTime() - new Date(weekStart.start_date).getTime()) / (24 * 60 * 60 * 1000)) + 1
      : today.getDay() === 0 ? 7 : today.getDay()

    const { data: weekDays, error: daysErr } = await supabase
      .from('diet_days')
      .select(`
        day_number,
        diet_meals (
          meal_time,
          portion_multiplier,
          is_consumed,
          foods:foods!food_id (name, calories, protein, carbs, fat, portion_unit)
        )
      `)
      .eq('diet_week_id', activeWeek.id)
      .order('day_number', { ascending: true })

    if (daysErr) console.log('[AI Chat] Days query error:', daysErr.message)
    console.log('[AI Chat] Days found:', weekDays?.length || 0, '| Today day_number:', todayDayNumber)

    if (weekDays?.length) {
      const todayData = weekDays.find(d => d.day_number === todayDayNumber)
      if (todayData?.diet_meals?.length) {
        let dayCalTotal = 0
        let dayProtTotal = 0
        const todayDateStr = today.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
      lines.push(`\n- Bugünkü plan (${todayName}, ${todayDateStr} — Gün ${todayDayNumber}):`)
        const bySlot = new Map<string, any[]>()
        for (const m of todayData.diet_meals) {
          const slot = m.meal_time || 'Diğer'
          if (!bySlot.has(slot)) bySlot.set(slot, [])
          bySlot.get(slot)!.push(m)
        }
        for (const [slot, meals] of bySlot) {
          lines.push(`  ${slot}:`)
          for (const m of meals) {
            const f = (m as any).foods
            if (!f) continue
            const mult = m.portion_multiplier || 1
            const cal = Math.round((f.calories || 0) * mult)
            const consumed = m.is_consumed ? '✓' : '○'
            const unit = f.portion_unit || 'porsiyon'
            const portionLabel = mult !== 1 ? ` [${mult} ${unit}]` : ''
            lines.push(`    ${consumed} ${f.name}${portionLabel} (${cal} kcal, P:${Math.round((f.protein || 0) * mult)}g)`)
            dayCalTotal += cal
            dayProtTotal += Math.round((f.protein || 0) * mult)
          }
        }
        lines.push(`  Toplam: ${dayCalTotal} kcal, ${dayProtTotal}g protein`)
      }

      // Include other days with meal details so Sera can answer about any day
      const otherDays = weekDays.filter(d => d.day_number !== todayDayNumber)
      for (const day of otherDays) {
        const meals = day.diet_meals || []
        if (!meals.length) continue
        const dayOffset = (day.day_number - 1)
        const dayDate = new Date(new Date(weekStart!.start_date).getTime() + dayOffset * 24 * 60 * 60 * 1000)
        const dayLabel = dayNames[dayDate.getDay()]
        const dayDateStr = dayDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
        let cal = 0
        lines.push(`\n- ${dayLabel}, ${dayDateStr} (Gün ${day.day_number}):`)
        const bySlot = new Map<string, any[]>()
        for (const m of meals) {
          const slot = m.meal_time || 'Diğer'
          if (!bySlot.has(slot)) bySlot.set(slot, [])
          bySlot.get(slot)!.push(m)
        }
        for (const [slot, slotMeals] of bySlot) {
          lines.push(`  ${slot}:`)
          for (const m of slotMeals) {
            const f = (m as any).foods
            if (!f) continue
            const mult = m.portion_multiplier || 1
            const c = Math.round((f.calories || 0) * mult)
            const unit = f.portion_unit || 'porsiyon'
            const pLabel = mult !== 1 ? ` [${mult} ${unit}]` : ''
            lines.push(`    ${f.name}${pLabel} (${c} kcal, P:${Math.round((f.protein || 0) * mult)}g)`)
            cal += c
          }
        }
        lines.push(`  Toplam: ${cal} kcal`)
      }
    }
  }

  // --- SMART FOOD SUGGESTIONS ---
  const focus = detectSortFocus(userMessage)
  const mealSlot = detectMealSlot(userMessage)
  const currentMonth = today.getMonth() + 1

  // 1) Foods already used by this patient's dietitian (vetted)
  const allWeekIds: string[] = []
  if (plan?.diet_weeks) {
    for (const w of plan.diet_weeks as any[]) allWeekIds.push(w.id)
  }
  // Also check other plans
  const { data: otherPlans } = await supabase
    .from('diet_plans')
    .select('diet_weeks(id)')
    .eq('patient_id', patientId)
    .neq('id', plan?.id || '')
    .limit(5)
  if (otherPlans) {
    for (const p of otherPlans) {
      for (const w of (p.diet_weeks || []) as any[]) allWeekIds.push(w.id)
    }
  }

  let vettedFoodIds = new Set<string>()
  if (allWeekIds.length) {
    const { data: usedMeals } = await supabase
      .from('diet_days')
      .select('diet_meals(food_id)')
      .in('diet_week_id', allWeekIds)
    if (usedMeals) {
      for (const d of usedMeals) {
        for (const m of (d.diet_meals || []) as any[]) {
          if (m.food_id) vettedFoodIds.add(m.food_id)
        }
      }
    }
  }

  // 2) Query foods with smart filters: diet flags + meal slot
  // Season filtering done in JS because reversed seasons (e.g. 9-4) can't be filtered with simple lte/gte
  const foodQuery = supabase
    .from('foods')
    .select('id, name, calories, protein, carbs, fat, category, meal_types, keto, lowcarb, season_start, season_end, is_reversed_season')
    .gt('calories', 0)
    .eq('hidden_from_cardmaker', false)

  if (patient.program_template_id) {
    // Lipödem program is typically keto/lowcarb
    foodQuery.eq('lowcarb', true)
  }
  if (mealSlot) {
    foodQuery.contains('meal_types', [mealSlot])
  }

  foodQuery.order(focus.column, { ascending: focus.ascending }).limit(200)
  const { data: rawFoods } = await foodQuery

  // Filter by season in JS (handles reversed seasons like 9-4)
  const allFoods = (rawFoods || []).filter((f: any) => {
    if (!f.season_start || !f.season_end) return true
    if (f.is_reversed_season || f.season_start > f.season_end) {
      return currentMonth >= f.season_start || currentMonth <= f.season_end
    }
    return currentMonth >= f.season_start && currentMonth <= f.season_end
  })

  if (allFoods.length) {
    // Split into vetted (priority) and other
    const vetted = allFoods.filter(f => vettedFoodIds.has(f.id))
    const other = allFoods.filter(f => !vettedFoodIds.has(f.id))

    // Take top from each: vetted first
    const selected = [
      ...vetted.slice(0, 40),
      ...other.slice(0, 20),
    ]

    if (selected.length) {
      const slotLabel = mealSlot === 'breakfast' ? 'kahvaltı' : mealSlot === 'lunch' ? 'öğle' : mealSlot === 'dinner' ? 'akşam' : 'tüm öğünler'
      lines.push(`\n- Uygun besinler (${focus.label} odaklı, ${slotLabel}, mevsime uygun):`)
      if (vetted.length) {
        lines.push(`  [Diyetisyenin daha önce kullandığı besinler]`)
        for (const f of vetted.slice(0, 40)) {
          lines.push(`  • ${f.name} | ${f.calories} kcal | P:${f.protein}g C:${f.carbs}g F:${f.fat}g`)
        }
      }
      if (other.slice(0, 20).length) {
        lines.push(`  [Diğer uygun besinler]`)
        for (const f of other.slice(0, 20)) {
          lines.push(`  • ${f.name} | ${f.calories} kcal | P:${f.protein}g C:${f.carbs}g F:${f.fat}g`)
        }
      }
    }
  }

  // --- SWAP ALTERNATIVE SUGGESTIONS (skorlama motoru) ---
  if (isSwapRequest(userMessage) && allFoods.length) {
    // Collect all food names from the patient's plan
    const planFoodEntries: { name: string; calories: number; protein: number; carbs: number; fat: number; category?: string; mealTypes?: string[] }[] = []
    if (activeWeek && plan?.diet_weeks) {
      const weekData = (plan.diet_weeks as any[]).find((w: any) => w.id === activeWeek!.id)
      // We already have weekDays from earlier query — collect food info
      // Re-query with more details for swap matching
      const { data: swapDays } = await supabase
        .from('diet_days')
        .select(`diet_meals(meal_time, foods:foods!food_id(name, calories, protein, carbs, fat, category, meal_types))`)
        .eq('diet_week_id', activeWeek.id)

      if (swapDays) {
        for (const d of swapDays) {
          for (const m of (d.diet_meals || []) as any[]) {
            const f = m.foods
            if (f?.name) {
              planFoodEntries.push({
                name: f.name,
                calories: f.calories || 0,
                protein: f.protein || 0,
                carbs: f.carbs || 0,
                fat: f.fat || 0,
                category: f.category,
                mealTypes: f.meal_types,
              })
            }
          }
        }
      }
    }

    const planFoodNames = [...new Set(planFoodEntries.map(f => f.name))]
    const targetFoodName = extractFoodNameFromMessage(userMessage, planFoodNames)

    if (targetFoodName) {
      const targetFood = planFoodEntries.find(f => f.name === targetFoodName)
      if (targetFood) {
        const targetNameLower = targetFoodName.toLowerCase()
        const targetCategory = targetFood.category?.toLowerCase()

        // Filter: same category first (sebze→sebze, et→et), then score by macro similarity
        const candidateFoods = allFoods.filter(f => f.name.toLowerCase() !== targetNameLower)

        // Prefer same category — if enough candidates exist in same category, use only those
        const sameCategoryFoods = targetCategory
          ? candidateFoods.filter(f => f.category?.toLowerCase() === targetCategory)
          : candidateFoods
        const pool = sameCategoryFoods.length >= 3 ? sameCategoryFoods : candidateFoods

        const scored = pool
          .map(f => {
            let similarity = scoreMacroSimilarity(targetFood, f)
            // Category match bonus (+15 points)
            if (targetCategory && f.category?.toLowerCase() === targetCategory) {
              similarity = Math.min(100, similarity + 15)
            }
            return {
              ...f,
              similarity,
              isVetted: vettedFoodIds.has(f.id),
            }
          })
          .sort((a, b) => {
            // Vetted foods get priority at equal similarity
            if (a.isVetted !== b.isVetted && Math.abs(a.similarity - b.similarity) < 5) {
              return a.isVetted ? -1 : 1
            }
            return b.similarity - a.similarity
          })

        const top3 = scored.slice(0, 3)
        console.log(`[AI Chat] Swap detected: "${targetFoodName}" (cat: ${targetCategory}) → top3:`, top3.map(f => `${f.name} (${f.category}, ${Math.round(f.similarity)}%)`))
        if (top3.length) {
          lines.push(`\n## HAZIR ALTERNATİF ÖNERİLERİ (Skorlama Motoru — BU ALTERNATİFLERİ KULLAN, başka önerme)`)
          lines.push(`"${targetFoodName}" yerine makro yakınlığı en yüksek 3 alternatif:`)
          for (const alt of top3) {
            const vLabel = alt.isVetted ? ' [Diyetisyen onaylı]' : ''
            lines.push(`  -> ${alt.name} | ${alt.calories} kcal | P:${alt.protein}g C:${alt.carbs}g F:${alt.fat}g | Uyum: %${Math.round(alt.similarity)}${vLabel}`)
          }
          lines.push(`Bu alternatifleri [SECENEK: ...] formatında sun. Hasta birini seçerse [SWAP: ...] formatıyla işle.`)
        }
      }
    }
  }

  const firstName = (patient.full_name || '').split(' ')[0] || 'Hasta'
  return { context: lines.join('\n'), weekNumber, firstName }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, patientId: rawPatientId, isFirstMessage } = await req.json()

    if (!gemini) {
      return new Response(JSON.stringify({ error: 'AI servisi yapılandırılmamış' }), { status: 500 })
    }

    if (!messages?.length || !rawPatientId) {
      return new Response(JSON.stringify({ error: 'Mesaj ve hasta ID gerekli' }), { status: 400 })
    }

    // Resolve actual patient id (rawPatientId might be user_id for legacy patients)
    let patientId = rawPatientId
    const { data: directCheck } = await supabase
      .from('patients')
      .select('id')
      .eq('id', rawPatientId)
      .maybeSingle()

    if (!directCheck) {
      const { data: legacyCheck } = await supabase
        .from('patients')
        .select('id')
        .eq('user_id', rawPatientId)
        .limit(1)
        .maybeSingle()
      if (legacyCheck) patientId = legacyCheck.id
    }
    console.log('[AI Chat] Resolved patientId:', patientId, '(raw:', rawPatientId, ')')

    const lastMessage = messages[messages.length - 1]?.content || ''

    const [{ context: patientContext, weekNumber, firstName }, dietitianName] = await Promise.all([
      buildPatientContext(patientId, lastMessage),
      getDietitianName(patientId),
    ])

    const systemPrompt = buildSystemPrompt(patientContext, dietitianName, isFirstMessage ?? true, weekNumber, firstName)
    console.log('[AI Chat] Patient context length:', patientContext.length, '| Week:', weekNumber, '| Name:', firstName, '| Dietitian:', dietitianName)
    console.log('[AI Chat] Context preview:', patientContext.slice(0, 500))

    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
      tools: [{ googleSearch: {} } as any],
    })

    const chatHistory = messages.slice(0, -1).map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }))

    const chat = model.startChat({ history: chatHistory })

    const result = await chat.sendMessageStream(lastMessage)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.stream) {
            try {
              const text = chunk.text()
              if (text) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`))
              }
            } catch {
              // Google Search grounding chunks may not have text
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          console.error('[AI Chat] Stream error:', err)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream hatası' })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err: any) {
    console.error('[AI Chat] Error:', err)
    return new Response(JSON.stringify({ error: err.message || 'Bir hata oluştu' }), { status: 500 })
  }
}
