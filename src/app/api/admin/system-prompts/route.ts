import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from('system_prompts')
            .select('key, prompt_template, model, temperature')
            .eq('is_active', true)

        if (error) {
            console.error('Error fetching system prompts:', error)
            return NextResponse.json({ error: 'Failed to fetch prompts' }, { status: 500 })
        }

        // Return an object keyed by prompt key for easy lookup in the frontend
        const promptMap = data.reduce((acc: any, curr: any) => {
            acc[curr.key] = {
                template: curr.prompt_template,
                model: curr.model,
                temperature: curr.temperature
            }
            return acc
        }, {})

        return NextResponse.json({ prompts: promptMap })
    } catch (error: any) {
        console.error('System prompts API Error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
