/**
 * Health Conflict Checker
 * Checks generated rules against patient's health data (medications, diseases, lab results)
 * to flag potential dangerous interactions.
 */

export interface HealthFlag {
  severity: 'critical' | 'warning'
  icon: '🔴' | '🟡'
  source: 'medication' | 'disease' | 'lab_result'
  sourceName: string
  message: string
}

export interface HealthContext {
  diseases: Array<{ name: string; disease_rules: any[] }>
  medications: Array<{ name: string; id?: string; interactions: any[] }>
  labResults: Array<{ name: string; value: number; unit: string; status: string }>
}

export interface ConflictInfo {
  severity: 'error' | 'warning' | 'info'
  icon: '🔴' | '🟡' | '🔵'
  existing_rule_name: string
  existing_rule_id: string
  message: string
}

// ─── Hedef Eşleşme Yardımcıları ───

function normalizeStr(s: string): string {
  return (s || '').toLocaleLowerCase('tr-TR').trim()
}

function extractTargetValues(rule: any): string[] {
  const def = rule.definition?.data || rule.definition || {}
  const values: string[] = []

  // Frequency / Consistency / Rotation targets
  if (def.target?.value) values.push(normalizeStr(def.target.value))

  // Affinity trigger & outcome
  if (def.trigger?.value) values.push(normalizeStr(def.trigger.value))
  if (def.outcome?.value) values.push(normalizeStr(def.outcome.value))

  // Fixed meal foods
  if (Array.isArray(def.foods)) {
    for (const f of def.foods) values.push(normalizeStr(f))
  }

  // Nutritional action foods
  if (def.action?.foods && Array.isArray(def.action.foods)) {
    for (const f of def.action.foods) values.push(normalizeStr(f))
  }

  return values
}

function targetsOverlap(defA: any, defB: any): boolean {
  const getTarget = (d: any) => {
    if (d.target) return { type: normalizeStr(d.target.type), value: normalizeStr(d.target.value) }
    if (d.trigger) return { type: normalizeStr(d.trigger.type), value: normalizeStr(d.trigger.value) }
    return null
  }

  const tA = getTarget(defA)
  const tB = getTarget(defB)
  if (!tA || !tB) return false

  // Same type and same or overlapping value
  if (tA.type === tB.type && tA.value === tB.value) return true

  // name_contains can overlap with category/tag matches
  if (tA.type === 'name_contains' && tB.value.includes(tA.value)) return true
  if (tB.type === 'name_contains' && tA.value.includes(tB.value)) return true

  return false
}

function isDefinitionDuplicate(defA: any, defB: any): boolean {
  // Simple structural comparison of key fields
  const keysA = Object.keys(defA).filter(k => defA[k] !== undefined && defA[k] !== null).sort()
  const keysB = Object.keys(defB).filter(k => defB[k] !== undefined && defB[k] !== null).sort()

  if (keysA.length !== keysB.length) return false
  try {
    return JSON.stringify(defA, keysA) === JSON.stringify(defB, keysB)
  } catch {
    return false
  }
}

// ─── Kural Çakışma Dedektörü ───

