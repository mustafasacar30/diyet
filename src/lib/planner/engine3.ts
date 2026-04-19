import { supabase } from "@/lib/supabase"
import { applyTeamFoodOverrides } from "@/lib/team-food-overrides"
import { applyTeamFoodMicronutrientOverrides } from "@/lib/team-food-micronutrient-overrides"
import { resolveTeamScopeContextForUser } from "@/lib/team-scope"
import { checkCompatibility } from "@/utils/compatibility-checker"
import { PlanningRule, PlannerSettings, RuleDefinition, PortionSettings } from "@/types/planner"

// Target Macros type
export type TargetMacros = {
    calories: number
    protein: number
    carbs: number
    fat: number
}

type FlavorTuningConfig = {
    enabled: boolean
    allow_post_edit: boolean
    respect_scope_filters: boolean
    respect_frequency_rules: boolean
    use_pattern_insights: boolean
    strict_locked_items: boolean
    suggestion_count: number
    macro_weight: number
    flavor_weight: number
    diversity_weight: number
    compatibility_weight: number
    pattern_weight: number
    pattern_min_confidence: number
    pattern_min_lift: number
    pattern_min_support: number
}

type PatternMetricRow = {
    lhs_food_id: string
    lhs_food_name?: string
    rhs_food_id: string
    rhs_food_name?: string
    support_count: number
    confidence: number
    lift: number
}

const DEFAULT_FLAVOR_TUNING_CONFIG: FlavorTuningConfig = {
    enabled: true,
    allow_post_edit: true,
    respect_scope_filters: true,
    respect_frequency_rules: true,
    use_pattern_insights: true,
    strict_locked_items: true,
    suggestion_count: 3,
    macro_weight: 0.4,
    flavor_weight: 0.35,
    diversity_weight: 0.15,
    compatibility_weight: 0.1,
    pattern_weight: 0.2,
    pattern_min_confidence: 0.15,
    pattern_min_lift: 1.1,
    pattern_min_support: 3
}

// Slot Configuration - defines how many foods per meal slot and which roles
export type SlotConfig = {
    minItems: number
    maxItems: number
    requiredRoles: string[]
    optionalRoles: string[]
    bannedRoles?: string[]
    bannedTags?: string[]
}

const TAG_MAPPING: Record<string, (f: any) => boolean> = {
    'KETOGENIC': f => !!f.keto || !!f.ketogenic, // Check both for robustness
    'LOW_CARB': f => !!f.lowcarb || !!f.low_carb || !!f.keto || !!f.ketogenic, // Robust check, Keto implies Low Carb
    'GLUTEN_FREE': f => (f.tags || []).some((t: string) => t.toLowerCase() === 'glutensiz'),
    'DAIRY_FREE': f => (f.tags || []).some((t: string) => ['sütsüz', 'laktozsuz'].includes(t.toLowerCase())),
    'HIGH_PROTEIN': f => (f.protein || 0) > 15, // Dynamic check
    'PALEO': f => (f.tags || []).includes('paleo')
}

export const DEFAULT_SLOT_CONFIG: Record<string, SlotConfig> = {
    'KAHVALTI': { minItems: 1, maxItems: 1, requiredRoles: [], optionalRoles: ['sideDish', 'drink', 'bread', 'fruit', 'snack', 'corba'] },
    'ÖĞLEN': { minItems: 2, maxItems: 6, requiredRoles: ['mainDish'], optionalRoles: ['sideDish', 'corba', 'bread', 'drink', 'dessert', 'snack', 'salad'] },
    'AKŞAM': { minItems: 2, maxItems: 6, requiredRoles: ['mainDish'], optionalRoles: ['sideDish', 'corba', 'bread', 'drink', 'dessert', 'salad', 'snack'] },
    'ARA ÖĞÜN': { minItems: 1, maxItems: 3, requiredRoles: ['snack'], optionalRoles: ['drink', 'fruit', 'nuts'] }
}

const STANDARD_ROLES = ['mainDish', 'sideDish', 'soup', 'drink', 'supplement', 'snack', 'dessert', 'salad', 'appetizer']

// Map slot names to food categories
const SLOT_TO_CATEGORY: Record<string, string> = {
    'KAHVALTI': 'KAHVALTI',
    'ÖĞLEN': 'ÖĞLEN',
    'AKŞAM': 'AKŞAM',
    'ARA ÖĞÜN': 'ARA ÖĞÜN'
}

// Tags that are exempt from conflict checking (general categories)
const EXEMPT_TAGS = ['protein', 'karbonhidrat', 'sebze', 'meyve', 'süt ürünü']

export class Planner {
    private settings: PlannerSettings | null = null
    private rules: PlanningRule[] = []
    private allFoods: any[] = []
    private eligibleFoods: any[] = [] // Filtered by diet type and banned tags
    private effectiveExemptTags: Set<string> = new Set()
    private programTemplateId: string | null = null // Patient's assigned program
    private teamOwnerId: string | null = null
    private activeDietRules: { allowedTags: string[], bannedKeywords: string[], bannedTags?: string[], bannedDetails?: Record<string, any>, dietName: string } | undefined = undefined
    private flavorTuningConfig: FlavorTuningConfig = { ...DEFAULT_FLAVOR_TUNING_CONFIG }
    private patternMetricsCache = new Map<string, PatternMetricRow[]>()
    private patternMetricsPromiseCache = new Map<string, Promise<PatternMetricRow[]>>()

    // Patient specific data for compatibility checks
    private patientDiseases: any[] = []
    private patientLabs: any[] = []
    private patientMedications: any[] = []
    private patientDislikedFoods: string[] = []
    private patientLikedFoods: string[] = []

    // ROTATION ENGINE STATE
    private rotationStates = new Map<string, {
        ruleId: string;
        ruleName: string;
        target: any;
        mode: 'sequential' | 'random_no_repeat';
        non_consecutive: boolean;
        items: { food_id: string, food_name: string }[];
        history: string[];       // From DB
        sessionUsed: string[];   // Used in THIS generation session
    }>()

    constructor(
        private patientId: string,
        private userId: string
    ) { }

    // Logging system
    public logs: { day: number, slot: string, event: 'select' | 'reject' | 'info' | 'error', food?: string, reason: string }[] = []

    // Track foods selected across the entire week for frequency rules
    private currentWeekFoods: any[] = []

    // Track current date for seasonality checks
    private today: Date = new Date()

    // Weekly locks: once a food is selected for these roles, use same food all week
    private weeklyLocks: Map<string, any> = new Map()
    private weeklyLockReasons: Map<string, { ruleId: string | null, ruleName: string }> = new Map()
    private static LOCKABLE_ROLES = ['bread', 'corba', 'soup']

    // Caches for random rule distribution
    private randomDaysCache: Map<string, number[]> = new Map()
    private rotationIndices: Map<string, number> = new Map()
    private _generationSeed: string = ''

    // Cross-week rotation: historical food usage counts from previous weeks
    private historicalFoodCounts: Map<string, number> = new Map()
    private historicalAvgUsage: number = 0

    // Week number for scope_weeks filtering (1-based)
    private currentWeekNumber: number = 1

    // NEW: Exclusive Scope tracking
    private weeklyBannedTargets: any[] = []
    private dailyBannedTargetsMap: Map<number, any[]> = new Map()

    private log(day: number, slot: string, event: 'select' | 'reject' | 'info' | 'error', reason: string, foodName?: string) {
        this.logs.push({ day, slot, event, reason, food: foodName })
    }

    /** Check if a rule is active for the current week based on scope_weeks */
    private isRuleActiveForWeek(def: any): boolean {
        const scopeWeeks = def?.scope_weeks
        if (!scopeWeeks || scopeWeeks.mode === 'all') return true
        const wk = this.currentWeekNumber
        if (scopeWeeks.mode === 'specific') {
            return Array.isArray(scopeWeeks.weeks) && scopeWeeks.weeks.includes(wk)
        }
        if (scopeWeeks.mode === 'repeating') {
            const every = scopeWeeks.every || 2
            const start = scopeWeeks.starting_week || 1
            return ((wk - start) % every === 0) && wk >= start
        }
        return true
    }

