import { NextResponse } from 'next/server';

// Proxy to bypass CORS for canvas base64 conversion
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
        return NextResponse.json({ error: 'URL gereklidir.' }, { status: 400 });
    }

    try {
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error('Failed to fetch image');

        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = res.headers.get('content-type') || 'image/jpeg';
        
        const base64 = buffer.toString('base64');

        return NextResponse.json({ base64, mimeType });
    } catch (error: any) {
        console.error('Image proxy conversion error:', error);
        return NextResponse.json({ error: 'Görsel indirilemedi.' }, { status: 500 });
    }
}
