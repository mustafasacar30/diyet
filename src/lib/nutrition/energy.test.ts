/**
 * energy.ts modül testleri.
 * Opus 5.5 spec'inden gelen test vakaları + katsayı sistemi doğrulaması.
 * Çalıştır: npx tsx src/lib/nutrition/energy.test.ts
 */

import {
  bmrMifflin,
  bmrHarrisBenedict,
  idealWeight,
  referenceWeight,
  calculateBMI,
  calculateKetoKlinik,
  calculateCoefficientTargets,
  calculateFormulaTargets,
  woodyattRatio,
  estimatedMonthlyChange,
  type PatientInput,
} from './energy'

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`  OK: ${msg}`)
}

function approx(a: number, b: number, tol: number = 1): boolean {
  return Math.abs(a - b) <= tol
}

console.log('\n=== BMR Formülleri ===')

// Mifflin — K, 38y, 165cm, 95kg
// 10×95 + 6.25×165 - 5×38 - 161 = 950+1031.25-190-161 = 1630.25
const bmrA = bmrMifflin(95, 165, 38, 'female')
console.log(`  Mifflin K 38y 165cm 95kg = ${bmrA.toFixed(1)}`)
assert(approx(bmrA, 1630, 2), 'Mifflin BMR ~1630')

// Harris-Benedict — K, 38y, 165cm, 95kg
// 447.593 + 9.247×95 + 3.098×165 - 4.330×38 = 1672.7
const bmrHB = bmrHarrisBenedict(95, 165, 38, 'female')
console.log(`  Harris-Benedict K 38y 165cm 95kg = ${bmrHB.toFixed(1)}`)
assert(approx(bmrHB, 1673, 5), 'Harris-Benedict BMR ~1673')

console.log('\n=== Referans Kilo ===')

// BMI 22.5 ile ideal kilo
const idealA = idealWeight(165, 22.5)
console.log(`  İdeal kilo (165cm, BMI 22.5) = ${idealA.toFixed(1)} kg`)
assert(approx(idealA, 61.3, 0.5), 'İdeal kilo ~61.3')

// Düzeltilmiş kilo (95kg, BMI>30)
const refA = referenceWeight(95, 165, 22.5)
console.log(`  Düzeltilmiş kilo (95kg, 165cm) = ${refA.toFixed(1)} kg`)
assert(approx(refA, 69.7, 1), 'Referans kilo ~69.7')

// BMI < 30 ise referans = gerçek kilo
const refNormal = referenceWeight(65, 170, 22.5)
console.log(`  Normal BMI (65kg, 170cm) ref = ${refNormal.toFixed(1)} kg`)
assert(approx(refNormal, 65, 0.1), 'Normal BMI → referans = gerçek')

console.log('\n=== Keto Klinik — Test Vakaları (bmiRef: 22.5) ===')

// Vaka A: K, 38y, 165cm, 95kg, sedentary
const vakaA: PatientInput = { kg: 95, heightCm: 165, age: 38, gender: 'female', activityLevel: 1, bmiRef: 22.5 }
const ketoA = calculateKetoKlinik(vakaA)
console.log(`  Vaka A: P=${ketoA.protein} F=${ketoA.fat} K/AK=${ketoA.ketoRatio} kcal=${ketoA.calories}`)
assert(approx(ketoA.protein, 73.5, 2), `Vaka A protein ~73.5 (got ${ketoA.protein})`)
assert(ketoA.ketoRatio >= 1.49, `Vaka A K/AK >= 1.5 (got ${ketoA.ketoRatio})`)
assert(approx(ketoA.calories, 1206, 30), `Vaka A kcal ~1206 (got ${ketoA.calories})`)

// Vaka B: K, 52y, 160cm, 120kg, light
const vakaB: PatientInput = { kg: 120, heightCm: 160, age: 52, gender: 'female', activityLevel: 2, bmiRef: 22.5 }
const ketoB = calculateKetoKlinik(vakaB)
console.log(`  Vaka B: P=${ketoB.protein} F=${ketoB.fat} K/AK=${ketoB.ketoRatio} kcal=${ketoB.calories}`)
assert(approx(ketoB.protein, 73.2, 3), `Vaka B protein ~73.2 (got ${ketoB.protein})`)
assert(ketoB.ketoRatio >= 1.49, `Vaka B K/AK >= 1.5 (got ${ketoB.ketoRatio})`)

