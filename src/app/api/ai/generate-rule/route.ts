import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { gemini } from '@/lib/gemini'
import { buildRuleGeneratorSystemPrompt } from '@/lib/ai/rule-generator-prompt'
import { detectConflicts, HealthContext } from '@/lib/ai/health-conflict-checker'

export const maxDuration = 60 // Vercel timeout limitini 60 saniyeye çıkarıyoruz

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Yemek Veritabanı Özeti ───
async function buildFoodSummary() {
  const { data: foods } = await supabase
    .from('foods')
    .select('name, category, role, tags')
    .limit(2000)

  if (!foods || foods.length === 0) {
    return { categories: [], roles: [], tags: [], sampleFoods: '' }
  }

  const categories = [...new Set(foods.map(f => f.category).filter(Boolean))]
  const roles = [...new Set(foods.map(f => f.role).filter(Boolean))]
  const tags = [...new Set(foods.flatMap(f => f.tags || []))]

  // Her kategoriden 3 örnek yemek
  const categoryFoods: Record<string, string[]> = {}
  for (const f of foods) {
    const cat = f.category || 'Diğer'
    if (!categoryFoods[cat]) categoryFoods[cat] = []
    if (categoryFoods[cat].length < 3) categoryFoods[cat].push(f.name)
  }
  const sampleFoods = Object.entries(categoryFoods)
    .map(([cat, names]) => `  ${cat}: ${names.join(', ')}`)
    .join('\n')

  return { categories, roles, tags, sampleFoods }
}

// ─── Mevcut Kuralları Çek (engine3 mantığıyla) ───
async function fetchRulesForScope(
  scope: string,
  patientId?: string,
  programTemplateId?: string,
  teamOwnerId?: string
) {
  const orParts: string[] = ['scope.is.null', 'scope.eq.global']

  if (teamOwnerId) {
    orParts.push(`and(scope.eq.team,team_owner_id.eq.${teamOwnerId})`)
  }

  if (programTemplateId) {
    if (teamOwnerId) {
      orParts.push(`and(scope.eq.program,program_template_id.eq.${programTemplateId},team_owner_id.eq.${teamOwnerId})`)
    } else {
      orParts.push(`and(scope.eq.program,program_template_id.eq.${programTemplateId},team_owner_id.is.null)`)
    }
  }

  if (patientId) {
    if (teamOwnerId) {
      orParts.push(`and(scope.eq.patient,patient_id.eq.${patientId},team_owner_id.eq.${teamOwnerId})`)
    } else {
      orParts.push(`and(scope.eq.patient,patient_id.eq.${patientId},team_owner_id.is.null)`)
    }
  }

  const { data } = await supabase
    .from('planning_rules')
    .select('*')
    .or(orParts.join(','))
    .order('priority', { ascending: false })

  if (!data) return []

  // Sparse Override merge (same logic as engine3)
  const patientRules = data.filter(r => r.scope === 'patient')
  const programRules = data.filter(r => r.scope === 'program')
  const teamRules = data.filter(r => r.scope === 'team')
  const globalRules = data.filter(r => !r.scope || r.scope === 'global')

  const merged = new Map<string, any>()
  globalRules.forEach(r => merged.set(r.id, r))
  teamRules.forEach(r => merged.set(r.source_rule_id || r.id, r))
  programRules.forEach(r => merged.set(r.source_rule_id || r.id, r))
  patientRules.forEach(r => merged.set(r.source_rule_id || r.id, r))

  return Array.from(merged.values()).filter(r => {
    if (!r.is_active) return false
    const def = r.definition as any
    if (def && def._is_deleted === true) return false
    return true
  })
}

