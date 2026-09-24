
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabaseAdmin as supabase } from '../../../../lib/supabase-admin';

// Initialize Supabase Client (Lazy loaded via lib/supabase-admin)
// const supabase = ... (Removed manual init)

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
    try {
        const { name } = await req.json();

        if (!name) {
            return NextResponse.json({ error: 'Micronutrient name is required' }, { status: 400 });
        }

        // 1. Fetch System Prompt
        const { data: promptData, error: promptError } = await supabase
            .from('system_prompts')
            .select('prompt_text')
            .eq('prompt_type', 'ai_micronutrient_extraction') // distinctive key
            .single();

        let systemPrompt = "";
        if (promptError || !promptData) {
            console.warn("System prompt not found, using fallback.");
            systemPrompt = `
                Sen uzman bir diyetisyen ve biyokimya uzmanısın.
                Kullanıcı sana bir MİKROBESİN (Vitamin/Mineral) veya KAN TAHLİLİ PARAMETRESİ adı verecek.
                Senin görevin bu parametre ile ilgili yapılandırılmış JSON verisi üretmek.

                Çıktı Formatı (JSON):
                {
                    "category": "mikrobesin" | "kan_tahlili", // Vitamin/Mineral ise 'mikrobesin', Tahlil/Hormon ise 'kan_tahlili'
                    "unit": "string", // Yaygın kullanılan birim (ör: "mg", "µg", "pg/mL", "U/L")
                    "default_min": number, // Sağlıklı bir yetişkin için varsayılan minimum referans değeri
                    "default_max": number, // Sağlıklı bir yetişkin için varsayılan maksimum referans değeri
                    "compatible_foods": [ // Bu değerin iyileşmesini sağlayan, emilimini artıran veya zengin kaynak olan 3-5 gıda/etken
                        { 
                            "keyword": "string", 
                            "mechanism": "string", // [Destekleyici]: Neden iyi? MUTLAKA DOLU OLMALI. (Örn: "Doğal kalsiferol kaynağıdır" veya "Mide asidini destekleyerek emilimi artırır")
                            "advice": "string", // [Öneri]: Nasıl/Ne kadar tüketilmeli? MUTLAKA DOLU OLMALI. (Örn: "Haftada 2-3 porsiyon ızgara tüketin" veya "C vitamini ile birlikte alın")
                            "match_type": "compatible" 
                        }
                    ],
                    "incompatible_foods": [ // Bu değerin emilimini bozan, seviyesini düşüren İLAÇLAR VE GIDALAR
                        { 
                            "keyword": "string", 
                            "mechanism": "string", // [Uyarı]: Neden kötü? (Örn: "Mide asidini nötralize ederek B12 emilimini bozar" veya "Fitik asit demiri bağlar")
                            "advice": "string", // [Öneri]: Nasıl yönetilmeli? (Örn: "İlaçtan en az 2 saat sonra tüketin" veya "Çay ile birlikte tüketmeyin")
                            "match_type": "incompatible" 
                        }
                    ]
                }

                Kurallar:
                1. "keyword": Tekil, aranabilir gıda, İLAÇ GRUBU veya etken madde adı olmalı.
                2. "incompatible_foods" kısmında, İLAÇLARA EK OLARAK, emilimi bozan GIDALARI (Tahıllar, Pirinç, Arpa, Çay, Kahve, Süt Ürünleri vb.) veya BİLEŞENLERİ (Fitik asit, Okzalat, Tanen) MUTLAKA belirt. Sadece ilaç yazma, besin etkileşimlerini de yaz.
                3. "mechanism" (Destekleyici/Uyarı) ve "advice" (Öneri) alanları HER İKİ TÜR İÇİN DE (uyumlu/uyumsuz) MUTLAKA DOLU OLMALIDIR. Boş bırakma.
                4. "mechanism" alanında biyokimyasal/fizyolojik nedeni açıkla.
                5. "advice" alanında pratik beslenme tavsiyesi ver.
                6. Eğer parametre bir hastalık veya ilaç ise, lütfen bunu micronutrient formatına uydurmaya çalışma, null döndür.
            `;
        } else {
            systemPrompt = promptData.prompt_text;
        }

        // 2. Call Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: `Analiz Edilecek Parametre: ${name}\n\n${systemPrompt}` }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const response = result.response;
        const text = response.text();
        const aiData = JSON.parse(text);

        return NextResponse.json(aiData);

    } catch (error: any) {
        console.error('AI Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
