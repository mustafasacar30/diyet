import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Shared: find active plan, week, and day
async function findDietDay(patientId: string, dayNumber?: number) {
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const { data: plan } = await supabase
    .from('diet_plans')
    .select('id, diet_weeks(id, week_number, start_date, end_date)')
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan?.diet_weeks?.length) return { error: 'Aktif diyet planı bulunamadı' }

  const weeks = plan.diet_weeks as any[]
  let targetWeek = weeks.find(w => todayStr >= w.start_date && todayStr <= w.end_date)
  if (!targetWeek) {
    const todayTime = new Date(todayStr).getTime()
    let closest = weeks[0], minDist = Infinity
    for (const w of weeks) {
      const d = Math.abs(new Date(w.start_date).getTime() - todayTime)
      if (d < minDist) { minDist = d; closest = w }
    }
    targetWeek = closest
  }

  let targetDayNumber = dayNumber
  if (!targetDayNumber) {
    targetDayNumber = Math.floor(
      (new Date(todayStr).getTime() - new Date(targetWeek.start_date).getTime()) / (24 * 60 * 60 * 1000)
    ) + 1
  }

  const { data: dietDay } = await supabase
    .from('diet_days')
    .select('id')
    .eq('diet_week_id', targetWeek.id)
    .eq('day_number', targetDayNumber)
    .maybeSingle()

  if (!dietDay) return { error: `Gün ${targetDayNumber} bulunamadı` }

  return { dietDay, targetWeek, targetDayNumber }
}