// ─── Hasta Sağlık Bağlamı ───
async function buildHealthContext(patientId: string): Promise<HealthContext | null> {
  try {
    const [
      { data: diseases },
      { data: meds },
      { data: labs }
    ] = await Promise.all([
      supabase
        .from('patient_diseases')
        .select('id, disease:diseases (id, name, disease_rules (id, rule_type, keywords, match_name, match_tags, keyword_metadata))')
        .eq('patient_id', patientId),
      supabase
        .from('patient_medications')
        .select('medication_id, medications (id, name)')
        .eq('patient_id', patientId),
      supabase
        .from('patient_lab_results')
        .select('*, micronutrients(id, name, unit, default_min, default_max, category)')
        .eq('patient_id', patientId)
        .order('measured_at', { ascending: false })
        .limit(30)
    ])

    // Get medication interactions
    let medicationsWithInteractions: any[] = []
    if (meds && meds.length > 0) {
      const medIds = meds.map((m: any) => m.medication_id).filter(Boolean)
      if (medIds.length > 0) {
        const { data: interactions } = await supabase
          .from('medication_interactions')
          .select('*, medications(name)')
          .in('medication_id', medIds)

        const medMap = new Map<string, any>()
        for (const m of meds) {
          const med = (m as any).medications
          if (med) {
            medMap.set(med.id, { name: med.name, id: med.id, interactions: [] })
          }
        }
        if (interactions) {
          for (const i of interactions) {
            const medId = i.medication_id
            if (medMap.has(medId)) {
              medMap.get(medId).interactions.push(i)
            }
          }
        }
        medicationsWithInteractions = Array.from(medMap.values())
      }
    }

    // Process diseases
    const processedDiseases = (diseases || []).map((pd: any) => {
      const d = pd.disease
      return {
        name: d?.name || 'Bilinmeyen',
        disease_rules: d?.disease_rules || []
      }
    })

    // Process lab results (latest per micronutrient)
    const latestLabs = new Map<string, any>()
    for (const lab of (labs || [])) {
      const mn = (lab as any).micronutrients
      if (mn && !latestLabs.has(mn.id)) {
        latestLabs.set(mn.id, {
          name: mn.name,
          value: lab.value,
          unit: mn.unit || '',
          status: lab.value < (mn.default_min || 0) ? 'düşük' :
                  lab.value > (mn.default_max || 9999) ? 'yüksek' : 'normal'
        })
      }
    }

    return {
      diseases: processedDiseases,
      medications: medicationsWithInteractions,
      labResults: Array.from(latestLabs.values())
    }
  } catch (e) {
    console.error('[AI Rule Generator] Health context build error:', e)
    return null
  }
}

