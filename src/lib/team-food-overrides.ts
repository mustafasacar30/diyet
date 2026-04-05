import { supabase } from "@/lib/supabase"

const FOOD_OVERRIDE_COLUMNS = [
    "name",
    "category",
    "role",
    "calories",
    "protein",
    "carbs",
    "fat",
    "portion_unit",
    "standard_amount",
    "tags",
    "meta",
    "min_quantity",
    "max_quantity",
    "step",
    "multiplier",
    "portion_fixed",
    "keto",
    "lowcarb",
    "vegan",
    "vejeteryan",
    "elimination_diet",
    "meal_types",
    "filler_lunch",
    "filler_dinner",
    "season_start",
    "season_end",
    "is_reversed_season",
    "compatibility_tags",
    "incompatibility_tags",
    "notes",
    "diet_types",
    "diet_tags",
    "ingredients",
    "recipe_text",
    "source_url",
    "priority_score",
    "min_weekly_freq",
    "max_weekly_freq",
    "hidden_from_cardmaker",
] as const

type FoodOverrideColumn = (typeof FOOD_OVERRIDE_COLUMNS)[number]

type FoodLike = {
    id: string
    base_food_id?: string
    scope_source?: "global" | "team"
    [key: string]: any
}

type TeamFoodOverrideRow = {
    team_owner_id: string
    base_food_id: string
    [key: string]: any
}

const FOOD_OVERRIDE_BATCH_SIZE = 120

function chunkIds(ids: string[], size: number): string[][] {
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += size) {
        chunks.push(ids.slice(i, i + size))
    }
    return chunks
}

function withScopeDefaults<T extends FoodLike>(food: T): T {
    return {
        ...food,
        base_food_id: food.base_food_id || food.id,
        scope_source: food.scope_source || "global",
    }
}

export async function applyTeamFoodOverrides<T extends FoodLike>(
    foods: T[],
    teamOwnerId: string | null
): Promise<T[]> {
    const withDefaults = foods.map(withScopeDefaults)
    if (!teamOwnerId || withDefaults.length === 0) return withDefaults

    const baseIds = withDefaults.map((food) => food.base_food_id || food.id)
    const selectColumns = ["team_owner_id", "base_food_id", ...FOOD_OVERRIDE_COLUMNS].join(", ")
    const rows: TeamFoodOverrideRow[] = []

    for (const batch of chunkIds(baseIds, FOOD_OVERRIDE_BATCH_SIZE)) {
        const { data, error } = await supabase
            .from("team_food_overrides")
            .select(selectColumns)
            .eq("team_owner_id", teamOwnerId)
            .in("base_food_id", batch)

        if (error) {
            console.warn("[TeamFoodOverride] unavailable, fallback to global foods:", error.message)
            return withDefaults
        }

        rows.push(...(((data || []) as unknown) as TeamFoodOverrideRow[]))
    }

    const byBaseId = new Map<string, TeamFoodOverrideRow>()
    rows.forEach((row) => byBaseId.set(row.base_food_id, row))

    return withDefaults.map((food) => {
        const baseFoodId = food.base_food_id || food.id
        const override = byBaseId.get(baseFoodId)
        if (!override) return food

        const merged: T = {
            ...food,
            scope_source: "team",
            base_food_id: baseFoodId,
        }

        FOOD_OVERRIDE_COLUMNS.forEach((column) => {
            const value = override[column]
            if (value !== null) {
                ;(merged as any)[column] = value
            }
        })

        return merged
    })
}

function sanitizeUpdatePayload(updates: Record<string, any>): Partial<Record<FoodOverrideColumn, any>> {
    const payload: Partial<Record<FoodOverrideColumn, any>> = {}
    for (const [key, value] of Object.entries(updates || {})) {
        if (!FOOD_OVERRIDE_COLUMNS.includes(key as FoodOverrideColumn)) continue
        if (value === undefined) continue
        payload[key as FoodOverrideColumn] = value
    }
    return payload
}

export async function upsertTeamFoodOverride(args: {
    teamOwnerId: string
    baseFoodId: string
    createdBy: string | null
    updates: Record<string, any>
}) {
    const payload = sanitizeUpdatePayload(args.updates)
    if (Object.keys(payload).length === 0) {
        return { error: null as any }
    }

    const { error } = await supabase
        .from("team_food_overrides")
        .upsert(
            {
                team_owner_id: args.teamOwnerId,
                base_food_id: args.baseFoodId,
                created_by: args.createdBy,
                ...payload,
            } as any,
            { onConflict: "team_owner_id,base_food_id" }
        )

    return { error }
}

export async function deleteTeamFoodOverride(teamOwnerId: string, baseFoodId: string) {
    const { error } = await supabase
        .from("team_food_overrides")
        .delete()
        .eq("team_owner_id", teamOwnerId)
        .eq("base_food_id", baseFoodId)

    return { error }
}
