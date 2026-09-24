/**
 * Enerji ve makro hesaplama modülü.
 *
 * İki hesaplama katmanı sunar:
 *   1. Katsayı bazlı (mevcut sistem) — diyet türü faktörleri × kilo × aktivite
 *   2. Formül bazlı (BMR → TDEE → hedef) — Mifflin-St Jeor, Harris-Benedict, Katch-McArdle
 *
 * Ek olarak keto_klinik modu: sabit karbonhidrat, referans kilo bazlı protein,
 * Woodyatt-Withrow K/AK oranına dayalı yağ hesabı.
 *
 * Kaynaklar docs/keto-makro-kaynakca.md dosyasında listelenmiştir.
 */

// ─── Tipler ────────────────────────────────────────────────────────────────

export type Gender = 'male' | 'female'

export type FormulaType = 'mifflin' | 'harris_benedict' | 'katch_mcardle'

export type ActivityLevel = 1 | 2 | 3 | 4 | 5

export interface PatientInput {
  kg: number
  heightCm: number
  age: number
  gender: Gender
  activityLevel: ActivityLevel
  leanMassKg?: number       // Katch-McArdle için gerekli (BIA ölçümü)
  bmiRef?: 22 | 22.5 | 25   // ideal kilo hesabında kullanılacak BMI referansı — varsayılan 22.5 @see [R10]
}

export interface CoefficientInput {
  kg: number
  activityLevel: ActivityLevel
  carbFactor: number
  proteinFactor: number
  fatFactor: number
  patientGoals?: string[]
}

export interface MacroResult {
  calories: number
  carb: number      // gram
  protein: number   // gram
  fat: number       // gram
}

export interface FormulaResult {
  bmr: number
  tdee: number
  formula: FormulaType
  activityMultiplier: number
}

export interface TargetResult extends MacroResult {
  bmr: number
  tdee: number
  formula: FormulaType
  deficitPercent: number
  activityMultiplier: number
  idealKg: number
  refKg: number
  bmi: number
}

export interface KetoKlinikResult extends MacroResult {
  ketoRatio: number      // Woodyatt-Withrow K/AK oranı
  idealKg: number
  refKg: number
  warnings: string[]
}

export interface ComparisonResult {
  coefficient: MacroResult
  formula: TargetResult
  ketoKlinik?: KetoKlinikResult
}

// ─── Sabitler ──────────────────────────────────────────────────────────────

// Standart TDEE aktivite çarpanları (Harris-Benedict / ACSM standardı)
const TDEE_ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  1: 1.2,     // Sedanter — masa başı, egzersiz yok
  2: 1.375,   // Hafif aktif — haftada 1-3 gün hafif egzersiz
  3: 1.55,    // Orta aktif — haftada 3-5 gün orta yoğunluk
  4: 1.725,   // Aktif — haftada 6-7 gün yoğun egzersiz
  5: 1.9,     // Çok aktif — günde 2 antrenman veya ağır fiziksel iş
}

// Mevcut katsayı sistemi aktivite çarpanları
const COEFFICIENT_ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  1: 0.8,
  2: 0.9,
  3: 1.0,
  4: 1.1,
  5: 1.2,
}

// Kalori tabanları (minimum güvenli kalori)
const MIN_CALORIES_FEMALE = 1200
const MIN_CALORIES_MALE = 1500

// Keto klinik sabitler
const KETO_CARB_CEILING = 25  // g/gün — @see [R6][R11]
const KETO_PROTEIN_MIN_FACTOR = 1.2  // g/kg ideal kilo — @see [R6][R8]
const KETO_PROTEIN_MAX_FACTOR = 1.5  // g/kg ideal kilo — @see [R6][R8]
const KETO_FAT_FACTOR = 1.2          // g/kg referans kilo — klinik kural
const KETO_RATIO_TARGET = 1.5        // K/AK hedef oran — @see [R16]

// Düzeltilmiş kilo faktörü
const ADJUSTED_WEIGHT_FACTOR = 0.25  // @see [R22]

// ─── BMR Formülleri ────────────────────────────────────────────────────────

/** Mifflin-St Jeor (1990) — @see [R1][R3] */
export function bmrMifflin(kg: number, heightCm: number, age: number, gender: Gender): number {
  const base = 10 * kg + 6.25 * heightCm - 5 * age
  return gender === 'male' ? base + 5 : base - 161
}

