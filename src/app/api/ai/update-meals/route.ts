import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const { patient_id, program_template_id, team_owner_id, slots } = body

        if (!patient_id) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 })
        }
        if (!slots || !Array.isArray(slots)) {
            return NextResponse.json({ success: false, error: 'slots array is required' }, { status: 400 })
        }

        // Fetch all relevant settings to merge (global, team, program, patient)
        const orConditions = ['scope.eq.global']
        if (team_owner_id) orConditions.push(`and(scope.eq.team,team_owner_id.eq.${team_owner_id})`)
        if (program_template_id) orConditions.push(`and(scope.eq.program,program_template_id.eq.${program_template_id})`)
        orConditions.push(`and(scope.eq.patient,patient_id.eq.${patient_id})`)

        const { data: allSettings, error: fetchError } = await supabase
            .from('planner_settings')
            .select('*')
            .or(orConditions.join(','))

        if (fetchError) throw fetchError

        // Merge logic
        let mergedData: any = {}
        let existingPatientRecord = null

        const layers = ['global', 'team', 'program', 'patient']
        for (const layer of layers) {
            const row = allSettings?.find((r: any) => r.scope === layer)
            if (row) {
                if (layer === 'patient') existingPatientRecord = row
                Object.keys(row).forEach(key => {
                    if (row[key] !== null) mergedData[key] = row[key]
                })
            }
        }

        let currentSlotConfigs = Array.isArray(mergedData.slot_config) ? [...mergedData.slot_config] : []
        
        if (currentSlotConfigs.length === 0) {
            currentSlotConfigs = [
                { name: 'KAHVALTI', min_items: 2, max_items: 4, requiredRoles: ['mainDish'] },
                { name: 'ÖĞLEN', min_items: 2, max_items: 4, requiredRoles: ['mainDish'] },
                { name: 'AKŞAM', min_items: 2, max_items: 4, requiredRoles: ['mainDish'] }
            ]
        }

        for (const aiSlot of slots) {
            const action = aiSlot.action || 'add_or_update'
            const targetName = aiSlot.name.toUpperCase()
            const existingIndex = currentSlotConfigs.findIndex(s => s.name.toUpperCase() === targetName)

            if (action === 'delete') {
                if (existingIndex >= 0) {
                    currentSlotConfigs.splice(existingIndex, 1)
                }
            } else {
                if (existingIndex >= 0) {
                    if (aiSlot.min_items !== undefined) currentSlotConfigs[existingIndex].min_items = aiSlot.min_items
                    if (aiSlot.max_items !== undefined) currentSlotConfigs[existingIndex].max_items = aiSlot.max_items
                } else {
                    currentSlotConfigs.push({
                        name: targetName,
                        min_items: aiSlot.min_items || 1,
                        max_items: aiSlot.max_items || 2
                    })
                }
            }
        }

        // Mantıksal sıralama
        const MEAL_ORDER: Record<string, number> = {
            'GEÇ KAHVALTI': 1,
            'KAHVALTI': 2,
            'ARA ÖĞÜN': 3,
            '1. ARA ÖĞÜN': 3,
            'ÖĞLEN': 4,
            '2. ARA ÖĞÜN': 5,
            'AKŞAM': 6,
            'GECE ÖĞÜNÜ': 7
        }

        currentSlotConfigs.sort((a: any, b: any) => {
            const orderA = MEAL_ORDER[a.name.toUpperCase()] || 99;
            const orderB = MEAL_ORDER[b.name.toUpperCase()] || 99;
            return orderA - orderB;
        });

        const payload = {
            ...mergedData,
            scope: 'patient',
            patient_id: patient_id,
            team_owner_id: team_owner_id || null,
            program_template_id: null,
            slot_config: currentSlotConfigs
        }
        delete payload.id;
        delete payload.created_at;

        if (existingPatientRecord) {
            const { error: updateError } = await supabase
                .from('planner_settings')
                .update({ slot_config: currentSlotConfigs })
                .eq('id', existingPatientRecord.id)
            if (updateError) throw updateError
        } else {
            const { error: insertError } = await supabase
                .from('planner_settings')
                .insert(payload)
            if (insertError) throw insertError
        }

        return NextResponse.json({ success: true, slot_config: currentSlotConfigs })

    } catch (err: any) {
        console.error('update-meals api error:', err)
        return NextResponse.json({ success: false, error: err.message }, { status: 500 })
    }
}