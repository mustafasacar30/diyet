import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GoogleGenerativeAI } from '@google/generative-ai'

// USDA nutrient IDs
const NUTRIENT_IDS = {
    protein: 1003,
    fat: 1004,
    carbs: 1005,
    kcal: 1008,
    kcal_alt1: 2047,
    kcal_alt2: 2048,
}

function extractMacrosFromUSDA(food: any) {
    const nutrients = food.foodNutrients || []
    const getNutrient = (...ids: number[]) => {
        for (const id of ids) {
            const n = nutrients.find((n: any) => n.nutrientId === id)
            if (n && n.value > 0) return n.value
        }
        return 0
    }
    return {
        protein: getNutrient(NUTRIENT_IDS.protein),
        fat: getNutrient(NUTRIENT_IDS.fat),
        carbs: getNutrient(NUTRIENT_IDS.carbs),
        kcal: getNutrient(NUTRIENT_IDS.kcal, NUTRIENT_IDS.kcal_alt1, NUTRIENT_IDS.kcal_alt2),
    }
}

function normalizeSearchToken(token: string): string {
    return token
        .toLocaleLowerCase('tr-TR')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .trim()
}

function foldTurkishChars(input: string): string {
    return normalizeSearchToken(input)
        .replace(/\u0131/g, 'i')
        .replace(/\u011F/g, 'g')
        .replace(/\u00FC/g, 'u')
        .replace(/\u015F/g, 's')
        .replace(/\u00F6/g, 'o')
        .replace(/\u00E7/g, 'c')
}

function addStemTerms(term: string, target: Set<string>) {
    const clean = term.trim()
    if (clean.length >= 4) target.add(clean.slice(0, 4))
    if (clean.length >= 5) target.add(clean.slice(0, 5))
    if (clean.length >= 6) target.add(clean.slice(0, 6))
}

function buildNameSearchTerms(input: string): string[] {
    const normalized = normalizeSearchToken(input)
    if (!normalized) return []
    const foldedNormalized = foldTurkishChars(input)
    const parts = normalized.split(/\s+/).filter(Boolean)
    const terms = new Set<string>()

    if (normalized.length >= 3) {
        terms.add(normalized)
        addStemTerms(normalized, terms)
    }
    if (foldedNormalized.length >= 3) {
        terms.add(foldedNormalized)
        addStemTerms(foldedNormalized, terms)
    }

    for (const p of parts) {
        if (p.length >= 3) {
            terms.add(p)
            addStemTerms(p, terms)
            const folded = foldTurkishChars(p)
            if (folded.length >= 3) {
                terms.add(folded)
                addStemTerms(folded, terms)
            }
        }
    }

    // Keep phrase-like 2-word segments for better exact-ish matching.
    for (let i = 0; i < parts.length - 1; i++) {
        const pair = `${parts[i]} ${parts[i + 1]}`.trim()
        if (pair.length >= 5) {
            terms.add(pair)
            const foldedPair = foldTurkishChars(pair)
            if (foldedPair.length >= 5) terms.add(foldedPair)
        }
    }

    return Array.from(terms).slice(0, 40)
}

function scoreFoodNameMatch(foodName: string, prompt: string, generatedNames: string[]) {
    const foodNorm = normalizeSearchToken(foodName)
    const promptNorm = normalizeSearchToken(prompt)
    const generatedNorm = generatedNames.map((n) => normalizeSearchToken(n)).filter(Boolean)
    const foodFold = foldTurkishChars(foodName)
    const promptFold = foldTurkishChars(prompt)
    const generatedFold = generatedNames.map((n) => foldTurkishChars(n)).filter(Boolean)

    let score = 0
    let matchType: 'exact' | 'similar' = 'similar'
    let matchSource: 'prompt' | 'ai_suggestion' = 'prompt'

    const exactAgainstPrompt = promptNorm && foodNorm === promptNorm
    const exactAgainstAi = generatedNorm.some((n) => n === foodNorm)
    const exactAgainstPromptFold = promptFold && foodFold === promptFold
    const exactAgainstAiFold = generatedFold.some((n) => n === foodFold)
    if (exactAgainstPrompt || exactAgainstAi || exactAgainstPromptFold || exactAgainstAiFold) {
        score += 100
        matchType = 'exact'
        matchSource = exactAgainstAi || exactAgainstAiFold ? 'ai_suggestion' : 'prompt'
    }

    if (
        (promptNorm && (foodNorm.includes(promptNorm) || promptNorm.includes(foodNorm))) ||
        (promptFold && (foodFold.includes(promptFold) || promptFold.includes(foodFold)))
    ) {
        score += 30
        matchSource = 'prompt'
    }

    for (const g of generatedNorm) {
        if (foodNorm.includes(g) || g.includes(foodNorm)) {
            score += 20
            matchSource = 'ai_suggestion'
        }
    }
    for (const g of generatedFold) {
        if (foodFold.includes(g) || g.includes(foodFold)) {
            score += 20
            matchSource = 'ai_suggestion'
        }
    }

    const promptTokens = new Set(extractSearchTokens(prompt))
    const foodTokens = normalizeSearchToken(foodName).split(/\s+/).filter((t) => t.length >= 3)
    const overlap = foodTokens.filter((t) => promptTokens.has(t)).length
    score += Math.min(overlap, 5) * 3

    const promptTokensFold = new Set(extractSearchTokens(prompt).map((t) => foldTurkishChars(t)))
    const foodTokensFold = foldTurkishChars(foodName).split(/\s+/).filter((t) => t.length >= 3)
    const overlapFold = foodTokensFold.filter((t) => promptTokensFold.has(t)).length
    score += Math.min(overlapFold, 5) * 3

    return { score, matchType, matchSource }
}

