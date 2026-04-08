import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: Request) {
    try {
        const cookieStore = await cookies()

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll()
                    },
                    setAll() {
                        // no-op in route handler
                    },
                },
            }
        )

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const { full_name, title, logo_url, pdf_footer_text } = body || {}

        const { data: callerProfile, error: callerError } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if (callerError || !callerProfile || !['doctor', 'dietitian'].includes(callerProfile.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const updates: Record<string, string | null> = {}
        if (full_name !== undefined) updates.full_name = full_name
        if (title !== undefined) updates.title = title
        if (logo_url !== undefined) updates.logo_url = logo_url
        if (pdf_footer_text !== undefined) updates.pdf_footer_text = pdf_footer_text

        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update(updates)
            .eq('id', user.id)

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('full_name, title, logo_url, pdf_footer_text')
            .eq('id', user.id)
            .single()

        if (profileError) {
            return NextResponse.json({ error: profileError.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, profile })
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 })
    }
}
