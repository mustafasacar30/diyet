import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { SmartAnalyzer } from '@/lib/analyzer/smart-analyzer'

export async function GET(request: Request) {
    try {
        const analyzer = new SmartAnalyzer()
        const insights = await analyzer.runAnalysis()
        return NextResponse.json(insights)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { action, insightId, proposedRule } = body

        const analyzer = new SmartAnalyzer()

        if (action === 'dismiss') {
            await analyzer.dismissInsight(insightId)
            return NextResponse.json({ success: true })
        }

        if (action === 'approve') {
            if (!proposedRule) {
                return NextResponse.json({ error: 'Missing proposedRule' }, { status: 400 })
            }

            // Insert into planning_rules
            const { error } = await supabase.from('planning_rules').insert(proposedRule)
            if (error) {
                return NextResponse.json({ error: error.message }, { status: 500 })
            }

            // Also dismiss it so it doesn't show up again
            await analyzer.dismissInsight(insightId)
            return NextResponse.json({ success: true })
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
