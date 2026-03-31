import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    
    if (!query) {
        return NextResponse.json({ error: 'Arama koşulu gereklidir.' }, { status: 400 });
    }

    const apikey = process.env.UNSPLASH_ACCESS_KEY;
    if (!apikey) {
        return NextResponse.json({ error: 'UNSPLASH_ACCESS_KEY bulunamadı. Lütfen .env.local dosyasına ekleyin.' }, { status: 500 });
    }

    let finalQuery = query;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
        try {
            const translateBody = {
               contents: [{parts:[{text:`Translate the following food/ingredient search query from Turkish to English. Reply ONLY with the English translation, nothing else. Query: "${query}"`}]}]
            };
            const tRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
               method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(translateBody)
            });
            if (tRes.ok) {
               const tData = await tRes.json();
               const englishText = tData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
               if (englishText) finalQuery = englishText;
            }
        } catch (e) {
            console.error("Gemini translation error:", e);
        }
    }

    try {
        const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(finalQuery)}&per_page=12&orientation=landscape`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `Client-ID ${apikey}`
            }
        });

        if (!res.ok) {
            throw new Error(`Unsplash API Error: ${res.status}`);
        }

        const data = await res.json();
        
        const results = data.results.map((img: any) => ({
            id: img.id,
            url: img.urls.regular,
            thumbnail: img.urls.small,
            author: img.user.name
        }));

        return NextResponse.json({ results });
    } catch (error: any) {
        console.error('Image search proxy error:', error);
        return NextResponse.json({ error: 'Görsel aranırken bir hata oluştu.' }, { status: 500 });
    }
}
