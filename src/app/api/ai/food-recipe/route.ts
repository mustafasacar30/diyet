import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const apiKey = process.env.GEMINI_API_KEY || '';

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
2. Hazırlama tarifini düz bir paragraf olarak yaz (madde madde değil, akıcı bir anlatım). Kısa ve pratik tut.
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
  "preparation": "Tüm hazırlama adımlarını tek bir akıcı paragraf olarak yaz.",
  "tip": "Sağlıklı ipucu (opsiyonel, kısa)"
}

KURALLAR:
- Malzeme adları Türkçe olsun.
- "preparation" alanı tek düz paragraf olsun, adım numarası veya madde işareti kullanma.
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

        // Convert old steps array to preparation paragraph if needed
        if (data.steps && !data.preparation) {
            data.preparation = data.steps.join(' ');
        }
        delete data.steps;

        // Generate food image with Gemini native image generation
        let imageUrl = null;
        try {
            const imagePrompt = `Generate a high-quality food photography image of "${foodName}". Beautifully plated on a clean plate, professional presentation, appetizing, warm natural light, high detail. ABSOLUTELY NO TEXT, NO WORDS, NO LABELS, NO WATERMARKS, NO LOGOS in the image. Pure photograph only.`;

            const imageGenUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(apiKey)}`;
            const imageGenRes = await fetch(imageGenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: imagePrompt }] }],
                    generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
                })
            });

            if (imageGenRes.ok) {
                const imageGenData = await imageGenRes.json();
                const parts = imageGenData?.candidates?.[0]?.content?.parts || [];
                for (const part of parts) {
                    if (part.inlineData?.mimeType?.startsWith('image/')) {
                        imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        break;
                    }
                }
            } else {
                const errText = await imageGenRes.text();
                console.warn('Image generation API error:', imageGenRes.status, errText);
            }
        } catch (imgErr) {
            console.warn('Image generation failed (non-critical):', imgErr);
        }

        data.image_url = imageUrl;

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('AI Food Recipe Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
