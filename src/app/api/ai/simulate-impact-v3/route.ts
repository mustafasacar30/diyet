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
    const { rules, patient_id } = body

    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return NextResponse.json({ success: false, error: 'Kurallar bulunamadı.' }, { status: 400 })
    }

    let patientContext = ''
    if (patient_id) {
       const { data: patient } = await supabase.from('patients').select('diet_type').eq('id', patient_id).single()
       if (patient && patient.diet_type) {
           patientContext = `Hastanın Diyet Türü: ${patient.diet_type}`
       }
    }

    const rulesText = rules.map((r: any, i: number) => `${i+1}. Kural: ${r.name} - ${r.description}`).join('\n')

    const prompt = `
Sen "Sera" adında uzman bir Yapay Zeka Diyet Asistanısın.
Kullanıcı (hasta) az önce şu beslenme kurallarının menüsüne eklenmesini istedi:
${rulesText}

${patientContext}

Sistemimizde "Auto-Balance (Dengeleme)" adında çok güçlü bir matematiksel motor bulunuyor. Bu motor iki şeye bakar:
1. Makro/Kalori Dengesi: Kullanıcının istediği kural (örneğin yumurtayı haftada 2 gün istemek) karbonhidrat, protein veya kalori bütçesini patlatır mı? Eğer patlatırsa, motor DİĞER öğünlerdeki porsiyonları küçülterek bunu dengelemek zorundadır. Ketojenik diyette aşırı yumurta veya kuruyemiş kalori limitini zorlayabilir.
2. Lezzet/Uyum Dengesi: Kullanıcının istediği yemekler aynı öğünde yan yana geldiğinde "iki kuru yiyecek" veya "birbirine yakışmayan lezzetler" sorunu yaratır mı? Motor böyle bir durumda menüye sulu bir yemek eklemek veya yiyeceklerden birini değiştirmek zorunda kalır.

GÖREVİN:
Verilen kuralları (veya KURAL PAKETİNİ) diyetisyen zekasıyla analiz et. Eğer listede birden fazla kural varsa, sadece ilk kurala takılıp kalma; tüm kuralların birlikte oluşturduğu BÜTÜNSEL ETKİYİ yorumla. Özellikle listeye en son eklenen kuralın, paketin makro ve lezzet dengesine nasıl bir katkı/zorluk getirdiğini vurgula.
Bunu hastaya, "Kuralınızın Olası Etkileri" başlığı altında, 2 madde (1. Makro Dengesi, 2. Lezzet ve Uyum) halinde, Şef/Diyetisyen diliyle, nazikçe ve KISA bir şekilde uyararak anlat.
Eğer kurallar çok basitse, "Bu tercihiniz (veya kural paketiniz) makro/lezzet dengenizi olumsuz etkilemeyecektir." gibi olumlu bir dönüş yap. Ancak birden fazla kural varsa, birbirleriyle nasıl bir uyum/çelişki içinde olduklarını 1-2 cümleyle Diyetisyen gözüyle mutlaka yorumla.
Asla "Ben bir yapay zekayım" falan deme. Sistemi kendi araçların gibi anlat ("Sistemimiz", "Dengeleme asistanımız" vb).
Korkutucu bir dil yerine, "Eğer bunu onaylarsanız, dengeyi sağlamak için porsiyonları kısmam gerekecek, onaylıyor musunuz?" gibi bir ön izleme dili kullan.

Cevabını doğrudan hastaya verilecek düz metin olarak döndür. Ekstra açıklama ekleme.
ÇOK ÖNEMLİ: KESİNLİKLE markdown karakterleri (**, *, #) KULLANMA! Kelimeleri kalın veya italik yapmak için hiçbir özel sembol (asterisk vs) kullanma. Başlık numaraları olarak sadece rakam kullan (1., 2. gibi). Tamamen sade, düz metin ver.
`

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

    return NextResponse.json({ success: true, simulation_report: text })
  } catch (error: any) {
    console.error('Simulate API error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
