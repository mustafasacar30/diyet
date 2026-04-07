export type DietRules = {
    allowedTags: string[]
    bannedKeywords: string[]
    bannedTags?: string[]  // Made optional to match usage in food-sidebar
    bannedDetails?: Record<string, { warning?: string, info?: string }>
    dietName: string
    programRestrictions?: any[]
}

export type WarningItem = {
    source: 'diet' | 'disease' | 'medication' | 'lab'
    sourceName: string
    type: 'negative' | 'positive' | 'warning'
    keyword: string
    warning?: string
    info?: string
}

export const DIET_MODE_TAGS = ['KETOGENIC', 'LOW_CARB', 'GLUTEN_FREE', 'VEGAN', 'VEGETARIAN', 'DAIRY_FREE', 'HIGH_PROTEIN', 'PALEO']

export const DIET_TAG_MAPPING: Record<string, string> = {
    'LOWCARB': 'LOW_CARB',
    'LOW-CARB': 'LOW_CARB',
    'LOW_CARB': 'LOW_CARB',
    'KETO': 'KETOGENIC',
    'KETOGENIC': 'KETOGENIC',
    'KETOJENIK': 'KETOGENIC',
    'VEGAN': 'VEGAN',
    'VEJETARYEN': 'VEGETARIAN',
    'VEJETERYAN': 'VEGETARIAN',
    'VEGETARIAN': 'VEGETARIAN',
    'GLUTENSIZ': 'GLUTEN_FREE',
    'GLUTEN_FREE': 'GLUTEN_FREE',
    'SUTSUZ': 'DAIRY_FREE',
    'DAIRY_FREE': 'DAIRY_FREE'
}

