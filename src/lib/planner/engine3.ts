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
// Tags that are exempt from conflict checking.
// Two groups:
//   1) Generic macro/food-group descriptors (protein, karbonhidrat, sebze, meyve, süt ürünü)
//   2) Diet-style descriptors (keto, low-carb, gluten-free, vegan, etc.) — these describe
//      a food's compatibility with a dietary approach, NOT a functional food group.
//      Treating them as conflicts silently kills rules like "her akşam tahin", because
//      almost every keto/low-carb food carries the same style tag and hasTagConflict()
//      would reject candidates once ONE keto food entered the slot.
const EXEMPT_TAGS = [
    // Food groups / macro descriptors
    'protein', 'karbonhidrat', 'sebze', 'meyve', 'süt ürünü', 'süt ürünleri',
    // Supplement-type descriptors
    'kollajen', 'vitamin', 'mineral', 'takviye',
    // Category-echo tags (duplicate the role/category info, not a functional food group)
    'ekmek', 'ekmeği', 'ekmegi',
    // Diet-style descriptors — declarative only
    'keto', 'ketogenic', 'ketojenik', 'lowcarb', 'low-carb', 'low carb',
    'düşük karbonhidrat', 'düşük karb', 'high-protein', 'yüksek protein',
    'dairy-free', 'gluten-free', 'glutensiz', 'sütsüz', 'laktozsuz',
    'vegan', 'vegetarian', 'vejetaryen', 'paleo', 'akdeniz', 'mediterranean',
    // Meal-role hint tags that shouldn't cause conflicts
    'atıştırmalık', 'kahvaltılık', 'sağlıklı', 'kolay', 'ev yapımı', 'low-cost'
]

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
    // Supplement-type roles exempt from name similarity check — these are small accompaniments
    // where sharing a word with a main dish (e.g. "kuru" in "Kuru İncir" vs "Kuru Fasulye") is irrelevant
    private static NAME_CONFLICT_EXEMPT_ROLES = new Set(['snack', 'drink', 'supplement', 'fruit'])

    private isNameConflictExemptRole(role: string): boolean {
        if (Planner.NAME_CONFLICT_EXEMPT_ROLES.has(role)) return true
        const stripped = role.replace(/l[ae]r$/, '')
        if (stripped !== role) {
            const canonical = CATEGORY_ROLE_LOOKUP.get(stripped)
            if (canonical && Planner.NAME_CONFLICT_EXEMPT_ROLES.has(canonical)) return true
        }
        return false
    }

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
    // Maps rule_id → active days for exclusive_scope rules (days where the rule WANTS its target placed)
    private exclusiveScopeActiveDaysMap: Map<string, number[]> = new Map()

    // Intersection weekly lock: once a frequency rule intersects with a food, reuse it all week
    // Maps rule.id → locked food object
    private intersectionWeeklyLocks: Map<string, any> = new Map()

    // Weekly portion adjustment tracking: dayIndex → 'reduction' | 'increase'
    // Max 5 reductions on different days, max 2 increases on different days, same day one direction only
    private weeklyPortionAdjustments: Map<number, 'reduction' | 'increase'> = new Map()

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
        this.exclusiveScopeActiveDaysMap.clear()
        this.intersectionWeeklyLocks.clear()
        
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
        // Phase 1: Collect all exclusive_scope rules and their active days
        const exclusiveEntries: { rule: any, def: any, activeDays: number[] | null, targets: any[] }[] = []
        for (const rule of this.rules) {
            if (rule.rule_type === 'frequency' || rule.rule_type === 'fixed_meal') {
                const def = (rule.definition as any).data || rule.definition
                if (def.exclusive_scope === true) {
                    const isWeekActive = this.isRuleActiveForWeek(def)
                    const targets: any[] = []
                    if (rule.rule_type === 'frequency' && def.target) {
                        targets.push(def.target)
                    } else if (rule.rule_type === 'fixed_meal' && Array.isArray(def.foods)) {
                        for (const fId of def.foods) targets.push({ type: 'food_id', value: fId })
                    }
                    if (!isWeekActive) {
                        for (const t of targets) this.weeklyBannedTargets.push(t)
                    } else {
                        const period = def.period || 'weekly'
                        const useImplicitRandomDays = period === 'weekly' && (!def.scope_days || def.scope_days.length === 0) && def.max_count
                        const randomDaysTarget = def.random_day_count || (useImplicitRandomDays ? def.max_count : null)
                        let activeDays: number[] | null = null
                        if (randomDaysTarget) {
                            const count = typeof randomDaysTarget === 'number' ? randomDaysTarget : Number(randomDaysTarget)
                            activeDays = this.getRandomDaysForRule(rule.id, count)
                        } else if (def.scope_days && Array.isArray(def.scope_days) && def.scope_days.length > 0) {
                            activeDays = def.scope_days
                        }
                        if (activeDays) {
                            this.exclusiveScopeActiveDaysMap.set(rule.id, [...activeDays])
                        }
                        exclusiveEntries.push({ rule, def, activeDays, targets })
                    }
                }
            }
        }

        // Phase 2: Merge active days for rules with overlapping targets
        // Group by serialized target key so rules targeting the same food type share days
        const targetGroupDays = new Map<string, Set<number>>()
        const targetGroupTargets = new Map<string, any[]>()
        for (const entry of exclusiveEntries) {
            if (!entry.activeDays || entry.targets.length === 0) continue
            for (const target of entry.targets) {
                const key = `${target.type}:${target.value}`
                if (!targetGroupDays.has(key)) {
                    targetGroupDays.set(key, new Set())
                    targetGroupTargets.set(key, [target])
                }
                for (const d of entry.activeDays) targetGroupDays.get(key)!.add(d)
            }
        }

        // Phase 3: Ban only days NOT in the merged union
        for (const [key, unionDays] of targetGroupDays) {
            const targets = targetGroupTargets.get(key)!
            for (let d = 1; d <= 7; d++) {
                if (!unionDays.has(d)) {
                    if (!this.dailyBannedTargetsMap.has(d)) {
                        this.dailyBannedTargetsMap.set(d, [])
                    }
                    const targetArr = this.dailyBannedTargetsMap.get(d)!
                    for (const t of targets) targetArr.push(t)
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
                orParts.push(`and(scope.eq.patient,patient_id.eq.${this.patientId},team_owner_id.is.null)`)
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

        const mergedRulesMap = new Map<string, PlanningRule>()

        // 1. Base: Global Rules
        globalRules.forEach(r => mergedRulesMap.set(r.id, r))

        // 2. Override with Team Rules
        teamRules.forEach(r => mergedRulesMap.set(r.source_rule_id || r.id, r))

        // 3. Override with Program Rules
        programRules.forEach(r => mergedRulesMap.set(r.source_rule_id || r.id, r))

        // 4. Override with Patient Rules (active first, then inactive — so deactivations always win)
        patientRules.filter(r => r.is_active).forEach(r => mergedRulesMap.set(r.source_rule_id || r.id, r))
        patientRules.filter(r => !r.is_active).forEach(r => mergedRulesMap.set(r.source_rule_id || r.id, r))

        // Collect IDs that patient tombstones want to deactivate.
        // A tombstone's source_rule_id may point to a team/program rule's own ID,
        // but that rule lives in the merge map under the global root's ID.
        // So we also check each surviving rule's own .id against this set.
        // We also trace the full deactivation chain: if patient deactivates prog-1,
        // and prog-1's source_rule_id is glob-1, we add glob-1 too.
        const patientDeactivatedIds = new Set<string>()
        patientRules.forEach(r => {
            if (!r.is_active) {
                if (r.source_rule_id) {
                    patientDeactivatedIds.add(r.source_rule_id)
                    // Trace the chain: find the parent rule and add its source too
                    const parentRule = [...programRules, ...teamRules].find(
                        pr => pr.id === r.source_rule_id
                    )
                    if (parentRule?.source_rule_id) {
                        patientDeactivatedIds.add(parentRule.source_rule_id)
                    }
                }
                patientDeactivatedIds.add(r.id)
            }
        })

        // Convert to array and filter out inactive or deleted rules (tombstones)
        let effectiveRules = Array.from(mergedRulesMap.values()).filter(r => {
            if (!r.is_active) return false
            const def = r.definition as any
            if (def && def._is_deleted === true) return false
            if (patientDeactivatedIds.has(r.id)) {
                console.log(`[Engine] Rule '${r.name}' (${r.id}) deactivated by patient (id match)`)
                return false
            }
            // Also check source_rule_id: if a patient deactivated the source, this rule
            // should be excluded even if THIS record has is_active=true (e.g., duplicate
            // patient records where one customized and one deactivated the same source)
            if (r.source_rule_id && patientDeactivatedIds.has(r.source_rule_id)) {
                console.log(`[Engine] Rule '${r.name}' (${r.id}) deactivated by patient (source_rule_id match: ${r.source_rule_id})`)
                return false
            }
            return true
        })

        console.log(`[Engine] Sparse Override applied. Effective rules: ${effectiveRules.length} (Global: ${globalRules.length}, Team: ${teamRules.length}, Program: ${programRules.length}, Patient: ${patientRules.length})`)

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
        this.weeklyPortionAdjustments.clear()

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
                    const pm = item.food?._portionMultiplier || 1
                    total.calories += (item.food.calories || 0) * pm
                    total.protein += (item.food.protein || 0) * pm
                    total.carbs += (item.food.carbs || 0) * pm
                    total.fat += (item.food.fat || 0) * pm
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
            // Soft floor: never drop below 60% of base target so the last day is not silently killed
            // when cumulative debt is large. Also avoid ballooning above 140% to prevent overshoots.
            const remainingDays = dayCount - i
            const MIN_FLOOR = 0.6
            const MAX_CEILING = 1.4
            const clamp = (base: number, adjusted: number) => Math.min(base * MAX_CEILING, Math.max(base * MIN_FLOOR, adjusted))
            const compensatedDailyMacros = targetMacros ? {
                calories: clamp(targetMacros.calories, targetMacros.calories + (macroDebt.calories / remainingDays)),
                protein: clamp(targetMacros.protein, targetMacros.protein + (macroDebt.protein / remainingDays)),
                fat: clamp(targetMacros.fat, targetMacros.fat + (macroDebt.fat / remainingDays)),
                carbs: clamp(targetMacros.carbs, targetMacros.carbs + (macroDebt.carbs / remainingDays)),
            } : null

            if (compensatedDailyMacros && i > 0 && (Math.abs(macroDebt.protein) > 1 || Math.abs(macroDebt.fat) > 1)) {
                this.log(i + 1, 'CROSS-DAY', 'info',
                    `Compensated targets: P=${compensatedDailyMacros.protein.toFixed(1)}g (base ${targetMacros!.protein}g), ` +
                    `F=${compensatedDailyMacros.fat.toFixed(1)}g (base ${targetMacros!.fat}g), ` +
                    `C=${compensatedDailyMacros.carbs.toFixed(1)}g (base ${targetMacros!.carbs}g)`)
            }

            // Use compensated macros for slot distribution
            const effectiveDailyMacros = compensatedDailyMacros || targetMacros

            // ── PRE-DAY: RULE SPREADING ──
            // Distribute flexible rules (no scope_meals) across slots to balance load.
            // Slot-specific rules (with scope_meals) stay fixed; flexible ones go to least-loaded slot.
            const ruleSlotAssignments = new Map<string, string>() // ruleId → assigned slotName
            {
                const dayOfWeek = i + 1
                const slotLoads = new Map<string, number>()
                const eligibleSlots = mealTypes.filter(s => normalizeSlotName(s) !== 'KAHVALTI')
                for (const s of eligibleSlots) slotLoads.set(s, 0)

                const dayFreqRules = this.rules.filter(r => {
                    if (!r.is_active || r.rule_type !== 'frequency') return false
                    const def = (r.definition as any).data || r.definition
                    if (!this.isRuleActiveForWeek(def)) return false
                    if (def.scope_days?.length > 0 && !def.scope_days.includes(dayOfWeek)) return false
                    const period = def.period || 'weekly'
                    if (period === 'per_meal') return false
                    const useImplicit = period === 'weekly' && (!def.scope_days || def.scope_days.length === 0) && def.max_count
                    const rdt = def.random_day_count || (useImplicit ? def.max_count : null)
                    if (rdt) {
                        const cnt = typeof rdt === 'number' ? rdt : Number(rdt)
                        const rd = this.getRandomDaysForRule(r.id, cnt)
                        if (!rd.includes(dayOfWeek)) return false
                    }
                    return true
                })

                // First pass: count single-slot-specific rules (truly fixed)
                // Multi-scope_meals rules (e.g. ['ÖĞLEN','AKŞAM']) are semi-flexible and go to second pass.
                const semiFlexRules: typeof dayFreqRules = []
                for (const rule of dayFreqRules) {
                    const def = (rule.definition as any).data || rule.definition
                    if (def.scope_meals && def.scope_meals.length === 1) {
                        const norm = normalizeSlotName(String(def.scope_meals[0]))
                        for (const s of eligibleSlots) {
                            if (normalizeSlotName(s) === norm) {
                                slotLoads.set(s, (slotLoads.get(s) || 0) + 1)
                            }
                        }
                    } else if (def.scope_meals && def.scope_meals.length > 1) {
                        semiFlexRules.push(rule)
                    }
                }

                // Second pass: assign flexible (no scope_meals) + semi-flexible (multi scope_meals) rules
                const pureFlexRules = dayFreqRules.filter(r => {
                    const def = (r.definition as any).data || r.definition
                    return !def.scope_meals || def.scope_meals.length === 0
                })
                const flexRules = [...semiFlexRules, ...pureFlexRules]
                flexRules.sort((a, b) => (b.priority || 0) - (a.priority || 0))

                for (const rule of flexRules) {
                    const def = (rule.definition as any).data || rule.definition
                    // Semi-flex: only eligible for their scoped slots
                    const ruleEligibleSlots = (def.scope_meals && def.scope_meals.length > 1)
                        ? eligibleSlots.filter(s => def.scope_meals.some((sm: string) =>
                            normalizeSlotName(String(sm)) === normalizeSlotName(s)))
                        : eligibleSlots
                    if (ruleEligibleSlots.length === 0) continue
                    let bestSlot = ruleEligibleSlots[0]
                    let bestLoad = Infinity
                    for (const s of ruleEligibleSlots) {
                        const load = slotLoads.get(s) || 0
                        if (load < bestLoad) { bestLoad = load; bestSlot = s }
                    }
                    ruleSlotAssignments.set(rule.id, bestSlot)
                    slotLoads.set(bestSlot, (slotLoads.get(bestSlot) || 0) + 1)
                }

                if (ruleSlotAssignments.size > 0) {
                    const summary = Array.from(slotLoads.entries()).map(([s, c]) => `${s}:${c}`).join(', ')
                    this.log(i + 1, 'SPREAD', 'info', `Rule distribution: ${summary} (${ruleSlotAssignments.size} flexible rules assigned)`)
                }
            }

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
                    slotTargetMacros,
                    slotMainDish: null as any,
                    slotName,
                    dailyMacros: dailyContext.dailyMacros,
                    dailyTarget: effectiveDailyMacros,
                    iterationFactor: 1,
                    ruleSlotAssignments: ruleSlotAssignments,
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
                    const pm = food._portionMultiplier || 1
                    plan.meals.push({
                        day: i + 1,
                        dayName,
                        slot: slotName,
                        food: { ...food, name: this.capitalize(food.name) },
                        source: food.source,
                        portion_multiplier: pm
                    })

                    // Update tracking
                    // Tag with slot metadata so countOccurrences can filter by scope_meals.
                    ;(food as any)._slotName = slotName
                    ;(food as any)._dayIndex = i
                    dailyContext.selectedFoods.push(food)
                    dailyContext.dailySelectedIds.add(food.id)
                    this.currentWeekFoods.push(food)
                    dailyContext.dailyMacros.calories += (food.calories || 0) * pm
                    dailyContext.dailyMacros.protein += (food.protein || 0) * pm
                    dailyContext.dailyMacros.carbs += (food.carbs || 0) * pm
                    dailyContext.dailyMacros.fat += (food.fat || 0) * pm

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
                let prevDeviationScore = Infinity
                for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
                    const currentDayMacros = getDailyMacros(slots)
                    const fatRatio = currentDayMacros.fat / (effectiveDailyMacros.fat || 1)
                    const carbsRatio = currentDayMacros.carbs / (effectiveDailyMacros.carbs || 1)
                    const proteinRatio = currentDayMacros.protein / (effectiveDailyMacros.protein || 1)
                    const calorieRatio = currentDayMacros.calories / (effectiveDailyMacros.calories || 1)

                    const deviationScore = Math.abs(fatRatio - 1) + Math.abs(carbsRatio - 1) +
                        Math.abs(proteinRatio - 1) + Math.abs(calorieRatio - 1)

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

                    if (iteration > 1 && deviationScore >= prevDeviationScore) {
                        this.log(i + 1, 'ITERATION', 'info',
                            `Divergence detected at iteration ${iteration}: score ${deviationScore.toFixed(3)} >= prev ${prevDeviationScore.toFixed(3)}. Stopping early.`)
                        break
                    }
                    prevDeviationScore = deviationScore

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
                        const rpm = food._portionMultiplier || 1
                        dailyContext.dailyMacros.calories -= (food.calories || 0) * rpm
                        dailyContext.dailyMacros.protein -= (food.protein || 0) * rpm
                        dailyContext.dailyMacros.carbs -= (food.carbs || 0) * rpm
                        dailyContext.dailyMacros.fat -= (food.fat || 0) * rpm
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

                    // Re-spread: move some flexible rules away from worst slot to less loaded ones
                    const iterAssignments = new Map(ruleSlotAssignments)
                    {
                        const otherSlots = mealTypes.filter(s =>
                            normalizeSlotName(s) !== normalizeSlotName(worstSlot.slotName) &&
                            normalizeSlotName(s) !== 'KAHVALTI')
                        if (otherSlots.length > 0) {
                            const reLoads = new Map<string, number>()
                            for (const s of otherSlots) {
                                reLoads.set(s, (slots[s] || []).length)
                            }
                            let moved = 0
                            for (const [ruleId, assignedSlot] of iterAssignments) {
                                if (normalizeSlotName(assignedSlot) !== normalizeSlotName(worstSlot.slotName)) continue
                                let bestSlot = assignedSlot
                                let bestLoad = Infinity
                                for (const s of otherSlots) {
                                    const load = reLoads.get(s) || 0
                                    if (load < bestLoad) { bestLoad = load; bestSlot = s }
                                }
                                const worstLoad = (slots[worstSlot.slotName] || []).length
                                if (bestLoad < worstLoad - 1) {
                                    iterAssignments.set(ruleId, bestSlot)
                                    reLoads.set(bestSlot, bestLoad + 1)
                                    moved++
                                }
                            }
                            if (moved > 0) {
                                this.log(i + 1, 'ITERATION', 'info',
                                    `Re-spread: moved ${moved} flexible rule(s) away from '${worstSlot.slotName}'`)
                            }
                        }
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
                        ruleSlotAssignments: iterAssignments,
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
                        // Tag slot metadata so countOccurrences scope_meals filter works correctly.
                        ;(food as any)._slotName = worstSlot.slotName
                        ;(food as any)._dayIndex = i
                        const rpm = food._portionMultiplier || 1
                        plan.meals.push({
                            day: i + 1, dayName, slot: worstSlot.slotName,
                            food: { ...food, name: this.capitalize(food.name) },
                            source: food.source,
                            portion_multiplier: rpm
                        })
                        dailyContext.selectedFoods.push(food)
                        dailyContext.dailySelectedIds.add(food.id)
                        this.currentWeekFoods.push(food)
                        dailyContext.dailyMacros.calories += (food.calories || 0) * rpm
                        dailyContext.dailyMacros.protein += (food.protein || 0) * rpm
                        dailyContext.dailyMacros.carbs += (food.carbs || 0) * rpm
                        dailyContext.dailyMacros.fat += (food.fat || 0) * rpm
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
                            // Normalize so "Akşam" / "AKŞAM " / "akşam" all resolve to the canonical slot key.
                            const targetSlot = normalizeSlotName(String(def.target_slot))
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

                                // Tag collision check (respecting effectiveExemptTags)
                                const candidateWords = new Set<string>()
                                const cNameWords = (foodToAdd.name || '').toLocaleLowerCase('tr-TR').split(/\s+/)
                                cNameWords.forEach((w: string) => { if (w.length > 2 && !this.effectiveExemptTags.has(w)) candidateWords.add(w) })
                                if (Array.isArray(foodToAdd.tags)) {
                                    foodToAdd.tags.forEach((t: string) => {
                                        const tw = (t || '').toLocaleLowerCase('tr-TR').split(/\s+/)
                                        tw.forEach((w: string) => { if (w.length > 2 && !this.effectiveExemptTags.has(w)) candidateWords.add(w) })
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
        this.enforceFrequencyRuleMinimums(plan, mealTypes)


        // 5b. POST-PROCESSING: Reduce side-dish count (max→min) before portion shrinking
        if (targetMacros) {
            this.reduceSideDishCount(plan, targetMacros, effectiveSlotConfig)
        }

        // 5c. POST-PROCESSING: Portion Adjustment (if enabled)
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
        const dailyLimit = max_adjusted_items_per_day || 2
        const weeklyReductionLimit = (this.settings.portion_settings as any).max_reductions_per_week || 7

        if (!strategies.macro_convergence && !strategies.max_limit_protection) return

        plan.meals.forEach((meal: any) => {
            if (typeof meal.portion_multiplier !== 'number' || isNaN(meal.portion_multiplier)) {
                meal.portion_multiplier = 1
            }
        })

        let weeklyReductionCount = 0

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
                        weeklyReductionCount++
                        this.log(i, meal.slot, 'info', `Reduced huge meal >${maxSharePercent}%`, `x${meal.portion_multiplier} ${meal.food.name} (weekly ${weeklyReductionCount}/${weeklyReductionLimit})`)
                    }
                }
            }

            if (weeklyReductionCount >= weeklyReductionLimit) continue

            // Strategy: MAX LIMIT PROTECTION (Scale Down - Overall)
            // Use asymmetric tolerance: max percentage from settings (e.g. 110 means 1.10)
            const calMaxTol = (this.settings?.portion_settings?.macro_tolerances?.calories?.max ?? 110) / 100
            if (strategies.max_limit_protection && currentCals > targetCals * calMaxTol) {
                let loopGuard = 0

                while (currentCals > targetCals * calMaxTol && loopGuard < 50 && weeklyReductionCount < weeklyReductionLimit) {
                    loopGuard++

                    const candidates = dayMeals.filter((m: any) => {
                        if (!this.isScalableFood(m)) return false
                        const foodMin = m.food.min_quantity ?? minMult
                        if (m.portion_multiplier <= foodMin + 0.01) return false
                        if (!adjustedItems.has(m.food.id) && adjustedItems.size >= dailyLimit) return false
                        return true
                    })

                    if (candidates.length === 0) {
                        this.log(i, 'GENEL', 'info', 'Portion reduction stopped', 'No more scalable foods or limits reached')
                        break
                    }

                    candidates.sort((a: any, b: any) => {
                        const calsA = (a.food.calories || 0) * a.portion_multiplier
                        const calsB = (b.food.calories || 0) * b.portion_multiplier
                        return calsB - calsA
                    })

                    const targetMeal = candidates[0]
                    const foodMin = targetMeal.food.min_quantity ?? minMult
                    const foodStep = targetMeal.food.step ?? step

                    const oldCals = (targetMeal.food.calories || 0) * targetMeal.portion_multiplier
                    targetMeal.portion_multiplier = Math.max(foodMin, targetMeal.portion_multiplier - foodStep)
                    targetMeal.portion_multiplier = Math.round(targetMeal.portion_multiplier * 100) / 100

                    const newCals = (targetMeal.food.calories || 0) * targetMeal.portion_multiplier
                    currentCals -= (oldCals - newCals)

                    const isNewReduction = !adjustedItems.has(targetMeal.food.id)
                    adjustedItems.add(targetMeal.food.id)
                    if (isNewReduction) weeklyReductionCount++
                    this.log(i, targetMeal.slot, 'info', `Reduced portion x${targetMeal.portion_multiplier}`, `${targetMeal.food.name} (weekly ${weeklyReductionCount}/${weeklyReductionLimit})`)
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

    private reduceSideDishCount(
        plan: any,
        targetMacros: TargetMacros,
        effectiveSlotConfig: Record<string, SlotConfig>
    ) {
        const weeklyTarget = targetMacros.calories * 7
        const getWeeklyTotal = () => plan.meals.reduce((sum: number, m: any) => {
            const mult = (typeof m.portion_multiplier === 'number' && !isNaN(m.portion_multiplier)) ? m.portion_multiplier : 1
            return sum + ((m.food?.calories || 0) * mult)
        }, 0)

        let weeklyTotal = getWeeklyTotal()
        const surplusPercent = ((weeklyTotal - weeklyTarget) / weeklyTarget) * 100
        if (surplusPercent < 3) return

        this.log(0, 'SIDE-REDUCE', 'info',
            `Weekly surplus ${surplusPercent.toFixed(1)}% — checking side dish reduction`)

        const REMOVABLE_ROLES = ['sidedish', 'meze', 'bread', 'olive', 'cheese', 'nut', 'seed', 'supplement', 'snack', 'fruit']
        let removals = 0
        const MAX_REMOVALS = 5

        for (let d = 1; d <= 7 && removals < MAX_REMOVALS; d++) {
            weeklyTotal = getWeeklyTotal()
            if (((weeklyTotal - weeklyTarget) / weeklyTarget) * 100 < 3) break

            const dayMeals = plan.meals.filter((m: any) => m.day === d)
            const slots = Array.from(new Set<string>(dayMeals.map((m: any) => m.slot)))

            for (const slot of slots) {
                if (removals >= MAX_REMOVALS) break
                weeklyTotal = getWeeklyTotal()
                if (((weeklyTotal - weeklyTarget) / weeklyTarget) * 100 < 3) break

                const normalizedSlot = normalizeSlotName(slot)
                const slotConfig = effectiveSlotConfig[normalizedSlot]
                    || effectiveSlotConfig['ÖĞLEN']
                    || effectiveSlotConfig['KAHVALTI']
                    || Object.values(effectiveSlotConfig)[0]

                const slotMeals = plan.meals.filter((m: any) => m.day === d && m.slot === slot)
                const minItems = slotConfig?.minItems || 1

                if (slotMeals.length <= minItems) continue

                const SIDE_AFFINITY_PAIRS: [string, string][] = [
                    ['bread', 'corba'], ['salad', 'maindish'], ['olive', 'breakfast_main'],
                ]
                const hasCompanion = (meal: any): boolean => {
                    const mealRole = this.getCanonicalLockRole(meal.food?.role || '')
                    if (!mealRole) return false
                    for (const [rA, rB] of SIDE_AFFINITY_PAIRS) {
                        const partner = mealRole === rA ? rB : mealRole === rB ? rA : null
                        if (!partner) continue
                        if (slotMeals.some((sm: any) => sm !== meal && this.getCanonicalLockRole(sm.food?.role || '') === partner)) return true
                    }
                    return false
                }

                const candidates = slotMeals.filter((m: any) => {
                    if (m.source?.type === 'fixed' || m.source?.type === 'required_role') return false
                    if (m.source?.type === 'compatibility_pull') return false
                    const role = this.getCanonicalLockRole(m.food?.role || '')
                    if (!REMOVABLE_ROLES.includes(role)) return false
                    if (role === 'maindish' || role === 'breakfast_main') return false
                    if (Planner.LOCKABLE_ROLES.includes(role) && this.weeklyLocks.has(role)) return false
                    // Protect frequency-rule-placed foods if the rule hasn't met its minimum
                    if (m.source?.type === 'rule' && m.source?.rule_id) {
                        const srcRule = this.rules?.find((r: any) => r.id === m.source.rule_id)
                        if (srcRule) {
                            const def = (srcRule.definition as any).data || srcRule.definition
                            const minCount = def?.min_count || 0
                            if (minCount > 0) {
                                const currentCount = plan.meals.filter((pm: any) =>
                                    pm.source?.rule_id === m.source.rule_id
                                ).length
                                if (currentCount <= minCount) return false
                            }
                        }
                    }
                    return true
                })

                if (candidates.length === 0) continue

                // Sort: remove least important first (highest priority number = first out)
                const SIDE_REDUCE_PRIORITY: Record<string, number> = {
                    sidedish: 0, meze: 0,           // gerçek yan yemek — en son çıksın
                    salad: 1,
                    bread: 2, olive: 2, cheese: 2,
                    dessert: 3, fruit: 3,
                    snack: 4,
                    nut: 5, seed: 5,
                    supplement: 6,
                }
                candidates.sort((a: any, b: any) => {
                    const affA = hasCompanion(a) ? 1 : 0
                    const affB = hasCompanion(b) ? 1 : 0
                    if (affA !== affB) return affA - affB
                    const roleA = this.getCanonicalLockRole(a.food?.role || '')
                    const roleB = this.getCanonicalLockRole(b.food?.role || '')
                    const prioA = SIDE_REDUCE_PRIORITY[roleA] ?? 3
                    const prioB = SIDE_REDUCE_PRIORITY[roleB] ?? 3
                    if (prioA !== prioB) return prioB - prioA // higher number removed first
                    const calA = (a.food?.calories || 0) * ((typeof a.portion_multiplier === 'number') ? a.portion_multiplier : 1)
                    const calB = (b.food?.calories || 0) * ((typeof b.portion_multiplier === 'number') ? b.portion_multiplier : 1)
                    return calA - calB
                })

                const victim = candidates[0]
                const victimIdx = plan.meals.indexOf(victim)
                if (victimIdx < 0) continue

                const remainingAfter = slotMeals.length - 1
                if (remainingAfter < minItems) continue

                const victimCals = (victim.food?.calories || 0) * ((typeof victim.portion_multiplier === 'number') ? victim.portion_multiplier : 1)
                this.log(d, slot, 'info',
                    `SIDE-REDUCE: Removed '${victim.food?.name}' (${Math.round(victimCals)}kcal, role=${victim.food?.role}) — slot ${slotMeals.length}→${remainingAfter} items`)
                plan.meals.splice(victimIdx, 1)
                removals++
            }
        }

        if (removals > 0) {
            weeklyTotal = getWeeklyTotal()
            const newSurplus = ((weeklyTotal - weeklyTarget) / weeklyTarget) * 100
            this.log(0, 'SIDE-REDUCE', 'info',
                `Completed: ${removals} side dish(es) removed. Surplus now ${newSurplus.toFixed(1)}%`)
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

        // Get all active frequency rules whose scope_weeks includes the current week
        const allFreqRules = this.rules.filter(r => r.is_active && r.rule_type === 'frequency')
        const freqRules = allFreqRules.filter(r => {
            const rawDef = r.definition as any
            const def = rawDef.data || rawDef
            return this.isRuleActiveForWeek(def)
        })
        const skippedCount = allFreqRules.length - freqRules.length
        if (skippedCount > 0) {
            this.log(0, 'FREQ-FLEX', 'info',
                `Skipped ${skippedCount} frequency rule(s) not active for week ${this.currentWeekNumber}`)
        }
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

        const removalPriorityForRule = (rule: PlanningRule): number => {
            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef
            const target = def.target
            if (!target) return 5

            const matching = plan.meals.filter((m: any) => this.matchesTarget(m.food, target))
            if (matching.length === 0) return 5

            const dominantRole = (() => {
                const roleCounts: Record<string, number> = {}
                for (const m of matching) {
                    const r = this.getCanonicalLockRole(m.food?.role || '') || 'unknown'
                    roleCounts[r] = (roleCounts[r] || 0) + 1
                }
                let best = 'unknown'; let bestCount = 0
                for (const [r, c] of Object.entries(roleCounts)) {
                    if (c > bestCount) { best = r; bestCount = c }
                }
                return best
            })()

            // Removal priority: higher number = removed FIRST in Freq-Flex
            // Tier 0: NEVER remove (core meal)
            // Tier 1: Protected (meal structure)
            // Tier 2: Important sides
            // Tier 3-8: Expendable (supplements, snacks, nuts first)
            const ROLE_PRIORITY: Record<string, number> = {
                maindish: 0, breakfast_main: 0,     // mutlaka olmalı
                corba: 1,                            // öğün yapısı
                sidedish: 2, meze: 2,               // gerçek yan yemek (enginar, bamya, cacık)
                salad: 3,                            // salata
                bread: 4, olive: 4, cheese: 4,      // ekmek/zeytin/peynir
                dessert: 5, fruit: 5,               // tatlı/meyve
                snack: 6,                            // atıştırmalık
                nut: 7, seed: 7,                     // kuruyemiş/çekirdek
                supplement: 8,                       // takviye (tahin, kollajen vb.)
            }
            return ROLE_PRIORITY[dominantRole] ?? 5
        }

        const AFFINITY_PAIRS: [string, string][] = [
            ['bread', 'corba'],
            ['salad', 'maindish'],
            ['olive', 'breakfast_main'],
        ]

        const hasAffinityCompanion = (meal: any, dayMeals: any[]): boolean => {
            const mealRole = this.getCanonicalLockRole(meal.food?.role || '')
            if (!mealRole) return false
            for (const [roleA, roleB] of AFFINITY_PAIRS) {
                const partner = mealRole === roleA ? roleB : mealRole === roleB ? roleA : null
                if (!partner) continue
                const sameSlotMeals = dayMeals.filter((dm: any) => dm.slot === meal.slot)
                if (sameSlotMeals.some((dm: any) => this.getCanonicalLockRole(dm.food?.role || '') === partner)) return true
            }
            return false
        }

        const MAX_FLEX_ITERATIONS = 10
        let flexCount = 0

        const getWeeklyEquivalentCount = (ruleDef: any, baseCount: number | null | undefined): number => {
            if (baseCount === null || baseCount === undefined) return 0
            const count = Number(baseCount)
            if (!Number.isFinite(count) || count <= 0) return 0

            const period = ruleDef.period || 'weekly'
            let dayMultiplier = 7
            
            // Implicit random_day_count only for `weekly` period (see note above).
            const randomDaysTarget = ruleDef.random_day_count || (period === 'weekly' && (!ruleDef.scope_days || ruleDef.scope_days.length === 0) && ruleDef.max_count ? ruleDef.max_count : null)
            if (randomDaysTarget) {
                dayMultiplier = typeof randomDaysTarget === 'number' ? randomDaysTarget : Number(randomDaysTarget)
            } else if (ruleDef.scope_days && ruleDef.scope_days.length > 0) {
                dayMultiplier = ruleDef.scope_days.length
            }

            if (period === 'per_meal') {
                let mealMultiplier = mealTypes.filter((m: string) => m !== 'KAHVALTI').length || 2
                if (ruleDef.scope_meals && ruleDef.scope_meals.length > 0) {
                    mealMultiplier = ruleDef.scope_meals.length
                }
                return count * dayMultiplier * mealMultiplier
            } else if (period === 'daily') {
                return count * dayMultiplier
            }
            return count // weekly
        }

        if (weeklyGap > 0) {
            // === CALORIE DEFICIT: Increase frequency (min → max) ===
            // Sort rules by average calories (highest first - fill faster)
            const expandableRules = freqRules
                .map(rule => {
                    const rawDef = rule.definition as any
                    const def = rawDef.data || rawDef
                    const current = countRuleOccurrences(rule)
                    const equivalentMax = getWeeklyEquivalentCount(def, def.max_count)
                    const maxCount = equivalentMax > 0 ? equivalentMax : current
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
                    let minCount = getWeeklyEquivalentCount(def, def.min_count) || 0
                    // For exclusive_scope rules, the effective min is at least the number
                    // of active days — removing below that defeats the scope_days intent.
                    const exActiveDays = this.exclusiveScopeActiveDaysMap.get(rule.id)
                    if (exActiveDays && exActiveDays.length > minCount) {
                        minCount = exActiveDays.length
                    }
                    const canReduce = current - minCount
                    const avgCal = avgCaloriesForRule(rule)
                    const priority = removalPriorityForRule(rule)
                    return { rule, def, current, minCount, canReduce, avgCal, priority }
                })
                .filter(r => r.canReduce > 0 && r.avgCal > 0)
                .sort((a, b) => {
                    if (a.priority !== b.priority) return b.priority - a.priority
                    if (a.current !== b.current) return b.current - a.current
                    return b.avgCal - a.avgCal
                })

            for (const reducible of reducibleRules) {
                if (flexCount >= MAX_FLEX_ITERATIONS) break

                weeklyTotal = getWeeklyTotal()
                const currentSurplus = weeklyTotal - weeklyTarget
                if (currentSurplus < weeklyTarget * 0.03) break // Surplus closed to <3%

                const { rule, def, minCount } = reducible
                let currentCount = countRuleOccurrences(rule)

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
                            m.source?.type !== 'fixed' &&
                            m.source?.type !== 'required_role' &&
                            m.source?.type !== 'compatibility_pull' &&
                                (() => {
                                    // SELF ACTIVE-DAY PROTECTION: When an exclusive_scope rule is reducing
                                    // its own count, don't remove from its own active days — those placements
                                    // are the whole point of the exclusive scope. Only allow removal from
                                    // non-active days (accidental matches placed by other rules).
                                    const selfExDays = this.exclusiveScopeActiveDaysMap.get(rule.id)
                                    if (selfExDays && selfExDays.includes(d)) return false
                                    // CROSS-RULE MIN PROTECTION: If this meal ALSO matches another active frequency
                                    // rule whose min_count is currently exactly met (or one above), removing it
                                    // would violate that rule. Check all overlapping rules before allowing removal.
                                    // Example: peynir "isim" rule min=5, another peynir rule min=1 — Freq-Flex processing
                                    // the second rule must not drop the first below 5.
                                    for (const otherRule of freqRules) {
                                        if (otherRule.id === rule.id) continue
                                        const otherDef = ((otherRule.definition as any).data || otherRule.definition) as any
                                        if (!otherDef.target || !this.matchesTarget(m.food, otherDef.target)) continue
                                        let otherMin = otherDef.min_count || 0
                                        const otherExDays = this.exclusiveScopeActiveDaysMap.get(otherRule.id)
                                        if (otherExDays && otherExDays.length > otherMin) otherMin = otherExDays.length
                                        if (otherMin <= 0) continue
                                        const otherCurrent = countRuleOccurrences(otherRule)
                                        if (otherCurrent <= otherMin) return false // would break other rule's min
                                    }

                                    // EXCLUSIVE SCOPE PROTECTION: Don't remove food on a day
                                    // that is an active day for an exclusive_scope rule targeting
                                    // the same food. The exclusive rule "owns" those days.
                                    for (const [exRuleId, exActiveDays] of Array.from(this.exclusiveScopeActiveDaysMap)) {
                                        if (exRuleId === rule.id) continue
                                        if (!exActiveDays.includes(d)) continue
                                        const exRule = this.rules.find(r => r.id === exRuleId)
                                        if (!exRule) continue
                                        const exDef = ((exRule.definition as any).data || exRule.definition) as any
                                        if (exDef.target && this.matchesTarget(m.food, exDef.target)) return false
                                    }

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
                                    // Always protect maindish, breakfast_main, and sidedish even if requiredRoles is empty in DB
                                    const HARDCODED_PROTECTED_ROLES = ['maindish', 'breakfast_main', 'sidedish']
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

                    dayCalories.sort((a, b) => {
                        const mealA = plan.meals[a.mealIdx]
                        const mealB = plan.meals[b.mealIdx]
                        const dayMealsA = plan.meals.filter((m: any) => m.day === a.day)
                        const dayMealsB = plan.meals.filter((m: any) => m.day === b.day)
                        const affA = hasAffinityCompanion(mealA, dayMealsA) ? 0 : 1
                        const affB = hasAffinityCompanion(mealB, dayMealsB) ? 0 : 1
                        if (affA !== affB) return affB - affA
                        return b.cals - a.cals
                    })
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

    private enforceFrequencyRuleMinimums(plan: any, mealTypes: string[]) {
        const freqRules = this.rules.filter(r => {
            if (!r.is_active || r.rule_type !== 'frequency') return false
            const rawDef = r.definition as any
            const def = rawDef.data || rawDef
            return this.isRuleActiveForWeek(def)
        })
        if (freqRules.length === 0) return

        const countRuleOccurrences = (rule: PlanningRule): number => {
            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef
            if (!def.target) return 0
            return plan.meals.filter((m: any) => this.matchesTarget(m.food, def.target)).length
        }

        const getWeeklyEquivalentCount = (def: any, val: any): number => {
            if (!val) return 0
            const count = parseInt(val)
            if (isNaN(count)) return 0
            if (def.period === 'daily') return count * 7
            if (def.period === 'per_meal') return count * 7 * Math.max(1, (def.scope_meals || []).length)
            return count
        }

        for (const rule of freqRules) {
            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef
            if (!def.target) continue
            
            // Force inclusion if explicitly set to true, or if undefined (backward compatibility / AI defaults)
            const force_inc = def.force_inclusion !== undefined ? def.force_inclusion : true;
            if (force_inc !== true) continue;

            const minCount = getWeeklyEquivalentCount(def, def.min_count) || 1
            let current = countRuleOccurrences(rule)
            if (current >= minCount) continue

            const eligible = this.eligibleFoods.filter((f: any) => this.matchesTarget(f, def.target))
            if (eligible.length === 0) {
                this.log(0, 'FREQ-FORCE', 'error', `Cannot force freq rule ${rule.name}, no eligible foods found.`)
                continue
            }

            const allowedMeals = Array.isArray(def.scope_meals) && def.scope_meals.length > 0 ? def.scope_meals : mealTypes

            // Bypassed forced push to prevent menu overflow and macro explosion.
            // Frequency budget handles picking them during natural generation.
            if (current < minCount) {
                this.log(0, 'FREQ-FORCE', 'info', `Skipped forced add for ${rule.name} to avoid overflowing capacity (macros).`)
            }
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
        // Protect fixed meal items from portion adjustments
        if (meal.source?.type === 'fixed') return false

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
        // Deduplicate fixed foods to prevent accidental duplicate insertions from overlapping rules
        const uniqueFixedFoods = [...new Set(fixedFoods)]
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        // Level 1: case + whitespace + Turkish locale lowercase.
        //   Keeps diacritics — "Domates Çorbası" ↔ "domates çorbası" match, but "Sut Corbasi" does not.
        const normalizeName = (s: string) => String(s || '')
            .trim()
            .toLocaleLowerCase('tr-TR')
            .replace(/\s+/g, ' ')
        // Level 2: ASCII-fold + punctuation strip.
        //   Handles user typos and missing diacritics: ş→s, ç→c, ğ→g, ö→o, ü→u, ı/İ→i.
        //   Also strips (parentheses), commas, periods, apostrophes so "Süt Çorbası (Klasik)" ↔ "sut corbasi klasik".
        const TR_FOLD_MAP: Record<string, string> = {
            'ç': 'c', 'ğ': 'g', 'ı': 'i', 'i̇': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
            'â': 'a', 'î': 'i', 'û': 'u'
        }
        const foldName = (s: string) => {
            const lowered = normalizeName(s)
            // First apply Turkish-specific folding
            let folded = lowered.replace(/[çğıi̇öşüâîû]/g, ch => TR_FOLD_MAP[ch] ?? ch)
            // Then strip any remaining combining marks (NFD) for other Latin accents
            folded = folded.normalize('NFD').replace(/[̀-ͯ]/g, '')
            // Strip common punctuation and collapse whitespace
            folded = folded.replace(/[().,;:!?'"`´\-_/\\]/g, ' ').replace(/\s+/g, ' ').trim()
            return folded
        }
        for (const rawEntry of uniqueFixedFoods) {
            const entry = String(rawEntry || '').trim()
            if (!entry) continue

            let food: any | undefined
            let matchKind = 'exact'

            // 1) UUID lookup (Sera should emit food_id going forward)
            if (UUID_RE.test(entry)) {
                food = this.allFoods.find(f => f.id === entry)
                matchKind = 'id'
            }

            // 2) Exact name match (fast path, preserves original behavior)
            if (!food) {
                food = this.allFoods.find(f => f.name === entry)
            }

            // 3) Case/space-insensitive Turkish-locale match (preserves diacritics)
            if (!food) {
                const target = normalizeName(entry)
                food = this.allFoods.find(f => normalizeName(f.name) === target)
                if (food) matchKind = 'normalized'
            }

            // 4) ASCII-fold match (handles missing diacritics + İ/I/ı/i confusion)
            if (!food) {
                const target = foldName(entry)
                if (target) {
                    food = this.allFoods.find(f => foldName(f.name) === target)
                    if (food) matchKind = 'folded'
                }
            }

            // 5) Fuzzy fallback: unique substring containment on folded form
            if (!food) {
                const target = foldName(entry)
                const candidates = this.allFoods.filter(f => {
                    const n = foldName(f.name)
                    if (!n || !target) return false
                    return n.includes(target) || target.includes(n)
                })
                if (candidates.length === 1) {
                    food = candidates[0]
                    matchKind = 'fuzzy'
                } else if (candidates.length > 1) {
                    // Ambiguous — pick the shortest name (most specific match wins).
                    food = candidates.sort((a, b) => a.name.length - b.name.length)[0]
                    matchKind = 'fuzzy-ambiguous'
                    this.log(context.dayIndex + 1, slotName, 'info',
                        `Fixed meal ambiguous "${entry}" — ${candidates.length} candidates, picked "${food.name}"`)
                }
            }

            if (food) {
                selectedFoods.push(food)
                selectedIds.add(food.id)
                this.addFoodMacros(slotMacros, food)
                this.addFoodTags(slotTags, food)
                const suffix = matchKind === 'exact' ? '' : ` [match:${matchKind}]`
                this.log(context.dayIndex + 1, slotName, 'select', `Fixed meal selected${suffix}`, food.name)
                selectedFoods[selectedFoods.length - 1].source = { type: 'fixed', rule: 'Fixed Meal', matchKind }
            } else {
                this.log(context.dayIndex + 1, slotName, 'error', `Fixed meal not found: "${entry}" (no exact, normalized, or fuzzy match in food DB)`)
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
            else if (targetType === 'name_or_tag' || targetType === 'ingredient') score += 55
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

            // Check Scope Meals + Spreading assignment
            if (def.scope_meals && def.scope_meals.length > 0) {
                const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                if (!normalizedScopeMeals.includes(normalizeSlotName(slotName))) return false
                // Multi-scope_meals rules have spreading assignments too
                if (def.scope_meals.length > 1) {
                    const assignments = context.ruleSlotAssignments as Map<string, string> | undefined
                    if (assignments && assignments.size > 0) {
                        const assignedSlot = assignments.get(r.id)
                        if (assignedSlot && normalizeSlotName(assignedSlot) !== normalizeSlotName(slotName)) return false
                    }
                }
            } else {
                // Flexible rule (no scope_meals): respect pre-day spreading assignment
                const assignments = context.ruleSlotAssignments as Map<string, string> | undefined
                if (assignments && assignments.size > 0) {
                    const assignedSlot = assignments.get(r.id)
                    if (assignedSlot && normalizeSlotName(assignedSlot) !== normalizeSlotName(slotName)) return false
                }
            }

            // Check Scope Days
            const dayOfWeek = context.dayIndex + 1
            if (def.scope_days && def.scope_days.length > 0 && !def.scope_days.includes(dayOfWeek)) return false

            // Check Random Days (Explicit or Implicit based on max_count)
            // IMPORTANT: Implicit random_day_count ONLY makes sense for `weekly` period.
            // - `weekly` + max_count=3 → "3 gün rastgele" varsayımı doğru
            // - `daily` + max_count=1 → "her gün en fazla 1" demektir; haftada 1 güne indirmek YANLIŞ.
            // - `per_meal` + max_count → "öğün başına max N" demektir; gün kısıtı değil.
            const period = def.period || 'weekly'
            const useImplicitRandomDays = period === 'weekly' && (!def.scope_days || def.scope_days.length === 0) && def.max_count
            const randomDaysTarget = def.random_day_count || (useImplicitRandomDays ? def.max_count : null)
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
            // "Two birds, one stone": e.g. required mainDish + börek frequency rule → pick börek (mainDish role) once.
            // Sort by specificity first (not sort_order) so more specific rules win the intersection.
            let food: any | null = null
            let intersectedRule: any | null = null
            const requiredRoleNorm = this.getCanonicalLockRole(role || '')
            const intersectionRules = [...relevantRules].sort((a, b) => {
                const specDiff = getFrequencyRuleSpecificity(b) - getFrequencyRuleSpecificity(a)
                if (specDiff !== 0) return specDiff
                return (b.priority || 0) - (a.priority || 0)
            })
            for (const rule of intersectionRules) {
                const def = (rule.definition as any).data || rule.definition
                if (!def?.target) continue
                const period = def.period || 'weekly'
                const currentCount = this.countOccurrences(def.target, context, period, def.scope_meals)
                const minNeeded = Math.max(0, (def.min_count || 0) - currentCount)
                if (minNeeded <= 0) continue

                const targetType = def.target.type || ''
                const forceInclusion = def.force_inclusion === true
                let intersectionFood: any | null = null

                // Intersection weekly lock: reuse same food all week for this rule
                const lockedFood = this.intersectionWeeklyLocks.get(rule.id)
                const MAX_WEEKLY_INTERSECTION = 3
                const lockUsage = lockedFood ? (context.weeklySelectedIds?.get(lockedFood.id) || 0) : 0
                if (lockedFood && lockUsage < MAX_WEEKLY_INTERSECTION
                    && !selectedIds.has(lockedFood.id)
                    && this.isMealTypeCompatibleWithSlot(lockedFood, slotName)
                    && !this.hasTagConflict(lockedFood, slotTags)) {
                    const lockedRole = this.getCanonicalLockRole(lockedFood.role || '')
                    if (!requiredRoleNorm || lockedRole === requiredRoleNorm
                        || (requiredRoleNorm === 'maindish' && (() => {
                            const PROMO = new Set(['börekler', 'borekler', 'borek', 'börek', 'muffin', 'poğaça', 'pogaca'])
                            return PROMO.has(normalizeCategory(lockedFood.category || ''))
                        })())) {
                        intersectionFood = lockedFood
                        this.log(context.dayIndex + 1, slotName, 'info',
                            `Intersection: '${rule.name}' → weekly lock reuse '${lockedFood.name}' (usage ${lockUsage}/${MAX_WEEKLY_INTERSECTION})`)
                    }
                }

                if (!intersectionFood && targetType === 'role') {
                    const targetRoleNorm = this.getCanonicalLockRole(def.target.value || '')
                    if (requiredRoleNorm && targetRoleNorm !== requiredRoleNorm) continue
                    intersectionFood = await this.selectBestFoodByRole(
                        category, def.target.value, context, selectedIds, slotTags,
                        context.slotMainDish || null, slotCalorieBudget - slotMacros.calories,
                        true, false, forceInclusion, true
                    )
                } else if (!intersectionFood && targetType === 'category') {
                    // Direct candidate filter for category targets (not selectBestFoodByRole)
                    // This allows role promotion: a POĞAÇA/BÖREK food with role=mainDish/bread
                    // can serve as the required mainDish slot
                    const MAINDISH_PROMO_CATS_INT = new Set(['börekler', 'borekler', 'borek', 'börek', 'muffin', 'poğaça', 'pogaca'])
                    const catCandidates = this.eligibleFoods.filter(f => {
                        if (selectedIds.has(f.id)) return false
                        if (!this.matchesTarget(f, def.target)) return false
                        const fRole = this.getCanonicalLockRole(f.role || '')
                        if (requiredRoleNorm && fRole !== requiredRoleNorm) {
                            const fCatNorm = normalizeCategory(f.category || '')
                            if (!(requiredRoleNorm === 'maindish' && MAINDISH_PROMO_CATS_INT.has(fCatNorm))) return false
                        }
                        if (!this.isMealTypeCompatibleWithSlot(f, slotName)) return false
                        if (this.hasTagConflict(f, slotTags)) return false
                        return true
                    })
                    if (catCandidates.length === 0) {
                        // Diagnostic: why no candidates?
                        const diagReasons: Record<string, number> = {}
                        for (const f of this.eligibleFoods) {
                            if (selectedIds.has(f.id)) { diagReasons['selectedId'] = (diagReasons['selectedId'] || 0) + 1; continue }
                            if (!this.matchesTarget(f, def.target)) continue // not in target category — skip silently
                            const fRole = this.getCanonicalLockRole(f.role || '')
                            if (requiredRoleNorm && fRole !== requiredRoleNorm) {
                                const fCatNorm = normalizeCategory(f.category || '')
                                if (!(requiredRoleNorm === 'maindish' && MAINDISH_PROMO_CATS_INT.has(fCatNorm))) {
                                    diagReasons[`roleBlock(${fRole},cat=${fCatNorm})`] = (diagReasons[`roleBlock(${fRole},cat=${fCatNorm})`] || 0) + 1; continue
                                }
                            }
                            if (!this.isMealTypeCompatibleWithSlot(f, slotName)) { diagReasons['mealType'] = (diagReasons['mealType'] || 0) + 1; continue }
                            if (this.hasTagConflict(f, slotTags)) { diagReasons['tagConflict'] = (diagReasons['tagConflict'] || 0) + 1; continue }
                            diagReasons['passedAll'] = (diagReasons['passedAll'] || 0) + 1
                        }
                        const totalMatch = Object.values(diagReasons).reduce((a, b) => a + b, 0)
                        if (totalMatch > 0) {
                            this.log(context.dayIndex + 1, slotName, 'info',
                                `Intersection: '${rule.name}' catCandidates=0 from ${totalMatch} checked. Reasons: ${Object.entries(diagReasons).map(([k, v]) => `${k}=${v}`).join(', ')}`)
                        }
                    }
                    if (catCandidates.length > 0) {
                        const usedDay = new Set(context.dailyFoods?.map((x: any) => x.id) || [])
                        const weeklyUsage: Map<string, number> = context.weeklySelectedIds || new Map()
                        const MAX_WEEKLY_INTERSECTION = 3
                        catCandidates.sort((a, b) => {
                            // 1) Strongly penalize foods used >= MAX times this week (variety)
                            const aWeek = weeklyUsage.get(a.id) || 0
                            const bWeek = weeklyUsage.get(b.id) || 0
                            const aOver = aWeek >= MAX_WEEKLY_INTERSECTION ? 1 : 0
                            const bOver = bWeek >= MAX_WEEKLY_INTERSECTION ? 1 : 0
                            if (aOver !== bOver) return aOver - bOver
                            // 2) Prefer higher priority score
                            const prioA = this.settings?.food_score_overrides?.[a.id] ?? a.priority_score ?? 5
                            const prioB = this.settings?.food_score_overrides?.[b.id] ?? b.priority_score ?? 5
                            if (prioA !== prioB) return prioB - prioA
                            // 3) Prefer less-used-this-week
                            if (aWeek !== bWeek) return aWeek - bWeek
                            // 4) Avoid same-day repeat
                            const aDay = usedDay.has(a.id) ? 1 : 0
                            const bDay = usedDay.has(b.id) ? 1 : 0
                            if (aDay !== bDay) return aDay - bDay
                            // 5) Lower calorie tiebreaker
                            return (a.calories || 0) - (b.calories || 0)
                        })
                        intersectionFood = catCandidates[0]
                    }
                } else if (!intersectionFood && (targetType === 'food_id' || targetType === 'name_or_tag' || targetType === 'tag')) {
                    // Direct search: find foods matching the target that also have the required role
                    const MAINDISH_PROMOTABLE_CATS = new Set(['börekler', 'borekler', 'borek', 'börek', 'muffin', 'poğaça', 'pogaca'])
                    const candidates = this.eligibleFoods.filter(f => {
                        if (selectedIds.has(f.id)) return false
                        if (!this.matchesTarget(f, def.target)) return false
                        const fRole = this.getCanonicalLockRole(f.role || '')
                        if (requiredRoleNorm && fRole !== requiredRoleNorm) {
                            const fCatNorm = normalizeCategory(f.category || '')
                            if (!(requiredRoleNorm === 'maindish' && MAINDISH_PROMOTABLE_CATS.has(fCatNorm))) return false
                        }
                        if (!this.isMealTypeCompatibleWithSlot(f, slotName)) return false
                        if (this.hasTagConflict(f, slotTags)) return false
                        return true
                    })
                    if (candidates.length > 0) {
                        const usedDay = new Set(context.dailyFoods?.map((x: any) => x.id) || [])
                        const weeklyUsage: Map<string, number> = context.weeklySelectedIds || new Map()
                        const MAX_WEEKLY_INTERSECTION = 3
                        candidates.sort((a, b) => {
                            const aWeek = weeklyUsage.get(a.id) || 0
                            const bWeek = weeklyUsage.get(b.id) || 0
                            const aOver = aWeek >= MAX_WEEKLY_INTERSECTION ? 1 : 0
                            const bOver = bWeek >= MAX_WEEKLY_INTERSECTION ? 1 : 0
                            if (aOver !== bOver) return aOver - bOver
                            const prioA = this.settings?.food_score_overrides?.[a.id] ?? a.priority_score ?? 5
                            const prioB = this.settings?.food_score_overrides?.[b.id] ?? b.priority_score ?? 5
                            if (prioA !== prioB) return prioB - prioA
                            if (aWeek !== bWeek) return aWeek - bWeek
                            const aDay = usedDay.has(a.id) ? 1 : 0
                            const bDay = usedDay.has(b.id) ? 1 : 0
                            if (aDay !== bDay) return aDay - bDay
                            return (a.calories || 0) - (b.calories || 0)
                        })
                        intersectionFood = candidates[0]
                    }
                } else if (!intersectionFood) {
                    continue
                }

                if (!intersectionFood) {
                    this.log(context.dayIndex + 1, slotName, 'info',
                        `Intersection: '${rule.name}' (${targetType}) → selectBestFoodByRole returned null`)
                    continue
                }
                // AFFINITY GUARD: Check intersection candidate against weekly-locked foods.
                // Only bypass for rules that specifically target bread-conflicting categories
                // (börek, poğaça, muffin). Generic rules like 'Ana yemek sıklık' must NOT bypass.
                if (this.weeklyLocks.size > 0) {
                    const lockFoods = [...this.weeklyLocks.values()].filter(Boolean)
                    if (this.hasForbiddenAffinityConflict(intersectionFood, lockFoods)) {
                        const BREAD_CONFLICT_CATS = new Set(['börekler', 'borekler', 'borek', 'börek', 'muffin', 'poğaça', 'pogaca', 'tost'])
                        const ruleTargetsCat = targetType === 'category' && BREAD_CONFLICT_CATS.has(normalizeCategory(def.target.value || ''))
                        if (minNeeded > 0 && ruleTargetsCat) {
                            this.log(context.dayIndex + 1, slotName, 'info',
                                `Intersection: '${rule.name}' → '${intersectionFood.name}' has affinity conflict with weekly-locked food, but rule targets börek/poğaça/muffin with unmet min (${minNeeded} remaining) — allowing, bread will skip this slot`)
                        } else {
                            this.log(context.dayIndex + 1, slotName, 'info',
                                `Intersection: '${rule.name}' → '${intersectionFood.name}' blocked by forbidden affinity with weekly-locked food`)
                            continue
                        }
                    }
                }
                // Skip matchesTarget for lock-reused foods — they were validated when first locked
                const isLockReused = lockedFood && intersectionFood === lockedFood
                if (!isLockReused && !this.matchesTarget(intersectionFood, def.target)) {
                    this.log(context.dayIndex + 1, slotName, 'info',
                        `Intersection: '${rule.name}' (${targetType}) → food '${intersectionFood.name}' doesn't match target (likely weekly lock override)`)
                    continue
                }

                const intersectionRole = this.getCanonicalLockRole(intersectionFood.role || '')
                if (requiredRoleNorm && intersectionRole !== requiredRoleNorm) {
                    // Role promotion: allow substantial foods (börek, poğaça, muffin) to serve as mainDish
                    // Plain bread (ekmek) should NOT be promoted — only meal-substantial categories
                    const MAINDISH_PROMOTABLE_CATEGORIES = new Set(['börekler', 'borekler', 'borek', 'börek', 'muffin', 'poğaça', 'pogaca'])
                    const foodCatNorm = normalizeCategory(intersectionFood.category || '')
                    const isSubstantialFood = MAINDISH_PROMOTABLE_CATEGORIES.has(foodCatNorm)
                    if (requiredRoleNorm === 'maindish' && isSubstantialFood) {
                        this.log(context.dayIndex + 1, slotName, 'info',
                            `Intersection: '${rule.name}' → role promotion ${intersectionRole}→mainDish for '${intersectionFood.name}' (cat=${foodCatNorm})`)
                    } else {
                        this.log(context.dayIndex + 1, slotName, 'info',
                            `Intersection: '${rule.name}' (${targetType}) → role mismatch (need ${requiredRoleNorm}, got ${intersectionRole})`)
                        continue
                    }
                }
                if (intersectionRole && UNIQUE_SLOT_ROLES.has(intersectionRole) && selectedRoles.has(intersectionRole)) continue

                food = intersectionFood
                intersectedRule = rule
                // Lock this food for the week so the same rule reuses it
                // EXCEPTION: mainDish targets should NOT be locked — variety is crucial for main courses.
                // Locks are designed for supplementary roles (bread, soup, börek) where consistency is desirable.
                const targetRoleForLock = this.getCanonicalLockRole(def.target?.value || '')
                const isMainDishRuleTarget = targetType === 'role' && targetRoleForLock === 'maindish'
                if (!this.intersectionWeeklyLocks.has(rule.id) && !isMainDishRuleTarget) {
                    this.intersectionWeeklyLocks.set(rule.id, intersectionFood)
                    this.log(context.dayIndex + 1, slotName, 'info',
                        `Intersection: '${rule.name}' → weekly lock set for '${intersectionFood.name}'`)
                }
                this.log(
                    context.dayIndex + 1,
                    slotName,
                    'info',
                    `Required role '${role}' intersected with '${rule.name}' (${targetType})`,
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
                    true,
                    true
                )
                if (food) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Required role '${role}' filled with cap bypass`, food.name)
                }
            }
            // ROLE MISMATCH GUARD: Reject food if its actual role doesn't match the requested role
            // This catches cases where lock/consistency returns bread for a mainDish request
            // EXCEPTION: Skip guard when food was placed via intersection role promotion
            // (e.g., börek/poğaça with role=bread serving as mainDish through a frequency rule)
            const MAINDISH_PROMO_CATS_GUARD = new Set(['börekler', 'borekler', 'borek', 'börek', 'muffin', 'poğaça', 'pogaca'])
            const isRolePromoted = intersectedRule && food && (() => {
                const requestedRole = this.getCanonicalLockRole(role)
                const foodCatNorm = normalizeCategory(food.category || '')
                return requestedRole === 'maindish' && MAINDISH_PROMO_CATS_GUARD.has(foodCatNorm)
            })()
            if (food && STANDARD_ROLES.includes(role) && !isRolePromoted) {
                const actualRole = this.getCanonicalLockRole(food.role || '')
                const requestedRole = this.getCanonicalLockRole(role)
                if (actualRole !== requestedRole) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Role mismatch: requested '${role}' (${requestedRole}) but got '${food.name}' with role '${food.role}' (${actualRole}). Retrying with emergency mode...`)
                    // Retry with full emergency mode to bypass locks and find a correctly-typed food
                    food = await this.selectBestFoodByRole(
                        category, role, context, selectedIds, slotTags, null,
                        99999, true, true, true, true, true
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
        const deferredRules: string[] = []
        for (const rule of relevantRules) {
            const def = (rule.definition as any).data || rule.definition
            const forceInclusion = def.force_inclusion === true

            // CHECK 1: Max Items Limit (ABSOLUTE - never bypass, even for forced rules)
            if (selectedFoods.length >= config.maxItems) continue

            // ── SMART BUDGET TIERS ──
            // < 70%  → Normal: all rules proceed
            // 70-110% → Economy: prefer low-cal alternatives (handled in candidate sorting)
            // 110-140% → Deferral: skip flexible rules (no scope_meals) — they can go to other slots
            // > 140% → Priority cutoff: only patient-scope or forced rules continue
            const budgetRatio = slotMacros.calories / (slotCalorieBudget || 1)
            const isSlotSpecific = def.scope_meals && def.scope_meals.length > 0
            const period = def.period || 'weekly'
            const isPerMeal = period === 'per_meal'

            // Determine how many items we have vs how many needed (check BEFORE deferral)
            const currentCount = this.countOccurrences(def.target, context, period, def.scope_meals)
            const needed = Math.max(0, (def.min_count || 0) - currentCount)
            const hasUnmetMinimum = needed > 0

            if (budgetRatio >= 1.4 && !forceInclusion && !hasUnmetMinimum) {
                deferredRules.push(rule.name)
                continue
            }
            if (budgetRatio >= 1.1 && !isSlotSpecific && !isPerMeal && !forceInclusion && !hasUnmetMinimum) {
                deferredRules.push(rule.name)
                continue
            }

            // If this slot already contains the target (e.g. required-role intersection already satisfied it),
            // do not try to add the same target again in Pass 1.
            // EXCEPTION: exclusive_scope rules on their active days always get to place their own item,
            // even if another rule already placed a matching food (e.g. tahinli yemek placing a TATLILAR food).
            const exScopeActiveDays = this.exclusiveScopeActiveDaysMap.get(rule.id)
            const isExScopeActiveDay = exScopeActiveDays && exScopeActiveDays.includes(context.dayIndex + 1)
            if (def.target && !isExScopeActiveDay && selectedFoods.some((f: any) => this.matchesTarget(f, def.target))) {
                continue
            }

            if (needed > 0) {
                // Try to fill needed amount
                for (let k = 0; k < needed; k++) {
                    // Inner Loop Limit: Stop if maxItems reached (ABSOLUTE)
                    if (selectedFoods.length >= config.maxItems) break

                    // Prevention: Don't add multiple items for the SAME rule in ONE slot.
                    // A `weekly` or `daily` rule wants N items across the week/day — not N in one slot.
                    // Only `per_meal` explicitly configured with min_count>1 may add more than 1 per slot.
                    // This prevents e.g. "peynir weekly min=5" from dumping 5 peynir foods into one öğün.
                    if (k > 0) {
                        if (!(period === 'per_meal' && (def.min_count || 1) > 1)) {
                            break
                        }
                    }

                    // Allow budget overflow if force_inclusion is ON
                    // Also exempt: first sidedish item when slot has none yet (yan yemek guaranteed per meal)
                    const targetRoleForBudget = this.getCanonicalLockRole(def.target?.value || '')
                    const isSidedishExempt = k === 0
                        && (targetRoleForBudget === 'sidedish' || normalizeCategory(def.target?.value || '') === 'sidedish')
                        && !selectedRoles.has('sidedish')
                    if (slotMacros.calories >= slotCalorieBudget * 1.75 && !forceInclusion && !isSidedishExempt && !hasUnmetMinimum) {
                        this.log(context.dayIndex + 1, slotName, 'info', `Budget filled during Pass 1, stopping rule '${rule.name}'`)
                        break
                    }

                    // Extract role/category from target to facilitate selection
                    const targetType = def.target.type
                    const targetValue = def.target.value
                    let searchRole = 'sideDish' // Default fallback

                    if (targetType === 'role') searchRole = targetValue
                    else if (targetType === 'category') searchRole = targetValue

                    // For name-based / tag-based targets (name_contains, name_or_tag, tag, food_id),
                    // don't restrict to a specific role — those targets need a role-agnostic search
                    // because matching foods can have varied roles (mainDish, sideDish, supplement, ...).
                    // Example: "peynir" as name_or_tag matches "Peynirli Tavuk Sarma" (mainDish),
                    // "Tavada Kaşarlı Mantar" (sideDish), "Girit Ezmesi" (sideDish) — mixed roles.
                    const isNameOrTagBased = targetType === 'name_contains'
                        || targetType === 'name_or_tag'
                        || targetType === 'ingredient'
                        || targetType === 'tag'
                        || targetType === 'food_id'

                    // UNIQUE ROLE CHECK: Skip if this role is already filled in the slot
                    // (skip this check for name/tag-based targets, since we don't gate by role)
                    if (!isNameOrTagBased) {
                        const normalizedSearchRole = this.getCanonicalLockRole(searchRole || '')
                        if (UNIQUE_SLOT_ROLES.has(normalizedSearchRole) && selectedRoles.has(normalizedSearchRole)) {
                            this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Skipping rule '${rule.name}' - role '${searchRole}' already filled in slot`)
                            break
                        }
                    }

                    let selectedFood: any | null = null
                    const ecoThreshold = (context.iterationFactor || 1) > 1 ? 0.7 : 0.9
                    const economyMode = slotMacros.calories >= slotCalorieBudget * ecoThreshold
                    if (economyMode && k === 0) {
                        this.log(context.dayIndex + 1, slotName, 'info',
                            `Economy mode ON for '${rule.name}' (${Math.round(slotMacros.calories)}/${Math.round(slotCalorieBudget)} kcal) — picking low-cal alternatives`)
                    }

                    if (isNameOrTagBased) {
                        // Direct pool scan: find any eligible food matching the target, regardless of role.
                        // Prefer foods not already used this slot; then not used this day; then any eligible.
                        const usedDay = new Set(this.currentWeekFoods
                            .filter((f: any) => f._dayIndex === context.dayIndex)
                            .map((f: any) => f.id))
                        // Sera may set def._bypass_meal_types when the user insists on adding a food
                        // whose meal_types normally don't include this slot (e.g., breakfast tahin at dinner).
                        // The rule then bypasses the HARD meal_types constraint for THIS rule only.
                        const bypassMealTypes = def._bypass_meal_types === true
                        // force_inclusion=true rules represent explicit user insistence.
                        // Diversity (tag-conflict) filter is secondary in that case and can trap
                        // the rule (e.g., "keto" tag on both the main dish and every tahin variant
                        // would silently exclude all tahin candidates). Bypass it only for forced rules.
                        const relaxTagConflict = forceInclusion
                        const candidates = this.eligibleFoods.filter(f => {
                            if (selectedIds.has(f.id)) return false
                            if (!this.matchesTarget(f, def.target)) return false
                            if (!bypassMealTypes && !this.isMealTypeCompatibleWithSlot(f, slotName)) return false
                            if (!relaxTagConflict && this.hasTagConflict(f, slotTags)) return false
                            if (this.hasReachedWeeklyCap(f, this.currentWeekFoods.filter((x: any) => x.id === f.id).length)) return false
                            // Respect slot bannedRoles/bannedTags via context
                            if (context.currentBannedRoles && context.currentBannedRoles.length > 0) {
                                const foodRoleNorm = this.getCanonicalLockRole(f.role || '')
                                if (context.currentBannedRoles.includes(foodRoleNorm)) return false
                            }
                            if (context.currentBannedTags && context.currentBannedTags.length > 0 && Array.isArray(f.tags)) {
                                if (f.tags.some((t: string) => typeof t === 'string' && context.currentBannedTags.includes(t.toLowerCase()))) return false
                            }
                            // Respect slot uniqueness for the food's canonical role
                            const fRole = this.getCanonicalLockRole(f.role || '')
                            if (fRole && UNIQUE_SLOT_ROLES.has(fRole) && selectedRoles.has(fRole)) return false
                            return true
                        })
                        candidates.sort((a, b) => {
                            // Diversity FIRST: never pick the same food twice today
                            const aToday = usedDay.has(a.id) ? 1 : 0
                            const bToday = usedDay.has(b.id) ? 1 : 0
                            if (aToday !== bToday) return aToday - bToday
                            // Weekly usage: prefer less-used foods (respects min/max naturally)
                            const aWeekly = this.currentWeekFoods.filter((x: any) => x.id === a.id).length
                            const bWeekly = this.currentWeekFoods.filter((x: any) => x.id === b.id).length
                            if (aWeekly !== bWeekly) return aWeekly - bWeekly
                            // Compatibility-aware economy tiebreaker: prefer compatible foods,
                            // then lower calorie among equal compatibility
                            if (economyMode) {
                                const mainDish = context.slotMainDish
                                if (mainDish) {
                                    const aCompat = this.getCompatibilityAnalysis(a, mainDish).boost
                                    const bCompat = this.getCompatibilityAnalysis(b, mainDish).boost
                                    if (aCompat !== bCompat) return bCompat - aCompat
                                }
                                return (a.calories || 0) - (b.calories || 0)
                            }
                            return 0
                        })
                        selectedFood = candidates[0] || null
                        if (selectedFood) {
                            this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Direct name/tag pool match for rule '${rule.name}'`, selectedFood.name)
                        } else if ((def.min_count || 0) > 0) {
                            // Diagnostic: why no candidates?
                            const allMatching = this.eligibleFoods.filter(f => this.matchesTarget(f, def.target))
                            const reasons: string[] = []
                            if (allMatching.length === 0) {
                                reasons.push('no foods match target')
                            } else {
                                let alreadySelected = 0, mealTypeBlock = 0, tagConflict = 0, weeklyCap = 0, roleBlock = 0
                                for (const f of allMatching) {
                                    if (selectedIds.has(f.id)) { alreadySelected++; continue }
                                    if (!bypassMealTypes && !this.isMealTypeCompatibleWithSlot(f, slotName)) { mealTypeBlock++; continue }
                                    if (!relaxTagConflict && this.hasTagConflict(f, slotTags)) { tagConflict++; continue }
                                    if (this.hasReachedWeeklyCap(f, this.currentWeekFoods.filter((x: any) => x.id === f.id).length)) { weeklyCap++; continue }
                                    const fRole = this.getCanonicalLockRole(f.role || '')
                                    if (fRole && UNIQUE_SLOT_ROLES.has(fRole) && selectedRoles.has(fRole)) { roleBlock++; continue }
                                }
                                if (alreadySelected) reasons.push(`${alreadySelected} already selected`)
                                if (mealTypeBlock) reasons.push(`${mealTypeBlock} meal_type incompatible`)
                                if (tagConflict) reasons.push(`${tagConflict} tag conflict`)
                                if (weeklyCap) reasons.push(`${weeklyCap} weekly cap`)
                                if (roleBlock) reasons.push(`${roleBlock} role blocked (${Array.from(selectedRoles).join(',')})`)
                            }
                            if (reasons.length > 0) {
                                this.log(context.dayIndex + 1, slotName, 'info',
                                    `Pass 1: No candidates for '${rule.name}' (${allMatching.length} match target): ${reasons.join(', ')}`)
                            }
                        }
                    } else {
                        // Economy mode: when slot is >70% full, constrain remaining budget more aggressively
                        const remainingBudget = economyMode
                            ? Math.max(50, (slotCalorieBudget - slotMacros.calories) * 0.7)
                            : slotCalorieBudget - slotMacros.calories
                        const food = await this.selectBestFoodByRole(
                            category, searchRole, context, selectedIds, slotTags, context.slotMainDish, remainingBudget, true, false, forceInclusion, forceInclusion
                        )
                        selectedFood = food
                        if ((!selectedFood || !this.matchesTarget(selectedFood, def.target)) && (def.min_count || 0) > 0) {
                            // Hard fallback for minimum constraints (especially sideDish-like rules):
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
                            if (fallbackFood) {
                                const fbMatch = this.matchesTarget(fallbackFood, def.target)
                                this.log(context.dayIndex + 1, slotName, 'info',
                                    `Pass 1: Fallback candidate for '${rule.name}': '${fallbackFood.name}' (role=${fallbackFood.role}, cat=${fallbackFood.category}, matchesTarget=${fbMatch}, target=${JSON.stringify(def.target)})`)
                                if (fbMatch) {
                                    selectedFood = fallbackFood
                                    this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Fallback fill for rule '${rule.name}'`, fallbackFood.name)
                                }
                            } else {
                                this.log(context.dayIndex + 1, slotName, 'info',
                                    `Pass 1: Fallback returned null for '${rule.name}' (searchRole=${searchRole}, target=${JSON.stringify(def.target)})`)
                            }
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
                        // Diagnostic: why couldn't we find food?
                        const allMatching = this.eligibleFoods.filter(f => this.matchesTarget(f, def.target))
                        const diagParts: string[] = [`${allMatching.length} match target`]
                        if (allMatching.length > 0) {
                            let slotIncompat = 0, alreadySel = 0, roleBlocked = 0, tagConf = 0, weeklyCapped = 0, dailyBanned = 0, nameConf = 0
                            const diagDayOfWeek = (context.dayIndex ?? 0) + 1
                            for (const f of allMatching) {
                                if (selectedIds.has(f.id)) { alreadySel++; continue }
                                if (this.dailyBannedTargetsMap?.has(diagDayOfWeek)) {
                                    let banned = false
                                    for (const target of this.dailyBannedTargetsMap.get(diagDayOfWeek)!) {
                                        if (this.matchesTarget(f, target)) { banned = true; break }
                                    }
                                    if (banned) { dailyBanned++; continue }
                                }
                                if (!this.isMealTypeCompatibleWithSlot(f, slotName)) { slotIncompat++; continue }
                                if (this.hasTagConflict(f, slotTags)) { tagConf++; continue }
                                if (this.hasReachedWeeklyCap(f, this.currentWeekFoods.filter((x: any) => x.id === f.id).length)) { weeklyCapped++; continue }
                                const diagSearchRoleNorm = this.getCanonicalLockRole(searchRole || '')
                                if (!Planner.LOCKABLE_ROLES.includes(diagSearchRoleNorm) && !this.isNameConflictExemptRole(diagSearchRoleNorm) && this.hasNameConflict(f, context)) { nameConf++; continue }
                                const fRole = this.getCanonicalLockRole(f.role || '')
                                if (fRole && UNIQUE_SLOT_ROLES.has(fRole) && selectedRoles.has(fRole)) { roleBlocked++; continue }
                            }
                            if (alreadySel) diagParts.push(`${alreadySel} already selected`)
                            if (dailyBanned) diagParts.push(`${dailyBanned} dailyBan (exclusive scope)`)
                            if (slotIncompat) diagParts.push(`${slotIncompat} meal_type incompatible`)
                            if (tagConf) diagParts.push(`${tagConf} tag conflict`)
                            if (nameConf) diagParts.push(`${nameConf} name conflict`)
                            if (weeklyCapped) diagParts.push(`${weeklyCapped} weekly cap`)
                            if (roleBlocked) diagParts.push(`${roleBlocked} role blocked (${Array.from(selectedRoles).join(',')})`)
                        }
                        this.log(context.dayIndex + 1, slotName, 'info', `Pass 1: Could not find food for rule '${rule.name}' [${diagParts.join(', ')}]`)
                    }
                }
            }
        }

        if (deferredRules.length > 0) {
            this.log(context.dayIndex + 1, slotName, 'info',
                `Budget tier: deferred ${deferredRules.length} rule(s) to other slots: ${deferredRules.join(', ')}`)
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

                const currentCount = this.countOccurrences(def.target, context, period, def.scope_meals)

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
            let currentCalorieLimit = slotCalorieBudget * 0.9
            const dayTargetCal = context.dailyTarget?.calories
            const dayTargetFat = context.dailyTarget?.fat
            if (dayTargetCal && dayTargetFat) {
                const currentDayCal = (context.dailyMacros?.calories || 0) + slotMacros.calories
                const currentDayFat = (context.dailyMacros?.fat || 0) + slotMacros.fat
                if (currentDayCal < dayTargetCal * 0.95 || currentDayFat < dayTargetFat * 0.95) {
                    currentCalorieLimit = slotCalorieBudget * 1.15 // Relax budget: allow 15% overflow if daily target or fat is under-satisfied
                }
            }

            if (selectedFoods.length >= config.minItems && slotMacros.calories >= currentCalorieLimit) {
                this.log(context.dayIndex + 1, slotName, 'info', `Budget reached (${Math.round(slotMacros.calories)}/${slotCalorieBudget}), stopping optional selection`)
                break
            }

            // Calculate remaining calorie budget for this slot
            // If under minItems, pretend we have budget to force selection
            let remainingCalories = Math.max(currentCalorieLimit, slotCalorieBudget) - slotMacros.calories
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
                if (this.hasForbiddenAffinityConflict(food, selectedFoods)) {
                    this.log(context.dayIndex + 1, slotName, 'info', `Optional: Forbidden affinity blocked '${food.name}' in slot with existing foods`)
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
        
        let allowedFillerBudget = slotCalorieBudget
        const dayTargetCal = context.dailyTarget?.calories
        const dayTargetFat = context.dailyTarget?.fat
        if (dayTargetCal && dayTargetFat) {
            const currentDayCal = (context.dailyMacros?.calories || 0) + slotMacros.calories
            const currentDayFat = (context.dailyMacros?.fat || 0) + slotMacros.fat
            if (currentDayCal < dayTargetCal * 0.95 || currentDayFat < dayTargetFat * 0.95) {
                allowedFillerBudget = slotCalorieBudget * 1.20 // Allow up to 120% of slot budget for filler if there is a daily deficit
            }
        }
        const caloriesRemaining = allowedFillerBudget - slotMacros.calories

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

            // Weekly lock awareness: check BOTH weeklyLocks (bread/soup locks from selectBestFoodByRole)
            // AND intersectionWeeklyLocks for a matching locked food — prefer weeklyLocks for consistency
            let lockedInjection: any | null = null
            // First check weeklyLocks (the primary lock source for bread, soup, corba)
            for (const [, lockedF] of this.weeklyLocks) {
                if (!lockedF) continue
                if (!this.matchesTarget(lockedF, targetToInject)) continue
                if (selectedIds.has(lockedF.id)) continue
                if (dailyUsedIds.has(lockedF.id)) continue
                const candidateRole = this.getCanonicalLockRole(lockedF.role || '')
                const UNIQUE_ROLES = new Set(['maindish', 'soup', 'bread', 'salad'])
                if (candidateRole && UNIQUE_ROLES.has(candidateRole) && selectedRoles.has(candidateRole)) continue
                lockedInjection = lockedF
                this.log(context.dayIndex + 1, slotName, 'info',
                    `Affinity injection: '${rule.name}' → weeklyLock reuse '${lockedF.name}'`)
                break
            }
            // Then check intersectionWeeklyLocks if no match found
            if (!lockedInjection) {
                for (const [, lockedF] of this.intersectionWeeklyLocks) {
                    if (!lockedF) continue
                    if (!this.matchesTarget(lockedF, targetToInject)) continue
                    if (selectedIds.has(lockedF.id)) continue
                    if (dailyUsedIds.has(lockedF.id)) continue
                    const candidateRole = this.getCanonicalLockRole(lockedF.role || '')
                    const UNIQUE_ROLES = new Set(['maindish', 'soup', 'bread', 'salad'])
                    if (candidateRole && UNIQUE_ROLES.has(candidateRole) && selectedRoles.has(candidateRole)) continue
                    lockedInjection = lockedF
                    this.log(context.dayIndex + 1, slotName, 'info',
                        `Affinity injection: '${rule.name}' → intersectionLock reuse '${lockedF.name}'`)
                    break
                }
            }

            // Pick the best candidate (highest priority, highest weekly usage for consistency)
            injectionCandidates.sort((a: any, b: any) => {
                const prioA = this.settings?.food_score_overrides?.[a.id] ?? a.priority_score ?? 5
                const prioB = this.settings?.food_score_overrides?.[b.id] ?? b.priority_score ?? 5
                const usageA = context.weeklySelectedIds?.get(a.id) || 0
                const usageB = context.weeklySelectedIds?.get(b.id) || 0
                if (prioA !== prioB) return prioB - prioA
                return usageB - usageA
            })

            const injected = lockedInjection || injectionCandidates[0]

            // AFFINITY GUARD: Do not inject food that has a forbidden affinity conflict
            // with already-selected foods in this slot (e.g., don't inject bread into börek slot)
            if (this.hasForbiddenAffinityConflict(injected, selectedFoods)) {
                this.log(context.dayIndex + 1, slotName, 'info',
                    `Affinity injection: '${rule.name}' → '${injected.name}' blocked by forbidden affinity with existing slot foods`)
                continue
            }

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

        // ===== 6. COMPATIBILITY PULL PASS =====
        // After mainDish is selected, add compatible side dishes based on
        // the mainDish's compatibility_tags. Budget-aware but tolerant:
        // allows up to 1 low-cal pull even when budget is exceeded, because
        // mandatory frequency rules almost always overfill slots.
        const mainDish = context.slotMainDish
        if (mainDish && mainDish.compatibility_tags && selectedFoods.length < config.maxItems) {
            const remainingCal = slotBudget - slotMacros.calories
            const MAX_COMPAT_PULLS = 1
            const PULL_CAL_CEILING = 100
            let pullCount = 0

            const rawTags = Array.isArray(mainDish.compatibility_tags)
                ? mainDish.compatibility_tags
                : (typeof mainDish.compatibility_tags === 'string' ? mainDish.compatibility_tags.split(/[\n,]+/) : [])
            const compatTags = rawTags.map((t: string) => normalizeKey(String(t || '').trim())).filter(Boolean)

            if (compatTags.length > 0) {
                const PULLABLE_ROLES = new Set(['sidedish', 'salad', 'drink'])
                const dailyUsedIds = new Set(context.dailySelectedIds || [])

                const getMaxWeeklyPulls = (f: any): number => {
                    const score = this.settings?.food_score_overrides?.[f.id] ?? f.priority_score ?? 5
                    if (score >= 7) return 3
                    if (score >= 4) return 2
                    return 1
                }

                const pullCandidates = this.eligibleFoods.filter((f: any) => {
                    if (selectedIds.has(f.id)) return false
                    if (dailyUsedIds.has(f.id)) return false
                    const fRole = this.getCanonicalLockRole(f.role || '')
                    if (!PULLABLE_ROLES.has(fRole)) return false
                    if (fRole && UNIQUE_SLOT_ROLES.has(fRole) && selectedRoles.has(fRole)) return false
                    if (!this.isMealTypeCompatibleWithSlot(f, slotName)) return false
                    if (!this.checkSeasonalityHard(f, context.currentDate || this.today)) return false
                    if (this.hasTagConflict(f, slotTags)) return false
                    if (this.hasForbiddenAffinityConflict(f, selectedFoods)) return false
                    const weekCount = context.weeklySelectedIds?.get(f.id) || 0
                    if (this.hasReachedWeeklyCap(f, weekCount)) return false
                    if (weekCount >= getMaxWeeklyPulls(f)) return false
                    const overrideScore = this.settings?.food_score_overrides?.[f.id]
                    if (overrideScore === 0) return false
                    if ((f.calories || 0) > PULL_CAL_CEILING) return false
                    return true
                })

                const scoredPulls = pullCandidates.map((f: any) => {
                    const compat = this.getCompatibilityAnalysis(f, mainDish)
                    return { food: f, boost: compat.boost, matchedTag: compat.matchedTag }
                }).filter(c => c.boost > 0)
                    .sort((a, b) => b.boost - a.boost)

                for (const pull of scoredPulls) {
                    if (pullCount >= MAX_COMPAT_PULLS) break
                    if (selectedFoods.length >= config.maxItems) break

                    selectedFoods.push(pull.food)
                    selectedIds.add(pull.food.id)
                    this.addFoodMacros(slotMacros, pull.food)
                    this.addFoodTags(slotTags, pull.food)

                    const foodRole = this.getCanonicalLockRole(pull.food.role || '')
                    if (foodRole) selectedRoles.add(foodRole)

                    selectedFoods[selectedFoods.length - 1].source = {
                        type: 'compatibility_pull',
                        rule: `Uyumluluk: ${pull.matchedTag || 'tag eşleşmesi'}`
                    }
                    pullCount++
                    this.log(context.dayIndex + 1, slotName, 'select',
                        `Compatibility pull: '${pull.food.name}' added (boost=${pull.boost}, tag='${pull.matchedTag}', cal=${pull.food.calories || 0}, budget=${remainingCal > 0 ? 'within' : 'over'})`)
                }
            }
        }
        // ===== END COMPATIBILITY PULL =====

        // ── POST-SLOT: PORTION SCALING ──
        // If slot calories exceed budget by >15%, scale down non-fixed foods' portions.
        // Uses user step grid for snapping (e.g. 0.5 steps → 0.5, 1, 1.5, 2).
        // Weekly limits: max 5 reductions on different days, max 2 increases on different days,
        // same day only one direction allowed.
        const userStep = this.settings?.portion_settings?.step_value || 0.5
        const portionMin = this.settings?.portion_settings?.global_min || 0.5
        const portionMax = this.settings?.portion_settings?.global_max || 2.0
        const snapToStep = (v: number) => Math.max(portionMin, Math.round(v / userStep) * userStep)

        const dayIdx = context.dayIndex ?? 0
        const reductionCount = [...this.weeklyPortionAdjustments.values()].filter(v => v === 'reduction').length
        const increaseCount = [...this.weeklyPortionAdjustments.values()].filter(v => v === 'increase').length
        const dayAdjustment = this.weeklyPortionAdjustments.get(dayIdx)

        const finalSlotCals = selectedFoods.reduce((sum, f) => sum + (f.calories || 0) * (f._portionMultiplier || 1), 0)
        if (slotCalorieBudget > 0 && finalSlotCals > slotCalorieBudget * 1.15) {
            // Check weekly limits before applying reduction
            const MAX_WEEKLY_REDUCTIONS = 7
            const canReduce = reductionCount < MAX_WEEKLY_REDUCTIONS && dayAdjustment !== 'increase'
            if (!canReduce) {
                this.log(context.dayIndex + 1, slotName, 'info',
                    `Portion scaling skipped: weekly limit (${reductionCount}/${MAX_WEEKLY_REDUCTIONS} reductions${dayAdjustment === 'increase' ? ', day already has increase' : ''})`)
            } else {
                const fixedCals = selectedFoods
                    .filter(f => f.source?.type === 'fixed')
                    .reduce((sum, f) => sum + (f.calories || 0), 0)
                const scalableCals = finalSlotCals - fixedCals
                if (scalableCals > 0) {
                    const targetScalable = Math.max(0, slotCalorieBudget - fixedCals)
                    const rawRatio = targetScalable / scalableCals
                    const portionMultiplier = snapToStep(rawRatio)
                    if (portionMultiplier < 1) {
                        const MIN_SCALABLE_CALORIES = 30
                        for (const food of selectedFoods) {
                            if (food.source?.type === 'fixed') continue
                            if ((food.calories || 0) < MIN_SCALABLE_CALORIES) continue
                            const foodMin = food.min_quantity ?? portionMin
                            const foodMax = food.max_quantity ?? portionMax
                            food._portionMultiplier = Math.min(foodMax, Math.max(foodMin, portionMultiplier))
                        }
                        const scaledCals = selectedFoods.reduce((sum, f) => sum + (f.calories || 0) * (f._portionMultiplier || 1), 0)
                        const isNewDay = !this.weeklyPortionAdjustments.has(dayIdx)
                        this.weeklyPortionAdjustments.set(dayIdx, 'reduction')
                        const newReductionCount = [...this.weeklyPortionAdjustments.values()].filter(v => v === 'reduction').length
                        this.log(context.dayIndex + 1, slotName, 'info',
                            `Portion scaling: ${Math.round(finalSlotCals)}→${Math.round(scaledCals)} kcal (×${portionMultiplier.toFixed(2)}, reduction day ${newReductionCount}/${MAX_WEEKLY_REDUCTIONS}${!isNewDay ? ' same-day' : ''})`)
                    }
                }
            }
        } else if (slotCalorieBudget > 0 && finalSlotCals < slotCalorieBudget * 0.75) {
            // Slot is >25% under budget — try scaling UP non-fixed foods
            const canIncrease = increaseCount < 2 && dayAdjustment !== 'reduction'
            if (!canIncrease) {
                this.log(context.dayIndex + 1, slotName, 'info',
                    `Portion increase skipped: weekly limit (${increaseCount}/2 increases${dayAdjustment === 'reduction' ? ', day already has reduction' : ''})`)
            } else {
                const fixedCals = selectedFoods
                    .filter(f => f.source?.type === 'fixed')
                    .reduce((sum, f) => sum + (f.calories || 0), 0)
                const scalableCals = finalSlotCals - fixedCals
                if (scalableCals > 0) {
                    const targetScalable = slotCalorieBudget - fixedCals
                    const rawRatio = targetScalable / scalableCals
                    const portionMultiplier = Math.min(portionMax, snapToStep(rawRatio))
                    if (portionMultiplier > 1) {
                        for (const food of selectedFoods) {
                            if (food.source?.type === 'fixed') continue
                            const foodMin = food.min_quantity ?? portionMin
                            const foodMax = food.max_quantity ?? portionMax
                            food._portionMultiplier = Math.min(foodMax, Math.max(foodMin, portionMultiplier))
                        }
                        const scaledCals = selectedFoods.reduce((sum, f) => sum + (f.calories || 0) * (f._portionMultiplier || 1), 0)
                        const isNewIncDay = !this.weeklyPortionAdjustments.has(dayIdx)
                        this.weeklyPortionAdjustments.set(dayIdx, 'increase')
                        const newIncreaseCount = [...this.weeklyPortionAdjustments.values()].filter(v => v === 'increase').length
                        this.log(context.dayIndex + 1, slotName, 'info',
                            `Portion increase: ${Math.round(finalSlotCals)}→${Math.round(scaledCals)} kcal (×${portionMultiplier.toFixed(2)}, increase day ${newIncreaseCount}/2${!isNewIncDay ? ' same-day' : ''})`)
                    }
                }
            }
        }

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
        const varietyMode = this.settings?.variety_mode || 'hybrid'

        // Helper: check if a food's meal_types allows it in this slot
        const requiredMealType = this.getRequiredMealTypeForSlot(category)

        const UNIVERSAL_MEAL_ROLES = new Set(['bread', 'ekmek'])
        const isMealTypeCompatible = (food: any): boolean => {
            if (allowMealTypeBypass) return true
            if (!requiredMealType) return true
            if (UNIVERSAL_MEAL_ROLES.has(lockRole)) return true
            let foodMealTypes: string[] | null = null
            if (Array.isArray(food.meal_types)) foodMealTypes = food.meal_types
            else if (typeof food.meal_types === 'string') {
                try { foodMealTypes = JSON.parse(food.meal_types) } catch { foodMealTypes = [food.meal_types] }
            }
            if (foodMealTypes && foodMealTypes.length > 0) {
                const reqCanon = canonicalMealType(requiredMealType)
                return foodMealTypes.some(t => typeof t === 'string' && canonicalMealType(t) === reqCanon)
            }
            return true
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
        // IMPORTANT: Weekly locks are NEVER skipped by emergency mode — the lock
        // contract ("same food all week") is absolute for lockable roles.
        // EXCEPTION: Bread lock has a usage limit (MAX_BREAD_LOCK_USAGE) — after that,
        // fall through to full candidate scoring for variety.
        const MAX_BREAD_LOCK_USAGE = 14
        const hasWeeklyLockForRole = this.weeklyLocks.has(lockRole) || (lockRole === 'soup' && this.weeklyLocks.has('corba'))

        if (hasWeeklyLockForRole) {
            // Bread variety: after MAX uses, skip lock and fall through to scoring
            if (lockRole === 'bread') {
                const lockedBread = this.weeklyLocks.get('bread')
                if (lockedBread) {
                    const breadUsage = context.weeklySelectedIds?.get(lockedBread.id) || 0
                    if (breadUsage >= MAX_BREAD_LOCK_USAGE) {
                        // Fall through to full candidate pool for variety
                        // (don't return locked food, don't return null)
                    } else {
                        // Use locked bread (within limit)
                        if (!excludeIds.has(lockedBread.id) && isMealTypeCompatible(lockedBread) && !this.hasTagConflict(lockedBread, slotTags) && isRoleMatch(lockedBread)) {
                            this.commitRotationFood(lockedBread)
                            return lockedBread
                        } else {
                            return null
                        }
                    }
                }
            } else {
                // Non-bread lockable roles: absolute lock, same food ALL week
                const lockedFood = this.weeklyLocks.get(lockRole) || (lockRole === 'soup' ? this.weeklyLocks.get('corba') : null)
                if (!lockedFood) return null
                if (!excludeIds.has(lockedFood.id) && isMealTypeCompatible(lockedFood) && !this.hasTagConflict(lockedFood, slotTags) && isRoleMatch(lockedFood)) {

                    // Weekly lock takes absolute priority — the locked food is used ALL week.
                    // Do NOT check weekly cap or frequency rule max here; those caps
                    // are overridden by the consistency lock contract.

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
                } else {
                    // The locked food can't be used (excludeIds, tag conflict, role mismatch, meal_type).
                    // Return null — never pick a different food, that would break the lock.
                    return null
                }
            }
        }

        // CONSISTENCY RULE CHECK (Dynamically Locked Foods)
        // In mandatory emergency mode, skip this to fall through to candidate pool
        // EXCEPT for lockable roles — their lock is absolute.
        const isLockableRole = Planner.LOCKABLE_ROLES.includes(lockRole)
        if (!isMandatoryEmergency || isLockableRole) {
            const consistencyLockedFood = this.getLockedFood(category, role, context)
            if (consistencyLockedFood) {
                // BUGFIX: Consistency rules should bypass strict_weekly_variety. 
                // Only block if it violates strict_daily_variety (already eaten today).
                if (context.dailySelectedIds?.has(consistencyLockedFood.id)) {
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
                if (!catMatch && !roleMatch) {
                    // Skip name fallback if food has a recognized role differing from target
                    const fCatNorm = normalizeCategory(f.category || '')
                    const fRoleNorm = normalizeCategory(f.role || '')
                    const fCanonical = CATEGORY_ROLE_LOOKUP.get(fRoleNorm) || CATEGORY_ROLE_LOOKUP.get(fCatNorm)
                    const tCanonical = CATEGORY_ROLE_LOOKUP.get(targetNorm) || targetNorm
                    if (fCanonical && fCanonical !== tCanonical) return false
                    // Name-based fallback: match if food name contains any synonym of the target
                    const synonyms = CATEGORY_ROLE_MAP[targetNorm as keyof typeof CATEGORY_ROLE_MAP]
                    if (!synonyms || !synonyms.some(s => nameContainsSynonym(normalizeKey(f.name || ''), s))) return false
                }
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
            // BUT still respect the food's OWN max_weekly_freq UNLESS allowWeeklyCapBypass is true
            if (isRequired && ignoreBudget && ignoreRepetition) {
                if (!allowWeeklyCapBypass) {
                    const explicitMax = this.getExplicitMaxWeeklyFreq(f)
                    if (explicitMax !== null) {
                        const weeklyCount = context.weeklySelectedIds?.get(f.id) || 0
                        if (weeklyCount >= explicitMax) return false
                    }
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
            if (!isLockableRole && !this.isNameConflictExemptRole(lockRole) && this.hasNameConflict(f, context)) {
                return false
            }
            if (!this.checkSeasonalityHard(f, context.currentDate)) {
                return false
            }
            if (!(isLockableRole && hasWeeklyLockForRole) && this.hasReachedFrequencyRuleMaxForFood(f, context)) {
                return false
            }
            if (!isMealTypeCompatible(f)) {
                return false
            }

            return true
        })

        // ── DIAGNOSTIC: Show WHY candidates were eliminated for non-standard roles ──
        if (candidates.length === 0 && !STANDARD_ROLES.includes(role)) {
            const targetNorm = normalizeCategory(role || '')
            const tCanon = CATEGORY_ROLE_LOOKUP.get(targetNorm) || targetNorm
            const nameMatchCount = this.eligibleFoods.filter(f => {
                const catM = normalizeCategory(f.category || '') === targetNorm
                const roleM = normalizeCategory(f.role || '') === targetNorm
                if (catM || roleM) return true
                const fCan = CATEGORY_ROLE_LOOKUP.get(normalizeCategory(f.role || '')) || CATEGORY_ROLE_LOOKUP.get(normalizeCategory(f.category || ''))
                if (fCan && fCan !== tCanon) return false
                const syns = CATEGORY_ROLE_MAP[targetNorm as keyof typeof CATEGORY_ROLE_MAP]
                return syns ? syns.some(s => nameContainsSynonym(normalizeKey(f.name || ''), s)) : false
            }).length
            if (nameMatchCount > 0) {
                const reasons: Record<string, number> = {}
                this.eligibleFoods.forEach(f => {
                    const catM = normalizeCategory(f.category || '') === targetNorm
                    const roleM = normalizeCategory(f.role || '') === targetNorm
                    let matched = catM || roleM
                    if (!matched) {
                        const fCatN2 = normalizeCategory(f.category || '')
                        const fRoleN2 = normalizeCategory(f.role || '')
                        const fCan2 = CATEGORY_ROLE_LOOKUP.get(fRoleN2) || CATEGORY_ROLE_LOOKUP.get(fCatN2)
                        if (fCan2 && fCan2 !== tCanon) { /* role-guard mismatch */ }
                        else {
                            const syns = CATEGORY_ROLE_MAP[targetNorm as keyof typeof CATEGORY_ROLE_MAP]
                            matched = syns ? syns.some(s => nameContainsSynonym(normalizeKey(f.name || ''), s)) : false
                        }
                    }
                    if (!matched) return
                    if (excludeIds.has(f.id)) { reasons['excludeId'] = (reasons['excludeId'] || 0) + 1; return }
                    if (context.currentBannedRoles?.length) {
                        const fr = this.getCanonicalLockRole(f.role || '')
                        if (context.currentBannedRoles.includes(fr)) { reasons['bannedRole'] = (reasons['bannedRole'] || 0) + 1; return }
                    }
                    if (context.currentBannedTags?.length && Array.isArray(f.tags)) {
                        if (f.tags.some((t: string) => typeof t === 'string' && context.currentBannedTags!.includes(t.toLowerCase()))) { reasons['bannedTag'] = (reasons['bannedTag'] || 0) + 1; return }
                    }
                    const diagDayOfWeek = (context.dayIndex ?? 0) + 1
                    if (this.dailyBannedTargetsMap?.has(diagDayOfWeek)) {
                        const dayBans = this.dailyBannedTargetsMap.get(diagDayOfWeek)!
                        let banned = false
                        for (const target of dayBans) {
                            if (this.matchesTarget(f, target)) { banned = true; break }
                        }
                        if (banned) { reasons['dailyBan'] = (reasons['dailyBan'] || 0) + 1; return }
                    }
                    if (!ignoreRepetition && context.dailySelectedIds.has(f.id)) { reasons['dailyRepeat'] = (reasons['dailyRepeat'] || 0) + 1; return }
                    if (this.hasTagConflict(f, slotTags)) { reasons['tagConflict'] = (reasons['tagConflict'] || 0) + 1; return }
                    if (!isLockableRole && !this.isNameConflictExemptRole(lockRole) && this.hasNameConflict(f, context)) { reasons['nameConflict'] = (reasons['nameConflict'] || 0) + 1; return }
                    if (!this.checkSeasonalityHard(f, context.currentDate)) { reasons['seasonal'] = (reasons['seasonal'] || 0) + 1; return }
                    if (!(isLockableRole && hasWeeklyLockForRole) && this.hasReachedFrequencyRuleMaxForFood(f, context)) {
                        reasons['freqMax'] = (reasons['freqMax'] || 0) + 1
                        if (reasons['freqMax'] <= 3) {
                            const detail = this.hasReachedFrequencyRuleMaxForFood(f, context, true)
                            this.log(context.dayIndex + 1, context.slotName || '?', 'info',
                                `  ↳ freqMax blocked '${f.name}' (cat=${f.category}) by rule: ${detail}`)
                        }
                        return
                    }
                    if (!isMealTypeCompatible(f)) { reasons['mealType'] = (reasons['mealType'] || 0) + 1; return }
                    reasons['passedAll'] = (reasons['passedAll'] || 0) + 1
                    if (!reasons['_passedNames']) reasons['_passedNames'] = 0
                    this.log(context.dayIndex + 1, context.slotName || '?', 'info',
                        `  ↳ passedAll: '${f.name}' (role=${f.role}, cat=${f.category}, id=${f.id?.slice(0,8)})`)

                })
                const reasonStr = Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(', ')
                this.log(context.dayIndex + 1, context.slotName || '?', 'info',
                    `selectBestFoodByRole('${role}'): 0 candidates from ${nameMatchCount} name-matches. Filter reasons: ${reasonStr}`)
            }
        }

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

        // *** STRICT CONSECUTIVE DAY REPETITION CHECK (NO REPETITION UNLESS FORCED/NO ALTERNATIVES) ***
        if (!ignoreRepetition && varietyMode !== 'off' && candidates.length > 1) {
            const exemptWords = this.settings?.variety_exempt_words || []
            const isWordExempt = (food: any): boolean => {
                const foodNameLower = (food.name || '').toLowerCase()
                return exemptWords.some((word: string) => foodNameLower.includes(word.toLowerCase()))
            }

            const getSignificantWords = (name: string): string[] => {
                const exemptWordsName = this.settings?.name_similarity_exempt_words || []
                const genericWords = new Set([
                    'fırında', 'ızgara', 'sote', 'haşlama', 'kızartma', 'zeytinyağlı', 'yoğurtlu', 
                    'kıymalı', 'etli', 'adet', 'gram', 'kase', 'porsiyon', 'dilim', 'yemek', 
                    'kaşığı', 'tatlı', 'veya', 'biber', 'salata', 'çorba', 'kırmızı', 'yeşil',
                    'sarı', 'kuru', 'taze', 'soslu', 'sade', 'fırın', 'tava', 'ızgarası'
                ])
                return (name || '').toLowerCase()
                    .replace(/[^a-z0-9ğüşıiöç\s]/g, '') // strip punctuation
                    .split(/\s+/)
                    .filter((w: string) => w.length > 3 && !exemptWordsName.includes(w) && !genericWords.has(w))
            }

            const hasNameRepetitionMatch = (candidateFood: any, pastIds: Set<string> | undefined): boolean => {
                if (!pastIds || pastIds.size === 0) return false
                if (pastIds.has(candidateFood.id)) return true // exact match
                
                const candidateWords = getSignificantWords(candidateFood.name)
                if (candidateWords.length === 0) return false

                for (const id of pastIds) {
                    const pastFood = this.eligibleFoods.find(food => food.id === id)
                    if (pastFood) {
                        const pastWords = getSignificantWords(pastFood.name)
                        const hasSharedWord = candidateWords.some(w => pastWords.includes(w))
                        if (hasSharedWord) return true
                    }
                }
                return false
            }

            // Step 1: Filter out foods selected yesterday (which prevents consecutive days)
            const yesterdayFiltered = candidates.filter(f => isWordExempt(f) || !hasNameRepetitionMatch(f, context.yesterdaySelectedIds))
            if (yesterdayFiltered.length > 0) {
                candidates = yesterdayFiltered
            }

            // Step 2: Filter out foods selected 2 days ago (to prevent 3 days in a row)
            if (candidates.length > 1) {
                const twoDaysAgoFiltered = candidates.filter(f => isWordExempt(f) || !hasNameRepetitionMatch(f, context.twoDaysAgoSelectedIds))
                if (twoDaysAgoFiltered.length > 0) {
                    candidates = twoDaysAgoFiltered
                }
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
                    if (!catMatch && !roleMatch) {
                        const fCatN = normalizeCategory(f.category || '')
                        const fRoleN = normalizeCategory(f.role || '')
                        const fCan2 = CATEGORY_ROLE_LOOKUP.get(fRoleN) || CATEGORY_ROLE_LOOKUP.get(fCatN)
                        const tCan2 = CATEGORY_ROLE_LOOKUP.get(targetNorm) || targetNorm
                        if (fCan2 && fCan2 !== tCan2) return false
                        const synonyms = CATEGORY_ROLE_MAP[targetNorm as keyof typeof CATEGORY_ROLE_MAP]
                        if (!synonyms || !synonyms.some(s => nameContainsSynonym(normalizeKey(f.name || ''), s))) return false
                    }
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
                if (!isLockableRole && !this.isNameConflictExemptRole(lockRole) && this.hasNameConflict(f, context)) return false
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

            // *** STRICT CONSECUTIVE DAY REPETITION CHECK FOR FALLBACK CANDIDATES ***
            if (!ignoreRepetition && varietyMode !== 'off' && candidates.length > 1) {
                const exemptWords = this.settings?.variety_exempt_words || []
                const isWordExempt = (food: any): boolean => {
                    const foodNameLower = (food.name || '').toLowerCase()
                    return exemptWords.some((word: string) => foodNameLower.includes(word.toLowerCase()))
                }

                const getSignificantWords = (name: string): string[] => {
                    const exemptWordsName = this.settings?.name_similarity_exempt_words || []
                    const genericWords = new Set([
                        'fırında', 'ızgara', 'sote', 'haşlama', 'kızartma', 'zeytinyağlı', 'yoğurtlu', 
                        'kıymalı', 'etli', 'adet', 'gram', 'kase', 'porsiyon', 'dilim', 'yemek', 
                        'kaşığı', 'tatlı', 'veya', 'biber', 'salata', 'çorba', 'kırmızı', 'yeşil',
                        'sarı', 'kuru', 'taze', 'soslu', 'sade', 'fırın', 'tava', 'ızgarası'
                    ])
                    return (name || '').toLowerCase()
                        .replace(/[^a-z0-9ğüşıiöç\s]/g, '') // strip punctuation
                        .split(/\s+/)
                        .filter((w: string) => w.length > 3 && !exemptWordsName.includes(w) && !genericWords.has(w))
                }

                const hasNameRepetitionMatch = (candidateFood: any, pastIds: Set<string> | undefined): boolean => {
                    if (!pastIds || pastIds.size === 0) return false
                    if (pastIds.has(candidateFood.id)) return true // exact match
                    
                    const candidateWords = getSignificantWords(candidateFood.name)
                    if (candidateWords.length === 0) return false

                    for (const id of pastIds) {
                        const pastFood = this.eligibleFoods.find(food => food.id === id)
                        if (pastFood) {
                            const pastWords = getSignificantWords(pastFood.name)
                            const hasSharedWord = candidateWords.some(w => pastWords.includes(w))
                            if (hasSharedWord) return true
                        }
                    }
                    return false
                }

                const yesterdayFiltered = candidates.filter(f => isWordExempt(f) || !hasNameRepetitionMatch(f, context.yesterdaySelectedIds))
                if (yesterdayFiltered.length > 0) {
                    candidates = yesterdayFiltered
                }
                if (candidates.length > 1) {
                    const twoDaysAgoFiltered = candidates.filter(f => isWordExempt(f) || !hasNameRepetitionMatch(f, context.twoDaysAgoSelectedIds))
                    if (twoDaysAgoFiltered.length > 0) {
                        candidates = twoDaysAgoFiltered
                    }
                }
            }
        }

        if (candidates.length === 0) return null

        // ── LAYER 1: HARD LIMIT FILTER ──
        // Remove foods that have reached their max_weekly_freq
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
                // MainDish variety boost: main courses are the centerpiece — strong penalty for reuse
                const foodRoleForVariety = this.getCanonicalLockRole(food.role || '')
                if (foodRoleForVariety === 'maindish' && weeklyCount > 0) {
                    penalty += weeklyCount * 3000
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

        // Pick randomly from top viable candidates — wider pool for variety
        const scoreSafetyMargin = (isRequired || ignoreBudget) ? (-1000000 * SF) : (-10000 * SF)
        const bestScore = validCandidates[0]?.score ?? 0
        const scoreThreshold = bestScore * 0.7
        const qualityPool = validCandidates.filter(c => c.score >= scoreThreshold && c.score > scoreSafetyMargin)
        const topN = qualityPool.length >= 2 ? qualityPool.slice(0, Math.min(6, qualityPool.length)) : validCandidates.slice(0, Math.min(3, validCandidates.length)).filter(c => c.score > scoreSafetyMargin)
        
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
        const foodRole = this.getCanonicalLockRole(food.role || '')
        if (foodRole === 'bread') return true
        const foodMealTypes = this.getMealTypesArray(food)
        if (foodMealTypes && foodMealTypes.length > 0) {
            const reqCanon = canonicalMealType(requiredMealType)
            return foodMealTypes.some(t => {
                if (typeof t !== 'string') return false
                return canonicalMealType(t) === reqCanon
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
            if (rule.rule_type !== 'affinity' || !rule.is_active) continue
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

        // Implicit random_day_count only for `weekly` period (daily/per_meal don't project max_count onto days).
        const rulePeriod = def.period || 'weekly'
        const randomDaysTarget = def.random_day_count || (rulePeriod === 'weekly' && (!def.scope_days || def.scope_days.length === 0) && def.max_count ? def.max_count : null)
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
                const count = this.countOccurrences(def.target, context, period, def.scope_meals)

                if (def.max_count && count >= def.max_count) {
                    // Log rejection due to frequency cap
                    // Note: We can't log easily here without day/slot, but calculateScore caller will see negative infinity
                    return Number.NEGATIVE_INFINITY
                }

                if (def.daily_limit && period === 'weekly') {
                    const dailyCount = this.countOccurrences(def.target, context, 'daily', def.scope_meals)
                    if (dailyCount >= def.daily_limit) return Number.NEGATIVE_INFINITY
                }

                if (def.per_meal_limit && (period === 'weekly' || period === 'daily')) {
                    const mealCount = this.countOccurrences(def.target, context, 'per_meal', def.scope_meals)
                    if (mealCount >= def.per_meal_limit) return Number.NEGATIVE_INFINITY
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

        const period = def.period || 'weekly'
        // Implicit random_day_count only for `weekly` period (see note at ~2779).
        const useImplicitRandomDays = period === 'weekly' && (!def.scope_days || def.scope_days.length === 0) && def.max_count
        const randomDaysTarget = def.random_day_count || (useImplicitRandomDays ? def.max_count : null)
        if (randomDaysTarget) {
            const count = typeof randomDaysTarget === 'number' ? randomDaysTarget : Number(randomDaysTarget)
            const randomDays = this.getRandomDaysForRule(rule.id, count)
            if (!randomDays.includes(dayOfWeek)) return false
        } else if (def.scope_days && def.scope_days.length > 0) {
            if (!def.scope_days.includes(dayOfWeek)) return false
        }

        return true
    }

    private hasReachedFrequencyRuleMaxForFood(food: any, context: any, logDetails?: boolean): string | boolean {
        if (!food) return false
        for (const rule of this.rules) {
            if (!rule?.is_active || rule.rule_type !== 'frequency') continue
            const rawDef = rule.definition as any
            const def = rawDef?.data || rawDef || {}
            if (!def?.target) continue

            const maxCount = typeof def.max_count === 'number' ? def.max_count : Number(def.max_count)
            if (!Number.isFinite(maxCount) || maxCount <= 0) continue

            const period = def.period || 'weekly'
            if (period === 'weekly') {
                // Weekly max applies ALL week regardless of random day selection.
                // Only check scope_meals (slot filter) — not random days / scope_days.
                const currentSlot = normalizeSlotName(String(context.slotName || ''))
                if (def.scope_meals && def.scope_meals.length > 0) {
                    const normalizedScopeMeals = def.scope_meals.map((meal: string) => normalizeSlotName(String(meal)))
                    if (!normalizedScopeMeals.includes(currentSlot)) continue
                }
            } else {
                if (!this.isFrequencyRuleApplicableToContext(rule, context)) continue
            }
            if (!this.matchesTarget(food, def.target)) continue

            const count = this.countOccurrences(def.target, context, period, def.scope_meals)
            if (count >= maxCount) {
                if (logDetails) return `${rule.name}(${count}/${maxCount},${period})`
                return true
            }
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

        // Strengthened from 0.2 to 0.6 so compatibility_tags actually influence selection
        return Math.round(details.boost * 0.6)
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

    private countOccurrences(target: any, context: any, period: string = 'weekly', scopeMeals?: string[]): number {
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

        // If the rule is scoped to specific meals, only count foods that came from those slots.
        // Example: rule "her akşam tahin" (scope_meals=[AKŞAM], period=daily) should NOT count
        // a kahvaltı fixed_meal that happens to contain the word "tahin" — otherwise the daily
        // minimum is silently satisfied without adding tahin to AKŞAM.
        if (Array.isArray(scopeMeals) && scopeMeals.length > 0) {
            const normalizedScope = new Set(scopeMeals.map(m => normalizeSlotName(String(m))))
            const currentSlotName = context.slotName ? normalizeSlotName(String(context.slotName)) : null
            const currentSlotInScope = currentSlotName ? normalizedScope.has(currentSlotName) : false
            // slotSelected foods belong to the current slot (they haven't been pushed to currentWeekFoods yet).
            // So we use identity/reference to distinguish them from foods from other slots.
            const slotSelectedSet = new Set<any>(slotSelected)
            source = source.filter((f: any) => {
                // If food is in the current slot's staging area, treat it as belonging to current slot.
                if (slotSelectedSet.has(f)) return currentSlotInScope
                const slot = f?._slotName || f?.slot
                if (!slot) return false // Unknown slot — safe default: exclude (don't over-count)
                return normalizedScope.has(normalizeSlotName(String(slot)))
            })
        }

        return source.filter((f: any) => this.matchesTarget(f, target)).length
    }

    private matchesTarget(food: any, target: any): boolean {
        if (!food || !target) return false
        if (target.value === undefined || target.value === null || String(target.value).trim() === '') return false

        // EXCEPTION CHECK: If this food's ID is in the exceptions list, it's explicitly rejected
        if (target.exceptions && Array.isArray(target.exceptions) && target.exceptions.includes(food.id)) {
            return false
        }

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
            // BUT skip this fallback when the food already has a recognized role that differs from the target.
            // e.g. "ketojenik tost" (role=maindish) mentions "ekmeği" in its name — that's an ingredient
            // description, not its functional category. Without this guard, such foods falsely match the bread rule.
            const foodCanonicalRole = CATEGORY_ROLE_LOOKUP.get(fRole) || CATEGORY_ROLE_LOOKUP.get(fCat)
            if (foodCanonicalRole && foodCanonicalRole !== tVal) return false

            const fNameNormalized = normalizeKey(food.name || '')

            // Get all synonyms for this target standardized key
            const synonyms = CATEGORY_ROLE_MAP[tVal as keyof typeof CATEGORY_ROLE_MAP] || [tVal]
            if (synonyms.some(s => nameContainsSynonym(fNameNormalized, s))) return true

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
        if (target.type === 'name_or_tag' || target.type === 'ingredient') {
            // Match if EITHER the food name contains the value OR the tags include it.
            // Useful for ingredient-level requests ("peynir" should also catch "Beşamel Soslu Karnabahar"
            // whose tags include "peynir", even though "peynir" is not in the name).
            const val = String(target.value).toLocaleLowerCase('tr-TR')
            if (food.name && food.name.toLocaleLowerCase('tr-TR').includes(val)) return true
            if (Array.isArray(food.tags) && food.tags.some((t: string) => t.toLocaleLowerCase('tr-TR') === val)) return true
            // Optional: synonyms parameter allows expanding "peynir" → also match kaşar, lor, feta, ...
            if (Array.isArray(target.synonyms)) {
                for (const syn of target.synonyms) {
                    const s = String(syn).toLocaleLowerCase('tr-TR')
                    if (food.name && food.name.toLocaleLowerCase('tr-TR').includes(s)) return true
                    if (Array.isArray(food.tags) && food.tags.some((t: string) => t.toLocaleLowerCase('tr-TR') === s)) return true
                }
            }
            return false
        }
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
        const normalizedSlot = normalizeSlotName(String(slotName || ''))

        for (const rule of this.rules) {
            if (rule.rule_type !== 'fixed_meal' || !rule.is_active) continue

            const rawDef = rule.definition as any
            const def = rawDef.data || rawDef // Support both formats
            if (!def.target_slot) continue
            // Normalize both sides so "AKŞAM" matches "Akşam", "1. ARA ÖĞÜN" matches "ARA ÖĞÜN" variants, etc.
            const ruleSlot = normalizeSlotName(String(def.target_slot))
            if (ruleSlot !== normalizedSlot) continue
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
                currentCount = this.countOccurrences(def.target, context, period, def.scope_meals)

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
                const reqCanon = canonicalMealType(requiredMealType)
                return mealTypes.some((t: string) => canonicalMealType(t) === reqCanon)
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
            if (context.dailySelectedIds?.has(locked.id)) return { __consistencyBlocked: true }
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
            if (!def.target) continue
            
            let targetCount = def.min_count || def.max_count;
            if (!targetCount) continue;
            
            if (def.period === 'daily') targetCount *= 7;
            if (def.period === 'per_meal') targetCount *= 7 * Math.max(1, (def.scope_meals || []).length);
            
            const count = this.currentWeekFoods.filter((f: any) => this.matchesTarget(f, def.target)).length
            const remaining = targetCount - count
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
                            if (m.source?.type === 'fixed') return false
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
                            if (m.source?.type === 'fixed') return false
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
                            const swapFilter = (m: any) => {
                                if (m.food?.portion_fixed) return false
                                if (m.food?.is_custom) return false
                                if (m.source?.type === 'fixed') return false

                                const r = this.getCanonicalLockRole(m.food?.role || '')
                                if (r === 'maindish' || r === 'breakfast_main') return false

                                const isMandatoryMain = m.source?.is_required_role &&
                                    (this.getCanonicalLockRole(m.source.required_role_name || '') === 'maindish')
                                if (isMandatoryMain) return false

                                return !swappedSlots.has(`${m.slot}_${m.food?.id}`)
                            }
                            if (swapDev.isOver) {
                                targetMeal = dayMeals
                                    .filter(swapFilter)
                                    .sort((a: any, b: any) => {
                                        const valA = (swapMacro === 'carbs' ? (a.food?.carbs || 0) : (a.food?.[swapMacro] || 0)) * (a.portion_multiplier || 1)
                                        const valB = (swapMacro === 'carbs' ? (b.food?.carbs || 0) : (b.food?.[swapMacro] || 0)) * (b.portion_multiplier || 1)
                                        return valB - valA
                                    })[0]
                            } else {
                                targetMeal = dayMeals
                                    .filter(swapFilter)
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

                                const normalizedSlotForSwap = normalizeSlotName(slot)
                                const swapCandidates = this.eligibleFoods
                                    .filter(f => {
                                        if (excludeIds.has(f.id)) return false
                                        if (f.role !== role) return false
                                        if (this.hasTagConflict(f, slotTags)) return false
                                        if (!this.checkSeasonalityHard(f, this.today)) return false
                                        // meal_types check: don't place a dinner-only food in breakfast
                                        if (f.meal_types && f.meal_types.length > 0) {
                                            const normalizedMealTypes = f.meal_types.map((mt: string) => normalizeSlotName(mt))
                                            if (!normalizedMealTypes.includes(normalizedSlotForSwap)) return false
                                        }
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
                                
                                // Find best slot that has room based on maxItems limit
                                let bestSlot = slotsInDay[slotsInDay.length - 1] || 'AKŞAM'
                                let bestSlotMeals = dayMeals.filter((m: any) => m.slot === bestSlot)
                                
                                if (this.settings?.slot_config && Array.isArray(this.settings.slot_config)) {
                                    for (let i = slotsInDay.length - 1; i >= 0; i--) {
                                        const candidateSlot = slotsInDay[i]
                                        const match = this.settings.slot_config.find((c: any) => normalizeSlotName(c.name || '') === normalizeSlotName(candidateSlot))
                                        const maxItems = match?.max_items ?? 4
                                        const candidateMeals = dayMeals.filter((m: any) => m.slot === candidateSlot)
                                        if (candidateMeals.length < maxItems) {
                                            bestSlot = candidateSlot
                                            bestSlotMeals = candidateMeals
                                            break
                                        }
                                    }
                                }

                                // Skip if the chosen bestSlot is already at maxItems (prevents infinite growth)
                                let isSlotFull = false
                                if (this.settings?.slot_config && Array.isArray(this.settings.slot_config)) {
                                    const match = this.settings.slot_config.find((c: any) => normalizeSlotName(c.name || '') === normalizeSlotName(bestSlot))
                                    if (match && bestSlotMeals.length >= (match.max_items ?? 4)) {
                                        isSlotFull = true
                                    }
                                }
                                if (isSlotFull) continue;

                                const excludeIds = new Set(dayMeals.map((m: any) => m.food?.id).filter(Boolean))
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
                                    
                                const slotTags = new Set<string>()
                                for (const meal of bestSlotMeals) {
                                    if (meal?.food) this.addFoodTags(slotTags, meal.food)
                                }

                                const addCandidates = this.eligibleFoods
                                    .filter(f => {
                                        if (excludeIds.has(f.id)) return false
                                        if (!this.isMealTypeCompatibleWithSlot(f, bestSlot)) return false
                                        if (!this.checkSeasonalityHard(f, this.today)) return false
                                        if (this.hasTagConflict(f, slotTags)) return false
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
                                        if (m.source?.type === 'fixed') return false
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

        const weeklyOk = (
            calPct >= Number(calTol.min) && calPct <= Number(calTol.max) &&
            proPct >= Number(proTol.min) && proPct <= Number(proTol.max) &&
            carbPct >= Number(carbTol.min) && carbPct <= Number(carbTol.max) &&
            fatPct >= Number(fatTol.min) && fatPct <= Number(fatTol.max)
        )
        if (!weeklyOk) return false

        // Daily variance check: if any single day deviates more than 20% from
        // the daily calorie target, Smart Balance should still run to level it out
        const DAY_VARIANCE_THRESHOLD = 20
        const dailyCalTarget = Math.max(1, Number(target?.calories || 0))
        for (let d = 1; d <= 7; d++) {
            const dayMeals = meals.filter((m: any) => m.day === d)
            if (dayMeals.length === 0) continue
            const dayCal = dayMeals.reduce((sum: number, m: any) => {
                return sum + (m.food?.calories || 0) * (m.portion_multiplier || 1)
            }, 0)
            const dayPct = (dayCal / dailyCalTarget) * 100
            if (dayPct < (100 - DAY_VARIANCE_THRESHOLD) || dayPct > (100 + DAY_VARIANCE_THRESHOLD)) {
                this.log(d, 'TOLERANCE', 'info',
                    `Day ${d} calorie deviation ${dayPct.toFixed(0)}% exceeds ±${DAY_VARIANCE_THRESHOLD}% threshold → triggering Smart Balance`)
                return false
            }
        }

        return true
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

function canonicalMealType(raw: string): string {
    const k = raw.toLowerCase().replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c').replace(/\s+/g, '')
    if (k === 'breakfast' || k.includes('kahvalt')) return 'breakfast'
    if (k === 'lunch' || k.includes('ogle') || k === 'ogle') return 'lunch'
    if (k === 'dinner' || k.includes('aksam')) return 'dinner'
    if (k === 'snack' || (k.includes('ara') && k.includes('ogun')) || k.includes('atistirma')) return 'snack'
    return k
}

// Turkish negative suffixes: -siz/-sız/-süz/-suz mean "without"
const TURKISH_NEGATIVE_SUFFIXES = ['siz', 'sız', 'süz', 'suz', 'sİz']
// Measurement-unit contexts: "tatlı kaşığı" = teaspoon, NOT dessert
const MEASUREMENT_UNIT_CONTEXTS: Record<string, string[]> = {
    'tatli': ['kasig', 'kasik'],
    'tatlilar': ['kasig', 'kasik'],
    'corba': ['kasig', 'kasik'],
    'corbalar': ['kasig', 'kasik'],
}
function nameContainsSynonym(normalizedName: string, synonym: string): boolean {
    const idx = normalizedName.indexOf(synonym)
    if (idx === -1) return false
    const afterMatch = normalizedName.substring(idx + synonym.length).trimStart()
    if (TURKISH_NEGATIVE_SUFFIXES.some(neg => afterMatch.startsWith(neg))) return false
    const unitContexts = MEASUREMENT_UNIT_CONTEXTS[synonym]
    if (unitContexts && unitContexts.some(u => afterMatch.startsWith(u))) return false
    return true
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
