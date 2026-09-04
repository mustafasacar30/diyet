import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

export async function POST(req: NextRequest) {
    try {
        if (!genAI) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 503 });
        }

        const { query, count = 10, calorieGap } = await req.json();

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'query (string) required' }, { status: 400 });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const calorieHint = calorieGap ? `\nKullanıcının kalori açığı yaklaşık ${Math.round(calorieGap)} kcal. Bulabilirsen bu kaloriye yakın porsiyonlar veya varyasyonlar öner, ancak asıl önceliğin "${query}" içeriğidir.` : '';

        const prompt = `
Sen uzman bir Türk diyetisyensin. Kullanıcı "${query}" yemeğini aradı ama veritabanında bulamadı.
${calorieHint}

GÖREVİN:
1. KESİNLİKLE "${query}" kelimesini/içeriğini barındıran veya doğrudan bununla ilgili ${count} adet Türk mutfağından yemek önerisi oluştur (örn: Zeytinyağlı ${query}, Etli ${query}, vb.).
2. Eğer "bezelye" gibi spesifik bir besin arandıysa, alakasız yemekler ÖNERME. Tamamen bu besin etrafında dönen yemekler öner.
3. Her biri için standart 1 porsiyon makro değerlerini tahmin et.

JSON ŞEMA (sadece JSON döndür, markdown code block kullanma):
{
  "suggestions": [
    {
      "name": "Standart Türkçe yemek adı",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "category": "Kategori (Çorba, Ana Yemek, Meyve, Sebze, vb.)"
    }
  ]
}

KURALLAR:
- Kalori = (Protein × 4) + (Karb × 4) + (Yağ × 9) formülüyle tutarlı olsun.
- Yemek adları Türkçe ve standart olsun.
- Gerçekçi, USDA/Türk besin tablosuna yakın değerler ver.
- Tam olarak ${count} adet öneri döndür.
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
        console.error('AI Food Suggestions Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