export function checkCompatibility(food: any, rules?: DietRules, patientDiseases?: any[], patientLabs?: any[], patientMedications?: any[]): { compatible: boolean, recommended?: boolean, reason?: string, diseaseName?: string, severity?: 'warn' | 'block', medicationWarning?: { type: 'negative' | 'warning' | 'positive', medicationName: string, keyword: string, notes?: string }, bannedWarning?: { title: string, warning?: string, info?: string }, warnings: WarningItem[] } {
    const reasons: string[] = []
    const recommendations: string[] = []
    let isCompatible = true
    let isRecommended = false
    let medicationWarning: { type: 'negative' | 'warning' | 'positive', medicationName: string, keyword: string, notes?: string } | undefined = undefined
    const warnings: WarningItem[] = []

    const foodData = food.foods || food // Handle both joined and direct food objects


    // 0. Check Patient Diseases (Priority)
    if (patientDiseases && patientDiseases.length > 0) {
        const lowerName = (food.name || '').toLocaleLowerCase('tr-TR')

        // Robust Tag Handling: split if string, filter Boolean, handle nulls
        const foodTags = [
            ...(Array.isArray(food.compatibility_tags) ? food.compatibility_tags : (typeof food.compatibility_tags === 'string' ? food.compatibility_tags.split(/[\n,]+/) : [])),
            ...(Array.isArray(food.tags) ? food.tags : (typeof food.tags === 'string' ? food.tags.split(/[\n,]+/) : []))
        ].map(t => t.trim().toLocaleLowerCase('tr-TR')).filter(Boolean)

        // console.log(`[Compatibility Check] Food: ${food.name}`, { lowerName, foodTags, diseasesCount: patientDiseases.length })

        for (const disease of patientDiseases) {
            const diseaseRules = disease.disease_rules || []

            for (const rule of diseaseRules) {
                const matchName = rule.match_name !== false
                const matchTags = rule.match_tags !== false
                const keywords = Array.isArray(rule.keywords) ? rule.keywords : []

                for (const kw of keywords) {
                    if (!kw) continue;

                    // Support grouped keywords (e.g. "Wheat/Barley")
                    const subKeywords = kw.split('/').map((k: string) => k.trim()).filter(Boolean)

                    let keywordMatch = false
                    let matchedSubKeyword = ''

                    // Per-keyword scope from metadata overrides rule-level
                    // (Note: Metadata key is usually the FULL keyword string from the DB, 
                    // so we might need to look up by the full 'kw' or just use rule defaults. 
                    // For simplicity in grouped tags, we use rule defaults or the full-string metadata if available.)
                    const kwMeta = rule.keyword_metadata?.[kw] || {}
                    const kwMatchName = kwMeta.match_name !== undefined ? kwMeta.match_name : matchName
                    const kwMatchTags = kwMeta.match_tags !== undefined ? kwMeta.match_tags : matchTags

                    for (const subKw of subKeywords) {
                        const lkw = subKw.toLocaleLowerCase('tr-TR')

                        // Per-keyword scope from metadata overrides rule-level
                        // (Moved to outer loop)

                        if (kwMatchName && lowerName.includes(lkw)) {
                            keywordMatch = true
                            matchedSubKeyword = subKw
                        }

                        if (!keywordMatch && kwMatchTags) {
                            if (foodTags.some((t: string) => t.includes(lkw))) {
                                keywordMatch = true
                                matchedSubKeyword = subKw
                            }
                        }

                        if (keywordMatch) break // Found a match in this group
                    }

                    if (keywordMatch) {
                        // Use valid variable "matchedSubKeyword" or "kw" for display
                        const displayKeyword = matchedSubKeyword || kw

                        if (rule.rule_type === 'negative') {
                            isCompatible = false
                            if (!reasons.includes(`${disease.name}: ${kw}`)) {
                                reasons.push(`${disease.name}: ${kw}`) // Keep full rule name in reason for clarity or use specific? keeping full "kw" helps identify the rule
                            }
                            // Add structured warning
                            if (!warnings.some(w => w.source === 'disease' && w.sourceName === disease.name && w.keyword === kw)) {
                                warnings.push({
                                    source: 'disease',
                                    sourceName: disease.name,
                                    type: 'negative',
                                    keyword: kw,
                                    warning: kwMeta.warning,
                                    info: kwMeta.info
                                })
                            }
                        } else if (rule.rule_type === 'warning') {
                            if (!warnings.some(w => w.source === 'disease' && w.sourceName === disease.name && w.keyword === kw)) {
                                warnings.push({
                                    source: 'disease',
                                    sourceName: disease.name,
                                    type: 'warning',
                                    keyword: kw,
                                    warning: kwMeta.warning,
                                    info: kwMeta.info
                                })
                            }
                        } else {
                            isRecommended = true
                            if (!recommendations.includes(disease.name)) {
                                recommendations.push(disease.name)
                            }
                            // Add structured recommendation
                            if (!warnings.some(w => w.source === 'disease' && w.sourceName === disease.name && w.keyword === kw)) {
                                warnings.push({
                                    source: 'disease',
                                    sourceName: disease.name,
                                    type: 'positive',
                                    keyword: kw,
                                    warning: kwMeta.warning,
                                    info: kwMeta.info
                                })
                            }
                        }
                        // Continue checking other keywords/rules to collect all matches
                    }
                }
            }
        }
    }

    // 1. Check Micronutrient Labs (NEW)
    if (patientLabs && patientLabs.length > 0) {
        // Extract micronutrient IDs from multiple sources:
        // 1. food.micronutrients (direct array of IDs - used in meal render)
        // 2. food.food_micronutrients (relation data from join - used in sidebar)
        const micronutrientIds: string[] = []

        // Source 1: Direct micronutrients array
        if (Array.isArray(food.micronutrients)) {
            micronutrientIds.push(...food.micronutrients)
        }

        // Source 2: food_micronutrients relation (from Supabase join)
        if (Array.isArray(food.food_micronutrients)) {
            food.food_micronutrients.forEach((fm: any) => {
                if (fm.micronutrient_id && !micronutrientIds.includes(fm.micronutrient_id)) {
                    micronutrientIds.push(fm.micronutrient_id)
                }
            })
        }

        const foodTags = [
            ...(Array.isArray(food.compatibility_tags) ? food.compatibility_tags : (typeof food.compatibility_tags === 'string' ? food.compatibility_tags.split(/[\n,]+/) : [])),
            ...(Array.isArray(food.tags) ? food.tags : (typeof food.tags === 'string' ? food.tags.split(/[\n,]+/) : []))
        ].map(t => t.trim().toLocaleLowerCase('tr-TR')).filter(Boolean)

        patientLabs.forEach((lab: any) => {
            const mData = lab.micronutrients
            const mName = (mData?.name || '').toLocaleLowerCase('tr-TR')

            // 1. Direct Match by ID (Manual Mapping)
            let isAssociated = micronutrientIds.includes(lab.micronutrient_id)

            // 2. Direct Match by Tag (Name match - Legacy/Fallback)
            if (!isAssociated && mName) {
                isAssociated = foodTags.some(tag => tag.includes(mName) || mName.includes(tag))
            }

            // 3. Keyword Match (Defined Rules) - NEW
            let keywordMatchRule: 'compatible' | 'incompatible' | null = null
            let matchedKeywordText = '' // Track which keyword matched
            let matchedWarning: string | undefined = undefined
            let matchedInfo: string | undefined = undefined

            if (mData) {
                // Check Compatible (Rich Source)
                if (mData.compatible_keywords && Array.isArray(mData.compatible_keywords)) {
                    for (const kw of mData.compatible_keywords) {
                        if (!kw.keyword) continue
                        const kwText = kw.keyword.trim().toLocaleLowerCase('tr-TR')
                        const mType = kw.match_type || 'both'
                        const matchName = mType === 'name' || mType === 'both'
                        const matchTag = mType === 'tag' || mType === 'both'

                        let match = false
                        if (matchName && (food.name || '').toLocaleLowerCase('tr-TR').includes(kwText)) match = true
                        if (!match && matchTag && foodTags.some(t => t.includes(kwText))) match = true

                        if (match) {
                            keywordMatchRule = 'compatible'
                            matchedKeywordText = kw.keyword
                            matchedWarning = kw.warning
                            matchedInfo = kw.info
                            break
                        }
                    }
                }

                // Check Incompatible (Inhibitor/Bad Pair) ONLY if not already compatible
                if (!keywordMatchRule && mData.incompatible_keywords && Array.isArray(mData.incompatible_keywords)) {
                    for (const kw of mData.incompatible_keywords) {
                        if (!kw.keyword) continue
                        const kwText = kw.keyword.trim().toLocaleLowerCase('tr-TR')
                        const mType = kw.match_type || 'both'
                        const matchName = mType === 'name' || mType === 'both'
                        const matchTag = mType === 'tag' || mType === 'both'

                        let match = false
                        if (matchName && (food.name || '').toLocaleLowerCase('tr-TR').includes(kwText)) match = true
                        if (!match && matchTag && foodTags.some(t => t.includes(kwText))) match = true

                        if (match) {
                            keywordMatchRule = 'incompatible'
                            matchedKeywordText = kw.keyword
                            matchedWarning = kw.warning
                            matchedInfo = kw.info
                            break
                        }
                    }
                }
            }

            const refMin = lab.ref_min !== null ? lab.ref_min : mData?.default_min
            const refMax = lab.ref_max !== null ? lab.ref_max : mData?.default_max

            const isLow = refMin !== null && refMin !== undefined && lab.value < refMin
            const isHigh = refMax !== null && refMax !== undefined && lab.value > refMax
            const displayName = mData?.name || 'Mikrobesin'
            const displayUnit = mData?.unit || ''

            // Case 1: Lab value is LOW - strong recommendation
            if (isLow) {
                // Recommend if it's a rich source (Associated or Compatible Keyword)
                if (isAssociated || keywordMatchRule === 'compatible') {
                    isRecommended = true
                    const keywordPart = matchedKeywordText ? ` - "${matchedKeywordText}" zengin` : ''
                    const rec = `Zengin: ${displayName}${keywordPart} (Tahlil düşük: ${lab.value} ${displayUnit})`
                    if (!recommendations.includes(rec)) recommendations.push(rec)

                    // Add structured warning
                    warnings.push({
                        source: 'lab',
                        sourceName: displayName,
                        type: 'positive',
                        keyword: matchedKeywordText || displayName,
                        warning: matchedWarning,
                        info: matchedInfo
                    })
                }

                // Warn if it's incompatible (Inhibitor)
                if (keywordMatchRule === 'incompatible') {
                    isCompatible = false
                    const rea = `Uyumsuz: ${displayName} eksikliğinde önerilmez - "${matchedKeywordText}" içeriyor (değer: ${lab.value})`
                    if (!reasons.includes(rea)) reasons.push(rea)

                    // Add structured warning
                    warnings.push({
                        source: 'lab',
                        sourceName: displayName,
                        type: 'negative',
                        keyword: matchedKeywordText,
                        warning: matchedWarning,
                        info: matchedInfo
                    })
                }
            }
            // Case 2: Lab value is HIGH - warn about rich sources
            else if (isHigh) {
                // Warn if it's a rich source (we want to avoid)
                if (isAssociated || keywordMatchRule === 'compatible') {
                    isCompatible = false
                    const rea = `${displayName} yüksek (${lab.value} ${displayUnit})`
                    if (!reasons.includes(rea)) reasons.push(rea)

                    // Add structured warning
                    warnings.push({
                        source: 'lab',
                        sourceName: displayName,
                        type: 'negative',
                        keyword: matchedKeywordText || displayName,
                        warning: matchedWarning,
                        info: matchedInfo
                    })
                }
            }
        })
    }

    // 2. Check Patient Medications (NEW)
    if (patientMedications && patientMedications.length > 0) {
        const lowerName = (food.name || '').toLocaleLowerCase('tr-TR')
        const foodTags = [
            ...(Array.isArray(food.compatibility_tags) ? food.compatibility_tags : (typeof food.compatibility_tags === 'string' ? food.compatibility_tags.split(/[\n,]+/) : [])),
            ...(Array.isArray(food.tags) ? food.tags : (typeof food.tags === 'string' ? food.tags.split(/[\n,]+/) : []))
        ].map(t => t.trim().toLocaleLowerCase('tr-TR')).filter(Boolean)

        for (const medRule of patientMedications) {
            const keyword = (medRule.keyword || '').toLocaleLowerCase('tr-TR')
            if (!keyword) continue

            const keywords = keyword.split('/').map((k: string) => k.trim()).filter(Boolean)
            // Also keep original-case versions for display
            const originalKeywords = (medRule.keyword || '').split('/').map((k: string) => k.trim()).filter(Boolean)

            const matchName = medRule.match_name !== false
            const matchTags = medRule.match_tags !== false
            const matchedKeywords: string[] = []

            // Check if ANY of the split keywords match — collect ALL matches
            for (let ki = 0; ki < keywords.length; ki++) {
                const subKw = keywords[ki]
                if (matchName && lowerName.includes(subKw)) {
                    matchedKeywords.push(originalKeywords[ki] || subKw)
                } else if (matchTags && foodTags.some(t => t.includes(subKw))) {
                    matchedKeywords.push(originalKeywords[ki] || subKw)
                }
            }

            if (matchedKeywords.length > 0) {
                const medName = medRule.medication_name || medRule.medications?.name || 'İlaç'
                // Show only matched keywords in tooltip header
                const displayKeyword = matchedKeywords.join(' / ')

                if (medRule.rule_type === 'negative') {
                    isCompatible = false
                    if (!reasons.includes(`İlaç (${medName}): ${displayKeyword}`)) {
                        reasons.push(`İlaç (${medName}): ${displayKeyword}`)
                    }
                    if (!medicationWarning || medRule.rule_type === 'negative') {
                        medicationWarning = {
                            type: 'negative',
                            medicationName: medName,
                            keyword: displayKeyword,
                            notes: medRule.notes
                        }
                    }
                } else if (medRule.rule_type === 'warning') {
                    if (!medicationWarning) {
                        medicationWarning = {
                            type: 'warning',
                            medicationName: medName,
                            keyword: displayKeyword,
                            notes: medRule.notes
                        }
                    }
                } else if (medRule.rule_type === 'positive') {
                    if (!medicationWarning || medicationWarning.type !== 'negative') {
                        medicationWarning = {
                            type: 'positive',
                            medicationName: medName,
                            keyword: displayKeyword,
                            notes: medRule.notes
                        }
                    }
                }
                const [medWarning, ...medInfoParts] = (medRule.notes || '').split('\n\n')
                const medInfo = medInfoParts.join('\n\n')

                // Add structured warning for medication
                warnings.push({
                    source: 'medication',
                    sourceName: medName,
                    type: medRule.rule_type === 'positive' ? 'positive' : medRule.rule_type === 'warning' ? 'warning' : 'negative',
                    keyword: displayKeyword,
                    warning: medWarning || undefined,
                    info: medInfo || undefined
                })
            }
        }
    }

    // REMOVED EARLY RETURN HERE TO ALLOW DIET RULES TO RUN
    // if (!isCompatible || isRecommended || medicationWarning) { ... }

    // ---------------------------------

    const dietName = rules?.dietName || 'Bu'

    // 1. Check banned keywords (in Name AND Tags)
    let bannedWarning: { title: string, warning?: string, info?: string } | undefined = undefined;

    if (rules && rules.bannedKeywords && rules.bannedKeywords.length > 0) {
        const lowerName = (foodData.name || '').toLocaleLowerCase('tr-TR')
        const foodTags = [
            ...(Array.isArray(foodData.compatibility_tags) ? foodData.compatibility_tags : (typeof foodData.compatibility_tags === 'string' ? foodData.compatibility_tags.split(/[\n,]+/) : [])),
            ...(Array.isArray(foodData.tags) ? foodData.tags : (typeof foodData.tags === 'string' ? foodData.tags.split(/[\n,]+/) : []))
        ].map(t => t.trim().toLocaleLowerCase('tr-TR')).filter(Boolean)

        const banned = rules.bannedKeywords.find(k => {
            const lk = k.toLocaleLowerCase('tr-TR')
            return lowerName.includes(lk) || foodTags.some(t => t.includes(lk))
        })

        if (banned) {
            isCompatible = false
            let reason = `${dietName} diyetinde '${banned}' içeren besinler yasak.`
            reasons.push(reason)

            if (rules.bannedDetails) {
                let details = rules.bannedDetails[banned]
                if (!details) {
                    const key = Object.keys(rules.bannedDetails).find(k => k.toLocaleLowerCase('tr-TR') === banned.toLocaleLowerCase('tr-TR'))
                    if (key) details = rules.bannedDetails[key]
                }

                if (details) {
                    bannedWarning = {
                        title: reason,
                        warning: details.warning,
                        info: details.info
                    }
                    if (details.warning) {
                        reason += `\n⚠️ UYARI: ${details.warning}`
                    }
                    if (details.info) {
                        reason += `\nℹ️ BİLGİ: ${details.info}`
                    }
                    reasons[reasons.length - 1] = reason
                }
                // Add structured warning for diet
                warnings.push({
                    source: 'diet',
                    sourceName: dietName,
                    type: 'negative',
                    keyword: banned,
                    warning: rules.bannedDetails?.[banned]?.warning,
                    info: rules.bannedDetails?.[banned]?.info
                })
            }
        }
    }

    // 2. Check banned tags (in Tags or Compatibility Tags)
    if (rules && rules.bannedTags && rules.bannedTags.length > 0) {
        const foodTags = [...(foodData.compatibility_tags || []), ...(foodData.tags || [])]
        for (const bannedTag of rules.bannedTags) {
            const bt = bannedTag.toLocaleLowerCase('tr-TR')
            const match = foodTags.find(ft => ft.toLocaleLowerCase('tr-TR').includes(bt))

            if (match) {
                isCompatible = false
                let reason = `${dietName} diyetinde '${bannedTag}' etiketli besinler yasak.`
                reasons.push(reason)

                if (rules.bannedDetails) {
                    let details = rules.bannedDetails[bannedTag]
                    if (!details) {
                        const key = Object.keys(rules.bannedDetails).find(k => k.toLocaleLowerCase('tr-TR') === bannedTag.toLocaleLowerCase('tr-TR'))
                        if (key) details = rules.bannedDetails[key]
                    }

                    if (details) {
                        if (!bannedWarning) {
                            bannedWarning = {
                                title: reason,
                                warning: details.warning,
                                info: details.info
                            }
                        }
                        if (details.warning) reason += `\n⚠️ UYARI: ${details.warning}`
                        if (details.info) reason += `\nℹ️ BİLGİ: ${details.info}`
                        reasons[reasons.length - 1] = reason
                    }
                    // Add structured warning for diet (tag match)
                    warnings.push({
                        source: 'diet',
                        sourceName: dietName,
                        type: 'negative',
                        keyword: bannedTag,
                        warning: rules.bannedDetails?.[bannedTag]?.warning,
                        info: rules.bannedDetails?.[bannedTag]?.info
                    })
                }
            }
        }
    }

    // 3. Strict Diet Mode Check & Allowed Tags
    if (rules && rules.allowedTags && rules.allowedTags.length > 0) {
        // Collect all diet modes from food
        const foodModes = new Set<string>()

        // Add from booleans
        if (foodData.keto) {
            foodModes.add('KETOGENIC')
            foodModes.add('LOW_CARB') // Keto is strictly low carb
        }
        if (foodData.lowcarb) foodModes.add('LOW_CARB')
        if (foodData.vegan) {
            foodModes.add('VEGAN')
            foodModes.add('VEGETARIAN') // Vegan is strictly vegetarian
        }
        if (foodData.vejeteryan) foodModes.add('VEGETARIAN')
        if (foodData.vejetaryen) foodModes.add('VEGETARIAN') // Handle spelling var

        // Add from tags (if they match known modes)
        const allTags = [...(foodData.compatibility_tags || []), ...(foodData.tags || [])]
        allTags.forEach(t => {
            // Check mapping (remove spaces and dashes for lenient matching)
            const upper = t.toUpperCase().replace(/[\s\-]/g, '')
            const mapped = DIET_TAG_MAPPING[upper]
            if (mapped) {
                foodModes.add(mapped)
            } else {
                // Fallback normalizer
                const norm = t.toUpperCase().replace(/\-/g, '_').replace(/\s+/g, '_')
                if (DIET_MODE_TAGS.includes(norm)) foodModes.add(norm)
            }
        })

        // A. Relaxed Strict Check:
        // If the food has at least ONE tag that is allowed, it is considered compatible.
        // We only flag it if it has diet tags but NONE of them are allowed.
        const hasAnyAllowedMatch = rules.allowedTags.some(t => foodModes.has(t))

        if (!hasAnyAllowedMatch) {
            // If no allowed tags matched, but the food HAS detected modes -> Incompatible
            // (If food has no modes/tags, it is considered neutral and compatible)
            if (foodModes.size > 0) {
                isCompatible = false
                // Find what modes it has to show in reason
                const unallowedModes = Array.from(foodModes)
                // Fix readability of modes
                const readableModes = unallowedModes.map(m => m.replace('KETOGENIC', 'Ketojenik').replace('LOW_CARB', 'Düşük Karbonhidrat').replace('GLUTEN_FREE', 'Glutensiz').replace('VEGAN', 'Vegan').replace('VEGETARIAN', 'Vejetaryen').replace('DAIRY_FREE', 'Sütsüz').replace('HIGH_PROTEIN', 'Yüksek Protein').replace('PALEO', 'Paleo'))
                const strictReason = `${dietName} diyeti için uygun değil (${readableModes.join(', ')} tespit edildi).`
                if (!reasons.includes(strictReason)) reasons.push(strictReason)
            }
        }
    }

    // --- PROGRAM RESTRICTIONS CHECK (Moved here to join the flow) ---
    if (rules && rules.programRestrictions && rules.programRestrictions.length > 0) {
        for (const restriction of rules.programRestrictions) {
            let matched = false

            if (restriction.restriction_type === 'keyword') {
                if (foodData.name?.toLowerCase().includes(restriction.restriction_value.toLowerCase())) matched = true
            } else if (restriction.restriction_type === 'tag') {
                const allTags = [...(foodData.compatibility_tags || []), ...(foodData.tags || [])]
                if (allTags.some((t: string) => t.toLowerCase() === restriction.restriction_value.toLowerCase())) matched = true
            } else if (restriction.restriction_type === 'food_id') {
                if (foodData.id === restriction.restriction_value) matched = true
            }

            if (matched) {
                isCompatible = false
                const reason = `Program Kısıtlaması: ${restriction.reason || 'Yasaklı'} (${restriction.restriction_value})`
                if (!reasons.includes(reason)) reasons.push(reason)
                // If severity block, strictly block? The function returns isCompatible boolean anyway.
            }
        }
    }
    // ---------------------------------

    return {
        compatible: isCompatible,
        recommended: isRecommended,
        diseaseName: recommendations.join(', '),
        reason: reasons.length > 0 ? (reasons.some(r => r.startsWith('Hastalık')) ? reasons.join(', ') : `Hastalık/Diyet Uyarısı: ${reasons.join(', ')}`) : undefined,
        severity: isCompatible ? undefined : 'block',
        medicationWarning,
        bannedWarning,
        warnings
    }
}