    private preprocessAdvancedRules() {
        this.weeklyBannedTargets = []
        this.dailyBannedTargetsMap.clear()
        
        const expandedRules: PlanningRule[] = []
        
        for (const rule of this.rules) {
            if (rule.rule_type === 'or_group') {
                const def = (rule.definition as any).data || rule.definition
                if (def && Array.isArray(def.options) && def.options.length > 0) {
                    const maxIndex = def.options.length
                    const activeIndex = (this.currentWeekNumber - 1 + maxIndex) % maxIndex
                    const selectedOption = def.options[activeIndex]
                    expandedRules.push({
                        ...rule,
                        rule_type: 'frequency', // Treat as frequency
                        definition: { type: 'frequency', data: selectedOption }
                    })
                }
                continue // Skip original or_group from active engine rules
            }
            expandedRules.push(rule)
        }
        
        this.rules = expandedRules
        
        // Now process exclusive scope
        for (const rule of this.rules) {
            if (rule.rule_type === 'frequency' || rule.rule_type === 'fixed_meal') {
                const def = (rule.definition as any).data || rule.definition
                if (def.exclusive_scope === true) {
                    const isWeekActive = this.isRuleActiveForWeek(def)
                    if (!isWeekActive) {
                        // Banned for the entire week
                        if (rule.rule_type === 'frequency' && def.target) {
                            this.weeklyBannedTargets.push(def.target)
                        } else if (rule.rule_type === 'fixed_meal' && Array.isArray(def.foods)) {
                            for (const fId of def.foods) {
                                this.weeklyBannedTargets.push({ type: 'food_id', value: fId })
                            }
                        }
                    } else if (def.scope_days && Array.isArray(def.scope_days) && def.scope_days.length > 0) {
                        // Week is active, but check days
                        for (let d = 1; d <= 7; d++) {
                            if (!def.scope_days.includes(d)) {
                                if (!this.dailyBannedTargetsMap.has(d)) {
                                    this.dailyBannedTargetsMap.set(d, [])
                                }
                                const targetArr = this.dailyBannedTargetsMap.get(d)!
                                if (rule.rule_type === 'frequency' && def.target) {
                                    targetArr.push(def.target)
                                } else if (rule.rule_type === 'fixed_meal' && Array.isArray(def.foods)) {
                                    for (const fId of def.foods) {
                                        targetArr.push({ type: 'food_id', value: fId })
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        if (this.weeklyBannedTargets.length > 0) {
            this.log(0, 'GENEL', 'info', `Exclusive Scope: Banned ${this.weeklyBannedTargets.length} targets for the entire week.`)
        }
        if (this.dailyBannedTargetsMap.size > 0) {
            this.log(0, 'GENEL', 'info', `Exclusive Scope: Daily bans active for ${this.dailyBannedTargetsMap.size} day(s).`)
        }
    }

    async init() {
        const teamScope = await resolveTeamScopeContextForUser(this.userId)
        this.teamOwnerId = teamScope.teamOwnerId || null

        // Must fetch patient data first to get programTemplateId for settings/rules fallback
        await Promise.all([
            this.fetchPatientData(),
            this.fetchAllFoods()
        ])
        // Now fetch settings and rules (they depend on programTemplateId)
        await Promise.all([
            this.fetchSettings(),
            this.fetchRules(),
            this.fetchFlavorTuningConfig()
        ])

        // Initialize Exempt Tags (Defaults + User Settings)
        this.effectiveExemptTags = new Set(EXEMPT_TAGS.map(t => t.toLocaleLowerCase('tr-TR')))
        if (this.settings?.exempt_tags && Array.isArray(this.settings.exempt_tags)) {
            this.settings.exempt_tags.forEach(t => this.effectiveExemptTags.add(t.trim().toLocaleLowerCase('tr-TR')))
        }
    }

    private async fetchSettings() {
        // ── FIELD-LEVEL MERGE: global → team → program → patient ──
        // Each layer only overrides non-null fields from the layer below.
        // This mirrors the settings-dialog's merge strategy exactly.
        let mergedData: any = {}
        let teamOverrides: Record<string, number> = {}
        let programOverrides: Record<string, number> = {}
        let globalOverrides: Record<string, number> = {}

        const pickLatest = (rows: any[] | null | undefined) => (rows && rows.length > 0 ? rows[0] : null)

        // 1. Global (Base layer)
        const { data: globalRows } = await supabase
            .from('planner_settings')
            .select('*')
            .eq('scope', 'global')
            .order('updated_at', { ascending: false })
            .limit(1)
        const globalSettings = pickLatest(globalRows)

        if (globalSettings) {
            mergedData = { ...globalSettings }
            globalOverrides = globalSettings.food_score_overrides || {}
        }

        // 2. Team (Middle layer - overlay non-null fields)
        if (this.teamOwnerId) {
            const { data: teamRows } = await supabase
                .from('planner_settings')
                .select('*')
                .eq('scope', 'team')
                .eq('team_owner_id', this.teamOwnerId)
                .order('updated_at', { ascending: false })
                .limit(1)
            const teamSettings = pickLatest(teamRows)
            if (teamSettings) {
                teamOverrides = teamSettings.food_score_overrides || {}
                Object.keys(teamSettings).forEach(key => {
                    if (teamSettings[key] !== null) {
                        mergedData[key] = teamSettings[key]
                    }
                })
            }
        }

        // 3. Program (Middle layer - overlay non-null fields)
        if (this.programTemplateId) {
            let programQuery = supabase
                .from('planner_settings')
                .select('*')
                .eq('scope', 'program')
                .eq('program_template_id', this.programTemplateId)

            if (this.teamOwnerId) {
                programQuery = programQuery.eq('team_owner_id', this.teamOwnerId)
            } else {
                programQuery = programQuery.is('team_owner_id', null)
            }

            const { data: programRows } = await programQuery
                .order('updated_at', { ascending: false })
                .limit(1)
            const programSettings = pickLatest(programRows)

            if (programSettings) {
                programOverrides = programSettings.food_score_overrides || {}
                Object.keys(programSettings).forEach(key => {
                    if (programSettings[key] !== null) {
                        mergedData[key] = programSettings[key]
                    }
                })
            }
        }

        // 4. Patient (Top layer - overlay non-null fields)
        if (this.patientId) {
            let patientQuery = supabase
                .from('planner_settings')
                .select('*')
                .eq('scope', 'patient')
                .eq('patient_id', this.patientId)

            if (this.teamOwnerId) {
                patientQuery = patientQuery.eq('team_owner_id', this.teamOwnerId)
            } else {
                patientQuery = patientQuery.is('team_owner_id', null)
            }

            const { data: patientRows } = await patientQuery
                .order('updated_at', { ascending: false })
                .limit(1)
            const patientSettings = pickLatest(patientRows)

            if (patientSettings) {
                Object.keys(patientSettings).forEach(key => {
                    if (patientSettings[key] !== null) {
                        mergedData[key] = patientSettings[key]
                    }
                })
            }
        }

        if (Object.keys(mergedData).length > 0) {
            this.settings = mergedData as PlannerSettings
            // Merge food_score_overrides: global → team → program → patient (patient wins)
            const patientFSO = this.settings.food_score_overrides || {}
            this.settings.food_score_overrides = {
                ...globalOverrides,
                ...teamOverrides,
                ...programOverrides,
                ...patientFSO
            }
        }
    }

    private parseFlavorNumber(
        value: any,
        fallback: number,
        min: number,
        max: number
    ): number {
        const parsed = typeof value === 'number' ? value : Number(value ?? Number.NaN)
        if (!Number.isFinite(parsed)) return fallback
        return Math.min(max, Math.max(min, parsed))
    }

    private parseFlavorBoolean(value: any, fallback: boolean): boolean {
        if (typeof value === 'boolean') return value
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase()
            if (v === 'true') return true
            if (v === 'false') return false
        }
        return fallback
    }

    private async fetchFlavorTuningConfig() {
        try {
            let raw: any = null

            if (this.patientId) {
                const patientKey = `flavor_tuning_settings__patient_${this.patientId}`
                const { data: patientData } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('key', patientKey)
                    .maybeSingle()
                if (patientData?.value && typeof patientData.value === 'object') {
                    raw = patientData.value
                }
            }

            if (!raw && this.teamOwnerId) {
                const teamKey = `flavor_tuning_settings__team_${this.teamOwnerId}`
                const { data: teamData } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('key', teamKey)
                    .maybeSingle()
                if (teamData?.value && typeof teamData.value === 'object') {
                    raw = teamData.value
                }
            }

            if (!raw) {
                const { data } = await supabase
                    .from('app_settings')
                    .select('value')
                    .eq('key', 'flavor_tuning_settings')
                    .maybeSingle()
                if (data?.value && typeof data.value === 'object') {
                    raw = data.value
                }
            }

            if (!raw) {
                this.flavorTuningConfig = { ...DEFAULT_FLAVOR_TUNING_CONFIG }
                return
            }

            this.flavorTuningConfig = {
                enabled: this.parseFlavorBoolean(raw.enabled, DEFAULT_FLAVOR_TUNING_CONFIG.enabled),
                allow_post_edit: this.parseFlavorBoolean(raw.allow_post_edit, DEFAULT_FLAVOR_TUNING_CONFIG.allow_post_edit),
                respect_scope_filters: this.parseFlavorBoolean(raw.respect_scope_filters, DEFAULT_FLAVOR_TUNING_CONFIG.respect_scope_filters),
                respect_frequency_rules: this.parseFlavorBoolean(raw.respect_frequency_rules, DEFAULT_FLAVOR_TUNING_CONFIG.respect_frequency_rules),
                use_pattern_insights: this.parseFlavorBoolean(raw.use_pattern_insights, DEFAULT_FLAVOR_TUNING_CONFIG.use_pattern_insights),
                strict_locked_items: this.parseFlavorBoolean(raw.strict_locked_items, DEFAULT_FLAVOR_TUNING_CONFIG.strict_locked_items),
                suggestion_count: Math.round(this.parseFlavorNumber(raw.suggestion_count, DEFAULT_FLAVOR_TUNING_CONFIG.suggestion_count, 1, 6)),
                macro_weight: this.parseFlavorNumber(raw.macro_weight, DEFAULT_FLAVOR_TUNING_CONFIG.macro_weight, 0, 1),
                flavor_weight: this.parseFlavorNumber(raw.flavor_weight, DEFAULT_FLAVOR_TUNING_CONFIG.flavor_weight, 0, 1),
                diversity_weight: this.parseFlavorNumber(raw.diversity_weight, DEFAULT_FLAVOR_TUNING_CONFIG.diversity_weight, 0, 1),
                compatibility_weight: this.parseFlavorNumber(raw.compatibility_weight, DEFAULT_FLAVOR_TUNING_CONFIG.compatibility_weight, 0, 1),
                pattern_weight: this.parseFlavorNumber(raw.pattern_weight, DEFAULT_FLAVOR_TUNING_CONFIG.pattern_weight, 0, 1),
                pattern_min_confidence: this.parseFlavorNumber(raw.pattern_min_confidence, DEFAULT_FLAVOR_TUNING_CONFIG.pattern_min_confidence, 0, 1),
                pattern_min_lift: this.parseFlavorNumber(raw.pattern_min_lift, DEFAULT_FLAVOR_TUNING_CONFIG.pattern_min_lift, 0.1, 10),
                pattern_min_support: Math.round(this.parseFlavorNumber(raw.pattern_min_support, DEFAULT_FLAVOR_TUNING_CONFIG.pattern_min_support, 1, 999))
            }
        } catch {
            this.flavorTuningConfig = { ...DEFAULT_FLAVOR_TUNING_CONFIG }
        }
    }


    private async fetchRules() {
        // Fetch all rules from all scopes with strict team isolation for scoped rows.
        const orParts: string[] = ['scope.is.null', 'scope.eq.global']

        if (this.teamOwnerId) {
            orParts.push(`and(scope.eq.team,team_owner_id.eq.${this.teamOwnerId})`)
        }

        if (this.programTemplateId) {
            if (this.teamOwnerId) {
                orParts.push(`and(scope.eq.program,program_template_id.eq.${this.programTemplateId},team_owner_id.eq.${this.teamOwnerId})`)
            } else {
                orParts.push(`and(scope.eq.program,program_template_id.eq.${this.programTemplateId},team_owner_id.is.null)`)
            }
        }

        if (this.patientId) {
            if (this.teamOwnerId) {
                orParts.push(`and(scope.eq.patient,patient_id.eq.${this.patientId},team_owner_id.eq.${this.teamOwnerId})`)
            } else {
                orParts.push(`and(scope.eq.patient,patient_id.eq.${this.patientId},team_owner_id.is.null)`)
            }
        }

        const { data } = await supabase
            .from('planning_rules')
            .select('*')
            .or(orParts.join(','))
            .order('priority', { ascending: false })

        const allRules = (data as unknown as PlanningRule[]) || []

        const patientRules = allRules.filter(r => r.scope === 'patient')
        const programRules = allRules.filter(r => r.scope === 'program')
        const teamRules = allRules.filter(r => r.scope === 'team')
        const globalRules = allRules.filter(r => !r.scope || r.scope === 'global')
        // Sentinel detection: if patient has a '__use_global__' sentinel marker,
        // skip program/team inheritance and use global rules directly.
        const hasGlobalSentinel = patientRules.some(r => r.name === '__use_global__')

        const activePatientRules = patientRules.filter(r => r.is_active && r.name !== '__use_global__')
        const activeProgramRules = programRules.filter(r => r.is_active)
        const activeTeamRules = teamRules.filter(r => r.is_active)
        const activeGlobalRules = globalRules.filter(r => r.is_active)

        const inheritConsistencyRules = (
            baseRules: PlanningRule[],
            fallbackRules: PlanningRule[]
        ): PlanningRule[] => {
            const merged = [...baseRules]
            const existingKeys = new Set<string>()
            for (const rule of baseRules) {
                const key = this.getConsistencyRuleKey(rule)
                if (key) existingKeys.add(key)
            }

            for (const rule of fallbackRules) {
                const key = this.getConsistencyRuleKey(rule)
                if (!key) continue
                if (existingKeys.has(key)) continue
                existingKeys.add(key)
                merged.push(rule)
            }
            return merged
        }

        let effectiveRules: PlanningRule[]
        if (hasGlobalSentinel) {
            // Sentinel forces global rules, skipping program/team
            effectiveRules = activeGlobalRules
            console.log(`[Engine] Using GLOBAL rules via sentinel (${effectiveRules.length} active / ${globalRules.length} total)`)
        } else if (patientRules.length > 0) {
            effectiveRules = inheritConsistencyRules(
                activePatientRules,
                [...activeProgramRules, ...activeTeamRules, ...activeGlobalRules]
            )
            const inheritedCount = Math.max(0, effectiveRules.length - activePatientRules.length)
            console.log(`[Engine] Using PATIENT rules (${activePatientRules.length} active / ${patientRules.length} total, +${inheritedCount} inherited consistency)`)
        } else if (programRules.length > 0) {
            effectiveRules = inheritConsistencyRules(activeProgramRules, [...activeTeamRules, ...activeGlobalRules])
            const inheritedCount = Math.max(0, effectiveRules.length - activeProgramRules.length)
            console.log(`[Engine] Using PROGRAM rules (${activeProgramRules.length} active / ${programRules.length} total, +${inheritedCount} inherited consistency)`)
        } else if (teamRules.length > 0) {
            effectiveRules = inheritConsistencyRules(activeTeamRules, activeGlobalRules)
            const inheritedCount = Math.max(0, effectiveRules.length - activeTeamRules.length)
            console.log(`[Engine] Using TEAM rules (${activeTeamRules.length} active / ${teamRules.length} total, +${inheritedCount} inherited consistency)`)
        } else {
            effectiveRules = activeGlobalRules
            console.log(`[Engine] Using GLOBAL rules (${effectiveRules.length} active / ${globalRules.length} total)`)
        }

        // Sort by priority
        effectiveRules.sort((a, b) => b.priority - a.priority)

        this.rules = effectiveRules
    }

    private getConsistencyRuleKey(rule: PlanningRule): string | null {
        if (!rule || rule.rule_type !== 'consistency') return null

        const rawDef = rule.definition as any
        const def = rawDef?.data || rawDef || {}
        const target = def?.target
        if (!target?.type || !target?.value) return null

        const targetType = String(target.type)
        const targetValue = normalizeCategory(String(target.value))
        const lockDuration = String(def.lock_duration || 'weekly')

        const scopeMeals = Array.isArray(def.scope_meals)
            ? def.scope_meals.map((m: string) => normalizeSlotName(String(m))).sort().join('|')
            : '*'
        const scopeDays = Array.isArray(def.scope_days)
            ? [...def.scope_days].map((d: any) => Number(d)).filter((d: number) => Number.isFinite(d)).sort((a: number, b: number) => a - b).join('|')
            : '*'

        return `${targetType}:${targetValue}:m=${scopeMeals}:d=${scopeDays}:dur=${lockDuration}`
    }

    private async fetchAllFoods() {
        const { data } = await supabase.from('foods').select('*')
        const baseFoods = data || []
        let scopedFoods = baseFoods

        try {
            scopedFoods = await applyTeamFoodOverrides(baseFoods, this.teamOwnerId)
        } catch (error: any) {
            console.warn("[Planner] team food override resolve failed, using global foods:", error?.message || error)
            scopedFoods = baseFoods
        }

        try {
            this.allFoods = await applyTeamFoodMicronutrientOverrides(scopedFoods, this.teamOwnerId)
        } catch (error: any) {
            console.warn("[Planner] team micronutrient override resolve failed, using scoped foods:", error?.message || error)
            this.allFoods = scopedFoods
        }
    }

    private async fetchPatientData() {
        if (!this.patientId) return

        try {
            const [
                { data: patient },
                { data: diseasesData },
                { data: labsData },
                { data: patientMedsData }
            ] = await Promise.all([
                supabase.from('patients').select('disliked_foods, liked_foods, program_template_id').eq('id', this.patientId).single(),
                supabase.from('patient_diseases').select(`disease:diseases (id, name, disease_rules (id, rule_type, keywords, match_name, match_tags, keyword_metadata))`).eq('patient_id', this.patientId),
                supabase.from('patient_lab_results').select('*, micronutrients(id, name, unit, default_min, default_max, category, compatible_keywords, incompatible_keywords)').eq('patient_id', this.patientId).order('measured_at', { ascending: false }),
                supabase.from('patient_medications').select('medication_id').eq('patient_id', this.patientId).is('ended_at', null)
            ])

            if (patient) {
                this.patientDislikedFoods = patient.disliked_foods || []
                this.patientLikedFoods = patient.liked_foods || []
                // Set program template ID for settings/rules fallback
                if (patient.program_template_id) {
                    this.programTemplateId = patient.program_template_id
                }
            }

            if (diseasesData) {
                this.patientDiseases = diseasesData.map((d: any) => d.disease).filter(Boolean)
            }

            if (labsData) {
                const latestLabs: Record<string, any> = {}
                labsData.forEach((lab: any) => {
                    if (!latestLabs[lab.micronutrient_id]) latestLabs[lab.micronutrient_id] = lab
                })
                this.patientLabs = Object.values(latestLabs)
            }

            if (patientMedsData && patientMedsData.length > 0) {
                const medIds = patientMedsData.map((pm: any) => pm.medication_id).filter(Boolean)
                if (medIds.length > 0) {
                    const { data: rules } = await supabase
                        .from('medication_interactions')
                        .select('*, medications(name)')
                        .in('medication_id', medIds)

                    if (rules) {
                        this.patientMedications = rules.map((rule: any) => ({
                            ...rule,
                            medication_name: rule.medications?.name
                        }))
                    }
                }
            }
        } catch (e) {
            console.error("Error fetching patient data for planner:", e)
        }
    }

    private async fetchPersistentFoodUsageCounts(): Promise<Map<string, number>> {
        const counts = new Map<string, number>()
        if (!this.patientId) return counts

        try {
            const { data, error } = await supabase
                .from('patient_food_usage')
                .select('food_id, usage_count')
                .eq('patient_id', this.patientId)

            if (error) {
                // Migration may not exist yet; fail soft.
                return counts
            }

            for (const row of data || []) {
                const foodId = row?.food_id
                const rawCount = row?.usage_count
                const usageCount = typeof rawCount === 'number' ? rawCount : Number(rawCount ?? 0)
                if (foodId && Number.isFinite(usageCount) && usageCount > 0) {
                    counts.set(foodId, Math.floor(usageCount))
                }
            }
        } catch {
            // Keep planner operational if table is not available.
            return counts
        }

        return counts
    }

    private prepareEligibleFoods(weekDietType?: any, bannedTags?: string[]) {
        // Build activeDietRules from the weekDietType for bannedKeywords/bannedTags filtering
        if (weekDietType && typeof weekDietType === 'object') {
            this.activeDietRules = {
                allowedTags: weekDietType.allowed_tags || [],
                bannedKeywords: weekDietType.banned_keywords || [],
                bannedTags: weekDietType.banned_tags || [],
                bannedDetails: weekDietType.banned_details || {},
                dietName: weekDietType.name || ''
            }
        } else {
            this.activeDietRules = undefined
        }

        // Filter foods by diet type and banned tags
        let eligibleFoods = this.allFoods
        if (weekDietType) {
            // Handle both string (legacy) and Object (new) formats
            if (typeof weekDietType === 'string') {
                // Legacy fallback
                eligibleFoods = eligibleFoods.filter(f => {
                    if (weekDietType === 'ketojenik' && !f.keto) return false
                    if (weekDietType === 'lowcarb' && (!f.lowcarb && !f.keto)) return false
                    if (weekDietType === 'vegan' && !f.vegan) return false
                    if (weekDietType === 'vejeteryan' && !f.vejeteryan) return false
                    return true
                })
            } else if (typeof weekDietType === 'object' && weekDietType.allowed_tags && weekDietType.allowed_tags.length > 0) {
                // New Object-based logic: Union of Allowed Tags
                // If a food matches ANY of the allowed tags, it is included.
                // This handles cases like "Low Carb" diet allowing both "LOW_CARB" and "KETOGENIC" tagged foods.
                const tagsToCheck = weekDietType.allowed_tags

                eligibleFoods = eligibleFoods.filter(f => {
                    return tagsToCheck.some((tag: string) => {
                        const validator = TAG_MAPPING[tag]
                        if (validator) return validator(f)
                        // If no validator found, check tags array directly (fallback)
                        if (f.tags && Array.isArray(f.tags)) {
                            if (f.tags.some((t: string) => t.toUpperCase() === tag)) return true
                        }
                        // Also check meta.dietTypes for dynamically added diet types
                        if (f.meta?.dietTypes && Array.isArray(f.meta.dietTypes)) {
                            if (f.meta.dietTypes.some((dt: string) =>
                                dt.toLocaleLowerCase('tr-TR') === tag.toLocaleLowerCase('tr-TR')
                            )) return true
                        }
                        return false // Tag not found and no validator - matches nothing
                    })
                })
            }
        }

        // Exclude banned tags
        if (bannedTags && bannedTags.length > 0) {
            eligibleFoods = eligibleFoods.filter(f => !this.hasTagConflict(f, new Set(bannedTags)))
        }

        // --- NEW: Apply Patient Registration Data Compatibility (Diseases, Labs, Medications, Dislikes) ---
        eligibleFoods = eligibleFoods.filter(f => {
            // Check implicit "Sevilmeyen Besinler" (Requires partial name match)
            if (this.patientDislikedFoods && this.patientDislikedFoods.length > 0) {
                const foodNameLower = (f.name || '').toLocaleLowerCase('tr-TR')
                const isDisliked = this.patientDislikedFoods.some(dislike => {
                    const dLower = dislike.trim().toLocaleLowerCase('tr-TR')
                    if (!dLower) return false
                    return foodNameLower.includes(dLower) || f.tags?.some((t: string) => t.toLocaleLowerCase('tr-TR').includes(dLower))
                })

                if (isDisliked) return false // Filter out completely
            }

            // Check formal medical compatibility + diet type banned keywords/tags
            const compat = checkCompatibility(
                f,
                this.activeDietRules,
                this.patientDiseases,
                this.patientLabs,
                this.patientMedications
            )

            return compat.compatible !== false // Allow if true or undefined
        })
        // --------------------------------------------------------------------------------------------------

        // -- NEW: Exclusive Scope Weekly Banned Targets --
        if (this.weeklyBannedTargets && this.weeklyBannedTargets.length > 0) {
            eligibleFoods = eligibleFoods.filter(f => {
                for (const target of this.weeklyBannedTargets) {
                    if (this.matchesTarget(f, target)) return false // Exclude!
                }
                return true
            })
        }

        this.eligibleFoods = eligibleFoods
    }

    /**
     * Find a single food to fill a calorie deficit for a specific slot,
     * respecting all patient rules, diet types, and frequency limits.
     */
    async generateDayTopUp(
        targetDeficit: number,
        slotName: string,
        currentSlotItems: any[],
        weekDietType: any,
        bannedTags: string[],
        existingWeekFoods: any[] // array of all foods consumed in the week so far
    ): Promise<any> {
        await this.init()
        this.prepareEligibleFoods(weekDietType, bannedTags)

        // Populate frequency trackers
        this.currentWeekFoods = existingWeekFoods
        const weeklySelectedIds = new Map<string, number>()
        for (const f of existingWeekFoods) {
            if (f && f.id) {
                weeklySelectedIds.set(f.id, (weeklySelectedIds.get(f.id) || 0) + 1)
            }
        }

        const dailyContext = {
            dayIndex: 0,
            currentDate: new Date(),
            dailySelectedIds: new Set<string>(currentSlotItems.map(it => it.food?.id || it.id).filter(Boolean)),
            dailyTags: new Set<string>(),
            dailyMacros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
            dailyTarget: null,
            weeklySelectedIds,
            selectedFoods: currentSlotItems.map(it => it.food || it).filter(Boolean),
            weekDietType
        }

        const normalizedTopUpSlotName = normalizeSlotName(slotName)
        const baseRoles = normalizedTopUpSlotName === 'ARA ÖĞÜN'
            ? ['snack', 'nuts', 'fruit', 'drink']
            : ['sideDish', 'salad', 'soup', 'drink', 'dessert', 'snack', 'nuts', 'meze', 'appetizer']

        // Sort roles by underuse: least-used roles first for variety
        const roleCounts = new Map<string, number>()
        for (const wf of this.currentWeekFoods) {
            const r = this.getCanonicalLockRole((wf as any).role || '')
            if (r) roleCounts.set(r, (roleCounts.get(r) || 0) + 1)
        }
        const topUpRoles = [...baseRoles].sort((a, b) => (roleCounts.get(a) || 0) - (roleCounts.get(b) || 0))

        // Collect candidates from ALL roles and pick the one from least-used role
        const allCandidates: { food: any, roleUsage: number }[] = []

        for (const role of topUpRoles) {
            // Prevent duplicate unique roles in the same slot
            const canonicalRole = this.getCanonicalLockRole(role || '')
            const isUniqueRole = ['soup', 'salad', 'maindish', 'breakfast_main'].includes(canonicalRole)
            if (isUniqueRole) {
                const hasRoleAlready = currentSlotItems.some((it: any) => {
                    const f = it.food || it;
                    const existingRole = this.getCanonicalLockRole(f?.role || '')
                    return existingRole === canonicalRole
                })
                if (hasRoleAlready) continue
            }

            // Build correct slotTags from current items to prevent tag conflicts
            const currentTags = new Set<string>()
            for (const it of currentSlotItems) {
                const f = it.food || it
                if (f) this.addFoodTags(currentTags, f)
            }

            const extraFood = await this.selectBestFoodByRole(
                slotName,
                role,
                dailyContext,
                new Set(currentSlotItems.map((it: any) => it.food?.id || it.id).filter(Boolean)),
                currentTags,
                null,
                targetDeficit,
                false
            )

            if (extraFood) {
                const roleUsage = roleCounts.get(canonicalRole) || 0
                allCandidates.push({ food: extraFood, roleUsage })
            }
        }

        if (allCandidates.length === 0) return null
        // Pick candidate from least-used role for maximum variety
        allCandidates.sort((a, b) => a.roleUsage - b.roleUsage)
        return allCandidates[0].food
    }

    /**
     * Generate a full weekly plan based on:
     * 1. Patient rules (allergies, dislikes)
     * 2. Diet type rules
     * 3. Configured preferences (meal counts, etc.)
     * 
     * @param startDate - Start date of the week
     * @param mealTypes - Slots to generate (e.g. ['KAHVALTI', 'ÖĞLEN', 'AKŞAM'])
     * @param slotConfigs - User overrides for slot settings (min/max items)
     * @param targetMacros - Daily calorie/macro goals
     * @param weekDietType - Diet type to enforce
     * @param bannedTags - Tags to exclude from selection (from program)
     */
    async generateWeeklyPlan(
        startDate: Date = new Date(),
        mealTypes: string[] = ['KAHVALTI', 'ÖĞLEN', 'AKŞAM', 'ARA ÖĞÜN'],
        slotConfigs?: any[], // Custom config array from page
        targetMacros?: TargetMacros,
        weekDietType?: string | any,
        bannedTags?: string[],
        historicalFoodCounts?: Map<string, number>, // Cross-week rotation: food usage from previous weeks
        weekNumber?: number // 1-based week tab number for scope_weeks filtering
    ): Promise<any> {
        this.today = startDate
        this.currentWeekNumber = weekNumber || 1
        this._generationSeed = Date.now().toString(36) + Math.random().toString(36).substring(2)
        await this.init()

        // ── PRE-PROCESS ADVANCED RULES (EXCLUSIVE SCOPE + OR GROUP) ──
        this.preprocessAdvancedRules()

        // Clear weekly locks at start of generation
        this.weeklyLocks.clear()
        this.weeklyLockReasons.clear()

        // Clear random days cache for fresh randomization each generation
        this.randomDaysCache.clear()
        this.rotationIndices.clear()
        this.logs = [] // Clear logs
        this.currentWeekFoods = [] // Clear weekly foods

        // Store cross-week historical food counts.
        // Priority: caller-provided map (legacy behavior) > persisted usage table > empty
        const persistedUsageCounts = await this.fetchPersistentFoodUsageCounts()
        const effectiveHistoricalCounts =
            (historicalFoodCounts && historicalFoodCounts.size > 0)
                ? historicalFoodCounts
                : persistedUsageCounts

        if (effectiveHistoricalCounts.size > 0) {
            this.historicalFoodCounts = effectiveHistoricalCounts
            const totalUsage = Array.from(effectiveHistoricalCounts.values()).reduce((sum, c) => sum + c, 0)
            this.historicalAvgUsage = totalUsage / effectiveHistoricalCounts.size
        } else {
            this.historicalFoodCounts = new Map()
            this.historicalAvgUsage = 0
        }

        // Prepare effective configuration
        // Priority: Page Payload > DB Settings > Default
        // Normalize slot names to avoid key mismatches like "ÖĞLEN" vs mojibake variants.
        let effectiveSlotConfig: Record<string, SlotConfig> = {}
        Object.entries(DEFAULT_SLOT_CONFIG).forEach(([rawSlotName, conf]) => {
            const normalizedSlotName = normalizeSlotName(rawSlotName)
            effectiveSlotConfig[normalizedSlotName] = {
                minItems: conf.minItems,
                maxItems: conf.maxItems,
                requiredRoles: Array.isArray(conf.requiredRoles) ? [...conf.requiredRoles] : [],
                optionalRoles: Array.isArray(conf.optionalRoles) ? [...conf.optionalRoles] : [],
                bannedRoles: Array.isArray(conf.bannedRoles) ? [...conf.bannedRoles] : [],
                bannedTags: Array.isArray(conf.bannedTags) ? [...conf.bannedTags] : []
            }
        })

        // 1. Merge DB Settings (if exists)
        // slot_config from planner_settings is stored as ARRAY: [{name, min_items, max_items}, ...]
        if (this.settings?.slot_config && Array.isArray(this.settings.slot_config)) {
            const settingsArray = this.settings.slot_config as any[]

            // Build dict from the array
            settingsArray.forEach((conf: any) => {
                const slotName = normalizeSlotName(String(conf.name || ''))
                if (slotName) {
                    if (!effectiveSlotConfig[slotName]) {
                        // New slot not in defaults (e.g. ÖZEL ÖĞÜN) - create entry
                        effectiveSlotConfig[slotName] = {
                            minItems: conf.min_items ?? 2,
                            maxItems: conf.max_items ?? 4,
                            requiredRoles: conf.requiredRoles || [],
                            // Never auto-include mainDish as optional; this can create duplicates in one slot.
                            optionalRoles: ['sideDish', 'soup', 'salad', 'bread'],
                            bannedRoles: conf.bannedRoles || [],
                            bannedTags: conf.bannedTags || []
                        }
                    } else {
                        effectiveSlotConfig[slotName].minItems = conf.min_items ?? effectiveSlotConfig[slotName].minItems
                        effectiveSlotConfig[slotName].maxItems = conf.max_items ?? effectiveSlotConfig[slotName].maxItems
                        if (conf.requiredRoles) effectiveSlotConfig[slotName].requiredRoles = conf.requiredRoles
                        if (conf.bannedRoles) effectiveSlotConfig[slotName].bannedRoles = conf.bannedRoles
                        if (conf.bannedTags) effectiveSlotConfig[slotName].bannedTags = conf.bannedTags
                    }
                }
            })

            // CRITICAL: Override mealTypes from settings if the page sent defaults
            // The settings slot_config defines WHICH meals should exist
            const settingsMealTypes = settingsArray
                .map((c: any) => normalizeSlotName(String(c.name || '')))
                .filter(Boolean)
            if (settingsMealTypes.length > 0) {
                mealTypes = settingsMealTypes
            }
        } else if (this.settings?.slot_config && typeof this.settings.slot_config === 'object') {
            // Legacy dict format fallback
            const legacySlotConfig: Record<string, any> = this.settings.slot_config as Record<string, any>
            Object.keys(legacySlotConfig).forEach(slotName => {
                if (legacySlotConfig[slotName]) {
                    const normalizedSlotName = normalizeSlotName(String(slotName || ''))
                    const existingConfig = effectiveSlotConfig[normalizedSlotName] || {
                        minItems: 2,
                        maxItems: 4,
                        requiredRoles: [],
                        optionalRoles: ['sideDish', 'soup', 'salad', 'bread']
                    }
                    effectiveSlotConfig[normalizedSlotName] = {
                        ...existingConfig,
                        ...legacySlotConfig[slotName]
                    }
                }
            })
        }

        // 2. Merge Page Payload - ONLY if no DB settings were found
        // DB settings (patient > program > global) are authoritative when present
        if (slotConfigs && !(this.settings?.slot_config)) {
            slotConfigs.forEach((conf: any) => {
                const slotName = normalizeSlotName(String(conf.name || ''))
                if (slotName) {
                    if (!effectiveSlotConfig[slotName]) {
                        effectiveSlotConfig[slotName] = {
                            minItems: conf.min_items ?? 2,
                            maxItems: conf.max_items ?? 4,
                            requiredRoles: [],
                            optionalRoles: ['sideDish', 'soup', 'salad', 'bread']
                        }
                    } else {
                        effectiveSlotConfig[slotName].minItems = conf.min_items ?? effectiveSlotConfig[slotName].minItems
                        effectiveSlotConfig[slotName].maxItems = conf.max_items ?? effectiveSlotConfig[slotName].maxItems
                    }
                }
            })
            // Also override mealTypes from page payload if no DB settings
            const pageMealTypes = slotConfigs
                .map((c: any) => normalizeSlotName(String(c.name || '')))
                .filter(Boolean)
            if (pageMealTypes.length > 0) {
                mealTypes = pageMealTypes
            }
        }

        // Normalize incoming mealTypes once to keep downstream lookups stable.
        mealTypes = mealTypes
            .map((slot: string) => normalizeSlotName(String(slot || '')))
            .filter(Boolean)

        this.prepareEligibleFoods(weekDietType, bannedTags)

        // ── ROTATION RULES: Initialize generators ──
        await this.initRotationGenerators()

        // Initialize plan object structure
        const plan: any = {
            dates: [],
            meals: [],
            targetMacros,
            logs: this.logs,
            weeklySelectedIds: new Map<string, number>(),
            settings: this.settings
        }

        const dayCount = 7

        // Helper to get daily total
        const getDailyMacros = (daySlots: any) => {
            let total = { calories: 0, protein: 0, carbs: 0, fat: 0 }
            Object.values(daySlots).forEach((items: any) => {
                items.forEach((item: any) => {
                    total.calories += item.food.calories || 0
                    total.protein += item.food.protein || 0
                    total.carbs += item.food.carbs || 0
                    total.fat += item.food.fat || 0
                })
            })
            return total
        }

        // ── CROSS-DAY MACRO COMPENSATION ──
        // Tracks cumulative protein/fat/carbs/calories surplus/deficit across days.
        // Spread across remaining days so weekly average converges to target.
        const macroDebt = { protein: 0, fat: 0, carbs: 0, calories: 0 }

        // Tracks foods from previous days to prevent consecutive repetition
        let yesterdaySelectedIds = new Set<string>()
        let twoDaysAgoSelectedIds = new Set<string>()

        for (let i = 0; i < dayCount; i++) {
            const currentDate = new Date(startDate)
            currentDate.setDate(startDate.getDate() + i)
            const dayName = currentDate.toLocaleDateString('tr-TR', { weekday: 'long' })

            // Generate slots for the day
            const slots: Record<string, any[]> = {}
            const dailyContext = {
                dayIndex: i,
                currentDate,
                dailySelectedIds: new Set<string>(), // Track foods selected THIS DAY to prevent repetition
                yesterdaySelectedIds,
                twoDaysAgoSelectedIds,
                dailyTags: new Set<string>(),
                dailyMacros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
                dailyTarget: targetMacros,
                weeklySelectedIds: plan.weeklySelectedIds,
                selectedFoods: [] as any[],
                weekDietType // Explicitly passing diet type to context
            }

            // ── Compute compensated daily macro targets (cross-day debt spread) ──
            const remainingDays = dayCount - i
            const compensatedDailyMacros = targetMacros ? {
                calories: Math.max(targetMacros.calories * 0.8, targetMacros.calories + (macroDebt.calories / remainingDays)),
                protein: Math.max(0, targetMacros.protein + (macroDebt.protein / remainingDays)),
                fat: Math.max(0, targetMacros.fat + (macroDebt.fat / remainingDays)),
                carbs: Math.max(0, targetMacros.carbs + (macroDebt.carbs / remainingDays)),
            } : null

            if (compensatedDailyMacros && i > 0 && (Math.abs(macroDebt.protein) > 1 || Math.abs(macroDebt.fat) > 1)) {
                this.log(i + 1, 'CROSS-DAY', 'info',
                    `Compensated targets: P=${compensatedDailyMacros.protein.toFixed(1)}g (base ${targetMacros!.protein}g), ` +
                    `F=${compensatedDailyMacros.fat.toFixed(1)}g (base ${targetMacros!.fat}g), ` +
                    `C=${compensatedDailyMacros.carbs.toFixed(1)}g (base ${targetMacros!.carbs}g)`)
            }

            // Use compensated macros for slot distribution
            const effectiveDailyMacros = compensatedDailyMacros || targetMacros

            for (const slotName of mealTypes) {
                // Determine slot budget and macro targets/distribution
                let slotBudget = 0
                const slotTargetMacros = { protein: 0, carbs: 0, fat: 0 }

                if (effectiveDailyMacros) {
                    const normalizedSlotNameForBudget = normalizeSlotName(slotName)
                    if (normalizedSlotNameForBudget === 'ARA ÖĞÜN') {
                        slotBudget = effectiveDailyMacros.calories * 0.15
                        slotTargetMacros.protein = effectiveDailyMacros.protein * 0.15
                        slotTargetMacros.carbs = effectiveDailyMacros.carbs * 0.15
                        slotTargetMacros.fat = effectiveDailyMacros.fat * 0.15
                    } else {
                        // Split remaining 85% among main meals
                        const mainMealCount = mealTypes.filter(m => normalizeSlotName(m) !== 'ARA ÖĞÜN').length || 1
                        slotBudget = (effectiveDailyMacros.calories * 0.85) / mainMealCount
                        slotTargetMacros.protein = (effectiveDailyMacros.protein * 0.85) / mainMealCount
                        slotTargetMacros.carbs = (effectiveDailyMacros.carbs * 0.85) / mainMealCount
                        slotTargetMacros.fat = (effectiveDailyMacros.fat * 0.85) / mainMealCount
                    }
                }

                // Slot context with its own tracking
                const slotContext = {
                    ...dailyContext,
                    slotTags: new Set<string>(),
                    slotMacros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
                    slotTarget: slotBudget,
                    slotTargetMacros, // Added for Macro Priority Scoring
                    slotMainDish: null as any,
                    slotName,
                    dailyMacros: dailyContext.dailyMacros,  // Running cumulative for the day
                    dailyTarget: effectiveDailyMacros,       // Day-level targets
                    iterationFactor: 1,                      // Increases on re-plan iterations
                }

                const normalizedSlotName = normalizeSlotName(slotName)
                const config =
                    effectiveSlotConfig[normalizedSlotName]
                    || effectiveSlotConfig['ÖĞLEN']
                    || effectiveSlotConfig['KAHVALTI']
                    || Object.values(effectiveSlotConfig)[0]

                // Select foods
                const selectedFoods = await this.selectFoodsForSlot(
                    slotName,
                    slotContext,
                    slotBudget,
                    config
                )

                slots[slotName] = selectedFoods.map(f => ({
                    slot: slotName,
                    food: f
                }))

                // Update tracking/logs
                for (const food of selectedFoods) {
                    plan.meals.push({
                        day: i + 1,
                        dayName,
                        slot: slotName,
                        food: { ...food, name: this.capitalize(food.name) },
                        source: food.source
                    })

                    // Update tracking
                    dailyContext.selectedFoods.push(food)
                    dailyContext.dailySelectedIds.add(food.id)
                    this.currentWeekFoods.push(food)
                    dailyContext.dailyMacros.calories += food.calories || 0
                    dailyContext.dailyMacros.protein += food.protein || 0
                    dailyContext.dailyMacros.carbs += food.carbs || 0
                    dailyContext.dailyMacros.fat += food.fat || 0

                    if (food.tags && Array.isArray(food.tags)) {
                        food.tags.forEach((tag: string) => dailyContext.dailyTags.add(tag))
                    }

                    dailyContext.weeklySelectedIds.set(
                        food.id,
                        (dailyContext.weeklySelectedIds.get(food.id) || 0) + 1
                    )
                }
            }

            // --- ENHANCED TOP-UP LOGIC ---
            // Now iterates all slots (including ARA ÖĞÜN) and adds multiple items per slot
            if (targetMacros) {
                let dailyTotal = getDailyMacros(slots)
                if (dailyTotal.calories < targetMacros.calories * 0.90) {
                    this.log(i + 1, 'DAILY', 'info', `Daily calories (${Math.round(dailyTotal.calories)}) below target (${targetMacros.calories}). Attempting enhanced top-up.`)

                    // All available slots ordered by priority for top-up
                    const topUpSlots = mealTypes.filter(s => slots[s] && s !== 'KAHVALTI')

                    for (const slotName of topUpSlots) {
                        const currentItems = slots[slotName]
                        const normalizedTopUpSlot = normalizeSlotName(slotName)
                        const config =
                            effectiveSlotConfig[normalizedTopUpSlot]
                            || effectiveSlotConfig['ÖĞLEN']
                            || effectiveSlotConfig['KAHVALTI']
                            || Object.values(effectiveSlotConfig)[0]

                        // Multi-item top-up loop: keep adding until deficit <50 or maxItems reached
                        let topUpGuard = 0
                        while (currentItems.length < config.maxItems && topUpGuard < 5) {
                            topUpGuard++
                            dailyTotal = getDailyMacros(slots)
                            const deficit = targetMacros.calories - dailyTotal.calories
                            if (deficit < 50) break

                            const topUpContext = {
                                ...dailyContext,
                                dayIndex: i,
                                currentDate
                            }

                            // Try to find a food from prioritized roles
                            const topUpRoles = normalizeSlotName(slotName) === 'ARA ÖĞÜN'
                                ? ['snack', 'nuts', 'fruit', 'drink']
                                : ['maindish', 'sideDish', 'salad', 'soup', 'drink', 'dessert', 'snack', 'nuts']
                            let extraFood = null

                            for (const role of topUpRoles) {
                                // Prevent duplicate roles for specific types
                                const canonicalRole = this.getCanonicalLockRole(role || '')
                                const isUniqueRole = ['soup', 'salad', 'maindish', 'breakfast_main'].includes(canonicalRole)
                                if (isUniqueRole) {
                                    const hasRoleAlready = currentItems.some((it: any) => {
                                        const existingRole = this.getCanonicalLockRole(it.food?.role || '')
                                        return existingRole === canonicalRole
                                    })
                                    if (hasRoleAlready) continue
                                }

                                // Build correct slotTags to prevent tag conflicts during top-up
                                const currentTags = new Set<string>()
                                for (const it of currentItems) {
                                    if (it.food) this.addFoodTags(currentTags, it.food)
                                }

                                extraFood = await this.selectBestFoodByRole(
                                    slotName,
                                    role,
                                    topUpContext,
                                    new Set(currentItems.map((it: any) => it.food.id)),
                                    currentTags,
                                    null,
                                    deficit,
                                    false
                                )
                                if (extraFood) break
                            }

                            if (extraFood) {
                                slots[slotName].push({ slot: slotName, food: extraFood })
                                dailyContext.dailySelectedIds.add(extraFood.id)
                                this.currentWeekFoods.push(extraFood)
                                dailyContext.dailyMacros.calories += extraFood.calories || 0
                                dailyContext.dailyMacros.protein += extraFood.protein || 0
                                dailyContext.dailyMacros.carbs += extraFood.carbs || 0
                                dailyContext.dailyMacros.fat += extraFood.fat || 0
                                dailyContext.weeklySelectedIds.set(
                                    extraFood.id,
                                    (dailyContext.weeklySelectedIds.get(extraFood.id) || 0) + 1
                                )

                                plan.meals.push({
                                    day: i + 1,
                                    dayName,
                                    slot: slotName,
                                    food: { ...extraFood, name: this.capitalize(extraFood.name) },
                                    source: { type: 'top_up', rule: extraFood._compatibilityMatchedTag ? `Kalori Açığı Top-Up (Uyumlu: ${extraFood._compatibilityMatchedTag})` : 'Kalori Açığı Top-Up' }
                                })
                                this.log(i + 1, slotName, 'select', `Top-up added: ${extraFood.name} (${extraFood.calories}kcal, deficit was ${Math.round(deficit)})`)
                            } else {
                                break // No more food available for this slot
                            }
                        }

                        // Check if we've closed the deficit
                        dailyTotal = getDailyMacros(slots)
                        if (dailyTotal.calories >= targetMacros.calories * 0.90) break
                    }
                }
            }

            // ── ITERATIVE MACRO RE-PLANNING ──
            // After all slots + top-up, check if daily macros are acceptable.
            // If any macro deviates > 15%, re-plan the worst-offender slot with stricter constraints.
            const MAX_ITERATIONS = 3
            if (effectiveDailyMacros && effectiveDailyMacros.fat > 0) {
                for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
                    const currentDayMacros = getDailyMacros(slots)
                    const fatRatio = currentDayMacros.fat / (effectiveDailyMacros.fat || 1)
                    const carbsRatio = currentDayMacros.carbs / (effectiveDailyMacros.carbs || 1)
                    const proteinRatio = currentDayMacros.protein / (effectiveDailyMacros.protein || 1)
                    const calorieRatio = currentDayMacros.calories / (effectiveDailyMacros.calories || 1)

                    // Check if any macro is off by more than 15% (including calories)
                    const fatOK = fatRatio <= 1.15 && fatRatio >= 0.85
                    const carbsOK = carbsRatio <= 1.15 && carbsRatio >= 0.85
                    const proteinOK = proteinRatio >= 0.85
                    const caloriesOK = calorieRatio >= 0.85 && calorieRatio <= 1.15

                    if (fatOK && carbsOK && proteinOK && caloriesOK) {
                        if (iteration > 1) {
                            this.log(i + 1, 'ITERATION', 'info', `Converged after ${iteration - 1} iteration(s). ` +
                                `F=${(fatRatio * 100).toFixed(0)}%, C=${(carbsRatio * 100).toFixed(0)}%, P=${(proteinRatio * 100).toFixed(0)}%, Cal=${(calorieRatio * 100).toFixed(0)}%`)
                        }
                        break
                    }

                    // Find worst offender: which non-fixed slot contributes most to deviation
                    type SlotDeviation = { slotName: string, deviationScore: number }
                    const slotDeviations: SlotDeviation[] = []

                    for (const sn of mealTypes) {
                        if (!slots[sn] || slots[sn].length === 0) continue
                        const hasFixed = slots[sn].some((item: any) => item.food?.source?.type === 'fixed')
                        if (hasFixed) continue

                        let slotFat = 0, slotCarbs = 0
                        for (const item of slots[sn]) {
                            slotFat += (item.food?.fat || 0)
                            slotCarbs += (item.food?.carbs || 0)
                        }

                        let score = 0
                        if (!fatOK && fatRatio > 1.15) score += slotFat * (fatRatio - 1)
                        if (!carbsOK && carbsRatio > 1.15) score += slotCarbs * (carbsRatio - 1)
                        // Also penalize slots contributing to calorie overshoot
                        if (!caloriesOK && calorieRatio > 1.15) {
                            let slotCals = 0
                            for (const item of slots[sn]) slotCals += (item.food?.calories || 0)
                            score += slotCals * (calorieRatio - 1) * 0.5
                        }
                        slotDeviations.push({ slotName: sn, deviationScore: score })
                    }

                    slotDeviations.sort((a, b) => b.deviationScore - a.deviationScore)
                    const worstSlot = slotDeviations[0]
                    if (!worstSlot || worstSlot.deviationScore <= 0) break

                    this.log(i + 1, 'ITERATION', 'info',
                        `Iteration ${iteration}: F=${(fatRatio * 100).toFixed(0)}%, C=${(carbsRatio * 100).toFixed(0)}%, P=${(proteinRatio * 100).toFixed(0)}%, Cal=${(calorieRatio * 100).toFixed(0)}%. ` +
                        `Re-planning '${worstSlot.slotName}' (deviation=${worstSlot.deviationScore.toFixed(1)})`)

                    // Remove worst slot's foods from tracking
                    const removedFoods = slots[worstSlot.slotName] || []
                    for (const item of removedFoods) {
                        const food = item.food
                        if (!food) continue
                        dailyContext.dailyMacros.calories -= food.calories || 0
                        dailyContext.dailyMacros.protein -= food.protein || 0
                        dailyContext.dailyMacros.carbs -= food.carbs || 0
                        dailyContext.dailyMacros.fat -= food.fat || 0
                        dailyContext.dailySelectedIds.delete(food.id)
                        const selectedIdx = dailyContext.selectedFoods.findIndex((f: any) => f?.id === food.id)
                        if (selectedIdx >= 0) dailyContext.selectedFoods.splice(selectedIdx, 1)
                        const wCount = dailyContext.weeklySelectedIds.get(food.id) || 0
                        if (wCount > 1) dailyContext.weeklySelectedIds.set(food.id, wCount - 1)
                        else dailyContext.weeklySelectedIds.delete(food.id)
                        const weekIdx = this.currentWeekFoods.findIndex((f: any) => f?.id === food.id)
                        if (weekIdx >= 0) this.currentWeekFoods.splice(weekIdx, 1)
                        const mealIdx = plan.meals.findIndex((m: any) =>
                            m.day === i + 1 && m.slot === worstSlot.slotName && m.food?.id === food.id)
                        if (mealIdx >= 0) plan.meals.splice(mealIdx, 1)
                    }

                    // Re-plan with escalated macro strictness
                    const isSnack = normalizeSlotName(worstSlot.slotName) === 'ARA ÖĞÜN'
                    const slotShare = isSnack ? 0.15 : (0.85 / (mealTypes.filter(m => normalizeSlotName(m) !== 'ARA ÖĞÜN').length || 1))
                    const reSlotBudget = effectiveDailyMacros.calories * slotShare
                    const reSlotTargetMacros = {
                        protein: effectiveDailyMacros.protein * slotShare,
                        carbs: effectiveDailyMacros.carbs * slotShare,
                        fat: effectiveDailyMacros.fat * slotShare,
                    }

                    const reSlotContext = {
                        ...dailyContext,
                        slotTags: new Set<string>(),
                        slotMacros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
                        slotTarget: reSlotBudget,
                        slotTargetMacros: reSlotTargetMacros,
                        slotMainDish: null as any,
                        slotName: worstSlot.slotName,
                        dailyMacros: dailyContext.dailyMacros,
                        dailyTarget: effectiveDailyMacros,
                        iterationFactor: 1 + iteration,
                    }

                    const normalizedWorstSlot = normalizeSlotName(worstSlot.slotName)
                    const reConfig =
                        effectiveSlotConfig[normalizedWorstSlot]
                        || effectiveSlotConfig['ÖĞLEN']
                        || effectiveSlotConfig['KAHVALTI']
                        || Object.values(effectiveSlotConfig)[0]
                    const reFoods = await this.selectFoodsForSlot(worstSlot.slotName, reSlotContext, reSlotBudget, reConfig)

                    slots[worstSlot.slotName] = reFoods.map(f => ({ slot: worstSlot.slotName, food: f }))

                    for (const food of reFoods) {
                        plan.meals.push({
                            day: i + 1, dayName, slot: worstSlot.slotName,
                            food: { ...food, name: this.capitalize(food.name) },
                            source: food.source
                        })
                        dailyContext.selectedFoods.push(food)
                        dailyContext.dailySelectedIds.add(food.id)
                        this.currentWeekFoods.push(food)
                        dailyContext.dailyMacros.calories += food.calories || 0
                        dailyContext.dailyMacros.protein += food.protein || 0
                        dailyContext.dailyMacros.carbs += food.carbs || 0
                        dailyContext.dailyMacros.fat += food.fat || 0
                        dailyContext.weeklySelectedIds.set(
                            food.id,
                            (dailyContext.weeklySelectedIds.get(food.id) || 0) + 1
                        )
                    }
                }
            }


            // ── NUTRITIONAL RULES (MACRO CONDITIONS) ──
            // Process macro conditional rules (e.g., if protein < target - 10g, add Collagen to target slot)
            if (targetMacros && this.rules.length > 0) {
                const nutritionalRules = this.rules.filter(r => r.is_active && r.rule_type === 'nutritional')

                if (nutritionalRules.length > 0) {
                    // Get latest macros after all previous steps
                    const currentDayMacros = getDailyMacros(slots)

                    for (const rule of nutritionalRules) {
                        const def = (rule.definition as any).data || rule.definition
                        if (!def.condition || !def.action || !def.target_slot) continue

                        // Evaluate condition
                        const macroKey = def.condition.macro as keyof typeof currentDayMacros
                        const targetValue = targetMacros[macroKey] || 0
                        const actualValue = currentDayMacros[macroKey] || 0
                        const diff = targetValue - actualValue // Positive means deficit

                        let conditionMet = false
                        if (def.condition.operator === '<' && diff > def.condition.value) {
                            conditionMet = true // We have a deficit larger than the threshold
                        } else if (def.condition.operator === '>' && diff < -def.condition.value) {
                            conditionMet = true // We have a surplus larger than the threshold
                        }

                        if (conditionMet && def.action.type === 'add') {
                            const targetSlot = def.target_slot
                            if (!slots[targetSlot]) slots[targetSlot] = []

                            // Build candidate food ID list: multi-food rotation or single food (backward compat)
                            const candidateFoodIds: string[] =
                                (def.action.foods && def.action.foods.length > 0)
                                    ? def.action.foods
                                    : (def.action.target?.type === 'food_id' && def.action.target.value)
                                        ? [def.action.target.value]
                                        : []

                            if (candidateFoodIds.length === 0) continue

                            // Rotation: determine start index for this rule
                            const rotKey = `nutritional-${rule.id}`
                            const startIdx = this.rotationIndices.get(rotKey) || 0

                            // Collect tag words from all foods already in this slot for collision check
                            const slotTagWords = new Set<string>()
                            for (const item of slots[targetSlot]) {
                                const f = item.food
                                if (!f) continue
                                // Extract words from food name
                                const nameWords = (f.name || '').toLocaleLowerCase('tr-TR').split(/\s+/)
                                nameWords.forEach((w: string) => { if (w.length > 2) slotTagWords.add(w) })
                                // Extract words from tags
                                if (Array.isArray(f.tags)) {
                                    f.tags.forEach((t: string) => {
                                        const tagWords = (t || '').toLocaleLowerCase('tr-TR').split(/\s+/)
                                        tagWords.forEach((w: string) => { if (w.length > 2) slotTagWords.add(w) })
                                    })
                                }
                            }

                            // Try each candidate (rotate through list, skip on tag/compatibility collision)
                            let added = false
                            for (let attempt = 0; attempt < candidateFoodIds.length; attempt++) {
                                const idx = (startIdx + attempt) % candidateFoodIds.length
                                const foodId = candidateFoodIds[idx]
                                const foodToAdd = this.allFoods.find(f => f.id === foodId)
                                if (!foodToAdd) continue

                                // 1. MEAL TYPE COMPATIBILITY CHECK
                                if (!this.isMealTypeCompatibleWithSlot(foodToAdd, targetSlot)) {
                                    this.log(i + 1, targetSlot, 'info',
                                        `Nutritional Rule '${rule.name}': Skipped ${foodToAdd.name} — not compatible with this meal type`)
                                    continue
                                }

                                // 2. FORBIDDEN AFFINITY CHECK
                                const slotFoodsArray = slots[targetSlot].map((m: any) => m.food).filter(Boolean)
                                if (this.hasForbiddenAffinityConflict(foodToAdd, slotFoodsArray)) {
                                    this.log(i + 1, targetSlot, 'info',
                                        `Nutritional Rule '${rule.name}': Skipped ${foodToAdd.name} — forbidden affinity conflict`)
                                    continue
                                }

                                // 3. WEEKLY CAP & EXCLUSION CHECK
                                const weeklyCount = dailyContext.weeklySelectedIds.get(foodId) || 0
                                if (this.hasReachedWeeklyCap(foodToAdd, weeklyCount)) {
                                    this.log(i + 1, targetSlot, 'info',
                                        `Nutritional Rule '${rule.name}': Skipped ${foodToAdd.name} — reached weekly frequency cap`)
                                    continue
                                }
                                if ((this.settings?.food_score_overrides?.[foodId] ?? 5) === 0) {
                                    this.log(i + 1, targetSlot, 'info',
                                        `Nutritional Rule '${rule.name}': Skipped ${foodToAdd.name} — food explicitly excluded`)
                                    continue
                                }

                                // 4. SEASONALITY CHECK
                                if (!this.checkSeasonalityHard(foodToAdd, this.today)) {
                                    this.log(i + 1, targetSlot, 'info',
                                        `Nutritional Rule '${rule.name}': Skipped ${foodToAdd.name} — not in season`)
                                    continue
                                }

                                // Prevent adding same food+rule multiple times on same day
                                const alreadyAdded = slots[targetSlot].some((m: any) => m.food?.id === foodId && m.food?.source?.rule_id === rule.id)
                                if (alreadyAdded) continue

                                // Tag collision check
                                const candidateWords = new Set<string>()
                                const cNameWords = (foodToAdd.name || '').toLocaleLowerCase('tr-TR').split(/\s+/)
                                cNameWords.forEach((w: string) => { if (w.length > 2) candidateWords.add(w) })
                                if (Array.isArray(foodToAdd.tags)) {
                                    foodToAdd.tags.forEach((t: string) => {
                                        const tw = (t || '').toLocaleLowerCase('tr-TR').split(/\s+/)
                                        tw.forEach((w: string) => { if (w.length > 2) candidateWords.add(w) })
                                    })
                                }

                                let hasCollision = false
                                for (const word of candidateWords) {
                                    if (slotTagWords.has(word)) {
                                        hasCollision = true
                                        this.log(i + 1, targetSlot, 'info',
                                            `Nutritional Rule '${rule.name}': Skipped ${foodToAdd.name} — tag collision on word "${word}"`)
                                        break
                                    }
                                }
                                if (hasCollision) continue

                                // No collision — add food to slot
                                const clonedFood = { ...foodToAdd, name: this.capitalize(foodToAdd.name) }
                                clonedFood.source = { type: 'nutritional_rule', rule: rule.name, rule_id: rule.id }

                                slots[targetSlot].push({ slot: targetSlot, food: clonedFood })
                                plan.meals.push({
                                    day: i + 1, dayName, slot: targetSlot,
                                    food: clonedFood,
                                    source: clonedFood.source
                                })

                                // Update context
                                dailyContext.dailyMacros.calories += clonedFood.calories || 0
                                dailyContext.dailyMacros.protein += clonedFood.protein || 0
                                dailyContext.dailyMacros.carbs += clonedFood.carbs || 0
                                dailyContext.dailyMacros.fat += clonedFood.fat || 0

                                this.log(i + 1, targetSlot, 'select',
                                    `Nutritional Rule '${rule.name}' triggered (Deficit: ${diff.toFixed(1)} > limit ${def.condition.value}). Added ${clonedFood.name} [rotation idx=${idx}].`,
                                    clonedFood.name)

                                // Update currentDayMacros for subsequent rules
                                currentDayMacros.calories += clonedFood.calories || 0
                                currentDayMacros.protein += clonedFood.protein || 0
                                currentDayMacros.carbs += clonedFood.carbs || 0
                                currentDayMacros.fat += clonedFood.fat || 0

                                // Advance rotation index for next day
                                this.rotationIndices.set(rotKey, idx + 1)
                                added = true
                                break // Successfully added, stop trying alternatives
                            }

                            if (!added && candidateFoodIds.length > 0) {
                                this.log(i + 1, targetSlot, 'info',
                                    `Nutritional Rule '${rule.name}': All ${candidateFoodIds.length} candidates had tag collisions. Skipped.`)
                            }
                        }
                    }
                }
            }

            // ── CROSS-DAY: Track daily deviation and accumulate debt (including calories) ──
            if (targetMacros) {
                const actualDayMacros = getDailyMacros(slots)
                const proteinDelta = targetMacros.protein - actualDayMacros.protein
                const fatDelta = targetMacros.fat - actualDayMacros.fat
                const carbsDelta = targetMacros.carbs - actualDayMacros.carbs
                const calorieDelta = targetMacros.calories - actualDayMacros.calories

                macroDebt.protein += proteinDelta
                macroDebt.fat += fatDelta
                macroDebt.carbs += carbsDelta
                macroDebt.calories += calorieDelta

                this.log(i + 1, 'CROSS-DAY', 'info',
                    `Day ${i + 1} deviation: Cal=${calorieDelta > 0 ? '+' : ''}${Math.round(calorieDelta)}kcal, ` +
                    `P=${proteinDelta > 0 ? '+' : ''}${proteinDelta.toFixed(1)}g, ` +
                    `F=${fatDelta > 0 ? '+' : ''}${fatDelta.toFixed(1)}g, ` +
                    `C=${carbsDelta > 0 ? '+' : ''}${carbsDelta.toFixed(1)}g | ` +
                    `Cumulative debt: Cal=${Math.round(macroDebt.calories)}kcal, P=${macroDebt.protein.toFixed(1)}g, F=${macroDebt.fat.toFixed(1)}g, C=${macroDebt.carbs.toFixed(1)}g`)
            }

            // At the end of the day, update the trackers for consecutive day penalties
            twoDaysAgoSelectedIds = new Set(yesterdaySelectedIds)
            yesterdaySelectedIds = new Set(dailyContext.dailySelectedIds)
        }



        // 4. POST-PROCESSING: Frequency Flex (adjust min↔max counts based on calorie gap)
        if (targetMacros && this.rules.length > 0) {
            this.adjustFrequencyForMacros(plan, targetMacros, mealTypes, effectiveSlotConfig)
        }


        // 5. POST-PROCESSING: Enforce per-food min_weekly_freq limits (hard, best effort)
        this.enforceFoodWeeklyMinimums(plan, mealTypes, effectiveSlotConfig, targetMacros)


        // 5. POST-PROCESSING: Portion Adjustment (if enabled)
        if (this.settings?.portion_settings) {
            this.adjustWeekPortions(plan)
        }


        // 6. POST-PROCESSING: Smart Balance (auto-balance macros)
        if (targetMacros) {
            const macroTolerances = this.settings?.portion_settings?.macro_tolerances || {
                protein: { min: 80, max: 120 },
                carb: { min: 80, max: 120 },
                fat: { min: 80, max: 120 },
                calories: { min: 90, max: 110 }
            }
            if (this.isWeeklyPlanWithinTolerance(plan, targetMacros, macroTolerances)) {
                console.log('[AUTO-BALANCE] Skipped (weekly plan already within tolerance).')
                this.log(0, 'AUTO-BALANCE', 'info', 'Skipped: weekly plan already within tolerance.')
            } else {
                console.log('[AUTO-BALANCE] Smart Balance starting as post-processing step...')
                this.log(0, 'AUTO-BALANCE', 'info', 'Running Smart Balance as post-processing step...')
                try {
                    const { plan: balancedPlan, changes } = await this.balancePlan(plan, 'weekly')

                    if (changes && Array.isArray(changes)) {
                        for (const ch of changes) {
                            this.log(0, 'AUTO-BALANCE', 'info', ch)
                        }
                    }
                    console.log('[AUTO-BALANCE] Smart Balance completed successfully')
                    return balancedPlan
                } catch (err) {
                    console.error('[AUTO-BALANCE] Smart Balance failed:', err)
                }
            }
        }

        return plan
    }

    /**
     * Adjust portions for the entire week based on settings strategies
     */
    adjustWeekPortions(plan: any) {
        if (!this.settings?.portion_settings) return

        const { global_min, global_max, step_value, strategies, max_adjusted_items_per_day } = this.settings.portion_settings
        const minMult = global_min || 0.5
        const maxMult = global_max || 2.0
        // Ensure step is positive and not NaN
        let step = (typeof step_value === 'number' && !isNaN(step_value) && step_value > 0) ? step_value : 0.5
        const dailyLimit = max_adjusted_items_per_day || 99 // Default broad limit if not set

        if (!strategies.macro_convergence && !strategies.max_limit_protection) return

        plan.meals.forEach((meal: any) => {
            // Initialize multiplier if not present or invalid
            if (typeof meal.portion_multiplier !== 'number' || isNaN(meal.portion_multiplier)) {
                meal.portion_multiplier = 1
            }
        })

        const dayCount = 7
        for (let i = 1; i <= dayCount; i++) {
            const dayMeals = plan.meals.filter((m: any) => m.day === i)
            if (dayMeals.length === 0) continue

            let adjustedCount = 0 // Track adjustments for this day

            // Calculate current macros - Safe Reduce
            let currentCals = dayMeals.reduce((sum: number, m: any) => {
                const cals = m.food?.calories || 0
                const mult = (typeof m.portion_multiplier === 'number' && !isNaN(m.portion_multiplier)) ? m.portion_multiplier : 1
                return sum + (cals * mult)
            }, 0)

            const targetCals = plan.targetMacros.calories

            // Track adjusted items for the whole day across strategies
            const adjustedItems = new Set<string>()

            // Strategy: MAX CALORIE SHARE PROTECTION (Single Meal Limit)
            // If a single meal overrides X% of daily target, force reduce it first.
            const maxSharePercent = this.settings.portion_settings.max_calorie_percentage ?? 50
            const maxMealCal = targetCals * (maxSharePercent / 100)

            for (const meal of dayMeals) {
                if (!this.isScalableFood(meal)) continue

                let currentMult = (typeof meal.portion_multiplier === 'number' && !isNaN(meal.portion_multiplier)) ? meal.portion_multiplier : 1
                let currentMealCal = (meal.food.calories || 0) * currentMult

                // If this specific meal exceeds the % limit
                if (currentMealCal > maxMealCal) {
                    // Check limits
                    if (!adjustedItems.has(meal.food.id) && adjustedItems.size >= dailyLimit) continue

                    const foodMin = meal.food.min_quantity ?? minMult
                    let foodStep = meal.food.step ?? step
                    if (foodStep <= 0) foodStep = 0.5

                    let reduced = false

                    // Loop to reduce until under limit or hit min
                    while (currentMealCal > maxMealCal && currentMult > foodMin + 0.01) {
                        const oldCals = currentMealCal
                        currentMult = Math.max(foodMin, currentMult - foodStep)
                        // Fix float
                        currentMult = Math.round(currentMult * 100) / 100
                        meal.portion_multiplier = currentMult

                        currentMealCal = (meal.food.calories || 0) * currentMult
                        currentCals -= (oldCals - currentMealCal)
                        reduced = true
                    }

                    if (reduced) {
                        adjustedItems.add(meal.food.id)
                        this.log(i, meal.slot, 'info', `Reduced huge meal >${maxSharePercent}%`, `x${meal.portion_multiplier} ${meal.food.name}`)
                    }
                }
            }

            // Strategy: MAX LIMIT PROTECTION (Scale Down - Overall)
            // Use asymmetric tolerance: max percentage from settings (e.g. 110 means 1.10)
            const calMaxTol = (this.settings?.portion_settings?.macro_tolerances?.calories?.max ?? 110) / 100
            if (strategies.max_limit_protection && currentCals > targetCals * calMaxTol) {
                let loopGuard = 0

                while (currentCals > targetCals * calMaxTol && loopGuard < 50) {
                    loopGuard++

                    // Find candidates that CAN be reduced further
                    const candidates = dayMeals.filter((m: any) => {
                        if (!this.isScalableFood(m)) return false

                        // Check Min Limit
                        const foodMin = m.food.min_quantity ?? minMult
                        if (m.portion_multiplier <= foodMin + 0.01) return false // Already at min

                        // Check Daily Item Count Limit
                        // We can modify if it's already modified OR if we haven't hit the limit yet
                        if (!adjustedItems.has(m.food.id) && adjustedItems.size >= dailyLimit) return false

                        return true
                    })

                    if (candidates.length === 0) {
                        this.log(i, 'GENEL', 'info', 'Portion reduction stopped', 'No more scalable foods or limits reached')
                        break
                    }

                    // Sort by current total calories (Highest impact first)
                    candidates.sort((a: any, b: any) => {
                        const calsA = (a.food.calories || 0) * a.portion_multiplier
                        const calsB = (b.food.calories || 0) * b.portion_multiplier
                        return calsB - calsA
                    })

                    // Pick best candidate
                    const targetMeal = candidates[0]
                    const foodMin = targetMeal.food.min_quantity ?? minMult
                    const foodStep = targetMeal.food.step ?? step

                    // Apply Reduction (One Step)
                    const oldCals = (targetMeal.food.calories || 0) * targetMeal.portion_multiplier
                    targetMeal.portion_multiplier = Math.max(foodMin, targetMeal.portion_multiplier - foodStep)

                    // Fix floating point issues roughly
                    targetMeal.portion_multiplier = Math.round(targetMeal.portion_multiplier * 100) / 100

                    const newCals = (targetMeal.food.calories || 0) * targetMeal.portion_multiplier
                    currentCals -= (oldCals - newCals)

                    adjustedItems.add(targetMeal.food.id)
                    this.log(i, targetMeal.slot, 'info', `Reduced portion x${targetMeal.portion_multiplier}`, targetMeal.food.name)
                }
            }

            // Strategy: MACRO CONVERGENCE (Scale Up)
            // Use asymmetric tolerance: min percentage from settings (e.g. 90 means 0.90)
            const calMinTol = (this.settings?.portion_settings?.macro_tolerances?.calories?.min ?? 90) / 100
            if (strategies.macro_convergence && currentCals < targetCals * calMinTol) {
                let loopGuard = 0

                while (currentCals < targetCals * calMinTol && loopGuard < 50) {
                    loopGuard++

                    // Find candidates that CAN be increased further
                    const candidates = dayMeals.filter((m: any) => {
                        if (!this.isScalableFood(m)) return false

                        // Check Max Limit
                        const foodMax = m.food.max_quantity ?? maxMult
                        if (m.portion_multiplier >= foodMax - 0.01) return false // Already at max

                        // Check Daily Item Count Limit
                        if (!adjustedItems.has(m.food.id) && adjustedItems.size >= dailyLimit) return false

                        return true
                    })

                    if (candidates.length === 0) break

                    // Sort: Priority to Main Dish, then by calories (lowest first? or highest to fill faster?)
                    // Filling faster (highest calorie density) is usually efficient, but maybe we want to scale main dish first.
                    candidates.sort((a: any, b: any) => {
                        const roleA = a.food.role === 'mainDish' ? 10 : 0
                        const roleB = b.food.role === 'mainDish' ? 10 : 0
                        if (roleA !== roleB) return roleB - roleA // Main dish first

                        // Then by calorie impact (try to boost big items?)
                        const calsA = (a.food.calories || 0) * a.portion_multiplier
                        const calsB = (b.food.calories || 0) * b.portion_multiplier
                        return calsB - calsA
                    })

                    const targetMeal = candidates[0]
                    const foodMax = targetMeal.food.max_quantity ?? maxMult
                    const foodStep = targetMeal.food.step ?? step

                    // Apply Increase
                    const oldCals = (targetMeal.food.calories || 0) * targetMeal.portion_multiplier
                    targetMeal.portion_multiplier = Math.min(foodMax, targetMeal.portion_multiplier + foodStep)

                    targetMeal.portion_multiplier = Math.round(targetMeal.portion_multiplier * 100) / 100

                    const newCals = (targetMeal.food.calories || 0) * targetMeal.portion_multiplier
                    currentCals += (newCals - oldCals)

                    adjustedItems.add(targetMeal.food.id)
                }
            }
        }
    }

    /**
     * Frequency Flex: Post-processing step to adjust rule frequency counts
     * based on weekly calorie gap. Adds or removes meals within min-max bounds.
     */
    private adjustFrequencyForMacros(
        plan: any,
        targetMacros: TargetMacros,
        mealTypes: string[],
        effectiveSlotConfig: any
    ) {
        // Calculate weekly totals
        const weeklyTarget = targetMacros.calories * 7
        const getWeeklyTotal = () => {
            return plan.meals.reduce((sum: number, m: any) => {
                const mult = (typeof m.portion_multiplier === 'number' && !isNaN(m.portion_multiplier)) ? m.portion_multiplier : 1
                return sum + ((m.food?.calories || 0) * mult)
            }, 0)
        }

        let weeklyTotal = getWeeklyTotal()
        const weeklyGap = weeklyTarget - weeklyTotal // Positive = deficit, Negative = surplus
        const gapPercent = Math.abs(weeklyGap) / weeklyTarget * 100

        // Only act if gap is >3% of weekly target
        if (gapPercent < 3) return

        this.log(0, 'FREQ-FLEX', 'info',
            `Weekly gap: ${Math.round(weeklyGap)}kcal (${weeklyGap > 0 ? 'deficit' : 'surplus'}, ${gapPercent.toFixed(1)}% of target)`)

        // Get all active frequency rules
        const freqRules = this.rules.filter(r => r.is_active && r.rule_type === 'frequency')
        if (freqRules.length === 0) return

        // Count current occurrences per rule across the full weekly plan
        const countRuleOccurrences = (rule: PlanningRule): number => {
            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef
            if (!def.target) return 0
            return plan.meals.filter((m: any) => this.matchesTarget(m.food, def.target)).length
        }

        // Calculate average calories per occurrence for a rule
        const avgCaloriesForRule = (rule: PlanningRule): number => {
            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef
            if (!def.target) return 0
            const matching = plan.meals.filter((m: any) => this.matchesTarget(m.food, def.target))
            if (matching.length === 0) {
                // Estimate from eligible foods
                const eligible = this.eligibleFoods.filter((f: any) => this.matchesTarget(f, def.target))
                if (eligible.length === 0) return 0
                return eligible.reduce((sum: number, f: any) => sum + (f.calories || 0), 0) / eligible.length
            }
            return matching.reduce((sum: number, m: any) => sum + (m.food?.calories || 0), 0) / matching.length
        }

        const MAX_FLEX_ITERATIONS = 10
        let flexCount = 0

        if (weeklyGap > 0) {
            // === CALORIE DEFICIT: Increase frequency (min → max) ===
            // Sort rules by average calories (highest first - fill faster)
            const expandableRules = freqRules
                .map(rule => {
                    const rawDef = rule.definition as any
                    const def = rawDef.data || rawDef
                    const current = countRuleOccurrences(rule)
                    const maxCount = def.max_count || current
                    const canExpand = maxCount - current
                    const avgCal = avgCaloriesForRule(rule)
                    return { rule, def, current, maxCount, canExpand, avgCal }
                })
                .filter(r => r.canExpand > 0 && r.avgCal > 0)
                .sort((a, b) => b.avgCal - a.avgCal) // Highest cal first for faster gap fill

            for (const expandable of expandableRules) {
                if (flexCount >= MAX_FLEX_ITERATIONS) break

                weeklyTotal = getWeeklyTotal()
                const currentGap = weeklyTarget - weeklyTotal
                if (currentGap < weeklyTarget * 0.03) break // Gap closed to <3%

                const { rule, def, avgCal } = expandable
                let currentCount = countRuleOccurrences(rule)
                const maxCount = def.max_count || currentCount

                while (currentCount < maxCount && flexCount < MAX_FLEX_ITERATIONS) {
                    flexCount++

                    // Find the day with the lowest total calories that doesn't already have this rule's target
                    const dayCalories: { day: number, cals: number, hasTarget: boolean }[] = []
                    for (let d = 1; d <= 7; d++) {
                        const dayMeals = plan.meals.filter((m: any) => m.day === d)
                        const dayCals = dayMeals.reduce((sum: number, m: any) => {
                            const mult = (typeof m.portion_multiplier === 'number' && !isNaN(m.portion_multiplier)) ? m.portion_multiplier : 1
                            return sum + ((m.food?.calories || 0) * mult)
                        }, 0)
                        const hasTarget = dayMeals.some((m: any) => this.matchesTarget(m.food, def.target))
                        dayCalories.push({ day: d, cals: dayCals, hasTarget })
                    }

                    // Prefer days that don't already have this target, then lowest calories
                    dayCalories.sort((a, b) => {
                        if (a.hasTarget !== b.hasTarget) return a.hasTarget ? 1 : -1
                        return a.cals - b.cals
                    })

                    const bestDay = dayCalories[0]
                    if (!bestDay) break

                    // Determine which slot to add to (prefer scope_meals if defined, else pick slot with room)
                    const scopeMeals = def.scope_meals && def.scope_meals.length > 0
                        ? def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                        : mealTypes.filter((m: string) => m !== 'KAHVALTI')

                    let addedFood = false
                    for (const slotName of scopeMeals) {
                        const slotMeals = plan.meals.filter((m: any) => m.day === bestDay.day && m.slot === slotName)
                        const normalizedFreqFlexSlot = normalizeSlotName(slotName)
                        const config =
                            effectiveSlotConfig[normalizedFreqFlexSlot]
                            || effectiveSlotConfig['ÖĞLEN']
                            || effectiveSlotConfig['KAHVALTI']
                            || Object.values(effectiveSlotConfig)[0]

                        if (slotMeals.length >= config.maxItems) continue

                        // Do not add the same role/category target multiple times to one slot.
                        if (
                            (def.target?.type === 'role' || def.target?.type === 'category') &&
                            slotMeals.some((m: any) => this.matchesTarget(m.food, def.target))
                        ) {
                            continue
                        }

                        // Find a food matching the target
                        const usedIds = new Set(slotMeals.map((m: any) => m.food?.id).filter(Boolean))
                        // Also exclude foods already used that day
                        const dayUsedIds = new Set(plan.meals.filter((m: any) => m.day === bestDay.day).map((m: any) => m.food?.id).filter(Boolean))
                        const normalizeRoleForSlot = (value: string) => normalizeCategory((value === 'corba' ? 'soup' : value) || '')
                        const uniqueSlotRoles = new Set(['maindish', 'soup', 'bread', 'salad'])
                        const targetRoleNorm = this.getCanonicalLockRole(def?.target?.value || '')
                        const lockRole = Planner.LOCKABLE_ROLES.includes(targetRoleNorm) ? targetRoleNorm : null
                        const lockContext = {
                            dayIndex: bestDay.day - 1,
                            slotName,
                            selectedFoods: slotMeals.map((m: any) => m.food).filter(Boolean),
                            currentDate: null
                        }
                        const dynamicLockedFood = lockRole ? this.getLockedFood(slotName, def?.target?.value || '', lockContext) : null
                        if (lockRole && dynamicLockedFood?._consistencyRuleName) {
                            this.setWeeklyLockReason(
                                lockRole,
                                dynamicLockedFood._consistencyRuleId || null,
                                dynamicLockedFood._consistencyRuleName
                            )
                        }
                        const lockedFood = lockRole
                            ? (dynamicLockedFood || this.weeklyLocks.get(lockRole) || (lockRole === 'soup' ? this.weeklyLocks.get('corba') : null))
                            : null

                        const candidates = this.eligibleFoods.filter((f: any) => {
                            if (!this.matchesTarget(f, def.target)) return false
                            if (usedIds.has(f.id) || dayUsedIds.has(f.id)) return false
                            
                            // -- NEW: Exclusive Scope Daily Bans --
                            if (this.dailyBannedTargetsMap?.has(bestDay.day)) {
                                const dayBans = this.dailyBannedTargetsMap.get(bestDay.day)!
                                for (const target of dayBans) {
                                    if (this.matchesTarget(f, target)) return false
                                }
                            }
                            // ------------------------------------

                            if (!this.isMealTypeCompatibleWithSlot(f, slotName)) return false
                            const weeklyCount = plan.meals.filter((m: any) => m.food?.id === f.id).length
                            if (this.hasReachedWeeklyCap(f, weeklyCount)) return false
                            // Check effective priority
                            const overrideScore = this.settings?.food_score_overrides?.[f.id]
                            if (overrideScore === 0) return false
                            if (lockedFood && f.id !== lockedFood.id) return false

                            // AFFINITY GUARD: Block forbidden combinations in same slot
                            const slotFoodsForAffinity = slotMeals
                                .map((m: any) => m.food)
                                .filter(Boolean)
                            if (this.hasForbiddenAffinityConflict(f, slotFoodsForAffinity)) return false

                            const candidateRole = normalizeRoleForSlot(f.role || '')
                            const candidateCategory = normalizeCategory(f.category || '')
                            const hasSameRoleCategoryInSlot = slotMeals.some((m: any) => {
                                const existingRole = normalizeRoleForSlot(m.food?.role || '')
                                const existingCategory = normalizeCategory(m.food?.category || '')
                                return Boolean(candidateRole) &&
                                    Boolean(candidateCategory) &&
                                    candidateRole === existingRole &&
                                    candidateCategory === existingCategory
                            })
                            if (hasSameRoleCategoryInSlot) return false

                            if (candidateRole && uniqueSlotRoles.has(candidateRole)) {
                                const hasUniqueRoleInSlot = slotMeals.some((m: any) => {
                                    const existingRole = normalizeRoleForSlot(m.food?.role || '')
                                    return existingRole === candidateRole
                                })
                                if (hasUniqueRoleInSlot) return false
                            }
                            return true
                        })

                        if (candidates.length === 0) continue

                        // Pick the best candidate (closest to average daily gap)
                        const dailyGap = (weeklyTarget - getWeeklyTotal()) / 7
                        candidates.sort((a: any, b: any) => {
                            return Math.abs((a.calories || 0) - dailyGap) - Math.abs((b.calories || 0) - dailyGap)
                        })

                        const rawFood = candidates[0]
                        const food = (dynamicLockedFood && rawFood?.id === dynamicLockedFood.id)
                            ? {
                                ...rawFood,
                                _consistencyRuleId: dynamicLockedFood._consistencyRuleId || null,
                                _consistencyRuleName: dynamicLockedFood._consistencyRuleName || ''
                            }
                            : rawFood
                        const dayName = new Date(2026, 2, 1 + bestDay.day).toLocaleDateString('tr-TR', { weekday: 'long' })

                        plan.meals.push({
                            day: bestDay.day,
                            dayName,
                            slot: slotName,
                            food: { ...food, name: this.capitalize(food.name) },
                            source: this.decorateSourceWithLockMetadata(food, { 
                                type: 'freq_flex_add', 
                                rule: `Frekans Artırma: ${rule.name}`,
                                rule_id: rule.id 
                            })
                        })

                        const selectedLockRole = normalizeRoleForSlot(food.role || '')
                        if (Planner.LOCKABLE_ROLES.includes(selectedLockRole) && !this.weeklyLocks.has(selectedLockRole)) {
                            this.weeklyLocks.set(selectedLockRole, food)
                            if (selectedLockRole === 'soup') {
                                this.weeklyLocks.set('corba', food)
                            }
                        }
                        if (Planner.LOCKABLE_ROLES.includes(selectedLockRole) && food?._consistencyRuleName) {
                            this.setWeeklyLockReason(
                                selectedLockRole,
                                food._consistencyRuleId || null,
                                food._consistencyRuleName
                            )
                        }

                        this.log(bestDay.day, slotName, 'select',
                            `Freq-Flex: Added '${food.name}' (${food.calories}kcal) via rule '${rule.name}' (${currentCount + 1}/${maxCount})`)

                        currentCount++
                        addedFood = true
                        break // Move to next iteration
                    }

                    if (!addedFood) break // No valid slot found
                }
            }
        } else {
            // === CALORIE SURPLUS: Decrease frequency (max → min) ===
            // Sort rules by average calories (highest first - remove high-cal items first)
            const reducibleRules = freqRules
                .map(rule => {
                    const rawDef = rule.definition as any
                    const def = rawDef.data || rawDef
                    const current = countRuleOccurrences(rule)
                    const minCount = def.min_count || 0
                    const canReduce = current - minCount
                    const avgCal = avgCaloriesForRule(rule)
                    return { rule, def, current, minCount, canReduce, avgCal }
                })
                .filter(r => r.canReduce > 0 && r.avgCal > 0)
                .sort((a, b) => b.avgCal - a.avgCal) // Highest cal first for fastest reduction

            for (const reducible of reducibleRules) {
                if (flexCount >= MAX_FLEX_ITERATIONS) break

                weeklyTotal = getWeeklyTotal()
                const currentSurplus = weeklyTotal - weeklyTarget
                if (currentSurplus < weeklyTarget * 0.03) break // Surplus closed to <3%

                const { rule, def } = reducible
                let currentCount = countRuleOccurrences(rule)
                const minCount = def.min_count || 0

                while (currentCount > minCount && flexCount < MAX_FLEX_ITERATIONS) {
                    flexCount++

                    // Find the day with the highest total calories that has an item matching this rule
                    const dayCalories: { day: number, cals: number, mealIdx: number }[] = []
                    for (let d = 1; d <= 7; d++) {
                        const dayMeals = plan.meals.filter((m: any) => m.day === d)
                        const dayCals = dayMeals.reduce((sum: number, m: any) => {
                            const mult = (typeof m.portion_multiplier === 'number' && !isNaN(m.portion_multiplier)) ? m.portion_multiplier : 1
                            return sum + ((m.food?.calories || 0) * mult)
                        }, 0)

                        // Find a removable meal matching the target
                        const matchIdx = plan.meals.findIndex((m: any) =>
                            m.day === d &&
                            this.matchesTarget(m.food, def.target) &&
                            m.source?.type !== 'fixed' && // Don't remove fixed meals
                            m.source?.type !== 'required_role' && // Don't remove required roles
                                (() => {
                                    // 1. MIN ITEMS PROTECTION: Do not remove if slot would fall below minItems
                                    const normalizedMealSlot = normalizeSlotName(m.slot)
                                    const slotConfig =
                                        effectiveSlotConfig[normalizedMealSlot]
                                        || effectiveSlotConfig['ÖĞLEN']
                                        || effectiveSlotConfig['KAHVALTI']
                                        || Object.values(effectiveSlotConfig)[0]
                                    
                                    const currentSlotMeals = plan.meals.filter((candidate: any) => 
                                        candidate.day === d && candidate.slot === m.slot
                                    )
                                    if (currentSlotMeals.length <= (slotConfig?.minItems || 1)) return false

                                    // 2. MANDATORY ROLE PROTECTION: Do not remove the last required-role item
                                    // Always protect maindish and breakfast_main even if requiredRoles is empty in DB
                                    const HARDCODED_PROTECTED_ROLES = ['maindish', 'breakfast_main']
                                    const requiredRoles = [
                                        ...HARDCODED_PROTECTED_ROLES,
                                        ...(slotConfig?.requiredRoles || []).map((r: string) => this.getCanonicalLockRole(r))
                                    ]
                                    // Dedupe
                                    const uniqueRequiredRoles = [...new Set(requiredRoles)]

                                    const mealRole = this.getCanonicalLockRole(m.food?.role || '')
                                    const isMandatoryMain = m.source?.is_required_role && 
                                        (this.getCanonicalLockRole(m.source.required_role_name || '') === 'maindish')

                                    if (isMandatoryMain) return false // Protect absolute
                                    if (!mealRole || !uniqueRequiredRoles.includes(mealRole)) return true

                                    const sameRoleCountInSlot = currentSlotMeals.filter((candidate: any) => {
                                        const candidateRole = this.getCanonicalLockRole(candidate.food?.role || '')
                                        return candidateRole === mealRole
                                    }).length

                                    // Keep at least one required-role item in the slot.
                                    return sameRoleCountInSlot > 1
                                })()
                        )
                        if (matchIdx >= 0) {
                            dayCalories.push({ day: d, cals: dayCals, mealIdx: matchIdx })
                        }
                    }

                    if (dayCalories.length === 0) break

                    // Remove from the day with highest calories
                    dayCalories.sort((a, b) => b.cals - a.cals)
                    const worstDay = dayCalories[0]

                    const removedMeal = plan.meals[worstDay.mealIdx]
                    this.log(worstDay.day, removedMeal.slot, 'info',
                        `Freq-Flex: Removed '${removedMeal.food?.name}' (${removedMeal.food?.calories}kcal) via rule '${rule.name}' (${currentCount - 1}/${minCount} min)`)

                    plan.meals.splice(worstDay.mealIdx, 1)
                    currentCount--
                }
            }
        }

        // Log final result
        weeklyTotal = getWeeklyTotal()
        const finalGap = weeklyTarget - weeklyTotal
        const finalGapPct = Math.abs(finalGap) / weeklyTarget * 100
        if (flexCount > 0) {
            this.log(0, 'FREQ-FLEX', 'info',
                `Frequency Flex completed: ${flexCount} adjustment(s). Final weekly gap: ${Math.round(finalGap)}kcal (${finalGapPct.toFixed(1)}%)`)
        }
    }

    private enforceFoodWeeklyMinimums(
        plan: any,
        mealTypes: string[],
        effectiveSlotConfig: Record<string, SlotConfig>,
        targetMacros?: TargetMacros
    ) {
        const foodsWithMin = this.eligibleFoods.filter((food: any) => {
            const rawMin = food?.min_weekly_freq
            const minWeekly = typeof rawMin === 'number'
                ? rawMin
                : Number(rawMin ?? Number.NaN)
            return Number.isFinite(minWeekly) && minWeekly > 0
        })

        if (foodsWithMin.length === 0) return

        const roleNorm = (value: string) => normalizeCategory(value || '')
        const uniqueRoles = new Set(['maindish', 'soup', 'bread', 'salad'])
        const fallbackConfig = Object.values(DEFAULT_SLOT_CONFIG)[0]
        const dailyTargetCalories = targetMacros?.calories || 1800

        const getDayMeals = (day: number) => plan.meals.filter((m: any) => m.day === day)
        const getDayCalories = (day: number) => {
            return getDayMeals(day).reduce((sum: number, m: any) => {
                const multiplier = (typeof m.portion_multiplier === 'number' && !isNaN(m.portion_multiplier))
                    ? m.portion_multiplier
                    : 1
                return sum + ((m.food?.calories || 0) * multiplier)
            }, 0)
        }

        const getDayName = (day: number) => {
            const existing = plan.meals.find((m: any) => m.day === day)?.dayName
            if (existing) return existing
            const dateFromPlan = plan?.dates?.[day - 1]
            const date = dateFromPlan ? new Date(dateFromPlan) : new Date(this.today.getTime() + ((day - 1) * 24 * 60 * 60 * 1000))
            return date.toLocaleDateString('tr-TR', { weekday: 'long' })
        }

        const getDayDate = (day: number) => {
            const dateFromPlan = plan?.dates?.[day - 1]
            return dateFromPlan ? new Date(dateFromPlan) : new Date(this.today.getTime() + ((day - 1) * 24 * 60 * 60 * 1000))
        }

        const getSlotTags = (slotMeals: any[]) => {
            const tags = new Set<string>()
            for (const meal of slotMeals) {
                if (meal?.food) this.addFoodTags(tags, meal.food)
            }
            return tags
        }

        const canFoodBePlacedInSlot = (food: any, slotName: string, config: SlotConfig, slotMeals: any[], dayMeals?: any[]) => {
            if (!this.isMealTypeCompatibleWithSlot(food, slotName)) return false

            const foodCategoryNorm = roleNorm(food.category || '')
            const slotNorm = roleNorm(slotName || '')
            const foodRoleNorm = roleNorm(food.role || '')
            let matchesSlot = false

            if (foodCategoryNorm && foodCategoryNorm === slotNorm) matchesSlot = true

            const slotRoles = [...(config.requiredRoles || []), ...(config.optionalRoles || [])].map((r: string) => roleNorm(r))
            if (foodRoleNorm && slotRoles.includes(foodRoleNorm)) matchesSlot = true

            // Relaxed fallback for flexible side/filler roles.
            const flexibleRoles = new Set(['sidedish', 'salad', 'soup', 'corba', 'bread', 'drink', 'dessert', 'snack', 'fruit', 'supplement', 'nuts'])
            if (foodRoleNorm && flexibleRoles.has(foodRoleNorm)) matchesSlot = true

            if (!matchesSlot) return false

            // If slot already has a unique role matching this food, do not place directly.
            if (foodRoleNorm && uniqueRoles.has(foodRoleNorm)) {
                const hasSameUniqueRole = slotMeals.some((meal: any) => roleNorm(meal?.food?.role || '') === foodRoleNorm)
                if (hasSameUniqueRole) return false
            }

            // AFFINITY GUARD: Block forbidden combinations within the same slot
            if (slotMeals && slotMeals.length > 0) {
                const slotFoods = slotMeals.map((m: any) => m.food).filter(Boolean)
                if (this.hasForbiddenAffinityConflict(food, slotFoods)) return false
            }

            return true
        }

        for (const food of foodsWithMin) {
            let minTarget = this.getEffectiveMinWeeklyFreq(food)
            if (minTarget <= 0) continue

            // Do not enforce min_weekly_freq for weeks where this food is fully out of season.
            const hasInSeasonDay = Array.from({ length: 7 }, (_, i) => this.checkSeasonalityHard(food, getDayDate(i + 1))).some(Boolean)
            if (!hasInSeasonDay) {
                this.log(0, 'MIN-WEEKLY', 'info', `Skipping min_weekly_freq for '${food.name}' because it is out of season this week.`)
                continue
            }

            let currentCount = plan.meals.filter((m: any) => m.food?.id === food.id).length
            let guard = 0
            const maxGuard = Math.max(12, minTarget * 6)

            while (currentCount < minTarget && guard < maxGuard) {
                guard++

                let bestAction:
                    | { type: 'add', day: number, slotName: string, penalty: number }
                    | { type: 'swap', day: number, slotName: string, penalty: number, replaceIndex: number }
                    | null = null

                for (let day = 1; day <= 7; day++) {
                    const dayDate = getDayDate(day)
                    if (!this.checkSeasonalityHard(food, dayDate)) continue

                    // -- NEW: Exclusive Scope Daily Bans --
                    if (this.dailyBannedTargetsMap?.has(day)) {
                        const dayBans = this.dailyBannedTargetsMap.get(day)!
                        if (dayBans.some(target => this.matchesTarget(food, target))) {
                            continue
                        }
                    }
                    // ------------------------------------

                    const dayMeals = getDayMeals(day)
                    const dayCalories = getDayCalories(day)

                    // Keep one occurrence per day for minimum balancing.
                    if (dayMeals.some((m: any) => m.food?.id === food.id)) continue

                    for (const slotName of mealTypes) {
                        const normalizedMinWeeklySlot = normalizeSlotName(slotName)
                        const config = effectiveSlotConfig[normalizedMinWeeklySlot] || fallbackConfig
                        const slotMeals = dayMeals.filter((m: any) => m.slot === slotName)
                        if (!canFoodBePlacedInSlot(food, slotName, config, slotMeals, dayMeals)) continue

                        // Case A: add as extra item (if slot has room)
                        if (slotMeals.length < (config.maxItems || 4)) {
                            const slotTags = getSlotTags(slotMeals)
                            if (!this.hasTagConflict(food, slotTags)) {
                                const projectedCalories = dayCalories + (food.calories || 0)
                                const penalty = Math.abs(projectedCalories - dailyTargetCalories) + (slotMeals.length * 2)
                                if (!bestAction || penalty < bestAction.penalty) {
                                    bestAction = { type: 'add', day, slotName, penalty }
                                }
                            }
                        }

                        // Case B: swap with same-role meal when slot is full
                        if (slotMeals.length >= (config.maxItems || 4)) {
                            const foodRoleNorm = roleNorm(food.role || '')
                            for (const meal of slotMeals) {
                                if (!meal?.food || meal.food.id === food.id) continue
                                const mealRoleNorm = roleNorm(meal.food.role || '')
                                if (foodRoleNorm && mealRoleNorm !== foodRoleNorm) continue

                                const slotTagsWithoutMeal = getSlotTags(slotMeals.filter((m: any) => m !== meal))
                                if (this.hasTagConflict(food, slotTagsWithoutMeal)) continue

                                const oldMultiplier = (typeof meal.portion_multiplier === 'number' && !isNaN(meal.portion_multiplier))
                                    ? meal.portion_multiplier
                                    : 1
                                const oldCalories = (meal.food?.calories || 0) * oldMultiplier
                                const projectedCalories = dayCalories - oldCalories + (food.calories || 0)
                                const penalty = Math.abs(projectedCalories - dailyTargetCalories) + 10
                                const replaceIndex = plan.meals.indexOf(meal)
                                if (replaceIndex < 0) continue

                                if (!bestAction || penalty < bestAction.penalty) {
                                    bestAction = { type: 'swap', day, slotName, penalty, replaceIndex }
                                }
                            }
                        }
                    }
                }

                if (!bestAction) {
                    this.log(0, 'MIN-WEEKLY', 'info', `Could not satisfy min_weekly_freq for '${food.name}' (${currentCount}/${minTarget}).`)
                    break
                }

                if (bestAction.type === 'add') {
                    plan.meals.push({
                        day: bestAction.day,
                        dayName: getDayName(bestAction.day),
                        slot: bestAction.slotName,
                        food: { ...food, name: this.capitalize(food.name) },
                        source: { type: 'food_min_weekly_add', rule: `Min Haftalık Sıklık: ${this.capitalize(food.name)}` }
                    })
                    this.log(bestAction.day, bestAction.slotName, 'select', `min_weekly_freq add (${currentCount + 1}/${minTarget})`, food.name)
                } else {
                    const oldMeal = plan.meals[bestAction.replaceIndex]
                    const oldName = oldMeal?.food?.name
                    plan.meals[bestAction.replaceIndex] = {
                        ...oldMeal,
                        food: { ...food, name: this.capitalize(food.name) },
                        portion_multiplier: 1,
                        source: { type: 'food_min_weekly_swap', rule: `Min Haftalık Sıklık: ${this.capitalize(food.name)}` }
                    }
                    this.log(bestAction.day, bestAction.slotName, 'select', `min_weekly_freq swap (${currentCount + 1}/${minTarget}) replaced '${oldName || 'unknown'}'`, food.name)
                }

                currentCount = plan.meals.filter((m: any) => m.food?.id === food.id).length
            }
        }
    }

    private isScalableFood(meal: any): boolean {
        if (!meal.food) return false
        // Respect portion_fixed flag from database
        if (meal.food.portion_fixed) return false

        // Expanded scalable roles to include snacks and desserts as they are often good candidates for portion control
        const role = meal.food.role
        const allowedRoles = ['mainDish', 'sideDish', 'salad', 'corba', 'bread', 'breakfast_main', 'snack', 'dessert', 'fruit']
        return allowedRoles.includes(role) || !role
    }
    private async selectFoodsForSlot(
        slotName: string,
        context: any,
        slotBudget: number,
        config: SlotConfig
    ): Promise<any[]> {
        const selectedFoods: any[] = []
        const selectedIds = new Set<string>()
        const slotTags = new Set<string>()
        const normalizedSlotName = normalizeSlotName(slotName)
        const category = SLOT_TO_CATEGORY[normalizedSlotName] || normalizedSlotName || slotName

        // Pass slot configuration restrictions to context so child evaluation loops can respect them
        context.currentBannedRoles = Array.isArray(config.bannedRoles) ? config.bannedRoles.map(r => this.getCanonicalLockRole(r) || r) : []
        context.currentBannedTags = Array.isArray(config.bannedTags) ? config.bannedTags.map(t => typeof t === 'string' ? t.toLowerCase() : '') : []

        // Track slot macros
        let slotMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 }

        // ===== FIXED MEAL RULES - Check for locked foods first =====
        const fixedFoods = this.getFixedFoodsForSlot(slotName, context.dayIndex)
        for (const foodName of fixedFoods) {
            const food = this.allFoods.find(f => f.name === foodName)
            if (food) {
                selectedFoods.push(food)
                selectedIds.add(food.id)
                this.addFoodMacros(slotMacros, food)
                this.addFoodTags(slotTags, food)
                this.log(context.dayIndex + 1, slotName, 'select', `Fixed meal selected`, foodName)
                // Add source info
                selectedFoods[selectedFoods.length - 1].source = { type: 'fixed', rule: 'Fixed Meal' }
            } else {
                this.log(context.dayIndex + 1, slotName, 'error', `Fixed meal not found: ${foodName}`)
            }
        }
        // ===== END FIXED MEAL RULES =====

        // Track unique roles already filled in this slot (to prevent e.g. 2 soups)
        const UNIQUE_SLOT_ROLES = new Set(['maindish', 'soup', 'bread', 'salad'])
        const selectedRoles = new Set<string>()
        for (const f of selectedFoods) {
            const canonicalRole = this.getCanonicalLockRole(f?.role || '')
            if (!canonicalRole) continue
            selectedRoles.add(canonicalRole)
            if (canonicalRole === 'maindish' && !context.slotMainDish) {
                context.slotMainDish = f
            }
        }

        // Add slotSelectedFoods reference to context for per_meal frequency counting
        context.slotSelectedFoods = selectedFoods

        // Get slot calorie budget from context
        const slotCalorieBudget = slotBudget || 500

        // Defensive dedupe: if config accidentally contains the same required role multiple times,
        // keep the first occurrence only.
        const requiredRolesRaw = Array.isArray(config.requiredRoles) ? config.requiredRoles : []
        const requiredRoleKeys = new Set<string>()
        const dedupedRequiredRoles = requiredRolesRaw.filter((role: string) => {
            const canonical = this.getCanonicalLockRole(role || '')
            const key = canonical || normalizeCategory(role || '')
            if (!key) return false
            if (requiredRoleKeys.has(key)) return false
            requiredRoleKeys.add(key)
            return true
        })

        // Rules applicable to this slot/day.
        // Sorting strategy:
        // 1) User-defined order (sort_order, top to bottom in UI)
        // 2) Specificity (category/food scoped rules before generic role rules in ties)
        // 3) Priority fallback
        const getFrequencyRuleSpecificity = (rule: any): number => {
            const def = (rule.definition as any)?.data || rule.definition || {}
            let score = 0
            const targetType = String(def?.target?.type || '')

            if (targetType === 'food_id') score += 60
            else if (targetType === 'name_contains') score += 50
            else if (targetType === 'tag') score += 45
            else if (targetType === 'category') score += 35
            else if (targetType === 'role') score += 25

            if (Array.isArray(def.scope_meals) && def.scope_meals.length > 0) score += 12
            if (Array.isArray(def.scope_days) && def.scope_days.length > 0) score += 8
            if (def.random_day_count) score += 4
            if (String(def.period || '') === 'per_meal') score += 6
            if (typeof def.min_count === 'number' && def.min_count > 0) score += 4

            return score
        }

        const relevantRules = this.rules.filter(r => {
            if (!r.is_active || r.rule_type !== 'frequency') return false
            const def = (r.definition as any).data || r.definition

            // Check Scope Weeks
            if (!this.isRuleActiveForWeek(def)) return false

            // Check Scope Meals
            if (def.scope_meals && def.scope_meals.length > 0) {
                const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                if (!normalizedScopeMeals.includes(normalizeSlotName(slotName))) return false
            }

            // Check Scope Days
            const dayOfWeek = context.dayIndex + 1
            if (def.scope_days && def.scope_days.length > 0 && !def.scope_days.includes(dayOfWeek)) return false

            // Check Random Days (Explicit or Implicit based on max_count)
            const randomDaysTarget = def.random_day_count || ((!def.scope_days || def.scope_days.length === 0) && def.max_count ? def.max_count : null)
            if (randomDaysTarget) {
                const count = typeof randomDaysTarget === 'number' ? randomDaysTarget : Number(randomDaysTarget)
                const randomDays = this.getRandomDaysForRule(r.id, count)
                if (!randomDays.includes(dayOfWeek)) return false
            }

            return true
        }).sort((a, b) => {
            const aOrderRaw = Number((a as any).sort_order)
            const bOrderRaw = Number((b as any).sort_order)
            const aOrder = Number.isFinite(aOrderRaw) ? aOrderRaw : Number.MAX_SAFE_INTEGER
            const bOrder = Number.isFinite(bOrderRaw) ? bOrderRaw : Number.MAX_SAFE_INTEGER

            if (aOrder !== bOrder) return aOrder - bOrder

            const specificityDiff = getFrequencyRuleSpecificity(b) - getFrequencyRuleSpecificity(a)
            if (specificityDiff !== 0) return specificityDiff

            return (b.priority || 0) - (a.priority || 0)
        })

        // 1. Required Roles - Select one food per required role (must have these even if over budget slightly)
        // Skip if fixed foods already filled the slot
        for (const role of dedupedRequiredRoles) {
            if (selectedFoods.length >= config.maxItems) break // Respect maxItems limit
            // Skip if this unique role is already filled (e.g., by fixed meal)
            const normalizedRole = this.getCanonicalLockRole(role || '')
            if (UNIQUE_SLOT_ROLES.has(normalizedRole) && selectedRoles.has(normalizedRole)) {
                this.log(context.dayIndex + 1, slotName, 'info', `Skipping required role '${role}' - already filled in slot`)
                continue
            }

            // Try to satisfy a still-unmet frequency rule with this required role first.
            // Example: required mainDish + category rule (POĞAÇA) -> choose a POĞAÇA mainDish when possible.
            let food: any | null = null
            let intersectedRule: any | null = null
            const requiredRoleNorm = this.getCanonicalLockRole(role || '')
            for (const rule of relevantRules) {
                const def = (rule.definition as any).data || rule.definition
                if (!def?.target) continue
                const period = def.period || 'weekly'
                const currentCount = this.countOccurrences(def.target, context, period)
                const minNeeded = Math.max(0, (def.min_count || 0) - currentCount)
                if (minNeeded <= 0) continue

                let searchTarget: string | null = null
                if (def.target.type === 'role') {
                    const targetRoleNorm = this.getCanonicalLockRole(def.target.value || '')
                    if (requiredRoleNorm && targetRoleNorm !== requiredRoleNorm) continue
                    searchTarget = def.target.value
                } else if (def.target.type === 'category') {
                    searchTarget = def.target.value
                } else {
                    continue
                }

                if (!searchTarget) continue
                const forceInclusion = def.force_inclusion === true
                const intersectionFood = await this.selectBestFoodByRole(
                    category,
                    searchTarget,
                    context,
                    selectedIds,
                    slotTags,
                    context.slotMainDish || null,
                    slotCalorieBudget - slotMacros.calories,
                    true,
                    false,
                    forceInclusion,
                    true
                )
                if (!intersectionFood) continue
                if (!this.matchesTarget(intersectionFood, def.target)) continue

                const intersectionRole = this.getCanonicalLockRole(intersectionFood.role || '')
                if (requiredRoleNorm && intersectionRole !== requiredRoleNorm) continue
                if (intersectionRole && UNIQUE_SLOT_ROLES.has(intersectionRole) && selectedRoles.has(intersectionRole)) continue

                food = intersectionFood
                intersectedRule = rule
                this.log(
                    context.dayIndex + 1,
                    slotName,
                    'info',
                    `Required role '${role}' intersected with '${rule.name}'`,
                    intersectionFood.name
                )
                break
            }

            // Fallback: direct role-based fill
            if (!food) {
                // Prefer lower calorie options when budget is tight
                food = await this.selectBestFoodByRole(
                    category, role, context, selectedIds, slotTags, null, slotCalorieBudget - slotMacros.calories, true
                )
            }
            // Hard fallback for required roles: if strict weekly limits block all options,
            // allow a capped item rather than leaving the required role empty.
            // ignoreRepetition=true activates MANDATORY BYPASS which skips hasNameConflict,
            // ensuring mainDish (and other required roles) are ALWAYS filled.
            if (!food) {
                food = await this.selectBestFoodByRole(
                    category,
                    role,
                    context,
                    selectedIds,
                    slotTags,
                    null,
                    slotCalorieBudget - slotMacros.calories,
                    true,
                    true,
                    true,
                    true
                )
                if (food) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Required role '${role}' filled with cap bypass`, food.name)
                }
            }
            // ROLE MISMATCH GUARD: Reject food if its actual role doesn't match the requested role
            // This catches cases where lock/consistency returns bread for a mainDish request
            if (food && STANDARD_ROLES.includes(role)) {
                const actualRole = this.getCanonicalLockRole(food.role || '')
                const requestedRole = this.getCanonicalLockRole(role)
                if (actualRole !== requestedRole) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Role mismatch: requested '${role}' (${requestedRole}) but got '${food.name}' with role '${food.role}' (${actualRole}). Retrying with emergency mode...`)
                    // Retry with full emergency mode to bypass locks and find a correctly-typed food
                    food = await this.selectBestFoodByRole(
                        category, role, context, selectedIds, slotTags, null,
                        99999, true, true, true, true
                    )
                    // Verify the retry result also matches
                    if (food) {
                        const retryRole = this.getCanonicalLockRole(food.role || '')
                        if (retryRole !== requestedRole) {
                            this.log(context.dayIndex + 1, slotName, 'info', `Emergency retry also returned wrong role: '${food.name}' (${retryRole}). Giving up.`)
                            food = null
                        }
                    }
                }
            }
            if (food) {
                const foodRole = this.getCanonicalLockRole(food.role || '')
                if (foodRole && UNIQUE_SLOT_ROLES.has(foodRole) && selectedRoles.has(foodRole)) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Skipping duplicate unique role '${food.role}' in slot`)
                    continue
                }
                // AFFINITY GUARD: Block forbidden combinations within same slot
                if (this.hasForbiddenAffinityConflict(food, selectedFoods)) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Required role '${role}': Forbidden affinity blocked '${food.name}'`)
                    continue
                }
                selectedFoods.push(food)
                selectedIds.add(food.id)
                this.addFoodMacros(slotMacros, food)
                this.addFoodTags(slotTags, food)
                // Track canonical role
                if (foodRole) {
                    selectedRoles.add(foodRole)
                }

                // Store main dish for compatibility magnetism
                if (foodRole === 'maindish') {
                    context.slotMainDish = food
                }
                this.log(context.dayIndex + 1, slotName, 'select', `Required role '${role}' filled`, food.name)
                // Add source info
                const roleNames: Record<string, string> = {
                    mainDish: 'Ana Yemek',
                    sideDish: 'Yan Yemek',
                    salad: 'Salata',
                    soup: '\u00C7orba',
                    bread: 'Ekmek',
                    snack: 'Ara \u00D6\u011F\u00FCn',
                    dessert: 'Tatl\u0131',
                    drink: '\u0130\u00E7ecek',
                    fruit: 'Meyve'
                }
                let ruleName = roleNames[role] || role
                if (food._compatibilityMatchedTag) ruleName += ` (Uyumlu: ${this.capitalize(food._compatibilityMatchedTag)})`

                if (intersectedRule) {
                    let intersectedRuleName = intersectedRule.name || ruleName
                    if (food._compatibilityMatchedTag) {
                        intersectedRuleName += ` (Uyumlu: ${this.capitalize(food._compatibilityMatchedTag)})`
                    }
                    selectedFoods[selectedFoods.length - 1].source = this.decorateSourceWithLockMetadata(food, {
                        type: 'rule',
                        rule: intersectedRuleName,
                        rule_id: intersectedRule.id || undefined,
                        is_required_role: true,
                        required_role_name: role
                    })
                } else {
                    selectedFoods[selectedFoods.length - 1].source = this.decorateSourceWithLockMetadata(food, { 
                        type: 'required_role', 
                        rule: ruleName,
                        is_required_role: true,
                        required_role_name: role
                    })
                }
            } else {
                this.log(context.dayIndex + 1, slotName, 'info', `Could not fill required role '${role}'`)
            }
        }

        // 2. Rule-Based Roles - New Priority Logic (Multi-Pass)
        // `relevantRules` already filtered and sorted above.
        // PASS 1: MINIMUMS (Top to Bottom)
        // Satisfy the 'min_count' for every rule in order
        for (const rule of relevantRules) {
            const def = (rule.definition as any).data || rule.definition
            const forceInclusion = def.force_inclusion === true

            // CHECK 1: Max Items Limit (ABSOLUTE - never bypass, even for forced rules)
            if (selectedFoods.length >= config.maxItems) continue

            // Check Budget constraint (Strict unless forced)
            if (slotMacros.calories >= slotCalorieBudget && !forceInclusion) continue // changed from break to continue to allow searching for other forced rules? No, original was break. Let's keep strictness unless forced. Actually continue is safer for priority.

            const period = def.period || 'weekly'

            // Determine how many items we have vs how many needed
            const currentCount = this.countOccurrences(def.target, context, period)
            const needed = Math.max(0, (def.min_count || 0) - currentCount)

            // If this slot already contains the target (e.g. required-role intersection already satisfied it),
            // do not try to add the same target again in Pass 1.
            if ((def.target?.type === 'category' || def.target?.type === 'role')
                && selectedFoods.some((f: any) => this.matchesTarget(f, def.target))) {
                continue
            }

            if (needed > 0) {
                // Try to fill needed amount
                for (let k = 0; k < needed; k++) {
                    // Inner Loop Limit: Stop if maxItems reached (ABSOLUTE)
                    if (selectedFoods.length >= config.maxItems) break

                    // Prevention: Don't add multiple items for same Category/Role rule in the same slot
                    // UNLESS explicitly configured to have >1 min_count per_meal
                    if (k > 0 && (def.target.type === 'category' || def.target.type === 'role')) {
                        if (!(period === 'per_meal' && (def.min_count || 1) > 1)) {
                            break
                        }
                    }

                    // Allow budget overflow if force_inclusion is ON
                    if (slotMacros.calories >= slotCalorieBudget && !forceInclusion) {
                        this.log(context.dayIndex + 1, slotName, 'info', `Budget filled during Pass 1, stopping rule '${rule.name}'`)
                        break
                    }

                    // Extract role/category from target to facilitate selection
                    const targetType = def.target.type
                    const targetValue = def.target.value
                    let searchRole = 'sideDish' // Default fallback

                    if (targetType === 'role') searchRole = targetValue
                    else if (targetType === 'category') searchRole = targetValue

                    // UNIQUE ROLE CHECK: Skip if this role is already filled in the slot
                    const normalizedSearchRole = this.getCanonicalLockRole(searchRole || '')
                    if (UNIQUE_SLOT_ROLES.has(normalizedSearchRole) && selectedRoles.has(normalizedSearchRole)) {
                        this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Skipping rule '${rule.name}' - role '${searchRole}' already filled in slot`)
                        break
                    }

                    const food = await this.selectBestFoodByRole(
                        category, searchRole, context, selectedIds, slotTags, context.slotMainDish, slotCalorieBudget - slotMacros.calories, true, false, forceInclusion, forceInclusion
                    )
                    let selectedFood = food
                    if ((!selectedFood || !this.matchesTarget(selectedFood, def.target)) && (def.min_count || 0) > 0) {
                        // Hard fallback for minimum constraints (especially sideDish-like rules):
                        // relax repetition/budget/default-cap pressure but still respect seasonality,
                        // slot uniqueness and target matching.
                        const fallbackFood = await this.selectBestFoodByRole(
                            category,
                            searchRole,
                            context,
                            selectedIds,
                            slotTags,
                            context.slotMainDish,
                            99999,
                            true,
                            true,
                            true,
                            true
                        )
                        if (fallbackFood && this.matchesTarget(fallbackFood, def.target)) {
                            selectedFood = fallbackFood
                            this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Fallback fill for rule '${rule.name}'`, fallbackFood.name)
                        }
                    }

                    if (selectedFood && this.matchesTarget(selectedFood, def.target)) {
                        const food = selectedFood
                        const foodRole = this.getCanonicalLockRole(food.role || '')
                        if (foodRole && UNIQUE_SLOT_ROLES.has(foodRole) && selectedRoles.has(foodRole)) {
                            this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Duplicate unique role blocked for '${food.name}'`)
                            continue
                        }
                        // AFFINITY GUARD: Block forbidden combinations within same slot
                        if (this.hasForbiddenAffinityConflict(food, selectedFoods)) {
                            this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Forbidden affinity blocked '${food.name}' in slot with existing foods`)
                            continue
                        }
                        selectedFoods.push(food)
                        selectedIds.add(food.id)
                        this.addFoodMacros(slotMacros, food)
                        this.addFoodTags(slotTags, food)
                        // Track canonical role
                        if (foodRole) {
                            selectedRoles.add(foodRole)
                            if (foodRole === 'maindish' && !context.slotMainDish) {
                                context.slotMainDish = food
                            }
                        }
                        this.log(context.dayIndex + 1, slotName, 'select', `Pass 1 (Min): '${rule.name}' filled`, food.name)
                        // Add source info
                        let finalRuleName = rule.name
                        if (food._compatibilityMatchedTag) finalRuleName += ` (Uyumlu: ${this.capitalize(food._compatibilityMatchedTag)})`
                        selectedFoods[selectedFoods.length - 1].source = this.decorateSourceWithLockMetadata(food, { type: 'rule', rule: finalRuleName, rule_id: rule.id })
                        
                        if (food._rotationRuleId) {
                            const state = this.rotationStates.get(food._rotationRuleId)
                            if (state) state.sessionUsed.push(food.id)
                        }
                    } else {
                        this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Could not find food for rule '${rule.name}'`)
                    }
                }
            }
        }

        // PASS 2: FILLING (Round Robin Top to Bottom)
        // Continue looping until budget full or all rules satisfied up to max_count
        let madeProgress = true
        let loopCount = 0
        const MAX_LOOPS = 10 // Prevent infinite loops

        while (madeProgress && loopCount < MAX_LOOPS && selectedFoods.length < config.maxItems && slotMacros.calories < slotCalorieBudget) {
            madeProgress = false
            loopCount++

            for (const rule of relevantRules) {
                if (selectedFoods.length >= config.maxItems) break

                const def = (rule.definition as any).data || rule.definition
                const forceInclusion = def.force_inclusion === true

                if (slotMacros.calories >= slotCalorieBudget && !forceInclusion) break

                const period = def.period || 'weekly'
                const maxCount = def.max_count || 1;

                // Prevention: If we already added an item for this rule in THIS slot (Pass 2 iteration), skip
                // This checks if we just added one in the previous loop or this loop
                // "selectedFoods" contains what we added. we need to know if any of them resulted from THIS rule
                // Simpler: Just rely on logical distribution. 
                // However, since Pass 2 is "Filling" loop, it might loop again.
                // Critical check: Does this slot ALREADY have an item matching this target?
                // If target is specific (Category: Soup), strictly 1 per slot.
                if (def.target.type === 'category' || def.target.type === 'role') {
                    const hasInSlot = selectedFoods.some(f => this.matchesTarget(f, def.target))
                    if (hasInSlot) continue
                }

                const currentCount = this.countOccurrences(def.target, context, period)

                if (currentCount < maxCount) {
                    // We have room for more of this rule
                    // Extract search parameters
                    const targetType = def.target.type
                    const targetValue = def.target.value
                    let searchRole = 'sideDish'
                    if (targetType === 'role') searchRole = targetValue
                    else if (targetType === 'category') searchRole = targetValue

                    const normalizedSearchRole = this.getCanonicalLockRole(searchRole || '')
                    if (UNIQUE_SLOT_ROLES.has(normalizedSearchRole) && selectedRoles.has(normalizedSearchRole)) {
                        continue
                    }

                    const food = await this.selectBestFoodByRole(
                        category, searchRole, context, selectedIds, slotTags, context.slotMainDish, slotCalorieBudget - slotMacros.calories, true, false, forceInclusion, forceInclusion
                    )

                    if (food && this.matchesTarget(food, def.target)) {
                        const foodRole = this.getCanonicalLockRole(food.role || '')
                        if (foodRole && UNIQUE_SLOT_ROLES.has(foodRole) && selectedRoles.has(foodRole)) {
                            this.log(context.dayIndex + 1, slotName, 'info', `Pass 2: Duplicate unique role blocked for '${food.name}'`)
                            continue
                        }
                        // AFFINITY GUARD: Block forbidden combinations within same slot
                        if (this.hasForbiddenAffinityConflict(food, selectedFoods)) {
                            this.log(context.dayIndex + 1, slotName, 'info', `Pass 2: Forbidden affinity blocked '${food.name}' in slot with existing foods`)
                            continue
                        }
                        selectedFoods.push(food)
                        selectedIds.add(food.id)
                        this.addFoodMacros(slotMacros, food)
                        this.addFoodTags(slotTags, food)
                        if (foodRole) {
                            selectedRoles.add(foodRole)
                            if (foodRole === 'maindish' && !context.slotMainDish) {
                                context.slotMainDish = food
                            }
                        }
                        // Add source info
                        let finalRuleName = rule.name
                        if (food._compatibilityMatchedTag) finalRuleName += ` (Uyumlu: ${this.capitalize(food._compatibilityMatchedTag)})`
                        selectedFoods[selectedFoods.length - 1].source = this.decorateSourceWithLockMetadata(food, { type: 'rule_preferred', rule: finalRuleName, rule_id: rule.id })
                        this.log(context.dayIndex + 1, slotName, 'select', `Pass 2 (Preferred): '${rule.name}' filled`, food.name)
                        
                        if (food._rotationRuleId) {
                            const state = this.rotationStates.get(food._rotationRuleId)
                            if (state) state.sessionUsed.push(food.id)
                        }
                        madeProgress = true
                        // Break internal loop to ensure round-robin distribution? 
                        // User said: "Sonra 2. kurala bak... turlar atarsın"
                        // So yes, we check next rule, we don't spam this rule.
                    }
                }
            }
        }

        // 3. Optional Roles - Fill only if calorie budget allows and not yet at maxItems
        // FILTER: Only allow "solid" food roles for basic optional filling.
        // Drinks, Desserts, Snacks should ONLY be added via Rules or Top-Up logic, not random filling.
        const allOptionalRoles = config.optionalRoles.filter(r =>
            !['drink', 'dessert', 'snack', 'fruit', 'supplement'].includes(r)
        )
        // If we filtered everything out (e.g. config only had these), fallback to sideDish/salad
        if (allOptionalRoles.length === 0) {
            if (config.optionalRoles.includes('sideDish')) allOptionalRoles.push('sideDish')
            if (config.optionalRoles.includes('salad')) allOptionalRoles.push('salad')
        }

        // DEDUP: Remove roles already filled by fixed meals, weekly locks, or required roles
        const filledRoles = new Set(
            selectedFoods
                .map((f: any) => this.getCanonicalLockRole(f?.role || ''))
                .filter(Boolean)
        )
        const dedupedOptionalRoles = allOptionalRoles.filter(r => {
            const canonicalRole = this.getCanonicalLockRole(r || '')
            return !canonicalRole || !filledRoles.has(canonicalRole)
        })

        let attempts = 0
        const maxAttempts = 20

        while (selectedFoods.length < config.maxItems && attempts < maxAttempts && dedupedOptionalRoles.length > 0) {
            attempts++

            // BUDGET CHECK: Stop ONLY if minItems is satisfied AND we have enough calories
            // If we haven't reached minItems, we MUST continue (even if over budget)
            if (selectedFoods.length >= config.minItems && slotMacros.calories >= slotCalorieBudget * 0.9) {
                this.log(context.dayIndex + 1, slotName, 'info', `Budget reached (${Math.round(slotMacros.calories)}/${slotCalorieBudget}), stopping optional selection`)
                break
            }

            // Calculate remaining calorie budget for this slot
            // If under minItems, pretend we have budget to force selection
            let remainingCalories = slotCalorieBudget - slotMacros.calories
            if (selectedFoods.length < config.minItems) {
                remainingCalories = Math.max(remainingCalories, 200) // Ensure at least 200kcal "phantom budget" to pick something
            }

            // Pick a random optional role
            const roleIndex = Math.floor(Math.random() * dedupedOptionalRoles.length)
            const role = dedupedOptionalRoles[roleIndex] || 'sideDish'

            // 1. Try standard selection
            let food = await this.selectBestFoodByRole(
                category, role, context, selectedIds, slotTags, context.slotMainDish, remainingCalories, true
            )

            // 2. Fallback: Ignore Repetition/Budget if failed AND (required OR under minItems)
            if (!food && (selectedFoods.length < config.minItems)) {
                this.log(context.dayIndex + 1, slotName, 'info', `Force fallback for minItems: '${role}'`)
                food = await this.selectBestFoodByRole(
                    category, role, context, selectedIds, slotTags, context.slotMainDish,
                    99999, // Unlimited budget for fallback
                    true, // isRequired
                    true, // ignoreRepetition
                    false // ignoreBudget (Default)
                )
            }

            if (food) {
                const foodRole = this.getCanonicalLockRole(food.role || '')
                if (foodRole && UNIQUE_SLOT_ROLES.has(foodRole) && selectedRoles.has(foodRole)) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Optional: Duplicate unique role blocked for '${food.name}'`)
                    dedupedOptionalRoles.splice(roleIndex, 1)
                    continue
                }
                // Only add if it fits within remaining budget (allow small overflow)
                if (food.calories <= remainingCalories * 1.3 || selectedFoods.length < config.minItems) {
                    selectedFoods.push(food)
                    selectedIds.add(food.id)
                    this.addFoodMacros(slotMacros, food)
                    this.addFoodTags(slotTags, food)
                    if (foodRole) {
                        selectedRoles.add(foodRole)
                        if (foodRole === 'maindish' && !context.slotMainDish) {
                            context.slotMainDish = food
                        }
                    }
                    this.log(context.dayIndex + 1, slotName, 'select', `Optional role '${role}' selected`, food.name)
                    // Add source info
                    const roleNames: Record<string, string> = {
                        sideDish: 'Yan Yemek',
                        salad: 'Salata',
                        soup: '\u00C7orba',
                        bread: 'Ekmek',
                        snack: 'Ara \u00D6\u011F\u00FCn',
                        dessert: 'Tatl\u0131',
                        drink: '\u0130\u00E7ecek',
                        fruit: 'Meyve'
                    }
                    let ruleName = roleNames[role] || role
                    if (food._compatibilityMatchedTag) ruleName += ` (Uyumlu: ${this.capitalize(food._compatibilityMatchedTag)})`
                    selectedFoods[selectedFoods.length - 1].source = this.decorateSourceWithLockMetadata(food, { type: 'optional_round_robin', rule: ruleName })
                } else {
                    // Food is too caloric, try to find a lower calorie alternative
                    this.log(context.dayIndex + 1, slotName, 'reject', `Optional food over budget or limits`, food.name)
                    break
                }
            } else {
                // No more foods of this role, remove from options
                dedupedOptionalRoles.splice(roleIndex, 1)
                if (dedupedOptionalRoles.length === 0) break
            }
        }

        // 3. Filler Logic - ONLY if we have significant deficit AND calorie budget remains
        const proteinRatio = slotMacros.protein / (context.slotTargetMacros?.protein || 30)
        const fatRatio = slotMacros.fat / (context.slotTargetMacros?.fat || 20)
        const caloriesRemaining = slotCalorieBudget - slotMacros.calories

        if ((proteinRatio < 0.7 || fatRatio < 0.7) && caloriesRemaining > 50 && selectedFoods.length < config.maxItems) {
            const fillerFood = await this.selectFillerFood(
                slotName, context, selectedIds, slotTags, slotMacros, caloriesRemaining
            )
            if (fillerFood && fillerFood.calories <= caloriesRemaining * 1.3) {
                const fillerRole = this.getCanonicalLockRole(fillerFood.role || '')
                if (fillerRole && UNIQUE_SLOT_ROLES.has(fillerRole) && selectedRoles.has(fillerRole)) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Filler skipped due to duplicate unique role: '${fillerFood.name}'`)
                } else {
                    selectedFoods.push(fillerFood)
                    if (fillerRole) {
                        selectedRoles.add(fillerRole)
                        if (fillerRole === 'maindish' && !context.slotMainDish) {
                            context.slotMainDish = fillerFood
                        }
                    }
                    // Add source info
                    const deficitName = proteinRatio < 0.7 ? 'Protein' : 'Yağ'
                    selectedFoods[selectedFoods.length - 1].source = { 
                        type: 'fill_macro_deficit', 
                        rule: `${deficitName} Dengeleyici`,
                        rule_id: deficitName === 'Protein' ? 'system_protein_filler' : 'system_fat_filler'
                    }
                    this.log(context.dayIndex + 1, slotName, 'select', `Filler food selected for ${deficitName.toLowerCase()} deficit`, fillerFood.name)
                }
            }
        }

        if (selectedFoods.length < config.minItems) {
            const emergencyRoles = ['maindish', 'sideDish', 'salad', 'soup', 'bread', 'drink', 'fruit', 'snack', 'dessert']
            let guard = 0
            while (selectedFoods.length < config.minItems && guard < 16) {
                guard++
                let added = false
                for (const emergencyRole of emergencyRoles) {
                    const emergencyRoleNorm = this.getCanonicalLockRole(emergencyRole || '')
                    if (emergencyRoleNorm && UNIQUE_SLOT_ROLES.has(emergencyRoleNorm) && selectedRoles.has(emergencyRoleNorm)) {
                        continue
                    }

                    // If we've tried all options once (guard > length), drop tag conflict rules to guarantee fill
                    const effectiveSlotTags = guard > emergencyRoles.length ? new Set<string>() : slotTags;

                    const emergencyFood = await this.selectBestFoodByRole(
                        category,
                        emergencyRole,
                        context,
                        selectedIds,
                        effectiveSlotTags,
                        context.slotMainDish,
                        99999,
                        true,
                        true,
                        true,
                        true
                    )
                    if (!emergencyFood) continue

                    const foodRole = this.getCanonicalLockRole(emergencyFood.role || '')
                    if (foodRole && UNIQUE_SLOT_ROLES.has(foodRole) && selectedRoles.has(foodRole)) continue

                    selectedFoods.push(emergencyFood)
                    selectedIds.add(emergencyFood.id)
                    this.addFoodMacros(slotMacros, emergencyFood)
                    this.addFoodTags(slotTags, emergencyFood)
                    if (foodRole) {
                        selectedRoles.add(foodRole)
                        if (foodRole === 'maindish' && !context.slotMainDish) {
                            context.slotMainDish = emergencyFood
                        }
                    }
                    selectedFoods[selectedFoods.length - 1].source = this.decorateSourceWithLockMetadata(emergencyFood, {
                        type: 'required_role',
                        rule: 'Min Öğün Satırı'
                    })
                    this.log(context.dayIndex + 1, slotName, 'select', `Emergency minItems fill`, emergencyFood.name)
                    added = true
                    break
                }
                // Only break if we failed to add AND we already tried without tag constraints
                if (!added && guard > emergencyRoles.length) break
            }
        }
        // 4. LAST RESORT: MANDATORY MAIN DISH ENFORCEMENT
        // If this is a Lunch or Dinner slot and we STILL don't have a main dish, 
        // try one more time ignoring EVERYTHING because it is the most important rule.
        const isLunchOrDinner = slotName === 'ÖĞLEN' || slotName === 'AKŞAM'
        if (isLunchOrDinner && !context.slotMainDish) {
            this.log(context.dayIndex + 1, slotName, 'info', `Last-resort mandatory main dish search...`)
            // Use minimal exclude set: only exclude foods already selected as mainDish in this slot
            // Don't pass slotTags to avoid tag conflict false negatives
            const mainDishExcludeIds = new Set<string>()
            for (const f of selectedFoods) {
                if (this.getCanonicalLockRole(f?.role || '') === 'maindish') {
                    mainDishExcludeIds.add(f.id)
                }
            }
            // Also exclude daily-selected IDs to avoid same food in multiple slots on same day
            for (const id of context.dailySelectedIds) {
                mainDishExcludeIds.add(id)
            }
            const forcedMain = await this.selectBestFoodByRole(
                category, 'mainDish', context, mainDishExcludeIds, new Set<string>(), null, 99999, true, true, true, true, true
            )
            if (forcedMain) {
                const forcedRole = this.getCanonicalLockRole(forcedMain.role || '')
                // Only accept if it's actually a mainDish food, not bread/soup/etc
                if (forcedRole === 'maindish') {
                    selectedFoods.push(forcedMain)
                    context.slotMainDish = forcedMain
                    if (forcedRole) selectedRoles.add(forcedRole)
                    this.log(context.dayIndex + 1, slotName, 'select', `Forced mandatory main dish selected`, forcedMain.name)
                    selectedFoods[selectedFoods.length - 1].source = { 
                        type: 'mandatory_override', 
                        rule: 'Ana Yemek Zorunlu',
                        is_required_role: true,
                        required_role_name: 'mainDish'
                    }
                } else {
                    this.log(context.dayIndex + 1, slotName, 'info', `Last-resort returned '${forcedMain.name}' but role is '${forcedMain.role}' (${forcedRole}), not mainDish. Skipped.`)
                }
            } else {
                this.log(context.dayIndex + 1, slotName, 'info', `Last-resort mandatory main dish search FAILED: no candidates found. Eligible maindish count: ${this.eligibleFoods.filter(f => this.getCanonicalLockRole(f.role || '') === 'maindish').length}`)
            }
        }
        // ===== 5. AFFINITY INJECTION PASS =====
        // When a trigger food is present and the affinity slider is >= 80% (or old mandatory),
        // actively inject the outcome food into each slot if it's not already there.
        // NOTE: This pass allows maxItems+1 overflow and skips tag conflict checks
        // because mandatory injection must succeed if at all possible.
        for (const rule of this.rules) {
            if (rule.rule_type !== 'affinity' || !rule.is_active) continue
            // Allow maxItems+1 for mandatory injection (don't break early)
            if (selectedFoods.length >= config.maxItems + 2) break

            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef
            if (!def.trigger || !def.outcome) continue

            // Determine injection threshold
            let shouldInject = false
            if (def.association) {
                // Old format: only inject for 'mandatory'
                if (def.association === 'mandatory') shouldInject = true
            } else {
                // New format: inject when slider >= 80
                const prob = Math.max(0, Math.min(100, Number(def.probability ?? 50)))
                if (prob >= 80) shouldInject = true
            }
            if (!shouldInject) continue

            const isTwoWay = def.direction === 'two-way' || def.direction === undefined

            // Check if trigger is present in this slot
            const triggerPresent = selectedFoods.some((f: any) => this.matchesTarget(f, def.trigger))
            const outcomePresent = selectedFoods.some((f: any) => this.matchesTarget(f, def.outcome))

            // Bidirectional: also check reverse
            const reverseTriggerPresent = isTwoWay && selectedFoods.some((f: any) => this.matchesTarget(f, def.outcome))
            const reverseOutcomePresent = isTwoWay && selectedFoods.some((f: any) => this.matchesTarget(f, def.trigger))

            const needsForward = triggerPresent && !outcomePresent
            const needsReverse = reverseTriggerPresent && !reverseOutcomePresent

            if (!needsForward && !needsReverse) continue

            // Find and inject the missing outcome food
            const targetToInject = needsForward ? def.outcome : def.trigger

            // Collect daily used IDs to avoid duplicates across slots
            const dailyUsedIds = new Set(context.dailySelectedIds || [])

            const injectionCandidates = this.eligibleFoods.filter((f: any) => {
                if (!this.matchesTarget(f, targetToInject)) return false
                if (selectedIds.has(f.id)) return false
                if (dailyUsedIds.has(f.id)) return false
                if (!this.isMealTypeCompatibleWithSlot(f, slotName)) return false
                if (!this.checkSeasonalityHard(f, context.currentDate || this.today)) return false
                const weekCount = context.weeklySelectedIds?.get(f.id) || 0
                if (this.hasReachedWeeklyCap(f, weekCount)) return false
                // Check effective priority
                const overrideScore = this.settings?.food_score_overrides?.[f.id]
                if (overrideScore === 0) return false
                // UNIQUE ROLE GUARD: Don't inject if the food's role is already filled
                const candidateRole = this.getCanonicalLockRole(f.role || '')
                const UNIQUE_ROLES = new Set(['maindish', 'soup', 'bread', 'salad'])
                if (candidateRole && UNIQUE_ROLES.has(candidateRole) && selectedRoles.has(candidateRole)) return false
                // NOTE: Tag conflict check intentionally SKIPPED for mandatory injection.
                // The whole point is to force the food in regardless of tag overlap.
                // STRICT CATEGORY CHECK: For category targets, ensure the food's actual
                // category or role matches — don't rely on name-contains fallback
                if (targetToInject.type === 'category') {
                    const tVal = normalizeCategory(targetToInject.value)
                    const fCat = normalizeCategory(f.category || '')
                    const fRole = normalizeCategory(f.role || '')
                    if (fCat !== tVal && fRole !== tVal) return false
                }
                return true
            })

            if (injectionCandidates.length === 0) {
                this.log(context.dayIndex + 1, slotName, 'info', `Affinity injection: No candidates found for '${rule.name}'`)
                continue
            }

            // Pick the best candidate (highest priority, lowest weekly usage)
            injectionCandidates.sort((a: any, b: any) => {
                const prioA = this.settings?.food_score_overrides?.[a.id] ?? a.priority_score ?? 5
                const prioB = this.settings?.food_score_overrides?.[b.id] ?? b.priority_score ?? 5
                const usageA = context.weeklySelectedIds?.get(a.id) || 0
                const usageB = context.weeklySelectedIds?.get(b.id) || 0
                if (prioA !== prioB) return prioB - prioA
                return usageA - usageB
            })

            const injected = injectionCandidates[0]
            selectedFoods.push(injected)
            selectedIds.add(injected.id)
            this.addFoodMacros(slotMacros, injected)
            this.addFoodTags(slotTags, injected)

            const foodRole = this.getCanonicalLockRole(injected.role || '')
            if (foodRole) {
                selectedRoles.add(foodRole)
            }

            selectedFoods[selectedFoods.length - 1].source = {
                type: 'affinity_injection',
                rule: `Bağımlılık: ${rule.name || 'Affinity'}`
            }

            this.log(context.dayIndex + 1, slotName, 'select', `Affinity injection: '${rule.name}' triggered`, injected.name)
        }
        // ===== END AFFINITY INJECTION =====

        return selectedFoods
    }

    /**
     * Select the best food for a specific category and role
     * @param calorieBudget - Optional remaining calorie budget for this slot
     */
    private async selectBestFoodByRole(
        category: string,
        role: string,
        context: any,
        excludeIds: Set<string>,
        slotTags: Set<string>,
        mainDish: any | null,
        calorieBudget?: number,
        isRequired: boolean = true,
        ignoreRepetition: boolean = false,
        ignoreBudget: boolean = false,
        allowWeeklyCapBypass: boolean = false,
        allowMealTypeBypass: boolean = false
    ): Promise<any | null> {
        // Normalize role names (e.g. 'corba' from UI -> 'soup' in DB)
        if (role === 'corba') role = 'soup'
        const lockRole = this.getCanonicalLockRole(role || '')
        const requestedRoleNorm = lockRole

        // Helper: check if a food's meal_types allows it in this slot
        const requiredMealType = this.getRequiredMealTypeForSlot(category)

        const isMealTypeCompatible = (food: any): boolean => {
            if (!requiredMealType) return true
            // meal_types is a food-level hard constraint - NEVER bypass, even for emergency fills
            let foodMealTypes: string[] | null = null
            if (Array.isArray(food.meal_types)) foodMealTypes = food.meal_types
            else if (typeof food.meal_types === 'string') {
                try { foodMealTypes = JSON.parse(food.meal_types) } catch { foodMealTypes = [food.meal_types] }
            }
            // If meal_types is defined and non-empty, food must match the slot
            if (foodMealTypes && foodMealTypes.length > 0) {
                const reqLower = requiredMealType.toLowerCase().replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/\s+/g, '')
                const hasMatch = foodMealTypes.some(t => {
                    if (typeof t !== 'string') return false
                    const normT = t.toLowerCase().replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/\s+/g, '')
                    if (normT === reqLower) return true
                    if (reqLower.includes('ogle') && normT.includes('ogle')) return true
                    if (reqLower.includes('aksam') && normT.includes('aksam')) return true
                    if (reqLower.includes('kahvalt') && normT.includes('kahvalt')) return true
                    if (reqLower.includes('ara') && normT.includes('ara')) return true

                    // Relax mainDish constraint: allow lunch/dinner mixing ONLY on absolute last resort fallback
                    if (allowMealTypeBypass && role === 'mainDish') {
                        const reqIsLunchOrDinner = reqLower === 'lunch' || reqLower === 'dinner' || reqLower.includes('ogle') || reqLower.includes('aksam')
                        const normIsLunchOrDinner = normT === 'lunch' || normT === 'dinner' || normT.includes('ogle') || normT.includes('aksam')
                        if (reqIsLunchOrDinner && normIsLunchOrDinner) return true
                    }

                    return false
                })
                // No debug logs needed anymore, the logic is sound.
                return hasMatch
            }
            return true // No meal_types restriction
        }

        // Helper: verify food's actual role matches the requested role
        // This prevents rotation/lock/consistency from returning bread for mainDish requests
        const isRoleMatch = (food: any): boolean => {
            // Check slot-level bans passed via context BEFORE allowing a match
            if (context.currentBannedRoles && context.currentBannedRoles.length > 0) {
                const foodRoleNorm = this.getCanonicalLockRole(food.role || '')
                if (context.currentBannedRoles.includes(foodRoleNorm)) return false
            }
            if (context.currentBannedTags && context.currentBannedTags.length > 0 && Array.isArray(food.tags)) {
                if (food.tags.some((t: string) => typeof t === 'string' && context.currentBannedTags.includes(t.toLowerCase()))) return false
            }

            if (!STANDARD_ROLES.includes(role)) return true // Skip check for non-standard roles
            const foodRoleNorm = this.getCanonicalLockRole(food.role || '')
            return foodRoleNorm === requestedRoleNorm
        }

        // ROTATION GENERATOR CHECK: Always overrides default weekly locks
        const eligibleFoodIds = new Set(this.eligibleFoods.map(f => f.id))
        const rotationMatch = this.getNextRotationFood(category, lockRole, context, eligibleFoodIds, excludeIds, slotTags, isMealTypeCompatible)
        if (rotationMatch && isRoleMatch(rotationMatch.food)) {
            return {
                ...rotationMatch.food,
                _consistencyRuleId: rotationMatch.state.ruleId,
                _consistencyRuleName: rotationMatch.state.ruleName,
                _rotationRuleId: rotationMatch.state.ruleId
            }
        }

        // In mandatory emergency mode, skip lock-based early returns
        // so we always fall through to the full candidate pool
        const isMandatoryEmergency = isRequired && ignoreBudget && ignoreRepetition

        // Weekly Lock Check: If this role is lockable and already has a locked food, use it
        // BUT respect meal_types - don't return a dinner-only soup for lunch!
        const hasWeeklyLockForRole = this.weeklyLocks.has(lockRole) || (lockRole === 'soup' && this.weeklyLocks.has('corba'))
        
        if (hasWeeklyLockForRole && !isMandatoryEmergency) {
            const lockedFood = this.weeklyLocks.get(lockRole) || (lockRole === 'soup' ? this.weeklyLocks.get('corba') : null)
            if (!lockedFood) return null
            if (!excludeIds.has(lockedFood.id) && isMealTypeCompatible(lockedFood) && !this.hasTagConflict(lockedFood, slotTags) && isRoleMatch(lockedFood)) {
                let lockReason = this.getWeeklyLockReason(lockRole)
                if (!lockReason) {
                    const inferredLock = this.getLockedFood(category, role, context)
                    if (inferredLock && inferredLock.id === lockedFood.id && inferredLock._consistencyRuleName) {
                        lockReason = {
                            ruleId: inferredLock._consistencyRuleId || null,
                            ruleName: inferredLock._consistencyRuleName
                        }
                        this.setWeeklyLockReason(lockRole, lockReason.ruleId, lockReason.ruleName)
                    }
                }
                if (lockReason) {
                    const finalFood = {
                        ...lockedFood,
                        _consistencyRuleId: lockReason.ruleId,
                        _consistencyRuleName: lockReason.ruleName
                    }
                    this.commitRotationFood(finalFood)
                    return finalFood
                }
                this.commitRotationFood(lockedFood)
                return lockedFood
            } else if (this.hasTagConflict(lockedFood, slotTags)) {
                // If the locked food conflicts with current slot tags, we CANNOT use this locked food in this slot.
                // We also shouldn't pick a different food because that breaks the lock.
                return null
            }
        }

        // CONSISTENCY RULE CHECK (Dynamically Locked Foods)
        // In mandatory emergency mode, skip this to fall through to candidate pool
        if (!isMandatoryEmergency) {
            const consistencyLockedFood = this.getLockedFood(category, role, context)
            if (consistencyLockedFood) {
                if (excludeIds.has(consistencyLockedFood.id)) {
                    return null
                }
                const isSeasonal = this.checkSeasonalityHard(consistencyLockedFood, context.currentDate)
                if (isSeasonal && isMealTypeCompatible(consistencyLockedFood) && isRoleMatch(consistencyLockedFood)) {
                    if (this.hasTagConflict(consistencyLockedFood, slotTags)) {
                        // Locked food has a tag conflict in this slot, abort adding to this slot
                        return null
                    }
                    const consistencyLockRole = this.getCanonicalLockRole(consistencyLockedFood.role || role || '')
                    if (Planner.LOCKABLE_ROLES.includes(consistencyLockRole) && !this.weeklyLocks.has(consistencyLockRole)) {
                        this.weeklyLocks.set(consistencyLockRole, consistencyLockedFood)
                        if (consistencyLockRole === 'soup') {
                            this.weeklyLocks.set('corba', consistencyLockedFood)
                        }
                    }
                    if (consistencyLockedFood?._consistencyRuleName) {
                        this.setWeeklyLockReason(
                            consistencyLockRole,
                            consistencyLockedFood._consistencyRuleId || null,
                            consistencyLockedFood._consistencyRuleName
                        )
                    }
                    this.commitRotationFood(consistencyLockedFood)
                    return consistencyLockedFood
                }
            }
        }

        // Map slot names to meal_types values already defined above

        // Filter candidates by category, role, AND meal_types
        // Special roles have their own categories (EKMEKLER, KURUYEMİÅLER, ÇORBALAR) that don't match slot categories
        const specialRoles = ['snack', 'bread', 'corba', 'soup', 'fruit', 'dessert', 'salad', 'drink', 'supplement']
        const isSpecialRole = specialRoles.includes(role) || !STANDARD_ROLES.includes(role)

        let candidates = this.eligibleFoods.filter(f => {
            if (STANDARD_ROLES.includes(role)) {
                const foodRoleNorm = this.getCanonicalLockRole(f.role || '')
                if (foodRoleNorm !== requestedRoleNorm) return false
            } else {
                const targetNorm = normalizeCategory(role || '')
                const catMatch = normalizeCategory(f.category || '') === targetNorm
                const roleMatch = normalizeCategory(f.role || '') === targetNorm
                if (!catMatch && !roleMatch) return false
            }

            if (excludeIds.has(f.id)) {
                return false
            }
            
            // -- NEW: Slot Config Banned Checking (Passed via context from selectFoodsForSlot) --
            if (context.currentBannedRoles && context.currentBannedRoles.length > 0) {
                const foodRoleNorm = this.getCanonicalLockRole(f.role || '')
                if (context.currentBannedRoles.includes(foodRoleNorm)) {
                    return false
                }
            }
            if (context.currentBannedTags && context.currentBannedTags.length > 0 && Array.isArray(f.tags)) {
                if (f.tags.some((t: string) => typeof t === 'string' && context.currentBannedTags.includes(t.toLowerCase()))) {
                    return false
                }
            }
            // ---------------------------------------------------------------------------------
            
            // -- NEW: Exclusive Scope Daily Bans --
            const dayOfWeek = (context.dayIndex ?? 0) + 1
            if (this.dailyBannedTargetsMap?.has(dayOfWeek)) {
                const dayBans = this.dailyBannedTargetsMap.get(dayOfWeek)!
                for (const target of dayBans) {
                    if (this.matchesTarget(f, target)) {
                        return false
                    }
                }
            }
            // ------------------------------------

            // MANDATORY BYPASS: If we are in emergency/mandatory mode, ignore almost everything else
            // BUT still respect the food's OWN max_weekly_freq (not rule-level frequency limits)
            if (isRequired && ignoreBudget && ignoreRepetition) {
                const explicitMax = this.getExplicitMaxWeeklyFreq(f)
                if (explicitMax !== null) {
                    const weeklyCount = context.weeklySelectedIds?.get(f.id) || 0
                    if (weeklyCount >= explicitMax) return false
                }
                return isMealTypeCompatible(f)
            }

            // Normal filters
            if (!ignoreRepetition && context.dailySelectedIds.has(f.id)) {
                return false
            }
            if (this.hasTagConflict(f, slotTags)) {
                return false
            }
            if (this.hasNameConflict(f, context)) {
                return false
            }
            if (!this.checkSeasonalityHard(f, context.currentDate)) {
                return false
            }
            if (this.hasReachedFrequencyRuleMaxForFood(f, context)) {
                return false
            }
            if (!isMealTypeCompatible(f)) {
                return false
            }

            return true
        })

        // *** HARD MACRO CEILING: Reject foods that would push daily macro > 120% of target ***
        if (context.dailyMacros && context.dailyTarget && candidates.length > 1) {
            const dM = context.dailyMacros
            const dT = context.dailyTarget
            const ceilingFiltered = candidates.filter(f => {
                const projFat = dM.fat + (f.fat || 0)
                const projCarbs = dM.carbs + (f.carbs || 0)
                if (dT.fat > 0 && projFat > dT.fat * 1.20) return false
                if (dT.carbs > 0 && projCarbs > dT.carbs * 1.20) return false
                return true
            })
            // Only apply if we still have candidates; otherwise fall back to unfiltered
            if (ceilingFiltered.length > 0) {
                candidates = ceilingFiltered
            }
        }

        // *** STRICT ROLE LIMIT CHECK (PREVENT DUPLICATES OF UNIQUE ROLES) *** 
        // Build a set of unique roles already present in this slot
        const slotUniqueRoles = new Set<string>()
        if (context.slotSelectedFoods) {
            for (const f of context.slotSelectedFoods) {
                const canonicalRole = this.getCanonicalLockRole(f?.role || '')
                if (canonicalRole) slotUniqueRoles.add(canonicalRole)
            }
        }
        const UNIQUE_ROLES_TO_BLOCK = new Set(['maindish', 'soup', 'bread', 'salad'])

        candidates = candidates.filter(f => {
            if (!f.role) return true
            const fr = this.getCanonicalLockRole(f.role || '')
            // Hard block: unique slot roles can appear only once per slot.
            if (fr && UNIQUE_ROLES_TO_BLOCK.has(fr) && slotUniqueRoles.has(fr)) {
                return false
            }
            return true
        })

        if (candidates.length === 0) {
            // Fallback: keep target semantics (role/category) but relax only hard-cap pressure paths.
            candidates = this.eligibleFoods.filter(f => {
                if (STANDARD_ROLES.includes(role)) {
                    const foodRoleNorm = this.getCanonicalLockRole(f.role || '')
                    if (foodRoleNorm !== requestedRoleNorm) return false
                } else {
                    const targetNorm = normalizeCategory(role || '')
                    const catMatch = normalizeCategory(f.category || '') === targetNorm
                    const roleMatch = normalizeCategory(f.role || '') === targetNorm
                    if (!catMatch && !roleMatch) return false
                }

                if (excludeIds.has(f.id)) return false

                // -- NEW: Exclusive Scope Daily Bans --
                const fallbackDayOfWeek = (context.dayIndex ?? 0) + 1
                if (this.dailyBannedTargetsMap?.has(fallbackDayOfWeek)) {
                    const dayBans = this.dailyBannedTargetsMap.get(fallbackDayOfWeek)!
                    for (const target of dayBans) {
                        if (this.matchesTarget(f, target)) return false
                    }
                }
                // ------------------------------------

                // MANDATORY BYPASS: In fallback mode, ignore almost everything else
                if (isRequired && ignoreBudget && ignoreRepetition) {
                    return isMealTypeCompatible(f)
                }

                if (this.hasTagConflict(f, slotTags)) return false
                if (this.hasNameConflict(f, context)) return false
                if (!this.checkSeasonalityHard(f, context.currentDate)) return false
                if (this.hasReachedFrequencyRuleMaxForFood(f, context)) return false
                if (!ignoreRepetition && context.dailySelectedIds.has(f.id)) return false
                if (!isMealTypeCompatible(f)) return false

                return true
            })

            // Re-apply Strict Unique Role limit to fallback candidates
            candidates = candidates.filter(f => {
                if (!f.role) return true
                const fr = this.getCanonicalLockRole(f.role || '')
                if (fr && UNIQUE_ROLES_TO_BLOCK.has(fr) && slotUniqueRoles.has(fr)) {
                    return false
                }
                return true
            })
        }

        if (candidates.length === 0) return null

        // ── LAYER 1: HARD LIMIT FILTER ──
        // Remove foods that have reached their max_weekly_freq
        const varietyMode = this.settings?.variety_mode || 'hybrid'
        const maxWeeklyDefault = this.settings?.max_weekly_default || 3
        const filteredByLimit = candidates.filter(f => {
            const weeklyCount = context.weeklySelectedIds?.get(f.id) || 0
            if (this.hasReachedWeeklyCap(f, weeklyCount)) {
                // Exception: if a rule explicitly targets this SPECIFIC food, allow it to bypass limits
                const hasExplicitFoodRule = this.rules.some((rule: any) => {
                    const def = rule.definition?.data || rule.definition;
                    if (rule.rule_type === 'frequency' && def?.target?.type === 'food_id' && def.target.value === f.id) {
                        return def.min_count && def.min_count > weeklyCount;
                    }
                    return false;
                })
                if (hasExplicitFoodRule) {
                    this.log(context.dayIndex + 1, context.slotName || '?', 'info', `Bypassing frequency limit for '${f.name}' due to explicit rule.`)
                    return true
                }
                return false
            }
            return true
        })

        const candidatesBeforeWeeklyCap = [...candidates] // Preserve for emergency fallback
        const allHitWeeklyCap = candidates.length > 0 && filteredByLimit.length === 0
        const bypassableByDefaultCap = allHitWeeklyCap
            ? candidates.filter(f => this.getExplicitMaxWeeklyFreq(f) === null)
            : []
        if (allHitWeeklyCap) {
            if (allowWeeklyCapBypass) {
                if (bypassableByDefaultCap.length > 0) {
                    this.log(
                        context.dayIndex + 1,
                        context.slotName || '?',
                        'info',
                        `All candidates for role '${role}' hit frequency limit (${maxWeeklyDefault}); bypassing only default cap for mandatory fill.`
                    )
                } else {
                    this.log(
                        context.dayIndex + 1,
                        context.slotName || '?',
                        'info',
                        `All candidates for role '${role}' hit explicit weekly limits; mandatory bypass disabled.`
                    )
                }
            } else {
                this.log(context.dayIndex + 1, context.slotName || '?', 'info', `All candidates for role '${role}' hit frequency limit (${maxWeeklyDefault}).`)
            }
        }
        candidates = (allowWeeklyCapBypass && allHitWeeklyCap) ? bypassableByDefaultCap : filteredByLimit
        
        // ── EMERGENCY TIER 3: Full weekly cap bypass for mandatory roles ──
        // When ALL candidates hit explicit weekly limits AND we're in full mandatory mode,
        // bypass ALL weekly caps. The required role (e.g. mainDish) is more important than
        // frequency limits — a repeated food is better than an empty slot.
        if (candidates.length === 0 && allHitWeeklyCap && isRequired && ignoreBudget && ignoreRepetition) {
            // Only restore candidates WITHOUT explicit user-set frequency limits
            // User-set limits (max_weekly_freq) are sacred and should not be bypassed
            const bypassableEmergency = candidatesBeforeWeeklyCap.filter(f => this.getExplicitMaxWeeklyFreq(f) === null)
            if (bypassableEmergency.length > 0) {
                candidates = bypassableEmergency
            } else {
                // ALL have explicit limits — as absolute last resort, use all candidates
                candidates = [...candidatesBeforeWeeklyCap]
            }
            this.log(
                context.dayIndex + 1,
                context.slotName || '?',
                'info',
                `EMERGENCY: All weekly caps bypassed for mandatory role '${role}' (${candidatesBeforeWeeklyCap.length} candidates restored).`
            )
        }

        if (candidates.length === 0 && allHitWeeklyCap) {
             this.log(context.dayIndex + 1, context.slotName || '?', 'info', `Role '${role}': No candidates left after weekly cap (Max: ${maxWeeklyDefault}).`)
        }

        if (candidates.length === 0) {
            if (isRequired) {
                this.log(context.dayIndex + 1, context.slotName || '?', 'info', `Role '${role}': No candidates found after hard filters (Tag conflict: ${slotTags.size > 0}, Repetition: ${!ignoreRepetition}, MealType: ${!!requiredMealType})`)
            }
            return null
        }

        // ── PRIORITY SCORE FILTER ──
        // Foods with effective priority_score === 0 are excluded entirely
        const getEffectivePriority = (f: any): number => {
            if (this.settings?.food_score_overrides && f.id in this.settings.food_score_overrides) {
                return this.settings.food_score_overrides[f.id]
            }
            return f.priority_score ?? 5
        }
        const filteredByScore = candidates.filter(f => getEffectivePriority(f) > 0)
        if (candidates.length > 0 && filteredByScore.length === 0) {
            // In mandatory emergency mode, keep all candidates even with score 0
            if (isRequired && ignoreBudget && ignoreRepetition) {
                this.log(context.dayIndex + 1, context.slotName || '?', 'info', `All candidates for role '${role}' have score 0. MANDATORY BYPASS: keeping ${candidates.length} candidates.`)
                // Don't filter — keep all candidates
            } else {
                this.log(context.dayIndex + 1, context.slotName || '?', 'info', `All candidates for role '${role}' have score 0.`)
                candidates = filteredByScore
            }
        } else {
            candidates = filteredByScore
        }
        if (candidates.length === 0) return null

        // ── LAYER 2 & 3: COOLDOWN + LIKED BOOST SCORING ──
        const cooldownStrength = this.settings?.cooldown_strength ?? 5
        const likedBoost = this.settings?.liked_boost ?? 3000

        // Helper: calculate variety penalty for a food
        const calcVarietyScore = (food: any): number => {
            const weeklyCount = context.weeklySelectedIds?.get(food.id) || 0
            const ruleScore = this.applyRuleScores(food, context)
            let penalty = 0

            if (ignoreRepetition) {
                // Fallback mode: no penalty
            } else if (varietyMode === 'off') {
                penalty = weeklyCount * 500
            } else {
                // New: Exponential cooldown
                if (ruleScore > 1000) {
                    penalty = (weeklyCount ** 2) * cooldownStrength * 150 * 0.3
                } else {
                    penalty = (weeklyCount ** 2) * cooldownStrength * 150
                }
            }

            // NEW: Cross-week historical penalty (Rotation)
            const historicalCount = this.historicalFoodCounts?.get(food.id) || 0
            if (historicalCount > 0 && this.historicalAvgUsage > 0 && varietyMode !== 'off') {
                const relativeUsage = historicalCount / this.historicalAvgUsage
                penalty += Math.floor(relativeUsage * 300)
            }

            // NEW: Consecutive Day Penalty
            if (!ignoreRepetition && varietyMode !== 'off') {
                const exemptWords = this.settings?.variety_exempt_words || []
                const foodNameLower = (food.name || '').toLowerCase()
                const isExempt = exemptWords.some((word: string) => foodNameLower.includes(word.toLowerCase()))

                if (!isExempt) {
                    if (context.yesterdaySelectedIds?.has(food.id)) {
                        penalty += 4000
                    } else if (context.twoDaysAgoSelectedIds?.has(food.id)) {
                        penalty += 1500
                    }
                }
            }

            return -penalty
        }

        const isLikedFood = (food: any): boolean => {
            if (!this.patientLikedFoods || this.patientLikedFoods.length === 0) return false
            const foodNameLower = (food.name || '').toLocaleLowerCase('tr-TR')
            return this.patientLikedFoods.some(liked => {
                const lLower = liked.trim().toLocaleLowerCase('tr-TR')
                if (!lLower) return false
                return foodNameLower.includes(lLower) || food.tags?.some((t: string) => t.toLocaleLowerCase('tr-TR').includes(lLower))
            })
        }

        // Score all candidates
        const SF = this.getScalingFactor()
        const scoredCandidates = this.shuffle(candidates).map(food => {
            let scoredFood = food
            let score = this.calculateScore(food, context)
            const vScore = calcVarietyScore(food)
            score += (vScore * SF)

            let compBoost = 0
            if (mainDish && this.getCanonicalLockRole(food.role || '') !== 'maindish') {
                const comp = this.calculateCompatibilityBoost(food, mainDish)
                compBoost = comp.boost
                score += (compBoost * SF)
                if (comp.matchedTag) {
                    scoredFood = { ...food, _compatibilityMatchedTag: comp.matchedTag }
                }
            }

            const seasonBonus = this.checkSeasonalitySoft(food, context.currentDate) * 1000
            score += (seasonBonus * SF)

            const pScore = getEffectivePriority(food)
            // Exponential penalty for low priority: score 1 gives ~-4800, score 2 ~-2700
            const priorityDiff = pScore - 5
            const priorityBonus = priorityDiff < 0
                ? priorityDiff * 300 * (1 + Math.abs(priorityDiff) * 0.6)
                : priorityDiff * 300
            score += (priorityBonus * SF)

            // Encourage foods that are still below their configured weekly minimum.
            const minWeekly = this.getEffectiveMinWeeklyFreq(food)
            if (minWeekly > 0) {
                const usedThisWeek = context.weeklySelectedIds?.get(food.id) || 0
                if (usedThisWeek < minWeekly) {
                    const remainingNeed = minWeekly - usedThisWeek
                    const minWeeklyBonus = remainingNeed * 1200
                    score += (minWeeklyBonus * SF)
                }
            }

            const isLiked = isLikedFood(food)
            const likedBonusVal = isLiked ? (likedBoost * SF) : 0
            score += likedBonusVal

            // Logging specific foods if needed
            if (food.name.toLocaleLowerCase('tr-TR').includes('roka') || role === 'salad') {
                // Only log interesting candidates to avoid bloat
                // this.log(context.dayIndex + 1, context.slotName || '?', 'info', `Scoring '${food.name}': Base=${score-vScore-compBoost-seasonBonus-priorityBonus-likedBonusVal}, Variety=${vScore}, Priority=${priorityBonus}, Liked=${likedBonusVal}, Total=${score}`)
            }

            return { food: scoredFood, score }
        }).sort((a, b) => b.score - a.score)

        // Hard-rejected candidates (e.g. affinity forbidden => -Infinity) must never be selected,
        // even in mandatory fallback paths.
        const viableCandidates = scoredCandidates.filter(c => Number.isFinite(c.score))
        
        // Hard filter: Discard any food that has a massive forbidden affinity conflict
        const validCandidates = viableCandidates.filter(c => c.score > (-500000 * SF))

        if (validCandidates.length === 0) {
            if (viableCandidates.length > 0) {
                this.log(context.dayIndex + 1, context.slotName || '?', 'info', `All ${viableCandidates.length} candidates for '${role}' blocked by extreme negative scores (likely affinity or max capacity).`)
            }
            return null
        }

        // Pick randomly from top viable candidates
        const scoreSafetyMargin = (isRequired || ignoreBudget) ? (-1000000 * SF) : (-10000 * SF)
        const topN = validCandidates.slice(0, Math.min(3, validCandidates.length)).filter(c => c.score > scoreSafetyMargin)
        
        let bestCandidate: any = null
        if (topN.length > 0) {
            if (mainDish) {
                const compatibilityTop = topN
                    .filter(c => Boolean(c.food?._compatibilityMatchedTag))
                    .sort((a, b) => b.score - a.score)
                if (compatibilityTop.length > 0) {
                    bestCandidate = compatibilityTop[0]
                }
            }
            if (!bestCandidate) {
                bestCandidate = topN[Math.floor(Math.random() * topN.length)]
            }
        } else if (viableCandidates.length > 0 && (isRequired || ignoreBudget)) {
            // Last resort for mandatory: Take absolute best even if horrible score
            bestCandidate = viableCandidates[0]
        }

        if (bestCandidate?.food) {
            const consistencyResolved = this.resolveConsistencyLockedFoodForCandidate(
                bestCandidate.food,
                context,
                excludeIds,
                slotTags
            )
            if ((consistencyResolved as any)?.__consistencyBlocked) {
                return null
            }
            if (consistencyResolved) {
                // ROLE VERIFICATION: Only accept the consistency swap if the resolved food's
                // actual role matches the requested role. This prevents bread replacing mainDish.
                if (STANDARD_ROLES.includes(role)) {
                    const resolvedRole = this.getCanonicalLockRole(consistencyResolved.role || '')
                    if (resolvedRole === requestedRoleNorm) {
                        bestCandidate = { ...bestCandidate, food: consistencyResolved }
                    }
                    // else: keep original candidate, don't swap
                } else {
                    bestCandidate = { ...bestCandidate, food: consistencyResolved }
                }
            }

            // Use only the food's OWN role for lock key — don't fall back to requested role
            // to prevent cross-role lock contamination (e.g., bread locked under 'maindish')
            const normalizedSelectedLockRole = this.getCanonicalLockRole(bestCandidate.food?.role || '')
            if (normalizedSelectedLockRole && Planner.LOCKABLE_ROLES.includes(normalizedSelectedLockRole) && !this.weeklyLocks.has(normalizedSelectedLockRole)) {
                this.weeklyLocks.set(normalizedSelectedLockRole, bestCandidate.food)
                if (normalizedSelectedLockRole === 'soup') {
                    this.weeklyLocks.set('corba', bestCandidate.food)
                }
            }
            if (bestCandidate.food?._consistencyRuleName) {
                this.setWeeklyLockReason(
                    normalizedSelectedLockRole,
                    bestCandidate.food._consistencyRuleId || null,
                    bestCandidate.food._consistencyRuleName
                )
            }
            this.commitRotationFood(bestCandidate.food)
            return bestCandidate.food
        }

        return null
    }

    private commitRotationFood(food: any) {
        if (food && food._rotationRuleId) {
            const state = this.rotationStates.get(food._rotationRuleId)
            if (state) state.sessionUsed.push(food.id)
        }
    }

    /**
     * Select a filler food to help meet macro targets (Protein/Fat)
     * @param calorieBudget - Remaining calorie budget for this slot
     */
    private async selectFillerFood(
        slotName: string,
        context: any,
        excludeIds: Set<string>,
        slotTags: Set<string>,
        slotMacros: any,
        calorieBudget?: number
    ): Promise<any | null> {
        const normalizedSlot = normalizeSlotName(slotName)
        const isLunch = normalizedSlot === 'ÖĞLEN'
        const isDinner = normalizedSlot === 'AKŞAM'
        const deficitType = context.slotTargetMacros ? (
            ((slotMacros.protein / context.slotTargetMacros.protein) < 0.7) ? 'protein' :
                ((slotMacros.fat / context.slotTargetMacros.fat) < 0.7) ? 'fat' : 'generic'
        ) : 'generic';

        // Find filler candidates
        const candidates = this.eligibleFoods.filter(f => {
            // Must be a filler for this meal OR have a smart filler tag matching the deficit
            const tags = f.tags || [];
            const isSmartFatFiller = tags.some((t: string) => t.toLowerCase().includes('yağ dolgusu'));
            const isSmartProteinFiller = tags.some((t: string) => t.toLowerCase().includes('protein dolgusu'));

            let isValidFiller = false;

            if (deficitType === 'fat' && isSmartFatFiller) isValidFiller = true;
            else if (deficitType === 'protein' && isSmartProteinFiller) isValidFiller = true;
            else if (isLunch && f.filler_lunch) isValidFiller = true;
            else if (isDinner && f.filler_dinner) isValidFiller = true;
            else if (!isLunch && !isDinner && (isSmartFatFiller || isSmartProteinFiller)) isValidFiller = true; // Allow smart tags on snacks

            if (!isValidFiller) return false;

            // NEW: Rotation (Lock) Consistency Check
            // "ekmek her zaman ekmektir kilit de her zaman kilittir!"
            const foodRole = f.role || ''
            const lockRole = this.getCanonicalLockRole(foodRole)
            if (Planner.LOCKABLE_ROLES.includes(lockRole)) {
                const lockedFood = this.getLockedFood(f.category || '', foodRole, context)
                if (lockedFood && f.id !== lockedFood.id) {
                    return false // Violates active rotation for this role
                }
            }

            // Basic exclusions
            if (excludeIds.has(f.id)) return false
            if (context.dailySelectedIds?.has(f.id)) return false
            if (this.hasTagConflict(f, slotTags)) return false

            // Strict requirements for generic fillers without smart tags
            if (deficitType === 'protein' && !isSmartProteinFiller && (f.protein || 0) < 5) return false;
            // No strict requirement for fat fillers since fats are dense, user tagging handles it.

            // CALORIE BUDGET CHECK - Only include fillers within budget
            if (calorieBudget && (f.calories || 0) > calorieBudget) return false

            // MAX WEEKLY FREQUENCY CHECK
            const weeklyCount = context.weeklySelectedIds?.get(f.id) || 0
            if (this.hasReachedWeeklyCap(f, weeklyCount)) return false

            // PRIORITY SCORE CHECK - Filter out foods with score 0
            const priority = this.settings?.food_score_overrides?.[f.id] ?? f.priority_score ?? 5
            if (priority === 0) return false

            return true
        })

        if (candidates.length === 0) return null

        // Calculate a variety penalty for each filler to prevent consecutive day repetitions
        const varietyMode = this.settings?.variety_mode || 'hybrid'
        const getVarietyPenalty = (food: any): number => {
            if (varietyMode === 'off') return 0

            let penalty = 0
            const exemptWords = this.settings?.variety_exempt_words || []
            const foodNameLower = (food.name || '').toLowerCase()
            const isExempt = exemptWords.some((word: string) => foodNameLower.includes(word.toLowerCase()))

            if (!isExempt) {
                if (context.yesterdaySelectedIds?.has(food.id)) {
                    penalty += 4000
                } else if (context.twoDaysAgoSelectedIds?.has(food.id)) {
                    penalty += 1500
                }
            }

            // Add cooldown penalty based on weekly count
            const weeklyCount = context.weeklySelectedIds?.get(food.id) || 0
            const cooldownStrength = this.settings?.cooldown_strength ?? 5
            penalty += (weeklyCount ** 2) * cooldownStrength * 150

            // Add cross-week historical penalty
            const historicalCount = this.historicalFoodCounts?.get(food.id) || 0
            if (historicalCount > 0 && this.historicalAvgUsage > 0) {
                const relativeUsage = historicalCount / this.historicalAvgUsage
                penalty += Math.floor(relativeUsage * 300)
            }

            return penalty
        }

        // Sort by smart tag match first, then variety, then efficiency ratio
        candidates.sort((a, b) => {
            const aTags = a.tags || [];
            const bTags = b.tags || [];

            const aIsSmartFat = aTags.some((t: string) => t.toLowerCase().includes('yağ dolgusu')) ? 1 : 0;
            const aIsSmartPro = aTags.some((t: string) => t.toLowerCase().includes('protein dolgusu')) ? 1 : 0;
            const bIsSmartFat = bTags.some((t: string) => t.toLowerCase().includes('yağ dolgusu')) ? 1 : 0;
            const bIsSmartPro = bTags.some((t: string) => t.toLowerCase().includes('protein dolgusu')) ? 1 : 0;

            // Heavily penalize foods that are on cooldown or were eaten recently
            const varietyPenaltyA = getVarietyPenalty(a);
            const varietyPenaltyB = getVarietyPenalty(b);

            // Incorporate priority score into the sorting (multiplier for macro efficiency)
            const priorityA = this.settings?.food_score_overrides?.[a.id] ?? a.priority_score ?? 5
            const priorityB = this.settings?.food_score_overrides?.[b.id] ?? b.priority_score ?? 5
            const priorityModifierA = (priorityA / 5);
            const priorityModifierB = (priorityB / 5);

            if (deficitType === 'fat') {
                if (aIsSmartFat !== bIsSmartFat) return bIsSmartFat - aIsSmartFat;

                // Incorporate variety penalty and priority into a simplified score (lower penalty/higher priority is better)
                const scoreA = (((a.fat || 0) / (a.calories || 1)) * 10000 * priorityModifierA) - varietyPenaltyA;
                const scoreB = (((b.fat || 0) / (b.calories || 1)) * 10000 * priorityModifierB) - varietyPenaltyB;
                return scoreB - scoreA;
            } else {
                if (aIsSmartPro !== bIsSmartPro) return bIsSmartPro - aIsSmartPro;

                // Incorporate variety penalty and priority into a simplified score
                const scoreA = (((a.protein || 0) / (a.calories || 1)) * 10000 * priorityModifierA) - varietyPenaltyA;
                const scoreB = (((b.protein || 0) / (b.calories || 1)) * 10000 * priorityModifierB) - varietyPenaltyB;
                return scoreB - scoreA;
            }
        })

        // Return best ratio filler
        return candidates[0]
    }

    /**
     * Check if food has conflicting tags with already selected foods in slot
     */
    private hasTagConflict(food: any, slotTags: Set<string>): boolean {
        if (!food.tags || !Array.isArray(food.tags)) return false
        if (slotTags.size === 0) return false

        for (const tag of food.tags) {
            const normalizedTag = tag.trim().toLocaleLowerCase('tr-TR')
            // Skip exempt tags (checked against effective set)
            if (this.effectiveExemptTags.has(normalizedTag)) continue

            if (slotTags.has(normalizedTag)) {
                return true // Conflict found
            }
        }
        return false
    }

    /**
     * Calculate compatibility boost based on mainDish's compatibility_tags
     */
    private getCompatibilityAnalysis(food: any, mainDish: any): {
        boost: number
        matchedTag: string | null
        matchedCount: number
        bestTagIndex: number
    } {
        const rawTargetTags = Array.isArray(mainDish?.compatibility_tags)
            ? mainDish.compatibility_tags
            : (typeof mainDish?.compatibility_tags === 'string' ? mainDish.compatibility_tags.split(/[\n,]+/) : [])
        const candidateTagSources: string[] = [
            ...(Array.isArray(food?.tags) ? food.tags : (typeof food?.tags === 'string' ? food.tags.split(/[\n,]+/) : [])),
            ...(Array.isArray(food?.compatibility_tags) ? food.compatibility_tags : (typeof food?.compatibility_tags === 'string' ? food.compatibility_tags.split(/[\n,]+/) : []))
        ]

        if (!rawTargetTags.length || !candidateTagSources.length) {
            return { boost: 0, matchedTag: null, matchedCount: 0, bestTagIndex: Number.POSITIVE_INFINITY }
        }

        const candidateTags = candidateTagSources
            .map((tag: string) => String(tag || '').trim())
            .filter(Boolean)
        const normalizedCandidateTags = candidateTags.map((tag: string) => normalizeKey(tag))
        const normalizedFoodName = normalizeKey(String(food?.name || ''))

        let totalBoost = 0
        let matchedTag: string | null = null
        let matchedCount = 0
        let bestTagIndex = Number.POSITIVE_INFINITY
        let bestMatchScore = -1

        rawTargetTags.forEach((targetTagRaw: string, targetIndex: number) => {
            const targetTag = String(targetTagRaw || '').trim()
            const normalizedTarget = normalizeKey(targetTag)
            if (!normalizedTarget) return

            const exactTagIndex = normalizedCandidateTags.findIndex((tag: string) => tag === normalizedTarget)
            const partialTagIndex = exactTagIndex >= 0
                ? exactTagIndex
                : normalizedCandidateTags.findIndex((tag: string) => tag.includes(normalizedTarget) || normalizedTarget.includes(tag))
            const nameMatch = normalizedFoodName.includes(normalizedTarget)

            if (exactTagIndex < 0 && partialTagIndex < 0 && !nameMatch) return

            matchedCount++
            const activeTagIndex = exactTagIndex >= 0 ? exactTagIndex : partialTagIndex
            if (activeTagIndex >= 0) {
                bestTagIndex = Math.min(bestTagIndex, activeTagIndex)
            }

            const matchTypeBase = exactTagIndex >= 0 ? 5200 : (partialTagIndex >= 0 ? 3200 : 1800)
            const tagOrderBonus = activeTagIndex >= 0 ? Math.max(200, 1300 - (activeTagIndex * 220)) : 0
            const targetOrderBonus = Math.max(120, 700 - (targetIndex * 90))
            const matchScore = matchTypeBase + tagOrderBonus + targetOrderBonus

            totalBoost += matchScore

            if (matchScore > bestMatchScore) {
                bestMatchScore = matchScore
                matchedTag = targetTag
            }
        })

        if (matchedCount > 1) {
            totalBoost += (matchedCount - 1) * 900
        }

        return {
            boost: Math.min(totalBoost, 16000),
            matchedTag,
            matchedCount,
            bestTagIndex
        }
    }

    private calculateCompatibilityBoost(food: any, mainDish: any): { boost: number, matchedTag: string | null } {
        const details = this.getCompatibilityAnalysis(food, mainDish)
        return { boost: details.boost, matchedTag: details.matchedTag }
    }

    /**
     * Check for name similarity (e.g. "Muffin" vs "Muffin")
     * Returns true if conflict found
     */
    private hasNameConflict(food: any, context: any): boolean {
        // If feature disabled, return false
        if (!this.settings?.enable_name_similarity_check) return false

        const selectedFoods = context.selectedFoods || []
        if (selectedFoods.length === 0) return false

        const exemptWords = this.settings?.name_similarity_exempt_words || []

        const foodName = (food.name || '').toLowerCase()
        const foodWords = foodName.split(/\s+/).filter((w: string) => w.length > 3 && !exemptWords.includes(w))

        for (const selected of selectedFoods) {
            const selectedName = (selected.name || '').toLowerCase()
            const selectedWords = selectedName.split(/\s+/).filter((w: string) => w.length > 3 && !exemptWords.includes(w))

            // Check if any significant word is shared
            const hasCommonWord = foodWords.some((w: string) => selectedWords.includes(w))

            if (hasCommonWord) {
                // Ignore if words are in Exempt Tags list (e.g. "Salata" might be generic)
                // But usually we want to block "Tavuklu Salata" + "Ton Balıklı Salata" if similarity check is ON.
                // Let's rely on the setting being an OPT-IN strict mode.
                return true
            }
        }
        return false
    }

    /**
     * Hard seasonality check - return false if completely out of season
     */
    private checkSeasonalityHard(food: any, date: Date): boolean {
        if (!date) return true

        const sStart = food.season_start || 1
        const sEnd = food.season_end || 12

        if (sStart === 1 && sEnd === 12) return true

        const month = date.getMonth() + 1

        if (sStart <= sEnd) {
            return month >= sStart && month <= sEnd
        } else {
            // Cross-year range (e.g. 11-4)
            return month >= sStart || month <= sEnd
        }
    }

    /**
     * Soft seasonality score (0-1, higher is better)
     */
    private checkSeasonalitySoft(food: any, date: Date): number {
        if (!date) return 0.5

        const sStart = food.season_start || 1
        const sEnd = food.season_end || 12

        if (sStart === 1 && sEnd === 12) return 0.5 // All year, neutral

        const month = date.getMonth() + 1
        let inSeason = false

        if (sStart <= sEnd) {
            inSeason = month >= sStart && month <= sEnd
        } else {
            inSeason = month >= sStart || month <= sEnd
        }

        return inSeason ? 1.0 : -0.5
    }

    private addFoodMacros(target: any, food: any) {
        target.calories += food.calories || 0
        target.protein += food.protein || 0
        target.carbs += food.carbs || 0
        target.fat += food.fat || 0
    }

    private addFoodTags(tagSet: Set<string>, food: any) {
        if (food.tags && Array.isArray(food.tags)) {
            food.tags.forEach((tag: string) => tagSet.add(tag.trim().toLocaleLowerCase('tr-TR')))
        }
    }

    private shuffle(array: any[]): any[] {
        const arr = [...array]
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]]
        }
        return arr
    }

    private getScalingFactor(): number {
        if (!this.settings?.weights || !Array.isArray(this.settings.weights) || this.settings.weights.length === 0) return 1
        const maxRank = this.settings.weights.length
        return Math.max(1, Math.pow(1000, maxRank > 0 ? maxRank - 1 : 0) / 100)
    }

    private getCanonicalLockRole(role: string): string {
        const normalized = normalizeCategory(role || '')
        return normalized === 'corba' ? 'soup' : normalized
    }

    private setWeeklyLockReason(role: string, ruleId: string | null, ruleName: string) {
        const canonicalRole = this.getCanonicalLockRole(role)
        if (!canonicalRole || !ruleName) return
        this.weeklyLockReasons.set(canonicalRole, { ruleId, ruleName })
        if (canonicalRole === 'soup') {
            this.weeklyLockReasons.set('corba', { ruleId, ruleName })
        }
    }

    private getWeeklyLockReason(role: string): { ruleId: string | null, ruleName: string } | null {
        const canonicalRole = this.getCanonicalLockRole(role)
        if (!canonicalRole) return null
        return this.weeklyLockReasons.get(canonicalRole)
            || (canonicalRole === 'soup' ? this.weeklyLockReasons.get('corba') || null : null)
    }

    private decorateSourceWithLockMetadata(food: any, source: any): any {
        if (!source || !food) return source

        const lockRuleName = typeof food._consistencyRuleName === 'string' ? food._consistencyRuleName.trim() : ''
        const lockRuleIdRaw = food._consistencyRuleId
        const lockRuleId = typeof lockRuleIdRaw === 'string' && lockRuleIdRaw.trim() ? lockRuleIdRaw : null

        if (!lockRuleName && !lockRuleId) return source

        return {
            ...source,
            lock_rule: lockRuleName || undefined,
            lock_rule_id: lockRuleId || undefined
        }
    }

    private getMealTypesArray(food: any): string[] | null {
        if (Array.isArray(food?.meal_types)) return food.meal_types
        if (typeof food?.meal_types === 'string') {
            try { return JSON.parse(food.meal_types) } catch { return [food.meal_types] }
        }
        return null
    }

    private getRequiredMealTypeForSlot(slotName: string): string | null {
        const normalizedSlot = normalizeSlotName(slotName)
        if (normalizedSlot === 'KAHVALTI') return 'breakfast'
        if (normalizedSlot === 'ÖĞLEN') return 'lunch'
        if (normalizedSlot === 'AKŞAM') return 'dinner'
        if (normalizedSlot === 'ARA ÖĞÜN') return 'snack'
        return null
    }

    private isMealTypeCompatibleWithSlot(food: any, slotName: string): boolean {
        const requiredMealType = this.getRequiredMealTypeForSlot(slotName)
        if (!requiredMealType) return true
        const foodMealTypes = this.getMealTypesArray(food)
        if (foodMealTypes && foodMealTypes.length > 0) {
            const reqLower = requiredMealType.toLowerCase().replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/\s+/g, '')
            return foodMealTypes.some(t => {
                if (typeof t !== 'string') return false
                const normT = t.toLowerCase().replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/\s+/g, '')
                if (normT === reqLower) return true
                if (reqLower.includes('ogle') && normT.includes('ogle')) return true
                if (reqLower.includes('aksam') && normT.includes('aksam')) return true
                if (reqLower.includes('kahvalt') && normT.includes('kahvalt')) return true
                if (reqLower.includes('ara') && normT.includes('ara')) return true
                return false
            })
        }
        return true
    }

    private getEffectiveMaxWeeklyFreq(food: any): number | null {
        const explicitCap = this.getExplicitMaxWeeklyFreq(food)
        if (explicitCap !== null) return explicitCap

        const varietyMode = this.settings?.variety_mode || 'hybrid'
        if (varietyMode === 'off') return null

        const defaultRaw = this.settings?.max_weekly_default
        const defaultFreq = typeof defaultRaw === 'number'
            ? defaultRaw
            : Number(defaultRaw ?? Number.NaN)

        if (Number.isNaN(defaultFreq)) return 3
        return Math.max(0, Math.floor(defaultFreq))
    }

    private getExplicitMaxWeeklyFreq(food: any): number | null {
        const explicitRaw = food?.max_weekly_freq
        const explicitFreq = typeof explicitRaw === 'number'
            ? explicitRaw
            : (typeof explicitRaw === 'string' && explicitRaw.trim() !== '' ? Number(explicitRaw) : Number.NaN)

        if (Number.isNaN(explicitFreq)) return null
        return Math.max(0, Math.floor(explicitFreq))
    }

    private getEffectiveMinWeeklyFreq(food: any): number {
        const rawMin = food?.min_weekly_freq
        const minWeekly = typeof rawMin === 'number'
            ? rawMin
            : Number(rawMin ?? Number.NaN)

        if (!Number.isFinite(minWeekly) || minWeekly <= 0) return 0

        const normalizedMin = Math.max(0, Math.floor(minWeekly))
        const cap = this.getEffectiveMaxWeeklyFreq(food)
        if (cap === null) return normalizedMin
        return Math.min(normalizedMin, cap)
    }

    private hasReachedWeeklyCap(food: any, weeklyCount: number): boolean {
        const cap = this.getEffectiveMaxWeeklyFreq(food)
        if (cap === null) return false
        return weeklyCount >= cap
    }

    calculateScore(food: any, context: any): number {
        if (!this.settings?.weights || !Array.isArray(this.settings.weights)) {
            const weeklyCount = context.weeklySelectedIds?.get(food.id) || 0
            return 1000 - (weeklyCount * 100) + Math.random() * 100
        }

        const SF = this.getScalingFactor()

        let totalScore = 0
        const weights = this.settings.weights
        const MULTIPLIER = 1000
        const maxRank = weights.length

        if (this.checkHardConstraints(food, context) === false) {
            return Number.NEGATIVE_INFINITY
        }

        weights.forEach((criterion, index) => {
            const rank = index
            const magnitude = Math.pow(MULTIPLIER, maxRank - rank - 1)
            const sliderValue = criterion.weight
            const fit = this.evaluateCriterion(criterion.id, food, context)
            totalScore += (sliderValue * fit) * magnitude
        })

        // Rule score was already calculated above to determine penalty. Add it here.
        // Wait, calculateScore is called in loop. We need to respect the rule score logic.
        // Re-calculating applyRuleScores might be expensive but safe.
        // Optimization: We did it above. Let's not duplicate logic, just use applyRuleScores result.
        // Note: In the block above (lines 420-430 in original), we called applyRuleScores inside the loop.
        // But calculateScore IS defining the score for the loop item.
        // So we should just call it here as usual.

        totalScore += (this.applyRuleScores(food, context) * SF)

        // Compatibility Score (Boost for matching side dishes)
        totalScore += (this.checkCompatibilityScore(food, context) * SF)

        // DIET TYPE AFFINITY BOOST
        // Only if not strictly defined by tags (legacy string mode mainly)
        // If the diet is 'lowcarb', boost foods that actually have the 'lowcarb' tag
        // so they don't get drowned out by 'keto' foods which might have extreme macros.
        if (context.weekDietType === 'lowcarb' && (food.lowcarb || (!food.keto && food.protein > 10))) {
            // Boost non-keto lowcarb options slightly to ensure variety
            totalScore += (200 * SF)
        }

        // --- MACRO PRIORITY SCORING (Slot-Level + Daily-Level Escalation) ---
        if (this.settings?.macro_priorities && context.slotTargetMacros) {
            const { protein, carb, fat } = this.settings.macro_priorities
            const target = context.slotTargetMacros
            const current = context.slotMacros
            const iterFactor = context.iterationFactor || 1

            // Base factor: 80 (up from 25). Scales with iteration for re-planning.
            const MACRO_FACTOR = 80 * iterFactor

            const scoreMacro = (foodAmount: number, currentAmount: number, targetAmount: number, priority: number) => {
                if (!priority || priority <= 0) return 0
                if (!targetAmount || targetAmount <= 0) return 0

                const remaining = targetAmount - currentAmount
                if (remaining <= 0) {
                    // Already over target: Penalize further addition
                    return -1 * foodAmount * priority * MACRO_FACTOR
                } else {
                    const usefulAmount = Math.min(foodAmount, remaining * 1.1)
                    const wasteAmount = Math.max(0, foodAmount - usefulAmount)
                    return (usefulAmount * priority * MACRO_FACTOR) - (wasteAmount * priority * MACRO_FACTOR * 0.8)
                }
            }

            totalScore += scoreMacro(food.protein || 0, current.protein, target.protein, protein)
            totalScore += scoreMacro(food.carbs || 0, current.carbs, target.carbs, carb)
            totalScore += scoreMacro(food.fat || 0, current.fat, target.fat, fat)

            // --- DAILY-LEVEL ESCALATING PENALTY ---
            // If the day's cumulative macro is already near/over target, escalate penalties
            if (context.dailyMacros && context.dailyTarget) {
                const dTarget = context.dailyTarget
                const dCurrent = context.dailyMacros

                const dailyPenalty = (foodMacro: number, dailyCurrent: number, dailyTgt: number, priority: number) => {
                    if (!dailyTgt || dailyTgt <= 0 || !priority) return 0
                    const ratio = dailyCurrent / dailyTgt
                    if (ratio > 0.85 && foodMacro > 3) {
                        // Escalating: the closer to/over target, the harsher
                        const escalation = Math.max(1, (ratio - 0.7) * 3) // 0.85→0.45x, 1.0→0.9x, 1.2→1.5x
                        return -foodMacro * priority * MACRO_FACTOR * 0.5 * escalation
                    }
                    return 0
                }

                totalScore += dailyPenalty(food.fat || 0, dCurrent.fat, dTarget.fat, fat)
                totalScore += dailyPenalty(food.carbs || 0, dCurrent.carbs, dTarget.carbs, carb)
                // For protein, penalize LACK (reward adding more when under daily target)
                if (dTarget.protein > 0 && dCurrent.protein < dTarget.protein * 0.9) {
                    const proteinBonus = Math.min(food.protein || 0, dTarget.protein - dCurrent.protein)
                    totalScore += proteinBonus * protein * MACRO_FACTOR * 0.3
                }
            }
        }

        return totalScore
    }

    private checkHardConstraints(food: any, context: any): boolean {
        return true
    }

    private applyRuleScores(food: any, context: any): number {
        let score = 0
        for (const rule of this.rules) {
            if (rule.rule_type === 'affinity') {
                score += this.checkAffinityRule(rule, food, context)
            }
            if (rule.rule_type === 'frequency') {
                score += this.checkFrequencyRule(rule, food, context)
            }
        }
        return score
    }

    private checkAffinityRule(rule: PlanningRule, food: any, context: any): number {
        const rawDef = rule.definition as any
        const def = rawDef.data || rawDef // Support both { type, data: {...} } and flat formats
        if (!def.trigger || !def.outcome) return 0

        const IMPACT = 10000

        // Affinity scope: SAME MEAL (slot) only.
        // Foods from other slots in the same day should NOT trigger forbidden rules.
        const triggerPool = [
            ...(context.slotSelectedFoods || [])
        ]

        const isTwoWay = def.direction === 'two-way' || (def.direction === undefined && (!def.association || def.association === 'forbidden'))

        const isOutcome = this.matchesTarget(food, def.outcome)
        const isTrigger = this.matchesTarget(food, def.trigger)
        const triggerExists = triggerPool.some((f: any) => this.matchesTarget(f, def.trigger))
        const outcomeExists = triggerPool.some((f: any) => this.matchesTarget(f, def.outcome))

        // ═══ OLD FORMAT: association-based (backward compatibility) ═══
        if (def.association) {
            const probabilityRaw = Number(def.probability ?? (def.association === 'forbidden' ? 100 : 0))
            const probabilityClamped = Math.max(0, Math.min(100, probabilityRaw))
            const prob = probabilityClamped / 100

            if (def.association === 'forbidden') {
                const hasConflict = isTwoWay
                    ? ((isOutcome && (triggerExists || isTrigger)) || (isTrigger && (outcomeExists || isOutcome)))
                    : (isOutcome && triggerExists)
                if (!hasConflict) return 0
                if (prob <= 0) return 0
                if (prob >= 1) return Number.NEGATIVE_INFINITY
                return -(IMPACT * 10 * prob)
            }

            const isTriggered = isTwoWay
                ? ((isOutcome && triggerExists) || (isTrigger && outcomeExists))
                : (isOutcome && triggerExists)

            if (isTriggered) {
                if (def.association === 'boost') return IMPACT * prob
                if (def.association === 'mandatory') return IMPACT * 10
                if (def.association === 'reduce') return -IMPACT * prob
            }
            return 0
        }

        // ═══ NEW FORMAT: unified probability scale (0=forbidden, 50=neutral, 100=mandatory) ═══
        const prob = Math.max(0, Math.min(100, Number(def.probability ?? 50)))

        // Check if the food is related to the rule (trigger/outcome)
        const isTriggered = isTwoWay
            ? ((isOutcome && triggerExists) || (isTrigger && outcomeExists))
            : (isOutcome && triggerExists)

        // For forbidden (prob=0): also block self-trigger like old format
        if (prob <= 0) {
            const hasConflict = isTwoWay
                ? ((isOutcome && (triggerExists || isTrigger)) || (isTrigger && (outcomeExists || isOutcome)))
                : (isOutcome && triggerExists)
            if (hasConflict) return Number.NEGATIVE_INFINITY
            return 0
        }

        if (!isTriggered) return 0

        if (prob < 46) {
            // 1-45%: Discouraged — negative score, stronger as prob approaches 0
            const strength = (46 - prob) / 46 // 1.0 at prob=0, 0.0 at prob=46
            return -(IMPACT * 10 * strength)
        }

        if (prob <= 54) {
            // 46-54%: Neutral zone — no effect
            return 0
        }

        if (prob < 100) {
            // 55-99%: Encouraged — positive score, stronger as prob approaches 100
            const strength = (prob - 54) / 46 // 0.0 at prob=54, 1.0 at prob=100
            return IMPACT * 5 * strength
        }

        // 100%: Near-mandatory — very high bonus
        return IMPACT * 10
    }

    /**
     * Standalone check: does adding `food` to a day that already contains `dayFoods`
     * create a forbidden affinity conflict?
     * Used by post-processing (balancePlan, enforceFoodWeeklyMinimums) to guard
     * against introducing violations outside the main planning loop.
     */
    private hasForbiddenAffinityConflict(food: any, slotFoods: any[]): boolean {
        if (!food || !slotFoods || slotFoods.length === 0) return false

        for (const rule of this.rules) {
            if (rule.rule_type !== 'affinity') continue
            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef
            if (!def.trigger || !def.outcome) continue

            // ═══ OLD FORMAT: association-based ═══
            if (def.association) {
                if (def.association !== 'forbidden') continue
                const probabilityRaw = Number(def.probability ?? 100)
                const prob = Math.max(0, Math.min(100, probabilityRaw)) / 100
                if (prob <= 0) continue

                const isTwoWay = def.direction === 'two-way' || (def.direction === undefined && def.association === 'forbidden')
                const isOutcome = this.matchesTarget(food, def.outcome)
                const isTrigger = this.matchesTarget(food, def.trigger)
                const triggerExists = slotFoods.some((f: any) => this.matchesTarget(f, def.trigger))
                const outcomeExists = slotFoods.some((f: any) => this.matchesTarget(f, def.outcome))

                const hasConflict = isTwoWay
                    ? ((isOutcome && triggerExists) || (isTrigger && outcomeExists))
                    : (isOutcome && triggerExists)

                if (hasConflict && prob >= 0.5) return true
                continue
            }

            // ═══ NEW FORMAT: unified probability (0=forbidden, 100=mandatory) ═══
            const unifiedProb = Math.max(0, Math.min(100, Number(def.probability ?? 50)))
            if (unifiedProb > 10) continue // Only block when slider is near 0 (forbidden zone)

            const isTwoWay = def.direction === 'two-way' || def.direction === undefined
            const isOutcome = this.matchesTarget(food, def.outcome)
            const isTrigger = this.matchesTarget(food, def.trigger)
            const triggerExists = slotFoods.some((f: any) => this.matchesTarget(f, def.trigger))
            const outcomeExists = slotFoods.some((f: any) => this.matchesTarget(f, def.outcome))

            const hasConflict = isTwoWay
                ? ((isOutcome && triggerExists) || (isTrigger && outcomeExists))
                : (isOutcome && triggerExists)

            if (hasConflict) return true
        }
        return false
    }

    private checkFrequencyRule(rule: PlanningRule, food: any, context: any): number {
        const rawDef = rule.definition as any
        const def = rawDef.data || rawDef // Support both old (def.xxx) and new (def.data.xxx) formats
        if (!def.target) return 0

        // Check if rule applies to current slot (scope_meals filter)
        if (def.scope_meals && def.scope_meals.length > 0) {
            const currentSlot = normalizeSlotName(String(context.slotName || ''))
            const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
            if (!normalizedScopeMeals.includes(currentSlot)) {
                return 0 // Rule doesn't apply to this slot
            }
        }

        // Check if rule applies to current day
        const dayIndex = context.dayIndex !== undefined ? context.dayIndex : 0
        const dayOfWeek = dayIndex + 1 // 1=Monday...7=Sunday

        const randomDaysTarget = def.random_day_count || ((!def.scope_days || def.scope_days.length === 0) && def.max_count ? def.max_count : null)
        if (randomDaysTarget) {
            // Random X days mode - generate stable random days for this rule
            const count = typeof randomDaysTarget === 'number' ? randomDaysTarget : Number(randomDaysTarget)
            const randomDays = this.getRandomDaysForRule(rule.id, count)
            if (!randomDays.includes(dayOfWeek)) {
                return 0 // Rule doesn't apply to this day
            }
        } else if (def.scope_days && def.scope_days.length > 0) {
            // Specific days mode
            if (!def.scope_days.includes(dayOfWeek)) {
                return 0 // Rule doesn't apply to this day
            }
        }

            // Now check the actual frequency constraint
            if (this.matchesTarget(food, def.target)) {
                const period = def.period || 'weekly'
                const count = this.countOccurrences(def.target, context, period)

            if (def.max_count && count >= def.max_count) {
                // Log rejection due to frequency cap
                // Note: We can't log easily here without day/slot, but calculateScore caller will see negative infinity
                return Number.NEGATIVE_INFINITY
            }
            if (def.min_count && count < def.min_count) {
                return 20000 // Boost score to ensure selection
            }
        }
        return 0
    }

    private isFrequencyRuleApplicableToContext(rule: PlanningRule, context: any): boolean {
        const rawDef = rule.definition as any
        const def = rawDef?.data || rawDef || {}

        const currentSlot = normalizeSlotName(String(context.slotName || ''))
        if (def.scope_meals && def.scope_meals.length > 0) {
            const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
            if (!normalizedScopeMeals.includes(currentSlot)) return false
        }

        const dayIndex = context.dayIndex !== undefined ? context.dayIndex : 0
        const dayOfWeek = dayIndex + 1

        const randomDaysTarget = def.random_day_count || ((!def.scope_days || def.scope_days.length === 0) && def.max_count ? def.max_count : null)
        if (randomDaysTarget) {
            const count = typeof randomDaysTarget === 'number' ? randomDaysTarget : Number(randomDaysTarget)
            const randomDays = this.getRandomDaysForRule(rule.id, count)
            if (!randomDays.includes(dayOfWeek)) return false
        } else if (def.scope_days && def.scope_days.length > 0) {
            if (!def.scope_days.includes(dayOfWeek)) return false
        }

        return true
    }

    private hasReachedFrequencyRuleMaxForFood(food: any, context: any): boolean {
        if (!food) return false
        for (const rule of this.rules) {
            if (!rule?.is_active || rule.rule_type !== 'frequency') continue
            const rawDef = rule.definition as any
            const def = rawDef?.data || rawDef || {}
            if (!def?.target) continue

            const maxCount = typeof def.max_count === 'number' ? def.max_count : Number(def.max_count)
            if (!Number.isFinite(maxCount) || maxCount <= 0) continue

            if (!this.isFrequencyRuleApplicableToContext(rule, context)) continue
            if (!this.matchesTarget(food, def.target)) continue

            const period = def.period || 'weekly'
            const count = this.countOccurrences(def.target, context, period)
            if (count >= maxCount) return true
        }
        return false
    }

    private checkCompatibilityScore(food: any, context: any): number {
        // If no main dish selected for this slot, compatibility logic doesn't apply
        if (!context.slotMainDish) return 0

        // Don't check compatibility against self (though role check usually prevents this)
        if (food.id === context.slotMainDish.id) return 0

        const details = this.getCompatibilityAnalysis(food, context.slotMainDish)
        if (!details.matchedTag) return 0

        // Keep this component smaller than direct selection boost to avoid over-dominance
        return Math.round(details.boost * 0.2)
    }

    // Generate stable random days for a rule (same days within same week generation)

    private getRandomDaysForRule(ruleId: string, count: number, availableDays?: number[]): number[] {
        // Check cache first
        if (this.randomDaysCache.has(ruleId)) {
            return this.randomDaysCache.get(ruleId)!
        }

        // Generate random days using rule ID + generation timestamp as seed for per-run variety
        const pool = availableDays && availableDays.length > 0 ? [...availableDays] : [1, 2, 3, 4, 5, 6, 7]
        const seed = `${ruleId}-${this._generationSeed}`
        const shuffled = this.shuffleWithSeed(pool, seed)
        const selected = shuffled.slice(0, Math.min(count, pool.length))

        this.randomDaysCache.set(ruleId, selected)
        return selected
    }

    private shuffleWithSeed<T>(array: T[], seed: string): T[] {
        // Simple hash-based shuffle for deterministic randomness per seed
        const result = [...array]
        let hash = 0
        for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i)
            hash = hash & hash
        }

        for (let i = result.length - 1; i > 0; i--) {
            hash = (hash * 1103515245 + 12345) & 0x7fffffff
            const j = hash % (i + 1)
                ;[result[i], result[j]] = [result[j], result[i]]
        }
        return result
    }

    private countOccurrences(target: any, context: any, period: string = 'weekly'): number {
        let source: any[] = []
        const slotSelected = context.slotSelectedFoods || []

        if (period === 'per_meal') {
            // Per meal: Only count foods in the CURRENT slot being planned
            // context.slotSelectedFoods contains only foods selected for current slot
            source = slotSelected
        } else if (period === 'daily') {
            // Daily: Count all foods selected today (all slots)
            source = (context.selectedFoods || []).concat(slotSelected)
        } else {
            // Weekly: week tracker + current slot (not yet committed to week tracker)
            source = this.currentWeekFoods.concat(slotSelected)
        }

        return source.filter((f: any) => this.matchesTarget(f, target)).length
    }

    private matchesTarget(food: any, target: any): boolean {
        if (!food || !target) return false

        if (target.type === 'category') {
            const tVal = normalizeCategory(target.value)
            const fCat = normalizeCategory(food.category || '')
            const fRole = normalizeCategory(food.role || '')

            // Direct Normalized Match (Category vs Target)
            if (fCat === tVal) return true

            // Allow Role vs Target match (e.g. food has role 'soup', target is 'çorbalar'->'soup')
            if (fRole === tVal) return true

            // Fallback: If Category normalized name (or any of its synonyms) is contained in the food name
            // This handles cases where data categorization is inconsistent (e.g. "Börek" in name but category is "Ana Yemek")
            const fNameNormalized = normalizeKey(food.name || '')
            
            // Get all synonyms for this target standardized key
            const synonyms = CATEGORY_ROLE_MAP[tVal as keyof typeof CATEGORY_ROLE_MAP] || [tVal]
            if (synonyms.some(s => fNameNormalized.includes(s))) return true

            return false
        }

        if (target.type === 'role') {
            const tVal = normalizeCategory(target.value)
            const fRole = normalizeCategory(food.role || '')
            return fRole === tVal
        }

        if (target.type === 'food_id') return food.id === target.value || food.name === target.value
        if (target.type === 'tag') {
            if (!food.tags || !Array.isArray(food.tags)) return false
            const targetLower = target.value.toLocaleLowerCase('tr-TR')
            return food.tags.some((t: string) => t.toLocaleLowerCase('tr-TR') === targetLower)
        }
        if (target.type === 'name_contains') return food.name?.toLocaleLowerCase('tr-TR').includes(target.value.toLocaleLowerCase('tr-TR'))
        return false
    }

    private evaluateCriterion(criterionId: string, food: any, context: any): number {
        switch (criterionId) {
            case 'seasonality':
                return this.checkSeasonalitySoft(food, context.currentDate)
            case 'macro_targets':
                return 0
            case 'liked_food':
                return 0
            case 'disliked_food':
                return 0
            case 'variety':
            case 'repetition':
            case 'variety_repetition':
                // Check how many times this food was used this week
                // Return negative value if already used (penalty), positive if never used (bonus)
                const weeklyCount = context.weeklySelectedIds?.get(food.id) || 0

                // Adjustable Preference
                const preference = this.settings?.variety_preference || 'balanced'
                let penaltyMultiplier = 1.0

                if (preference === 'max_variety') {
                    penaltyMultiplier = 2.0 // Double the penalty
                } else if (preference === 'stability') {
                    penaltyMultiplier = 0.5 // Half the penalty
                }

                if (weeklyCount === 0) return 1 // Never used - max bonus
                if (weeklyCount === 1) return -0.5 * penaltyMultiplier // Used once
                if (weeklyCount === 2) return -1 * penaltyMultiplier // Used twice
                return -2 * penaltyMultiplier // Used 3+ times
            default:
                return 0
        }
    }

    // Track rotation index for 'rotate' mode across days


    /**
     * Get fixed foods for a slot based on fixed_meal rules
     */
    private getFixedFoodsForSlot(slotName: string, dayIndex: number): string[] {
        const fixedFoods: string[] = []
        const dayOfWeek = dayIndex + 1 // 1=Monday...7=Sunday

        for (const rule of this.rules) {
            if (rule.rule_type !== 'fixed_meal' || !rule.is_active) continue

            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef // Support both formats
            if (!def.target_slot || def.target_slot !== slotName) continue
            if (!def.foods || def.foods.length === 0) continue

            // Check scope_days if specified
            if (def.scope_days && def.scope_days.length > 0) {
                if (!def.scope_days.includes(dayOfWeek)) continue
            }

            // Check scope_weeks if specified
            if (!this.isRuleActiveForWeek(def)) continue

            // Apply selection mode
            switch (def.selection_mode) {
                case 'all':
                    // Add all foods
                    fixedFoods.push(...def.foods)
                    break

                case 'random':
                    // Pick X random foods from the list
                    const count = Math.min(def.count || 1, def.foods.length)
                    const shuffled = this.shuffleWithSeed([...def.foods], `${rule.id}-${dayIndex}`)
                    fixedFoods.push(...shuffled.slice(0, count))
                    break

                case 'rotate':
                    // Rotate through foods - each day gets next food in list
                    const rotKey = rule.id
                    const currentIndex = this.rotationIndices.get(rotKey) || 0
                    const foodIndex = currentIndex % def.foods.length
                    fixedFoods.push(def.foods[foodIndex])
                    this.rotationIndices.set(rotKey, currentIndex + 1)
                    break

                case 'by_day':
                    // Get foods assigned to this specific day
                    if (def.day_assignments && def.day_assignments[String(dayOfWeek)]) {
                        fixedFoods.push(...def.day_assignments[String(dayOfWeek)])
                    }
                    break

                default:
                    // Fallback: add all
                    fixedFoods.push(...def.foods)
            }
        }

        return fixedFoods
    }

    /**
     * Get extra roles from active rules with Min/Max logic
     * Returns object with mandatory (min) and optional (max) role lists
     */
    private getAdditionalRolesFromRules(slotName: string, dayIndex: number, context: any): { mandatory: string[], optional: string[] } {
        const mandatory: string[] = []
        const optional: string[] = []
        const dayOfWeek = dayIndex + 1

        // Sort rules by priority (highest first)
        const sortedRules = [...this.rules].sort((a, b) => (b.priority || 50) - (a.priority || 50))

        for (const rule of sortedRules) {
            if (!rule.is_active) continue
            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef // Support both formats

            // Checks scopes
            if (def.scope_meals && def.scope_meals.length > 0) {
                const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                if (!normalizedScopeMeals.includes(normalizeSlotName(slotName))) continue
            }
            if (def.scope_days && def.scope_days.length > 0 && !def.scope_days.includes(dayOfWeek)) continue

            // Check random_day_count - only apply on selected random days
            if (def.random_day_count) {
                const randomDays = this.getRandomDaysForRule(rule.id, def.random_day_count)
                if (!randomDays.includes(dayOfWeek)) continue
            }

            if (def.target) {
                let currentCount = 0
                // Check current count of this target in the slot/context
                const period = def.period || 'weekly'
                currentCount = this.countOccurrences(def.target, context, period)

                let minNeeded = 0
                if (def.min_count && def.min_count > currentCount) {
                    minNeeded = def.min_count - currentCount
                }

                let maxAllowed = 0
                if (def.max_count && def.max_count > (currentCount + minNeeded)) {
                    maxAllowed = def.max_count - (currentCount + minNeeded)
                }

                // Identify Roles
                let rolesToAdd: string[] = []
                if (def.target.type === 'role') {
                    let r = def.target.value
                    if (r === 'corba') r = 'soup'
                    rolesToAdd.push(r)
                } else if (def.target.type === 'category') {
                    const catLower = def.target.value.toLowerCase()
                    rolesToAdd.push(catLower)
                    const snackCategories = ['fruit', 'nuts', 'kuruyemiş', 'meyve', 'atıştırma']
                    if (snackCategories.some(sc => catLower.startsWith(sc) || catLower.includes(sc))) {
                        rolesToAdd.push('snack')
                    }
                }

                // Push needed copies
                // If multiple roles inferred (e.g. Nuts/Snack), pick the first one? 
                // Or try all? Usually logic implies ONE successful selection satisfies the rule.
                // We'll push the PRIMARY inferred role.
                if (rolesToAdd.length > 0) {
                    const primaryRole = rolesToAdd[0]
                    for (let i = 0; i < minNeeded; i++) mandatory.push(primaryRole)
                    for (let i = 0; i < maxAllowed; i++) optional.push(primaryRole)
                }
            }
        }

        return { mandatory, optional }
    }

    // ===== HELPER METHODS =====

    /**
     * Capitalize first letter of string
     */
    private capitalize(str: string): string {
        if (!str) return str
        return str.charAt(0).toUpperCase() + str.slice(1)
    }


    /**
     * Get a locked food based on Consistency Rules
     */
    private getLockedFood(category: string, role: string, context: any): any | null {
        // Entry validation log - Uncommmented for user debugging
        const hasConsistency = this.rules.some(r => r.rule_type === 'consistency' && r.is_active)
        if (hasConsistency) {
            // console.log(`[Consistency] Entry: ${category}/${role}. Rules count: ${this.rules.length}`)
        }

        // Iterate through consistency rules
        for (const rule of this.rules) {
            if (rule.rule_type !== 'consistency' || !rule.is_active) continue

            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef // Support both formats
            if (!def.target) continue

            // 1. Check Scope (Days/Meals)
            const dayIndex = context.dayIndex !== undefined ? context.dayIndex : 0
            const dayOfWeek = dayIndex + 1

            if (def.scope_meals && def.scope_meals.length > 0) {
                const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                const normalizedSlot = normalizeSlotName(String(context.slotName || ''))
                if (!normalizedSlot || !normalizedScopeMeals.includes(normalizedSlot)) continue
            }
            if (def.scope_days && def.scope_days.length > 0) {
                const normalizedScopeDays = def.scope_days.map((d: any) => Number(d)).filter((d: number) => Number.isFinite(d))
                if (!normalizedScopeDays.includes(dayOfWeek)) continue
            }

            // 2. Check Target Match
            // Does this rule apply to the current Category/Role request?
            let targetMatches = false

            // Normalize everything to standard keys (e.g. 'çorbalar' -> 'soup')
            const normRole = normalizeCategory(role)
            const normCat = normalizeCategory(category)
            const targetVal = normalizeCategory(def.target.value)

            // Debug Log
            // console.log(`[Consistency] Checking rule '${def.target.value}' (Norm: ${targetVal}) for ${category}/${role} (Norm: ${normCat}/${normRole})`)

            if (def.target.type === 'category') {
                if (normCat === targetVal) targetMatches = true
                // Match if role matches the category rule (e.g. rule is 'soup', role is 'soup')
                if (normRole === targetVal) targetMatches = true
            } else if (def.target.type === 'role') {
                if (normRole === targetVal) targetMatches = true
            } else if (def.target.type === 'tag') {
                // Tag rules apply if there is a locked food that matches this tag AND fits current slot
                targetMatches = true
            }

            if (!targetMatches) {
                continue
            }

            // 3. Find Locked Food
            // Check past selections based on duration
            const duration = def.lock_duration || 'weekly'
            let searchSource: any[] = []

            if (duration === 'daily') {
                searchSource = context.selectedFoods || []
            } else {
                // Weekly: Check global week history
                searchSource = this.currentWeekFoods
            }

            // Find the *first* food that matches this rule's target definition
            const locked = searchSource.find(f => this.matchesTarget(f, def.target))

            if (locked) {
                // Ensure the locked food actually fits the CURRENT slot category/role request
                // Use normalized check again
                const lockedCat = normalizeCategory(locked.category || '')
                const lockedRole = normalizeCategory(locked.role || '')
                const lockedMatchesRequestedScope =
                    lockedCat === normCat ||
                    lockedRole === normRole ||
                    (def.target.type === 'category' && (lockedCat === targetVal || lockedRole === targetVal)) ||
                    (def.target.type === 'role' && (lockedRole === targetVal))

                if (lockedMatchesRequestedScope) {
                    const lockRoleFromTarget = this.getCanonicalLockRole(
                        (def.target.type === 'category' || def.target.type === 'role')
                            ? (def.target.value || role || '')
                            : (role || '')
                    )
                    this.setWeeklyLockReason(lockRoleFromTarget, rule.id || null, rule.name || '')
                    return {
                        ...locked,
                        _consistencyRuleId: rule.id || null,
                        _consistencyRuleName: rule.name || ''
                    }
                }
            }
        }
        return null
    }

    /**
     * Enforce consistency locks for a concrete candidate food.
     * If candidate matches an active consistency target and that target is already
     * locked this week/day, return the locked food instead (with rule metadata).
     */
    private resolveConsistencyLockedFoodForCandidate(
        candidate: any,
        context: any,
        excludeIds: Set<string>,
        slotTags: Set<string>
    ): any | null {
        if (!candidate) return null

        const dayIndex = context.dayIndex !== undefined ? context.dayIndex : 0
        const dayOfWeek = dayIndex + 1
        const normalizedSlot = normalizeSlotName(String(context.slotName || ''))
        const requiredMealType = this.getRequiredMealTypeForSlot(normalizedSlot)

        const isMealTypeCompatible = (food: any): boolean => {
            if (!requiredMealType) return true
            const mealTypes = this.getMealTypesArray(food)
            if (mealTypes && mealTypes.length > 0) {
                return mealTypes.includes(requiredMealType)
            }
            return true
        }

        for (const rule of this.rules) {
            if (rule.rule_type !== 'consistency' || !rule.is_active) continue

            const rawDef = rule.definition as any
            const def = rawDef?.data || rawDef || {}
            if (!def?.target) continue

            // Scope filters
            if (def.scope_meals && def.scope_meals.length > 0) {
                const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                if (!normalizedScopeMeals.includes(normalizedSlot)) continue
            }
            if (def.scope_days && def.scope_days.length > 0) {
                const normalizedScopeDays = def.scope_days.map((d: any) => Number(d)).filter((d: number) => Number.isFinite(d))
                if (!normalizedScopeDays.includes(dayOfWeek)) continue
            }

            // Rule only matters if candidate belongs to its target
            if (!this.matchesTarget(candidate, def.target)) continue

            const duration = def.lock_duration || 'weekly'
            const searchSource = duration === 'daily'
                ? (context.selectedFoods || [])
                : this.currentWeekFoods

            const locked = searchSource.find((f: any) => this.matchesTarget(f, def.target))
            if (!locked) {
                // First occurrence for this consistency target in the current lock window.
                // Keep candidate but attach lock metadata so UI can show both chips.
                return {
                    ...candidate,
                    _consistencyRuleId: rule.id || null,
                    _consistencyRuleName: rule.name || ''
                }
            }

            // Same food: just attach lock metadata
            if (locked.id === candidate.id) {
                return {
                    ...candidate,
                    _consistencyRuleId: rule.id || null,
                    _consistencyRuleName: rule.name || ''
                }
            }

            // Strict consistency: if a lock exists for this target, do not allow
            // a different food when locked one cannot be used in current slot.
            if (excludeIds.has(locked.id)) return { __consistencyBlocked: true }
            if (!this.checkSeasonalityHard(locked, context.currentDate)) return { __consistencyBlocked: true }
            if (!isMealTypeCompatible(locked)) return { __consistencyBlocked: true }
            if (this.hasTagConflict(locked, slotTags)) return { __consistencyBlocked: true }

            return {
                ...locked,
                _consistencyRuleId: rule.id || null,
                _consistencyRuleName: rule.name || ''
            }
        }

        return null
    }

    /**
     * Filter foods by banned tags (from program template)
     */
    private filterFoodsByBannedTags(foods: any[], bannedTags: string[]): any[] {
        if (!bannedTags?.length) return foods

        const normalizedBanned = bannedTags.map(t => t.toLowerCase().trim())

        return foods.filter(food => {
            const foodTags = (food.tags || []).map((t: string) => t.toLowerCase().trim())
            const foodName = (food.name || '').toLowerCase()

            // Check if any food tag matches banned tags
            const hasTagMatch = foodTags.some((tag: string) =>
                normalizedBanned.some(banned => tag.includes(banned) || banned.includes(tag))
            )

            // Also check food name for banned keywords
            const hasNameMatch = normalizedBanned.some(banned => foodName.includes(banned))

            return !hasTagMatch && !hasNameMatch
        })
    }

    // ROTATION LOGIC

    private async fetchRotationHistory(): Promise<Map<string, string[]>> {
        const history = new Map<string, string[]>()
        if (!this.patientId) return history
        try {
            const planId = await this.getPatientPlanId()
            if (!planId) return history
            
            // Get all weeks, days, meals ordered to reconstruct history
            const { data: weeks } = await supabase
                .from('diet_weeks')
                .select(`
                    id, week_number, 
                    diet_days ( 
                        id, day_number, 
                        diet_meals ( 
                            id, meal_time, food_id, 
                            foods ( id, name, role, category, tags ) 
                        ) 
                    )
                `)
                .eq('diet_plan_id', planId)
                .order('week_number', { ascending: true })
                .limit(20)

            if (!weeks) return history

            for (const rule of this.rules) {
                if (rule.rule_type !== 'rotation' || !rule.is_active) continue
                const def = (rule.definition as any).data || rule.definition
                if (!def.target) continue
                
                const key = `rotation_${rule.id}`
                const usedFoodsSequence: string[] = []

                for (const week of weeks) {
                    const days = ((week as any).diet_days || []).sort((a: any, b: any) => a.day_number - b.day_number)
                    for (const day of days) {
                        for (const meal of day.diet_meals || []) {
                            const food = meal.foods
                            if (food && this.matchesTarget(food, def.target)) {
                                usedFoodsSequence.push(food.id)
                            }
                        }
                    }
                }
                history.set(key, usedFoodsSequence)
            }
        } catch (err) { console.warn('[Rotation] Failed to fetch history:', err) }
        return history
    }

    private getPatientPlanId(): Promise<string> {
        return new Promise(async (resolve) => {
            try {
                const { data } = await supabase.from('diet_plans').select('id').eq('patient_id', this.patientId).eq('status', 'active').maybeSingle()
                resolve(data?.id || '')
            } catch { resolve('') }
        })
    }

    private getNextRotationFood(category: string, lockRole: string, context: any, eligibleFoodIds: Set<string>, excludeIds: Set<string>, slotTags: Set<string>, hasMealTypeSupport: (f:any)=>boolean): { food: any, state: any } | null {
        // Find if this role/category matches any active rotation rule
        let activeRotState = null
        for (const state of this.rotationStates.values()) {
            if (state.target && state.target.type === 'role' && this.getCanonicalLockRole(state.target.value) === lockRole) activeRotState = state;
            else if (state.target && state.target.type === 'category' && state.target.value === category) activeRotState = state;
            if (activeRotState) break;
        }

        if (!activeRotState) return null;

        const combinedHistory = [...activeRotState.history, ...activeRotState.sessionUsed]
        
        if (activeRotState.mode === 'sequential') {
            let startIdx = 0
            if (combinedHistory.length > 0) {
                const lastUsedId = combinedHistory[combinedHistory.length - 1]
                const lastIdx = activeRotState.items.findIndex(item => item.food_id === lastUsedId)
                startIdx = lastIdx >= 0 ? (lastIdx + 1) % activeRotState.items.length : 0
            }
            
            for (let attempt = 0; attempt < activeRotState.items.length; attempt++) {
                const idx = (startIdx + attempt) % activeRotState.items.length
                const candidate = activeRotState.items[idx]
                
                if (excludeIds.has(candidate.food_id)) continue
                if (!eligibleFoodIds.has(candidate.food_id)) continue
                if (activeRotState.non_consecutive && combinedHistory.length > 0 && combinedHistory[combinedHistory.length - 1] === candidate.food_id) continue
                
                const food = this.allFoods.find(f => f.id === candidate.food_id)
                if (!food) continue
                if (this.hasTagConflict(food, slotTags)) continue
                if (!hasMealTypeSupport(food)) continue
                if (!this.checkSeasonalityHard(food, context.currentDate)) continue
                
                return { food, state: activeRotState }
            }
        } else if (activeRotState.mode === 'random_no_repeat') {
            const uniqueIds = [...new Set(activeRotState.items.map(i => String(i.food_id)))]
            const cycleUsedCount = combinedHistory.length % uniqueIds.length
            const recentSet = new Set(cycleUsedCount === 0 ? [] : combinedHistory.slice(-cycleUsedCount))
            
            let candidates = uniqueIds.filter(id => !recentSet.has(id))
            if (candidates.length === 0) {
                candidates = uniqueIds // Wrap around theoretically (should not hit with modulo)
            }
            
            candidates = candidates.filter(id => {
                if (excludeIds.has(id)) return false
                if (!eligibleFoodIds.has(id)) return false
                if (activeRotState.non_consecutive && combinedHistory.length > 0 && combinedHistory[combinedHistory.length - 1] === id) return false
                const food = this.allFoods.find(f => f.id === id)
                if (!food) return false
                if (this.hasTagConflict(food, slotTags)) return false
                if (!hasMealTypeSupport(food)) return false
                if (!this.checkSeasonalityHard(food, context.currentDate)) return false
                return true
            })
            
            if (candidates.length > 0) {
                const pickedId = candidates[Math.floor(Math.random() * candidates.length)]
                const food = this.allFoods.find(f => f.id === pickedId)
                if (food) return { food, state: activeRotState }
            }
        }
        return null
    }

    private async initRotationGenerators() {
        const rotationRules = this.rules.filter(r => r.rule_type === 'rotation' && r.is_active)
        if (rotationRules.length === 0) return
        
        const history = await this.fetchRotationHistory()
        
        for (const rule of rotationRules) {
            const def = (rule.definition as any).data || rule.definition
            if (!def.target || !def.items || def.items.length === 0) continue
            
            const expandedItems: { food_id: string, food_name: string }[] = []
            for (const item of def.items) {
                const count = item.repeat_count || 1
                for (let r = 0; r < count; r++) expandedItems.push({ food_id: item.food_id, food_name: item.food_name })
            }
            if (expandedItems.length === 0) continue
            
            this.rotationStates.set(rule.id, {
                ruleId: rule.id || '',
                ruleName: rule.name || '',
                target: def.target,
                mode: def.mode || 'sequential',
                non_consecutive: !!def.non_consecutive,
                items: expandedItems,
                history: history.get(`rotation_${rule.id}`) || [],
                sessionUsed: []
            })
        }
    }

    // FREQUENCY BUDGET

    private getFrequencyBudget(): Array<{ target: any, remaining: number, ruleName: string }> {
        const budgets: Array<{ target: any, remaining: number, ruleName: string }> = []
        for (const rule of this.rules) {
            if (rule.rule_type !== 'frequency' || !rule.is_active) continue
            const def = (rule.definition as any).data || rule.definition
            if (!def.target || !def.max_count || def.period !== 'weekly') continue
            const count = this.currentWeekFoods.filter((f: any) => this.matchesTarget(f, def.target)).length
            const remaining = def.max_count - count
            if (remaining > 0) budgets.push({ target: def.target, remaining, ruleName: rule.name })
        }
        return budgets.sort((a, b) => b.remaining - a.remaining)
    }


    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SMART BALANCE: Iteratively improve an existing plan's macro balance
    // Strategies: 1) Portion adjust  2) Food swap  3) Food add/remove
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    public async balancePlan(
        plan: any,
        mode: 'weekly' | 'daily' = 'weekly',
        targetDay?: number
    ): Promise<{ plan: any, changes: string[] }> {
        const changes: string[] = []
        const newPlan = JSON.parse(JSON.stringify(plan))
        const targetMacros = newPlan.targetMacros || { calories: 1800, protein: 90, carbs: 180, fat: 60 }
        const tolerances = this.settings?.portion_settings?.macro_tolerances || {
            calories: { min: 90, max: 110 },
            protein: { min: 80, max: 120 },
            carb: { min: 80, max: 120 },
            fat: { min: 80, max: 120 }
        }
        const macroPriorities = this.settings?.macro_priorities || { protein: 5, carb: 5, fat: 5 }
        const portionSettings = this.settings?.portion_settings || {}
        const globalMin = (portionSettings as any).global_min || 0.5
        const globalMax = (portionSettings as any).global_max || 2.0
        const stepVal = (portionSettings as any).step_value || 0.25

        // Determine which days to balance
        const daysToBalance: number[] = mode === 'daily' && targetDay
            ? [targetDay]
            : [1, 2, 3, 4, 5, 6, 7]

        // Rebuild currentWeekFoods from the plan for frequency checking
        this.currentWeekFoods = newPlan.meals.map((m: any) => ({
            ...m.food,
            dayIndex: m.day - 1,
            slot: m.slot,
            portion_multiplier: m.portion_multiplier || 1
        }))

        // ══â•  SMART BALANCE v2 â€” Worst-day-first, single-step, simulate-then-commit ══â• 
        const isDayBalanced = (dayMeals: any[]) => {
            const totals = calcDayTotals(dayMeals)
            const calPct = targetMacros.calories > 0 ? (totals.calories / targetMacros.calories) * 100 : 100
            return calPct >= (tolerances.calories?.min ?? 90) && calPct <= (tolerances.calories?.max ?? 110)
        }

        const getCalorieDeviation = (dayMeals: any[]) => {
            const totals = calcDayTotals(dayMeals)
            const calPct = targetMacros.calories > 0 ? (totals.calories / targetMacros.calories) * 100 : 100
            if (calPct < (tolerances.calories?.min ?? 90)) return (tolerances.calories?.min ?? 90) - calPct
            if (calPct > (tolerances.calories?.max ?? 110)) return calPct - (tolerances.calories?.max ?? 110)
            return 0
        }

        const getDayDeviations = (dayMeals: any[]) => {
            const totals = calcDayTotals(dayMeals)
            const devs: Array<{ macro: string, diff: number, isOver: boolean, isUnder: boolean }> = []
            
            // Calorie check
            const calPct = targetMacros.calories > 0 ? (totals.calories / targetMacros.calories) * 100 : 100
            if (calPct < (tolerances.calories?.min ?? 90)) {
                devs.push({ macro: 'calories', diff: (tolerances.calories?.min ?? 90) - calPct, isOver: false, isUnder: true })
            } else if (calPct > (tolerances.calories?.max ?? 110)) {
                devs.push({ macro: 'calories', diff: calPct - (tolerances.calories?.max ?? 110), isOver: true, isUnder: false })
            }

            // Macros check (optional but helps guiding swaps)
            const macros: Array<'protein' | 'carbs' | 'fat'> = ['protein', 'carbs', 'fat']
            for (const m of macros) {
                const target = targetMacros[m === 'carbs' ? 'carbs' : m]
                if (!target || target <= 0) continue
                const pct = (totals[m] / target) * 100
                const tol = tolerances[m === 'carbs' ? 'carb' : m] || { min: 80, max: 120 }
                if (pct < tol.min) {
                    devs.push({ macro: m, diff: tol.min - pct, isOver: false, isUnder: true })
                } else if (pct > tol.max) {
                    devs.push({ macro: m, diff: pct - tol.max, isOver: true, isUnder: false })
                }
            }

            // Sort by priority (weighted by macroPriorities)
            return devs.sort((a, b) => {
                const prioA = (macroPriorities as any)[a.macro === 'calories' ? 'protein' : a.macro] || 5
                const prioB = (macroPriorities as any)[b.macro === 'calories' ? 'protein' : b.macro] || 5
                return (b.diff * prioB) - (a.diff * prioA)
            })
        }

        const calcDayTotals = (dayMeals: any[]) => {
            return dayMeals.reduce((acc, m) => {
                const mult = m.portion_multiplier || 1
                acc.calories += (m.food?.calories || 0) * mult
                acc.protein += (m.food?.protein || 0) * mult
                acc.carbs += (m.food?.carbs || 0) * mult
                acc.fat += (m.food?.fat || 0) * mult
                return acc
            }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
        }

        const getWeeklyCaloriePct = () => {
            const allTotals = newPlan.meals.reduce((acc: any, m: any) => {
                const mult = m.portion_multiplier || 1
                acc.calories += (m.food?.calories || 0) * mult
                return acc
            }, { calories: 0 })
            const totalTarget = targetMacros.calories * 7
            return totalTarget > 0 ? (allTotals.calories / totalTarget) * 100 : 100
        }

        const getEffectivePriority = (f: any) => {
            if (!f) return 0
            // Check food_score_overrides first (patient > program > global cascade)
            if (this.settings?.food_score_overrides && f.id in this.settings.food_score_overrides) {
                return this.settings.food_score_overrides[f.id]
            }
            if (f.priority_score === 0) return 0
            return f.priority_score ?? 5
        }

        const getVarietyScore = (f: any, dayIndex: number) => {
            let penalty = 0
            // Adjacent day check
            const adjDayFoods = newPlan.meals.filter((m: any) => Math.abs(m.day - (dayIndex + 1)) === 1).map((m: any) => m.food?.id)
            if (adjDayFoods.includes(f.id)) penalty += 2000

            // Weekly count penalty (quadratic)
            const weekCount = this.currentWeekFoods.filter((wf: any) => wf.id === f.id).length
            penalty += (weekCount ** 2) * 100

            // Cross-week historical penalty
            const historicalCount = this.historicalFoodCounts?.get(f.id) || 0
            if (historicalCount > 0 && this.historicalAvgUsage > 0) {
                const relativeUsage = historicalCount / this.historicalAvgUsage
                penalty += Math.floor(relativeUsage * 300)
            }

            return -penalty
        }

        // ══â•  MAIN LOOP ══â• 
        const maxGlobalPasses = mode === 'weekly' ? 5 : 3
        const weeklyCalBefore = getWeeklyCaloriePct()

        for (let globalPass = 0; globalPass < maxGlobalPasses; globalPass++) {
            const changesBefore = changes.length

            // Sort days by calorie deviation (worst first)
            const sortedDays = daysToBalance
                .map(dn => ({
                    dayNum: dn,
                    meals: newPlan.meals.filter((m: any) => m.day === dn),
                }))
                .filter(d => d.meals.length > 0)
                .sort((a, b) => getCalorieDeviation(b.meals) - getCalorieDeviation(a.meals))

            for (const { dayNum, meals: dayMeals } of sortedDays) {
                // Skip days already within tolerance
                if (isDayBalanced(dayMeals)) continue

                const dayIndex = dayNum - 1
                const exhaustedPortionIds = new Set<string>()
                const swappedSlots = new Set<string>()

                // ══â•  INNER LOOP: keep working on this day until balanced or stuck ══â• 
                for (let dayIter = 0; dayIter < 15; dayIter++) {
                    if (isDayBalanced(dayMeals)) break

                    const deviations = getDayDeviations(dayMeals)
                    if (deviations.length === 0) break

                    const dev = deviations[0]
                    const macroKey = dev.macro === 'calories' ? 'calories' : dev.macro as 'protein' | 'carbs' | 'fat'
                    let madeChange = false

                    // ──â”€ STRATEGY 1: PORTION STEP ──────────────────────────â”€
                    if (dev.isOver) {
                        const candidates = dayMeals.filter((m: any) => {
                            if (m.food?.portion_fixed || m.isLocked) return false
                            if (exhaustedPortionIds.has(m.food?.id)) return false
                            const foodMin = m.food?.min_quantity ?? globalMin
                            const val = macroKey === 'carbs' ? (m.food?.carbs || 0) : (m.food?.[macroKey] || 0)
                            return val > 0 && (m.portion_multiplier || 1) > foodMin + 0.01
                        }).sort((a: any, b: any) => {
                            const valA = (macroKey === 'carbs' ? (a.food?.carbs || 0) : (a.food?.[macroKey] || 0)) * (a.portion_multiplier || 1)
                            const valB = (macroKey === 'carbs' ? (b.food?.carbs || 0) : (b.food?.[macroKey] || 0)) * (b.portion_multiplier || 1)
                            return valB - valA
                        })

                        if (candidates.length > 0) {
                            const m = candidates[0]
                            const oldMult = m.portion_multiplier || 1
                            const foodStep = m.food?.step ?? stepVal
                            const actualMin = m.food?.min_quantity ?? globalMin
                            const proposedMult = Math.max(actualMin, Math.round((oldMult - foodStep) * 100) / 100)

                            if (proposedMult !== oldMult) {
                                m.portion_multiplier = proposedMult
                                const simTotals = calcDayTotals(dayMeals)
                                const calPct = targetMacros.calories > 0 ? (simTotals.calories / targetMacros.calories) * 100 : 100
                                if (calPct < (tolerances.calories?.min ?? 90) - 3) {
                                    m.portion_multiplier = oldMult
                                    exhaustedPortionIds.add(m.food?.id)
                                } else {
                                    if (proposedMult <= actualMin) exhaustedPortionIds.add(m.food?.id)
                                    changes.push(`Gün ${dayNum}: ↓ ${m.food?.name} x${oldMult}→x${proposedMult} (${dev.macro} fazla)`)
                                    madeChange = true
                                }
                            } else {
                                exhaustedPortionIds.add(m.food?.id)
                            }
                        }
                    }

                    if (dev.isUnder && !madeChange) {
                        const candidates = dayMeals.filter((m: any) => {
                            if (m.food?.portion_fixed || m.isLocked) return false
                            if (exhaustedPortionIds.has(m.food?.id)) return false
                            const foodMax = m.food?.max_quantity ?? globalMax
                            const val = macroKey === 'carbs' ? (m.food?.carbs || 0) : (m.food?.[macroKey] || 0)
                            return val > 0 && (m.portion_multiplier || 1) < foodMax - 0.01
                        }).sort((a: any, b: any) => {
                            const ratioA = (macroKey === 'carbs' ? (a.food?.carbs || 0) : (a.food?.[macroKey] || 0)) / Math.max(a.food?.calories || 1, 1)
                            const ratioB = (macroKey === 'carbs' ? (b.food?.carbs || 0) : (b.food?.[macroKey] || 0)) / Math.max(b.food?.calories || 1, 1)
                            return ratioB - ratioA
                        })

                        if (candidates.length > 0) {
                            const m = candidates[0]
                            const oldMult = m.portion_multiplier || 1
                            const foodStep = m.food?.step ?? stepVal
                            const actualMax = m.food?.max_quantity ?? globalMax
                            const proposedMult = Math.min(actualMax, Math.round((oldMult + foodStep) * 100) / 100)

                            if (proposedMult !== oldMult) {
                                m.portion_multiplier = proposedMult
                                const simTotals = calcDayTotals(dayMeals)
                                const calPct = targetMacros.calories > 0 ? (simTotals.calories / targetMacros.calories) * 100 : 100
                                if (calPct > (tolerances.calories?.max ?? 110) + 3) {
                                    m.portion_multiplier = oldMult
                                    exhaustedPortionIds.add(m.food?.id)
                                } else {
                                    if (proposedMult >= actualMax) exhaustedPortionIds.add(m.food?.id)
                                    changes.push(`Gün ${dayNum}: ↑ ${m.food?.name} x${oldMult}→x${proposedMult} (${dev.macro} eksik)`)
                                    madeChange = true
                                }
                            } else {
                                exhaustedPortionIds.add(m.food?.id)
                            }
                        }
                    }

                    // ──â”€ STRATEGY 2: FOOD SWAP (if portion didn't help or day still unbalanced) ──â”€
                    if (!madeChange && !isDayBalanced(dayMeals)) {
                        const swapDevs = getDayDeviations(dayMeals)
                        const swapDev = swapDevs[0]
                        if (swapDev) {
                            const swapMacro = swapDev.macro === 'calories' ? 'calories' : swapDev.macro as 'protein' | 'carbs' | 'fat'

                            let targetMeal: any = null
                            if (swapDev.isOver) {
                                targetMeal = dayMeals
                                    .filter((m: any) => {
                                        if (m.food?.portion_fixed) return false
                                        if (m.food?.is_custom) return false
                                        
                                        const r = this.getCanonicalLockRole(m.food?.role || '')
                                        if (r === 'maindish' || r === 'breakfast_main') return false
                                        
                                        const isMandatoryMain = m.source?.is_required_role && 
                                            (this.getCanonicalLockRole(m.source.required_role_name || '') === 'maindish')
                                        if (isMandatoryMain) return false

                                        return !swappedSlots.has(`${m.slot}_${m.food?.id}`)
                                    })
                                    .sort((a: any, b: any) => {
                                        const valA = (swapMacro === 'carbs' ? (a.food?.carbs || 0) : (a.food?.[swapMacro] || 0)) * (a.portion_multiplier || 1)
                                        const valB = (swapMacro === 'carbs' ? (b.food?.carbs || 0) : (b.food?.[swapMacro] || 0)) * (b.portion_multiplier || 1)
                                        return valB - valA
                                    })[0]
                            } else {
                                targetMeal = dayMeals
                                    .filter((m: any) => {
                                        if (m.food?.portion_fixed) return false
                                        if (m.food?.is_custom) return false
                                        
                                        const r = this.getCanonicalLockRole(m.food?.role || '')
                                        if (r === 'maindish' || r === 'breakfast_main') return false
                                        
                                        const isMandatoryMain = m.source?.is_required_role && 
                                            (this.getCanonicalLockRole(m.source.required_role_name || '') === 'maindish')
                                        if (isMandatoryMain) return false

                                        return !swappedSlots.has(`${m.slot}_${m.food?.id}`)
                                    })
                                    .sort((a: any, b: any) => {
                                        const valA = (swapMacro === 'carbs' ? (a.food?.carbs || 0) : (a.food?.[swapMacro] || 0)) * (a.portion_multiplier || 1)
                                        const valB = (swapMacro === 'carbs' ? (b.food?.carbs || 0) : (b.food?.[swapMacro] || 0)) * (b.portion_multiplier || 1)
                                        return valA - valB
                                    })[0]
                            }

                            if (targetMeal?.food) {
                                swappedSlots.add(`${targetMeal.slot}_${targetMeal.food?.id}`)
                                const role = targetMeal.food.role || 'sideDish'
                                const slot = targetMeal.slot
                                const excludeIds = new Set(dayMeals.map((m: any) => m.food?.id).filter(Boolean))

                                const slotTags = new Set<string>()
                                dayMeals.filter((m: any) => m.slot === slot && m.food?.id !== targetMeal.food.id)
                                    .forEach((m: any) => { if (m.food) this.addFoodTags(slotTags, m.food) })

                                // Collect foods in the SAME SLOT (excluding the food being swapped out)
                                const slotFoodsForAffinity = dayMeals
                                    .filter((m: any) => m.slot === slot && m.food?.id !== targetMeal.food.id)
                                    .map((m: any) => m.food)
                                    .filter(Boolean)

                                const swapCandidates = this.eligibleFoods
                                    .filter(f => {
                                        if (excludeIds.has(f.id)) return false
                                        if (f.role !== role) return false
                                        if (this.hasTagConflict(f, slotTags)) return false
                                        if (!this.checkSeasonalityHard(f, this.today)) return false
                                        const weekCount = this.currentWeekFoods.filter(wf => wf.id === f.id).length
                                        if (this.hasReachedWeeklyCap(f, weekCount)) return false
                                        if (getEffectivePriority(f) === 0) return false
                                        // AFFINITY GUARD: Block forbidden combinations
                                        if (this.hasForbiddenAffinityConflict(f, slotFoodsForAffinity)) return false
                                        return true
                                    })
                                    .map(f => {
                                        const macroVal = swapMacro === 'carbs' ? (f.carbs || 0) : (f[swapMacro] || 0)
                                        const oldMacroVal = swapMacro === 'carbs' ? (targetMeal.food?.carbs || 0) : (targetMeal.food?.[swapMacro] || 0)
                                        const improvement = swapDev.isOver ? (oldMacroVal - macroVal) : (macroVal - oldMacroVal)
                                        const priorityMod = getEffectivePriority(f) / 5
                                        const varietyBonus = getVarietyScore(f, dayIndex)
                                        return { food: f, improvement, score: improvement * priorityMod + varietyBonus }
                                    })
                                    .filter(c => c.improvement > 2)
                                    .sort((a, b) => b.score - a.score)

                                if (swapCandidates.length > 0) {
                                    const best = swapCandidates[0]
                                    const oldFood = targetMeal.food
                                    const oldFoodId = oldFood?.id
                                    const savedFood = targetMeal.food
                                    const savedMult = targetMeal.portion_multiplier

                                    targetMeal.food = best.food
                                    targetMeal.portion_multiplier = 1

                                    const simTotals = calcDayTotals(dayMeals)
                                    const calPct = targetMacros.calories > 0 ? (simTotals.calories / targetMacros.calories) * 100 : 100
                                    const calOk = calPct >= (tolerances.calories?.min ?? 90) - 3 && calPct <= (tolerances.calories?.max ?? 110) + 3

                                    if (calOk) {
                                        const removeIdx = this.currentWeekFoods.findIndex(wf => wf.id === oldFoodId && wf.dayIndex === dayIndex)
                                        if (removeIdx >= 0) this.currentWeekFoods.splice(removeIdx, 1)
                                        this.currentWeekFoods.push({ ...best.food, dayIndex, slot })
                                        changes.push(`Gün ${dayNum}: 🔄 ${oldFood?.name} → ${best.food.name} (${swapDev.macro} ${swapDev.isOver ? '↓' : '↑'})`)
                                        madeChange = true
                                    } else {
                                        targetMeal.food = savedFood
                                        targetMeal.portion_multiplier = savedMult
                                    }
                                }
                            }
                        }
                    }

                    // ──â”€ STRATEGY 3: ADD / REMOVE (if still unbalanced) ────â”€
                    if (!madeChange && !isDayBalanced(dayMeals)) {
                        const addDevs = getDayDeviations(dayMeals)
                        const addDev = addDevs[0]
                        if (addDev) {
                            const addMacro = addDev.macro === 'calories' ? 'calories' : addDev.macro as 'protein' | 'carbs' | 'fat'

                            if (addDev.isUnder) {
                                const slotsInDay = Array.from(new Set(dayMeals.map((m: any) => m.slot))) as string[]
                                const bestSlot = slotsInDay[slotsInDay.length - 1] || 'AKŞAM'
                                const excludeIds = new Set(dayMeals.map((m: any) => m.food?.id).filter(Boolean))
                                const bestSlotMeals = dayMeals.filter((m: any) => m.slot === bestSlot)
                                const uniqueRolesForAdd = new Set(
                                    bestSlotMeals
                                        .map((m: any) => this.getCanonicalLockRole(m?.food?.role || ''))
                                        .filter(Boolean)
                                )
                                const uniqueRolesToProtect = new Set(['maindish', 'soup', 'bread', 'salad'])

                                // Collect foods in the SAME SLOT for affinity checking
                                const addSlotFoodsForAffinity = dayMeals
                                    .filter((m: any) => m.slot === bestSlot)
                                    .map((m: any) => m.food)
                                    .filter(Boolean)

                                const addCandidates = this.eligibleFoods
                                    .filter(f => {
                                        if (excludeIds.has(f.id)) return false
                                        if (!this.isMealTypeCompatibleWithSlot(f, bestSlot)) return false
                                        if (!this.checkSeasonalityHard(f, this.today)) return false
                                        const weekCount = this.currentWeekFoods.filter(wf => wf.id === f.id).length
                                        if (this.hasReachedWeeklyCap(f, weekCount)) return false
                                        if (getEffectivePriority(f) === 0) return false
                                        const candidateRole = this.getCanonicalLockRole(f.role || '')
                                        if (candidateRole === 'maindish') return false
                                        if (candidateRole && uniqueRolesToProtect.has(candidateRole) && uniqueRolesForAdd.has(candidateRole)) return false
                                        // AFFINITY GUARD: Block forbidden combinations
                                        if (this.hasForbiddenAffinityConflict(f, addSlotFoodsForAffinity)) return false

                                        // NEW: Rotation (Lock) Consistency Check
                                        if (Planner.LOCKABLE_ROLES.includes(candidateRole)) {
                                            const rotationContext = { dayIndex: dayNum - 1, slotName: bestSlot };
                                            const lockedFood = this.getLockedFood(f.category || '', f.role || '', rotationContext)
                                            if (lockedFood && f.id !== lockedFood.id) return false
                                        }

                                        const macroVal = addMacro === 'carbs' ? (f.carbs || 0) : (f[addMacro] || 0)
                                        return macroVal > 3
                                    })
                                    .map(f => {
                                        const macroVal = addMacro === 'carbs' ? (f.carbs || 0) : (f[addMacro] || 0)
                                        const calRatio = macroVal / Math.max(f.calories || 1, 1)
                                        const priorityMod = getEffectivePriority(f) / 5
                                        const varietyBonus = getVarietyScore(f, dayIndex)
                                        // Underused role/category bonus: prefer foods from neglected categories
                                        const candRole = this.getCanonicalLockRole(f.role || '')
                                        const candCategory = (f.category || '').toLocaleLowerCase('tr-TR')
                                        const roleCount = this.currentWeekFoods.filter((wf: any) =>
                                            this.getCanonicalLockRole(wf.role || '') === candRole
                                        ).length
                                        const categoryCount = this.currentWeekFoods.filter((wf: any) =>
                                            (wf.category || '').toLocaleLowerCase('tr-TR') === candCategory
                                        ).length
                                        const totalRoles = new Set(this.currentWeekFoods.map((wf: any) => this.getCanonicalLockRole(wf.role || '')).filter(Boolean)).size
                                        const avgRoleCount = this.currentWeekFoods.length / Math.max(1, totalRoles)
                                        const underuseBonus = Math.max(0, (avgRoleCount - roleCount)) * 500 + Math.max(0, (avgRoleCount - categoryCount)) * 300
                                        // Frequency budget bonus: foods matching rules with remaining slots get extra priority
                                        const freqBudgets = this.getFrequencyBudget()
                                        let freqBudgetBonus = 0
                                        for (const budget of freqBudgets) {
                                            if (this.matchesTarget(f, budget.target) && budget.remaining > 0) {
                                                freqBudgetBonus += budget.remaining * 400
                                            }
                                        }
                                        return { food: f, score: calRatio * 1000 * priorityMod + varietyBonus + underuseBonus + freqBudgetBonus }
                                    })
                                    .sort((a, b) => b.score - a.score)

                                if (addCandidates.length > 0) {
                                    const best = addCandidates[0]
                                    const newMeal = {
                                        day: dayNum,
                                        dayName: (dayMeals[0] as any)?.dayName || '',
                                        slot: bestSlot,
                                        food: best.food,
                                        portion_multiplier: best.food.min_quantity ?? 1,
                                        source: { 
                                            type: 'balance_add', 
                                            rule: 'Dengele Ekleme',
                                            rule_id: 'system_smart_balance'
                                        }
                                    }

                                    dayMeals.push(newMeal)
                                    const simTotals = calcDayTotals(dayMeals)
                                    const calPct = targetMacros.calories > 0 ? (simTotals.calories / targetMacros.calories) * 100 : 100

                                    if (calPct <= (tolerances.calories?.max ?? 110) + 3) {
                                        newPlan.meals.push(newMeal as any)
                                        this.currentWeekFoods.push({ ...best.food, dayIndex, slot: bestSlot })
                                        changes.push(`Gün ${dayNum}: ➕ ${best.food.name} (${addDev.macro} eksik, ${bestSlot}'e eklendi)`)
                                        madeChange = true
                                    } else {
                                        dayMeals.pop()
                                    }
                                }
                            }

                            if (addDev.isOver && !madeChange) {
                                const removable = dayMeals
                                    .filter((m: any) => {
                                        if (m.food?.portion_fixed) return false
                                        if (m.food?.is_custom) return false
                                        const r = this.getCanonicalLockRole(m.food?.role || '')
                                        if (r === 'maindish' || r === 'breakfast_main') return false
                                        
                                        const isMandatoryMain = m.source?.is_required_role && 
                                            (this.getCanonicalLockRole(m.source.required_role_name || '') === 'maindish')
                                        if (isMandatoryMain) return false // Protect absolute

                                        return true
                                    })
                                    .sort((a: any, b: any) => {
                                        const valA = (addMacro === 'carbs' ? (a.food?.carbs || 0) : (a.food?.[addMacro] || 0)) * (a.portion_multiplier || 1)
                                        const valB = (addMacro === 'carbs' ? (b.food?.carbs || 0) : (b.food?.[addMacro] || 0)) * (b.portion_multiplier || 1)
                                        return valB - valA
                                    })

                                if (removable.length > 0) {
                                    const toRemove = removable[0]
                                    const foodId = toRemove.food?.id
                                    const weekCount = this.currentWeekFoods.filter(wf => wf.id === foodId).length
                                    let canRemove = true
                                    // Check against Frequency Rules min_count
                                    for (const rule of this.rules) {
                                        if (rule.rule_type !== 'frequency' || !rule.is_active) continue
                                        const def = (rule.definition as any).data || rule.definition
                                        if (def.target && this.matchesTarget(toRemove.food, def.target)) {
                                            if (def.min_count && weekCount <= def.min_count) {
                                                canRemove = false
                                                break
                                            }
                                        }
                                    }

                                    // Check against Slot Settings minItems
                                    if (canRemove) {
                                        const normalizedMealSlot = normalizeSlotName(toRemove.slot)
                                        // slot_config is stored as ARRAY in DB, parse correctly
                                        let slotConfig: any = DEFAULT_SLOT_CONFIG[normalizedMealSlot]
                                            || Object.values(DEFAULT_SLOT_CONFIG)[0]
                                        if (this.settings?.slot_config && Array.isArray(this.settings.slot_config)) {
                                            const match = (this.settings.slot_config as any[]).find(
                                                (c: any) => normalizeSlotName(String(c.name || '')) === normalizedMealSlot
                                            )
                                            if (match) {
                                                slotConfig = {
                                                    ...slotConfig,
                                                    minItems: match.min_items ?? slotConfig.minItems,
                                                    maxItems: match.max_items ?? slotConfig.maxItems
                                                }
                                            }
                                        }
                                        
                                        const currentSlotMeals = dayMeals.filter((m: any) => m.slot === toRemove.slot)
                                        if (currentSlotMeals.length <= (slotConfig?.minItems || 1)) {
                                            canRemove = false
                                        }
                                    }

                                    if (canRemove) {
                                        const deleteIdx = dayMeals.indexOf(toRemove)
                                        if (deleteIdx >= 0) dayMeals.splice(deleteIdx, 1)
                                        const simTotals = calcDayTotals(dayMeals)
                                        const calPct = targetMacros.calories > 0 ? (simTotals.calories / targetMacros.calories) * 100 : 100

                                        if (calPct >= (tolerances.calories?.min ?? 90) - 3) {
                                            const planIdx = newPlan.meals.findIndex((m: any) => m === toRemove || (m.food?.id === foodId && m.day === dayNum && m.slot === toRemove.slot))
                                            if (planIdx >= 0) newPlan.meals.splice(planIdx, 1)
                                            const wfIdx = this.currentWeekFoods.findIndex(wf => wf.id === foodId && wf.dayIndex === dayIndex)
                                            if (wfIdx >= 0) this.currentWeekFoods.splice(wfIdx, 1)
                                            changes.push(`Gün ${dayNum}: ➖ ${toRemove.food?.name} (${addDev.macro} fazla, ${toRemove.slot}'den çıkarıldı)`)
                                            madeChange = true
                                        } else {
                                            if (deleteIdx >= 0) dayMeals.splice(deleteIdx, 0, toRemove)
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (!madeChange) break
                } // end dayIter
            } // end of sortedDays

            // Early stop: no changes this pass
            if (changes.length === changesBefore) break

            // Weekly average protection: if weekly avg drifted too far, stop
            const weeklyCalNow = getWeeklyCaloriePct()
            if (Math.abs(weeklyCalNow - 100) > Math.abs(weeklyCalBefore - 100) + 5) {
                // We made the weekly average worse â€” stop further passes
                break
            }
        } // end globalPass

        return { plan: newPlan, changes }
    }

    private getDayTotalsFromMeals(dayMeals: any[]): { calories: number; protein: number; carbs: number; fat: number } {
        return dayMeals.reduce(
            (acc, m) => {
                const mult = typeof m?.portion_multiplier === 'number' && Number.isFinite(m.portion_multiplier)
                    ? m.portion_multiplier
                    : 1
                acc.calories += (m?.food?.calories || 0) * mult
                acc.protein += (m?.food?.protein || 0) * mult
                acc.carbs += (m?.food?.carbs || 0) * mult
                acc.fat += (m?.food?.fat || 0) * mult
                return acc
            },
            { calories: 0, protein: 0, carbs: 0, fat: 0 }
        )
    }

    private getWeeklyTotalsFromMeals(meals: any[]): { calories: number; protein: number; carbs: number; fat: number } {
        return this.getDayTotalsFromMeals(Array.isArray(meals) ? meals : [])
    }

    private isWeeklyPlanWithinTolerance(
        plan: any,
        target: { calories: number; protein: number; carbs: number; fat: number },
        tolerances: any
    ): boolean {
        const meals = Array.isArray(plan?.meals) ? plan.meals : []
        if (!meals.length) return false

        const weekly = this.getWeeklyTotalsFromMeals(meals)
        const scale = 7
        const weeklyTarget = {
            calories: Math.max(1, Number(target?.calories || 0) * scale),
            protein: Math.max(1, Number(target?.protein || 0) * scale),
            carbs: Math.max(1, Number(target?.carbs || 0) * scale),
            fat: Math.max(1, Number(target?.fat || 0) * scale),
        }

        const pct = (val: number, tgt: number) => (tgt > 0 ? (val / tgt) * 100 : 100)
        const calPct = pct(weekly.calories, weeklyTarget.calories)
        const proPct = pct(weekly.protein, weeklyTarget.protein)
        const carbPct = pct(weekly.carbs, weeklyTarget.carbs)
        const fatPct = pct(weekly.fat, weeklyTarget.fat)

        const calTol = tolerances?.calories || { min: 90, max: 110 }
        const proTol = tolerances?.protein || { min: 80, max: 120 }
        const carbTol = tolerances?.carb || tolerances?.carbs || { min: 80, max: 120 }
        const fatTol = tolerances?.fat || { min: 80, max: 120 }

        return (
            calPct >= Number(calTol.min) && calPct <= Number(calTol.max) &&
            proPct >= Number(proTol.min) && proPct <= Number(proTol.max) &&
            carbPct >= Number(carbTol.min) && carbPct <= Number(carbTol.max) &&
            fatPct >= Number(fatTol.min) && fatPct <= Number(fatTol.max)
        )
    }

    private calculateMacroDistance(
        totals: { calories: number; protein: number; carbs: number; fat: number },
        target: { calories: number; protein: number; carbs: number; fat: number }
    ): number {
        const safeTargetCalories = Math.max(1, Number(target?.calories || 0))
        const safeTargetProtein = Math.max(1, Number(target?.protein || 0))
        const safeTargetCarbs = Math.max(1, Number(target?.carbs || 0))
        const safeTargetFat = Math.max(1, Number(target?.fat || 0))

        const calDiff = Math.abs((totals.calories - safeTargetCalories) / safeTargetCalories)
        const proteinDiff = Math.abs((totals.protein - safeTargetProtein) / safeTargetProtein)
        const carbDiff = Math.abs((totals.carbs - safeTargetCarbs) / safeTargetCarbs)
        const fatDiff = Math.abs((totals.fat - safeTargetFat) / safeTargetFat)

        // Calorie slightly higher weight to keep plan stable while flavor swaps happen.
        return (calDiff * 1.2) + proteinDiff + (carbDiff * 0.9) + (fatDiff * 0.9)
    }

    private getFlavorAffinityScore(candidate: any, slotFoods: any[], slotName: string, dayIndex: number): number {
        let score = 0
        const context = {
            selectedFoods: slotFoods,
            slotSelectedFoods: slotFoods,
            slotName,
            dayIndex,
            weeklySelectedIds: new Map<string, number>()
        }

        for (const rule of this.rules) {
            if (!rule?.is_active || rule.rule_type !== 'affinity') continue
            const affinityScore = this.checkAffinityRule(rule, candidate, context)
            if (affinityScore === Number.NEGATIVE_INFINITY) return -100000
            if (Number.isFinite(affinityScore)) score += affinityScore
        }
        return score
    }

    private getPatternCacheKey(slotName: string, cfg: FlavorTuningConfig): string {
        return [
            normalizeSlotName(slotName),
            String(Math.max(1, Math.round(cfg.pattern_min_support || 3))),
            String(Math.max(0, cfg.pattern_min_confidence || 0)),
            String(Math.max(0.1, cfg.pattern_min_lift || 1.1))
        ].join('|')
    }

    private async getPatternMetricsForSlot(slotName: string, cfg: FlavorTuningConfig): Promise<PatternMetricRow[]> {
        const key = this.getPatternCacheKey(slotName, cfg)
        const cached = this.patternMetricsCache.get(key)
        if (cached) return cached

        const pending = this.patternMetricsPromiseCache.get(key)
        if (pending) return pending

        const task = (async () => {
            try {
                const params = new URLSearchParams()
                params.set('meal_times', normalizeSlotName(slotName))
                params.set('min_support', String(Math.max(1, Math.round(cfg.pattern_min_support || 3))))
                params.set('min_confidence', String(Math.max(0, cfg.pattern_min_confidence || 0)))
                params.set('limit', '300')
                const response = await fetch(`/api/admin/pattern-insights?${params.toString()}`, { method: 'GET' })
                if (!response.ok) {
                    this.patternMetricsCache.set(key, [])
                    return []
                }
                const payload = await response.json()
                const metricsRaw = Array.isArray(payload?.metrics) ? payload.metrics : []
                const minLift = Math.max(0.1, cfg.pattern_min_lift || 1.1)
                const metrics = metricsRaw.filter((row: any) => {
                    const support = Number(row?.support_count || 0)
                    const confidence = Number(row?.confidence || 0)
                    const lift = Number(row?.lift || 0)
                    return (
                        typeof row?.lhs_food_id === 'string' &&
                        typeof row?.rhs_food_id === 'string' &&
                        support >= Math.max(1, Math.round(cfg.pattern_min_support || 3)) &&
                        confidence >= Math.max(0, cfg.pattern_min_confidence || 0) &&
                        lift >= minLift
                    )
                }) as PatternMetricRow[]
                this.patternMetricsCache.set(key, metrics)
                return metrics
            } catch {
                this.patternMetricsCache.set(key, [])
                return []
            } finally {
                this.patternMetricsPromiseCache.delete(key)
            }
        })()

        this.patternMetricsPromiseCache.set(key, task)
        return task
    }

    private async getPatternAffinityScore(
        candidate: any,
        slotFoods: any[],
        slotName: string,
        cfg: FlavorTuningConfig
    ): Promise<{ score: number; best: PatternMetricRow | null; reason: string }> {
        if (!cfg.use_pattern_insights) {
            return { score: 0, best: null, reason: 'Örüntü kapalı' }
        }
        const candidateId = String(candidate?.id || '')
        if (!candidateId || !Array.isArray(slotFoods) || slotFoods.length === 0) {
            return { score: 0, best: null, reason: 'Slot bağlamı yok' }
        }

        const metrics = await this.getPatternMetricsForSlot(slotName, cfg)
        if (!metrics.length) return { score: 0, best: null, reason: 'Eşik üstü örüntü bulunamadı' }

        const contextIds = new Set(slotFoods.map((f: any) => String(f?.id || '')).filter(Boolean))
        let bestScore = 0
        let bestMetric: PatternMetricRow | null = null
        let hadContextMatch = false

        for (const row of metrics) {
            const lhs = String(row.lhs_food_id || '')
            const rhs = String(row.rhs_food_id || '')
            if (!lhs || !rhs) continue

            const isForward = contextIds.has(lhs) && rhs === candidateId
            const isReverse = contextIds.has(rhs) && lhs === candidateId
            if (!isForward && !isReverse) continue
            hadContextMatch = true

            const confidence = Number(row.confidence || 0)
            const lift = Number(row.lift || 0)
            const support = Number(row.support_count || 0)
            const supportNorm = Math.min(1, support / Math.max(1, Math.round(cfg.pattern_min_support || 3)))
            const score = (confidence * 0.6) + (Math.min(4, lift) / 4) * 0.3 + (supportNorm * 0.1)

            if (score > bestScore) {
                bestScore = score
                bestMetric = row
            }
        }

        if (!hadContextMatch) {
            return { score: 0, best: null, reason: 'Slotta eşleşen örüntü yok' }
        }
        if (!bestMetric || bestScore <= 0) {
            return { score: 0, best: null, reason: 'Eşleşme var, skor katkısı düşük' }
        }
        return { score: bestScore, best: bestMetric, reason: 'Örüntü katkısı bulundu' }
    }

    private isLockedByConsistencyRule(food: any, slotNameRaw: string, dayNum: number): boolean {
        if (!food) return false
        const slotName = normalizeSlotName(String(slotNameRaw || ''))
        for (const rule of this.rules) {
            if (!rule?.is_active || rule.rule_type !== 'consistency') continue
            const rawDef = rule.definition as any
            const def = (rawDef && typeof rawDef === 'object' && 'data' in rawDef) ? rawDef.data : rawDef
            if (!def?.target) continue

            if (Array.isArray(def.scope_meals) && def.scope_meals.length > 0) {
                const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                if (!normalizedScopeMeals.includes(slotName)) continue
            }

            if (Array.isArray(def.scope_days) && def.scope_days.length > 0) {
                if (!def.scope_days.map((d: any) => Number(d)).includes(Number(dayNum))) continue
            }

            if (this.matchesTarget(food, def.target)) return true
        }
        return false
    }

    public async applyFlavorTune(
        plan: any,
        mode: 'weekly' | 'daily' = 'weekly',
        targetDay?: number
    ): Promise<{ plan: any, changes: string[] }> {
        const changes: string[] = []
        const newPlan = JSON.parse(JSON.stringify(plan || {}))

        const cfg = this.flavorTuningConfig || { ...DEFAULT_FLAVOR_TUNING_CONFIG }
        if (!cfg.enabled || !cfg.allow_post_edit) {
            return { plan: newPlan, changes }
        }

        if (!Array.isArray(newPlan?.meals) || newPlan.meals.length === 0) {
            return { plan: newPlan, changes }
        }

        if (!this.allFoods.length) {
            await this.init()
        }

        const suggestionCount = Math.max(1, Math.min(6, Math.round(cfg.suggestion_count || 3)))
        const weightTotal = Math.max(
            0.0001,
            (cfg.macro_weight || 0) +
            (cfg.flavor_weight || 0) +
            (cfg.diversity_weight || 0) +
            (cfg.compatibility_weight || 0) +
            ((cfg.use_pattern_insights ? cfg.pattern_weight : 0) || 0)
        )
        const macroWeight = (cfg.macro_weight || 0) / weightTotal
        const flavorWeight = (cfg.flavor_weight || 0) / weightTotal
        const diversityWeight = (cfg.diversity_weight || 0) / weightTotal
        const compatibilityWeight = (cfg.compatibility_weight || 0) / weightTotal
        const patternWeight = ((cfg.use_pattern_insights ? cfg.pattern_weight : 0) || 0) / weightTotal

        const targetMacros = {
            calories: Number(newPlan?.targetMacros?.calories || 1800),
            protein: Number(newPlan?.targetMacros?.protein || 90),
            carbs: Number(newPlan?.targetMacros?.carbs || newPlan?.targetMacros?.carb || 180),
            fat: Number(newPlan?.targetMacros?.fat || 60)
        }

        const daysToTune = mode === 'daily' && targetDay
            ? [targetDay]
            : [1, 2, 3, 4, 5, 6, 7]

        const sourceFoods = (this.eligibleFoods && this.eligibleFoods.length > 0)
            ? this.eligibleFoods
            : this.allFoods
        const sourceFoodsByRole = new Map<string, any[]>()
        for (const food of sourceFoods) {
            const role = this.getCanonicalLockRole(food?.role || '')
            if (!role) continue
            if (!sourceFoodsByRole.has(role)) sourceFoodsByRole.set(role, [])
            sourceFoodsByRole.get(role)!.push(food)
        }

        // Rebuild weekly tracker from incoming plan for frequency and variety checks.
        this.currentWeekFoods = newPlan.meals.map((m: any) => ({
            ...(m?.food || {}),
            dayIndex: Number(m?.day || 1) - 1,
            slot: m?.slot || '',
            portion_multiplier: typeof m?.portion_multiplier === 'number' ? m.portion_multiplier : 1
        }))
        const weekCountMap = new Map<string, number>()
        for (const wf of this.currentWeekFoods) {
            const fid = String(wf?.id || '')
            if (!fid) continue
            weekCountMap.set(fid, (weekCountMap.get(fid) || 0) + 1)
        }

        for (const dayNum of daysToTune) {
            const dayMeals = newPlan.meals.filter((m: any) => Number(m?.day) === dayNum)
            if (!dayMeals.length) continue

            const dayIndex = dayNum - 1
            let daySwapCount = 0
            const slots = Array.from(new Set(dayMeals.map((m: any) => String(m?.slot || '')).filter(Boolean))) as string[]

            for (const slotNameRaw of slots) {
                if (daySwapCount >= suggestionCount) break

                const slotMeals = dayMeals.filter((m: any) => String(m?.slot || '') === slotNameRaw)
                if (!slotMeals.length) continue

                const slotName = normalizeSlotName(slotNameRaw)
                const slotMainDish = slotMeals.find((m: any) => {
                    const canonicalRole = this.getCanonicalLockRole(m?.food?.role || '')
                    return canonicalRole === 'maindish' || canonicalRole === 'breakfast_main'
                })?.food || null
                const isBreakfastSlot = slotName === normalizeSlotName('KAHVALTI')
                const hasStrongAnchor = Boolean(slotMainDish) && !isBreakfastSlot
                const macroWeightCap = isBreakfastSlot && !hasStrongAnchor ? 0.45 : 1
                const slotMacroWeightRaw = macroWeight * macroWeightCap
                const slotOtherWeightRaw = flavorWeight + diversityWeight + compatibilityWeight + patternWeight
                const slotWeightTotal = Math.max(0.0001, slotMacroWeightRaw + slotOtherWeightRaw)
                const slotMacroWeight = slotMacroWeightRaw / slotWeightTotal
                const slotFlavorWeight = flavorWeight / slotWeightTotal
                const slotDiversityWeight = diversityWeight / slotWeightTotal
                const slotCompatibilityWeight = compatibilityWeight / slotWeightTotal
                const slotPatternWeight = patternWeight / slotWeightTotal

                for (const meal of slotMeals) {
                    if (daySwapCount >= suggestionCount) break
                    if (!meal?.food?.id) continue

                    const oldFood = meal.food
                    const oldFoodId = oldFood.id
                    const oldRole = this.getCanonicalLockRole(oldFood.role || '')
                    if (!oldRole || oldRole === 'maindish' || oldRole === 'breakfast_main') continue

                    if (cfg.strict_locked_items && meal.isLocked) continue
                    if (cfg.strict_locked_items && this.isLockedByConsistencyRule(oldFood, slotName, dayNum)) continue
                    
                    const sourceType = meal.source?.type || ''
                    if (sourceType === 'fixed_meal' || sourceType === 'fixed' || sourceType === 'lock_rule') continue
                    if (meal.source?.is_required_role === true) continue

                    const fixedByPortion = oldFood.portion_fixed === true || (
                        oldFood.min_quantity !== null &&
                        oldFood.max_quantity !== null &&
                        Number(oldFood.min_quantity) === Number(oldFood.max_quantity)
                    )
                    if (cfg.strict_locked_items && fixedByPortion) continue

                    const oldMult = typeof meal.portion_multiplier === 'number' && Number.isFinite(meal.portion_multiplier)
                        ? meal.portion_multiplier
                        : 1

                    const dayTotalsBefore = this.getDayTotalsFromMeals(dayMeals)
                    const macroDistanceBefore = this.calculateMacroDistance(dayTotalsBefore, targetMacros)

                    const sameSlotOtherFoods = slotMeals
                        .filter((m: any) => m !== meal)
                        .map((m: any) => m?.food)
                        .filter(Boolean)
                    const sameDayOtherFoods = dayMeals
                        .filter((m: any) => m !== meal)
                        .map((m: any) => m?.food)
                        .filter(Boolean)

                    const slotFoodIds = new Set(
                        slotMeals
                            .map((m: any) => m?.food?.id)
                            .filter(Boolean)
                    )
                    slotFoodIds.delete(oldFoodId)

                    const baseAffinity = this.getFlavorAffinityScore(oldFood, sameSlotOtherFoods, slotName, dayIndex)
                    const baseComp = slotMainDish ? this.getCompatibilityAnalysis(oldFood, slotMainDish).boost : 0
                    const basePattern = await this.getPatternAffinityScore(oldFood, sameSlotOtherFoods, slotName, cfg)
                    const baseWeekCount = weekCountMap.get(String(oldFoodId)) || 0
                    const baseDiversity = Math.max(0, 4 - baseWeekCount)
                    const baseComposite = (slotFlavorWeight * (baseAffinity / 5000)) +
                        (slotCompatibilityWeight * (baseComp / 1000)) +
                        (slotDiversityWeight * baseDiversity) +
                        (slotPatternWeight * basePattern.score)
                    const baseWeighted = {
                        macro: 0,
                        flavor: Number((slotFlavorWeight * (baseAffinity / 5000)).toFixed(4)),
                        compatibility: Number((slotCompatibilityWeight * (baseComp / 1000)).toFixed(4)),
                        diversity: Number((slotDiversityWeight * baseDiversity).toFixed(4)),
                        pattern: Number((slotPatternWeight * basePattern.score).toFixed(4))
                    }

                    const candidates: Array<{
                        food: any
                        totalScore: number
                        macroGain: number
                        affinityScore: number
                        compatibilityScore: number
                        diversityScore: number
                        patternScore: number
                        bestPattern: PatternMetricRow | null
                        patternReason: string
                    }> = []

                    const roleCandidates = sourceFoodsByRole.get(oldRole) || []
                    for (const candidate of roleCandidates) {
                        if (!candidate?.id || candidate.id === oldFoodId) continue
                        if (slotFoodIds.has(candidate.id)) continue

                        if (cfg.respect_scope_filters) {
                            if (!this.isMealTypeCompatibleWithSlot(candidate, slotName)) continue
                            if (!this.checkSeasonalityHard(candidate, this.today || new Date())) continue
                        }

                        if (this.hasForbiddenAffinityConflict(candidate, sameSlotOtherFoods)) continue

                        if (cfg.respect_frequency_rules) {
                            const weekCount = weekCountMap.get(String(candidate.id)) || 0
                            if (this.hasReachedWeeklyCap(candidate, weekCount)) continue

                            const frequencyContext = {
                                dayIndex,
                                slotName,
                                selectedFoods: sameDayOtherFoods,
                                slotSelectedFoods: sameSlotOtherFoods,
                                weeklySelectedIds: new Map<string, number>()
                            }
                            if (this.hasReachedFrequencyRuleMaxForFood(candidate, frequencyContext)) continue
                        }

                        meal.food = candidate
                        meal.portion_multiplier = oldMult
                        const dayTotalsAfter = this.getDayTotalsFromMeals(dayMeals)
                        meal.food = oldFood
                        meal.portion_multiplier = oldMult

                        const macroDistanceAfter = this.calculateMacroDistance(dayTotalsAfter, targetMacros)
                        const macroGain = macroDistanceBefore - macroDistanceAfter

                        const affinityScore = this.getFlavorAffinityScore(candidate, sameSlotOtherFoods, slotName, dayIndex)
                        if (!Number.isFinite(affinityScore) || affinityScore <= -100000) continue

                        const compatibilityScore = slotMainDish
                            ? this.getCompatibilityAnalysis(candidate, slotMainDish).boost
                            : 0

                        const patternResult = await this.getPatternAffinityScore(candidate, sameSlotOtherFoods, slotName, cfg)
                        const candidateWeekCount = weekCountMap.get(String(candidate.id)) || 0
                        const diversityScore = Math.max(0, 4 - candidateWeekCount)
                        const jitter = Math.random() * 0.03

                        const totalScore =
                            (slotMacroWeight * macroGain) +
                            (slotFlavorWeight * (affinityScore / 5000)) +
                            (slotCompatibilityWeight * (compatibilityScore / 1000)) +
                            (slotDiversityWeight * diversityScore) +
                            (slotPatternWeight * patternResult.score) +
                            jitter

                        candidates.push({
                            food: candidate,
                            totalScore,
                            macroGain,
                            affinityScore,
                            compatibilityScore,
                            diversityScore,
                            patternScore: patternResult.score,
                            bestPattern: patternResult.best,
                            patternReason: patternResult.reason
                        })
                    }

                    if (!candidates.length) continue

                    candidates.sort((a, b) => b.totalScore - a.totalScore)
                    const topPoolSize = Math.max(1, Math.min(5, Math.ceil(candidates.length * 0.1)))
                    const topPool = candidates.slice(0, topPoolSize)
                    const selected = topPool[Math.floor(Math.random() * topPool.length)]

                    const improvement = selected.totalScore - baseComposite
                    if (improvement <= 0.015) continue

                    meal.food = selected.food
                    meal.portion_multiplier = oldMult
                    meal.source = {
                        ...(meal.source || {}),
                        type: 'flavor_tune',
                        rule: 'Lezzet Ayari',
                        rule_id: 'system_flavor_tune',
                        flavor_reason: {
                            slot: slotName,
                            original_food_name: oldFood?.name || null,
                            candidate_food_name: selected.food?.name || null,
                            macro_gain: Number(selected.macroGain.toFixed(4)),
                            affinity_score: Number((selected.affinityScore / 5000).toFixed(4)),
                            compatibility_score: Number((selected.compatibilityScore / 1000).toFixed(4)),
                            diversity_score: Number(selected.diversityScore.toFixed(4)),
                            pattern_score: Number(selected.patternScore.toFixed(4)),
                            weighted_base: baseWeighted,
                            weighted: {
                                macro: Number((slotMacroWeight * selected.macroGain).toFixed(4)),
                                flavor: Number((slotFlavorWeight * (selected.affinityScore / 5000)).toFixed(4)),
                                compatibility: Number((slotCompatibilityWeight * (selected.compatibilityScore / 1000)).toFixed(4)),
                                diversity: Number((slotDiversityWeight * selected.diversityScore).toFixed(4)),
                                pattern: Number((slotPatternWeight * selected.patternScore).toFixed(4))
                            },
                            pattern_source: selected.bestPattern
                                ? {
                                    lhs_food_id: selected.bestPattern.lhs_food_id,
                                    lhs_food_name: selected.bestPattern.lhs_food_name,
                                    rhs_food_id: selected.bestPattern.rhs_food_id,
                                    rhs_food_name: selected.bestPattern.rhs_food_name,
                                    support_count: selected.bestPattern.support_count,
                                    confidence: selected.bestPattern.confidence,
                                    lift: selected.bestPattern.lift
                                }
                                : null,
                            pattern_reason: selected.patternReason || null
                        }
                    }

                    const weeklyIdx = this.currentWeekFoods.findIndex((wf: any) =>
                        wf.id === oldFoodId &&
                        Number(wf.dayIndex) === dayIndex &&
                        normalizeSlotName(String(wf.slot || '')) === slotName
                    )
                    const replacement = {
                        ...selected.food,
                        dayIndex,
                        slot: slotName,
                        portion_multiplier: oldMult
                    }
                    if (weeklyIdx >= 0) {
                        this.currentWeekFoods[weeklyIdx] = replacement
                    } else {
                        this.currentWeekFoods.push(replacement)
                    }
                    const oldKey = String(oldFoodId || '')
                    if (oldKey) {
                        weekCountMap.set(oldKey, Math.max(0, (weekCountMap.get(oldKey) || 0) - 1))
                    }
                    const newKey = String(selected.food?.id || '')
                    if (newKey) {
                        weekCountMap.set(newKey, (weekCountMap.get(newKey) || 0) + 1)
                    }

                    daySwapCount++
                    changes.push(
                        `Gun ${dayNum} ${slotName}: ${oldFood.name} -> ${selected.food.name} (lezzet skoru +${Math.max(0, improvement).toFixed(2)})`
                    )
                }
            }
        }

        return { plan: newPlan, changes }
    }
}


