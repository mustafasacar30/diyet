import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

const ALLOWED_ROLES = new Set(["admin", "doctor", "dietitian"])
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ParsedFood = {
    foodName?: string | null
    originalText?: string | null
    calories?: number | null
    carbs?: number | null
    protein?: number | null
    fat?: number | null
    matchedFoodId?: string | null
    status?: string | null
}

type ParsedMeal = {
    mealName?: string | null
    foods?: ParsedFood[]
}

type ParsedDay = {
    dayName?: string | null
    meals?: ParsedMeal[]
}

function normalizeText(raw: unknown): string {
    if (typeof raw !== "string") return ""
    return raw.trim().replace(/\s+/g, " ")
}

function canonical(value: unknown) {
    return normalizeText(value).toLocaleLowerCase("tr-TR")
}

function asMaybeUuid(value: unknown): string | null {
    const text = normalizeText(value)
    if (!text) return null
    return UUID_REGEX.test(text) ? text : null
}

function parseFiniteNumber(value: unknown, fallback = 0) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return parsed
}

function parseParsedDays(value: unknown): ParsedDay[] {
    if (!Array.isArray(value)) return []
    const days: ParsedDay[] = []
    for (const dayRaw of value) {
        const dayObj = dayRaw && typeof dayRaw === "object" ? (dayRaw as any) : null
        if (!dayObj) continue
        const mealsRaw = Array.isArray(dayObj.meals) ? dayObj.meals : []
        const meals: ParsedMeal[] = []
        for (const mealRaw of mealsRaw) {
            const mealObj = mealRaw && typeof mealRaw === "object" ? (mealRaw as any) : null
            if (!mealObj) continue
            const foodsRaw = Array.isArray(mealObj.foods) ? mealObj.foods : []
            const foods: ParsedFood[] = []
            for (const foodRaw of foodsRaw) {
                const foodObj = foodRaw && typeof foodRaw === "object" ? (foodRaw as any) : null
                if (!foodObj) continue
                foods.push({
                    foodName: normalizeText(foodObj.foodName),
                    originalText: normalizeText(foodObj.originalText),
                    calories: Number.isFinite(Number(foodObj.calories)) ? Number(foodObj.calories) : null,
                    carbs: Number.isFinite(Number(foodObj.carbs)) ? Number(foodObj.carbs) : null,
                    protein: Number.isFinite(Number(foodObj.protein)) ? Number(foodObj.protein) : null,
                    fat: Number.isFinite(Number(foodObj.fat)) ? Number(foodObj.fat) : null,
                    matchedFoodId: asMaybeUuid(foodObj.matchedFoodId),
                    status: normalizeText(foodObj.status),
                })
            }
            meals.push({
                mealName: normalizeText(mealObj.mealName),
                foods,
            })
        }
        days.push({
            dayName: normalizeText(dayObj.dayName),
            meals,
        })
    }
    return days
}

function dedupeStrings(values: string[]) {
    return Array.from(new Set(values.map(v => normalizeText(v)).filter(Boolean)))
}

