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

function asMaybeUuid(value: unknown): string | null {
    const text = normalizeText(value)
    if (!text) return null
    return UUID_REGEX.test(text) ? text : null
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

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(v => normalizeText(v)).filter(Boolean)))
}

function splitMergedLabelSet(raw: unknown): string[] {
    if (typeof raw !== "string") return []
    return dedupeStrings(
        raw
            .split("|")
            .map(part => normalizeText(part))
            .filter(Boolean)
    )
}

function splitTabPrefixFromDayName(rawDayName: string) {
    const normalized = normalizeText(rawDayName)
    const match = normalized.match(/^\[(.+?)\]\s*(.+)$/)
    if (match?.[1] && match?.[2]) {
        return {
            tabName: normalizeText(match[1]) || null,
            cleanDayName: normalizeText(match[2]) || null,
        }
    }
    return {
        tabName: null as string | null,
        cleanDayName: normalized || null,
    }
}

function extractMacrosFromText(line: string) {
    const raw = typeof line === "string" ? line.replace(/\r/g, "").trim() : ""
    if (!raw) return null

    const toNum = (v: string) => {
        const parsed = Number(String(v || "").replace(",", ".").replace(/[^0-9.-]/g, ""))
        return Number.isFinite(parsed) ? parsed : null
    }

    let parts = raw.split("\t").map(p => String(p ?? "").trim())
    if (parts.length === 1) {
        parts = raw.split(/ {2,}/).map(p => String(p ?? "").trim())
    }

    let nameIndex = 0
    while (nameIndex < parts.length && !parts[nameIndex]) nameIndex += 1

    if (nameIndex < parts.length) {
        const macroCells = parts.slice(nameIndex + 1).map(toNum)
        const nonNullCells = macroCells.filter((v): v is number => v !== null)
        if (nonNullCells.length >= 4) {
            return {
                calories: nonNullCells[0] ?? 0,
                carbs: nonNullCells[1] ?? 0,
                protein: nonNullCells[2] ?? 0,
                fat: nonNullCells[3] ?? 0,
            }
        }
        if (macroCells.some(v => v !== null)) {
            return {
                calories: macroCells[0] ?? 0,
                carbs: macroCells[1] ?? 0,
                protein: macroCells[2] ?? 0,
                fat: macroCells[3] ?? 0,
            }
        }
    }

    const trailing = raw.match(/(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$/)
    if (!trailing) return null
    const calories = toNum(trailing[1]) ?? 0
    const carbs = toNum(trailing[2]) ?? 0
    const protein = toNum(trailing[3]) ?? 0
    const fat = toNum(trailing[4]) ?? 0
    return { calories, carbs, protein, fat }
}

function parseWeekNumberFromTab(tabName: string | null | undefined) {
    const text = normalizeText(tabName)
    if (!text) return null
    const match = text.match(/(\d+)\.?\s*hafta/i) || text.match(/hafta\s*(\d+)/i)
    if (!match?.[1]) return null
    const parsed = Number(match[1])
    if (!Number.isFinite(parsed)) return null
    return Math.trunc(parsed)
}

function buildMacroLookupFromRawText(rawText: string) {
    const lookup = new Map<string, { calories: number; carbs: number; protein: number; fat: number }>()
    const lines = String(rawText || "").split(/\r?\n/)

    for (const lineRaw of lines) {
        const rawLine = typeof lineRaw === "string" ? lineRaw.replace(/\r/g, "").trim() : ""
        if (!rawLine) continue

        let parts = rawLine.split("\t").map(p => String(p ?? "").trim())
        if (parts.length === 1) {
            parts = rawLine.split(/ {2,}/).map(p => String(p ?? "").trim())
        }
        let nameIndex = 0
        while (nameIndex < parts.length && !parts[nameIndex]) nameIndex += 1
        const candidateName = normalizeText(parts[nameIndex] || rawLine)
        if (!candidateName) continue

        const macro = extractMacrosFromText(rawLine)
        if (!macro) continue

        const key = candidateName.toLocaleLowerCase("tr-TR")
        lookup.set(key, macro)
    }

    return lookup
}

function getMacroFromLookup(
    labelRaw: string,
    lookup: Map<string, { calories: number; carbs: number; protein: number; fat: number }>
) {
    const key = normalizeText(labelRaw).toLocaleLowerCase("tr-TR")
    if (!key || lookup.size === 0) return null
    const exact = lookup.get(key)
    if (exact) return exact

    for (const [candidate, macro] of lookup.entries()) {
        if (candidate.includes(key) || key.includes(candidate)) {
            return macro
        }
    }
    return null
}

export async function GET(req: NextRequest) {
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

        const params = req.nextUrl.searchParams
        const q = normalizeText(params.get("q"))
        const sourceType = normalizeText(params.get("source_type"))
        const unknownOnly = params.get("unknown_only") === "1"
        const dateFrom = normalizeText(params.get("date_from"))
        const dateTo = normalizeText(params.get("date_to"))
        const limit = Math.max(10, Math.min(500, Number(params.get("limit") || 120)))
        const offset = Math.max(0, Number(params.get("offset") || 0))
        const sortByParam = normalizeText(params.get("sort_by"))
        const sortDirParam = normalizeText(params.get("sort_dir")) === "asc" ? "asc" : "desc"

        const allowedSortFields = new Set([
            "created_at",
            "updated_at",
            "repeat_count",
            "week_number",
            "day_name",
            "meal_name",
            "food_count",
            "unknown_count",
            "source_patient_name",
            "source_file_name",
            "source_tab_name",
        ])
        const sortBy = allowedSortFields.has(sortByParam) ? sortByParam : "created_at"

        let query = supabaseAdmin
            .from("menu_import_pool")
            .select(
                [
                    "id",
                    "week_id",
                    "patient_id",
                    "program_template_id",
                    "week_number",
                    "source_type",
                    "source_file_id",
                    "source_file_name",
                    "source_tab_name",
                    "source_patient_name",
                    "day_name",
                    "meal_name",
                    "food_count",
                    "unknown_count",
                    "unknown_food_names",
                    "matched_food_ids",
                    "repeat_count",
                    "created_at",
                    "updated_at",
                    "raw_text",
                    "parsed_days",
                ].join(","),
                { count: "exact" }
            )

        if (sourceType) {
            query = query.eq("source_type", sourceType)
        }

        if (unknownOnly) {
            query = query.gt("unknown_count", 0)
        }

        if (dateFrom) {
            query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`)
        }

        if (dateTo) {
            query = query.lte("created_at", `${dateTo}T23:59:59.999Z`)
        }

        if (q) {
            const escaped = q.replace(/[%_,]/g, "")
            query = query.or(
                [
                    `source_patient_name.ilike.%${escaped}%`,
                    `source_file_name.ilike.%${escaped}%`,
                    `source_tab_name.ilike.%${escaped}%`,
                    `day_name.ilike.%${escaped}%`,
                    `meal_name.ilike.%${escaped}%`,
                    `raw_text.ilike.%${escaped}%`,
                ].join(",")
            )
        }

        const { data: rows, error, count } = await query
            .order(sortBy, { ascending: sortDirParam === "asc", nullsFirst: false })
            .range(offset, offset + limit - 1)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        const parsedRows = (rows || []).map((row: any) => {
            const parsedDays = parseParsedDays(row.parsed_days)
            const firstDay = parsedDays[0]
            const firstMeal = firstDay?.meals?.[0]
            const foods = firstMeal?.foods || []
            const daySplit = splitTabPrefixFromDayName(
                normalizeText(row.day_name) || normalizeText(firstDay?.dayName)
            )
            const sourceTabNames = splitMergedLabelSet(row.source_tab_name)
            const sourceFileNames = splitMergedLabelSet(row.source_file_name)
            const sourcePatientNames = splitMergedLabelSet(row.source_patient_name)
            const inferredWeek = parseWeekNumberFromTab(
                normalizeText(sourceTabNames[0]) || normalizeText(row.source_tab_name) || daySplit.tabName
            )
            const weekNumber = Number.isFinite(Number(row.week_number)) ? Number(row.week_number) : inferredWeek
            const macroLookup = buildMacroLookupFromRawText(String(row.raw_text || ""))

            const matchedFromJson = foods
                .map(food => asMaybeUuid(food.matchedFoodId))
                .filter((id): id is string => Boolean(id))
            const matchedFromColumn = Array.isArray(row.matched_food_ids)
                ? row.matched_food_ids.map((id: unknown) => asMaybeUuid(id)).filter((id: string | null): id is string => Boolean(id))
                : []
            const matchedFoodIds = dedupeStrings([...matchedFromColumn, ...matchedFromJson])

            const unknownFromJson = foods
                .filter(food => !asMaybeUuid(food.matchedFoodId))
                .map(food => normalizeText(food.foodName || food.originalText || ""))
            const unknownFromColumn = Array.isArray(row.unknown_food_names)
                ? row.unknown_food_names.map((name: unknown) => normalizeText(name))
                : []
            const unknownFoodNames = dedupeStrings([...unknownFromColumn, ...unknownFromJson])

            const foodView = foods.map(food => {
                const label = normalizeText(food.foodName || food.originalText || "")
                const matchedFoodId = asMaybeUuid(food.matchedFoodId)
                const isUnknown = !matchedFoodId
                const macroFromFood = {
                    calories: Number.isFinite(Number(food.calories)) ? Number(food.calories) : null,
                    carbs: Number.isFinite(Number(food.carbs)) ? Number(food.carbs) : null,
                    protein: Number.isFinite(Number(food.protein)) ? Number(food.protein) : null,
                    fat: Number.isFinite(Number(food.fat)) ? Number(food.fat) : null,
                }
                const macroFromText = extractMacrosFromText(String(food.originalText || food.foodName || ""))
                const macroFromLookup = getMacroFromLookup(label, macroLookup)
                const fallbackMacro = macroFromText || macroFromLookup
                const isZeroOrNull = (v: number | null) => v === null || Math.abs(v) < 1e-9
                const unknownLooksUnparsed =
                    isUnknown &&
                    isZeroOrNull(macroFromFood.calories) &&
                    isZeroOrNull(macroFromFood.carbs) &&
                    isZeroOrNull(macroFromFood.protein) &&
                    isZeroOrNull(macroFromFood.fat)

                const calories = unknownLooksUnparsed
                    ? fallbackMacro?.calories ?? macroFromFood.calories ?? 0
                    : macroFromFood.calories ?? fallbackMacro?.calories ?? 0
                const carbs = unknownLooksUnparsed
                    ? fallbackMacro?.carbs ?? macroFromFood.carbs ?? 0
                    : macroFromFood.carbs ?? fallbackMacro?.carbs ?? 0
                const protein = unknownLooksUnparsed
                    ? fallbackMacro?.protein ?? macroFromFood.protein ?? 0
                    : macroFromFood.protein ?? fallbackMacro?.protein ?? 0
                const fat = unknownLooksUnparsed
                    ? fallbackMacro?.fat ?? macroFromFood.fat ?? 0
                    : macroFromFood.fat ?? fallbackMacro?.fat ?? 0

                return {
                    label,
                    original_text: normalizeText(food.originalText || ""),
                    matched_food_id: matchedFoodId,
                    status: normalizeText(food.status) || (matchedFoodId ? "matched" : "unknown"),
                    calories,
                    carbs,
                    protein,
                    fat,
                }
            })

            return {
                ...row,
                week_number: weekNumber,
                week_label: weekNumber ? `${weekNumber}. hafta` : null,
                source_tab_name: normalizeText(sourceTabNames[0]) || normalizeText(row.source_tab_name) || daySplit.tabName || null,
                source_file_name: normalizeText(sourceFileNames[0]) || normalizeText(row.source_file_name) || null,
                source_patient_name: normalizeText(sourcePatientNames[0]) || normalizeText(row.source_patient_name) || null,
                source_tab_names: sourceTabNames,
                source_file_names: sourceFileNames,
                source_patient_names: sourcePatientNames,
                day_name: daySplit.cleanDayName || null,
                meal_name: normalizeText(row.meal_name) || normalizeText(firstMeal?.mealName) || null,
                food_count: Number(row.food_count || foodView.length || 0),
                unknown_count: Number(row.unknown_count || unknownFoodNames.length || 0),
                unknown_food_names: unknownFoodNames,
                matched_food_ids: matchedFoodIds,
                foods: foodView,
            }
        })

        const allFoodIds = Array.from(
            new Set(
                parsedRows.flatMap((row: any) => (row.matched_food_ids || []) as string[])
            )
        )

        let foodsById = new Map<string, any>()
        if (allFoodIds.length > 0) {
            const { data: foods, error: foodsError } = await supabaseAdmin
                .from("foods")
                .select("id, name, role, category, tags, compatibility_tags")
                .in("id", allFoodIds)
            if (!foodsError && foods) {
                foodsById = new Map(foods.map((food: any) => [food.id, food]))
            }
        }

        const outputRows = parsedRows.map((row: any) => {
            const roles = dedupeStrings(
                (row.matched_food_ids || [])
                    .map((foodId: string) => normalizeText(foodsById.get(foodId)?.role))
                    .filter(Boolean)
            )
            const categories = dedupeStrings(
                (row.matched_food_ids || [])
                    .map((foodId: string) => normalizeText(foodsById.get(foodId)?.category))
                    .filter(Boolean)
            )

            const foods = (row.foods || []).map((food: any) => {
                const dbFood = food.matched_food_id ? foodsById.get(food.matched_food_id) : null
                return {
                    ...food,
                    db_name: dbFood?.name || null,
                    role: dbFood?.role || null,
                    category: dbFood?.category || null,
                    tags: Array.isArray(dbFood?.tags) ? dbFood.tags : [],
                    compatibility_tags: Array.isArray(dbFood?.compatibility_tags) ? dbFood.compatibility_tags : [],
                }
            })

            return {
                ...row,
                roles,
                categories,
                foods,
            }
        })

        const summary = {
            total: Number(count || 0),
            offset,
            limit,
            returned: outputRows.length,
            total_repeat_count: outputRows.reduce((sum: number, row: any) => sum + Number(row.repeat_count || 0), 0),
            total_unknown_count: outputRows.reduce((sum: number, row: any) => sum + Number(row.unknown_count || 0), 0),
        }

        return NextResponse.json({
            rows: outputRows,
            summary,
        })
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "menu_import_pool list basarisiz" },
            { status: 500 }
        )
    }
}