// ─── POST Handler ───
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { prompt, scope, patient_id, program_template_id, team_owner_id } = body

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: 'Lütfen en az 3 karakterlik bir istek yazın.' },
        { status: 400 }
      )
    }

    if (!gemini) {
      return NextResponse.json(
        { success: false, error: 'Gemini API anahtarı yapılandırılmamış.' },
        { status: 500 }
      )
    }

    // ═══ ADIM 1: Bağlam Derleme ═══
    const [existingRules, foodSummary, healthContext] = await Promise.all([
      fetchRulesForScope(scope, patient_id, program_template_id, team_owner_id),
      buildFoodSummary(),
      (scope === 'patient' && patient_id) ? buildHealthContext(patient_id) : Promise.resolve(null)
    ])

    // ═══ ADIM 2: AI Çağrısı ═══
    const systemPrompt = buildRuleGeneratorSystemPrompt({
      existingRules,
      foodSummary,
      healthContext,
      scope: scope || 'global'
    })

    const { HarmCategory, HarmBlockThreshold } = require('@google/generative-ai')

    const model = gemini.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.3
      },
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        }
      ]
    })

    const result = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Anladım. Kural sisteminizi, yemek veritabanınızı ve mevcut kurallarınızı inceledim. Şimdi isteğinize uygun kural JSON\'ı oluşturmaya hazırım.' }] },
        { role: 'user', parts: [{ text: `Lütfen şu isteği bir planlama kuralına dönüştür:\n\n"${prompt.trim()}"` }] }
      ]
    })

    const responseText = result.response.text()
    let aiResponse: any

    try {
      // Clean JSON response (remove markdown fences if present)
      let cleanedText = responseText.trim()
      if (cleanedText.startsWith('```json')) cleanedText = cleanedText.slice(7)
      if (cleanedText.startsWith('```')) cleanedText = cleanedText.slice(3)
      if (cleanedText.endsWith('```')) cleanedText = cleanedText.slice(0, -3)
      aiResponse = JSON.parse(cleanedText.trim())
      console.log("[RAW AI RESPONSE]:", JSON.stringify(aiResponse, null, 2))
    } catch (parseError) {
      const finishReason = result.response.candidates?.[0]?.finishReason || 'UNKNOWN'
      console.error('[AI Rule Generator] JSON parse error:', parseError, 'Raw:', responseText, 'FinishReason:', finishReason)
      return NextResponse.json(
        { success: false, error: `AI yanıtı ayrıştırılamadı. Neden: ${finishReason}. Hata: ${(parseError as any)?.message || 'Bilinmiyor'}. Ham yanıt: ${responseText.slice(0, 250)}` },
        { status: 422 }
      )
    }

    // Validate required fields
    const isClarification = aiResponse.clarification_needed === true;
    const requiredFields = isClarification
      ? ['clarification_message']
      : ['name', 'rule_type', 'definition', 'explanation']

    for (const field of requiredFields) {
      if (aiResponse[field] === undefined || aiResponse[field] === null) {
        return NextResponse.json(
          { success: false, error: `AI yanıtında "${field}" alanı eksik.` },
          { status: 422 }
        )
      }
    }

    // Validate rule_type only if not clarifying
    if (!isClarification) {
      const validTypes = ['frequency', 'affinity', 'consistency', 'fixed_meal', 'nutritional', 'rotation', 'or_group', 'update_meal_settings']
      if (!validTypes.includes(aiResponse.rule_type)) {
        return NextResponse.json(
          { success: false, error: `Geçersiz kural tipi: "${aiResponse.rule_type}"` },
          { status: 422 }
        )
      }
    }

    // ═══ ADIM 3: Çakışma Kontrolü ═══
    let conflicts: any[] = [];
    if (!isClarification) {
      const ruleForConflictCheck = {
        rule_type: aiResponse.rule_type,
        definition: { data: aiResponse.definition }
      }
      conflicts = detectConflicts(ruleForConflictCheck, existingRules, healthContext)
    }

    // ═══ ADIM 4: Response ═══
    return NextResponse.json({
      success: true,
      rule: isClarification ? null : {
        name: aiResponse.name,
        description: aiResponse.description || '',
        rule_type: aiResponse.rule_type,
        priority: Math.min(100, Math.max(1, aiResponse.priority || 50)),
        is_active: true,
        replaces_rule_id: aiResponse.replaces_rule_id || null,
        definition: {
          type: aiResponse.rule_type,
          data: aiResponse.definition
        }
      },
      additional_rules: (aiResponse.additional_rules || []).map((ar: any) => ({
        name: ar.name,
        description: ar.description || '',
        rule_type: ar.rule_type,
        priority: Math.min(100, Math.max(1, ar.priority || 50)),
        is_active: true,
        replaces_rule_id: ar.replaces_rule_id || null,
        definition: {
          type: ar.rule_type,
          data: ar.definition
        }
      })),
      explanation: aiResponse.explanation,
      conflicts,
      suggestions: Array.isArray(aiResponse.suggestions) ? aiResponse.suggestions : [],
      clarification_needed: aiResponse.clarification_needed || false,
      clarification_target: aiResponse.clarification_target || null,
      clarification_message: aiResponse.clarification_message || null
    })

  } catch (error: any) {
    console.error('[AI Rule Generator] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Bilinmeyen bir hata oluştu.' },
      { status: 500 }
    )
  }
}
