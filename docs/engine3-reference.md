# Engine3 Teknik Referans (v2026-09)

Bu doküman **engine3** kural motorunun tam karar mekanizmasını, veri modelini ve tipik bug pattern'lerini içerir. Bir AI'ya sorulduğunda "engine3 X vermiyor / Y kuralı çalışmıyor" gibi bir teşhis yapabilecek şekilde tasarlandı. Fonksiyon isimleri, değişken adları, hat referansları içerir.

**Ana dosya**: [`src/lib/planner/engine3.ts`](../src/lib/planner/engine3.ts) (~7100 satır, `Planner` sınıfı).

---

## 1. Veri Modeli

### DB tabloları

| Tablo | Anahtar sütunlar | Amaç |
|---|---|---|
| `patients` | `id`, `program_template_id`, `diet_type`, `preferences` | Hasta profili |
| `patient_assignments` | `patient_id`, `dietitian_id` | Diyetisyen bağı (Sera onay akışını etkiler) |
| `planning_rules` | `id`, `name`, `rule_type`, `scope`, `patient_id`, `program_template_id`, `team_owner_id`, `source_rule_id`, `priority`, `is_active`, `definition (jsonb)`, `sort_order` | Kural deposu |
| `planner_settings` | `scope`, `slot_config`, `slot_configs`, `portion_settings`, `food_score_overrides`, `exempt_tags`, `variety_mode` | Slot yapısı, porsiyon ayarları, makro toleransları |
| `foods` | `id`, `name`, `category`, `role`, `tags[]`, `meal_types[]`, `calories`, `protein`, `carbs`, `fat`, `min_quantity`, `step`, `portion_fixed` | Yemek DB |
| `diet_plans` | `id`, `patient_id`, `title`, `status`, `start_date`, `created_at` | Hasta haftalık plan konteyneri |
| `diet_weeks` | `diet_plan_id`, `week_number`, `assigned_diet_type_id` | Plan hafta→faz eşlemesi |
| `program_templates` | `id`, `name`, `description` | Program şablonu (Lipödem, Sporcu vs.) |
| `program_template_weeks` | `program_template_id`, `week_start`, `week_end`, `diet_type_id` | Şablon hafta aralıkları |
| `diet_types` | `id`, `name`, `banned_keywords[]`, `banned_tags[]`, `banned_details (jsonb)`, `carb_factor`, `protein_factor`, `fat_factor` | Diyet fazı tanımı |

### Rule scope hiyerarşisi (zayıftan güçlüye)

```
global  <  team  <  program  <  patient
```

`fetchRules()` [engine3.ts:499](../src/lib/planner/engine3.ts:499) ile tüm scope'lardan çekilir; `source_rule_id || id` anahtarıyla merge edilir → alt katman üstü ezer. `is_active: false` veya `definition._is_deleted: true` filtrelenir.

`_replaced_ids` (definition içindeki array): Sera veya API `targetsOverlap` ile bulunan çakışan tüm kuralların id'lerini bu diziye koyar. Kural kaydedildiğinde ilgili UI (patient-rules-dialog.tsx, sera-assistant.tsx) bu ID'leri pause eder veya patient tombstone yaratır.

---

## 2. Kural Tipleri ve Şemaları

Tümü `planning_rules.definition = { type: <rule_type>, data: {...} }` yapısında.

### 2.1 `frequency`
Bir hedefin belirli periyotta kaç kez görüneceğini kontrol eder.
```jsonc
{
  "target": { "type": "food_id|category|role|tag|name_contains|name_or_tag|ingredient", "value": "peynir", "synonyms": ["kaşar", "lor"] },
  "min_count": 1, "max_count": 1,
  "period": "daily|weekly|per_meal",
  "scope_meals": ["ÖĞLEN", "AKŞAM"],
  "scope_days": [1, 2],      // 1=Pzt, 7=Pzr
  "scope_weeks": { "mode": "specific|repeating|all", "weeks": [3,4], "every": 2, "starting_week": 3 },
  "random_day_count": 3,     // Belirtilmezse period=weekly için implicit max_count
  "force_inclusion": true,   // Kalori bütçesini aş
  "exclusive_scope": true,   // Kapsam dışı zamanlarda tamamen yasakla
  "daily_max_limit": 1,      // Bir günde en fazla N öğüne yayıl (Örn: iki ana öğünde aynı meyve verme)
  "per_meal_limit": 1,       // weekly + per_meal_limit birleşimi
  "_bypass_meal_types": true // Sera kullanıcı ısrarında ekler; meal_types HARD constraint atlanır
}
```

