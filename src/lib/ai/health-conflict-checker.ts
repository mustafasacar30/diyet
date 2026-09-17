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

  let hasTargetOverlap = false
  if (tA.type === tB.type && tA.value === tB.value) hasTargetOverlap = true
  else if (tA.type === 'name_contains' && tB.value.includes(tA.value)) hasTargetOverlap = true
  else if (tB.type === 'name_contains' && tA.value.includes(tB.value)) hasTargetOverlap = true

  if (!hasTargetOverlap) return false

  // 1. ÖĞÜN ÇAKIŞMASI KONTROLÜ
  const mealsA = defA.scope_meals || defA.target?.meal_types || [];
  const mealsB = defB.scope_meals || defB.target?.meal_types || [];
  if (mealsA.length > 0 && mealsB.length > 0) {
    const overlapMeals = mealsA.filter((m: string) => mealsB.includes(m));
    if (overlapMeals.length === 0) return false;
  }

  // 2. GÜN ÇAKIŞMASI KONTROLÜ
  const daysA = defA.scope_days || [];
  const daysB = defB.scope_days || [];
  if (daysA.length > 0 && daysB.length > 0) {
    const overlapDays = daysA.filter((d: number) => daysB.includes(d));
    if (overlapDays.length === 0) return false;
  }

  // 3. HAFTA ÇAKIŞMASI KONTROLÜ
  const wA = defA.scope_weeks;
  const wB = defB.scope_weeks;
  
  if (wA?.mode === 'specific' && wA?.weeks?.length > 0 && wB?.mode === 'specific' && wB?.weeks?.length > 0) {
    const overlapWeeks = wA.weeks.filter((w: number) => wB.weeks.includes(w));
    if (overlapWeeks.length === 0) return false;
  }
  
  if (wB?.starting_week > 1 && wA?.mode === 'specific' && wA?.weeks?.length > 0) {
     const maxA = Math.max(...wA.weeks);
     if (maxA < wB.starting_week) return false;
  }
  if (wA?.starting_week > 1 && wB?.mode === 'specific' && wB?.weeks?.length > 0) {
     const maxB = Math.max(...wB.weeks);
     if (maxB < wA.starting_week) return false;
  }

  return true
}

export function describeRuleTarget(def: any): string {
  const t = def?.target || {};
  let desc = "";
  
  // 1. NE (Hangi Yiyecek/Grup)?
  if (t.categories && t.categories.length > 0) {
    desc += t.categories.join(' ve ') + ' kategorisindeki yemeklerin ';
  } else if (t.type === 'category') {
    desc += t.value + ' kategorisindeki yemeklerin ';
  } else if (t.type === 'tag') {
    desc += t.value + ' özellikli yemeklerin ';
  } else if (t.type === 'name_contains') {
    desc += 'içinde "' + t.value + '" geçen yemeklerin ';
  } else if (t.type === 'role') {
    desc += (t.value === 'mainDish' ? 'ana yemek' : t.value === 'sideDish' ? 'yardımcı yemek' : t.value) + ' rolündeki yemeklerin ';
  } else {
    desc += "bu besin grubunun ";
  }

  // 2. ÖĞÜN KISITLAMASI
  const meals = t.meal_types || def.scope_meals;
  if (meals && meals.length > 0) {
    desc += `(sadece ${meals.join(', ')} öğünlerinde) `;
  } else {
    desc += `(öğün kısıtlaması olmaksızın) `;
  }

  // 3. GÜN KISITLAMASI
  if (def.scope_days && def.scope_days.length > 0) {
    const dayNames = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
    const days = def.scope_days.map((d: number) => dayNames[d - 1] || d).join(', ');
    desc += `sadece ${days} günlerinde `;
  }

  // 4. HAFTA KISITLAMASI
  if (def.scope_weeks) {
    if (def.scope_weeks.mode === 'specific' && def.scope_weeks.weeks) {
      desc += `(diyetin ${def.scope_weeks.weeks.join(', ')}. haftalarında) `;
    } else if (def.scope_weeks.mode === 'repeating' && def.scope_weeks.every > 1) {
      desc += `(her ${def.scope_weeks.every} haftada bir) `;
    }
    
    if (def.scope_weeks.starting_week && def.scope_weeks.starting_week > 1) {
      desc += `(programın ${def.scope_weeks.starting_week}. haftasından itibaren) `;
    }
  }
  
  // 5. EXCLUSIVE SCOPE
  if (def.exclusive_scope) {
    desc += `*ve bu aralık dışında kalan zamanlarda tamamen yasaklanacak şekilde* `;
  }

  return desc.trim();
}