/** Harris-Benedict, Roza-Shizgal revizyonu (1984) — @see [R2] */
export function bmrHarrisBenedict(kg: number, heightCm: number, age: number, gender: Gender): number {
  if (gender === 'male') {
    return 88.362 + 13.397 * kg + 4.799 * heightCm - 5.677 * age
  }
  return 447.593 + 9.247 * kg + 3.098 * heightCm - 4.330 * age
}

/** Katch-McArdle — yağsız kütle gerektirir (BIA) — @see [R4] */
export function bmrKatchMcArdle(leanMassKg: number): number {
  return 370 + 21.6 * leanMassKg
}

// ─── Yardımcı Hesaplamalar ─────────────────────────────────────────────────

export function calculateBMI(kg: number, heightCm: number): number {
  const heightM = heightCm / 100
  return kg / (heightM * heightM)
}

/** İdeal kilo: bmiRef × boy(m)² — @see [R10][R21] */
export function idealWeight(heightCm: number, bmiRef: number = 22.5): number {
  const heightM = heightCm / 100
  return bmiRef * heightM * heightM
}

/** Düzeltilmiş (referans) kilo: BMI ≥ 30 ise ideal + 0.25×(gerçek-ideal) — @see [R22] */
export function referenceWeight(kg: number, heightCm: number, bmiRef: number = 22.5): number {
  const bmi = calculateBMI(kg, heightCm)
  const ideal = idealWeight(heightCm, bmiRef)
  if (bmi >= 30) {
    return ideal + ADJUSTED_WEIGHT_FACTOR * (kg - ideal)
  }
  return kg
}

// ─── BMR Hesaplama (formül seçici) ─────────────────────────────────────────

export function calculateBMR(input: PatientInput, formula: FormulaType = 'mifflin'): number {
  switch (formula) {
    case 'mifflin':
      return bmrMifflin(input.kg, input.heightCm, input.age, input.gender)
    case 'harris_benedict':
      return bmrHarrisBenedict(input.kg, input.heightCm, input.age, input.gender)
    case 'katch_mcardle':
      if (!input.leanMassKg) {
        throw new Error('Katch-McArdle formülü için yağsız kütle (leanMassKg) gereklidir.')
      }
      return bmrKatchMcArdle(input.leanMassKg)
    default:
      return bmrMifflin(input.kg, input.heightCm, input.age, input.gender)
  }
}

// ─── TDEE Hesaplama ────────────────────────────────────────────────────────

export function calculateTDEE(bmr: number, activityLevel: ActivityLevel): number {
  return bmr * TDEE_ACTIVITY_MULTIPLIERS[activityLevel]
}

// ─── Formül Bazlı Tam Hesaplama ────────────────────────────────────────────

export function calculateFormulaResult(input: PatientInput, formula: FormulaType = 'mifflin'): FormulaResult {
  const bmr = calculateBMR(input, formula)
  const multiplier = TDEE_ACTIVITY_MULTIPLIERS[input.activityLevel]
  const tdee = bmr * multiplier
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), formula, activityMultiplier: multiplier }
}

/**
 * Formül bazlı hedef makro hesaplama.
 * deficitPercent: -30 ile +20 arası (negatif = açık, pozitif = fazla)
 * carbRatio/proteinRatio/fatRatio: makro enerji yüzdeleri (toplamı 100 olmalı)
 */
export function calculateFormulaTargets(
  input: PatientInput,
  options: {
    formula?: FormulaType
    deficitPercent?: number    // -40 ile +40 arası
    carbPercent?: number       // varsayılan 12 (keto)
    proteinPercent?: number    // varsayılan 25
    fatPercent?: number        // varsayılan 63
    useIdealWeight?: boolean   // true ise BMR'de ideal kilo (BMI 22.5 × boy²) kullanılır
  } = {}
): TargetResult {
  const {
    formula = 'mifflin',
    deficitPercent = 0,
    carbPercent = 12,
    proteinPercent = 25,
    fatPercent = 63,
    useIdealWeight = false,
  } = options

  const bmiRef = input.bmiRef ?? 22.5
  const effectiveKg = useIdealWeight ? idealWeight(input.heightCm, bmiRef) : input.kg
  const bmr = calculateBMR({ ...input, kg: effectiveKg }, formula)
  const multiplier = TDEE_ACTIVITY_MULTIPLIERS[input.activityLevel]
  const tdee = bmr * multiplier

  const clampedDeficit = Math.max(-40, Math.min(40, deficitPercent))
  let targetKcal = tdee * (1 + clampedDeficit / 100)

  const minCal = input.gender === 'female' ? MIN_CALORIES_FEMALE : MIN_CALORIES_MALE
  targetKcal = Math.max(targetKcal, minCal)

  const carb = Math.round((targetKcal * carbPercent / 100) / 4)
  const protein = Math.round((targetKcal * proteinPercent / 100) / 4)
  const fat = Math.round((targetKcal * fatPercent / 100) / 9)

  const actualKcal = Math.round(carb * 4 + protein * 4 + fat * 9)

  return {
    calories: actualKcal,
    carb,
    protein,
    fat,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    formula,
    deficitPercent: clampedDeficit,
    activityMultiplier: multiplier,
    idealKg: round1(idealWeight(input.heightCm, bmiRef)),
    refKg: round1(referenceWeight(input.kg, input.heightCm, bmiRef)),
    bmi: round1(calculateBMI(input.kg, input.heightCm)),
  }
}

