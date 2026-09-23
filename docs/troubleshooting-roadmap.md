# Engine3 & Sera — Sorun Çözme Yol Haritası (v2026-09)

Bu doküman, diyet planlama sisteminde **35+ sorunun** nasıl tespit edilip çözüldüğünü, kullanılan teknikleri ve gelecekte benzer sorunlara yaklaşım stratejilerini içerir. Başka bir AI modeline verildiğinde "bunları biz çözdük, sen de bu yöntemlerle devam et" denilebilecek bir kılavuzdur.

**Teknik referans**: [`docs/engine3-reference.md`](./engine3-reference.md) — motor mimarisi, kural şemaları, karar akışı, bilinen bug pattern'leri.

---

## İçindekiler

1. [Kullanılan Teşhis Teknikleri](#1-kullanılan-teşhis-teknikleri)
2. [Çözülen Sorunlar — Tam Liste](#2-çözülen-sorunlar--tam-liste)
3. [Sorun Kategorileri ve Stratejiler](#3-sorun-kategorileri-ve-stratejiler)
4. [Veri Kalitesi ve SQL Araçları](#4-veri-kalitesi-ve-sql-araçları)
5. [Sera (AI Kural Üretici) Sorunları](#5-sera-ai-kural-üretici-sorunları)
6. [Engine3 Motor Sorunları](#6-engine3-motor-sorunları)
7. [UI ve Entegrasyon Sorunları](#7-ui-ve-entegrasyon-sorunları)
8. [Gelecek İyileştirmeler İçin Notlar](#8-gelecek-iyileştirmeler-için-notlar)

---

## 1. Kullanılan Teşhis Teknikleri

### 1.1 Karar Raporu (Planner Log) Analizi

Engine3 her plan üretiminde ayrıntılı log üretir. Format: `G<gün> <SLOT> <durum> <mesaj> [<yemek>]`

**Teknik**: Raporu satır satır okuyarak:
- Hangi kuralların uygulandığını (`Pass 1: Direct name/tag pool match`)
- Hangi yemeklerin neden reddedildiğini (`Could not find food for rule`)
- Freq-Flex'in neyi kaldırdığını (`Freq-Flex: Removed`)
- Cumulative debt'in ne kadar kompanse ettiğini (`Compensated targets`)
- Iteration re-plan'ın neden tetiklendiğini (`deviation=X%`)

tespit ettik. Bu raporlar artık `plan_generation_reports` tablosuna kalıcı kaydediliyor.

### 1.2 Supabase SQL Sorguları

Sorunları izole etmek için doğrudan Supabase SQL Editor'den sorgular çalıştırdık:

```sql
-- Bir kuralın gerçek durumunu kontrol et
SELECT id, name, rule_type, is_active, priority, sort_order,
       definition->'data' AS def
FROM planning_rules
WHERE patient_id = '<UUID>' AND is_active = true
ORDER BY sort_order ASC, priority DESC;

-- Hedef yemeklerin eligibility durumu
SELECT id, name, category, role, meal_types, tags
FROM foods
WHERE name ILIKE '%tahin%' OR 'tahin' = ANY(tags);

-- Tag boşluğu olan yemekleri bul
SELECT name, category, role, tags, meal_types
FROM foods
WHERE category = 'TATLILAR' AND (tags IS NULL OR array_length(tags, 1) IS NULL);

-- Program faz haritası
SELECT ptw.week_start, ptw.week_end, dt.name, dt.banned_keywords
FROM program_template_weeks ptw
JOIN diet_types dt ON dt.id = ptw.diet_type_id
WHERE ptw.program_template_id = '<UUID>'
ORDER BY ptw.week_start;

-- Kural sort_order hiyerarşisi
SELECT sort_order, name, rule_type, priority, scope
FROM planning_rules
WHERE patient_id = '<UUID>' AND is_active = true
ORDER BY sort_order ASC, priority DESC;
```

### 1.3 Kaynak Kod İzleme

Şüpheli davranışta engine3.ts'deki ilgili fonksiyonu bulduk ve akışı adım adım izledik:
- `selectFoodsForSlot()` → hangi pass'te hangi kural çalışıyor?
- `countOccurrences()` → hangi yemekleri hangi scope ile sayıyor?
- `hasTagConflict()` → hangi tag'ler çakışma yaratıyor?
- `matchesTarget()` → hedef eşleşmesi doğru mu?

### 1.4 TypeScript Derleme Kontrolü

Her değişiklik sonrası:
```bash
npx tsc --noEmit --skipLibCheck
```

### 1.5 Plan Çıktısı Karşılaştırma

Kullanıcıdan iki şey istedik:
1. **Plan önizlemesi** (hangi gün/slot/yemek seçildi)
2. **Karar raporu** (neden o seçimler yapıldı)

İkisini yan yana okuyarak "kural uygulanmış mı?" sorusunu cevapladık.

---

## 2. Çözülen Sorunlar — Tam Liste

### Sera (AI Kural Üretici) — 19 Sorun

| # | Sorun | Çözüm | Dosya |
|---|---|---|---|
| 1 | Fixed_meal yemek ismi DB'de bulunamıyor | 5 aşamalı lookup: UUID→exact→normalize→fold→fuzzy | engine3.ts:2606 |
| 2 | Sera prompt fixed_meal UUID kullanmıyor | Prompt'a food_id zorunluluğu eklendi | rule-generator-prompt.ts |
| 3 | generate-rule API foods doğrulaması yok | UUID resolve + fuzzy match + `_food_labels` stash | api/ai/generate-rule/route.ts |
| 4 | `_replaced_ids` override belirsiz | Sera prompt ve manifesto netleştirildi | rule-generator-prompt.ts |
| 5 | Türkçe İ/I diakritik farkı match bozuyor | `foldName()` + `TR_FOLD_MAP` ASCII normalizasyonu | engine3.ts:2606 |
| 6 | Sera program fazını bilmiyor | `phaseMapContext`: hafta→faz + banned_keywords + makro faktörleri | route.ts:233 |
| 7 | fixed_meal target_slot eşleşmesi katı | `normalizeSlotName()` her yerde uygulandı | engine3.ts:5358 |
| 8 | Sera yemek ismi hallüsinasyonu | `buildFoodSummary()`: kategori başına 15 yemek `id \| name` | route.ts |
| 9 | Manifesto eksik parametreler | Tüm engine3 parametreleri + kural tipleri + hiyerarşi | manifesto.ts |
| 10 | UUID hastaya sızıyor (clarification) | Prompt: "user-facing text'te UUID yok" kuralı | rule-generator-prompt.ts |
| 11 | Faz haritası zayıf | `current_week` + detaylı faz bilgisi eklendi | route.ts |
| 12 | Faz bilgisi statik | DB'den dinamik: `diet_types` banned + makro faktörleri | route.ts |
| 13 | fixed_meal cümlesi jenerik | Doğal Türkçe: "Çarşamba akşam → Kremalı kabak çorbası" | health-conflict-checker.ts:266 |
| 14 | Conflict duplikasyonu | severity+message key dedupe | route.ts |
| 15 | Markdown `**` işaretleri UI'da raw | `stripMarkdown()` post-process | route.ts + prompt |
| 16 | Sera isim vs içerik karışıklığı | Clarification: scope + sıklık TEK mesajda sorulur | rule-generator-prompt.ts |
| 18 | `replaces_rule_id` tek kural eziyor | `targetsOverlap` ile TÜM çakışanları bul → `_replaced_ids[]` | route.ts + sera-assistant.tsx |
| 19 | Clarification dağınık soruluyor | Scope + kalori uyarısı tek mesajda birleştirildi | rule-generator-prompt.ts |
| 24 | meal_types kısıtı bypass edilemiyor | `_bypass_meal_types: true` Sera ısrarında | engine3.ts + prompt |

### Engine3 Motor — 12 Sorun

| # | Sorun | Çözüm | Dosya |
|---|---|---|---|
| 17 | `name_or_tag` target tipi yok | Yeni target tipi: isim OR tag OR synonyms match | engine3.ts:5303 |
| 20 | name/tag hedefler role-restricted havuz | Direct pool scan: role-agnostic `eligibleFoods.filter()` | engine3.ts:3035 |
| 22 | Daily period implicit random_day_count | Sadece `period === 'weekly'` için tetikle | engine3.ts:232,1977,2779 |
| 25 | Karar raporu self-documenting değil | Detaylı log mesajları + slot kodu açıklamaları | engine3.ts (çeşitli) |
| 26 | `generateRuleSentence` name_or_tag jenerik | `name_or_tag` → "peynir içeren yemek (kaşar, lor dahil)" | health-conflict-checker.ts:210 |
| 27 | `force_inclusion` tag conflict'te takılıyor | `relaxTagConflict = forceInclusion` → tag bypass | engine3.ts:3074 |
| 28 | Diet-style tag'ler (keto, lowcarb) çakışma yaratıyor | `EXEMPT_TAGS` genişletildi: keto, ketojenik, lowcarb, vegan, paleo... | engine3.ts:99-118 |
| 29 | `countOccurrences` scope_meals filtresi yok | `scopeMeals` parametresi + `_slotName` metadata | engine3.ts:5329 |
| 33 | Freq-Flex başka kuralın min'ini kırıyor | Cross-rule min koruması: diğer kuralların min_count kontrolü | engine3.ts:2269 |
| 34 | Pass 1 aynı kural için slot başına N yemek dump | `k > 0` break: slot başına 1 yemek (per_meal min>1 hariç) | engine3.ts:3067 |
| — | Cumulative debt agresif (G7 target=0) | `clamp(base*0.6, base*1.4)` — kompanse hedef sınırlandı | engine3.ts:1136 |
| 30 | Affinity boost log eksik | Affinity puanlama logları eklendi | engine3.ts |

### UI ve Entegrasyon — 4 Sorun

| # | Sorun | Çözüm | Dosya |
|---|---|---|---|
| 31 | Plan raporu dialog kapanınca kayboluyor | `plan_generation_reports` DB tablosu + API + PlanHistoryDialog | Yeni tablo + 3 yeni dosya |
| 32 | Sera diyetisyen panelinde yok | SeraAssistant `scope` prop + Dialog entegrasyonu | patients/[id]/page.tsx + sera-assistant.tsx |
| 35 | Kural listesi `created_at` sıralı | `sort_order ASC → priority DESC → created_at DESC` | sera-assistant.tsx |
| — | PlanHistoryDialog responsive değil | Mobile: vertical stack + "Listeye dön" butonu | plan-history-dialog.tsx |

---

## 3. Sorun Kategorileri ve Stratejiler

### Kategori A: "Kural çalışmıyor" — Yemek plana girmiyor

**Teşhis sırası:**
1. Karar raporunda kuralı ara → `Pass 1:` veya `Could not find` satırları
2. SQL ile kuralın `is_active`, `definition`, `sort_order` kontrol
3. Hedef yemeğin `eligibleFoods`'da olup olmadığını kontrol:
   - `meal_types` slot ile uyumlu mu?
   - `bannedKeywords` (faz) yakalıyor mu?
   - `disliked_foods` listesinde mi?
4. `hasTagConflict()` → EXEMPT_TAGS'da olmayan bir tag mı?
5. `scope_meals` / `scope_days` doğru mu?
6. Slot kapasitesi (`maxItems`) dolu mu?
7. Freq-Flex sonradan kaldırmış mı?

**Tipik çözüm**: Genellikle A) veri kalitesi (yanlış role/tag/meal_types), B) motor mantığı (yanlış havuz taraması), veya C) kural tanımı (yanlış scope/period) kaynaklı.

### Kategori B: "Kural fazla çalışıyor" — Yemek çok sık / porsiyon çok büyük

**Teşhis sırası:**
1. Karar raporunda kaç kez seçildiğini say
2. `countOccurrences()` scope filtresi doğru mu?
3. `random_day_count` implicit mi uygulanıyor?
4. Pass 1 slot-per-rule limit aktif mi?
5. Freq-Flex neden kaldırmadı?
6. Portion scaling log'ları kontrol

**Tipik çözüm**: A) countOccurrences scope filtresi, B) Pass 1 sınırı, C) Freq-Flex cross-rule koruması.

### Kategori C: "Makrolar patlıyor" — Kalori/protein/karb hedeften çok uzak

**Teşhis sırası:**
1. `Compensated targets` logunu oku → debt nasıl birikmiş?
2. `force_inclusion` kuralları bütçeyi ne kadar aşıyor?
3. Portion scaling çalışmış mı? (`Reduced portion` satırları)
4. Freq-Flex fazlalıkları kaldırmış mı?
5. Slot bütçe dağılımı mantıklı mı? (ARA=%15, ANA=%85/N)

**Tipik çözüm**: A) Cumulative debt clamp, B) force_inclusion bütçe bypass sınırı, C) Freq-Flex.