### 2.2 `affinity`
İki hedefin aynı slotta bir arada bulunması/yasaklanması.
```jsonc
{
  "trigger": { "type": "...", "value": "..." },
  "outcome": { "type": "...", "value": "..." },
  "association": "mandatory|forbidden|boost|reduce",
  "probability": 0-100,      // 0=yasak, 50=nötr, 100=zorunlu
  "direction": "one-way|two-way"
}
```

### 2.3 `consistency`
Bir kategori/rolde seçilen ilk yemek süre boyunca sabit kalır.
```jsonc
{
  "target": { "type": "category|role|tag", "value": "..." },
  "lock_duration": "daily|weekly",
  "scope_meals": [...], "scope_days": [...]
}
```

### 2.4 `fixed_meal`
Belirli yemekleri belirli slota basar. **Her şeyden önce çalışır**.
```jsonc
{
  "target_slot": "AKŞAM",
  "foods": ["food_id_uuid_1"],   // Motor UUID → exact name → normalize → fold → fuzzy sırasıyla arar
  "_food_labels": ["Domates çorbası"],  // API tarafında insan-okunur özet stash edilir
  "selection_mode": "all|random|rotate|by_day",
  "count": 1,
  "day_assignments": { "1": [...], "2": [...] },
  "scope_days": [2],
  "scope_weeks": {...}
}
```

### 2.5 `nutritional`
Makro açığı olduğunda post-fill yapar.
```jsonc
{
  "condition": { "macro": "protein|fat|carbs|calories", "operator": "<|>", "value": 6 },
  "action": { "type": "add", "foods": ["food_id"], "selection_mode": "single|rotate" },
  "target_slot": "AKŞAM"
}
```

### 2.6 `rotation`
Bir kategoride yemekleri haftadan haftaya döndürür.
```jsonc
{
  "target": { "type": "role|category|tag", "value": "ÇORBALAR" },
  "mode": "sequential|random_no_repeat",
  "non_consecutive": true,
  "items": [{ "food_id": "...", "food_name": "...", "repeat_count": 1 }]
}
```

### 2.7 `or_group`
Frequency alternatiflerini haftalık nöbete sokar.
```jsonc
{
  "mode": "weekly_rotation",
  "options": [ FrequencyDefinition, FrequencyDefinition, ... ]
}
```

### 2.8 `update_meal_settings`
Slot yapısını değiştirir. Yemek EKLEMEZ.
```jsonc
{
  "slots": [
    { "name": "1. ARA ÖĞÜN", "action": "add_or_update|delete", "min_items": 1, "max_items": 3 }
  ]
}
```

---

## 3. Karar Akışı — Ana Giriş: `generateWeeklyPlan()`

**Konum**: [engine3.ts:904](../src/lib/planner/engine3.ts:904)