// ─── Katsayı Bazlı Hesaplama (Mevcut Sistem) ──────────────────────────────

export function calculateCoefficientTargets(input: CoefficientInput): MacroResult {
  const actMultiplier = COEFFICIENT_ACTIVITY_MULTIPLIERS[input.activityLevel] || 1.0
  let multiplier = actMultiplier

  if (input.patientGoals && input.patientGoals.length > 0) {
    if (input.patientGoals.includes('Kilo Vermek') || input.patientGoals.includes('Kilo Vermek (Yağ Yakımı)')) {
      multiplier *= 0.9
    } else if (input.patientGoals.includes('Kilo Almak') || input.patientGoals.includes('Kas Gelişimi (Hipertrofi)')) {
      multiplier *= 1.1
    }
  }

  const carb = Math.round(input.kg * input.carbFactor * multiplier)
  const protein = Math.round(input.kg * input.proteinFactor * multiplier)
  const fat = Math.round(input.kg * input.fatFactor * multiplier)
  const calories = Math.round(carb * 4 + protein * 4 + fat * 9)

  return { calories, carb, protein, fat }
}

// ─── Keto Klinik Modu ──────────────────────────────────────────────────────

/** Woodyatt-Withrow ketojenik/antiketojenik oranı — @see [R16][R17][R18] */
export function woodyattRatio(carbG: number, proteinG: number, fatG: number): number {
  const ketogenic = 0.9 * fatG + 0.46 * proteinG
  const antiketogenic = carbG + 0.58 * proteinG + 0.1 * fatG
  if (antiketogenic === 0) return Infinity
  return ketogenic / antiketogenic
}

/** K/AK = r sağlayan yağ miktarını hesapla */
function fatForKetoRatio(carbG: number, proteinG: number, targetRatio: number): number {
  // K/AK = (0.9F + 0.46P) / (C + 0.58P + 0.1F) = r
  // 0.9F + 0.46P = r(C + 0.58P + 0.1F)
  // 0.9F + 0.46P = rC + 0.58rP + 0.1rF
  // F(0.9 - 0.1r) = rC + 0.58rP - 0.46P = r(C + 0.58P) - 0.46P
  // F = (r(C + 0.58P) - 0.46P) / (0.9 - 0.1r)
  const numerator = targetRatio * (carbG + 0.58 * proteinG) - 0.46 * proteinG
  const denominator = 0.9 - 0.1 * targetRatio
  if (denominator <= 0) return Infinity
  return numerator / denominator
}

/**
 * Keto klinik hesaplama.
 * Sabit karb ≤25g, protein 1.2–1.5 × ideal kilo, yağ K/AK ≥ 1.5 veya 1.2×refKg
 * @see docs/keto-makro-kaynakca.md Bölüm D
 */
