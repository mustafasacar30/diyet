import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { target_type, target_value } = body

        if (!target_type || !target_value) {
            return NextResponse.json({ success: false, error: 'target_type and target_value are required' }, { status: 400 })
        }

        let query = supabase.from('foods').select('id, name, category, role, tags').eq('is_active', true)

        switch (target_type) {
            case 'category':
                query = query.ilike('category', `%${target_value}%`)
                break
            case 'role':
                query = query.ilike('role', `%${target_value}%`)
                break
            case 'tag':
                query = query.contains('tags', [target_value])
                break
            case 'name_contains':
                query = query.ilike('name', `%${target_value}%`)
                break
            case 'food_id':
                query = query.eq('id', target_value)
                break
            default:
                return NextResponse.json({ success: false, error: 'Unsupported target_type' }, { status: 400 })
        }

        // Limit results to prevent massive payloads if target is too broad
        const { data: foods, error } = await query.order('name').limit(100)

        if (error) throw error

        return NextResponse.json({
            success: true,
            affected_foods: foods
        })

    } catch (err: any) {
        console.error('affected-foods api error:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}
