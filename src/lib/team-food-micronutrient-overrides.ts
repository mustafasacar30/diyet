import { supabase } from "@/lib/supabase"

type FoodLike = {
    id: string
    base_food_id?: string
    micronutrients?: string[]
    food_micronutrients?: { micronutrient_id: string }[]
    [key: string]: any
}

type TeamFoodMicronutrientOverrideRow = {
    base_food_id: string
    micronutrient_ids: string[] | null
}

const FOOD_ID_BATCH_SIZE = 50

function chunkIds(ids: string[], size: number): string[][] {
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += size) {
        chunks.push(ids.slice(i, i + size))
    }
    return chunks
}

function normalizeMicronutrientIds(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    const unique = new Set<string>()
    const result: string[] = []

    input.forEach((value) => {
        if (typeof value !== "string") return
        const trimmed = value.trim()
        if (!trimmed || unique.has(trimmed)) return
        unique.add(trimmed)
        result.push(trimmed)
    })

    return result
}

async function fetchGlobalMicronutrientMap(baseFoodIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>()
    if (baseFoodIds.length === 0) return result

    const batches = chunkIds(baseFoodIds, FOOD_ID_BATCH_SIZE)
    for (const batch of batches) {
        const { data, error } = await supabase
            .from("food_micronutrients")
            .select("food_id,micronutrient_id")
            .in("food_id", batch)

        if (error) {
            throw error
        }

        ;(data || []).forEach((row: any) => {
            const foodId = row.food_id as string
            const micronutrientId = row.micronutrient_id as string
            const list = result.get(foodId) || []
            if (!list.includes(micronutrientId)) {
                list.push(micronutrientId)
                result.set(foodId, list)
            }
        })
    }

    return result
}

async function fetchTeamMicronutrientMap(
    teamOwnerId: string,
    baseFoodIds: string[]
): Promise<Map<string, string[]> | null> {
    if (!teamOwnerId || baseFoodIds.length === 0) return new Map<string, string[]>()

    const result = new Map<string, string[]>()
    const batches = chunkIds(baseFoodIds, FOOD_ID_BATCH_SIZE)

    for (const batch of batches) {
        const { data, error } = await supabase
            .from("team_food_micronutrient_overrides")
            .select("base_food_id,micronutrient_ids")
            .eq("team_owner_id", teamOwnerId)
            .in("base_food_id", batch)

        if (error) {
            // v104 migration not applied yet: fallback to global behavior.
            console.warn("[TeamFoodMicronutrients] unavailable, fallback to global mapping:", error.message)
            return null
        }

        ;((data || []) as TeamFoodMicronutrientOverrideRow[]).forEach((row) => {
            result.set(row.base_food_id, normalizeMicronutrientIds(row.micronutrient_ids))
        })
    }

    return result
}

export async function getFoodMicronutrientMapByScope(
    baseFoodIds: string[],
    teamOwnerId: string | null
): Promise<Record<string, string[]>> {
    const uniqueBaseFoodIds = Array.from(
        new Set(
            baseFoodIds
                .map((id) => (typeof id === "string" ? id.trim() : ""))
                .filter(Boolean)
        )
    )

    if (uniqueBaseFoodIds.length === 0) return {}

    const globalMap = await fetchGlobalMicronutrientMap(uniqueBaseFoodIds)
    const teamMap = teamOwnerId
        ? await fetchTeamMicronutrientMap(teamOwnerId, uniqueBaseFoodIds)
        : null

    const mapping: Record<string, string[]> = {}
    uniqueBaseFoodIds.forEach((baseFoodId) => {
        if (teamMap && teamMap.has(baseFoodId)) {
            mapping[baseFoodId] = teamMap.get(baseFoodId) || []
            return
        }
        mapping[baseFoodId] = globalMap.get(baseFoodId) || []
    })

    return mapping
}

export async function getFoodMicronutrientsByScope(
    baseFoodId: string,
    teamOwnerId: string | null
): Promise<string[]> {
    const mapping = await getFoodMicronutrientMapByScope([baseFoodId], teamOwnerId)
    return mapping[baseFoodId] || []
}

export async function applyTeamFoodMicronutrientOverrides<T extends FoodLike>(
    foods: T[],
    teamOwnerId: string | null
): Promise<T[]> {
    if (foods.length === 0) return foods

    const withBaseId = foods.map((food) => ({
        ...food,
        base_food_id: food.base_food_id || food.id,
    }))

    const baseFoodIds = withBaseId.map((food) => food.base_food_id || food.id)
    const micronutrientMap = await getFoodMicronutrientMapByScope(baseFoodIds, teamOwnerId)

    return withBaseId.map((food) => {
        const baseFoodId = food.base_food_id || food.id
        const micronutrients = micronutrientMap[baseFoodId] || []

        return {
            ...food,
            micronutrients,
            food_micronutrients: micronutrients.map((micronutrient_id) => ({ micronutrient_id })),
        } as T
    })
}

export async function saveFoodMicronutrientsByScope(args: {
    baseFoodId: string
    teamOwnerId: string | null
    micronutrients: string[]
    createdBy?: string | null
}) {
    const micronutrientIds = normalizeMicronutrientIds(args.micronutrients)

    if (args.teamOwnerId) {
        const { error } = await supabase
            .from("team_food_micronutrient_overrides")
            .upsert(
                {
                    team_owner_id: args.teamOwnerId,
                    base_food_id: args.baseFoodId,
                    micronutrient_ids: micronutrientIds,
                    created_by: args.createdBy || null,
                } as any,
                { onConflict: "team_owner_id,base_food_id" }
            )

        return { error }
    }

    const { error: deleteError } = await supabase
        .from("food_micronutrients")
        .delete()
        .eq("food_id", args.baseFoodId)

    if (deleteError) return { error: deleteError }
    if (micronutrientIds.length === 0) return { error: null }

    const associations = micronutrientIds.map((micronutrientId) => ({
        food_id: args.baseFoodId,
        micronutrient_id: micronutrientId,
    }))

    const { error: insertError } = await supabase
        .from("food_micronutrients")
        .insert(associations)

    return { error: insertError }
}

export async function deleteTeamFoodMicronutrientOverride(teamOwnerId: string, baseFoodId: string) {
    const { error } = await supabase
        .from("team_food_micronutrient_overrides")
        .delete()
        .eq("team_owner_id", teamOwnerId)
        .eq("base_food_id", baseFoodId)

    if (
        error &&
        /team_food_micronutrient_overrides|does not exist|not found|schema cache/i.test(error.message || "")
    ) {
        return { error: null }
    }

    return { error }
}