export function calculateKetoKlinik(
  input: PatientInput,
  options?: { targetKcal?: number }
): KetoKlinikResult {
  const bmiRef = input.bmiRef ?? 22.5
  const ideal = idealWeight(input.heightCm, bmiRef)
  const ref = referenceWeight(input.kg, input.heightCm, bmiRef)
  const warnings: string[] = []

  // Karbonhidrat: sabit tavan
  const carb = KETO_CARB_CEILING

  // Protein: 1.0×refKg, clamp 1.2–1.5 × idealKg
  const proteinRaw = 1.0 * ref
  const proteinMin = KETO_PROTEIN_MIN_FACTOR * ideal
  const proteinMax = KETO_PROTEIN_MAX_FACTOR * ideal
  const protein = round1(clamp(proteinRaw, proteinMin, proteinMax))

  // Yağ: max(1.2×refKg, K/AK=1.5 sağlayan yağ)
  const fatFromCoeff = KETO_FAT_FACTOR * ref
  const fatFromRatio = fatForKetoRatio(carb, protein, KETO_RATIO_TARGET)
  const fat = round1(Math.max(fatFromCoeff, fatFromRatio))

  const ketoRatio = round2(woodyattRatio(carb, protein, fat))
  const calories = Math.round(carb * 4 + protein * 4 + fat * 9)

  if (ketoRatio < 1.5) {
    warnings.push('K/AK oranı 1,5\'in altında.')
  }

  if (options?.targetKcal && calories > options.targetKcal) {
    warnings.push('Klinik keto planı hedef kaloriyi aşıyor.')
  }

  return {
    calories,
    carb,
    protein,
    fat,
    ketoRatio,
    idealKg: round1(ideal),
    refKg: round1(ref),
    warnings,
  }
}

// ─── Karşılaştırma ────────────────────────────────────────────────────────

export function compareCalculations(
  patient: PatientInput,
  coefficients: { carbFactor: number, proteinFactor: number, fatFactor: number, patientGoals?: string[] },
  options?: {
    formula?: FormulaType
    deficitPercent?: number
    carbPercent?: number
    proteinPercent?: number
    fatPercent?: number
    includeKetoKlinik?: boolean
  }
): ComparisonResult {
  const coefficient = calculateCoefficientTargets({
    kg: patient.kg,
    activityLevel: patient.activityLevel,
    carbFactor: coefficients.carbFactor,
    proteinFactor: coefficients.proteinFactor,
    fatFactor: coefficients.fatFactor,
    patientGoals: coefficients.patientGoals,
  })

  const formula = calculateFormulaTargets(patient, {
    formula: options?.formula,
    deficitPercent: options?.deficitPercent,
    carbPercent: options?.carbPercent,
    proteinPercent: options?.proteinPercent,
    fatPercent: options?.fatPercent,
  })

  let ketoKlinik: KetoKlinikResult | undefined
  if (options?.includeKetoKlinik) {
    ketoKlinik = calculateKetoKlinik(patient, { targetKcal: formula.calories })
  }

  return { coefficient, formula, ketoKlinik }
}

// ─── Deficit → Tahmini Kilo Değişimi ───────────────────────────────────────

/** Haftalık tahmini kilo değişimi (kg). Negatif = kayıp. 1 kg yağ ≈ 7700 kcal */
export function estimatedWeeklyChange(tdee: number, targetKcal: number): number {
  const dailyDelta = targetKcal - tdee
  return round2((dailyDelta * 7) / 7700)
}

/** Aylık tahmini kilo değişimi (kg) */
export function estimatedMonthlyChange(tdee: number, targetKcal: number): number {
  const dailyDelta = targetKcal - tdee
  return round1((dailyDelta * 30) / 7700)
}

// ─── Aktivite seviyesi label'ları ──────────────────────────────────────────

export const ACTIVITY_LABELS: Record<ActivityLevel, { tr: string, desc: string }> = {
  1: { tr: 'Hareketsiz', desc: 'Masa başı iş, egzersiz yok' },
  2: { tr: 'Hafif Aktif', desc: 'Haftada 1-3 gün hafif egzersiz' },
  3: { tr: 'Orta Aktif', desc: 'Haftada 3-5 gün orta yoğunluk' },
  4: { tr: 'Aktif', desc: 'Haftada 6-7 gün yoğun egzersiz' },
  5: { tr: 'Çok Aktif', desc: 'Günde 2 antrenman veya ağır fiziksel iş' },
}

export const FORMULA_LABELS: Record<FormulaType, { tr: string, desc: string }> = {
  mifflin: { tr: 'Mifflin-St Jeor', desc: 'Obez dahil en tutarlı denklem (önerilen)' },
  harris_benedict: { tr: 'Harris-Benedict', desc: 'Klasik denklem, Roza-Shizgal revizyonu (1984)' },
  katch_mcardle: { tr: 'Katch-McArdle', desc: 'BIA ölçümü gerektirir (yağsız kütle bazlı)' },
}

// ─── Yardımcılar ───────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export { TDEE_ACTIVITY_MULTIPLIERS, COEFFICIENT_ACTIVITY_MULTIPLIERS, MIN_CALORIES_FEMALE, MIN_CALORIES_MALE }
