import { supabase } from '../supabase'
import { SmartInsight, SmartAnalyzerConfig } from '../../types/smart-analyzer'
import crypto from 'crypto'

export class SmartAnalyzer {
    private config: SmartAnalyzerConfig

    constructor(config?: Partial<SmartAnalyzerConfig>) {
        this.config = {
            minSupport: 5,
            minConfidence: 80,
            lookbackDays: 30,
            ...config
        }
    }

    private hash(str: string): string {
        return crypto.createHash('md5').update(str).digest('hex')
    }

    private normalizeSlot(slotName: string): string {
        const s = String(slotName || '').toUpperCase()
        if (s.includes('KAHVALTI')) return 'KAHVALTI'
        if (s.includes('ÖĞLE') || s.includes('OGLEN')) return 'ÖĞLEN'
        if (s.includes('AKŞAM') || s.includes('AKSAM')) return 'AKŞAM'
        if (s.includes('ARA')) return 'ARA_OGUN'
        return s
    }

    public async runAnalysis(): Promise<SmartInsight[]> {
        const insights: SmartInsight[] = []

        // 1. Fetch historical diet days
        const { data: days, error } = await supabase
            .from('diet_days')
            .select('week_id, day_index, meals')
            .not('meals', 'is', null)

        if (error || !days || days.length === 0) {
            console.error('SmartAnalyzer: Could not fetch diet_days', error)
            return []
        }

        // Parse meals
        const allMeals: any[] = []
        days.forEach(d => {
            if (Array.isArray(d.meals)) {
                d.meals.forEach(m => allMeals.push(m))
            }
        })

        if (allMeals.length === 0) return []

        // --- SCOPE ANALYZER ---
        // Find if a category is only given in specific slots
        const categorySlotCounts: Record<string, Record<string, number>> = {}
        const categoryTotalCounts: Record<string, number> = {}

        allMeals.forEach(meal => {
            if (meal.food && meal.food.category) {
                const cat = meal.food.category.toUpperCase().trim()
                const slot = this.normalizeSlot(meal.slot)
                
                if (!categorySlotCounts[cat]) categorySlotCounts[cat] = {}
                categorySlotCounts[cat][slot] = (categorySlotCounts[cat][slot] || 0) + 1
                categoryTotalCounts[cat] = (categoryTotalCounts[cat] || 0) + 1
            }
        })

        for (const [cat, slots] of Object.entries(categorySlotCounts)) {
            const total = categoryTotalCounts[cat]
            if (total < this.config.minSupport) continue

            for (const [slot, count] of Object.entries(slots)) {
                const percentage = (count / total) * 100
                if (percentage >= this.config.minConfidence && percentage < 100) { // If 100% maybe it's just luck, but >80% is a pattern. Wait, 100% is fine.
                    const title = `Öğün Kısıtlaması: ${cat}`
                    const desc = `"${cat}" kategorisini %${Math.round(percentage)} oranında sadece "${slot}" öğününde veriyorsunuz. Sadece bu öğüne özel bir kural ekleyelim mi?`
                    const proposedRule = {
                        name: `${cat} sadece ${slot}`,
                        rule_type: 'frequency',
                        is_active: true,
                        definition: {
                            type: 'frequency',
                            data: {
                                target: { type: 'category', value: cat },
                                scope_meals: [slot],
                                exclusive_scope: true,
                                min_count: 0,
                                max_count: 99
                            }
                        }
                    }

                    insights.push({
                        id: this.hash(`scope_${cat}_${slot}`),
                        type: 'scope',
                        title,
                        description: desc,
                        confidence: percentage,
                        supportCount: total,
                        proposedRule
                    })
                }
            }
        }

        // --- FREQUENCY ANALYZER ---
        // Find if a category is given X times per week consistently
        // Group by week_id
        const weekCategoryCounts: Record<string, Record<string, number>> = {}
        days.forEach(d => {
            const wid = d.week_id
            if (!weekCategoryCounts[wid]) weekCategoryCounts[wid] = {}
            if (Array.isArray(d.meals)) {
                d.meals.forEach(meal => {
                    if (meal.food && meal.food.category) {
                        const cat = meal.food.category.toUpperCase().trim()
                        weekCategoryCounts[wid][cat] = (weekCategoryCounts[wid][cat] || 0) + 1
                    }
                })
            }
        })

        const categoryWeekStats: Record<string, number[]> = {}
        Object.values(weekCategoryCounts).forEach(weekCounts => {
            Object.entries(weekCounts).forEach(([cat, count]) => {
                if (!categoryWeekStats[cat]) categoryWeekStats[cat] = []
                categoryWeekStats[cat].push(count)
            })
        })

        for (const [cat, counts] of Object.entries(categoryWeekStats)) {
            if (counts.length < this.config.minSupport) continue // need enough weeks

            const sum = counts.reduce((a, b) => a + b, 0)
            const avg = sum / counts.length
            const min = Math.min(...counts)
            const max = Math.max(...counts)

            // If variation is low, suggest a rule
            if (max - min <= 3 && avg >= 2) {
                const proposedRule = {
                    name: `Haftalık ${cat} Sıklığı`,
                    rule_type: 'frequency',
                    is_active: true,
                    definition: {
                        type: 'frequency',
                        data: {
                            period: 'weekly',
                            target: { type: 'category', value: cat },
                            min_count: min,
                            max_count: max
                        }
                    }
                }

                insights.push({
                    id: this.hash(`freq_${cat}_${min}_${max}`),
                    type: 'frequency',
                    title: `Haftalık Sıklık: ${cat}`,
                    description: `Haftalık planlarda ortalama ${Math.round(avg)} kez (min ${min}, max ${max}) "${cat}" kullanıyorsunuz. Bir sıklık kuralı oluşturalım mı?`,
                    confidence: 90, // Static high confidence for tight bounds
                    supportCount: counts.length,
                    proposedRule
                })
            }
        }

        // Filter out dismissed insights
        const dismissed = await this.getDismissedInsights()
        return insights.filter(i => !dismissed.includes(i.id)).sort((a, b) => b.confidence - a.confidence)
    }

    private async getDismissedInsights(): Promise<string[]> {
        const { data } = await supabase.from('app_settings').select('value').eq('key', 'dismissed_smart_insights').maybeSingle()
        if (data?.value && Array.isArray(data.value)) {
            return data.value
        }
        return []
    }

    public async dismissInsight(id: string) {
        const current = await this.getDismissedInsights()
        if (!current.includes(id)) {
            current.push(id)
            await supabase.from('app_settings').upsert({
                key: 'dismissed_smart_insights',
                value: current,
                updated_at: new Date().toISOString()
            })
        }
    }
}