// Calculate daily totals for a given diet_day
async function getDayMacros(dietDayId: string) {
  const { data: meals } = await supabase
    .from('diet_meals')
    .select('calories, protein, carbs, fat, portion_multiplier, is_consumed')
    .eq('diet_day_id', dietDayId)

  if (!meals) return { calories: 0, protein: 0, carbs: 0, fat: 0 }

  return meals.reduce((acc, m) => {
    const mult = m.portion_multiplier || 1
    return {
      calories: acc.calories + Math.round((m.calories || 0) * mult),
      protein: acc.protein + Math.round((m.protein || 0) * mult),
      carbs: acc.carbs + Math.round((m.carbs || 0) * mult),
      fat: acc.fat + Math.round((m.fat || 0) * mult),
    }
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
}

// Find food in DB by name
async function findFoodByName(foodName: string) {
  const newNameLower = foodName.toLowerCase().trim()
  let newFoods: any[] | null = null

  const { data: exact } = await supabase
    .from('foods')
    .select('id, name, calories, protein, carbs, fat')
    .ilike('name', `%${foodName}%`)
    .limit(5)
  newFoods = exact

  if (!newFoods?.length) {
    const words = foodName.split(/\s+/).filter((w: string) => w.length > 2).slice(0, 3)
    for (const word of words) {
      const { data: partial } = await supabase
        .from('foods')
        .select('id, name, calories, protein, carbs, fat')
        .ilike('name', `%${word}%`)
        .limit(10)
      if (partial?.length) {
        const scored = partial.map(f => {
          const nameLower = f.name.toLowerCase()
          const score = words.filter((w: string) => nameLower.includes(w.toLowerCase())).length
          return { ...f, score }
        }).sort((a, b) => b.score - a.score)
        newFoods = scored.slice(0, 5)
        break
      }
    }
  }

  if (!newFoods?.length) return null

  const exactMatch = newFoods.find(f => f.name.toLowerCase() === newNameLower)
  return exactMatch || newFoods[0]
}

// Get patient's target calories from patient_goals
async function getTargetCalories(patientId: string): Promise<number | null> {
  const { data } = await supabase
    .from('patients')
    .select('patient_goals')
    .eq('id', patientId)
    .maybeSingle()
  return (data?.patient_goals as any)?.target_calories || null
}

// Find a food in the day's meals that best compensates for the added food's macro profile
async function findCompensationCandidate(
  dietDayId: string,
  addedFood: { calories: number; protein: number; carbs: number; fat: number },
  excludeFoodName?: string
): Promise<{ id: string; name: string; mealTime: string; calories: number; protein: number; carbs: number; fat: number } | null> {
  const { data: meals } = await supabase
    .from('diet_meals')
    .select('id, meal_time, calories, protein, carbs, fat, foods:foods!food_id(name)')
    .eq('diet_day_id', dietDayId)

  if (!meals?.length) return null

  // Determine the dominant macro of the added food (ratio-wise)
  const addedTotal = (addedFood.protein || 0) + (addedFood.carbs || 0) + (addedFood.fat || 0)
  const addedProfile = addedTotal > 0
    ? { proteinRatio: (addedFood.protein || 0) / addedTotal, carbsRatio: (addedFood.carbs || 0) / addedTotal, fatRatio: (addedFood.fat || 0) / addedTotal }
    : { proteinRatio: 0.33, carbsRatio: 0.33, fatRatio: 0.34 }

  let bestCandidate: any = null
  let bestScore = -Infinity

  for (const m of meals) {
    const mealName = (m as any).foods?.name || ''
    if (excludeFoodName && mealName.toLowerCase() === excludeFoodName.toLowerCase()) continue
    if (!m.calories || m.calories < 20) continue // skip trivial items

    const mTotal = (m.protein || 0) + (m.carbs || 0) + (m.fat || 0)
    if (mTotal === 0) continue

    const mProfile = {
      proteinRatio: (m.protein || 0) / mTotal,
      carbsRatio: (m.carbs || 0) / mTotal,
      fatRatio: (m.fat || 0) / mTotal,
    }

    // Score: higher = better match to added food's macro profile + closer calorie match
    const profileSimilarity = 1 - (
      Math.abs(addedProfile.proteinRatio - mProfile.proteinRatio) +
      Math.abs(addedProfile.carbsRatio - mProfile.carbsRatio) +
      Math.abs(addedProfile.fatRatio - mProfile.fatRatio)
    ) / 2

    const calorieCloseness = 1 - Math.min(Math.abs(m.calories - addedFood.calories) / Math.max(addedFood.calories, 1), 1)

    const score = profileSimilarity * 60 + calorieCloseness * 40

    if (score > bestScore) {
      bestScore = score
      bestCandidate = {
        id: m.id,
        name: mealName,
        mealTime: m.meal_time,
        calories: m.calories || 0,
        protein: m.protein || 0,
        carbs: m.carbs || 0,
        fat: m.fat || 0,
      }
    }
  }

  return bestCandidate
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { patientId, action = 'swap' } = body

    if (!patientId) {
      return Response.json({ error: 'patientId gerekli' }, { status: 400 })
    }

    // ── ADD: Öğüne yemek ekle ──
    if (action === 'add') {
      const { foodName, dayNumber, mealTime, quantity = 1 } = body
      const portionMultiplier = Math.max(1, Math.min(quantity, 10))
      if (!foodName) return Response.json({ error: 'foodName gerekli' }, { status: 400 })

      const dayResult = await findDietDay(patientId, dayNumber)
      if ('error' in dayResult) return Response.json({ error: dayResult.error }, { status: 404 })
      const { dietDay } = dayResult

      const newFood = await findFoodByName(foodName)
      if (!newFood) {
        return Response.json({ error: `"${foodName}" veritabanında bulunamadı.` }, { status: 404 })
      }

      // Determine meal_time
      const slot = (mealTime || 'ÖĞLEN').toUpperCase()

      // Get next sort_order
      const { data: existingMeals } = await supabase
        .from('diet_meals')
        .select('sort_order')
        .eq('diet_day_id', dietDay.id)
        .eq('meal_time', slot)
        .order('sort_order', { ascending: false })
        .limit(1)
      const nextOrder = ((existingMeals?.[0] as any)?.sort_order || 0) + 1

      // Get macros BEFORE add
      const macrosBefore = await getDayMacros(dietDay.id)

      // Insert — is_consumed true because patient explicitly requested it via Sera
      const { error: insertErr } = await supabase.from('diet_meals').insert({
        diet_day_id: dietDay.id,
        food_id: newFood.id,
        meal_time: slot,
        portion_multiplier: portionMultiplier,
        sort_order: nextOrder,
        is_consumed: true,
        swapped_by: 'patient',
        calories: newFood.calories,
        protein: newFood.protein,
        carbs: newFood.carbs,
        fat: newFood.fat,
      })

      if (insertErr) {
        console.error('[Swap/Add] Insert error:', insertErr)
        return Response.json({ error: 'Ekleme kaydedilemedi: ' + insertErr.message }, { status: 500 })
      }

      // Get macros AFTER add
      const macrosAfter = await getDayMacros(dietDay.id)

      // Check if balance suggestion needed (deviation > ±10% from target)
      let balanceSuggestion: any = null
      const targetCalories = await getTargetCalories(patientId)
      if (targetCalories && macrosAfter.calories > 0) {
        const deviation = (macrosAfter.calories - targetCalories) / targetCalories
        if (deviation > 0.10) {
          const candidate = await findCompensationCandidate(
            dietDay.id,
            { calories: Math.round(newFood.calories * portionMultiplier), protein: Math.round(newFood.protein * portionMultiplier), carbs: Math.round(newFood.carbs * portionMultiplier), fat: Math.round(newFood.fat * portionMultiplier) },
            newFood.name
          )
          if (candidate) {
            const afterRemoval = {
              calories: macrosAfter.calories - candidate.calories,
              protein: macrosAfter.protein - candidate.protein,
            }
            balanceSuggestion = {
              reason: `Günlük kaloriniz hedefin %${Math.round(deviation * 100)} üzerinde (${macrosAfter.calories} / ${targetCalories} kcal)`,
              removeFoodName: candidate.name,
              removeMealTime: candidate.mealTime,
              removeMacros: { calories: candidate.calories, protein: candidate.protein, carbs: candidate.carbs, fat: candidate.fat },
              afterRemovalDaily: afterRemoval,
              targetCalories,
            }
          }
        }
      }

      return Response.json({
        success: true,
        action: 'add',
        food: portionMultiplier > 1 ? `${portionMultiplier}x ${newFood.name}` : newFood.name,
        mealTime: slot,
        quantity: portionMultiplier,
        foodMacros: {
          calories: Math.round(newFood.calories * portionMultiplier),
          protein: Math.round(newFood.protein * portionMultiplier),
          carbs: Math.round(newFood.carbs * portionMultiplier),
          fat: Math.round(newFood.fat * portionMultiplier),
        },
        dailyBefore: macrosBefore,
        dailyAfter: macrosAfter,
        ...(balanceSuggestion && { balanceSuggestion }),
      })
    }

    // ── REMOVE: Öğünden yemek çıkar ──
    if (action === 'remove') {
      const { foodName, dayNumber, mealTime } = body
      if (!foodName) return Response.json({ error: 'foodName gerekli' }, { status: 400 })

      const dayResult = await findDietDay(patientId, dayNumber)
      if ('error' in dayResult) return Response.json({ error: dayResult.error }, { status: 404 })
      const { dietDay } = dayResult

      // Find the meal row to remove
      let mealQuery = supabase
        .from('diet_meals')
        .select('id, food_id, meal_time, calories, protein, carbs, fat, foods:foods!food_id(name)')
        .eq('diet_day_id', dietDay.id)

      if (mealTime) {
        mealQuery = mealQuery.eq('meal_time', mealTime.toUpperCase())
      }

      const { data: meals } = await mealQuery
      if (!meals?.length) {
        return Response.json({ error: 'Bu öğünde yemek bulunamadı' }, { status: 404 })
      }

      const foodNameLower = foodName.toLowerCase()
      const targetMeal = meals.find((m: any) => {
        const name = m.foods?.name?.toLowerCase() || ''
        return name.includes(foodNameLower) || foodNameLower.includes(name.split(' ')[0])
      })

      if (!targetMeal) {
        const mealNames = meals.map((m: any) => m.foods?.name || '?').join(', ')
        return Response.json({
          error: `"${foodName}" bulunamadı. Bu öğündeki yemekler: ${mealNames}`,
        }, { status: 400 })
      }

      // Get macros BEFORE remove
      const macrosBefore = await getDayMacros(dietDay.id)

      // Delete the meal row
      const { error: deleteErr } = await supabase
        .from('diet_meals')
        .delete()
        .eq('id', targetMeal.id)

      if (deleteErr) {
        console.error('[Swap/Remove] Delete error:', deleteErr)
        return Response.json({ error: 'Silme kaydedilemedi: ' + deleteErr.message }, { status: 500 })
      }

      // Get macros AFTER remove
      const macrosAfter = await getDayMacros(dietDay.id)

      const removedName = (targetMeal as any).foods?.name || foodName

      return Response.json({
        success: true,
        action: 'remove',
        food: removedName,
        mealTime: targetMeal.meal_time,
        removedMacros: {
          calories: targetMeal.calories || 0,
          protein: targetMeal.protein || 0,
          carbs: targetMeal.carbs || 0,
          fat: targetMeal.fat || 0,
        },
        dailyBefore: macrosBefore,
        dailyAfter: macrosAfter,
      })
    }

    // ── SWAP (default) ──
    const { dayNumber, mealTime, oldFoodName, newFoodName } = body

    if (!newFoodName) {
      return Response.json({ error: 'newFoodName gerekli' }, { status: 400 })
    }

    const dayResult = await findDietDay(patientId, dayNumber)
    if ('error' in dayResult) return Response.json({ error: dayResult.error }, { status: 404 })
    const { dietDay } = dayResult

    // Find the meal to swap
    let mealQuery = supabase
      .from('diet_meals')
      .select('id, food_id, meal_time, foods:foods!food_id(name)')
      .eq('diet_day_id', dietDay.id)

    if (mealTime) {
      mealQuery = mealQuery.eq('meal_time', mealTime.toUpperCase())
    }

    const { data: meals } = await mealQuery

    if (!meals?.length) {
      return Response.json({ error: 'Bu öğünde yemek bulunamadı' }, { status: 404 })
    }

    let targetMeal: any = null
    if (oldFoodName) {
      const oldNameLower = oldFoodName.toLowerCase()
      targetMeal = meals.find((m: any) => {
        const foodName = m.foods?.name?.toLowerCase() || ''
        return foodName.includes(oldNameLower) || oldNameLower.includes(foodName.split(' ')[0])
      })
    }
    if (!targetMeal && meals.length === 1) {
      targetMeal = meals[0]
    }
    if (!targetMeal) {
      const mealNames = meals.map((m: any) => m.foods?.name || '?').join(', ')
      return Response.json({
        error: `Hangi yemeği değiştireceğim net değil. Bu öğündeki yemekler: ${mealNames}`,
      }, { status: 400 })
    }

    const newFood = await findFoodByName(newFoodName)
    if (!newFood) {
      return Response.json({ error: `"${newFoodName}" veritabanında bulunamadı.` }, { status: 404 })
    }

    // Get macros BEFORE swap
    const macrosBefore = await getDayMacros(dietDay.id)

    const { error: updateErr } = await supabase
      .from('diet_meals')
      .update({
        food_id: newFood.id,
        original_food_id: targetMeal.food_id,
        swapped_by: 'patient',
        calories: newFood.calories,
        protein: newFood.protein,
        carbs: newFood.carbs,
        fat: newFood.fat,
      })
      .eq('id', targetMeal.id)

    if (updateErr) {
      console.error('[Swap] Update error:', updateErr)
      return Response.json({ error: 'Değişiklik kaydedilemedi: ' + updateErr.message }, { status: 500 })
    }

    // Get macros AFTER swap
    const macrosAfter = await getDayMacros(dietDay.id)

    const oldName = (targetMeal as any).foods?.name || 'önceki yemek'
    return Response.json({
      success: true,
      action: 'swap',
      oldFood: oldName,
      newFood: newFood.name,
      newMacros: {
        calories: newFood.calories,
        protein: newFood.protein,
        carbs: newFood.carbs,
        fat: newFood.fat,
      },
      dailyBefore: macrosBefore,
      dailyAfter: macrosAfter,
    })
  } catch (err: any) {
    console.error('[Swap] Error:', err)
    return Response.json({ error: err.message || 'Bir hata oluştu' }, { status: 500 })
  }
}
