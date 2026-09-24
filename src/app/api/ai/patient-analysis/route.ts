import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Initialize Supabase Admin Client (Lazy loaded via lib/supabase-admin)
// const supabaseAdmin = ... (Removed manual init)

const DAY_NAMES: Record<number, string> = {
    1: 'Pazartesi', 2: 'Salı', 3: 'Çarşamba', 4: 'Perşembe',
    5: 'Cuma', 6: 'Cumartesi', 7: 'Pazar'
};

// ==========================================
// CONFIGURABLE MODULES
// ==========================================

export type AnalysisModule =
    | 'demographics'
    | 'diseases'
    | 'medications'
    | 'lab_results'
    | 'measurements'
    | 'weekly_menu'
    | 'clinical_notes'
    | 'food_preferences';

export type ToneOption =
    | 'motivational'
    | 'realistic'
    | 'warning'
    | 'supportive'
    | 'goal_oriented';

export type LengthOption = 'short' | 'medium' | 'detailed';

const ALL_MODULES: AnalysisModule[] = [
    'demographics', 'diseases', 'medications', 'lab_results',
    'measurements', 'weekly_menu', 'clinical_notes', 'food_preferences'
];

const TONE_LABELS: Record<ToneOption, string> = {
    motivational: 'Motive edici, cesaretlendirici, pozitif bir dilde yaz. Hastanın gelişimini ön plana çıkar, başarılarını kutla.',
    realistic: 'Gerçekçi ve analitik bir dilde yaz. Verileri olduğu gibi sun, abartma ama durumu doğru yansıt.',
    warning: 'Uyarıcı ve ciddi bir dilde yaz. Riskleri net belirt, gerekli adımların aciliyetini vurgula.',
    supportive: 'Destekleyici ve empatik bir dilde yaz. Hastanın zorluklarını anla, yanında ol, "birlikte başaracağız" mesajı ver.',
    goal_oriented: 'Hedef odaklı yaz. Net hedefler koy, ilerleme adımlarını sırala, sonraki kontrol tarihine kadar yapılacakları listele.'
};

const LENGTH_INSTRUCTIONS: Record<LengthOption, string> = {
    short: 'KISA mesaj: Sadece en kritik 3-5 ana noktayı özetle. Her bölümde 1-2 cümle yeterli. Toplam çıktı kısa olsun.',
    medium: 'ORTA uzunlukta mesaj: Her bölümde 2-4 cümle. Önemli detayları dahil et ama çok uzatma.',
    detailed: 'DETAYLI mesaj: Her bölümde kapsamlı açıklama yap. Mekanizmaları, nedenleri, örnekleri detaylı anlat. Uzun ve zengin içerik üret.'
};


// ==========================================
// DATA COLLECTION FUNCTIONS
// ==========================================

async function collectPatientDemographics(patientId: string) {
    const { data } = await supabaseAdmin
        .from('patients')
        .select('full_name, birth_date, height, weight, gender, activity_level, liked_foods, disliked_foods')
        .eq('id', patientId)
        .single();

    if (!data) return { demographics: 'Veri bulunamadı', liked_disliked: 'Veri yok' };

    let age = 0;
    if (data.birth_date) {
        const birth = new Date(data.birth_date);
        age = new Date().getFullYear() - birth.getFullYear();
    }

    const bmi = data.height && data.weight
        ? (data.weight / ((data.height / 100) ** 2)).toFixed(1)
        : 'Hesaplanamadı';

    const activityLabels: Record<number, string> = {
        1: 'Hareketsiz', 2: 'Az hareketli', 3: 'Orta düzey aktif', 4: 'Aktif', 5: 'Çok aktif'
    };

    const demographics = `Ad: ${data.full_name}
Yaş: ${age || 'Bilinmiyor'}
Cinsiyet: ${data.gender === 'male' ? 'Erkek' : 'Kadın'}
Boy: ${data.height || '?'} cm
Kilo: ${data.weight || '?'} kg
BMI: ${bmi}
Aktivite Düzeyi: ${activityLabels[data.activity_level] || 'Bilinmiyor'}`;

    const liked = data.liked_foods?.length ? `Sevdiği: ${data.liked_foods.join(', ')}` : 'Sevdiği yiyecekler belirtilmemiş';
    const disliked = data.disliked_foods?.length ? `Sevmediği: ${data.disliked_foods.join(', ')}` : 'Sevmediği yiyecekler belirtilmemiş';

    return { demographics, liked_disliked: `${liked}\n${disliked}`, raw: data };
}

async function collectDiseases(patientId: string) {
    const { data } = await supabaseAdmin
        .from('patient_diseases')
        .select('disease_id, diseases(name)')
        .eq('patient_id', patientId);

    if (!data || data.length === 0) return { text: 'Tanımlı hastalık yok', names: [] };

    const names = data.map((d: any) => d.diseases?.name).filter(Boolean);
    return { text: names.join(', '), names };
}

async function collectMedications(patientId: string) {
    const { data } = await supabaseAdmin
        .from('patient_medications')
        .select('medication_name, medication_id, medications(name, generic_name)')
        .eq('patient_id', patientId)
        .is('ended_at', null);

    if (!data || data.length === 0) return { text: 'Aktif ilaç kullanımı yok', names: [] };

    const meds = data.map((m: any) => {
        const name = m.medications?.name || m.medication_name || 'Bilinmeyen';
        const generic = m.medications?.generic_name;
        return generic ? `${name} (${generic})` : name;
    });

    return { text: meds.join(', '), names: meds };
}