```
init()
  ├─ fetchPatientData()          // patients, disliked, liked, program_template_id
  ├─ fetchAllFoods()             // team overrides + micronutrient overrides
  ├─ fetchSettings()             // global→team→program→patient field-level merge
  ├─ fetchRules()                // sparse override, is_active + tombstone filtresi
  └─ fetchFlavorTuningConfig()

generateWeeklyPlan(weekNumber)
  ├─ currentWeekNumber = weekNumber
  ├─ prepareEligibleFoods()      // diyet tipi + banned_tags filtresi
  ├─ preprocessAdvancedRules()   // or_group → frequency expand; exclusive_scope processing
  ├─ dayLoop (i=1..7)
  │   ├─ cumulative debt hesabı  // compensated targets
  │   └─ slotLoop (KAHVALTI, ÖĞLEN, AKŞAM, ARA ÖĞÜN)
  │       ├─ slotBudget hesabı   // ARA ÖĞÜN=%15, ana öğün=%85/N
  │       └─ selectFoodsForSlot()
  │           ├─ FIXED_MEAL      // Fuzzy: UUID→exact→normalize→fold→fuzzy
  │           ├─ REQUIRED_ROLES  // slot_config.requiredRoles (mainDish, ...)
  │           ├─ PASS 1: MIN     // her frequency kuralının min_count'unu doldur
  │           │                  //   name/tag/food_id/name_or_tag → doğrudan pool taraması
  │           │                  //   role/category                → selectBestFoodByRole
  │           ├─ PASS 2: OPTIONAL// bütçe kalırsa max_count'a git
  │           ├─ Affinity injection  // trigger→outcome zorunlu ise ekle
  │           └─ Nutritional post-fill  // makro açığı için
  ├─ Iteration re-plan           // slot deviation > threshold ise slot yeniden dener (max 3 iter)
  ├─ Frequency Flex adjustment   // aşırı doldurulan kuralları geri al
  ├─ adjustWeekPortions()        // porsiyon x0.5 - x2.0 arası ayarla
  └─ Smart Balance post-processing
```

### 3.1 Slot bütçe hesabı [engine3.ts:1137](../src/lib/planner/engine3.ts:1137)

```ts
if (slot === 'ARA ÖĞÜN')
  slotBudget = daily.calories * 0.15
else
  slotBudget = (daily.calories * 0.85) / mainMealCount
```

### 3.2 Frequency kural filtresi [engine3.ts:2756](../src/lib/planner/engine3.ts:2756)

```ts
relevantRules = rules.filter(r =>
  r.is_active &&
  r.rule_type === 'frequency' &&
  isRuleActiveForWeek(def) &&                    // scope_weeks check
  matchesSlot(def.scope_meals, slotName) &&
  matchesDays(def.scope_days, dayOfWeek) &&
  (!randomDaysTarget || getRandomDaysForRule(r.id, count).includes(dayOfWeek))
)

// UYARI: implicit random_day_count sadece period === 'weekly' için tetiklenir.
// (v2026-09'da düzeltildi — daha önce daily kuralları da haftada 1 güne düşüyordu.)
```

### 3.3 Priority sıralaması [engine3.ts:2787](../src/lib/planner/engine3.ts:2787)

```
1. sort_order ASC (kullanıcı UI sürükle-bırak)
2. specificity DESC (target tipi + scope belirginliği)
3. priority DESC
```

Specificity skoru:
```
food_id           → 60
name_or_tag       → 55
name_contains     → 50
tag               → 45
category          → 35
role              → 25
+ scope_meals     → +12
+ scope_days      → +8
+ per_meal        → +6
+ min_count > 0   → +4
```

### 3.4 Pass 1 (min_count) yemek arama akışı [engine3.ts:3035](../src/lib/planner/engine3.ts:3035)

```ts
const isNameOrTagBased = ['name_contains','name_or_tag','ingredient','tag','food_id'].includes(targetType)

if (isNameOrTagBased) {
  // Role-agnostic direct pool scan (v2026-09 fix — mainDish peynir yemekleri düşürülüyordu)
  candidates = eligibleFoods.filter(f =>
    !selectedIds.has(f.id) &&
    matchesTarget(f, def.target) &&
    isMealTypeCompatibleWithSlot(f, slotName) &&
    !hasTagConflict(f, slotTags) &&
    !hasReachedWeeklyCap(f) &&
    !inBannedRoles(f) &&
    !inBannedTags(f) &&
    !violatesUniqueSlotRole(f)
  )
  // Sırala: today unused > week unused > any
  selectedFood = candidates[0]
} else {
  // Klasik akış: role bazlı arama
  food = selectBestFoodByRole(category, searchRole, ...)
  if (!food || !matchesTarget(food, def.target))
    food = selectBestFoodByRole(..., ignoreRepetition=true, ignoreBudget=true, allowMealTypeBypass=true)
}
```