### Kategori D: "Sera yanlış kural üretiyor"

**Teşhis sırası:**
1. Sera prompt'una ne gidiyor? → `buildFoodSummary`, `phaseMapContext`, mevcut kurallar
2. AI response JSON formatı doğru mu?
3. Post-process: foods validation, conflict detection, `_replaced_ids` expansion
4. Kullanıcı mesajı belirsiz mi → clarification tetiklenmeli miydi?

**Tipik çözüm**: A) Prompt katmanlarını güçlendir, B) Post-process validation, C) Clarification protokolü.

---

## 4. Veri Kalitesi ve SQL Araçları

Veri kalitesi sorunları motoru sessizce bozar. Yemek DB'deki tutarsızlıklar:
- Yanlış `role` (cheesecake → snack yerine dessert)
- Eksik `tags` (benzer yemeklerde bazılarında tag var, bazılarında yok)
- Yanlış `meal_types` (akşam yemeği kahvaltılık olarak işaretli)
- Eksik `category` (kategori boş veya yanlış)

### Kontrol SQL'leri

```sql
-- Role tutarsızlığı: aynı kategoride farklı roller
SELECT category, role, COUNT(*) AS cnt, array_agg(name ORDER BY name) AS foods
FROM foods
WHERE category = 'TATLILAR'
GROUP BY category, role
ORDER BY category, cnt DESC;

-- Tag boşlukları: benzer yemeklerde tag eksik
SELECT name, tags, role, category
FROM foods
WHERE category = 'TATLILAR'
  AND (tags IS NULL OR array_length(tags, 1) IS NULL OR NOT tags && ARRAY['tatlı'])
ORDER BY name;

-- meal_types boşlukları
SELECT name, meal_types, category
FROM foods
WHERE meal_types IS NULL OR array_length(meal_types, 1) IS NULL
ORDER BY category, name;

-- Cheesecake data fix
UPDATE foods
SET role = 'dessert'
WHERE name ILIKE '%cheesecake%' AND role != 'dessert';

-- Tüm tatlılara 'tatlı' tag'i ekle (eksik olanlara)
UPDATE foods
SET tags = array_append(COALESCE(tags, ARRAY[]::text[]), 'tatlı')
WHERE category = 'TATLILAR'
  AND NOT ('tatlı' = ANY(COALESCE(tags, ARRAY[]::text[])));
```