const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
    [/ç/g, '\u00e7'],
    [/Ç/g, '\u00c7'],
    [/ö/g, '\u00f6'],
    [/Ö/g, '\u00d6'],
    [/ü/g, '\u00fc'],
    [/Ü/g, '\u00dc'],
    [/ı/g, '\u0131'],
    [/İ/g, '\u0130'],
    [/ğ/g, '\u011f'],
    [/Ä/g, '\u011e'],
    [/ş/g, '\u015f'],
    [/Å/g, '\u015e'],
    [/Ö/g, '\u00d6'],
    [/Ü/g, '\u00dc'],
    [/Ã„Â/g, '\u011e'],
    [/Ã…Â/g, '\u015e'],
    [/ı/g, '\u0131'],
    [/İ/g, '\u0130'],
    [/ç/g, '\u00e7'],
    [/ö/g, '\u00f6'],
    [/ü/g, '\u00fc']
]

function repairMojibake(value: string): string {
    let out = value || ''
    for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
        out = out.replace(pattern, replacement)
    }
    return out
}

const NORMALIZE_KEY_CACHE = new Map<string, string>()
const NORMALIZE_CATEGORY_CACHE = new Map<string, string>()

function normalizeKey(value: string): string {
    if (!value) return ''
    const cached = NORMALIZE_KEY_CACHE.get(value)
    if (cached !== undefined) return cached
    const repaired = repairMojibake(value).toLocaleLowerCase('tr-TR').trim()
    // Strip common UI suffixes like (K), (R), (G) if they exist at the end
    const stripped = repaired.replace(/\s*\([krg]\)\s*$/i, '').trim()
    
    const normalized = stripped
        .replace(/ı/g, 'i')
        .replace(/ç/g, 'c')
        .replace(/ğ/g, 'g')
        .replace(/ö/g, 'o')
        .replace(/ş/g, 's')
        .replace(/ü/g, 'u')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
    NORMALIZE_KEY_CACHE.set(value, normalized)
    return normalized
}

