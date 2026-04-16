import { createHash } from "node:crypto"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

type RawEntry = {
    week_id?: string | null
    patient_id?: string | null
    program_template_id?: string | null
    week_number?: number | null
    source_type?: string | null
    source_file_id?: string | null
    source_file_name?: string | null
    source_tab_name?: string | null
    source_patient_name?: string | null
    raw_text?: string | null
    parsed_days?: unknown
}

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

type BaseEntry = {
    week_id: string | null
    patient_id: string | null
    program_template_id: string | null
    week_number: number | null
    source_type: string
    source_file_id: string | null
    source_file_name: string | null
    source_tab_name: string | null
    source_patient_name: string | null
    raw_text: string | null
    parsed_days: ParsedDay[]
}

type PreparedEntry = BaseEntry & {
    raw_text: string
    parsed_days: ParsedDay[]
    day_name: string | null
    meal_name: string | null
    meal_signature: string | null
    food_count: number
    unknown_count: number
    unknown_food_names: string[]
    matched_food_ids: string[]
}

type DedupeBucket = {
    entry: PreparedEntry
    count: number
    sourceTabs: Set<string>
    sourceFiles: Set<string>
    sourcePatients: Set<string>
}

const ALLOWED_ROLES = new Set(["admin", "doctor", "dietitian"])
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_QUERY_CHUNK = 100
const INSERT_CHUNK = 40

function asCleanText(value: unknown, maxLength = 512): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed.slice(0, maxLength)
}

function asMaybeUuid(value: unknown): string | null {
    const text = asCleanText(value, 64)
    if (!text) return null
    return UUID_REGEX.test(text) ? text : null
}

function asWeekNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    const intVal = Math.trunc(numeric)
    if (intVal < 1 || intVal > 2000) return null
    return intVal
}