function mergeBaseFoodWithOverride(baseFood: any, override: any) {
    if (!override) return baseFood
    const merged = { ...baseFood }
    const fields = ['name', 'calories', 'protein', 'carbs', 'fat', 'portion_unit', 'tags', 'compatibility_tags', 'ingredients', 'recipe_text']
    for (const field of fields) {
        if (override[field] !== null && override[field] !== undefined) {
            merged[field] = override[field]
        }
    }
    return merged
}

function extractSearchTokens(prompt: string): string[] {
    const stopWords = new Set([
        've', 'ile', 'icin', 'gibi', 'olan', 'olsun', 'uygun', 'gore', 'ama', 'veya',
        'bir', 'iki', 'uc', 'dort', 'bes', 'yedi', 'sekiz', 'dokuz', 'on', 'adet', 'gram',
        'ogun', 'kahvalti', 'ogle', 'aksam', 'ara', 'diyet', 'tarif', 'tarifi', 'yemek', 'yemekler',
        'isterim', 'istiyorum'
    ])
    const tokens = foldTurkishChars(prompt)
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !stopWords.has(t))
    return Array.from(new Set(tokens)).slice(0, 8)
}
async function searchUSDA(query: string, apiKey: string): Promise<any | null> {
    try {
        const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=5&dataType=Foundation,SR%20Legacy`
        const res = await fetch(url)
        const contentType = res.headers.get('content-type') || ''
        if (!contentType.includes('json')) return null
        const data = await res.json()
        if (!res.ok || !data.foods || data.foods.length === 0) return null

        // Find best match with kcal > 0
        let bestFood = null
        let bestMacros = null
        for (const candidate of data.foods) {
            const macros = extractMacrosFromUSDA(candidate)
            if (macros.kcal > 0 || !bestFood) {
                bestFood = candidate
                bestMacros = macros
                if (macros.kcal > 0) break
            }
        }
        return bestMacros
    } catch {
        return null
    }
}

async function verifyMacrosWithUSDA(ingredients: string, geminiKey: string, usdaKey: string) {
    // Step 1: Use Gemini to translate ingredients to English with gram weights
    const genAI = new GoogleGenerativeAI(geminiKey)
    const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    })

    const translatePrompt = `Sen bir gıda bilimci ve beslenme uzmanısın. Aşağıdaki Türkçe malzeme listesindeki her malzeme için USDA FoodData Central veritabanında aranabilecek İngilizce gıda adını ve gram miktarını ver.

ÖNEMLİ KURALLAR:
1. İngilizce adı USDA'nın kullandığı standart formatta yaz. Örnekler:
   - badem unu → "Nuts, almonds, blanched"
   - yumurta → "Egg, whole, raw, fresh"
   - zeytinyağı → "Oil, olive, salad or cooking"
   - tereyağı → "Butter, salted"
   - beyaz peynir → "Cheese, feta"
   - ıspanak → "Spinach, raw"
   - un → "Wheat flour, white, all-purpose"
   - süt → "Milk, whole, 3.25% milkfat"
   - krema → "Cream, fluid, heavy whipping"
2. Tatlandırıcılar (eritritol, stevia, monk fruit, sukraloz) → name_en = "ZERO_CAL_SWEETENER"
3. Tuz, su, baharat (karabiber, pul biber, kekik vs.) → name_en = "NEGLIGIBLE"
4. Gram hesaplama:
   - 1 su bardağı ≈ 240ml sıvı, 120g un, 140g şeker
   - 1 yemek kaşığı ≈ 15g, 1 çay kaşığı ≈ 5g
   - 1 büyük yumurta ≈ 50g, 1 yumurta sarısı ≈ 17g
   - 100ml sıvı yağ ≈ 92g

SADECE JSON dizisi döndür:
[{"name_en": "Egg, whole, raw, fresh", "grams": 200, "original": "4 adet büyük boy yumurta"}, ...]

Malzeme listesi:
${ingredients}`

    const translateResult = await model.generateContent([translatePrompt])
    const translateText = translateResult.response.text()
    const parsedIngredients = JSON.parse(translateText)

    if (!Array.isArray(parsedIngredients) || parsedIngredients.length === 0) {
        throw new Error('Malzeme çevirisi başarısız')
    }

    // Step 2: Query USDA for each ingredient
    const totals = { carbs: 0, protein: 0, fat: 0, calories: 0 }
    const details: any[] = []
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

    for (let i = 0; i < parsedIngredients.length; i++) {
        const ing = parsedIngredients[i]

        if (ing.name_en === 'ZERO_CAL_SWEETENER' || ing.name_en === 'NEGLIGIBLE') {
            details.push({ original: ing.original, usda: ing.name_en, grams: ing.grams, carbs: 0, protein: 0, fat: 0, kcal: 0, found: true })
            continue
        }

        if (i > 0) await delay(500) // Rate limit

        const macros = await searchUSDA(ing.name_en, usdaKey)
        if (macros) {
            const factor = (ing.grams || 0) / 100
            const contrib = {
                carbs: Math.round(macros.carbs * factor * 10) / 10,
                protein: Math.round(macros.protein * factor * 10) / 10,
                fat: Math.round(macros.fat * factor * 10) / 10,
                kcal: Math.round(macros.kcal * factor * 10) / 10,
            }
            totals.carbs += contrib.carbs
            totals.protein += contrib.protein
            totals.fat += contrib.fat
            totals.calories += contrib.kcal
            details.push({ original: ing.original, usda: ing.name_en, grams: ing.grams, ...contrib, found: true })
        } else {
            details.push({ original: ing.original, usda: ing.name_en, grams: ing.grams, carbs: 0, protein: 0, fat: 0, kcal: 0, found: false })
        }
    }

    return {
        totals: {
            calories: Math.round(totals.calories),
            protein: Math.round(totals.protein),
            carbs: Math.round(totals.carbs),
            fat: Math.round(totals.fat),
        },
        details,
        verified: true,
    }
}

export async function POST(req: Request) {
    try {
        const geminiKey = process.env.GEMINI_API_KEY
        const usdaKey = process.env.USDA_API_KEY

        if (!geminiKey) {
            return NextResponse.json({ error: 'Gemini API yapılandırılmamış (GEMINI_API_KEY eksik)' }, { status: 503 })
        }

        const genAI = new GoogleGenerativeAI(geminiKey)

        const { prompt, userId, teamOwnerId } = await req.json()

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt gereklidir' }, { status: 400 })
        }

        const { data: promptData, error: promptError } = await supabaseAdmin
            .from('system_prompts')
            .select('*')
            .eq('key', 'food_discovery')
            .single()

        if (promptError || !promptData) {
            console.error('System prompt not found:', promptError)
            return NextResponse.json({ error: 'Sistem promptu (food_discovery) bulunamadı.' }, { status: 500 })
        }

        // Fetch custom search sites from system_settings
        let siteFilterMessage = ""
        try {
            const { data: settingsData } = await supabaseAdmin
                .from('system_settings')
                .select('value')
                .eq('key', 'discovery_search_sites')
                .maybeSingle()
            
            let activeSites = ""
            if (settingsData?.value) {
                if (Array.isArray(settingsData.value)) {
                    activeSites = settingsData.value
                        .filter((s: any) => s.enabled)
                        .map((s: any) => s.url)
                        .join(', ')
                } else if (typeof settingsData.value === 'string') {
                    activeSites = settingsData.value
                }
            }

            if (activeSites) {
                siteFilterMessage = `\n\n🔍 ARAŞTIRMA KAYNAKLARI: SADECE şu web sitelerindeki tarifleri ve gıda türlerini referans al: ${activeSites}. Diğer sitelerdeki tarifleri dikkate alma.`
            } else {
                siteFilterMessage = `\n\n🔍 ARAŞTIRMA KAYNAKLARI: Türkiye'deki popüler yemek tarifi sitelerini (nefisyemektarifleri.com, lezzet.com.tr, yemek.com vb.) referans alabilirsin.`
            }
        } catch (e) {
            console.warn('Could not fetch discovery sites:', e)
        }

        const systemMessage = promptData.prompt_template + siteFilterMessage +
            "\n\nÖNEMLİ KURALLAR: Her yemek için JSON çıktısında 'total_servings' (toplam servis sayısı, örn: 4 veya 15) ve 'portion_unit' (servis birimi, örn: 'porsiyon', 'dilim', 'adet', 'kase') bilgisini mutlaka ekle. DİKKAT: Kurabiye, poğaça, köfte, kraker gibi TEK TEK SAYILAN tariflerde portion_unit KESİNLİKLE 'adet' olmalı ve total_servings bu malzemeden toplam KAÇ TANE (örn: 15 veya 20) çıkacağını net olarak belirtmelidir! Asla bu tür tariflere '1 porsiyon' demeyin. Ayrıca hazırlanış (recipe_text) metninin EN SONUNA doğal bir dil ile bu detayı ekleyin (Örn: '15 adet kurabiye elde edeceksiniz.' veya '4 kaseye paylaştırarak sunun.'). Sunulan malzemeler bu toplam porsiyon miktarını (tüm tencereyi/tepsiyi/hamuru) ifade etmelidir. Ancak kalori, protein, karbonhidrat ve yağ makro değerleri KESİNLİKLE SADECE 1 BİRİM (örn: 1 adet kurabiye, 1 dilim börek) İÇİN hesaplanmış olmalıdır!"

        // Fetch existing food names to prevent duplicates
        let excludeMessage = ""
        let existingFoodsFromDb: any[] = []
        try {
            const { data: existingFoods } = await supabaseAdmin
                .from('foods')
                .select('name')
                .not('name', 'is', null)
            if (existingFoods && existingFoods.length > 0) {
                const foodNames = existingFoods.map(f => f.name).join(', ')
                excludeMessage = `\n\n⛔ YASAK LİSTESİ: Aşağıdaki yemekler zaten veritabanımızda MEVCUT. Bunları ASLA üretme, bunlarla aynı isimde veya çok benzer tarifleri önerme. TAMAMEN FARKLI ve YENİ yemekler üret:\n${foodNames}`
            }
        } catch (e) {
            console.warn('Could not fetch existing foods for dedup:', e)
        }

        try {
            const promptTokens = extractSearchTokens(prompt)
            if (promptTokens.length > 0) {
                const orFilter = promptTokens
                    .map((token) => `name.ilike.%${token.replace(/[%_]/g, '')}%`)
                    .join(',')
                const { data: matchedFoods } = await supabaseAdmin
                    .from('foods')
                    .select('id,name,calories,protein,carbs,fat,portion_unit,image_url,recipe_text,tags,compatibility_tags')
                    .or(orFilter)
                    .limit(12)
                existingFoodsFromDb = matchedFoods || []
            }
        } catch (e) {
            console.warn('Could not fetch existing foods by prompt:', e)
        }

        const selectedModel = promptData.model || "gemini-1.5-flash"
        const selectedTemperature = promptData.temperature ?? 0.7

        const model = genAI.getGenerativeModel({
            model: selectedModel,
            generationConfig: {
                temperature: selectedTemperature,
                responseMimeType: "application/json"
            }
        })

        const result = await model.generateContent([
            systemMessage + excludeMessage,
            prompt
        ])

        const aiResponseText = result.response.text()
        if (!aiResponseText) {
            throw new Error("AI yanıt vermedi")
        }

        const aiResult = JSON.parse(aiResponseText)
        const newFoods = aiResult.foods

        if (!newFoods || !Array.isArray(newFoods) || newFoods.length === 0) {
            throw new Error("Geçerli bir yemek listesi üretilemedi")
        }

        // Improve "we already have this" cards by matching prompt + AI suggested names together.
        try {
            const generatedNames = newFoods
                .map((f: any) => String(f?.suggested_name || '').trim())
                .filter(Boolean)

            const mergedTerms = new Set<string>([
                ...extractSearchTokens(prompt),
                ...buildNameSearchTerms(prompt),
                ...generatedNames.flatMap((n) => buildNameSearchTerms(n)),
            ])

            const queryTerms = Array.from(mergedTerms)
                .map((t) => t.replace(/[%_]/g, '').trim())
                .filter((t) => t.length >= 3)
                .slice(0, 24)

            if (queryTerms.length > 0) {
                const orFilter = queryTerms.map((term) => `name.ilike.%${term}%`).join(',')
                const { data: matchedFoodsByNames } = await supabaseAdmin
                    .from('foods')
                    .select('id,name,calories,protein,carbs,fat,portion_unit,image_url,recipe_text,tags,compatibility_tags')
                    .or(orFilter)
                    .limit(60)

                let mergedFoodsBySource: any[] = matchedFoodsByNames || []
                const ownerForTeamScope = teamOwnerId || userId || null

                if (ownerForTeamScope) {
                    const { data: matchedOverrides } = await supabaseAdmin
                        .from('team_food_overrides')
                        .select('base_food_id,name,calories,protein,carbs,fat,portion_unit,tags,compatibility_tags,ingredients,recipe_text')
                        .eq('team_owner_id', ownerForTeamScope)
                        .or(orFilter)
                        .limit(120)

                    const overrideRows = matchedOverrides || []
                    const overrideBaseIds = Array.from(new Set(overrideRows.map((r: any) => r.base_food_id).filter(Boolean)))

                    if (overrideBaseIds.length > 0) {
                        const { data: baseFoodsForOverrides } = await supabaseAdmin
                            .from('foods')
                            .select('id,name,calories,protein,carbs,fat,portion_unit,image_url,recipe_text,tags,compatibility_tags')
                            .in('id', overrideBaseIds)
                            .limit(200)

                        const overrideMap = new Map<string, any>()
                        for (const row of overrideRows) {
                            if (row?.base_food_id) overrideMap.set(row.base_food_id, row)
                        }

                        const mergedOverrideFoods = (baseFoodsForOverrides || []).map((baseFood: any) =>
                            mergeBaseFoodWithOverride(baseFood, overrideMap.get(baseFood.id))
                        )

                        mergedFoodsBySource = [...mergedFoodsBySource, ...mergedOverrideFoods]
                    }
                }

                const baseList = Array.isArray(existingFoodsFromDb) ? existingFoodsFromDb : []
                const mergedById = new Map<string, any>()

                for (const f of baseList) {
                    if (f?.id) mergedById.set(f.id, f)
                }
                for (const f of mergedFoodsBySource || []) {
                    if (f?.id) mergedById.set(f.id, f)
                }

                const ranked = Array.from(mergedById.values())
                    .map((food: any) => {
                        const match = scoreFoodNameMatch(food.name || '', prompt, generatedNames)
                        return {
                            ...food,
                            match_type: match.matchType,
                            match_source: match.matchSource,
                            match_score: match.score,
                        }
                    })
                    .sort((a, b) => b.match_score - a.match_score)
                    .slice(0, 12)

                existingFoodsFromDb = ranked
            }

            // Safety fallback: if SQL ilike/or misses Turkish-character variants,
            // do an in-memory fuzzy pass on a wider food slice.
            if (!existingFoodsFromDb?.length) {
                const { data: wideFoods } = await supabaseAdmin
                    .from('foods')
                    .select('id,name,calories,protein,carbs,fat,portion_unit,image_url,recipe_text,tags,compatibility_tags')
                    .not('name', 'is', null)
                    .limit(2000)

                const ownerForTeamScope = teamOwnerId || userId || null
                let wideMergedFoods = wideFoods || []

                if (ownerForTeamScope) {
                    const { data: wideOverrides } = await supabaseAdmin
                        .from('team_food_overrides')
                        .select('base_food_id,name,calories,protein,carbs,fat,portion_unit,tags,compatibility_tags,ingredients,recipe_text')
                        .eq('team_owner_id', ownerForTeamScope)
                        .not('name', 'is', null)
                        .limit(2000)

                    if (wideOverrides?.length) {
                        const overrideMap = new Map<string, any>()
                        for (const row of wideOverrides) {
                            if (row?.base_food_id) overrideMap.set(row.base_food_id, row)
                        }

                        wideMergedFoods = (wideFoods || []).map((baseFood: any) =>
                            mergeBaseFoodWithOverride(baseFood, overrideMap.get(baseFood.id))
                        )
                    }
                }

                const rankedWide = (wideMergedFoods || [])
                    .map((food: any) => {
                        const match = scoreFoodNameMatch(food.name || '', prompt, generatedNames)
                        return {
                            ...food,
                            match_type: match.matchType,
                            match_source: match.matchSource,
                            match_score: match.score,
                        }
                    })
                    .filter((food: any) => food.match_score > 0)
                    .sort((a: any, b: any) => b.match_score - a.match_score)
                    .slice(0, 12)

                existingFoodsFromDb = rankedWide
            }
        } catch (e) {
            console.warn('Could not improve existing food matches:', e)
        }

        // USDA Verification: If USDA key is available, verify macros for each food
        const verifiedFoods = []
        for (const food of newFoods) {
            let usdaData = null
            if (usdaKey && food.ingredients) {
                try {
                    const ingredientText = Array.isArray(food.ingredients)
                        ? food.ingredients.join('\n')
                        : food.ingredients
                    usdaData = await verifyMacrosWithUSDA(ingredientText, geminiKey, usdaKey)

                    // Scale USDA totals by total_servings to get per-unit macros
                    const totalServings = food.total_servings || 1
                    if (usdaData && usdaData.verified) {
                        food.calories = Math.round(usdaData.totals.calories / totalServings)
                        food.protein = Math.round(usdaData.totals.protein / totalServings)
                        food.carbs = Math.round(usdaData.totals.carbs / totalServings)
                        food.fat = Math.round(usdaData.totals.fat / totalServings)
                    }
                } catch (usdaError: any) {
                    console.warn(`USDA verification failed for ${food.suggested_name}: ${usdaError.message}. Using AI estimates.`)
                }
            }

            verifiedFoods.push({
                ...food,
                id: crypto.randomUUID(),
                usda_verified: usdaData?.verified || false,
                usda_details: usdaData?.details || null,
            })
        }

        const owner = teamOwnerId || userId
        const metaValues: any = { pending_approval: true }
        if (owner) {
            metaValues.team_owner_id = owner
        }

        // Insert into foods table to make it visible to the team immediately
        const foodsToInsert = verifiedFoods.map((f: any) => ({
            id: f.id,
            name: f.suggested_name,
            calories: f.calories || 0,
            protein: f.protein || 0,
            carbs: f.carbs || 0,
            fat: f.fat || 0,
            portion_unit: f.portion_unit || 'porsiyon',
            category: 'AI Önerisi',
            role: 'mainDish',
            ingredients: Array.isArray(f.ingredients) ? f.ingredients.join(', ') : f.ingredients,
            recipe_text: f.recipe_text,
            meta: metaValues,
            tags: f.tags || []
        }))

        if (foodsToInsert.length > 0) {
            const { error: foodsError } = await supabaseAdmin
                .from('foods')
                .insert(foodsToInsert)
            
            if (foodsError) {
                console.error("Foods Insert Error:", foodsError)
            }
        }

        // Insert into food_proposals
        const proposalsToInsert = verifiedFoods.map((f: any) => ({
            id: f.id,
            suggested_name: f.suggested_name,
            calories: f.calories,
            protein: f.protein,
            carbs: f.carbs,
            fat: f.fat,
            ingredients: Array.isArray(f.ingredients) ? f.ingredients.join(', ') : f.ingredients,
            recipe_text: f.recipe_text,
            portion_unit: f.portion_unit || 'porsiyon',
            status: 'pending',
            user_id: owner || null,
            ai_analysis: {
                generated_tags: f.tags || [],
                prompt_used: prompt,
                total_servings: f.total_servings || 1,
                usda_verified: f.usda_verified || false,
                usda_details: f.usda_details || null,
            },
            admin_note: f.usda_verified ? 'AI Keşif + USDA Doğrulanmış' : 'AI Keşif Motoru Tarafından Üretildi',
        }))

        const { data, error } = await supabaseAdmin
            .from('food_proposals')
            .insert(proposalsToInsert)
            .select()

        if (error) {
            console.error("Supabase Insert Error:", error)
            throw new Error("Veritabanına kaydedilemedi: " + error.message)
        }

        return NextResponse.json({
            success: true,
            count: data.length,
            proposals: data,
            existingFoods: existingFoodsFromDb,
        })
    } catch (error: any) {
        console.error('Food Discovery AI Error:', error)
        return NextResponse.json({ error: error.message || 'Üretim sırasında bir hata oluştu' }, { status: 500 })
    }
}