function normalizeSlotName(value: string): string {
    const key = normalizeKey(value)
    if (key.includes('breakfast')) return 'KAHVALTI'
    if (key.includes('lunch')) return 'ÖĞLEN'
    if (key.includes('dinner')) return 'AKŞAM'
    if (key.includes('snack')) return 'ARA ÖĞÜN'
    if (key.includes('kahvalt')) return 'KAHVALTI'
    if (key.includes('oglen') || key === 'ogle') return 'ÖĞLEN'
    if (key.includes('aksam')) return 'AKŞAM'
    if (key.includes('gecikmis') && key.includes('ogun')) return 'ARA ÖĞÜN'
    if (key.includes('ara') && key.includes('ogun')) return 'ARA ÖĞÜN'
    return value
}

// Map Turkish/English categories and roles to internal standard keys
const CATEGORY_ROLE_MAP: Record<string, string[]> = {
    soup: ['soup', 'soups', 'corba', 'corbalar'],
    bread: ['bread', 'breads', 'ekmek', 'ekmekler', 'ekmegi', 'ekmeg', 'simit'],
    pogaca: ['pogaca', 'pogacalar', 'po\u011faca', 'po\u011fa\u00e7a', 'pogac'],
    borek: ['borek', 'borekler', 'b\u00f6rek', 'b\u00f6rekler', 'muffin', 'pogaca', 'po\u011fa\u00e7a', 'boreg'],
    muffin: ['muffin', 'muffinler'],
    salad: ['salad', 'salads', 'salata', 'salatalar', 'sogus'],
    drink: ['drink', 'drinks', 'icecek', 'icecekler', 'kahve', 'cay'],
    dessert: ['dessert', 'desserts', 'tatli', 'tatlilar'],
    snack: ['snack', 'snacks', 'atistirmalik', 'kuruyemis', 'meyve', 'fruit', 'nuts'],
    maindish: ['maindish', 'main dish', 'ana yemek', 'anayemek'],
    sidedish: ['sidedish', 'side dish', 'yan yemek', 'yanyemek']
}

const CATEGORY_ROLE_LOOKUP = (() => {
    const map = new Map<string, string>()
    for (const [key, synonyms] of Object.entries(CATEGORY_ROLE_MAP)) {
        map.set(normalizeKey(key), key)
        for (const synonym of synonyms) {
            map.set(normalizeKey(synonym), key)
        }
    }
    return map
})()

/**
 * Helper to check if a value matches a standard key via the map
 */
function isMacroCategoryMatch(standardKey: string, value: string): boolean {
    if (!value) return false
    return normalizeCategory(value) === normalizeCategory(standardKey)
}

/**
 * Normalize a category/role string to its internal standard key if possible
 * Returns the input string if no mapping found
 */
function normalizeCategory(value: string): string {
    if (!value) return ''
    const cached = NORMALIZE_CATEGORY_CACHE.get(value)
    if (cached !== undefined) return cached
    const v = normalizeKey(value)
    const normalized = CATEGORY_ROLE_LOOKUP.get(v) || v
    NORMALIZE_CATEGORY_CACHE.set(value, normalized)
    return normalized
}