---

## 5. Sera (AI Kural Üretici) Sorunları

### 5.1 Hallüsinasyon Önleme

**Problem**: Sera DB'de olmayan yemek isimleri üretiyordu.
**Çözüm**: `buildFoodSummary()` ile kategori başına 15 yemek `id | name` formatında prompt'a verilir. Prompt: "Sadece verilen UUID'leri kullan, isim uydurma."
**API'de**: Her `foods[]` entry'si UUID resolve edilir, bulunamazsa fuzzy match denenir, hâlâ bulunamazsa uyarı loglanır.

### 5.2 Faz Farkındalığı

**Problem**: Sera eliminasyon fazında peynir öneriyordu (yasak).
**Çözüm**: `phaseMapContext` DB'den program şablonu → hafta aralıkları → diyet tipi → `banned_keywords`, `banned_tags`, makro faktörleri çeker.

### 5.3 Çakışma Yönetimi

**Problem**: Yeni kural eski kuralı ezmiyordu, iki kural aynı anda çalışıyordu.
**Çözüm**: `targetsOverlap()` ile TÜM çakışan kuralları bulur → `_replaced_ids[]` dizisine koyar → UI toplu pause/tombstone yapar.

### 5.4 Scope Protokolü

Kullanıcı "peynir ekle" dediğinde Sera direkt kural üretmez:
1. **Kapsam sorar**: sadece isim mi / tarifte de mi / aile de dahil mi
2. **Sıklık sorar**: her gün mü / haftada X gün mü
3. Yanıta göre `target.type` ve `force_inclusion` belirler

