import { supabase } from "@/lib/supabase"

type DietTypeLike = {
    id: string
    name: string
    abbreviation?: string | null
    description?: string | null
    carb_factor?: number | null
    protein_factor?: number | null
    fat_factor?: number | null
    allowed_tags?: string[] | null
    banned_keywords?: string[] | null
    banned_tags?: string[] | null
    banned_details?: Record<string, any> | null
    scope_source?: 'global' | 'team' | 'program'
    base_diet_type_id?: string
}

type ProgramDietTypeOverrideRow = {
    id: string
    team_owner_id: string | null
    program_template_id: string
    base_diet_type_id: string
    name: string | null
    abbreviation: string | null
    description: string | null
    carb_factor: number | null
    protein_factor: number | null
    fat_factor: number | null
    allowed_tags: string[] | null
    banned_keywords: string[] | null
    banned_tags: string[] | null
    banned_details: Record<string, any> | null
}

type ProgramDietTypeOverridePayload = {
    name: string
    abbreviation: string
    description: string
    carb_factor: number
    protein_factor: number
    fat_factor: number
    allowed_tags: string[]
    banned_keywords: string[]
    banned_tags: string[]
    banned_details: Record<string, any>
}

type ProgramOverrideScope = {
    programTemplateId: string | null | undefined
    teamOwnerId?: string | null
}

function applyTeamScopeFilter<TQuery extends { eq: Function; is: Function }>(
    query: TQuery,
    teamOwnerId?: string | null
) {
    if (teamOwnerId) {
        return query.eq('team_owner_id', teamOwnerId)
    }
    return query.is('team_owner_id', null)
}

export async function applyProgramDietTypeOverrides<T extends DietTypeLike>(
    dietTypes: T[],
    { programTemplateId, teamOwnerId = null }: ProgramOverrideScope
): Promise<T[]> {
    if (!programTemplateId || dietTypes.length === 0) return dietTypes

    const baseIds = dietTypes.map((dt) => dt.base_diet_type_id || dt.id)

    let query = supabase
        .from('program_diet_type_overrides')
        .select(`
            id,
            team_owner_id,
            program_template_id,
            base_diet_type_id,
            name,
            abbreviation,
            description,
            carb_factor,
            protein_factor,
            fat_factor,
            allowed_tags,
            banned_keywords,
            banned_tags,
            banned_details
        `)
        .eq('program_template_id', programTemplateId)
        .in('base_diet_type_id', baseIds)

    query = applyTeamScopeFilter(query as any, teamOwnerId) as any
    const { data, error } = await query

    if (error) {
        console.warn('[ProgramDietTypeOverride] unavailable, fallback to inherited diet types:', error.message)
        return dietTypes
    }

    const rows = (data || []) as ProgramDietTypeOverrideRow[]
    if (rows.length === 0) return dietTypes

    const byBaseId = new Map<string, ProgramDietTypeOverrideRow>()
    rows.forEach((row) => byBaseId.set(row.base_diet_type_id, row))

    return dietTypes.map((dietType) => {
        const baseId = dietType.base_diet_type_id || dietType.id
        const override = byBaseId.get(baseId)
        if (!override) return dietType

        const merged = {
            ...dietType,
            base_diet_type_id: baseId,
            scope_source: 'program',
        } as T

        if (override.name !== null) merged.name = override.name
        if (override.abbreviation !== null) merged.abbreviation = override.abbreviation
        if (override.description !== null) merged.description = override.description
        if (override.carb_factor !== null) merged.carb_factor = override.carb_factor
        if (override.protein_factor !== null) merged.protein_factor = override.protein_factor
        if (override.fat_factor !== null) merged.fat_factor = override.fat_factor
        if (override.allowed_tags !== null) merged.allowed_tags = override.allowed_tags
        if (override.banned_keywords !== null) merged.banned_keywords = override.banned_keywords
        if (override.banned_tags !== null) merged.banned_tags = override.banned_tags
        if (override.banned_details !== null) merged.banned_details = override.banned_details

        return merged
    })
}

export async function saveProgramDietTypeOverride(params: {
    programTemplateId: string
    teamOwnerId?: string | null
    baseDietTypeId: string
    payload: ProgramDietTypeOverridePayload
    createdBy: string
}) {
    const {
        programTemplateId,
        teamOwnerId = null,
        baseDietTypeId,
        payload,
        createdBy
    } = params

    let existingQuery = supabase
        .from('program_diet_type_overrides')
        .select('id')
        .eq('program_template_id', programTemplateId)
        .eq('base_diet_type_id', baseDietTypeId)
        .limit(1)
        .maybeSingle()

    existingQuery = applyTeamScopeFilter(existingQuery as any, teamOwnerId) as any
    const { data: existingRow, error: existingError } = await existingQuery
    if (existingError) return { error: existingError }

    if (existingRow?.id) {
        return await supabase
            .from('program_diet_type_overrides')
            .update(payload)
            .eq('id', existingRow.id)
    }

    return await supabase
        .from('program_diet_type_overrides')
        .insert({
            team_owner_id: teamOwnerId,
            program_template_id: programTemplateId,
            base_diet_type_id: baseDietTypeId,
            ...payload,
            created_by: createdBy
        })
}

export async function deleteProgramDietTypeOverride(params: {
    programTemplateId: string
    teamOwnerId?: string | null
    baseDietTypeId: string
}) {
    const { programTemplateId, teamOwnerId = null, baseDietTypeId } = params

    let deleteQuery = supabase
        .from('program_diet_type_overrides')
        .delete()
        .eq('program_template_id', programTemplateId)
        .eq('base_diet_type_id', baseDietTypeId)

    deleteQuery = applyTeamScopeFilter(deleteQuery as any, teamOwnerId) as any
    return await deleteQuery
}

