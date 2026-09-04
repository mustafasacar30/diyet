"use server"

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// We use the service role key to bypass RLS for public read-only data
export async function getPublicRecipeData() {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        
        const [mRes, bRes, cRes] = await Promise.all([
            supabaseAdmin.from('recipe_manual_matches').select('*'),
            supabaseAdmin.from('recipe_match_bans').select('*'),
            supabaseAdmin.from('recipe_cards').select('*').order('created_at', { ascending: false }),
        ])
        
        if (mRes.error) throw new Error(mRes.error.message)
        if (bRes.error) throw new Error(bRes.error.message)
        if (cRes.error) throw new Error(cRes.error.message)

        return {
            manualMatches: mRes.data || [],
            bans: bRes.data || [],
            cards: cRes.data || []
        }
    } catch (e: any) {
        return { error: e.message }
    }
}

// Bypasses RLS to fetch a specific program template along with its weeks and restrictions
export async function getPublicProgramDetails(programId: string) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    if (!programId) return { error: "Program ID geçersiz." }
    
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        const { data, error } = await supabaseAdmin
            .from('program_templates')
            .select(`
                *,
                program_template_weeks (
                    id, week_start, week_end, diet_type_id, notes,
                    diet_types (name, abbreviation)
                ),
                program_template_restrictions (
                    id, restriction_type, restriction_value, reason, severity
                )
            `)
            .eq('id', programId)
            .maybeSingle()

        if (error) throw new Error(error.message)
        return { data }
    } catch (e: any) {
        return { error: e.message }
    }
}

// Bypasses RLS to fetch all active program templates
export async function getPublicProgramTemplatesList() {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        const { data, error } = await supabaseAdmin
            .from('program_templates')
            .select(`
                *,
                program_template_weeks (
                    id, week_start, week_end, diet_type_id, notes,
                    diet_types (name, abbreviation)
                ),
                program_template_restrictions (
                    id, restriction_type, restriction_value, reason, severity
                )
            `)
            .order('name')

        if (error) throw new Error(error.message)
        return { data: data || [] }
    } catch (e: any) {
        return { error: e.message }
    }
}