### 5.5 Sera Scope Esnekliği

Sera artık `scope` prop'u ile her panelde çalışır:
- `scope='patient'` → hasta paneli (varsayılan)
- `scope='program'` → program şablonu
- `scope='team'` → takım
- `scope='global'` → global

`requireApproval` prop'u ile diyetisyen panelinde onay adımı atlanabilir.

---

## 6. Engine3 Motor Sorunları

### 6.1 Target Eşleşme Sistemi

Engine3'ün en kritik bileşeni `matchesTarget()`. Sorunların çoğu burada başlıyor:

| target.type | Ne yapar | Dikkat |
|---|---|---|
| `food_id` | UUID veya isim exact match | Türkçe diakritik foldName ile |
| `category` | Kategori adı normalize | CATEGORY_ROLE_MAP synonyms |
| `role` | Rol adı normalize | mainDish, sideDish, dessert... |
| `tag` | tags[] array içinde arama | Küçük harf normalize |
| `name_contains` | İsim alt-string arama | Küçük harf |
| `name_or_tag` | İsim VEYA tag VEYA synonyms | v2026-09'da eklendi |
| `ingredient` | name_or_tag ile aynı mantık | Malzeme bazlı |

### 6.2 Havuz Tarama Stratejileri

**Eski hatalı davranış**: Her target tipi `selectBestFoodByRole()` üzerinden role-restricted arama yapıyordu. "Peynir" hedefi `sideDish` rolüne sıkışıyordu.

