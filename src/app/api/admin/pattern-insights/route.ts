import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

type ProgramOption = { id: string; name: string }
type PhaseOption = { key: string; label: string; programId: string }
type MetricRow = {
    lhs_food_id: string
    lhs_food_name: string
    lhs_role: string | null
    lhs_category: string | null
    lhs_tags: string[]
    lhs_compatibility_tags: string[]
    rhs_food_id: string
    rhs_food_name: string
    rhs_role: string | null
    rhs_category: string | null
    rhs_tags: string[]
    rhs_compatibility_tags: string[]
    support_count: number
    lhs_count: number
    rhs_count: number
    basket_count: number
    support_rate: number
    confidence: number
    lift: number
}

type FrequencyMetricRow = {
    basis_type: 'role' | 'category' | 'tag' | 'name_contains'
    basis_value: string
    weeks_with_item: number
    total_weeks: number
    week_support_rate: number
    avg_per_week: number
    median_per_week: number
    dominant_weekly_count: number
    dominant_weekly_rate: number
    total_occurrences: number
    top_meal_time: string | null
    top_meal_rate: number
    suggested_min_weekly: number
    suggested_max_weekly: number
}

function parseCsvParam(value: string | null): string[] {
    if (!value) return []
    return value
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
}

function parseNumber(value: string | null, fallback: number) {
    if (!value) return fallback
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

function chunkArray<T>(arr: T[], size: number) {
    const chunks: T[][] = []
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size))
    }
    return chunks
}

async function selectByIdsPaged(
    table: string,
    selectClause: string,
    idColumn: string,
    ids: string[],
    options?: {
        pageSize?: number
        apply?: (query: any) => any
    }
) {
    if (ids.length === 0) return []
    const idChunks = chunkArray(ids, 120)
    const pageSize = options?.pageSize ?? 1000
    const allRows: any[] = []

    for (const idChunk of idChunks) {
        let from = 0
        while (true) {
            let query = supabaseAdmin
                .from(table)
                .select(selectClause)
                .in(idColumn, idChunk)
                .range(from, from + pageSize - 1)

            if (options?.apply) {
                query = options.apply(query)
            }

            const { data, error } = await query
            if (error) throw error
            if (!data || data.length === 0) break

            allRows.push(...data)
            if (data.length < pageSize) break
            from += pageSize
        }
    }

    return allRows
}

function seasonKey(start: number | null | undefined, end: number | null | undefined) {
    if (!start || !end) return null
    return `${start}-${end}`
}

function seasonLabel(start: number | null | undefined, end: number | null | undefined) {
    if (!start || !end) return null
    const monthNames = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara']
    return `${start}-${end} (${monthNames[start - 1] || start}-${monthNames[end - 1] || end})`
}

function normalizeMonth(month: number | null | undefined): number | null {
    if (!month || !Number.isFinite(month)) return null
    const intMonth = Math.trunc(Number(month))
    if (intMonth < 1 || intMonth > 12) return null
    return intMonth
}

function monthRangeToSet(start: number, end: number): Set<number> {
    const result = new Set<number>()
    if (start <= end) {
        for (let m = start; m <= end; m += 1) result.add(m)
        return result
    }
    for (let m = start; m <= 12; m += 1) result.add(m)
    for (let m = 1; m <= end; m += 1) result.add(m)
    return result
}

