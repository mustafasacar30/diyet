# Ketojenik Makro Kuralları — Bilimsel Dayanak ve Kaynakça

> Bu dosya `src/lib/nutrition/energy.ts` modülünün bilimsel referanslarını içerir.
> Kaynak künyelerine kodda `@see [R#]` biçiminde atıf yapılır.

---

## A. Kuralların Literatür Karşılığı

### A1. Karbonhidrat — Sabit tavan 25 g/gün
- VLCKD'de <30 g/gün, üst sınır <50 g/gün [R6][R7][R9]
- Lipödem vakalarında ≤25 g/gün [R11][R12]

### A2. Protein — 1.2–1.5 g/kg ideal kilo
- 0.8 g/kg/gün erişkin RDA [R5]
- KeNuT konsensüsü: en az 0.8 g/kg, en fazla 1.5 g/kg ideal kilo [R8]
- VLCKD kılavuzları: 1.2–1.5 g/kg ideal kilo [R6][R9][R10]
- BMI 30–35 bandında `0.8 × gerçek kilo ≈ 1.2 × ideal kilo`

### A3. Yağ — K/AK ≥ 1.5 veya 1.2 × referans kilo
- Yağ:protein ≈ 1.5:1 oranı lipödem vakasında 1:1–1:2 aralığında [R11][R12]
- Woodyatt-Withrow K/AK = (0.9·F + 0.46·P) / (C + 0.58·P + 0.1·F) [R17][R18]
- Metabolik etkilerin ayrıştığı eşik ≈ 1.7 [R16]

### A4. Referans Kilo
- İdeal kilo = BMI_ref × boy(m)², varsayılan BMI 22.5 [R10]
- Düzeltilmiş kilo = İdeal + 0.25 × (Gerçek − İdeal), BMI ≥ 30 ise [R22]

### A5. Enerji Denklemleri
- Mifflin-St Jeor: obez dahil en tutarlı [R1][R3]
- Harris-Benedict: Roza-Shizgal revizyonu [R2]
- Katch-McArdle: BIA gerektirir [R4]

---

## B. Yöntem Metni

> Enerji gereksinimi Mifflin-St Jeor denklemiyle hesaplanmış ve aktivite katsayısıyla çarpılmıştır [R1][R3].
> Karbonhidrat VLCKD kriterlerine uygun olarak ≤25 g/gün sabit tutulmuştur [R6][R11].
> Protein, KeNuT konsensüsündeki sınırlar içinde (1.2–1.5 g/kg ideal kilo) düzeltilmiş vücut ağırlığı üzerinden belirlenmiştir [R8][R22].
> Yağ miktarı, lipödemde bildirilen protein:yağ oranı aralığında ve Woodyatt-Withrow K/AK oranı ≥1.5 olacak şekilde hesaplanmıştır [R11][R16][R18].

---

## C. Kaynakça

✓ = çevrimiçi kaynakta doğrulandı. ⚠ = künye PubMed'den kontrol edilmeli.

| No | Künye | Durum |
|---|---|---|
| R1 | Mifflin MD ve ark. A new predictive equation for resting energy expenditure. *Am J Clin Nutr.* 1990;51(2):241–247. | ⚠ |
| R2 | Roza AM, Shizgal HM. The Harris Benedict equation reevaluated. *Am J Clin Nutr.* 1984;40(1):168–182. | ⚠ |
| R3 | Frankenfield D ve ark. Comparison of predictive equations for RMR. *J Am Diet Assoc.* 2005;105(5):775–789. | ⚠ |
| R4 | McArdle WD, Katch FI, Katch VL. *Exercise Physiology.* Lippincott Williams & Wilkins. | ⚠ |
| R5 | Institute of Medicine. *Dietary Reference Intakes for Energy...* National Academies Press; 2005. | ⚠ |
| R6 | Muscogiuri G ve ark. European Guidelines for Obesity Management with VLCKD. *Obes Facts.* 2021;14(2):222–245. | ✓ |
| R7 | Barrea L ve ark. VLCKD → VLEKT nomenclature (KetoNut). *Curr Nutr Rep.* 2024. | ✓ |
| R8 | KeNuT — SIE consensus statement, 2024 (R7 içinde aktarılmıştır). | ⚠ |
| R9 | A Clinical Perspective of Low Carbohydrate Ketogenic Diets. *Front Nutr.* 2021;8:642628. | ✓ |
| R10 | ClinicalTrials.gov NCT05848544 — ideal kilonun BMI 22.5 tanımı. | ✓ |
| R11 | Cannataro R ve ark. Management of Lipedema with Ketogenic Diet. *Life.* 2021;11(12):1402. | ✓ |
| R12 | Biphasic ketogenic/low-carbohydrate diet in lipedema — case report. PMCID: PMC12894008. | ✓ |
| R13 | Modified Mediterranean-Ketogenic Diet in Lipedema. PMCID: PMC10457774. | ✓ |
| R14 | Therapeutic Applications of Ketogenic Diets in Lipedema — review. PMCID: PMC12106162. | ✓ |
| R15 | Keith L ve ark. Ketogenic diet as potential intervention for lipedema. *Med Hypotheses.* 2021;146:110435. | ⚠ |
| R16 | Zilberter T, Zilberter Y. Ketogenic Ratio Determines Metabolic Effects. *Front Nutr.* 2018;5:75. | ✓ |
| R17 | Woodyatt RT. Objects and method of diet adjustment in diabetes. *Arch Intern Med.* 1921. | ⚠ |
| R18 | Withrow CD. The ketogenic diet: mechanism of anticonvulsant action. *Adv Neurol.* 1980;27:635–642. | ⚠ |
| R19 | Shaffer PA. Antiketogenesis. *J Biol Chem.* 1921. | ⚠ |
| R20 | Wilder RM. The effects of ketonemia on epilepsy. *Mayo Clin Bull.* 1921;2:307. | ⚠ |
| R21 | Devine BJ. Gentamicin therapy. *Drug Intell Clin Pharm.* 1974;8:650–655. | ⚠ |
| R22 | Krenitsky J. Adjusted body weight. *Nutr Clin Pract.* 2005;20(4):468–473. | ⚠ |