**Yeni doğru davranış** (v2026-09): `isNameOrTagBased` target tipleri (`name_contains`, `name_or_tag`, `ingredient`, `tag`, `food_id`) için **direct pool scan** — tüm `eligibleFoods` havuzunda role-agnostic arama.

### 6.3 Sayım ve Scope

`countOccurrences()` artık `scopeMeals` parametresi alır:
- Kural `scope_meals: ["AKŞAM"]` diyorsa sadece akşam slotundaki yemekleri sayar
- Kahvaltıdaki tahin, akşam kuralının günlük sayacını artırmaz
- Bu filtreleme `_slotName` metadata ile çalışır (her yemek seçildiğinde slot bilgisi eklenir)

### 6.4 Freq-Flex Güvenlik Katmanları

Freq-Flex fazla doldurulan kuralları geri alırken:
1. **min_count koruması**: Kendi kuralının min_count'unu kırmaz
2. **Cross-rule koruması** (v2026-09): Başka bir frequency kuralının min_count'unu da kırmaz
3. **Kalori optimizasyonu**: En çok kalori tasarrufu sağlayan yemeği çıkarır

### 6.5 Cumulative Debt Sınırlaması

Gün 1-6 arasında biriken makro açığı Gün 7'nin hedefini aşırı şişiriyordu.
**Çözüm**: `clamp(base*0.6, base*1.4)` — kompanse hedef asla bazın %60'ının altına veya %140'ının üstüne çıkamaz.

### 6.6 Pass 1 Slot Sınırı

Bir frequency kuralı (ör. "haftada 5 peynir") Pass 1'de tek slota 5 peynir dump ediyordu.
**Çözüm**: Her kural slot başına en fazla 1 yemek ekler. Sadece `per_meal` period + `min_count > 1` birden fazla ekleyebilir.

---