function normalizeForHash(raw: string): string {
    return raw
        .replace(/\r/g, "\n")
        .split("\n")
        .map(line => line.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .join("\n")
        .toLocaleLowerCase("tr-TR")
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

        lookup.set(candidateName.toLocaleLowerCase("tr-TR"), macro)
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

function enrichParsedDaysWithRawMacros(base: BaseEntry): BaseEntry {
    if (!base.raw_text || !Array.isArray(base.parsed_days) || base.parsed_days.length === 0) {
        return base
    }

    const lookup = buildMacroLookupFromRawText(base.raw_text)
    if (lookup.size === 0) return base

    const patchedDays = base.parsed_days.map(day => {
        const meals = (day.meals || []).map(meal => {
            const foods = (meal.foods || []).map(food => {
                const isUnknown = !asMaybeUuid(food.matchedFoodId)
                if (!isUnknown) return food

                const foodMacro = {
                    calories: Number.isFinite(Number(food.calories)) ? Number(food.calories) : 0,
                    carbs: Number.isFinite(Number(food.carbs)) ? Number(food.carbs) : 0,
                    protein: Number.isFinite(Number(food.protein)) ? Number(food.protein) : 0,
                    fat: Number.isFinite(Number(food.fat)) ? Number(food.fat) : 0,
                }

                const hasAnyMacro = Object.values(foodMacro).some(v => v > 0)
                if (hasAnyMacro) return food

                const macroFromText =
                    extractMacrosFromText(String(food.originalText || food.foodName || "")) ||
                    getMacroFromLookup(String(food.foodName || food.originalText || ""), lookup)
                if (!macroFromText) return food

                return {
                    ...food,
                    calories: macroFromText.calories,
                    carbs: macroFromText.carbs,
                    protein: macroFromText.protein,
                    fat: macroFromText.fat,
                    status: food.status || "created",
                }
            })
            return { ...meal, foods }
        })
        return { ...day, meals }
    })

    return { ...base, parsed_days: patchedDays }
}

function normalizeText(raw: unknown): string {
    if (typeof raw !== "string") return ""
    return raw.trim().replace(/\s+/g, " ")
}

function normalizeFoodName(raw: string): string {
    return normalizeText(raw).toLocaleLowerCase("tr-TR")
}

function splitTabPrefixFromDayName(rawDayName: string) {
    const raw = normalizeText(rawDayName)
    const match = raw.match(/^\[(.+?)\]\s*(.+)$/)
    if (match?.[1] && match?.[2]) {
        return {
            tabName: normalizeText(match[1]) || null,
            cleanDayName: normalizeText(match[2]) || "GUN",
        }
    }
    return {
        tabName: null as string | null,
        cleanDayName: raw || "GUN",
    }
}

function asFiniteNumber(value: unknown): number | null {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    return parsed
}

function roundMacro(value: number | null): string {
    if (value === null) return "0"
    return Number(value.toFixed(2)).toString()
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
                    calories: asFiniteNumber(foodObj.calories),
                    carbs: asFiniteNumber(foodObj.carbs),
                    protein: asFiniteNumber(foodObj.protein),
                    fat: asFiniteNumber(foodObj.fat),
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

function prepareBaseEntry(entry: RawEntry): BaseEntry | null {
    const rawText = typeof entry?.raw_text === "string" ? entry.raw_text.trim() : ""
    const parsedDays = parseParsedDays(entry?.parsed_days)
    if (!rawText && parsedDays.length === 0) return null

    return {
        week_id: asMaybeUuid(entry.week_id),
        patient_id: asMaybeUuid(entry.patient_id),
        program_template_id: asMaybeUuid(entry.program_template_id),
        week_number: asWeekNumber(entry.week_number),
        source_type: asCleanText(entry.source_type, 64) || "google_sheets",
        source_file_id: asCleanText(entry.source_file_id, 256),
        source_file_name: asCleanText(entry.source_file_name, 256),
        source_tab_name: asCleanText(entry.source_tab_name, 256),
        source_patient_name: asCleanText(entry.source_patient_name, 256),
        raw_text: rawText || null,
        parsed_days: parsedDays,
    }
}

function buildRawTextFromMeal(dayName: string, mealName: string, foods: ParsedFood[]): string {
    const lines: string[] = []
    if (dayName) lines.push(dayName)
    if (mealName) lines.push(mealName)
    for (const food of foods) {
        const label = normalizeText(food.foodName || food.originalText || "")
        if (!label) continue
        lines.push(
            `- ${label} | ${roundMacro(asFiniteNumber(food.calories))} ${roundMacro(asFiniteNumber(food.carbs))} ${roundMacro(asFiniteNumber(food.protein))} ${roundMacro(asFiniteNumber(food.fat))}`
        )
    }
    return lines.join("\n").trim()
}

function buildMealSignature(mealName: string, foods: ParsedFood[]): string {
    const foodTokens = foods
        .map(food => {
            const label = normalizeFoodName(food.foodName || food.originalText || "")
            if (!label) return ""
            return `${label}|${roundMacro(asFiniteNumber(food.calories))}|${roundMacro(asFiniteNumber(food.carbs))}|${roundMacro(asFiniteNumber(food.protein))}|${roundMacro(asFiniteNumber(food.fat))}`
        })
        .filter(Boolean)
        .sort()

    return [
        normalizeFoodName(mealName),
        ...foodTokens,
    ].join("||")
}

function dedupeStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(v => v.trim()).filter(Boolean)))
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size))
    }
    return chunks
}

function parseLabelSet(raw: unknown) {
    if (typeof raw !== "string") return new Set<string>()
    const values = raw
        .split("|")
        .map(v => normalizeText(v))
        .filter(Boolean)
    return new Set(values)
}

function collapseLabelSet(values: Set<string>, maxLength = 512) {
    const joined = Array.from(values).join(" | ")
    return joined.slice(0, maxLength) || null
}