// Bypasses RLS to save or update program templates, weeks, and restrictions
export async function adminSaveProgramTemplateAction(payload: {
    programId: string | null | undefined
    name: string
    description: string | null
    totalWeeks: number
    activityLevel: number
    isActive: boolean
    weekMappings: any[]
    restrictions: any[]
    saveMode: 'global' | 'team'
    effectiveTeamOwnerId: string | null
    userId: string | null
}) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        let programId = payload.programId
        let teamOverrideId: string | null = null

        if (payload.saveMode === 'team' && payload.effectiveTeamOwnerId && payload.userId && programId) {
            // Team Mode: Save to team_program_overrides
            const { data: overrideRow, error: overrideError } = await supabaseAdmin
                .from('team_program_overrides')
                .upsert(
                    {
                        team_owner_id: payload.effectiveTeamOwnerId,
                        program_template_id: programId,
                        name: payload.name.trim(),
                        description: payload.description ? payload.description.trim() : null,
                        total_weeks: payload.totalWeeks,
                        default_activity_level: payload.activityLevel,
                        is_active: payload.isActive,
                        created_by: payload.userId,
                    },
                    { onConflict: 'team_owner_id,program_template_id' }
                )
                .select('id')
                .single()

            if (overrideError) throw overrideError
            teamOverrideId = overrideRow.id

            // Clear weeks and restrictions for this override
            await supabaseAdmin.from('team_program_override_weeks').delete().eq('override_id', teamOverrideId)
            await supabaseAdmin.from('team_program_override_restrictions').delete().eq('override_id', teamOverrideId)
        } else {
            // Global Mode
            if (programId) {
                // Update existing global template
                const { error } = await supabaseAdmin
                    .from('program_templates')
                    .update({
                        name: payload.name.trim(),
                        description: payload.description ? payload.description.trim() : null,
                        total_weeks: payload.totalWeeks,
                        default_activity_level: payload.activityLevel,
                        is_active: payload.isActive,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', programId)

                if (error) throw error

                // Clear weeks and restrictions for this template
                await supabaseAdmin.from('program_template_weeks').delete().eq('program_template_id', programId)
                await supabaseAdmin.from('program_template_restrictions').delete().eq('program_template_id', programId)
            } else {
                // Insert new global template
                const { data, error } = await supabaseAdmin
                    .from('program_templates')
                    .insert({
                        name: payload.name.trim(),
                        description: payload.description ? payload.description.trim() : null,
                        total_weeks: payload.totalWeeks,
                        default_activity_level: payload.activityLevel,
                        is_active: payload.isActive
                    })
                    .select()
                    .single()

                if (error) throw error
                programId = data.id
            }
        }

        // Insert week mappings
        if (payload.weekMappings.length > 0) {
            if (payload.saveMode === 'team' && teamOverrideId) {
                const weeksToInsert = payload.weekMappings.map(w => ({
                    override_id: teamOverrideId,
                    week_start: w.week_start,
                    week_end: w.week_end,
                    diet_type_id: w.diet_type_id,
                    notes: w.notes
                }))
                const { error } = await supabaseAdmin.from('team_program_override_weeks').insert(weeksToInsert)
                if (error) throw error
            } else {
                const weeksToInsert = payload.weekMappings.map(w => ({
                    program_template_id: programId,
                    week_start: w.week_start,
                    week_end: w.week_end,
                    diet_type_id: w.diet_type_id,
                    notes: w.notes
                }))
                const { error } = await supabaseAdmin.from('program_template_weeks').insert(weeksToInsert)
                if (error) throw error
            }
        }

        // Insert restrictions
        if (payload.restrictions.length > 0) {
            if (payload.saveMode === 'team' && teamOverrideId) {
                const restrictionsToInsert = payload.restrictions.map(r => ({
                    override_id: teamOverrideId,
                    restriction_type: r.restriction_type,
                    restriction_value: r.restriction_value,
                    reason: r.reason,
                    severity: r.severity
                }))
                const { error } = await supabaseAdmin.from('team_program_override_restrictions').insert(restrictionsToInsert)
                if (error) throw error
            } else {
                const restrictionsToInsert = payload.restrictions.map(r => ({
                    program_template_id: programId,
                    restriction_type: r.restriction_type,
                    restriction_value: r.restriction_value,
                    reason: r.reason,
                    severity: r.severity
                }))
                const { error } = await supabaseAdmin.from('program_template_restrictions').insert(restrictionsToInsert)
                if (error) throw error
            }
        }

        return { success: true, programId }
    } catch (e: any) {
        return { error: e.message }
    }
}

// --- Recipe Manager Admin Actions (Bypass RLS) ---

export async function adminAddManualMatchAction(payload: { food_pattern: string, card_filename: string, original_text?: string }) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { data, error } = await supabaseAdmin.from('recipe_manual_matches').insert({
            food_pattern: payload.food_pattern,
            card_filename: payload.card_filename,
            original_text: payload.original_text || null
        }).select().single()
        if (error) throw new Error(error.message)
        return { data }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminUpdateManualMatchAction(payload: { id: string, food_pattern: string, card_filename: string, original_text?: string }) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { data, error } = await supabaseAdmin.from('recipe_manual_matches').update({
            food_pattern: payload.food_pattern,
            card_filename: payload.card_filename,
            original_text: payload.original_text || null
        }).eq('id', payload.id).select().single()
        if (error) throw new Error(error.message)
        return { data }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminDeleteManualMatchAction(id: string) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { error } = await supabaseAdmin.from('recipe_manual_matches').delete().eq('id', id)
        if (error) throw new Error(error.message)
        return { success: true }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminAddRecipeBanAction(payload: { food_pattern: string, card_filename: string, original_text?: string }) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { data, error } = await supabaseAdmin.from('recipe_match_bans').insert({
            food_pattern: payload.food_pattern,
            card_filename: payload.card_filename,
            original_text: payload.original_text || null
        }).select().single()
        if (error) throw new Error(error.message)
        return { data }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminDeleteRecipeBanAction(id: string) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { error } = await supabaseAdmin.from('recipe_match_bans').delete().eq('id', id)
        if (error) throw new Error(error.message)
        return { success: true }
    } catch (e: any) {
        return { error: e.message }
    }
}