## 7. UI ve Entegrasyon Sorunları

### 7.1 Plan Raporu Kalıcılığı

**Problem**: Karar raporu sadece dialog açıkken bellekte duruyordu, dialog kapanınca kayboluyordu.
**Çözüm**:
- `plan_generation_reports` tablosu (Supabase, RLS policies)
- `POST /api/plan-reports` — rapor kaydet
- `GET /api/plan-reports?patient_id=...` — rapor listele
- `GET /api/plan-reports/:id` — rapor detay
- `PlanHistoryDialog` — responsive geçmiş görüntüleyici

### 7.2 Hasta-Diyetisyen Panel Tutarlılığı

Her iki panel de aynı `Planner` sınıfını kullanır. Aynı kurallar, aynı motor, aynı sonuç.
- Hasta paneli: `src/app/patient/plan/page.tsx`
- Diyetisyen paneli: `src/app/patients/[id]/page.tsx`
- Her ikisi de `handleApplyAutoPlan` → `new Planner()` → `generateWeeklyPlan()`

### 7.3 Kural Sıralama Hiyerarşisi

UI'daki sürükle-bırak sıralaması (`sort_order`) engine3'ün kural işleme önceliğini belirler:
```
1. sort_order ASC      (kullanıcı belirledi)
2. specificity DESC    (target tipi + scope belirginliği)
3. priority DESC       (1-100)
4. created_at DESC     (en yeni)
```

Sera kural listesi ve engine3 aynı sıralamayı kullanır.

---

## 8. Gelecek İyileştirmeler İçin Notlar

### Yapılması gerekebilecekler

1. **Veri kalitesi audit**: Tüm yemek DB'sinde role/tag/meal_types tutarsızlıklarını tarayacak SQL seti (bölüm 4'teki SQL'ler başlangıç noktası)
2. **Affinity kuralları test coverage**: Boost/reduce affinity logları eklendi ama kapsamlı test eksik
3. **Iteration re-plan optimizasyonu**: Şu an max 3 iterasyon, ancak bazı karmaşık slot kombinasyonlarında yetersiz kalabiliyor
4. **Smart Balance post-processing**: Haftalık seviyede makro dengeleme henüz sınırlı

### Dikkat edilecek kalıplar

- **Yeni target tipi eklerken**: `matchesTarget()`, Pass 1 pool scan, `countOccurrences()`, `generateRuleSentence()` hepsini güncellemek gerekir
- **Yeni kural tipi eklerken**: `preprocessAdvancedRules()`, `selectFoodsForSlot()` pass'lerine eklenmeli
- **Prompt değişikliğinde**: `manifesto.ts` + `rule-generator-prompt.ts` senkron tutulmalı
- **DB şema değişikliğinde**: RLS policies, API route, TypeScript tipi hepsi güncellenmeli

### Yararlı hata ayıklama komutları

```bash
# TypeScript derleme kontrolü
npx tsc --noEmit --skipLibCheck

# Bir fonksiyonu tüm dosyalarda ara
grep -rn "countOccurrences" src/lib/planner/engine3.ts

# Belirli bir kural tipinin kullanımlarını bul
grep -rn "name_or_tag" src/
```

---

## Özet Yaklaşım

Bir sorunla karşılaşıldığında:

1. **Rapor oku** → Karar raporundaki log satırlarını analiz et
2. **SQL ile doğrula** → Kural ve yemek verisini DB'den çek
3. **Kodu izle** → İlgili engine3 fonksiyonunu adım adım takip et
4. **İzole et** → Sorun veri mi? Motor mu? Kural tanımı mı? Sera mı?
5. **Minimal düzelt** → Yan etki yaratmadan en küçük değişikliği yap
6. **TS derle** → Hata olmadığını doğrula
7. **Rapor karşılaştır** → Düzeltme sonrası yeni plan üretip öncekiyle karşılaştır

Bu doküman + [`engine3-reference.md`](./engine3-reference.md) birlikte okunduğunda, herhangi bir AI modeli sistemi anlayıp sorun giderebilir düzeyde bilgi sahibi olur.