async function collectLabResults(patientId: string) {
    const { data } = await supabaseAdmin
        .from('patient_lab_results')
        .select('value, ref_min, ref_max, measured_at, micronutrient_id, micronutrients(name, unit, category)')
        .eq('patient_id', patientId)
        .order('measured_at', { ascending: false });

    if (!data || data.length === 0) return { text: 'Tahlil sonucu girilmemiş', items: [] };

    const grouped: Record<string, any[]> = {};
    data.forEach((r: any) => {
        const key = r.micronutrient_id;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
    });

    const lines: string[] = [];
    const items: any[] = [];

    Object.entries(grouped).forEach(([microId, results]) => {
        const latest = results[0];
        const micro = latest.micronutrients;
        if (!micro) return;

        let status = '✅ Normal';
        if (latest.ref_min !== null && latest.value < latest.ref_min) status = '⬇️ Düşük';
        if (latest.ref_max !== null && latest.value > latest.ref_max) status = '⬆️ Yüksek';

        let trend = '';
        if (results.length >= 2) {
            const prev = results[1].value;
            if (latest.value > prev) trend = '↑ Artış';
            else if (latest.value < prev) trend = '↓ Azalış';
            else trend = '→ Sabit';
        }

        // Show full history for deeper analysis
        let history = '';
        if (results.length >= 2) {
            const historyVals = results.slice(0, 5).map((r: any) =>
                `${r.value} (${new Date(r.measured_at).toLocaleDateString('tr-TR')})`
            ).join(' → ');
            history = ` | Geçmiş: ${historyVals}`;
        }

        const refRange = (latest.ref_min !== null || latest.ref_max !== null)
            ? ` (Ref: ${latest.ref_min ?? '?'}-${latest.ref_max ?? '?'})`
            : '';

        const line = `- ${micro.name}: ${latest.value} ${micro.unit || ''}${refRange} ${status} ${trend}${history}`.trim();
        lines.push(line);
        items.push({ name: micro.name, value: latest.value, unit: micro.unit, status, trend, category: micro.category });
    });

    return { text: lines.join('\n') || 'Tahlil sonucu girilmemiş', items };
}

async function collectMeasurements(patientId: string) {
    const { data: defs } = await supabaseAdmin
        .from('measurement_definitions')
        .select('*')
        .or(`patient_id.eq.${patientId},patient_id.is.null`)
        .eq('is_active', true)
        .order('sort_order');

    const { data: logs } = await supabaseAdmin
        .from('patient_measurements')
        .select('*')
        .eq('patient_id', patientId)
        .order('date', { ascending: false })
        .limit(30); // More data for trend analysis

    if (!logs || logs.length === 0 || !defs) return { text: 'Ölçüm verisi yok' };

    const lines: string[] = [];

    defs.forEach((def: any) => {
        const values = logs
            .filter((l: any) => l.values && l.values[def.id] !== undefined)
            .map((l: any) => ({ date: l.date, value: l.values[def.id] }))
            .slice(0, 10); // Last 10 entries

        if (values.length === 0) return;

        const latest = values[0];
        const first = values[values.length - 1]; // Earliest recorded value

        // Short-term trend (last 2)
        let shortTrend = '';
        if (values.length >= 2) {
            const diff = latest.value - values[1].value;
            shortTrend = diff > 0 ? `Son değişim: +${diff.toFixed(1)}` :
                diff < 0 ? `Son değişim: ${diff.toFixed(1)}` : 'Son değişim: yok';
        }

        // Long-term trend (from start)
        let longTrend = '';
        if (values.length >= 3) {
            const totalDiff = latest.value - first.value;
            longTrend = ` | Başlangıçtan (${first.date}): ${totalDiff > 0 ? '+' : ''}${totalDiff.toFixed(1)} ${def.unit}`;
        }

        // Stagnation detection (last 3+ values within ±1% of each other)
        let stagnation = '';
        if (values.length >= 3) {
            const recentVals = values.slice(0, 3).map(v => v.value);
            const avg = recentVals.reduce((a: number, b: number) => a + b, 0) / recentVals.length;
            const allClose = recentVals.every((v: number) => Math.abs(v - avg) / avg < 0.01);
            if (allClose) {
                stagnation = ' | ⚠️ PLATO: Son 3 ölçümde değişim yok!';
            }
        }

        // History list
        const historyStr = values.slice(0, 5).map(v =>
            `${v.value} ${def.unit} (${v.date})`
        ).join(' → ');

        lines.push(`- ${def.name}: ${latest.value} ${def.unit} (${latest.date}) | ${shortTrend}${longTrend}${stagnation}`);
        lines.push(`  Geçmiş: ${historyStr}`);
    });

    return { text: lines.join('\n') || 'Ölçüm verisi yok' };
}

