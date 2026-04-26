import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const LIPODEM_OWNER = 'mustafasacar30'
const LIPODEM_REPO = 'diyet'

export async function POST(req: NextRequest) {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // 1. Fetch list.json from GitHub
        const listUrl = `https://raw.githubusercontent.com/${LIPODEM_OWNER}/${LIPODEM_REPO}/main/tarifler/list.json`
        const response = await fetch(listUrl, { cache: 'no-store' })
        
        if (!response.ok) {
            return NextResponse.json({ error: 'Failed to fetch list.json from GitHub' }, { status: 502 })
        }

        const cards = await response.json()
        if (!Array.isArray(cards)) {
            return NextResponse.json({ error: 'Invalid list.json format' }, { status: 500 })
        }

        console.log(`Syncing ${cards.length} cards from GitHub...`)

        // 2. Upsert to Supabase
        let successCount = 0
        for (const card of cards) {
            const fileName = typeof card === 'string' ? card : card.name || card.file || ''
            if (!fileName) continue

            const url = `https://raw.githubusercontent.com/${LIPODEM_OWNER}/${LIPODEM_REPO}/main/tarifler/${fileName.endsWith('.jpg') ? fileName : fileName + '.jpg'}`
            const tags = typeof card === 'object' ? card.tags || [] : []

            const { error } = await supabase.from('recipe_cards').upsert({
                filename: fileName.endsWith('.jpg') ? fileName : fileName + '.jpg',
                url: url,
                metadata: { tags }
            }, { onConflict: 'filename' })

            if (!error) successCount++
        }

        return NextResponse.json({ 
            success: true, 
            message: `${successCount} cards synced successfully`,
            total: cards.length
        })

    } catch (error: any) {
        console.error('Recipe sync error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