export function isDefinitionDuplicate(defA: any, defB: any): boolean {
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

export function generateRuleSentence(rule: any): string {
  if (!rule || !rule.definition) return rule?.name || 'Bilinmeyen Kural';
  const type = rule.rule_type;
  const def = (rule.definition as any)?.data || rule.definition || {};

  if (type === 'frequency') {
    let action = "menüye eklenir";
    if (def.min_count && def.max_count && def.min_count === def.max_count) {
      action = `tam olarak ${def.min_count} kez eklenmesi zorunludur`;
    } else if (def.min_count) {
      action = `en az ${def.min_count} kez eklenmesi sağlanır`;
    } else if (def.max_count) {
      action = `en fazla ${def.max_count} kez eklenmesine izin verilir`;
    }
    
    if (def.period === 'daily') action = "günde " + action;
    else if (def.period === 'per_meal') action = "her öğünde " + action;
    else action = "haftada " + action;
    
    const targetText = describeRuleTarget(def);
    return `${targetText.charAt(0).toUpperCase() + targetText.slice(1)}, ${action}.`;
  }

  if (type === 'affinity') {
    const trigger = def.trigger ? `${def.trigger.value} (${def.trigger.type}) varsa` : 'Belirli bir yemek varsa';
    const outcome = def.outcome ? `${def.outcome.value} (${def.outcome.type})` : 'başka bir yemek';
    const assoc = (def.association === 'forbidden' || def.probability === 0) ? 'kesinlikle eklenmez' : 'mutlaka birlikte eklenir';
    return `Menüde ${trigger}, yanına ${outcome} ${assoc}.`;
  }

  if (type === 'consistency') {
    return `${describeRuleTarget(def).charAt(0).toUpperCase() + describeRuleTarget(def).slice(1)} seçimi, hafta veya gün boyunca değiştirilmeden aynı bırakılır.`;
  }
  
  if (type === 'rotation') {
    return `${describeRuleTarget(def).charAt(0).toUpperCase() + describeRuleTarget(def).slice(1)} seçenekleri menüde düzenli olarak sırayla sunulur.`;
  }

  if (type === 'fixed_meal') {
    return `${def.target_slot || 'Belirli öğüne'} sabit olarak (${(def.foods || []).join(', ')}) eklenir.`;
  }

  return rule.description || rule.name;
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
          message: `Dikkat: Yeni tercihiniz ile ${describeRuleTarget(newDef)} haftada en az ${newDef.min_count} kez eklenmesi isteniyor. Ancak sistemdeki "${existing.name}" kuralı ${describeRuleTarget(existDef)} en fazla ${existDef.max_count} kez eklenmesine izin vermektedir. Bu iki kural birbiriyle çelişiyor.`
        })
      }
      if (existDef.min_count && newDef.max_count && existDef.min_count > newDef.max_count) {
        conflicts.push({
          severity: 'error', icon: '🔴',
          existing_rule_name: existing.name,
          existing_rule_id: existing.id,
          message: `Dikkat: Yeni tercihiniz ${describeRuleTarget(newDef)} en fazla ${newDef.max_count} kez eklenmesine izin veriyor. Ancak sistemdeki "${existing.name}" kuralı ${describeRuleTarget(existDef)} en az ${existDef.min_count} kez eklenmesini zorunlu tutuyor. Bu iki kural birbiriyle çelişiyor.`
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
          message: `Uyarı: "${existing.name}" kuralı bu hedefi menüde zorunlu kılıyor (en az ${existDef.min_count} kez). Ancak yeni oluşturduğunuz zıtlık kuralı bu durumu engelleyebilir.`
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
          message: `Çelişki: Sistemdeki "${existing.name}" kuralı bu besin ilişkisini ${existIsMandatory ? 'zorunlu' : 'yasaklı'} kılıyor, ancak yeni kuralınız tam tersi bir ilişki talep ediyor.`
        })
      }
    }

    // 4. Birebir kopya tespiti
    if (newRule.rule_type === existing.rule_type && isDefinitionDuplicate(newDef, existDef)) {
      conflicts.push({
        severity: 'info', icon: '🔵',
        existing_rule_name: existing.name,
        existing_rule_id: existing.id,
        message: `Bilgi: Yeni istediğiniz kural ile sistemdeki "${existing.name}" kuralı tamamen aynı işlevi yapıyor. Yeni bir kural eklemenize gerek olmayabilir.`
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
