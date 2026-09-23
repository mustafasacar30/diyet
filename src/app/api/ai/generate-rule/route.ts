import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { gemini } from '@/lib/gemini'
import { buildRuleGeneratorSystemPrompt } from '@/lib/ai/rule-generator-prompt'
import { detectConflicts, HealthContext, targetsOverlap } from '@/lib/ai/health-conflict-checker'

export const maxDuration = 60 // Vercel timeout limitini 60 saniyeye çıkarıyoruz

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Yemek Veritabanı Özeti ───
// Sera'nın fixed_meal / nutritional / rotation kurallarında food_id kullanabilmesi için
// her kategoriden ilk N yemeği "id | name" formatında veriyoruz. Ad halüsinasyonunu bu kesin önler.
const FOODS_PER_CATEGORY = 15

async function buildFoodSummary() {
  const { data: foods } = await supabase
    .from('foods')
    .select('id, name, category, role, tags')
    .order('name', { ascending: true })
    .limit(3000)

  if (!foods || foods.length === 0) {
    return { categories: [], roles: [], tags: [], sampleFoods: '' }
  }

  const categories = [...new Set(foods.map(f => f.category).filter(Boolean))]
  const roles = [...new Set(foods.map(f => f.role).filter(Boolean))]
  const tags = [...new Set(foods.flatMap(f => f.tags || []))]

  // Her kategoriden ilk FOODS_PER_CATEGORY yemek (id + name). Sera fixed_meal/nutritional için
  // MUTLAKA buradaki UUID'yi yazmalı — isim yazarsa motorun fuzzy match'ine düşer.
  const categoryFoods: Record<string, { id: string; name: string }[]> = {}
  for (const f of foods) {
    const cat = f.category || 'Diğer'
    if (!categoryFoods[cat]) categoryFoods[cat] = []
    if (categoryFoods[cat].length < FOODS_PER_CATEGORY) {
      categoryFoods[cat].push({ id: f.id, name: f.name })
    }
  }
  const sampleFoods = Object.entries(categoryFoods)
    .map(([cat, items]) => {
      const lines = items.map(it => `    - ${it.id} | ${it.name}`).join('\n')
      return `  ${cat}:\n${lines}`
    })
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

    let dietType = undefined;
    let slotConfigsContext = "";
    let phaseMapContext = "";
    if (scope === 'patient' && patient_id) {
      const { data: pt } = await supabase.from('patients').select('diet_type').eq('id', patient_id).single();
      if (pt && pt.diet_type) dietType = pt.diet_type;

      // ── PROGRAM FAZ HARİTASI (DB-driven) ──
      // Kaynak: patients.program_template_id → program_template_weeks → diet_types (banned_keywords + makro faktörleri).
      // Yedek: diet_plans → diet_weeks (hasta bazlı override varsa).
      try {
        // 1) Önce hastanın atanmış program şablonunu al
        const { data: patientRow } = await supabase
          .from('patients')
          .select('program_template_id')
          .eq('id', patient_id)
          .single();

        // 2) Aktif diyet planı — şu anki haftayı hesaplamak için tarih lazım
        const { data: plans } = await supabase
          .from('diet_plans')
          .select('id, title, status, start_date, created_at')
          .eq('patient_id', patient_id)
          .order('created_at', { ascending: false })
          .limit(5);
        const activePlan: any = plans?.find((p: any) => p.status === 'active') || plans?.[0];

        // 3) Faz aralıklarını topla
        type PhaseGroup = { startWeek: number; endWeek: number; dietTypeId: string | null; phaseName: string };
        let groups: PhaseGroup[] = [];
        let programTitle = '';

        if (patientRow?.program_template_id) {
          const { data: tmpl } = await supabase
            .from('program_templates')
            .select('id, name, description')
            .eq('id', patientRow.program_template_id)
            .single();
          programTitle = tmpl?.name || '';

          const { data: tmplWeeks } = await supabase
            .from('program_template_weeks')
            .select('week_start, week_end, diet_type_id, diet_types(name)')
            .eq('program_template_id', patientRow.program_template_id)
            .order('week_start', { ascending: true });
          if (tmplWeeks && tmplWeeks.length > 0) {
            groups = tmplWeeks.map((w: any) => ({
              startWeek: w.week_start,
              endWeek: w.week_end,
              dietTypeId: w.diet_type_id,
              phaseName: w.diet_types?.name || 'Belirtilmemiş',
            }));
          }
        }

        // 4) Fallback: hastanın diet_weeks tablosunu kullan (patient-scope override / eski akış)
        if (groups.length === 0 && activePlan) {
          const { data: weeks } = await supabase
            .from('diet_weeks')
            .select('week_number, assigned_diet_type_id, diet_types(name)')
            .eq('diet_plan_id', activePlan.id)
            .order('week_number', { ascending: true });
          if (weeks && weeks.length > 0) {
            for (const w of weeks) {
              const phase = (w as any).diet_types?.name || 'Belirtilmemiş';
              const dtid = (w as any).assigned_diet_type_id || null;
              const wn = (w as any).week_number;
              const last = groups[groups.length - 1];
              if (last && last.phaseName === phase && last.endWeek === wn - 1) {
                last.endWeek = wn;
              } else {
                groups.push({ startWeek: wn, endWeek: wn, dietTypeId: dtid, phaseName: phase });
              }
            }
            if (!programTitle) programTitle = activePlan.title || 'İsimsiz';
          }
        }

        if (groups.length > 0) {
          // 5) Her benzersiz diyet türü için banned_keywords + makro faktörleri çek
          const uniqueDietTypeIds = Array.from(new Set(groups.map(g => g.dietTypeId).filter(Boolean))) as string[];
          const dietTypeInfo = new Map<string, {
            name: string;
            description: string | null;
            bannedKeywords: string[];
            bannedTags: string[];
            bannedDetails: Record<string, any>;
            carbFactor: number | null;
            proteinFactor: number | null;
            fatFactor: number | null;
          }>();
          if (uniqueDietTypeIds.length > 0) {
            const { data: dtRows } = await supabase
              .from('diet_types')
              .select('id, name, description, banned_keywords, banned_tags, banned_details, carb_factor, protein_factor, fat_factor')
              .in('id', uniqueDietTypeIds);
            for (const dt of (dtRows || [])) {
              dietTypeInfo.set((dt as any).id, {
                name: (dt as any).name,
                description: (dt as any).description,
                bannedKeywords: Array.isArray((dt as any).banned_keywords) ? (dt as any).banned_keywords : [],
                bannedTags: Array.isArray((dt as any).banned_tags) ? (dt as any).banned_tags : [],
                bannedDetails: (dt as any).banned_details || {},
                carbFactor: (dt as any).carb_factor ?? null,
                proteinFactor: (dt as any).protein_factor ?? null,
                fatFactor: (dt as any).fat_factor ?? null,
              });
            }
          }

          // 6) Şu anki hafta
          let currentWeek = 1;
          const startStr = activePlan?.start_date || activePlan?.created_at;
          if (startStr) {
            const start = new Date(startStr);
            const now = new Date();
            const diffDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
            currentWeek = Math.max(1, Math.floor(diffDays / 7) + 1);
          }
          const currentGroup = groups.find(g => currentWeek >= g.startWeek && currentWeek <= g.endWeek);
          const currentPhase = currentGroup?.phaseName || 'Belirtilmemiş';
          const currentDietInfo = currentGroup?.dietTypeId ? dietTypeInfo.get(currentGroup.dietTypeId) : undefined;

          // 7) Metinsel özet
          const summary = groups
            .map(g => {
              const info = g.dietTypeId ? dietTypeInfo.get(g.dietTypeId) : undefined;
              const range = g.startWeek === g.endWeek ? `Hafta ${g.startWeek}` : `Hafta ${g.startWeek}-${g.endWeek}`;
              const banned = info && info.bannedKeywords.length > 0
                ? ` — YASAK: ${info.bannedKeywords.slice(0, 20).join(', ')}${info.bannedKeywords.length > 20 ? '...' : ''}`
                : '';
              const macros = info && (info.carbFactor !== null || info.proteinFactor !== null || info.fatFactor !== null)
                ? ` [Makro faktör K:${info.carbFactor ?? '-'} P:${info.proteinFactor ?? '-'} Y:${info.fatFactor ?? '-'}]`
                : '';
              return `${range}: **${g.phaseName}**${macros}${banned}`;
            })
            .join('\n');

          // 8) Şu anki fazın detayı
          let currentPhaseDetail = '';
          if (currentDietInfo) {
            const parts: string[] = [];
            if (currentDietInfo.description) parts.push(`Açıklama: ${currentDietInfo.description}`);
            if (currentDietInfo.bannedKeywords.length > 0) parts.push(`Yasak kelimeler: ${currentDietInfo.bannedKeywords.join(', ')}`);
            if (currentDietInfo.bannedTags.length > 0) parts.push(`Yasak etiketler: ${currentDietInfo.bannedTags.join(', ')}`);
            const macroLine: string[] = [];
            if (currentDietInfo.carbFactor !== null) macroLine.push(`Karbonhidrat faktörü: ${currentDietInfo.carbFactor}`);
            if (currentDietInfo.proteinFactor !== null) macroLine.push(`Protein faktörü: ${currentDietInfo.proteinFactor}`);
            if (currentDietInfo.fatFactor !== null) macroLine.push(`Yağ faktörü: ${currentDietInfo.fatFactor}`);
            if (macroLine.length > 0) parts.push(macroLine.join(' | '));
            currentPhaseDetail = parts.join('\n');
          }

          phaseMapContext = `\n\n═══════════════════════════════════════════════
🔴 PROGRAM FAZI (ÇOK KRİTİK — HER İSTEKTE İLK BAKACAĞIN BİLGİ)
═══════════════════════════════════════════════

Hastanın programı: ${programTitle || 'İsimsiz'}
Hasta ŞU AN: **Hafta ${currentWeek} — ${currentPhase}** fazındadır.

ŞU ANKİ FAZ DETAYI:
${currentPhaseDetail || '(kısıtlama bilgisi yok)'}

TAM FAZ HARİTASI (her fazın yasak kelime listesi ve makro faktörleri):
${summary}

DAVRANIŞ KURALLARI (kesin uy):
1. Hasta bir gıda/kural istediğinde ÖNCE istenen kelimeyi ŞU ANKİ fazın "Yasak kelimeler" listesinde ara (case-insensitive). Kelime yasaksa DİREKT ÜRETME.
2. Yasaksa: İleri haftalardaki fazlarda yasak listesini de tara. İSTENEN KELİMENİN OLMADIĞI ilk fazı bul → o fazın başlangıç haftasını hastaya öner.
3. clarification_message şablonu (PROGRAM ADINI mutlaka bir kez belirt): "Şu anda [PROGRAM ADI] programınızın [şu anki faz] fazının [şu anki hafta]. haftasındasınız ve bu fazda [gıda] yer almıyor. Programınızın [serbest faz] fazı [başlangıç haftası]. haftadan itibaren başlıyor — [gıda] o fazda serbest. Kuralı [başlangıç haftası]. haftadan itibaren uygulayayım mı?"
   Somut örnek: "Şu anda Lipödem Beslenmesi programınızın Eliminasyonlu Ketojenik fazının 1. haftasındasınız ve bu fazda peynir yer almıyor. Programınızın Ketojenik fazı 3. haftadan itibaren başlıyor — peynir o fazda serbest. Kuralı 3. haftadan itibaren uygulayayım mı?"
   Sonraki cümlelerde artık program adını tekrar etme; sadece faz adını kullan.
4. Makro değişimi hatırlatması: Eğer öneri fazlar arası geçişse ve makro faktörleri farklıysa (Örn: EK'te K:0.3 → K'de K:0.3 aynı, ama L'de K:0.6 iki kat yüksek), bunu ek not olarak belirt: "Not: [yeni faz]'da karbonhidrat toleransınız artar (K:0.3 → K:0.6), bu yüzden bu kural o fazda daha rahat uygulanabilir."
5. ÖNEMLİ HATA ÖRNEĞİ (yapma!): Hasta EK'te "peynir" istediğinde 10. hafta Low Carb önerme — çünkü 3. hafta Ketojenik'te peynir yasak DEĞİL (kontrol et!). Her zaman YASAK LİSTESİNE bak, sadece diyetin ismine göre karar verme.
═══════════════════════════════════════════════`;
        }
      } catch (e) {
        console.warn('[Sera] Phase map build failed:', e);
      }
      
      let ps = null;
      // Hierarchical fetch for settings
      const fetchLayer = async (col: string, val: string) => {
        if (!val) return null;
        const { data } = await supabase.from('planner_settings')
          .select('slot_config, slot_configs')
          .eq(col, val)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        return data;
      };

      ps = await fetchLayer('patient_id', patient_id);
      if (!ps || !ps.slot_configs) ps = await fetchLayer('program_template_id', program_template_id);
      if (!ps || !ps.slot_configs) ps = await fetchLayer('team_owner_id', team_owner_id);
      if (!ps || !ps.slot_configs) ps = await fetchLayer('scope', 'global');
      
      const activeConfig = ps?.slot_config || ps?.slot_configs;
      if (activeConfig) {
        slotConfigsContext = "\n\nHASTANIN ÖĞÜN AYARLARI (MEAL SETTINGS):\n";
        activeConfig.forEach((slot: any) => {
          slotConfigsContext += `- ${slot.name}: Kapasite (Min: ${slot.min_items}, Max: ${slot.max_items})\n`;
        });
        slotConfigsContext += "\n\nÇOK KRİTİK DİKKAT: YALNIZCA YUKARIDAKİ LİSTEDE YER ALAN ÖĞÜN İSİMLERİNİ 'scope_meals' İÇİNE YAZABİLİRSİN! Yukarıda 'Ara Öğün' veya 'Kahvaltı' yoksa, hastanın böyle bir öğünü YOKTUR. Olmayan bir öğüne kesinlikle kural yazma veya öneride bulunma!";
      }
    }

    // ════ ADIM 2: AI Çağrısı ════
    let systemPrompt = buildRuleGeneratorSystemPrompt({
      existingRules,
      foodSummary,
      healthContext,
      scope,
      dietType
    })

    if (slotConfigsContext) {
      systemPrompt += slotConfigsContext;
    }

    if (phaseMapContext) {
      systemPrompt += phaseMapContext;
    }
    



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

    // Kullanıcı mesajının hemen üstüne faz hatırlatması ekle (recency effect için)
    const phaseReminder = phaseMapContext
      ? `\n\n🔴 HATIRLATMA: Bu isteği değerlendirmeden önce YUKARIDA belirtilen hastanın ŞU ANKİ FAZINI KONTROL ET! İstenen gıda o fazda yasak mı? Yasaksa clarification_needed=true dön.\n`
      : '';

    const result = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Anladım. Kural sisteminizi, yemek veritabanınızı, mevcut kurallarınızı ve varsa hastanın aktif diyet fazını inceledim. Şimdi isteğinize uygun kural JSON\'ı oluşturmaya hazırım.' }] },
        { role: 'user', parts: [{ text: `${phaseReminder}Lütfen şu isteği bir planlama kuralına dönüştür:\n\n"${prompt.trim()}"` }] }
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

    // ═══ MARKDOWN TEMİZLİĞİ ═══
    // Sera prompt'a rağmen bazen ** ** __ __ ` ` gibi markdown kullanıyor.
    // UI plain text render ettiği için asterisks çirkin görünüyor. Post-process ile temizle.
    const stripMarkdown = (s: any): any => {
      if (typeof s !== 'string') return s;
      return s
        .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
        .replace(/__(.+?)__/g, '$1')       // __bold__
        .replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, '$1')  // *italic*
        .replace(/`([^`]+?)`/g, '$1');     // `code`
    };
    const cleanRuleTexts = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      for (const key of ['name', 'description', 'explanation', 'clarification_message']) {
        if (typeof obj[key] === 'string') obj[key] = stripMarkdown(obj[key]);
      }
      if (Array.isArray(obj.suggestions)) {
        obj.suggestions = obj.suggestions.map((s: any) => typeof s === 'string' ? stripMarkdown(s) : s);
      }
    };
    cleanRuleTexts(aiResponse);
    if (Array.isArray(aiResponse.additional_rules)) {
      aiResponse.additional_rules.forEach(cleanRuleTexts);
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
      const validTypes = ['frequency', 'affinity', 'consistency', 'fixed_meal', 'nutritional', 'rotation', 'or_group', 'update_meal_settings', 'preference_score']
      if (!validTypes.includes(aiResponse.rule_type)) {
        return NextResponse.json(
          { success: false, error: `Geçersiz kural tipi: "${aiResponse.rule_type}"` },
          { status: 422 }
        )
      }
    }

    // ═══ ADIM 3: Çakışma Kontrolü ═══
    let conflicts: any[] = [];
    let duplicateWarnings: { id: string; name: string; scope: string; rule_type: string; summary: string }[] = []
    if (!isClarification) {
      const ruleForConflictCheck = {
        rule_type: aiResponse.rule_type,
        definition: { data: aiResponse.definition }
      }
      const rawConflicts = detectConflicts(ruleForConflictCheck, existingRules, healthContext)
      // Dedupe: aynı kural farklı scope'larda birden fazla kayda sahip olabilir
      // (patient + program + tombstone kopyaları). Aynı message'ı tekrar gösterme.
      const seen = new Set<string>()
      conflicts = rawConflicts.filter((c: any) => {
        const key = `${c.severity}|${c.message}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // ═══ replaces_rule_id GENIŞLETMESI ═══
      // Sera tek bir eski kural id'si yazıyor ve bazen yanlış scope (program) seçebiliyor
      // ya da hasta scope'ta duplicate kaydı görmüyor. Post-process ile:
      // 1. Yeni kural targetsOverlap eden TÜM aktif kuralları bul
      // 2. Bunları definition._replaced_ids içine yaz (toggle mekanizması hepsini durdurur)
      // 3. replaces_rule_id'yi patient-scope olan varsa ona set et (en yakın hiyerarşi)
      // ═══ DUPLIKAT UYARISI + replaces_rule_id GENİŞLETMESİ ═══
      try {
        const overlapping = existingRules.filter((r: any) => {
          if (!r.is_active) return false
          if (r.rule_type !== aiResponse.rule_type) return false
          const existDef = (r.definition as any)?.data || r.definition || {}
          return targetsOverlap(aiResponse.definition, existDef)
        })
        const seraPickedId = aiResponse.replaces_rule_id
        const allIds = new Set<string>(overlapping.map((r: any) => r.id))
        if (seraPickedId) allIds.add(seraPickedId)

        if (allIds.size > 0) {
          aiResponse.definition._replaced_ids = Array.from(allIds)

          const scopeRank: Record<string, number> = { patient: 4, program: 3, team: 2, global: 1 }
          const sortedOverlap = [...overlapping].sort((a: any, b: any) => {
            const sa = scopeRank[a.scope || 'global'] || 0
            const sb = scopeRank[b.scope || 'global'] || 0
            return sb - sa
          })
          if (sortedOverlap.length > 0) {
            aiResponse.replaces_rule_id = sortedOverlap[0].id
          }

          const scopeLabels: Record<string, string> = { global: 'Genel', team: 'Takım', program: 'Program', patient: 'Kişisel' }
          duplicateWarnings = overlapping.map((r: any) => ({
            id: r.id,
            name: r.name || '(isimsiz)',
            scope: r.scope || 'global',
            rule_type: r.rule_type,
            summary: `"${r.name || '(isimsiz)'}" (${scopeLabels[r.scope || 'global'] || r.scope} katmanı) — aynı hedefe benzer kural zaten aktif.`
          }))
        }
      } catch (e) {
        console.warn('[Sera] replaces_rule_id expansion failed:', e)
      }
    }

    // ═══ ADIM 3b: FIXED_MEAL / NUTRITIONAL / ROTATION İÇİN YEMEK VARLIĞI DOĞRULAMASI ═══
    // Sera yemek adını halüsinasyon üretebiliyor. Motor artık toleranslı arıyor ama yine de
    // gerçek DB eşleşmesini burada garantiye al. Yoksa kullanıcıya uyarı olarak dön.
    const foodWarnings: { rule: string; missing: string[]; resolved: Array<{ input: string; matched: string; matchKind: string; food_id: string }> }[] = [];
    if (!isClarification) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const TR_FOLD: Record<string, string> = {
        'ç':'c','ğ':'g','ı':'i','i̇':'i','ö':'o','ş':'s','ü':'u','â':'a','î':'i','û':'u'
      };
      const normalize = (s: string) => String(s || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
      const fold = (s: string) => {
        let x = normalize(s).replace(/[çğıi̇öşüâîû]/g, ch => TR_FOLD[ch] ?? ch);
        x = x.normalize('NFD').replace(/[̀-ͯ]/g, '');
        return x.replace(/[().,;:!?'"`´\-_/\\]/g, ' ').replace(/\s+/g, ' ').trim();
      };

      const { data: allFoods } = await supabase.from('foods').select('id, name').limit(5000);
      const foodPool: { id: string; name: string; folded: string }[] = (allFoods || []).map(f => ({
        id: f.id, name: f.name, folded: fold(f.name)
      }));

      const resolveFoodRef = (input: string): { food_id: string; matched: string; kind: string } | null => {
        const s = String(input || '').trim();
        if (!s) return null;
        if (UUID_RE.test(s)) {
          const hit = foodPool.find(f => f.id === s);
          return hit ? { food_id: hit.id, matched: hit.name, kind: 'id' } : null;
        }
        const exact = foodPool.find(f => f.name === s);
        if (exact) return { food_id: exact.id, matched: exact.name, kind: 'exact' };
        const norm = normalize(s);
        const normHit = foodPool.find(f => normalize(f.name) === norm);
        if (normHit) return { food_id: normHit.id, matched: normHit.name, kind: 'normalized' };
        const folded = fold(s);
        if (!folded) return null;
        const foldHit = foodPool.find(f => f.folded === folded);
        if (foldHit) return { food_id: foldHit.id, matched: foldHit.name, kind: 'folded' };
        // Fuzzy: unique substring
        const candidates = foodPool.filter(f => f.folded && (f.folded.includes(folded) || folded.includes(f.folded)));
        if (candidates.length === 1) return { food_id: candidates[0].id, matched: candidates[0].name, kind: 'fuzzy' };
        if (candidates.length > 1) {
          const shortest = candidates.sort((a, b) => a.name.length - b.name.length)[0];
          return { food_id: shortest.id, matched: shortest.name, kind: 'fuzzy-ambiguous' };
        }
        return null;
      };

      // rewriteFoodArrayInPlace: array of strings — replace every entry with resolved food_id UUID.
      // Returns { missing: string[], resolved: Array<{input, matched, matchKind, food_id}> }
      const rewriteFoodArrayInPlace = (arr: unknown): { missing: string[]; resolved: any[] } => {
        const out = { missing: [] as string[], resolved: [] as any[] };
        if (!Array.isArray(arr)) return out;
        for (let i = 0; i < arr.length; i++) {
          const entry = arr[i];
          if (typeof entry !== 'string') continue;
          const res = resolveFoodRef(entry);
          if (res) {
            arr[i] = res.food_id;
            out.resolved.push({ input: entry, matched: res.matched, matchKind: res.kind, food_id: res.food_id });
          } else {
            out.missing.push(entry);
          }
        }
        return out;
      };

      const processRule = (rule: any, label: string) => {
        if (!rule || !rule.definition) return;
        const def = rule.definition;
        const summary = { rule: label, missing: [] as string[], resolved: [] as any[] };
        if (rule.rule_type === 'fixed_meal') {
          const r1 = rewriteFoodArrayInPlace(def.foods);
          summary.missing.push(...r1.missing);
          summary.resolved.push(...r1.resolved);
          if (def.day_assignments && typeof def.day_assignments === 'object') {
            for (const key of Object.keys(def.day_assignments)) {
              const r2 = rewriteFoodArrayInPlace(def.day_assignments[key]);
              summary.missing.push(...r2.missing);
              summary.resolved.push(...r2.resolved);
            }
          }
          // Stash human-readable food names on the definition so downstream renderers
          // (generateRuleSentence, UI badges) don't have to re-query the DB.
          if (Array.isArray(def.foods)) {
            const idToName = new Map(summary.resolved.map((r: any) => [r.food_id, r.matched]));
            def._food_labels = def.foods.map((id: string) => idToName.get(id) || id);
          }
        } else if (rule.rule_type === 'nutritional') {
          if (def.action && Array.isArray(def.action.foods)) {
            const r1 = rewriteFoodArrayInPlace(def.action.foods);
            summary.missing.push(...r1.missing);
            summary.resolved.push(...r1.resolved);
          }
        } else if (rule.rule_type === 'rotation') {
          if (Array.isArray(def.items)) {
            for (const item of def.items) {
              if (item && typeof item === 'object' && !item.food_id && item.food_name) {
                const res = resolveFoodRef(item.food_name);
                if (res) {
                  item.food_id = res.food_id;
                  item.food_name = res.matched;
                  summary.resolved.push({ input: item.food_name, matched: res.matched, matchKind: res.kind, food_id: res.food_id });
                } else {
                  summary.missing.push(item.food_name);
                }
              }
            }
          }
        }
        if (summary.missing.length > 0 || summary.resolved.some((r: any) => r.matchKind !== 'exact' && r.matchKind !== 'id')) {
          foodWarnings.push(summary);
        }
      };

      processRule({ rule_type: aiResponse.rule_type, definition: aiResponse.definition }, aiResponse.name || 'Ana kural');
      if (Array.isArray(aiResponse.additional_rules)) {
        for (const ar of aiResponse.additional_rules) {
          processRule({ rule_type: ar.rule_type, definition: ar.definition }, ar.name || 'Ek kural');
        }
      }
    }

    // ═══ ADIM 3c: BÜTÇE ETKİ SİMÜLASYONU (Karar Destek) ═══
    // Mevcut aktif kurallar + yeni kural(lar)ın günlük kalori tahmini.
    // Hastanın kalori hedefini aşıyorsa Sera uyarı gösterir.
    let budgetImpact: {
      dailyTarget: number
      existingRulesCal: number
      newRulesCal: number
      totalEstimatedCal: number
      overflowPercent: number
      overflowingRules: string[]
      recommendation: string | null
    } | null = null

    if (!isClarification && scope === 'patient' && patient_id) {
      try {
        const { data: patientRow } = await supabase
          .from('patients')
          .select('weight, activity_level, goals, diet_type')
          .eq('id', patient_id)
          .single()

        if (patientRow?.weight) {
          let dietTypeFactors: { carb_factor?: number; protein_factor?: number; fat_factor?: number } | undefined
          if (patientRow.diet_type) {
            const { data: dtRow } = await supabase
              .from('diet_types')
              .select('carb_factor, protein_factor, fat_factor')
              .eq('id', patientRow.diet_type)
              .single()
            if (dtRow) dietTypeFactors = dtRow as any
          }

          const actLevel = patientRow.activity_level || 3
          const userMultipliers: Record<number, number> = { 1: 0.8, 2: 0.9, 3: 1.0, 4: 1.1, 5: 1.2 }
          let multiplier = userMultipliers[actLevel] || 1.0
          const goals: string[] = Array.isArray(patientRow.goals) ? patientRow.goals : []
          if (goals.includes("Kilo Vermek") || goals.includes("Kilo Vermek (Yağ Yakımı)")) multiplier *= 0.9
          else if (goals.includes("Kilo Almak") || goals.includes("Kas Gelişimi (Hipertrofi)")) multiplier *= 1.1

          const factors = {
            carb: dietTypeFactors?.carb_factor ?? 3.0,
            protein: dietTypeFactors?.protein_factor ?? 1.0,
            fat: dietTypeFactors?.fat_factor ?? 0.8
          }
          const targetCarb = Math.round(patientRow.weight * factors.carb * multiplier)
          const targetProtein = Math.round(patientRow.weight * factors.protein * multiplier)
          const targetFat = Math.round(patientRow.weight * factors.fat * multiplier)
          const dailyTarget = Math.round((targetCarb * 4) + (targetProtein * 4) + (targetFat * 9))

          const { data: avgFoods } = await supabase
            .from('foods')
            .select('id, name, category, role, calories, tags')
            .limit(5000)
          const foodMap = new Map((avgFoods || []).map((f: any) => [f.id, f]))
          const categoryAvgCal = new Map<string, number>()
          const roleAvgCal = new Map<string, number>()
          const tagAvgCal = new Map<string, number>()

          for (const f of (avgFoods || [])) {
            const cal = f.calories || 0
            if (f.category) {
              const prev = categoryAvgCal.get(f.category)
              categoryAvgCal.set(f.category, prev !== undefined ? (prev + cal) / 2 : cal)
            }
            if (f.role) {
              const prev = roleAvgCal.get(f.role)
              roleAvgCal.set(f.role, prev !== undefined ? (prev + cal) / 2 : cal)
            }
            if (Array.isArray(f.tags)) {
              for (const t of f.tags) {
                const prev = tagAvgCal.get(t)
                tagAvgCal.set(t, prev !== undefined ? (prev + cal) / 2 : cal)
              }
            }
          }

          const estimateRuleDailyCal = (def: any): number => {
            if (!def || !def.target) return 0
            const minCount = def.min_count || 0
            if (minCount <= 0) return 0

            let avgCal = 150
            const target = def.target
            if (target.type === 'food_id' && target.value) {
              const f = foodMap.get(target.value)
              if (f) avgCal = f.calories || 150
            } else if (target.type === 'category' && target.value) {
              avgCal = categoryAvgCal.get(target.value) ?? 150
            } else if (target.type === 'role' && target.value) {
              avgCal = roleAvgCal.get(target.value) ?? 150
            } else if (target.type === 'tag' && target.value) {
              avgCal = tagAvgCal.get(target.value) ?? 150
            } else if (target.type === 'name_or_tag' && target.value) {
              avgCal = tagAvgCal.get(target.value) ?? categoryAvgCal.get(target.value) ?? 150
            }

            const period = def.period || 'daily'
            if (period === 'daily' || period === 'per_meal') {
              const numMeals = (def.scope_meals && def.scope_meals.length > 0) ? def.scope_meals.length : (period === 'per_meal' ? 3 : 1)
              return minCount * avgCal * (period === 'per_meal' ? numMeals : 1)
            } else if (period === 'weekly') {
              return (minCount * avgCal) / 7
            }
            return minCount * avgCal
          }

          let existingRulesCal = 0
          const replacedIds = new Set((aiResponse.definition?._replaced_ids || []) as string[])
          for (const rule of existingRules) {
            if (replacedIds.has(rule.id)) continue
            if (rule.rule_type !== 'frequency') continue
            const rDef = (rule.definition as any)?.data || rule.definition
            existingRulesCal += estimateRuleDailyCal(rDef)
          }

          let newRulesCal = 0
          const allNewRules = [
            { name: aiResponse.name, type: aiResponse.rule_type, def: aiResponse.definition },
            ...((aiResponse.additional_rules || []).map((ar: any) => ({ name: ar.name, type: ar.rule_type, def: ar.definition })))
          ]
          for (const nr of allNewRules) {
            if (nr.type !== 'frequency') continue
            newRulesCal += estimateRuleDailyCal(nr.def)
          }

          const totalEstimatedCal = existingRulesCal + newRulesCal
          const overflowPercent = dailyTarget > 0 ? Math.round(((totalEstimatedCal - dailyTarget) / dailyTarget) * 100) : 0

          const overflowingRules: string[] = []
          if (overflowPercent > 15) {
            const allRulesWithCost = [
              ...existingRules
                .filter((r: any) => r.rule_type === 'frequency' && !replacedIds.has(r.id))
                .map((r: any) => {
                  const rDef = (r.definition as any)?.data || r.definition
                  return { name: r.name, cal: estimateRuleDailyCal(rDef), priority: r.priority || 50 }
                }),
              ...allNewRules
                .filter(nr => nr.type === 'frequency')
                .map(nr => ({ name: nr.name, cal: estimateRuleDailyCal(nr.def), priority: (nr as any).priority || 50 }))
            ].sort((a, b) => a.priority - b.priority)

            let excess = totalEstimatedCal - dailyTarget
            for (const r of allRulesWithCost) {
              if (excess <= 0) break
              overflowingRules.push(r.name)
              excess -= r.cal
            }
          }

          let recommendation: string | null = null
          if (overflowPercent > 30) {
            recommendation = `Mevcut kurallarınızın tahmini günlük kalori etkisi (~${Math.round(totalEstimatedCal)} kcal) hedefinizin (${dailyTarget} kcal) çok üzerinde. Düşük öncelikli şu kurallar duraklatılabilir: ${overflowingRules.join(', ')}.`
          } else if (overflowPercent > 15) {
            recommendation = `Kurallarınız birlikte günlük kalori hedefinizi (~%${overflowPercent}) aşıyor. Motor bunu porsiyon küçültme ve kural erteleme ile dengelemeye çalışacak, ancak bazı kurallar her gün uygulanamayabilir.`
          }

          if (totalEstimatedCal > 0 && dailyTarget > 0) {
            budgetImpact = {
              dailyTarget,
              existingRulesCal: Math.round(existingRulesCal),
              newRulesCal: Math.round(newRulesCal),
              totalEstimatedCal: Math.round(totalEstimatedCal),
              overflowPercent,
              overflowingRules,
              recommendation
            }
          }
        }
      } catch (e) {
        console.warn('[Sera] Budget impact estimation failed:', e)
      }
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
      food_warnings: foodWarnings,
      duplicate_warnings: duplicateWarnings,
      engine_rule_count: existingRules.length,
      suggestions: Array.isArray(aiResponse.suggestions) ? aiResponse.suggestions : [],
      clarification_needed: aiResponse.clarification_needed || false,
      clarification_target: aiResponse.clarification_target || null,
      clarification_message: aiResponse.clarification_message || null,
      budget_impact: budgetImpact
    })

    // Skip original return
    /*
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

  */
  } catch (error: any) {
    console.error('[AI Rule Generator] Error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Bilinmeyen bir hata oluştu.' },
      { status: 500 }
    )
  }
}
 
// Force Turbopack to rebuild after syntax error