// Vaka C: K, 28y, 170cm, 72kg, moderate
const vakaC: PatientInput = { kg: 72, heightCm: 170, age: 28, gender: 'female', activityLevel: 3, bmiRef: 22.5 }
const ketoC = calculateKetoKlinik(vakaC)
console.log(`  Vaka C: P=${ketoC.protein} F=${ketoC.fat} K/AK=${ketoC.ketoRatio} kcal=${ketoC.calories}`)
assert(approx(ketoC.protein, 78, 3), `Vaka C protein ~78 (got ${ketoC.protein})`)
assert(ketoC.ketoRatio >= 1.49, `Vaka C K/AK >= 1.5 (got ${ketoC.ketoRatio})`)

// Vaka D: E, 45y, 180cm, 110kg, moderate — fat by 1.2×refKg dominates
const vakaD: PatientInput = { kg: 110, heightCm: 180, age: 45, gender: 'male', activityLevel: 3, bmiRef: 22.5 }
const ketoD = calculateKetoKlinik(vakaD)
console.log(`  Vaka D: P=${ketoD.protein} F=${ketoD.fat} K/AK=${ketoD.ketoRatio} kcal=${ketoD.calories}`)
assert(approx(ketoD.protein, 87.5, 3), `Vaka D protein ~87.5 (got ${ketoD.protein})`)
assert(ketoD.ketoRatio >= 1.49, `Vaka D K/AK >= 1.5 (got ${ketoD.ketoRatio})`)

console.log('\n=== Katsayı Sistemi (Mevcut) ===')

// EK fazı: carb=0.3, prot=0.8, fat=1.2 — 95kg, activity=1
const coeff = calculateCoefficientTargets({
  kg: 95, activityLevel: 1,
  carbFactor: 0.3, proteinFactor: 0.8, fatFactor: 1.2,
  patientGoals: ['Kilo Vermek'],
})
console.log(`  EK faz (95kg, act=1, kilo vermek): C=${coeff.carb} P=${coeff.protein} F=${coeff.fat} kcal=${coeff.calories}`)
// 95 × 0.3 × 0.8 × 0.9 = 20.5 → 21
// 95 × 0.8 × 0.8 × 0.9 = 54.7 → 55
// 95 × 1.2 × 0.8 × 0.9 = 82.1 → 82
assert(approx(coeff.carb, 21, 1), `EK carb ~21 (got ${coeff.carb})`)
assert(approx(coeff.protein, 55, 1), `EK protein ~55 (got ${coeff.protein})`)

console.log('\n=== Formül Bazlı Hedef ===')

// Mifflin, deficit -15%, keto oranları (12/25/63)
const formulaTarget = calculateFormulaTargets(vakaA, {
  formula: 'mifflin',
  deficitPercent: -15,
  carbPercent: 12, proteinPercent: 25, fatPercent: 63,
})
console.log(`  Formül hedef: BMR=${formulaTarget.bmr} TDEE=${formulaTarget.tdee} target=${formulaTarget.calories}`)
console.log(`  C=${formulaTarget.carb} P=${formulaTarget.protein} F=${formulaTarget.fat}`)
assert(formulaTarget.bmr > 1400 && formulaTarget.bmr < 1700, `BMR makul aralıkta (${formulaTarget.bmr})`)
assert(formulaTarget.tdee > formulaTarget.bmr, 'TDEE > BMR')
assert(formulaTarget.calories < formulaTarget.tdee, 'Deficit ile hedef < TDEE')

console.log('\n=== Woodyatt-Withrow K/AK ===')
const ratio = woodyattRatio(25, 75, 90)
console.log(`  K/AK (C=25, P=75, F=90) = ${ratio.toFixed(2)}`)
assert(ratio > 1.4 && ratio < 1.7, `K/AK makul (${ratio.toFixed(2)})`)

console.log('\n=== Tahmini Kilo Değişimi ===')
const monthly = estimatedMonthlyChange(1800, 1500)
console.log(`  TDEE=1800, target=1500 → aylık ${monthly} kg`)
assert(monthly < 0, 'Deficit ile kilo kaybı olmalı')
assert(approx(monthly, -1.2, 0.3), `Aylık kayıp ~1.2 (got ${monthly})`)

console.log('\n✓ Tüm testler geçti!\n')
