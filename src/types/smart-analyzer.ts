export type InsightType = 'frequency' | 'scope' | 'affinity' | 'conflict';

export type InsightAction = 'approve' | 'snooze' | 'dismiss';

export interface SmartInsight {
    id: string; // Unique identifier for the insight (hash of its properties)
    type: InsightType;
    title: string;
    description: string;
    confidence: number; // 0-100 score of how confident the system is in this insight
    supportCount: number; // Number of times this pattern was observed
    proposedRule?: any; // The JSON payload of the rule that would be created if approved
    conflictingRuleIds?: string[]; // If type is 'conflict', the IDs of the rules that conflict
    metadata?: Record<string, any>;
}

export interface SmartAnalyzerConfig {
    minSupport: number; // Minimum number of occurrences to consider a pattern
    minConfidence: number; // Minimum confidence percentage to suggest a rule
    lookbackDays: number; // How many days of history to analyze
}

export interface AnalyzerState {
    lastRunAt: string | null;
    dismissedInsightIds: string[];
    snoozedInsights: Record<string, string>; // id -> iso date when snoozed
}
