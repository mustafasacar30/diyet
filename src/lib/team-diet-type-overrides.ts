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
    scope_source?: 'global' | 'team'
    base_diet_type_id?: string
}

type TeamDietTypeOverrideRow = {
    team_owner_id: string
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

export async function applyTeamDietTypeOverrides<T extends DietTypeLike>(
    dietTypes: T[],
    teamOwnerId: string | null
): Promise<T[]> {
    if (!teamOwnerId || dietTypes.length === 0) {
        return dietTypes.map((dt) => ({
            ...dt,
            scope_source: dt.scope_source || 'global',
            base_diet_type_id: dt.base_diet_type_id || dt.id,
        }))
    }

    const baseIds = dietTypes.map((dt) => dt.base_diet_type_id || dt.id)

    const { data, error } = await supabase
        .from('team_diet_type_overrides')
        .select(`
            team_owner_id,
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
        .eq('team_owner_id', teamOwnerId)
        .in('base_diet_type_id', baseIds)

    if (error) {
        // v102 migration might not be applied yet.
        console.warn('[TeamDietTypeOverride] unavailable, fallback to global diet types:', error.message)
        return dietTypes.map((dt) => ({
            ...dt,
            scope_source: dt.scope_source || 'global',
            base_diet_type_id: dt.base_diet_type_id || dt.id,
        }))
    }

    const overrides = (data || []) as TeamDietTypeOverrideRow[]
    const byBaseId = new Map<string, TeamDietTypeOverrideRow>()
    overrides.forEach((row) => byBaseId.set(row.base_diet_type_id, row))

    return dietTypes.map((dietType) => {
        const baseId = dietType.base_diet_type_id || dietType.id
        const override = byBaseId.get(baseId)

        const merged = {
            ...dietType,
            base_diet_type_id: baseId,
            scope_source: 'global',
        } as T

        if (!override) {
            return merged
        }

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

        merged.scope_source = 'team'
        return merged
    })
}
