import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const {
            keyword,
            score,
            scope = 'patient',
            patient_id,
            program_template_id,
            team_owner_id,
            user_id,
        } = body

        if (!keyword || typeof keyword !== 'string' || keyword.trim().length < 2) {
            return NextResponse.json({ success: false, error: 'Anahtar kelime en az 2 karakter olmalı.' }, { status: 400 })
        }
        if (score === undefined || score < 0 || score > 10) {
            return NextResponse.json({ success: false, error: 'Skor 0-10 arası olmalı.' }, { status: 400 })
        }

        // Find matching foods by keyword (name or tags)
        const searchTerm = keyword.trim().toLowerCase()
        const { data: foods } = await supabase
            .from('foods')
            .select('id, name, tags')
            .or(`name.ilike.%${searchTerm}%`)
            .limit(200)

        if (!foods || foods.length === 0) {
            return NextResponse.json({
                success: true,
                updated_count: 0,
                message: `"${keyword}" ile eşleşen yemek bulunamadı.`,
                matched_foods: [],
            })
        }

        // Also check tags match
        const matchedFoods = foods.filter(f => {
            const nameMatch = f.name.toLowerCase().includes(searchTerm)
            const tagMatch = (f.tags || []).some((t: string) => t.toLowerCase().includes(searchTerm))
            return nameMatch || tagMatch
        })

        if (matchedFoods.length === 0) {
            return NextResponse.json({
                success: true,
                updated_count: 0,
                message: `"${keyword}" ile eşleşen yemek bulunamadı.`,
                matched_foods: [],
            })
        }

        // Get current settings for this scope
        let scopeFilter: any = { scope }
        if (scope === 'patient' && patient_id) scopeFilter.patient_id = patient_id
        else if (scope === 'program' && program_template_id) scopeFilter.program_template_id = program_template_id
        else if (scope === 'team' && team_owner_id) scopeFilter.team_owner_id = team_owner_id

        let query = supabase.from('planner_settings').select('id, food_score_overrides')
        for (const [key, val] of Object.entries(scopeFilter)) {
            query = query.eq(key, val)
        }
        const { data: settings } = await query.maybeSingle()

        const currentOverrides = settings?.food_score_overrides || {}
        const newOverrides = { ...currentOverrides }

        for (const food of matchedFoods) {
            newOverrides[food.id] = score
        }

        if (settings) {
            await supabase
                .from('planner_settings')
                .update({ food_score_overrides: newOverrides })
                .eq('id', settings.id)
        } else {
            await supabase.from('planner_settings').insert({
                user_id: user_id || null,
                scope,
                patient_id: scope === 'patient' ? patient_id : null,
                program_template_id: scope === 'program' ? program_template_id : null,
                team_owner_id: scope === 'team' ? team_owner_id : null,
                food_score_overrides: newOverrides,
            })
        }

        return NextResponse.json({
            success: true,
            updated_count: matchedFoods.length,
            message: `"${keyword}" ile eşleşen ${matchedFoods.length} yemeğin skoru ${score} olarak ayarlandı.`,
            matched_foods: matchedFoods.map(f => ({ id: f.id, name: f.name })),
        })

    } catch (err: any) {
        console.error('[food-score API]', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}
