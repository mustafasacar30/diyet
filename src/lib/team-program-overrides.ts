import { supabase } from "@/lib/supabase"

type ProgramWeekLike = {
    id?: string
    week_start: number
    week_end: number
    diet_type_id: string | null
    notes?: string | null
    diet_types?: { name: string; abbreviation?: string } | null
}

type ProgramRestrictionLike = {
    id?: string
    restriction_type: 'keyword' | 'tag' | 'food_id'
    restriction_value: string
    reason?: string | null
    severity?: 'warn' | 'block'
}

type ProgramTemplateLike = {
    id: string
    name: string
    description?: string | null
    total_weeks?: number
    default_activity_level?: number
    is_active?: boolean
    scope_source?: 'global' | 'team'
    program_template_weeks?: ProgramWeekLike[]
    program_template_restrictions?: ProgramRestrictionLike[]
}

type TeamProgramOverrideRow = {
    id: string
    program_template_id: string
    name: string | null
    description: string | null
    total_weeks: number | null
    default_activity_level: number | null
    is_active: boolean | null
}

type TeamProgramOverrideWeekRow = {
    id: string
    override_id: string
    week_start: number
    week_end: number
    diet_type_id: string | null
    notes: string | null
    diet_types?: { name: string; abbreviation?: string } | { name: string; abbreviation?: string }[] | null
}

type TeamProgramOverrideRestrictionRow = {
    override_id: string
    restriction_type: 'keyword' | 'tag' | 'food_id'
    restriction_value: string
    reason: string | null
    severity: 'warn' | 'block'
}

function normalizeDietType(
    value: TeamProgramOverrideWeekRow['diet_types']
): { name: string; abbreviation?: string } | null {
    if (!value) return null
    if (Array.isArray(value)) return value[0] || null
    return value
}

export async function applyTeamProgramOverrides<T extends ProgramTemplateLike>(
    programs: T[],
    teamOwnerId: string | null
): Promise<T[]> {
    if (!teamOwnerId || programs.length === 0) return programs

    const programIds = programs.map(p => p.id)

    const { data: overrideRows, error: overrideError } = await supabase
        .from('team_program_overrides')
        .select('id, program_template_id, name, description, total_weeks, default_activity_level, is_active')
        .eq('team_owner_id', teamOwnerId)
        .in('program_template_id', programIds)

    if (overrideError) {
        // v99 migration not applied yet or table/policy unavailable -> keep global behavior.
        console.warn('[TeamOverride] team_program_overrides unavailable, fallback to global programs:', overrideError.message)
        return programs
    }

    const overrides = (overrideRows || []) as TeamProgramOverrideRow[]
    if (overrides.length === 0) return programs

    const overrideIds = overrides.map(o => o.id)

    const { data: overrideWeekRows } = await supabase
        .from('team_program_override_weeks')
        .select('id, override_id, week_start, week_end, diet_type_id, notes, diet_types (name, abbreviation)')
        .in('override_id', overrideIds)
        .order('week_start', { ascending: true })

    const { data: overrideRestrictionRows } = await supabase
        .from('team_program_override_restrictions')
        .select('override_id, restriction_type, restriction_value, reason, severity')
        .in('override_id', overrideIds)

    const overridesByProgramId = new Map<string, TeamProgramOverrideRow>()
    overrides.forEach(override => {
        overridesByProgramId.set(override.program_template_id, override)
    })

    const weeksByOverrideId = new Map<string, ProgramWeekLike[]>()
    ;((overrideWeekRows || []) as TeamProgramOverrideWeekRow[]).forEach(row => {
        const arr = weeksByOverrideId.get(row.override_id) || []
        arr.push({
            id: row.id,
            week_start: row.week_start,
            week_end: row.week_end,
            diet_type_id: row.diet_type_id,
            notes: row.notes,
            diet_types: normalizeDietType(row.diet_types)
        })
        weeksByOverrideId.set(row.override_id, arr)
    })

    const restrictionsByOverrideId = new Map<string, ProgramRestrictionLike[]>()
    ;((overrideRestrictionRows || []) as TeamProgramOverrideRestrictionRow[]).forEach(row => {
        const arr = restrictionsByOverrideId.get(row.override_id) || []
        arr.push({
            restriction_type: row.restriction_type,
            restriction_value: row.restriction_value,
            reason: row.reason,
            severity: row.severity
        })
        restrictionsByOverrideId.set(row.override_id, arr)
    })

    return programs.map(program => {
        const override = overridesByProgramId.get(program.id)
        if (!override) return program

        const merged = { ...program } as T
        ;(merged as ProgramTemplateLike).scope_source = 'team'

        if (override.name !== null) merged.name = override.name
        if (override.description !== null) merged.description = override.description
        if (override.total_weeks !== null) merged.total_weeks = override.total_weeks
        if (override.default_activity_level !== null) merged.default_activity_level = override.default_activity_level
        if (override.is_active !== null) merged.is_active = override.is_active

        const overrideWeeks = weeksByOverrideId.get(override.id)
        if (overrideWeeks && overrideWeeks.length > 0) {
            merged.program_template_weeks = overrideWeeks
        }

        const overrideRestrictions = restrictionsByOverrideId.get(override.id)
        if (overrideRestrictions && overrideRestrictions.length > 0) {
            merged.program_template_restrictions = overrideRestrictions
        }

        return merged
    })
}
