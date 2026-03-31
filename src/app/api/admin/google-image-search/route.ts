import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Simple in-memory daily rate limiter (resets on server restart)
let dailyCount = 0;
let lastResetDate = new Date().toDateString();
const DAILY_LIMIT = 99;

function checkAndIncrementLimit(): boolean {
    const today = new Date().toDateString();
    if (today !== lastResetDate) {
        dailyCount = 0;
        lastResetDate = today;
    }
    if (dailyCount >= DAILY_LIMIT) {
        return false;
    }
    dailyCount++;
    return true;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query) {
        return NextResponse.json({ error: 'Arama koşulu gereklidir.' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;

    if (!apiKey || !cx) {
        return NextResponse.json({
            error: 'Google Search API yapılandırılmamış. GOOGLE_SEARCH_API_KEY ve GOOGLE_SEARCH_ENGINE_ID .env.local dosyasına ekleyin.'
        }, { status: 500 });
    }

    // Rate limit check
    if (!checkAndIncrementLimit()) {
        return NextResponse.json({
            error: `Günlük Google arama limiti doldu (${DAILY_LIMIT}/${DAILY_LIMIT}). Yarın tekrar deneyin.`,
            limitReached: true,
            remaining: 0
        }, { status: 429 });
    }

    try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&searchType=image&num=10&imgSize=large&safe=active`;

        const res = await fetch(url);

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.error('Google Search API Error:', res.status, errData);
            if (res.status === 403) {
                return NextResponse.json({ error: 'Google Custom Search API etkinleştirilmemiş. Google Cloud Console üzerinden "Custom Search API"yi aktifleştirin.' }, { status: 403 });
            }
            throw new Error(`Google API Error: ${res.status}`);
        }

        const data = await res.json();

        const results = (data.items || []).map((item: any) => ({
            id: item.cacheId || item.link,
            url: item.link,
            thumbnail: item.image?.thumbnailLink || item.link,
            title: item.title,
            source: item.displayLink
        }));

        return NextResponse.json({
            results,
            remaining: DAILY_LIMIT - dailyCount
        });
    } catch (error: any) {
        console.error('Google image search error:', error);
        return NextResponse.json({ error: 'Google görsel aramasında hata oluştu.' }, { status: 500 });
    }
}