function expandToMealPackages(base: BaseEntry): PreparedEntry[] {
    const rows: PreparedEntry[] = []

    for (const day of base.parsed_days) {
        const parsedDay = splitTabPrefixFromDayName(day.dayName || "")
        const dayName = parsedDay.cleanDayName
        const rowTabName = parsedDay.tabName || base.source_tab_name
        for (const meal of day.meals || []) {
            const mealName = normalizeText(meal.mealName || "") || "OGUN"
            const foods = (meal.foods || []).filter(food => normalizeText(food.foodName || food.originalText || "").length > 0)
            if (foods.length === 0) continue

            const unknownFoodNames = dedupeStrings(
                foods
                    .filter(food => !asMaybeUuid(food.matchedFoodId))
                    .map(food => normalizeText(food.foodName || food.originalText || ""))
            )
            const matchedFoodIds = dedupeStrings(
                foods
                    .map(food => asMaybeUuid(food.matchedFoodId))
                    .filter((id): id is string => Boolean(id))
            )

            const mealSignature = buildMealSignature(mealName, foods)
            const rawText = buildRawTextFromMeal(dayName, mealName, foods)
            if (!mealSignature || !rawText) continue

            rows.push({
                ...base,
                source_tab_name: rowTabName,
                raw_text: rawText,
                parsed_days: [
                    {
                        dayName,
                        meals: [
                            {
                                mealName,
                                foods,
                            },
                        ],
                    },
                ],
                day_name: dayName,
                meal_name: mealName,
                meal_signature: mealSignature,
                food_count: foods.length,
                unknown_count: unknownFoodNames.length,
                unknown_food_names: unknownFoodNames,
                matched_food_ids: matchedFoodIds,
            })
        }
    }

    if (rows.length > 0) return rows

    if (!base.raw_text) return []
    const fallbackSignature = normalizeForHash(base.raw_text)
    if (!fallbackSignature) return []

    return [
        {
            ...base,
            raw_text: base.raw_text,
            parsed_days: base.parsed_days,
            day_name: null,
            meal_name: null,
            meal_signature: `raw::${fallbackSignature}`,
            food_count: 0,
            unknown_count: 0,
            unknown_food_names: [],
            matched_food_ids: [],
        },
    ]
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
                        // no-op for route handler
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
        const rawEntries: RawEntry[] = Array.isArray(body?.entries) ? body.entries : []
        if (rawEntries.length === 0) {
            return NextResponse.json({ error: "entries bos olamaz" }, { status: 400 })
        }
        if (rawEntries.length > 500) {
            return NextResponse.json({ error: "Tek istekte en fazla 500 kayit kabul edilir" }, { status: 400 })
        }

        const dedupeMap = new Map<string, DedupeBucket>()
        let skipped = 0
        let payloadMealPackages = 0

        for (const rawEntry of rawEntries) {
            const base = prepareBaseEntry(rawEntry || {})
            if (!base) {
                skipped += 1
                continue
            }
            const enrichedBase = enrichParsedDaysWithRawMacros(base)
            const packages = expandToMealPackages(enrichedBase)
            if (packages.length === 0) {
                skipped += 1
                continue
            }

            for (const prepared of packages) {
                payloadMealPackages += 1
                const signature = prepared.meal_signature || normalizeForHash(prepared.raw_text)
                const hash = createHash("sha256").update(signature).digest("hex")
                const existing = dedupeMap.get(hash)
                if (existing) {
                    existing.count += 1
                    if (prepared.source_tab_name) existing.sourceTabs.add(prepared.source_tab_name)
                    if (prepared.source_file_name) existing.sourceFiles.add(prepared.source_file_name)
                    if (prepared.source_patient_name) existing.sourcePatients.add(prepared.source_patient_name)
                } else {
                    dedupeMap.set(hash, {
                        entry: prepared,
                        count: 1,
                        sourceTabs: new Set(prepared.source_tab_name ? [prepared.source_tab_name] : []),
                        sourceFiles: new Set(prepared.source_file_name ? [prepared.source_file_name] : []),
                        sourcePatients: new Set(prepared.source_patient_name ? [prepared.source_patient_name] : []),
                    })
                }
            }
        }

        const hashes = Array.from(dedupeMap.keys())
        if (hashes.length === 0) {
            return NextResponse.json({ error: "Gecerli kayit bulunamadi" }, { status: 400 })
        }

        // Detect optional meal-package columns so ingest can keep working on partially migrated schemas.
        const { error: schemaProbeError } = await supabaseAdmin
            .from("menu_import_pool")
            .select("id, day_name, meal_name, food_count, unknown_count, unknown_food_names, matched_food_ids, meal_signature")
            .limit(1)
        const hasMealPackageColumns = !schemaProbeError

        const existingRows: any[] = []
        for (const hashChunk of chunkArray(hashes, HASH_QUERY_CHUNK)) {
            const { data, error: existingError } = await supabaseAdmin
                .from("menu_import_pool")
                .select("id, dedupe_hash, repeat_count, source_tab_name, source_file_name, source_patient_name")
                .in("dedupe_hash", hashChunk)

            if (existingError) {
                return NextResponse.json(
                    {
                        error: existingError.message,
                        code: (existingError as any)?.code || null,
                        hint: (existingError as any)?.hint || null,
                    },
                    { status: 500 }
                )
            }
            if (Array.isArray(data)) existingRows.push(...data)
        }

        const existingByHash = new Map(
            (existingRows || []).map((row: any) => [String(row.dedupe_hash), row as { id: string; dedupe_hash: string; repeat_count: number }])
        )

        const nowIso = new Date().toISOString()
        const inserts: any[] = []
        const updates: { id: string; repeat_count: number; source_tab_name: string | null; source_file_name: string | null; source_patient_name: string | null }[] = []

        for (const [hash, item] of dedupeMap.entries()) {
            const found = existingByHash.get(hash)
            if (found) {
                const existingTabs = parseLabelSet((found as any).source_tab_name)
                const existingFiles = parseLabelSet((found as any).source_file_name)
                const existingPatients = parseLabelSet((found as any).source_patient_name)
                for (const t of item.sourceTabs) existingTabs.add(t)
                for (const f of item.sourceFiles) existingFiles.add(f)
                for (const p of item.sourcePatients) existingPatients.add(p)
                updates.push({
                    id: found.id,
                    repeat_count: Math.max(1, Number(found.repeat_count || 1)) + item.count,
                    source_tab_name: collapseLabelSet(existingTabs),
                    source_file_name: collapseLabelSet(existingFiles),
                    source_patient_name: collapseLabelSet(existingPatients),
                })
                continue
            }

            const baseInsert = {
                week_id: item.entry.week_id,
                patient_id: item.entry.patient_id,
                program_template_id: item.entry.program_template_id,
                week_number: item.entry.week_number,
                source_type: item.entry.source_type,
                source_file_id: item.entry.source_file_id,
                source_file_name: collapseLabelSet(item.sourceFiles),
                source_tab_name: collapseLabelSet(item.sourceTabs),
                source_patient_name: collapseLabelSet(item.sourcePatients),
                raw_text: item.entry.raw_text,
                parsed_days: item.entry.parsed_days,
                dedupe_hash: hash,
                repeat_count: item.count,
                created_by: callerId,
                updated_at: nowIso,
            }

            const mealColumnsInsert = hasMealPackageColumns
                ? {
                      day_name: item.entry.day_name,
                      meal_name: item.entry.meal_name,
                      meal_signature: item.entry.meal_signature,
                      food_count: item.entry.food_count,
                      unknown_count: item.entry.unknown_count,
                      unknown_food_names: item.entry.unknown_food_names,
                      matched_food_ids: item.entry.matched_food_ids,
                  }
                : {}

            inserts.push({
                ...baseInsert,
                ...mealColumnsInsert,
            })
        }

        if (inserts.length > 0) {
            for (const insertChunk of chunkArray(inserts, INSERT_CHUNK)) {
                const { error: insertError } = await supabaseAdmin
                    .from("menu_import_pool")
                    .insert(insertChunk)
                if (insertError) {
                    return NextResponse.json(
                        {
                            error: insertError.message,
                            code: (insertError as any)?.code || null,
                            hint: (insertError as any)?.hint || null,
                            details: {
                                chunk_size: insertChunk.length,
                                total_inserts: inserts.length,
                            },
                        },
                        { status: 500 }
                    )
                }
            }
        }

        for (const update of updates) {
            const { error: updateError } = await supabaseAdmin
                .from("menu_import_pool")
                .update({
                    repeat_count: update.repeat_count,
                    source_tab_name: update.source_tab_name,
                    source_file_name: update.source_file_name,
                    source_patient_name: update.source_patient_name,
                    updated_at: nowIso,
                })
                .eq("id", update.id)
            if (updateError) {
                return NextResponse.json(
                    {
                        error: updateError.message,
                        code: (updateError as any)?.code || null,
                        hint: (updateError as any)?.hint || null,
                    },
                    { status: 500 }
                )
            }
        }

        const insertedUnique = inserts.length
        const repeatedPackages = Math.max(0, payloadMealPackages - insertedUnique)

        return NextResponse.json({
            success: true,
            summary: {
                payload_total: rawEntries.length,
                payload_meal_packages: payloadMealPackages,
                unique_meal_packages: hashes.length,
                inserted: inserts.length,
                deduped: updates.length,
                new_meal_packages: insertedUnique,
                repeat_meal_packages: repeatedPackages,
                skipped,
            },
        })
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "menu_import_pool ingest basarisiz" },
            { status: 500 }
        )
    }
}
