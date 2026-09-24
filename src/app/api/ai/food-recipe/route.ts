import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

export async function POST(req: NextRequest) {
    try {
        if (!genAI) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 503 });
        }

        const { foodName, calories, protein, carbs, fat } = await req.json();

        if (!foodName || typeof foodName !== 'string') {
            return NextResponse.json({ error: 'foodName (string) required' }, { status: 400 });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const macroHint = calories ? `\nBu yemeğin yaklaşık değerleri: ${Math.round(calories)} kcal, Protein: ${Math.round(protein || 0)}g, Karbonhidrat: ${Math.round(carbs || 0)}g, Yağ: ${Math.round(fat || 0)}g. Tarifi bu makro değerlere uygun ver.` : '';

        const prompt = `
Sen uzman bir Türk diyetisyensin ve aşçısın. "${foodName}" yemeğinin pratik tarifini ver.
${macroHint}

GÖREVİN:
1. Standart 1 porsiyon için malzeme listesi oluştur.
2. Kısa ve pratik tarif yaz (4-6 adım).
3. Hazırlama süresi ve pişirme süresini tahmin et.
4. Varsa sağlıklı ipucu ver (1-2 cümle).

JSON ŞEMA (sadece JSON döndür, markdown code block kullanma):
{
  "food_name": "${foodName}",
  "serving": "1 porsiyon (~gramaj tahmini)",
  "prep_time": "10 dk",
  "cook_time": "20 dk",
  "ingredients": [
    { "name": "Malzeme adı", "amount": "1", "unit": "adet" }
  ],
  "steps": [
    "Adım 1 açıklaması.",
    "Adım 2 açıklaması."
  ],
  "tip": "Sağlıklı ipucu (opsiyonel, kısa)"
}

KURALLAR:
- Malzeme adları Türkçe olsun.
- Tarif adımları kısa ve anlaşılır olsun, gereksiz detay verme.
- Porsiyon miktarı diyete uygun (aşırı büyük değil).
- Gerçekçi, uygulanabilir bir tarif ver.
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
        console.error('AI Food Recipe Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