async function collectDietType(patientId: string, weekId?: string) {
    if (weekId) {
        const { data: week } = await supabaseAdmin
            .from('diet_weeks')
            .select('week_number, assigned_diet_type_id, diet_types(name), diet_plan_id, diet_plans!diet_plan_id(title)')
            .eq('id', weekId)
            .maybeSingle();

        if (week) {
            const typeName = (week as any).diet_types?.name || 'Belirtilmemiş';
            const planTitle = (week as any).diet_plans?.title || '';
            const planLabel = planTitle ? `Program: ${planTitle} — ` : '';
            return { text: `${planLabel}Hafta ${week.week_number}: ${typeName}` };
        }
    }

    // Fallback: get from latest plan
    const { data: plans } = await supabaseAdmin
        .from('diet_plans')
        .select('id, title, status')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(5);

    const plan = plans?.find(p => p.status === 'active') || plans?.[0];
    if (!plan) return { text: 'Diyet planı yok' };

    const { data: week } = await supabaseAdmin
        .from('diet_weeks')
        .select('week_number, assigned_diet_type_id, diet_types(name)')
        .eq('diet_plan_id', plan.id)
        .order('week_number', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (!week) return { text: 'Diyet haftası bulunamadı' };

    const typeName = (week as any).diet_types?.name || 'Belirtilmemiş';
    const planTitle = plan.title || '';
    const planLabel = planTitle ? `Program: ${planTitle} — ` : '';

    return { text: `${planLabel}Hafta ${week.week_number}: ${typeName}` };
}

function parseTurkishDate(dateStr: string | null): number {
    if (!dateStr) return 0;

    // 1. Try ISO/Standard parse
    const timestamp = Date.parse(dateStr);
    if (!isNaN(timestamp) && dateStr.includes('-')) return timestamp; // Prefer ISO

    // 2. Try Turkish format "14 Şubat 2026"
    const trMonths: Record<string, string> = {
        'ocak': '01', 'şubat': '02', 'mart': '03', 'nisan': '04', 'mayıs': '05', 'haziran': '06',
        'temmuz': '07', 'ağustos': '08', 'eylül': '09', 'ekim': '10', 'kasım': '11', 'aralık': '12',
        'subat': '02', 'agustos': '08', 'eylul': '09', 'kasim': '11', 'aralik': '12'
    };

    try {
        const parts = dateStr.trim().split(/\s+/);
        if (parts.length >= 3) {
            const day = parts[0].replace(/\D/g, '').padStart(2, '0');
            const monthRaw = parts[1].toLowerCase();
            const year = parts[2].replace(/\D/g, '');

            const month = trMonths[monthRaw];
            if (month && day && year) {
                return Date.parse(`${year}-${month}-${day}`);
            }
        }
    } catch (e) {
        console.warn('Date parse error:', dateStr, e);
    }

    return 0; // fallback
}

async function collectClinicalNotes(patientId: string) {
    // patient_notes table: id, patient_id, note (text), note_date, dietitian_id, created_at
    // Fetch MORE records to handle mixed-format sorting issues (text vs date)
    const { data, error } = await supabaseAdmin
        .from('patient_notes')
        .select('note, note_date, created_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }) // Fallback sort by creation
        .limit(20);

    if (error) {
        console.error('[ClinicalNotes] Query error:', error);
        return { text: 'Klinik not sorgulanamadı' };
    }

    if (!data || data.length === 0) return { text: 'Klinik not girilmemiş' };

    // Sort by note_date (parsing Turkish formats if needed)
    const sortedNotes = data.sort((a: any, b: any) => {
        const dateA = parseTurkishDate(a.note_date || a.created_at);
        const dateB = parseTurkishDate(b.note_date || b.created_at);
        return dateB - dateA; // Descending
    });

    // Log for debugging
    console.log('[ClinicalNotes] Top 3 notes after sort:', sortedNotes.slice(0, 3).map((n: any) => ({
        date: n.note_date,
        parsed: parseTurkishDate(n.note_date),
        note: n.note?.substring(0, 20)
    })));

    const notes = sortedNotes.slice(0, 10).map((n: any) => {
        const dateStr = n.note_date || (n.created_at ? n.created_at.split('T')[0] : '?');
        return `[${dateStr}] 📋 Seyir Notu — ${n.note}`;
    });

    // Context hint: how old is the most recent note?
    const recentNote = data[0];
    const recentDate = recentNote.note_date || recentNote.created_at;
    const daysSinceLastNote = recentDate
        ? Math.floor((Date.now() - new Date(recentDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

    let contextHint = '';
    if (daysSinceLastNote > 14) {
        contextHint = `\n\n⚠️ Son klinik not ${daysSinceLastNote} gün önce yazılmış. Güncel seyir notu eksik olabilir.`;
    }

    return { text: notes.join('\n') + contextHint };
}


// ==========================================
// WEEKLY MENU COLLECTION
// ==========================================

async function collectWeeklyMenu(patientId: string, weekId?: string) {
    console.log('[WeeklyMenu] Called with patientId:', patientId, 'weekId:', weekId);
    let targetWeekId = weekId;

    if (!targetWeekId) {
        console.log('[WeeklyMenu] No weekId provided, looking for active plan...');
        // Try without status filter first (some plans may not have 'active' status)
        const { data: plans, error: planError } = await supabaseAdmin
            .from('diet_plans')
            .select('id, status')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: false })
            .limit(5);

        console.log('[WeeklyMenu] Plans found:', plans?.length, 'Error:', planError?.message, 'Statuses:', plans?.map(p => p.status));

        // Pick active plan, or first plan if none is active
        const plan = plans?.find(p => p.status === 'active') || plans?.[0];
        if (!plan) return { text: 'Haftalık menü bulunamadı (plan yok)', menuItems: [] };

        console.log('[WeeklyMenu] Using plan:', plan.id, 'status:', plan.status);

        const { data: week, error: weekError } = await supabaseAdmin
            .from('diet_weeks')
            .select('id, week_number')
            .eq('diet_plan_id', plan.id)
            .order('week_number', { ascending: false })
            .limit(1)
            .maybeSingle();

        console.log('[WeeklyMenu] Latest week:', week?.id, 'week_number:', week?.week_number, 'Error:', weekError?.message);

        if (!week) return { text: 'Haftalık menü bulunamadı (hafta yok)', menuItems: [] };
        targetWeekId = week.id;
    }

    console.log('[WeeklyMenu] Target weekId:', targetWeekId);

    const { data: days, error: daysError } = await supabaseAdmin
        .from('diet_days')
        .select('id, day_number')
        .eq('diet_week_id', targetWeekId)
        .order('day_number');

    console.log('[WeeklyMenu] Days found:', days?.length, 'Error:', daysError?.message);
    if (!days || days.length === 0) return { text: 'Bu haftada gün verisi yok', menuItems: [] };

    const dayIds = days.map(d => d.id);

    const { data: meals, error: mealsError } = await supabaseAdmin
        .from('diet_meals')
        .select('diet_day_id, meal_time, portion_multiplier, custom_name, is_custom, food_id, calories, protein, carbs, fat, foods!food_id(name, tags, calories, protein, carbs, fat)')
        .in('diet_day_id', dayIds)
        .order('meal_time');

    console.log('[WeeklyMenu] Meals found:', meals?.length, 'Error:', mealsError?.message);
    if (!meals || meals.length === 0) return { text: 'Bu haftada yemek verisi yok', menuItems: [] };

    const dayMap = new Map(days.map(d => [d.id, d.day_number]));
    const menuByDay: Record<number, Record<string, any[]>> = {};

    meals.forEach((meal: any) => {
        const dayNum = dayMap.get(meal.diet_day_id);
        if (!dayNum) return;

        if (!menuByDay[dayNum]) menuByDay[dayNum] = {};
        const mealSlot = meal.meal_time || 'DİĞER';
        if (!menuByDay[dayNum][mealSlot]) menuByDay[dayNum][mealSlot] = [];

        const food = meal.foods as any;
        const foodName = food?.name || meal.custom_name || 'Bilinmeyen';
        const tags = food?.tags?.length ? food.tags.join(', ') : '';
        const portion = meal.portion_multiplier && meal.portion_multiplier !== 1
            ? ` (x${meal.portion_multiplier})`
            : '';

        // Use snapshot macros from diet_meals if available, else from foods relation
        const cal = meal.calories || food?.calories || 0;
        const pro = meal.protein || food?.protein || 0;
        const carb = meal.carbs || food?.carbs || 0;
        const fat = meal.fat || food?.fat || 0;

        menuByDay[dayNum][mealSlot].push({
            name: foodName,
            tags,
            portion,
            calories: cal,
            protein: pro,
            carbs: carb,
            fat: fat,
        });
    });

    const lines: string[] = [];
    const allItems: any[] = [];

    const sortedDays = Object.keys(menuByDay).map(Number).sort();
    for (const dayNum of sortedDays) {
        const dayName = DAY_NAMES[dayNum] || `Gün ${dayNum}`;
        lines.push(`\n📅 ${dayName}:`);

        const mealTypes = menuByDay[dayNum];
        let dayCalories = 0, dayProtein = 0, dayCarbs = 0, dayFat = 0;

        for (const [mealType, foods] of Object.entries(mealTypes)) {
            lines.push(`  🍽️ ${mealType}:`);
            foods.forEach((f: any) => {
                const tagStr = f.tags ? ` [Etiketler: ${f.tags}]` : '';
                const portionStr = f.portion || '';
                const macros = `${Math.round(f.calories)} kcal, P:${f.protein?.toFixed(1) || 0}g, K:${f.carbs?.toFixed(1) || 0}g, Y:${f.fat?.toFixed(1) || 0}g`;
                lines.push(`    - ${f.name}${portionStr} → ${macros}${tagStr}`);

                dayCalories += f.calories || 0;
                dayProtein += f.protein || 0;
                dayCarbs += f.carbs || 0;
                dayFat += f.fat || 0;

                allItems.push({
                    day: dayName,
                    meal_slot: mealType,
                    food: f.name,
                    tags: f.tags,
                    portion: f.portion,
                    calories: f.calories,
                    protein: f.protein,
                    carbs: f.carbs,
                    fat: f.fat
                });
            });
        }

        // Daily totals
        lines.push(`  📊 Günlük Toplam: ${Math.round(dayCalories)} kcal, P:${dayProtein.toFixed(1)}g, K:${dayCarbs.toFixed(1)}g, Y:${dayFat.toFixed(1)}g`);
    }

    return {
        text: lines.join('\n') || 'Menü verisi yok',
        menuItems: allItems
    };
}


// ==========================================
// PROMPT BUILDER (MODULAR)
// ==========================================

function buildPrompt(
    data: Record<string, string>,
    modules: AnalysisModule[],
    audience: 'doctor' | 'patient',
    tones: ToneOption[],
    length: LengthOption
) {
    // Header
    let prompt = `Sen deneyimli bir Klinik Beslenme Uzmanı, İç Hastalıkları Uzmanı ve Klinik Farmakoloji danışmanısın.
Ayrıca biyokimya, mikro besin metabolizması, ilaç-besin etkileşim mekanizmaları ve hastalık patofizyolojisi konularında derin bilgi sahibisin.

Aşağıdaki hasta verilerini dikkatlice analiz et ve kapsamlı bir değerlendirme raporu oluştur.

## HASTA VERİLERİ:\n\n`;

    // Add only selected modules
    const sectionMap: Record<AnalysisModule, { title: string; key: string }> = {
        demographics: { title: 'Demografik Bilgiler', key: 'demographics' },
        diseases: { title: 'Hastalıklar', key: 'diseases' },
        medications: { title: 'Kullandığı İlaçlar', key: 'medications' },
        lab_results: { title: 'Tahlil Sonuçları (Son Değerler + Trend + Geçmiş)', key: 'lab_results' },
        measurements: { title: 'Vücut Ölçümleri (Trend + Başlangıçtan Değişim + Stagnasyon)', key: 'measurements' },
        weekly_menu: { title: 'Bu Haftanın Menüsü (Günlük Yemek Programı + Makrolar)', key: 'weekly_menu' },
        clinical_notes: { title: 'Klinik Notlar / Seyir (Son Notlar)', key: 'clinical_notes' },
        food_preferences: { title: 'Besin Tercihleri', key: 'food_preferences' },
    };

    for (const mod of modules) {
        const section = sectionMap[mod];
        if (section && data[section.key]) {
            prompt += `### ${section.title}:\n${data[section.key]}\n\n`;
        }
    }

    // Diet type (always include if available)
    if (data.diet_type) {
        prompt += `### Uygulanan Diyet Türü:\n${data.diet_type}\n\n`;
    }

    // Audience + Instructions
    prompt += `## HEDEF KİTLE: ${audience === 'patient' ? 'HASTA' : 'DOKTOR / DİYETİSYEN'}\n\n`;

    if (audience === 'doctor') {
        prompt += buildDoctorInstructions(modules);
    } else {
        prompt += buildPatientInstructions(modules, tones, length);
    }

    // JSON Schema
    prompt += buildJsonSchema(modules);

    return prompt;
}

function buildDoctorInstructions(modules: AnalysisModule[]): string {
    let instructions = `## GÖREV — KLİNİK ANALİZ (Doktor/Diyetisyen İçin)

Klinik ve teknik dil kullan. Her maddede sadece "ne" değil, "neden" ve "nasıl" açıkla.

### ÇOK ÖNEMLİ — ÇAPRAZ REFERANSLAMA KURALLARI:
1. **Hastanın GERÇEK verilerine atıf yap**: Her ilaç etkileşimi, besin ilişkisi veya risk analizi yaparken, hastanın MEVCUT tahlil değerlerini mutlaka kontrol et ve sonucu belirt.
   - YANLIŞ: "Kandesartan potasyum tutulumuna neden olabilir, hiperkalemi riski var"
   - DOĞRU: "Kandesartan potasyum tutulumuna neden olabilir. Ancak hastanın mevcut potasyum değeri 4.2 mEq/L ile normal aralıkta. Yine de düzenli takip önerilir."
   - DOĞRU: "Metformin B12 emilimini azaltır. Hastanın B12 değeri 180 pg/mL ile düşük — bu Metformin kaynaklı olabilir."
2. **Mekanizma Derinliği**: Biyokimyasal yolakları, enzim sistemlerini (CYP450, COX, LOX vb.), reseptör etkileşimlerini belirt.
3. **Neden-Sonuç Zinciri**: Veriler arası çapraz ilişkileri kur.
4. **Risk Sınıflandırması**: Evidence-based "high/medium/low" derecelendirme.
5. **Seyir notları bağlantısı**: Klinik notlarda yazılan her tespiti (kabızlık, halsizlik, iştahsızlık vb.) ilaçlar, tahliller ve menü ile çapraz referansla.
6. **Menü bazlı yorumlama**: Bu haftanın menüsündeki spesifik yemekleri isimleriyle an ve hastanın parametreleriyle ilişkilendir.\n\n`;

    if (modules.includes('medications')) {
        instructions += `### İlaç-Besin Etkileşimleri:
- Farmakokinetik (ADME) ve farmakodinamik düzeyde analiz et
- Hangi CYP enzimleri etkileniyor, metabolit düzeylerinde değişim var mı?
- ⚠️ ZORUNLU: Etkileşim bildirirken hastanın o parametreye ait GERÇEK tahlil değerini belirt. Değer normal mi, düşük mü, yüksek mi? Bu bilgiyi mutlaka ekle.\n\n`;
    }

    if (modules.includes('lab_results')) {
        instructions += `### Tahlil Yorumlama:
- Düşüklüğün/yüksekliğin metabolik nedenini açıkla (ilaç etkisi, beslenme yetersizliği, hastalık vs.)
- Hangi organlara etki edebileceğini belirt
- Diğer parametrelerle korelasyon analizi yap
- Trend (iyileşiyor mu, kötüleşiyor mu) değerlendir
- ⚠️ ZORUNLU: İlaçlarla olan bağlantıyı mutlaka belirt. Ör: B12 düşükse ve Metformin kullanıyorsa "Bu düşüklük Metformin'in ileal B12 emilimini azaltmasından kaynaklanıyor olabilir" de.\n\n`;
    }

    if (modules.includes('measurements')) {
        instructions += `### Vücut Ölçüm Analizi:
- Başlangıçtan itibaren değişim trendini değerlendir
- Plato (stagnasyon) varsa nedenlerini analiz et (metabolik adaptasyon, kalori dengesi, hormonal faktörler)
- Bölgesel değişimleri yorumla (bel çevresi azalıp kilo sabitse kas kütlesi artışı vs.)
- Diyet türü uyumluluğu bağlamında ölçüm değişimlerini değerlendir\n\n`;
    }

    if (modules.includes('weekly_menu')) {
        instructions += `### Menü Analizi ve Eleştirisi (KRİTİK BÖLÜM):
- ⚠️ ZORUNLU FORMAT: "Güçlü Yönler (Olumlu)" ve "Zayıf Yönler / Riskler (Eleştirel)" başlıkları altında detaylı incele.
- **GÜÇLÜ YÖNLER (+)**: Menünün hastanın hastalıklarına/tahlillerine en iyi gelen yönlerini BİYOKİMYASAL mekanizmalarıyla açıkla.
  Ör: "Haftada 3 kez balık eklenmiş olması, hastanın yüksek trigliserid seviyesi için mükemmel. EPA/DHA anti-inflamatuar etki göstererek..."
- **ZAYIF YÖNLER / RİSKLER (-)**: Gözden kaçmış olabilecek riskleri net ve sert bir dille eleştir.
  Ör: "Salı akşamı verilen pirinç pilavı, hastanın diyabet geçmişi ve insülin direnci (HOMA-IR: 4.2) düşünüldüğünde ciddi bir hatadır. Kan şekerinde ani spike riski yaratır."
- **REVİZYON ÖNERİLERİ (Takaslar)**: Spesifik iyileştirme önerileri sun.
  Ör: "Çarşamba öğlen yemeğindeki patates püresi yerine karnabahar püresi, glisemik yükü düşürecektir."
- **EKSİK TESPİTİ**: Menüde eksik kalan önemli bir besin öğesi var mı? (Ör: "Yeterli kalsiyum kaynağı yok.")\n\n`;
    }

    if (modules.includes('clinical_notes')) {
        instructions += `### Klinik Not / Seyir Analizi:
- ⚠️ ZORUNLU: Seyir notlarındaki şikayetler (kabızlık, şişkinlik, halsizlik vb.) ile menüdeki yemekler arasında bağlantı kur.
- Eleştirel ol: "Hasta kabızlık şikayeti varken menüde yeterince lif kaynağı (kurubaklagil, sebze) yok." gibi uyarılar yap.
- İlaç yan etkileri ile menü etkileşimini kontrol et.\n\n`;
    }

    if (modules.includes('medications') || modules.includes('lab_results')) {
        instructions += `### Takviye Önerileri:
- Biyoyararlanım, emilimi artıran/azaltan faktörler, form önerileri (sitrat vs oksit vs khelat)
- İlaç etkileşim pencereleri (kaç saat arayla alınmalı) belirt\n\n`;
    }

    return instructions;
}

function buildPatientInstructions(modules: AnalysisModule[], tones: ToneOption[], length: LengthOption): string {
    let instructions = `## GÖREV — HASTA BİLGİLENDİRME (Sade Dil)

Hastanın anlayacağı düzeyde, Türkçe, sade ve anlaşılır dilde yaz. Teknik terimlerden kaçın.

### ÇOK ÖNEMLİ — KİŞİSELLEŞTİRME KURALLARI:
- ⚠️ JENERİK OLMA! Hastanın GERÇEK verilerine atıf yap.
- Tahlil sonuçlarını direkt belirt: "B12 değeriniz düşük çıktı, bu nedenle listenize..." 
- Ölçüm değişimlerini belirt: "Son ölçümde kilosu X'den Y'ye düştü, bu harika bir gelişme!"
- Klinik notlardaki tespitleri adresle: "Geçen kontrolde kabızlık şikayetiniz vardı, bu nedenle..."
- Menüdeki spesifik yemeklerin İSMİNİ kullan, genel konuşma.\n\n`;

    // Apply tone instructions
    if (tones.length > 0) {
        instructions += `### Mesaj Tonlaması:\nAşağıdaki tonlamaları birlikte uygula:\n`;
        tones.forEach(tone => {
            instructions += `- ${TONE_LABELS[tone]}\n`;
        });
        instructions += '\n';
    }

    // Apply length instruction
    instructions += `### Mesaj Uzunluğu:\n${LENGTH_INSTRUCTIONS[length]}\n\n`;

    instructions += `### Genel Kurallar:\n`;

    if (modules.includes('weekly_menu')) {
        instructions += `1. **Haftalık Beslenme Değerlendirmesi**:
   - ⚠️ ASLA "Pazartesi şunu ye, Salı bunu ye" diye GÜN GÜN LİSTE YAPMA.
   - **KONU BAZLI GRUPLA**: "Detoks Etkisi", "Enerji Dengesi", "Kas Onarımı", "Ödem Atımı" gibi başlıklar altında topla.
   - **BİYOKİMYASAL MEKANİZMA ANLAT**: Besinlerin vücutta ne yaptığını (sülfürlü bileşikler, hücre zarı, mitokondri vb.) sade dille açıkla.
   
   ⚠️ İŞTE ÖRNEK ALMAN GEREKEN FORMATLAR (Buna benzer yaz):
   
   **ÖRNEK 1 (Detoks ve Ödem):**
   "Menünüzde yer alan kıymalı lahana, brokoli ve turp gibi besinler, içerdikleri sülfürlü bileşikler sayesinde vücudun doğal detoks mekanizmasını çalıştırır. Ceviz ve zeytin gibi sağlıklı yağlar ise hücre zarlarını koruyarak inflamasyonu baskılar. Ara öğünlerdeki maden suyu ve limon, hücre içi sıvı dengesini koruyarak ödem atımını kolaylaştıracaktır."

   **ÖRNEK 2 (Enerji ve Yağ Yakımı):**
   "Menüye eklediğimiz tahin, ceviz ve zeytinyağı, lipödem yönetiminde tokluk sürenizi uzatırken enerji dengesini sağlar. Roka ve maydanoz gibi yeşillikleri limonla tüketmeniz lenfatik akışı hızlandırır. Akşam öğünlerindeki hindi ve balık ise kas kütlenizi koruyarak yağ yakımını desteklemek için planlandı."

   **ÖRNEK 3 (Kas ve Magnezyum):**
   "Listenizdeki kabak çekirdeği ve badem, magnezyum açısından zengindir; bu da kaslarınızı rahatlatır ve krampları önler. Ayrıca karnabahar ve lahana gibi kükürtlü sebzeler, karaciğerin toksin atım kapasitesini artırarak sürece destek olur."

   - Sen de yukarıdaki örnekler gibi, haftalık menüden CİMBİZLA seçtiğin yemekleri, hastanın hedefleriyle (kilo verme, kas yapma, hastalık yönetimi) birleştirerek bir hikaye gibi anlat.\n\n`;
    }

    if (modules.includes('medications')) {
        instructions += `2. **İlaç ve Besin Uyumu**:
   - Uyarıları korkutmadan yap. "X ilacını kullandığınız için Y yemeğinden biraz uzak durmanızı veya porsiyonu küçültmenizi öneririm" gibi yapıcı ol.
   - Olumlu etkileşimleri vurgula: "Bu ilacın emilimini artırmak için menüye C vitamini açısından zengin X ekledik."\n\n`;
    }

    if (modules.includes('clinical_notes')) {
        instructions += `3. **Şikayetlerinize Yönelik Çözümler**:
   - Hastanın belirttiği şikayetler (örn: halsizlik, şişkinlik) ile menüdeki çözümleri eşleştir.
   - "Geçen görüşmemizde bahsettiğiniz halsizlik için bu hafta menüye demir deposu olan X yemeğini ekledik." şeklinde kişisel bağ kur.\n\n`;
    }

    if (modules.includes('measurements')) {
        instructions += `4. **Ölçüm Değerlendirmesi**: Kilo, bel çevresi gibi ölçümlerdeki değişimi sade dilde açıkla. Plato varsa "Endişelenmeyin, bu normal bir süreçtir" gibi destekleyici mesaj ver.
`;
    }

    instructions += `5. **Dikkat Edilecekler**: Menüdeki bazı yemekleri yerken nelere dikkat etmesi gerektiğini sevecen ama net bir dille belirt.
6. **Pratik İpuçları**: Pişirme yöntemleri, porsiyon önerileri, tüketim zamanlamaları gibi günlük hayata uygulanabilir öneriler ver.
7. **Tahlil Yorumu**: Tahlil sonuçlarını hasta anlayacağı düzeyde ve kaygı yaratmadan açıkla.\n\n`;

    return instructions;
}

function buildJsonSchema(modules: AnalysisModule[]): string {
    let schema = `\nYanıtını aşağıdaki JSON şemasına uygun olarak ver:\n\n{\n  "summary": "Genel değerlendirme özeti (3-5 cümle)",\n`;

    schema += `  "risk_factors": [
    { "title": "Risk başlığı", "severity": "high|medium|low", "details": "Detaylı açıklama", "mechanism": "Patofizyolojik mekanizma" }
  ],\n`;

    if (modules.includes('medications')) {
        schema += `  "drug_interactions": [
    { "drug1": "İlaç 1", "drug2": "İlaç 2 veya besin/hastalık", "interaction": "Etkileşim açıklaması", "mechanism": "Farmakokinetik/farmakodinamik mekanizma", "severity": "high|medium|low", "recommendation": "Klinik öneri" }
  ],\n`;
    }

    if (modules.includes('lab_results') || modules.includes('diseases')) {
        schema += `  "nutrient_disease_links": [
    { "nutrient": "Besin/Mikrobesin", "disease": "Hastalık", "relationship": "İlişki", "mechanism": "Biyokimyasal mekanizma", "recommendation": "Diyet önerisi" }
  ],\n`;
    }

    schema += `  "diet_warnings": [
    { "warning": "Uyarı", "reason": "Neden", "mechanism": "Fizyolojik mekanizma", "suggestion": "Öneri" }
  ],\n`;

    schema += `  "supplement_recommendations": [
    { "supplement": "Takviye", "reason": "Eksiklik/gerekçe", "mechanism": "Emilim/metabolizma mekanizması", "dosage_note": "Doz ve form önerisi", "timing": "Zamanlama" }
  ],\n`;

    schema += `  "nutrition_advice": [
    { "food_group": "Besin grubu", "advice": "Öneri", "reason": "Neden", "mechanism": "Biyokimyasal fayda mekanizması" }
  ],\n`;

    schema += `  "symptoms_to_watch": [
    { "symptom": "Belirti", "possible_cause": "Olası neden", "mechanism": "Fizyolojik mekanizma", "action": "Yapılacak" }
  ],\n`;

    schema += `  "additional_tests": [
    { "test": "Test adı", "reason": "Neden önerildiği", "expected_insight": "Sonucun ne göstereceği" }
  ],\n`;

    if (modules.includes('weekly_menu')) {
        schema += `  "menu_analysis": [
    { "day": "Gün adı", "meal_type": "Öğün", "food": "Yemek adı", "positive_effects": "Bu yemeğin hastanın durumu için faydaları", "concerns": "Dikkat edilmesi gerekenler (varsa)", "mechanism": "Biyolojik etki mekanizması" }
  ],\n`;
    }

    if (modules.includes('measurements')) {
        schema += `  "measurement_analysis": {
    "trend_summary": "Ölçüm değişim trendi özeti (başlangıçtan şimdiye)",
    "stagnation_notes": "Plato tespiti ve olası nedenler (varsa)",
    "regional_changes": "Bölgesel değişimler ve yorumlar (bel, kalça, kol vs.)",
    "recommendations": "Ölçüm trendine göre diyet/egzersiz önerileri"
  },\n`;
    }

    if (modules.includes('clinical_notes')) {
        schema += `  "clinical_note_analysis": [
    { "note_date": "Not tarihi", "note_content": "Notun özeti", "cross_references": "İlaç/tahlil/menü ile bağlantılar", "recommendation": "Bu nota istinaden öneri" }
  ],\n`;
    }

    schema += `  "overall_recommendations": "Genel öneriler paragrafı"\n}\n\nMarkdown kod bloğu kullanma. Sadece ham JSON döndür.`;

    return schema;
}


// ==========================================
// MAIN API HANDLER
// ==========================================

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            patientId,
            audience = 'doctor',
            weekId,
            modules = ALL_MODULES,
            tones = ['motivational', 'supportive'],
            length = 'medium'
        } = body;

        console.log('[Patient Analysis] Request body:', { patientId, audience, weekId, modules: modules?.length, tones, length });

        if (!patientId) {
            return NextResponse.json({ error: 'Patient ID is required' }, { status: 400 });
        }

        if (!genAI) {
            return NextResponse.json({ error: 'Gemini API not configured (GEMINI_API_KEY missing)' }, { status: 503 });
        }

        // 1. Collect ALL patient data in parallel
        const [demographics, diseases, medications, labs, measurements, dietType, clinicalNotes, weeklyMenu] = await Promise.all([
            collectPatientDemographics(patientId),
            collectDiseases(patientId),
            collectMedications(patientId),
            collectLabResults(patientId),
            collectMeasurements(patientId),
            collectDietType(patientId, weekId),
            collectClinicalNotes(patientId),
            collectWeeklyMenu(patientId, weekId),
        ]);

        // 2. Build data map
        const dataMap: Record<string, string> = {
            demographics: demographics.demographics,
            diseases: diseases.text,
            medications: medications.text,
            lab_results: labs.text,
            measurements: measurements.text,
            diet_type: dietType.text,
            clinical_notes: clinicalNotes.text,
            food_preferences: demographics.liked_disliked,
            weekly_menu: weeklyMenu.text,
        };

        // 3. Build modular prompt (NO DB prompt - always use code-built prompt)
        const modelName = 'gemini-2.5-flash';
        const prompt = buildPrompt(dataMap, modules as AnalysisModule[], audience, tones as ToneOption[], length as LengthOption);

        // 4. Build input_snapshot for storage
        const inputSnapshot = {
            demographics: demographics.raw,
            diseases: diseases.names,
            medications: medications.names,
            lab_items: labs.items,
            diet_type: dietType.text,
            weekly_menu: weeklyMenu.menuItems,
            audience,
            week_id: weekId || null,
            modules,
            tones: audience === 'patient' ? tones : undefined,
            length: audience === 'patient' ? length : undefined,
            generated_at: new Date().toISOString()
        };

        console.log('[Patient Analysis] Prompt length:', prompt.length, 'Model:', modelName, 'Modules:', modules.length, 'Menu items:', weeklyMenu.menuItems?.length || 0);

        // 5. Call Gemini
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 6. Parse JSON response
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const match = text.match(jsonBlockRegex);
        let jsonString = match ? match[1] : text;
        jsonString = jsonString.trim();
        if (jsonString.startsWith('```')) {
            jsonString = jsonString.replace(/^```(json)?/, '').replace(/```$/, '');
        }

        let reportContent;
        try {
            reportContent = JSON.parse(jsonString);
        } catch (e) {
            console.error('[Patient Analysis] JSON parse failed. Raw:', text);
            reportContent = {
                summary: 'AI yanıtı JSON formatında ayrıştırılamadı. Ham yanıt aşağıda.',
                raw_text: text,
                risk_factors: [],
                drug_interactions: [],
                nutrient_disease_links: [],
                diet_warnings: [],
                supplement_recommendations: [],
                nutrition_advice: [],
                symptoms_to_watch: [],
                additional_tests: [],
                menu_analysis: [],
                measurement_analysis: null,
                clinical_note_analysis: [],
                overall_recommendations: ''
            };
        }

        // 7. Save report to DB
        const title = audience === 'patient'
            ? `Hasta Bilgilendirme Raporu - ${new Date().toLocaleDateString('tr-TR')}`
            : `Klinik Analiz Raporu - ${new Date().toLocaleDateString('tr-TR')}`;

        const { data: savedReport, error: saveError } = await supabaseAdmin
            .from('patient_ai_reports')
            .insert({
                patient_id: patientId,
                report_type: 'comprehensive',
                audience,
                title,
                content: reportContent,
                raw_response: text,
                input_snapshot: inputSnapshot,
                model_used: modelName,
                prompt_version: 'code_v2',
                created_by: 'dietitian'
            })
            .select()
            .single();

        if (saveError) {
            console.error('[Patient Analysis] Save error:', saveError);
            return NextResponse.json({
                report: reportContent,
                title,
                saved: false,
                error: saveError.message
            });
        }

        return NextResponse.json({
            report: reportContent,
            title,
            reportId: savedReport.id,
            saved: true,
            model: modelName
        });

    } catch (error: any) {
        console.error('[Patient Analysis] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}


// GET: Fetch past reports for a patient
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get('patientId');

    if (!patientId) {
        return NextResponse.json({ error: 'patientId required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from('patient_ai_reports')
        .select('id, title, audience, report_type, created_at, model_used')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reports: data || [] });
}
