import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

export async function POST(req: NextRequest) {
    try {
        if (!genAI) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 503 });
        }

        const { query } = await req.json();

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'query (string) required' }, { status: 400 });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
Sen uzman bir Türk diyetisyensin. Kullanıcı şunu yazdı: "${query}"

GÖREVİN:
1. Yiyecek adını Türkçe olarak standartlaştır.
2. Miktarı belirle (kullanıcı "2 çilek" dediyse miktar=2, birim=adet).
3. BU MİKTAR İÇİN makro değerlerini (Protein, Karb, Yağ) hesapla.
4. Kalori = (Protein × 4) + (Karb × 4) + (Yağ × 9) formülüyle hesapla.
5. USDA veya resmi besin değeri tablolarına göre değerleri ver.

BİRİM KURALLARI:
- Geçerli birimler: adet, tane, porsiyon, dilim, gram, gr, ml, litre, bardak, yemek kaşığı, tatlı kaşığı, çay kaşığı, kase, kepçe, avuç, yaprak, dal
- Kullanıcı birim belirtmediyse en uygun birimi seç (meyve için "adet", sıvı için "bardak" vb.)

JSON ŞEMA (sadece JSON döndür, markdown code block kullanma):
{
  "food_name": "Standart Türkçe yiyecek adı",
  "quantity": 2,
  "unit": "adet",
  "portion_guess": "2 adet (~60g)",
  "calories": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "per_unit_protein": 0,
  "per_unit_carbs": 0,
  "per_unit_fat": 0
}

ÖNEMLİ:
- "per_unit_*" değerleri 1 birim (1 adet, 1 dilim vb.) için olan değerlerdir.
- Üstteki protein/carbs/fat toplam (quantity × per_unit) olmalıdır.
- Kalori formülden hesaplanmalıdır.
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        let jsonString = text.replace(/```json\s*|\s*```/g, '').trim();
        let data;

        try {
            data = JSON.parse(jsonString);
        } catch (e) {
            console.error("JSON Parse Error:", text);
            return NextResponse.json({ error: "AI yanıtı ayrıştırılamadı" }, { status: 500 });
        }

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('AI Food Estimate Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