### 3.5 `matchesTarget` [engine3.ts:5260](../src/lib/planner/engine3.ts:5260)

```ts
category      → normalizeCategory(f.category) === normalizeCategory(target.value)
               || fRole === tVal
               || CATEGORY_ROLE_MAP synonyms subset of food name
role          → normalizeCategory(f.role) === normalizeCategory(target.value)
food_id       → f.id === target.value || f.name === target.value
tag           → f.tags.includes(target.value.toLowerCase())
name_contains → f.name.toLowerCase().includes(target.value.toLowerCase())
name_or_tag   → name_contains OR tag OR synonyms[*] (v2026-09 eklendi)
```

### 3.6 Kırılmaz sınırlar (HARD constraints)

| Sınır | Nerede | Bypass edilir mi? |
|---|---|---|
| `config.maxItems` | Pass 1/2 | ❌ Asla (force_inclusion bile aşamaz) |
| `isMealTypeCompatibleWithSlot` | Her lookup | ❌ Normal akışta; `def._bypass_meal_types: true` ile Sera tetikleyebilir |
| `hasForbiddenAffinityConflict` | Pass 1 | ❌ Yasak affinity varsa yemek reddedilir |
| `checkSeasonalityHard` | selectBestFoodByRole | ❌ Sezon dışıysa reddedilir |
| `disliked_foods` | prepareEligibleFoods | ❌ Hasta tercihidir |

### 3.7 Esnek sınırlar (SOFT constraints)

| Sınır | Nerede | force_inclusion aşar mı? |
|---|---|---|
| `slotCalorieBudget * 1.6` | Pass 1/2 | ✅ |
| `hasReachedWeeklyCap` | Pass 1 pool | ✅ (allowWeeklyCapBypass) |
| Repetition penalty | selectBestFoodByRole | ✅ (ignoreRepetition) |

---

## 4. Portion Scaling — `adjustWeekPortions()`

**Konum**: [engine3.ts:1717](../src/lib/planner/engine3.ts:1717)

Her yemek `portion_multiplier` (varsayılan 1.0) ile çarpılır. Sınırlar:
- `planner_settings.portion_settings.global_min` (default 0.5)
- `planner_settings.portion_settings.global_max` (default 2.0)
- `planner_settings.portion_settings.step_value` (default 0.5)
- Yemek düzeyinde `foods.min_quantity`, `foods.step` override edebilir.

### 4.1 Stratejiler

**A. MAX_LIMIT_PROTECTION** (tek yemek çok fazla)
```
if (mealCal > targetCals * (max_calorie_percentage / 100))
  while (mealCal > threshold && mult > foodMin)
     mult -= foodStep
```
Log: `Reduced huge meal >X%  x0.5 <foodName>`

**B. MACRO_CONVERGENCE** (gün toplamı hedeften uzak)
Öğünler kalori/makro fazlası varsa `mult` düşürür, eksikse yükseltir. Ölçekleyici:
- `isScalableFood(meal)` [1657]: `food.portion_fixed` false ise ve rol izin verilenlerden ise (`mainDish, sideDish, salad, corba, bread, breakfast_main, snack, dessert, fruit`).

**C. DAILY_LIMIT** [1725]: `max_adjusted_items_per_day` (default 99) — bir günde en fazla N öğe ayarlanır.

Log örnekleri:
- `Reduced portion x0.5[Zeytin (10 adet)]`
- `Reduced huge meal >40%[x0.5 Tavuklu Kekikli Sebzeler]`
- `Portion reduction stopped[No more scalable foods or limits reached]`

---

## 5. Frequency Flex — kural aşırılığı geri alma

**Konum**: `adjustFrequencyForMacros()` [engine3.ts:1913](../src/lib/planner/engine3.ts:1913)

Plan bittikten sonra her frequency kuralı için `min_count` aşımı varsa (Örn: min=1, gerçek=5), fazlalıklar en fazla kalori tasarrufu sağlayacak şekilde çıkarılır. Log:
```
Freq-Flex: Removed 'X' (Ykcal) via rule 'Z' (currentCount/minCount min)
```

