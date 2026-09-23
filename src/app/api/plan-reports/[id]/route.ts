import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 })

        const { data, error } = await supabase
            .from('plan_generation_reports')
            .select('*')
            .eq('id', id)
            .single()

        if (error) {
            return NextResponse.json({ success: false, error: error.message }, { status: 404 })
        }
        return NextResponse.json({ success: true, report: data })
    } catch (e: any) {
        return NextResponse.json({ success: false, error: e.message || 'Unknown error' }, { status: 500 })
    }
}