export async function POST(req: NextRequest) {
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
                        // no-op
                    },
                },
            }
        )

        const { data: authData, error: authError } = await supabase.auth.getUser()
        const callerId = authData?.user?.id
        if (authError || !callerId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { data: callerProfile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("role")
            .eq("id", callerId)
            .maybeSingle()

        if (profileError || !ALLOWED_ROLES.has(String(callerProfile?.role || ""))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }

        const body = await req.json().catch(() => ({}))
        const poolId = asMaybeUuid(body?.pool_id)
        if (!poolId) {
            return NextResponse.json({ error: "pool_id zorunlu" }, { status: 400 })
        }

        let resolvedFoodId = asMaybeUuid(body?.food_id)
        let resolvedFood: any = null

        if (!resolvedFoodId && body?.create_food && typeof body.create_food === "object") {
            const createInput = body.create_food
            const foodName = normalizeText(createInput.name)
            if (!foodName) {
                return NextResponse.json({ error: "Yeni yemek icin ad zorunlu" }, { status: 400 })
            }

            const insertPayload = {
                name: foodName,
                role: normalizeText(createInput.role) || "sideDish",
                category: normalizeText(createInput.category) || "AI Onerisi",
                calories: parseFiniteNumber(createInput.calories, 0),
                carbs: parseFiniteNumber(createInput.carbs, 0),
                protein: parseFiniteNumber(createInput.protein, 0),
                fat: parseFiniteNumber(createInput.fat, 0),
                portion_unit: normalizeText(createInput.portion_unit) || "porsiyon",
                standard_amount: parseFiniteNumber(createInput.standard_amount, 1),
                tags: Array.isArray(createInput.tags)
                    ? createInput.tags.map((tag: unknown) => normalizeText(tag)).filter(Boolean)
                    : [],
                compatibility_tags: Array.isArray(createInput.compatibility_tags)
                    ? createInput.compatibility_tags.map((tag: unknown) => normalizeText(tag)).filter(Boolean)
                    : [],
                created_by: callerId,
            }

            const { data: createdFood, error: createFoodError } = await supabaseAdmin
                .from("foods")
                .insert(insertPayload)
                .select("id, name, role, category")
                .single()

            if (createFoodError || !createdFood?.id) {
                return NextResponse.json({ error: createFoodError?.message || "Yemek olusturulamadi" }, { status: 500 })
            }

            resolvedFoodId = createdFood.id
            resolvedFood = createdFood
        }

        if (!resolvedFoodId) {
            return NextResponse.json({ error: "food_id veya create_food gerekli" }, { status: 400 })
        }

        const { data: poolRow, error: poolError } = await supabaseAdmin
            .from("menu_import_pool")
            .select("id, parsed_days, unknown_food_names, matched_food_ids")
            .eq("id", poolId)
            .maybeSingle()

        if (poolError || !poolRow) {
            return NextResponse.json({ error: poolError?.message || "Havuz kaydi bulunamadi" }, { status: 404 })
        }

        const parsedDays = parseParsedDays(poolRow.parsed_days)
        const unknownFromColumn = Array.isArray(poolRow.unknown_food_names)
            ? poolRow.unknown_food_names.map((name: unknown) => normalizeText(name)).filter(Boolean)
            : []

        const requestedUnknown = canonical(body?.unknown_name)
        const unknownTarget =
            requestedUnknown ||
            (unknownFromColumn.length === 1 ? canonical(unknownFromColumn[0]) : "")

        let matchedInParsedDays = 0
        const nextDays: ParsedDay[] = parsedDays.map(day => ({
            ...day,
            meals: (day.meals || []).map(meal => ({
                ...meal,
                foods: (meal.foods || []).map(food => {
                    const foodLabelCanonical = canonical(food.foodName || food.originalText || "")
                    const shouldReplace =
                        !asMaybeUuid(food.matchedFoodId) &&
                        (!unknownTarget || foodLabelCanonical === unknownTarget)

                    if (!shouldReplace) return food

                    matchedInParsedDays += 1
                    return {
                        ...food,
                        matchedFoodId: resolvedFoodId,
                        status: "matched",
                    }
                }),
            })),
        }))

        if (matchedInParsedDays === 0 && unknownTarget) {
            return NextResponse.json(
                { error: "Secilen bilinmeyen yemek bu kayitta bulunamadi." },
                { status: 400 }
            )
        }

        const allFoods = nextDays.flatMap(day => (day.meals || []).flatMap(meal => meal.foods || []))
        const nextUnknownNames = dedupeStrings(
            allFoods
                .filter(food => !asMaybeUuid(food.matchedFoodId))
                .map(food => normalizeText(food.foodName || food.originalText || ""))
        )
        const nextMatchedIds = dedupeStrings(
            allFoods
                .map(food => asMaybeUuid(food.matchedFoodId))
                .filter((id): id is string => Boolean(id))
        )

        const { error: updateError } = await supabaseAdmin
            .from("menu_import_pool")
            .update({
                parsed_days: nextDays,
                unknown_food_names: nextUnknownNames,
                unknown_count: nextUnknownNames.length,
                matched_food_ids: nextMatchedIds,
                updated_at: new Date().toISOString(),
            })
            .eq("id", poolId)

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            summary: {
                resolved: matchedInParsedDays,
                unknown_count: nextUnknownNames.length,
            },
            food: resolvedFood || { id: resolvedFoodId },
        })
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "menu_import_pool resolve basarisiz" },
            { status: 500 }
        )
    }
}
