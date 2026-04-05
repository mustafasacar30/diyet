export type RuleType = 'frequency' | 'affinity' | 'consistency' | 'preference' | 'nutritional' | 'fixed_meal' | 'week_override' | 'rotation' | 'or_group'

export type TargetType = 'category' | 'tag' | 'role' | 'food_id' | 'diet_type' | 'macronutrient'

export interface RuleTarget {
    type: TargetType
    value: string
}

// Week Scope: controls which weeks a rule is active
export interface ScopeWeeks {
    mode: 'all' | 'specific' | 'repeating'
    weeks?: number[]          // for 'specific': e.g. [1,2,6,7,8]
    every?: number            // for 'repeating': interval (e.g. 2 = every 2 weeks)
    starting_week?: number    // for 'repeating': start week (e.g. 1)
}

// 1. Frequency Logic Definition
export interface FrequencyDefinition {
    target: RuleTarget
    min_count?: number
    max_count?: number
    period: 'daily' | 'weekly' | 'per_meal'
    scope_meals?: string[] // e.g. ["KAHVALTI", "ÖĞLEN", "AKŞAM"]
    scope_days?: number[] // 1=Monday, 7=Sunday (specific days mode)
    random_day_count?: number // If set, apply to random X days instead of scope_days
    force_inclusion?: boolean // If true, rule ignores calorie limits to ensure minimum count
    scope_weeks?: ScopeWeeks  // Which weeks this rule applies to
    exclusive_scope?: boolean // If true, completely forbid this target during inactive weeks/days
}

// 2. Affinity Logic Definition
export interface AffinityDefinition {
    trigger: RuleTarget // If this exists...
    outcome: RuleTarget // Then this...
    association: 'mandatory' | 'forbidden' | 'boost' | 'reduce'
    probability?: number // 0-100 (For boost/reduce/affinity score)
    direction?: 'one-way' | 'two-way' // Defaults to one-way for positive, two-way for forbidden
}

// 3. Consistency/Lock Logic Definition
export interface ConsistencyDefinition {
    target: RuleTarget
    lock_duration: 'daily' | 'weekly'
}

// 4. Fixed Meal Definition - Lock specific foods to a slot
export interface FixedMealDefinition {
    target_slot: string                    // "KAHVALTI", "ÖĞLEN", etc.
    foods: string[]                        // Food names/IDs to include
    selection_mode: 'all' | 'random' | 'rotate' | 'by_day'
    count?: number                         // For 'random': pick X foods
    day_assignments?: {                    // For 'by_day': which foods on which days
        [dayOfWeek: string]: string[]      // "1"=Mon, "2"=Tue, etc.
    }
    scope_days?: number[]                  // Optional: which days rule applies
    scope_weeks?: ScopeWeeks               // Optional: which weeks rule applies
    exclusive_scope?: boolean              // If true, completely forbid this target during inactive weeks/days
}

// 5. Week Override Definition - Override diet type for specific weeks
export interface WeekOverrideDefinition {
    week_start: number;
    week_end: number;
    diet_type_id: string;
}

// 6. Nutritional / Macro Condition Definition
export interface NutritionalDefinition {
    condition: {
        macro: 'protein' | 'fat' | 'carbs' | 'calories';
        operator: '<' | '>';
        value: number; // e.g., deficit in grams/kcal
    }
    action: {
        type: 'add' | 'swap';
        target: RuleTarget; // e.g., food_id of Collagen (backward compat)
        foods?: string[];   // Multiple food IDs for rotation
        selection_mode?: 'single' | 'rotate'; // default 'single'
    }
    target_slot: string; // e.g., "AKŞAM"
}

// 7. Rotation Definition — Cross-week food rotation for a role/category
export interface RotationItem {
    food_id: string
    food_name: string
    repeat_count: number                   // how many times in one full cycle (default 1)
}

export interface RotationDefinition {
    target: RuleTarget                     // role, category, or tag to rotate
    mode: 'sequential' | 'random_no_repeat' // sequential = user-defined order, random = shuffled but no repeat until full cycle
    items: RotationItem[]                  // ordered food list (empty = auto-populate from matching foods)
    non_consecutive: boolean               // if true, same food can't appear in back-to-back weeks
}

// Union Type for all Definitions
// 8. OR Group Definition - Rotates between multiple frequency rules based on week logic
export interface OrGroupDefinition {
    mode: 'weekly_rotation'
    options: FrequencyDefinition[]
}

export type RuleDefinition =
    | { type: 'frequency'; data: FrequencyDefinition }
    | { type: 'affinity'; data: AffinityDefinition }
    | { type: 'consistency'; data: ConsistencyDefinition }
    | { type: 'fixed_meal'; data: FixedMealDefinition }
    | { type: 'nutritional'; data: NutritionalDefinition }
    | { type: 'preference'; data: any } // To be defined later
    | { type: 'week_override'; data: WeekOverrideDefinition }
    | { type: 'rotation'; data: RotationDefinition }
    | { type: 'or_group', data: OrGroupDefinition }

export interface PlanningRule {
    id: string
    name: string
    description?: string | null
    rule_type: RuleType
    priority: number
    sort_order?: number
    is_active: boolean
    definition: RuleDefinition
    created_at: string
    updated_at: string
    user_id?: string | null
    // Patient-scope fields
    scope?: 'global' | 'team' | 'patient' | 'program'
    patient_id?: string | null
    program_template_id?: string | null
    team_owner_id?: string | null
    source_rule_id?: string | null
    scope_source?: 'global' | 'team' | 'program' | 'patient'
    base_rule_id?: string | null
    pending_global_approval?: boolean
    is_ignored?: boolean
}

export interface RuleSet {
    id: string
    name: string
    description?: string | null
    is_public: boolean
    owner_id?: string | null
    created_at: string
    rules?: PlanningRule[] // Joined
}

export interface MacroTolerance {
    min: number;  // e.g. 90 means 90% of target is the lower bound
    max: number;  // e.g. 110 means 110% of target is the upper bound
}

export interface PortionSettings {
    global_min: number;
    global_max: number;
    step_value: number;
    max_adjusted_items_per_day?: number
    max_calorie_percentage?: number // Single meal calorie share limit percentage
    macro_tolerances?: {
        calories?: MacroTolerance;
        protein?: MacroTolerance;
        carb?: MacroTolerance;
        fat?: MacroTolerance;
    }
    strategies: {
        macro_convergence: boolean;
        max_limit_protection: boolean;
        volume_filling?: boolean;
    }
}

export interface PlannerSettings {
    id: string
    user_id: string
    scope: 'global' | 'team' | 'patient' | 'program'
    patient_id?: string | null
    program_template_id?: string | null
    team_owner_id?: string | null
    weights: { id: string, weight: number }[]
    exempt_tags?: string[]
    enable_name_similarity_check?: boolean
    name_similarity_exempt_words?: string[]
    portion_settings?: PortionSettings
    variety_preference?: 'balanced' | 'max_variety' | 'stability'
    variety_mode?: 'cooldown' | 'score_only' | 'hybrid' | 'off'
    variety_exempt_words?: string[]
    cooldown_strength?: number      // 1-10, default 5
    liked_boost?: number            // 0-10000, default 3000
    max_weekly_default?: number     // default max_weekly_freq for foods (2-7, default 3)
    food_score_overrides?: Record<string, number>  // { food_id: priority_score } — cascading: program → patient
    macro_priorities?: {
        protein: number
        carb: number
        fat: number
    }
    slot_config?: Record<string, {
        minItems: number
        maxItems: number
        requiredRoles: string[]
        optionalRoles: string[]
    }>
}
