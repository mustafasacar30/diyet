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

        const { prompt } = await req.json()

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
                usda_verified: usdaData?.verified || false,
                usda_details: usdaData?.details || null,
            })
        }

        // Insert into food_proposals
        const proposalsToInsert = verifiedFoods.map((f: any) => ({
            suggested_name: f.suggested_name,
            calories: f.calories,
            protein: f.protein,
            carbs: f.carbs,
            fat: f.fat,
            ingredients: Array.isArray(f.ingredients) ? f.ingredients.join(', ') : f.ingredients,
            recipe_text: f.recipe_text,
            portion_unit: f.portion_unit || 'porsiyon',
            status: 'pending',
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

        return NextResponse.json({ success: true, count: data.length, proposals: data })
    } catch (error: any) {
        console.error('Food Discovery AI Error:', error)
        return NextResponse.json({ error: error.message || 'Üretim sırasında bir hata oluştu' }, { status: 500 })
    }
}
