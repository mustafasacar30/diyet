import { NextRequest, NextResponse } from 'next/server'

const GITHUB_OWNER = 'mustafasacar35'
const LIPODEM_REPO = 'lipodem-takip-paneli'
const TEMPLATE_REPO = 'kart_hazirlayici'

// Normalize Turkish characters to ASCII for matching
function normalizeTR(str: string): string {
    const charMap: Record<string, string> = {
        'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's',
        'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u',
        'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c',
        'I': 'i'
    }
    return str.replace(/[ıİşŞğĞüÜöÖçÇI]/g, m => charMap[m] || m)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
}

export async function GET(req: NextRequest) {
    try {
        const pat = process.env.GITHUB_PAT
        if (!pat) {
            return NextResponse.json({ error: 'GitHub PAT yapılandırılmamış' }, { status: 503 })
        }

        const headers = {
            'Authorization': `Bearer ${pat}`,
            'Accept': 'application/vnd.github.v3+json',
        }

        // Fetch published cards from lipodem-takip-paneli/tarifler/list.json
        // Returns card names AND their raw GitHub image URLs
        const publishedCards: { name: string, imageUrl: string }[] = []
        try {
            const listUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${LIPODEM_REPO}/contents/tarifler/list.json`
            const res = await fetch(listUrl, { headers, cache: 'no-store' })
            if (res.ok) {
                const fileData = await res.json()
                const content = Buffer.from(fileData.content, 'base64').toString('utf-8')
                const listData = JSON.parse(content)
                if (Array.isArray(listData)) {
                    for (const item of listData) {
                        const fileName = typeof item === 'string' ? item : item?.name || ''
                        if (!fileName) continue
                        const baseName = fileName.replace('.jpg', '')
                        const imageUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${LIPODEM_REPO}/main/tarifler/${fileName.endsWith('.jpg') ? fileName : fileName + '.jpg'}`
                        publishedCards.push({ name: baseName, imageUrl })
                    }
                }
            }
        } catch (e) {
            console.warn('Could not fetch published cards list:', e)
        }

        // Fetch drafts from kart_hazirlayici/drafts/
        // Returns draft base names AND their thumbnail URLs
        const draftCards: { name: string, thumbUrl: string }[] = []
        try {
            const draftsUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${TEMPLATE_REPO}/contents/drafts`
            const res = await fetch(draftsUrl, { headers, cache: 'no-store' })
            if (res.ok) {
                const files = await res.json()
                if (Array.isArray(files)) {
                    // Get JSON draft names
                    const jsonDrafts = files
                        .filter((f: any) => f.name.endsWith('.json'))
                        .map((f: any) => f.name.replace('.json', ''))
                    
                    // Match with thumb_ images
                    const thumbFiles = files.filter((f: any) => f.name.startsWith('thumb_'))
                    
                    for (const draftName of jsonDrafts) {
                        const thumbFile = thumbFiles.find((t: any) => t.name.includes(draftName))
                        const thumbUrl = thumbFile 
                            ? `https://raw.githubusercontent.com/${GITHUB_OWNER}/${TEMPLATE_REPO}/main/drafts/${thumbFile.name}`
                            : ''
                        draftCards.push({ name: draftName, thumbUrl })
                    }
                }
            }
        } catch (e) {
            console.warn('Could not fetch drafts list:', e)
        }

        return NextResponse.json({
            publishedCards,
            draftCards,
        })
    } catch (error: any) {
        console.error('GitHub sync check error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