function dedupeStringArray(values: (string | null | undefined)[]) {
    return Array.from(new Set(values.map(v => String(v || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr'))
}

function parseTagArray(value: unknown): string[] {
    if (!value) return []
    if (Array.isArray(value)) {
        return value.map(v => String(v).trim()).filter(Boolean)
    }
    if (typeof value === 'string') {
        return value
            .split(/[\n,]+/)
            .map(v => v.trim())
            .filter(Boolean)
    }
    return []
}

const NAME_STOPWORDS = new Set([
    've',
    'ile',
    'bir',
    'adet',
    'gram',
    'gr',
    'orta',
    'kucuk',
    'buyuk',
    'yemegi',
    'yemek',
    'tane',
    'icin',
    'veya',
    'ya',
    'da',
    'saat',
    'tercihen',
    'tatli',
    'kasigi',
    'kasik',
    'corba',
    'keto',
    'ketojenik',
    'lowcarb',
    'low',
    'carb',
])

function normalizeText(value: string) {
    return value.toLocaleLowerCase('tr-TR').trim()
}

function tokenizeName(value: string) {
    return normalizeText(value)
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map(v => v.trim())
        .filter(v => v.length >= 4 && !NAME_STOPWORDS.has(v))
}

function average(values: number[]) {
    if (values.length === 0) return 0
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: number[]) {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 1) return sorted[mid]
    return (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(values: number[], q: number) {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const pos = (sorted.length - 1) * q
    const base = Math.floor(pos)
    const rest = pos - base
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base])
    }
    return sorted[base]
}

function modeWithRate(values: number[]) {
    if (values.length === 0) return { mode: 0, rate: 0 }
    const counts = new Map<number, number>()
    for (const value of values) {
        counts.set(value, (counts.get(value) || 0) + 1)
    }
    let bestValue = values[0]
    let bestCount = 0
    for (const [value, count] of counts.entries()) {
        if (count > bestCount || (count === bestCount && value < bestValue)) {
            bestValue = value
            bestCount = count
        }
    }
    return { mode: bestValue, rate: bestCount / values.length }
}

export async function GET(req: NextRequest) {
    try {
        const params = req.nextUrl.searchParams

        const programIds = parseCsvParam(params.get('program_ids'))
        const phaseKeys = parseCsvParam(params.get('phase_keys'))
        const mealTimes = parseCsvParam(params.get('meal_times'))
        const foodRoles = parseCsvParam(params.get('food_roles'))
        const foodCategories = parseCsvParam(params.get('food_categories'))
        const foodSeasons = parseCsvParam(params.get('food_seasons'))
        const dataSourceRaw = String(params.get('data_source') || 'both').trim().toLowerCase()
        const dataSource: 'render' | 'pool' | 'both' =
            dataSourceRaw === 'render' || dataSourceRaw === 'pool' || dataSourceRaw === 'both'
                ? (dataSourceRaw as 'render' | 'pool' | 'both')
                : 'both'
        const useRender = dataSource !== 'pool'
        const usePool = dataSource !== 'render'
        const seasonStartMonth = normalizeMonth(parseNumber(params.get('season_start_month'), Number.NaN))
        const seasonEndMonth = normalizeMonth(parseNumber(params.get('season_end_month'), Number.NaN))
        const requestedSeasonMonths =
            seasonStartMonth && seasonEndMonth ? monthRangeToSet(seasonStartMonth, seasonEndMonth) : null

        const weekStart = parseNumber(params.get('week_start'), 1)
        const weekEnd = parseNumber(params.get('week_end'), 999)
        const minSupport = Math.max(1, parseNumber(params.get('min_support'), 3))
        const minConfidence = Math.max(0, Math.min(1, parseNumber(params.get('min_confidence'), 0.1)))
        const limit = Math.max(10, Math.min(300, parseNumber(params.get('limit'), 120)))

        const { data: programsRaw, error: programsError } = await supabaseAdmin
            .from('program_templates')
            .select('id, name, program_template_weeks(week_start, week_end, diet_type_id, diet_types(name))')
            .order('name')

        if (programsError) {
            throw programsError
        }

        const programOptions: ProgramOption[] = (programsRaw || []).map((p: any) => ({
            id: p.id,
            name: p.name || 'Adsiz Program',
        }))

        const phaseOptions: PhaseOption[] = []
        const phaseByProgram = new Map<string, { key: string; label: string; week_start: number; week_end: number }[]>()

        for (const program of programsRaw || []) {
            const weekDefs = (program.program_template_weeks || [])
                .filter((w: any) => Number.isFinite(w.week_start) && Number.isFinite(w.week_end))
                .sort((a: any, b: any) => Number(a.week_start) - Number(b.week_start))
                .map((w: any, idx: number) => {
                    const dietTypeName = w.diet_types?.name || 'Diyet Tipi'
                    const key = `${program.id}:${w.week_start}-${w.week_end}:${w.diet_type_id || idx + 1}`
                    const label = `${program.name} | Faz ${idx + 1} (${w.week_start}-${w.week_end}) - ${dietTypeName}`
                    return {
                        key,
                        label,
                        week_start: Number(w.week_start),
                        week_end: Number(w.week_end),
                    }
                })

            phaseByProgram.set(program.id, weekDefs)
            phaseOptions.push(...weekDefs.map(w => ({ key: w.key, label: w.label, programId: program.id })))
        }

        type OccurrenceRow = {
            basket_key: string
            week_key: string
            meal_time: string
            food_id: string | null
            custom_name: string | null
        }

        const occurrences: OccurrenceRow[] = []
        const filteredWeekKeys = new Set<string>()
        const mealOptionsSet = new Set<string>()

        if (useRender) {
            let patientsQuery = supabaseAdmin
                .from('patients')
                .select('id, program_template_id')
                .not('id', 'is', null)
                .range(0, 20000)

            if (programIds.length > 0) {
                patientsQuery = patientsQuery.in('program_template_id', programIds)
            }

            const { data: patientsRaw, error: patientsError } = await patientsQuery
            if (patientsError) throw patientsError

            const patients = patientsRaw || []
            if (patients.length > 0) {
                const patientIds = patients.map((p: any) => p.id)
                const programByPatientId = new Map<string, string | null>(
                    patients.map((p: any) => [p.id, p.program_template_id || null])
                )

                const plans = await selectByIdsPaged('diet_plans', 'id, patient_id, status', 'patient_id', patientIds)
                const planIds = plans.map((p: any) => p.id)
                const patientByPlanId = new Map<string, string>(plans.map((p: any) => [p.id, p.patient_id]))

                if (planIds.length > 0) {
                    const weeks = await selectByIdsPaged(
                        'diet_weeks',
                        'id, diet_plan_id, week_number, start_date, end_date',
                        'diet_plan_id',
                        planIds,
                        {
                            apply: (q: any) => q.gte('week_number', weekStart).lte('week_number', weekEnd),
                        }
                    )

                    const weekMeta = new Map<string, { week_number: number; program_id: string | null; phase_key: string | null }>()
                    for (const week of weeks) {
                        const patientId = patientByPlanId.get(week.diet_plan_id)
                        const programId = patientId ? programByPatientId.get(patientId) || null : null
                        let phaseKey: string | null = null
                        if (programId) {
                            const phaseDefs = phaseByProgram.get(programId) || []
                            const matched = phaseDefs.find(p => week.week_number >= p.week_start && week.week_number <= p.week_end)
                            phaseKey = matched?.key || null
                        }
                        weekMeta.set(week.id, {
                            week_number: Number(week.week_number) || 0,
                            program_id: programId,
                            phase_key: phaseKey,
                        })
                    }

                    const filteredWeeks = weeks.filter((w: any) => {
                        const meta = weekMeta.get(w.id)
                        if (!meta) return false
                        if (programIds.length > 0 && (!meta.program_id || !programIds.includes(meta.program_id))) return false
                        if (phaseKeys.length > 0 && (!meta.phase_key || !phaseKeys.includes(meta.phase_key))) return false
                        return true
                    })

                    const weekIds = filteredWeeks.map((w: any) => w.id)
                    const days =
                        weekIds.length > 0
                            ? await selectByIdsPaged('diet_days', 'id, diet_week_id, day_number', 'diet_week_id', weekIds)
                            : []
                    const dayIds = days.map((d: any) => d.id)
                    const weekIdByDayId = new Map<string, string>(days.map((d: any) => [d.id, d.diet_week_id]))

                    const meals =
                        dayIds.length > 0
                            ? await selectByIdsPaged('diet_meals', 'id, diet_day_id, meal_time, food_id, custom_name', 'diet_day_id', dayIds)
                            : []

                    for (const meal of meals) {
                        const weekId = weekIdByDayId.get(meal.diet_day_id)
                        if (!weekId) continue
                        const meta = weekMeta.get(weekId)
                        if (!meta) continue
                        if (phaseKeys.length > 0 && (!meta.phase_key || !phaseKeys.includes(meta.phase_key))) continue

                        const mealSlot = String(meal.meal_time || 'DIGER').trim() || 'DIGER'
                        mealOptionsSet.add(mealSlot)
                        if (mealTimes.length > 0 && !mealTimes.includes(mealSlot)) continue

                        const weekKey = `render:${weekId}`
                        filteredWeekKeys.add(weekKey)
                        occurrences.push({
                            basket_key: `render:${meal.diet_day_id}::${mealSlot}`,
                            week_key: weekKey,
                            meal_time: mealSlot,
                            food_id: meal.food_id ? String(meal.food_id) : null,
                            custom_name: meal.custom_name ? String(meal.custom_name) : null,
                        })
                    }
                }
            }
        }

        if (usePool) {
            const poolRows: any[] = []
            let from = 0
            const pageSize = 1000
            while (true) {
                let poolQuery = supabaseAdmin
                    .from('menu_import_pool')
                    .select(
                        'id, week_id, week_number, program_template_id, meal_name, matched_food_ids, source_file_id, source_file_name, source_patient_name, source_tab_name'
                    )
                    .order('created_at', { ascending: false })
                    .range(from, from + pageSize - 1)

                if (programIds.length > 0) {
                    poolQuery = poolQuery.in('program_template_id', programIds)
                }
                poolQuery = poolQuery.gte('week_number', weekStart).lte('week_number', weekEnd)

                const { data, error } = await poolQuery
                if (error) throw error
                if (!data || data.length === 0) break

                poolRows.push(...data)
                if (data.length < pageSize) break
                from += pageSize
            }

            for (const row of poolRows) {
                const mealSlot = String(row.meal_name || 'DIGER').trim() || 'DIGER'
                mealOptionsSet.add(mealSlot)
                if (mealTimes.length > 0 && !mealTimes.includes(mealSlot)) continue

                const programId = row.program_template_id ? String(row.program_template_id) : null
                const weekNumber = Number(row.week_number) || 0
                let phaseKey: string | null = null
                if (programId && weekNumber > 0) {
                    const phaseDefs = phaseByProgram.get(programId) || []
                    const matched = phaseDefs.find(p => weekNumber >= p.week_start && weekNumber <= p.week_end)
                    phaseKey = matched?.key || null
                }
                if (phaseKeys.length > 0 && (!phaseKey || !phaseKeys.includes(phaseKey))) continue

                const poolWeekKey =
                    row.week_id
                        ? `poolweek:${row.week_id}`
                        : `pool:${programId || 'noprog'}:${weekNumber || 0}:${row.source_file_id || row.source_file_name || row.source_patient_name || row.source_tab_name || row.id}`

                filteredWeekKeys.add(poolWeekKey)

                const matchedFoodIds = Array.isArray(row.matched_food_ids)
                    ? row.matched_food_ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
                    : []

                for (const foodId of matchedFoodIds) {
                    occurrences.push({
                        basket_key: `pool:${row.id}`,
                        week_key: poolWeekKey,
                        meal_time: mealSlot,
                        food_id: foodId,
                        custom_name: null,
                    })
                }
            }
        }

        const allFoodIds = Array.from(new Set(occurrences.map(o => o.food_id).filter(Boolean) as string[]))
        const foods =
            allFoodIds.length > 0
                ? await selectByIdsPaged(
                    'foods',
                    'id, name, role, category, tags, compatibility_tags, season_start, season_end',
                    'id',
                    allFoodIds
                )
                : []
        const foodById = new Map<string, any>(foods.map((f: any) => [f.id, f]))

        const roleOptions = dedupeStringArray(foods.map((f: any) => f.role))
        const categoryOptions = dedupeStringArray(foods.map((f: any) => f.category))
        const tagOptions = dedupeStringArray(
            foods.flatMap((f: any) => [...parseTagArray(f.tags), ...parseTagArray(f.compatibility_tags)])
        )
        const seasonOptionsRaw = Array.from(
            new Map(
                foods
                    .map((f: any) => {
                        const key = seasonKey(f.season_start, f.season_end)
                        const label = seasonLabel(f.season_start, f.season_end)
                        if (!key || !label) return null
                        return [key, { key, label }]
                    })
                    .filter(Boolean) as [string, { key: string; label: string }][]
            ).values()
        )

        const basketItems = new Map<string, Set<string>>()
        const itemNames = new Map<string, string>()
        const itemMeta = new Map<
            string,
            { role: string | null; category: string | null; tags: string[]; compatibilityTags: string[]; allTags: string[] }
        >()
        const weekIdList = Array.from(filteredWeekKeys)
        const basisMeta = new Map<string, { basis_type: FrequencyMetricRow['basis_type']; basis_value: string }>()
        const basisWeekCounts = new Map<string, Map<string, number>>()
        const basisMealCounts = new Map<string, Map<string, number>>()

        const addFrequencyOccurrence = (
            basisType: FrequencyMetricRow['basis_type'],
            basisValueRaw: string,
            weekId: string,
            mealTimeRaw: string
        ) => {
            const basisValue = normalizeText(String(basisValueRaw || ''))
            if (!basisValue) return
            const basisKey = `${basisType}:${basisValue}`
            if (!basisMeta.has(basisKey)) {
                basisMeta.set(basisKey, { basis_type: basisType, basis_value: basisValue })
            }

            const weekCounts = basisWeekCounts.get(basisKey) || new Map<string, number>()
            weekCounts.set(weekId, (weekCounts.get(weekId) || 0) + 1)
            basisWeekCounts.set(basisKey, weekCounts)

            const mealTime = String(mealTimeRaw || 'DIGER').trim() || 'DIGER'
            const mealCounts = basisMealCounts.get(basisKey) || new Map<string, number>()
            mealCounts.set(mealTime, (mealCounts.get(mealTime) || 0) + 1)
            basisMealCounts.set(basisKey, mealCounts)
        }

        for (const occurrence of occurrences) {
            const mealSlot = String(occurrence.meal_time || 'DIGER').trim() || 'DIGER'
            const food = occurrence.food_id ? foodById.get(occurrence.food_id) : null

            if (foodRoles.length > 0) {
                const role = String(food?.role || '').trim()
                if (!foodRoles.includes(role)) continue
            }
            if (foodCategories.length > 0) {
                const category = String(food?.category || '').trim()
                if (!foodCategories.includes(category)) continue
            }
            if (foodSeasons.length > 0) {
                const key = seasonKey(food?.season_start, food?.season_end)
                if (!key || !foodSeasons.includes(key)) continue
            }
            if (requestedSeasonMonths) {
                const foodStart = normalizeMonth(food?.season_start)
                const foodEnd = normalizeMonth(food?.season_end)
                if (!foodStart || !foodEnd) continue
                const foodMonths = monthRangeToSet(foodStart, foodEnd)
                const hasOverlap = Array.from(foodMonths).some(month => requestedSeasonMonths.has(month))
                if (!hasOverlap) continue
            }

            const foodKey = occurrence.food_id
                ? `food:${occurrence.food_id}`
                : `custom:${String(occurrence.custom_name || '').trim().toLocaleLowerCase('tr-TR')}`
            if (foodKey.endsWith(':')) continue

            itemNames.set(foodKey, food?.name || String(occurrence.custom_name || 'Ozel Yemek'))
            itemMeta.set(foodKey, {
                role: food?.role ? String(food.role) : null,
                category: food?.category ? String(food.category) : null,
                tags: parseTagArray(food?.tags),
                compatibilityTags: parseTagArray(food?.compatibility_tags),
                allTags: [...parseTagArray(food?.tags), ...parseTagArray(food?.compatibility_tags)],
            })

            if (!basketItems.has(occurrence.basket_key)) basketItems.set(occurrence.basket_key, new Set<string>())
            basketItems.get(occurrence.basket_key)?.add(foodKey)

            const role = String(food?.role || '').trim()
            const category = String(food?.category || '').trim()
            const allTags = Array.from(
                new Set([
                    ...parseTagArray(food?.tags),
                    ...parseTagArray(food?.compatibility_tags),
                ])
            )
            const tokenSource = String(food?.name || occurrence.custom_name || '').trim()
            const nameTokens = Array.from(new Set(tokenizeName(tokenSource)))

            if (role) addFrequencyOccurrence('role', role, occurrence.week_key, mealSlot)
            if (category) addFrequencyOccurrence('category', category, occurrence.week_key, mealSlot)
            for (const tag of allTags) {
                addFrequencyOccurrence('tag', tag, occurrence.week_key, mealSlot)
            }
            for (const token of nameTokens) {
                addFrequencyOccurrence('name_contains', token, occurrence.week_key, mealSlot)
            }
        }

        const basketCount = basketItems.size
        const itemCount = new Map<string, number>()
        const pairCount = new Map<string, number>()

        for (const set of basketItems.values()) {
            const arr = Array.from(set)
            for (const a of arr) {
                itemCount.set(a, (itemCount.get(a) || 0) + 1)
            }
            for (let i = 0; i < arr.length; i++) {
                for (let j = 0; j < arr.length; j++) {
                    if (i === j) continue
                    const key = `${arr[i]}__${arr[j]}`
                    pairCount.set(key, (pairCount.get(key) || 0) + 1)
                }
            }
        }

        const metrics: MetricRow[] = []
        for (const [key, supportCount] of pairCount.entries()) {
            if (supportCount < minSupport) continue
            const [lhs, rhs] = key.split('__')
            const lhsCount = itemCount.get(lhs) || 0
            const rhsCount = itemCount.get(rhs) || 0
            if (lhsCount === 0 || rhsCount === 0 || basketCount === 0) continue

            const confidence = supportCount / lhsCount
            if (confidence < minConfidence) continue
            const rhsBase = rhsCount / basketCount
            const lift = rhsBase > 0 ? confidence / rhsBase : 0

            metrics.push({
                lhs_food_id: lhs,
                lhs_food_name: itemNames.get(lhs) || lhs,
                lhs_role: itemMeta.get(lhs)?.role || null,
                lhs_category: itemMeta.get(lhs)?.category || null,
                lhs_tags: itemMeta.get(lhs)?.tags || [],
                lhs_compatibility_tags: itemMeta.get(lhs)?.compatibilityTags || [],
                rhs_food_id: rhs,
                rhs_food_name: itemNames.get(rhs) || rhs,
                rhs_role: itemMeta.get(rhs)?.role || null,
                rhs_category: itemMeta.get(rhs)?.category || null,
                rhs_tags: itemMeta.get(rhs)?.tags || [],
                rhs_compatibility_tags: itemMeta.get(rhs)?.compatibilityTags || [],
                support_count: supportCount,
                lhs_count: lhsCount,
                rhs_count: rhsCount,
                basket_count: basketCount,
                support_rate: Number((supportCount / basketCount).toFixed(4)),
                confidence: Number(confidence.toFixed(4)),
                lift: Number(lift.toFixed(4)),
            })
        }

        metrics.sort((a, b) => {
            if (b.support_count !== a.support_count) return b.support_count - a.support_count
            if (b.confidence !== a.confidence) return b.confidence - a.confidence
            return b.lift - a.lift
        })

        const frequencyMetrics: FrequencyMetricRow[] = []
        const totalWeeks = weekIdList.length
        const frequencyRowLimit = Math.max(limit * 5, 500)

        for (const [basisKey, basis] of basisMeta.entries()) {
            const weekCountsMap = basisWeekCounts.get(basisKey) || new Map<string, number>()
            const countsByWeek = weekIdList.map(weekId => weekCountsMap.get(weekId) || 0)
            const nonZeroCounts = countsByWeek.filter(count => count > 0)
            const weeksWithItem = nonZeroCounts.length
            if (weeksWithItem === 0) continue

            const totalOccurrences = countsByWeek.reduce((sum, count) => sum + count, 0)
            if (totalOccurrences < minSupport) continue

            const weekSupportRate = totalWeeks > 0 ? weeksWithItem / totalWeeks : 0
            const avgPerWeek = average(countsByWeek)
            const medianPerWeek = median(nonZeroCounts)
            const dominant = modeWithRate(nonZeroCounts)

            const p25 = percentile(nonZeroCounts, 0.25)
            const p75 = percentile(nonZeroCounts, 0.75)
            const suggestedMin = Math.max(1, Math.floor(Math.min(p25 || 1, dominant.mode || 1)))
            const suggestedMax = Math.max(
                suggestedMin,
                Math.ceil(Math.max(p75 || suggestedMin, dominant.mode || suggestedMin))
            )

            const mealCounts = basisMealCounts.get(basisKey) || new Map<string, number>()
            let topMealTime: string | null = null
            let topMealCount = 0
            for (const [mealTime, count] of mealCounts.entries()) {
                if (count > topMealCount) {
                    topMealTime = mealTime
                    topMealCount = count
                }
            }
            const topMealRate = totalOccurrences > 0 ? topMealCount / totalOccurrences : 0

            frequencyMetrics.push({
                basis_type: basis.basis_type,
                basis_value: basis.basis_value,
                weeks_with_item: weeksWithItem,
                total_weeks: totalWeeks,
                week_support_rate: Number(weekSupportRate.toFixed(4)),
                avg_per_week: Number(avgPerWeek.toFixed(4)),
                median_per_week: Number(medianPerWeek.toFixed(4)),
                dominant_weekly_count: dominant.mode,
                dominant_weekly_rate: Number(dominant.rate.toFixed(4)),
                total_occurrences: totalOccurrences,
                top_meal_time: topMealTime,
                top_meal_rate: Number(topMealRate.toFixed(4)),
                suggested_min_weekly: suggestedMin,
                suggested_max_weekly: suggestedMax,
            })
        }

        frequencyMetrics.sort((a, b) => {
            if (b.total_occurrences !== a.total_occurrences) return b.total_occurrences - a.total_occurrences
            if (b.week_support_rate !== a.week_support_rate) return b.week_support_rate - a.week_support_rate
            return b.avg_per_week - a.avg_per_week
        })

        const result = {
            options: {
                programs: programOptions,
                phases: phaseOptions,
                meals: dedupeStringArray(Array.from(mealOptionsSet)),
                roles: roleOptions,
                categories: categoryOptions,
                seasons: seasonOptionsRaw,
                tags: tagOptions,
            },
            summary: {
                basketCount,
                itemCount: itemCount.size,
                pairCount: pairCount.size,
                filteredMeals: occurrences.length,
                filteredWeeks: weekIdList.length,
                dataSource,
            },
            metrics: metrics.slice(0, limit),
            frequency_metrics: frequencyMetrics.slice(0, frequencyRowLimit),
        }

        return NextResponse.json(result)
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || 'Pattern insights hesaplanamadi.' },
            { status: 500 }
        )
    }
}