export function detectConflicts(
  newRule: { rule_type: string; definition: any },
  existingRules: any[],
  healthContext?: HealthContext | null
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = []
  const newDef = newRule.definition?.data || newRule.definition || {}

  for (const existing of existingRules) {
    if (!existing.is_active) continue
    const existDef = (existing.definition as any)?.data || existing.definition || {}

    if (!targetsOverlap(newDef, existDef)) continue

    // 1. frequency vs frequency: min > diğerinin max?
    if (newRule.rule_type === 'frequency' && existing.rule_type === 'frequency') {
      if (newDef.min_count && existDef.max_count && newDef.min_count > existDef.max_count) {
        conflicts.push({
          severity: 'error', icon: '🔴',
          existing_rule_name: existing.name,
          existing_rule_id: existing.id,
          message: `Çelişki: "${existing.name}" kuralı bu hedefe en fazla ${existDef.max_count} kez izin veriyor, ama yeni kuralınız en az ${newDef.min_count} kez istiyor.`
        })
      }
      if (existDef.min_count && newDef.max_count && existDef.min_count > newDef.max_count) {
        conflicts.push({
          severity: 'error', icon: '🔴',
          existing_rule_name: existing.name,
          existing_rule_id: existing.id,
          message: `Çelişki: "${existing.name}" kuralı en az ${existDef.min_count} kez istiyor, ama yeni kuralınız en fazla ${newDef.max_count} kez izin veriyor.`
        })
      }
    }

    // 2. affinity forbidden vs frequency min_count
    if (newRule.rule_type === 'affinity'
      && (newDef.association === 'forbidden' || newDef.probability === 0)) {
      if (existing.rule_type === 'frequency' && existDef.min_count > 0) {
        conflicts.push({
          severity: 'warning', icon: '🟡',
          existing_rule_name: existing.name,
          existing_rule_id: existing.id,
          message: `Uyarı: "${existing.name}" kuralı bu hedefi zorunlu kılıyor (min:${existDef.min_count}). Yasaklama kuralınız onu engelleyebilir.`
        })
      }
    }

    // 3. Zıt affinity (biri forbidden biri mandatory)
    if (newRule.rule_type === 'affinity' && existing.rule_type === 'affinity') {
      const newIsForbidden = newDef.association === 'forbidden' || newDef.probability === 0
      const existIsForbidden = existDef.association === 'forbidden' || existDef.probability === 0
      const newIsMandatory = newDef.association === 'mandatory' || newDef.probability === 100
      const existIsMandatory = existDef.association === 'mandatory' || existDef.probability === 100

      if ((newIsForbidden && existIsMandatory) || (newIsMandatory && existIsForbidden)) {
        conflicts.push({
          severity: 'error', icon: '🔴',
          existing_rule_name: existing.name,
          existing_rule_id: existing.id,
          message: `Çelişki: "${existing.name}" kuralı bu ilişkiyi ${existIsMandatory ? 'zorunlu' : 'yasaklı'} kılıyor, ama yeni kuralınız tam tersini istiyor.`
        })
      }
    }

    // 4. Birebir kopya tespiti
    if (newRule.rule_type === existing.rule_type && isDefinitionDuplicate(newDef, existDef)) {
      conflicts.push({
        severity: 'info', icon: '🔵',
        existing_rule_name: existing.name,
        existing_rule_id: existing.id,
        message: `Bilgi: "${existing.name}" kuralı zaten aynı işlevi yapıyor. Tekrar eklemenize gerek olmayabilir.`
      })
    }
  }

  // ─── Sağlık Verisi Çakışması ───
  if (healthContext) {
    const targetValues = extractTargetValues(newRule)

    // İlaç etkileşimi kontrolü
    for (const med of healthContext.medications) {
      if (!med.interactions || !Array.isArray(med.interactions)) continue
      for (const interaction of med.interactions) {
        const keywords = [
          interaction.food_keyword,
          interaction.keyword,
          interaction.restriction_value
        ].filter(Boolean).map(normalizeStr)

        for (const keyword of keywords) {
          if (targetValues.some(tv => tv.includes(keyword) || keyword.includes(tv))) {
            conflicts.push({
              severity: 'error', icon: '🔴',
              existing_rule_name: `İlaç: ${med.name}`,
              existing_rule_id: med.id || '',
              message: `Tehlike: Hastanın ${med.name} ilacı ile "${keyword}" etkileşime girebilir!`
            })
          }
        }
      }
    }

    // Hastalık kısıtlaması kontrolü
    for (const disease of healthContext.diseases) {
      if (!disease.disease_rules || !Array.isArray(disease.disease_rules)) continue
      for (const dr of disease.disease_rules) {
        const keywords = [dr.keyword, dr.keywords, dr.match_name]
          .flat().filter(Boolean).map(normalizeStr)

        for (const keyword of keywords) {
          if (targetValues.some(tv => tv.includes(keyword) || keyword.includes(tv))) {
            conflicts.push({
              severity: 'warning', icon: '🟡',
              existing_rule_name: `Hastalık: ${disease.name}`,
              existing_rule_id: '',
              message: `Uyarı: ${disease.name} hastalığı nedeniyle "${keyword}" dikkatli kullanılmalıdır.`
            })
          }
        }
      }
    }
  }

  return conflicts
}

// ─── Miras Kural Sağlık Bayrakları ───

export function checkHealthConflictsForRule(
  rule: any,
  healthContext: HealthContext
): HealthFlag[] {
  const flags: HealthFlag[] = []
  const targetValues = extractTargetValues(rule)

  if (targetValues.length === 0) return flags

  // İlaç etkileşimi
  for (const med of healthContext.medications) {
    if (!med.interactions || !Array.isArray(med.interactions)) continue
    for (const interaction of med.interactions) {
      const keywords = [
        interaction.food_keyword,
        interaction.keyword,
        interaction.restriction_value
      ].filter(Boolean).map(normalizeStr)

      for (const keyword of keywords) {
        if (targetValues.some(tv => tv.includes(keyword) || keyword.includes(tv))) {
          flags.push({
            severity: 'critical', icon: '🔴',
            source: 'medication',
            sourceName: med.name,
            message: `${med.name} ilacı ile "${keyword}" etkileşime girebilir!`
          })
        }
      }
    }
  }

  // Hastalık kısıtlaması
  for (const disease of healthContext.diseases) {
    if (!disease.disease_rules || !Array.isArray(disease.disease_rules)) continue
    for (const dr of disease.disease_rules) {
      const keywords = [dr.keyword, dr.keywords, dr.match_name]
        .flat().filter(Boolean).map(normalizeStr)

      for (const keyword of keywords) {
        if (targetValues.some(tv => tv.includes(keyword) || keyword.includes(tv))) {
          flags.push({
            severity: 'warning', icon: '🟡',
            source: 'disease',
            sourceName: disease.name,
            message: `${disease.name} nedeniyle "${keyword}" dikkatli kullanılmalıdır.`
          })
        }
      }
    }
  }

  return flags
}