Bu, "iterasyon 3 çok kalori üretti, X çıkaralım" mantığıdır. Cross-rule korumalı (bir kural min'ini kırmaz).

---

## 6. Cumulative Debt Compensation

**Konum**: dayLoop içinde [engine3.ts:1090 civarı]

Gün 1 hedeften -700kcal geldiyse, Gün 2'de compensated target = base + debt. Log:
```
Day N deviation: Cal=-Xkcal, ...  | Cumulative debt: Cal=-Ykcal, ...
Compensated targets: P=Ag (base Bg), F=..., C=...
```

Bir haftalık toplam sapma normalize edilmeye çalışılır ama kırılmaz limitlere (maxItems, bannedKeywords) uyulur.

---

## 7. Sera → engine3 entegrasyonu

### 7.1 Sera akışı

1. **`POST /api/ai/generate-rule`** [route.ts:189](../src/app/api/ai/generate-rule/route.ts:189)
   - `buildFoodSummary()` → kategori başına ilk 15 yemek `id | name` formatında
   - `fetchRulesForScope()` → mevcut aktif kurallar (sparse merge)
   - `buildHealthContext()` → hastalık/ilaç/tahlil
   - `phaseMapContext` → programın hafta→faz haritası + banned_keywords + makro faktörleri + CURRENT_WEEK
   - `slotConfigsContext` → hastanın MEAL SETTINGS
   - Gemini 2.5-flash çağrısı → JSON kural üretir
   - **Post-process**:
     - `stripMarkdown()` → ** __ * ` işaretlerini metinden temizle
     - Foods pre-validation: her `foods[]` içindeki entry için UUID resolve/fuzzy match; `_food_labels` stash
     - `detectConflicts()` + dedupe (severity+message key)
     - **`replaces_rule_id` expansion**: `targetsOverlap` ile TÜM aktif çakışan kuralları bul → `definition._replaced_ids: [...]`, patient scope varsa `replaces_rule_id` ona set

2. **`SeraAssistant` (client)** [sera-assistant.tsx](../src/components/sera/sera-assistant.tsx)
   - `RuleReviewWizard` gösterir → kullanıcı onaylayınca `planning_rules` tablosuna insert
   - `!requireApproval` ise `_replaced_ids`'deki kuralları `.in('id', ...)` ile toplu pause/tombstone yaratır

3. **`generateRuleSentence()`** [health-conflict-checker.ts:182](../src/lib/ai/health-conflict-checker.ts:182)
   - UI'da kuralın "insan dilinde" başlığını üretir
   - fixed_meal: day + slot + `_food_labels` kullanarak "Çarşamba akşam öğünlerine Kremalı kabak çorbası eklenir." formatı

### 7.2 Sera prompt katmanları

Sırası: 
1. Rol tanımı + zorunlu kurallar (Türkçe, UUID sızıntısı yok, markdown yok, natural rule name)
2. **RULE_ENGINE_MANIFESTO** ([manifesto.ts](../src/lib/ai/manifesto.ts)) — tüm kural tipleri + tüm parametreler + çakışma senaryoları + faz bağlamı
3. Kural tipleri detaylı JSON şemaları
4. Yemek DB özet (id + name per category)
5. Mevcut aktif kurallar
6. Sağlık profili
7. Kapsam bilgisi
8. Örnek istek→kural dönüşümleri
9. Yanıt formatı + kritik davranış kuralları
10. slotConfigsContext (MEAL SETTINGS)
11. **phaseMapContext** (program adı, şu anki hafta, faz detayı, yasak kelimeler, makro faktörleri)
12. Kullanıcı mesajı + faz hatırlatması

### 7.3 Malzeme scope protokolü

Kullanıcı bir malzeme adı verirse (peynir, tahin, sucuk, ceviz, yumurta, avokado, bal, tavuk, balık, kırmızı et...), Sera direkt kural üretmez. **TEK mesajda hem scope hem sıklık** sorar:
1. **Kapsam**: sadece isim mi / tarifte de mi / aile de dahil mi
2. **Sıklık**: her gün mü / haftada X gün mü / kalori uyarısı

Yanıta göre:
- Scope → `target.type`: `name_contains` | `name_or_tag` | `name_or_tag + synonyms[]`
- Sıklık → `force_inclusion` + `min_count/max_count`

Meal_types bypass: eğer kullanıcı "ne olursa olsun ekle" gibi ısrar ederse Sera `def._bypass_meal_types: true` üretir. Kural açıklamasında "kısıtlı çeşitliliğe rağmen zorunlu tutuldu" notu düşer.

---

## 8. Bilinen bug pattern'leri (v2026-09'a kadar düzeltilenler)

Bir sonraki iterasyonda benzer hatalarla karşılaşırsan bakılacak yerler:

1. **Fixed_meal name mismatch**: `foods` içindeki isim DB'deki isimle eşleşmezse sessizce fail eder. **Fix**: [engine3.ts:2606-2666](../src/lib/planner/engine3.ts:2606) — 5 aşamalı lookup (UUID → exact → normalize → fold → fuzzy).

2. **Türkçe diakritik farkı**: "Domates Çorbası" vs "Domates çorbası" katı `===` başarısız. **Fix**: `foldName()` — Türkçe locale-lower + `TR_FOLD_MAP{ç:c, ğ:g, ı:i, i̇:i, ö:o, ş:s, ü:u, ...}` + NFD strip.

3. **Slot ismi eşleşmez**: `def.target_slot !== slotName` katı. **Fix**: `normalizeSlotName()` her yerde. `breakfast/lunch/dinner/snack` → TR karşılıklarına çevirir.

4. **Implicit random_day_count yanlış period için**: `daily max=1` → haftada 1 gün rastgele oluyordu. **Fix**: sadece `period === 'weekly'` için tetikle.

5. **name_contains role-restricted**: `searchRole = 'sideDish'` default'u peynir/tahin gibi mainDish ağırlıklı gruplar için havuzu daraltıyordu. **Fix**: `isNameOrTagBased` için `direct pool scan` — role bağımsız.

6. **replaces_rule_id yanlış scope**: Sera program scope'u eziyor, patient scope kalıyor. **Fix**: API'de `targetsOverlap` ile tüm çakışanları bul, patient scope'ları önceliklendir.

7. **Sera food name halüsinasyonu**: DB'de olmayan isim üretiyor. **Fix**: buildFoodSummary kategori başına 15 yemek `id | name` verir; prompt "UUID kullan" zorlar; API foods pre-validation.

8. **Program faz farkındalığı**: Sera "eliminasyonda peynir yasak" bilmiyordu. **Fix**: `phaseMapContext` DB'den `diet_types.banned_keywords` çeker.

9. **UUID sızıntısı hastaya**: clarification_message'da UUID görünüyordu. **Fix**: prompt "user-facing text'te UUID yok".

10. **Markdown ** işaretleri**: Sera `**kalın**` yazıyor, UI plain render ediyor. **Fix**: `stripMarkdown()` API'de post-process.

11. **generateRuleSentence generic**: fixed_meal için "Bir öğüne sabit yemek eklenir" veriyordu. **Fix**: day + slot + `_food_labels` ile "Çarşamba akşam öğünlerine ... eklenir."

12. **Conflict duplication**: Aynı kural farklı scope'larda 2x görünüyordu. **Fix**: severity+message key dedupe.

13. **_replaced_ids sadece tek ID**: Wizard tek pause ediyordu. **Fix**: API expansion + `.in('id', allReplacedIds)` toplu pause.

14. **Freq-Flex kural min'ini kırma**: Kısıtlı düzeltildi (min tracking eklendi).

---

## 9. Bir raporu okumak — Karar Raporu formatı

Rapor satırları `G<gün> <SLOT> <durum> <mesaj>[<yemek>]` formatındadır:

| Prefix | Anlamı |
|---|---|
| `G1 KAH` | Gün 1 Kahvaltı |
| `G3 ÖĞL` | Gün 3 Öğlen |
| `G7 AKŞ` | Gün 7 Akşam |
| `G6 ITE` | Gün 6 Iteration re-plan |
| `G4 CRO` | Gün 4 Cross-day cumulative debt hesabı |
| `GENEL` | Tüm hafta seviyesinde adjustment |

Sık görülen semantik:
- `Fixed meal selected [match:normalized][X]` — fixed_meal fuzzy match ile bulundu.
- `Required role 'mainDish' intersected with 'Y' [Z]` — mainDish gereksinimi Y kuralı ile kesişti.
- `Pass 1: Direct name/tag pool match for rule 'X'[Y]` — v2026-09 fix aktif.
- `Pass 1: Could not find food for rule 'X'` — havuzda uygun yemek yok (eligibility, meal_types, tag conflict, weekly cap).
- `Budget reached (X/Y), stopping optional selection` — Pass 2 kalori limiti nedeniyle durdu.
- `Iteration N: F=X%, C=Y%, P=Z%, Cal=W%. Re-planning 'ÖĞLEN' (deviation=D)` — slot sapması yüksek, yeniden dener.
- `Day N deviation ... Cumulative debt ...` — dayLoop debt tracker.
- `Freq-Flex: Removed 'X' (Ykcal) via rule 'Z' (currentCount/minCount min)` — post-process fazlalık kaldırma.
- `Reduced portion x0.5[X]` — portion scaling.
- `Skipped forced add for X to avoid overflowing capacity (macros)` — force_inclusion olsa da makro doldu, atlandı.

---

## 10. Yaygın hata teşhis şablonu

Kullanıcı bir kural ekledi ama plana girmiyor.

### Kontrol listesi (sırayla)

1. **Kural DB'de aktif mi?**
   ```sql
   SELECT is_active, definition FROM planning_rules WHERE id = 'X';
   ```
2. **`_replaced_ids` başka aktif duplikat kural bırakmış mı?** Aynı hedefli patient scope kural varsa kontrol.
3. **`scope_weeks` doğru hafta mı?** `currentWeekNumber` 1-based, `starting_week` da öyle. `isRuleActiveForWeek(def)` [engine3.ts:173] çalıştır.
4. **`scope_meals` slot ismiyle eşleşiyor mu?** `normalizeSlotName` her iki tarafta.
5. **`scope_days` bugüne uyuyor mu?** `dayOfWeek = dayIndex + 1`.
6. **Implicit random_day_count doğru period için mi tetiklenmiş?** Sadece `weekly` olmalı.
7. **`target.type` ile ilgili havuz taraması doğru mu?** `name_or_tag` için Pass 1 direct pool scan aktif olmalı.
8. **Yemek eligibility'de mi?** 
   - `disliked_foods` içinde mi?
   - `bannedKeywords` (diyet fazı) yakalıyor mu?
   - `meal_types` slotu içeriyor mu?
9. **Slot kapasitesi dolu mu?** `config.maxItems`.
10. **Freq-Flex sonradan kaldırdı mı?** Rapor sonundaki `Freq-Flex: Removed` satırlarına bak.
11. **Portion scaling x0.0 mı yaptı?** `Reduced portion` satırlarına bak.

### Bug isolation için kısa SQL'ler

```sql
-- Hastanın aktif tüm kurallarını dök
SELECT id, name, rule_type, priority, scope,
       definition->'data' AS def_data,
       definition->'_replaced_ids' AS replaced_ids
FROM planning_rules
WHERE is_active = true
  AND (scope='global' OR scope IS NULL
       OR (scope='patient' AND patient_id='<PATIENT_UUID>')
       OR scope IN ('team','program'))
ORDER BY priority DESC;

-- Bir hedef isim/tag için hangi yemekler eligible
SELECT id, name, category, role, meal_types, tags
FROM foods
WHERE name ILIKE '%peynir%' OR 'peynir' = ANY(tags)
ORDER BY category, name;

-- Programın faz haritası
SELECT ptw.week_start, ptw.week_end, dt.name, dt.banned_keywords, dt.banned_tags,
       dt.carb_factor, dt.protein_factor, dt.fat_factor
FROM program_template_weeks ptw
JOIN diet_types dt ON dt.id = ptw.diet_type_id
WHERE ptw.program_template_id = '<PROGRAM_TEMPLATE_UUID>'
ORDER BY ptw.week_start;
```

---

## 11. Değişiklik günlüğü (v2026-05 → v2026-09)

| # | Bug/İyileştirme | Dosya:Satır |
|---|---|---|
| 1 | Fixed_meal lookup 5 aşamalı toleranslı | engine3.ts:2606 |
| 2 | Sera fixed_meal food_id kullanır | rule-generator-prompt.ts |
| 3 | generate-rule API foods pre-validation + `_food_labels` | route.ts |
| 4 | _replaced_ids Sera prompt netleştirildi | rule-generator-prompt.ts |
| 5 | ASCII-fold + İ/I normalize | engine3.ts:2606 |
| 6 | Program faz haritası phaseMapContext | route.ts:233 |
| 7 | fixed_meal target_slot normalize | engine3.ts:5358 |
| 8 | Sera'ya kategori başına 15 yemek | route.ts |
| 9 | Manifesto tüm parametreler + hiyerarşi | manifesto.ts |
| 10 | Sera UUID sızıntısını engelle | rule-generator-prompt.ts |
| 11 | Faz haritası güçlendir + current_week | route.ts |
| 12 | Faz bilgi tabanı DB'den dinamik | route.ts |
| 13 | fixed_meal doğal cümle üret | health-conflict-checker.ts:266 |
| 14 | Conflict dedupe | route.ts |
| 15 | Markdown ** temizliği | route.ts + prompt |
| 16 | Sera isim vs içerik clarification | rule-generator-prompt.ts |
| 17 | Engine3 name_or_tag target tipi | engine3.ts:5303 |
| 18 | replaces_rule_id targetsOverlap expansion | route.ts + sera-assistant.tsx |
| 19 | Clarification scope + kalori birleşik | rule-generator-prompt.ts |
| 20 | name/tag targetler role-agnostic pool scan | engine3.ts:3035 |
| 21 | Engine3 hiyerarşi haritası (bu doküman) | docs/engine3-reference.md |
| 22 | Daily period implicit random_day_count kaldır | engine3.ts:232,1977,2779,5159,5215 |
| 23 | Bu teknik referans | (bu dosya) |
| 24 | Meal_types bypass Sera üzerinden | engine3.ts + prompt |
| 25 | Karar Raporu self-documenting log mesajları | engine3.ts (çeşitli) |
| 26 | generateRuleSentence: name_or_tag + fixed_meal display | health-conflict-checker.ts:210 |
| 27 | force_inclusion tag conflict gevşetme | engine3.ts:3074 |
| 28 | EXEMPT_TAGS: keto, lowcarb, vegan, paleo... eklendi | engine3.ts:99-118 |
| 29 | countOccurrences scope_meals filtresi + _slotName metadata | engine3.ts:5329 |
| 30 | Affinity boost log eklendi | engine3.ts |
| 31 | plan_generation_reports: rapor kalıcı DB kaydı | migration + API + PlanHistoryDialog |
| 32 | Sera diyetisyen paneline eklendi (scope prop) | patients/[id]/page.tsx + sera-assistant.tsx |
| 33 | Freq-Flex cross-rule min koruması | engine3.ts:2269 |
| 34 | Pass 1 slot-per-rule limit (slot başına 1 yemek) | engine3.ts:3067 |
| 35 | Kural listesi sort_order sıralaması | sera-assistant.tsx |
| — | Cumulative debt clamp (base*0.6 – base*1.4) | engine3.ts:1136 |
| — | PlanHistoryDialog responsive tasarım | plan-history-dialog.tsx |

**Kapsamlı sorun çözme rehberi**: [`docs/troubleshooting-roadmap.md`](./troubleshooting-roadmap.md)
