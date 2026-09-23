import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/plan-reports
// Saves a plan generation report (karar raporu + plan snapshot + hedef makrolar).
export async function POST(request: Request) {
    try {
        const body = await request.json()
        const {
            patient_id,
            diet_plan_id,
            week_id,
            week_number,
            source,
            generated_by_user_id,
            target_macros,
            weekly_totals,
            active_rules_summary,
            logs,
            plan_snapshot,
            label
        } = body

        if (!patient_id) {
            return NextResponse.json({ success: false, error: 'patient_id required' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('plan_generation_reports')
            .insert({
                patient_id,
                diet_plan_id: diet_plan_id || null,
                week_id: week_id || null,
                week_number: week_number ?? null,
                source: source || 'system',
                generated_by_user_id: generated_by_user_id || null,
                target_macros: target_macros || null,
                weekly_totals: weekly_totals || null,
                active_rules_summary: active_rules_summary || null,
                logs: logs || null,
                plan_snapshot: plan_snapshot || null,
                label: label || null
            })
            .select('id')
            .single()

        if (error) {
            console.error('[plan-reports] insert error:', error)
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, id: data.id })
    } catch (e: any) {
        console.error('[plan-reports] POST error:', e)
        return NextResponse.json({ success: false, error: e.message || 'Unknown error' }, { status: 500 })
    }
}

// GET /api/plan-reports?patient_id=...&limit=20
export async function GET(request: Request) {
    try {
        const url = new URL(request.url)
        const patient_id = url.searchParams.get('patient_id')
        const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)

        if (!patient_id) {
            return NextResponse.json({ success: false, error: 'patient_id required' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('plan_generation_reports')
            .select('id, generated_at, source, generated_by_user_id, week_number, target_macros, weekly_totals, label')
            .eq('patient_id', patient_id)
            .order('generated_at', { ascending: false })
            .limit(limit)

        if (error) {
            console.error('[plan-reports] list error:', error)
            return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, reports: data || [] })
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message || 'Unknown error' }, { status: 500 })
    }
}
