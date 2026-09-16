import { NextResponse } from 'next/server'
import { gemini } from '@/lib/gemini'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const body = await req.json()
    const { patient_id } = body

    if (!patient_id) {
      return NextResponse.json({ success: false, error: 'Hasta ID eksik.' }, { status: 400 })
    }

    // Hastanın aktif kurallarını çek
    const { data: rules, error: rulesError } = await supabase
      .from('planning_rules')
      .select('*')
      .eq('patient_id', patient_id)
      .eq('is_active', true)
      .eq('pending_global_approval', false)

    if (rulesError) throw rulesError

    if (!rules || rules.length === 0) {
       return NextResponse.json({ 
         success: true, 
         summary: "Şu anda menünüz için tanımlanmış aktif bir özel kuralınız veya tercihiniz bulunmuyor. Sera asistanı kullanarak yeni kurallar ekleyebilirsiniz." 
       })
    }

    // Hastanın genel bilgilerini çek
    let patientContext = ''
    const { data: patient } = await supabase.from('patients').select('diet_type').eq('id', patient_id).single()
    if (patient && patient.diet_type) {
        patientContext = `Hastanın Diyet Türü: ${patient.diet_type}`
    }

    const rulesText = rules.map((r: any, i: number) => `${i+1}. Kural: ${r.name} - ${r.description}`).join('\n')

    const prompt = `Sen uzman ve profesyonel bir diyetisyensin.
Kullanıcı (hasta) senden şu anki AKTİF beslenme programının ve tercihlerinin bir özetini istiyor.

Hastanın şu anki aktif tercihleri ve kuralları şunlar:
${rulesText}

${patientContext}

GÖREVİN VE KESİN KURALLAR:
1. KESİNLİKLE "Merhaba ben Sera", "Size sunmaktan mutluluk duyarım", "İşte programınız" gibi yapay ve abartılı giriş/çıkış cümleleri KULLANMA. Doğrudan konuya gir (Örn: "Şu anki programınıza baktığımızda...").
2. KESİNLİKLE MARKDOWN (**, *, # gibi) işaretleri KULLANMA. Dümdüz, temiz metin (plain text) yaz. Kalınlaştırma veya yıldız işareti OLMASIN.
3. Metni tek bir sıkışık blok halinde YAZMA. Mantıksal bölümlere ayır (örneğin: Genel düzen, Kahvaltı, Ana Öğünler, Atıştırmalıklar) ve en az 3-4 kısa paragrafa böl. Paragraflar arasında boşluk olsun.
4. KESİNLİKLE "7.7 porsiyon", "ortalama 3.2" gibi küsuratlı, virgüllü, matematiksel ve robotik sayılar/istatistikler KULLANMA. İnsani, yuvarlak ve doğal bir dil kullan.
5. "1. kural, 2. kural" veya "zorunlu", "şart", "gerekiyor" gibi mekanik, buyurgan ifadeler kullanma. 
6. Tercihleri ve kuralları HAFİFÇE GEREKÇELENDİRerek anlat. (Örn: "İçecek zorunlu" demek yerine, "Sindirimi rahatlatması ve ferahlık vermesi için menünüze bir içecek de ekliyoruz" gibi beslenmeye dayalı tatlı sebepler sun.)
7. Sadece oluşturduğun bu temiz metni döndür.`

    const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai')

    if (!gemini) {
      return NextResponse.json({ success: false, error: 'Gemini API anahtarı yapılandırılmamış.' }, { status: 500 })
    }

    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    })

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    return NextResponse.json({ success: true, summary: text })
  } catch (error: any) {
    console.error('Summarize API error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
