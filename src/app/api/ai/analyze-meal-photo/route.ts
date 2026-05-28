
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Removed deprecated config

export async function POST(req: NextRequest) {
    try {
        if (!genAI) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 503 });
        }

        const { image, description } = await req.json();

        if (!image) {
            return NextResponse.json({ error: 'Image data required (base64)' }, { status: 400 });
        }

        // Clean base64 string
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Use 2.0 Flash for best vision performance

        const prompt = `
        !!! ÇOK ÖNEMLİ DİKKAT - SANSÜR / KARALAMA KURALI !!!
        Fotoğrafta bazı alanlar (örneğin kurabiyeler, etler, sebzeler) kullanıcı tarafından SİYAH, BEYAZ veya RENKLİ fırça darbeleriyle tamamen kapatılmış/karalanmış olabilir. 
        BU KARALANMIŞ ALANLARI KESİNLİKLE YOK SAYACAKSIN!
        Eğer bir nesnenin üzeri boyanarak kapatılmışsa, onu ASLA listeye "Karalanmış yiyecek", "Bilinmeyen öğe" veya asıl adıyla ekleme.
        Sadece hiçbir karalama veya sansür işlemi UYGULANMAMIŞ, açıkça görünen yiyecekleri say ve analiz et.
        ÖRNEK: Tabakta 3 kurabiye varsa ama 1 tanesinin üzeri tamamen siyah/renkli çizilerek kapatılmışsa, cevabında sadece "2 adet kurabiye" olmalıdır. Karalanan nesne hiç yokmuş gibi davran.

        Sen uzman bir Türk diyetisyensin. Fotoğraftaki yemeği analiz et.
        
        GÖREVİN:
        1. Her bir yiyeceği ayrı ayrı tanımla (Örn: Köfte, Pilav, Salata, Ayran).
        2. Miktarını tahmin et (Göz kararı porsiyon, gramaj veya kaşık hesabı).
        3. Her biri için makro değerlerini (Protein, Karb, Yağ) hesapla.
        4. Kalori = (Protein * 4) + (Karb * 4) + (Yağ * 9) formülüyle hesapla.
        5. Karışık/katmanlı yiyecekler için "ingredients" (alt malzemeler) listesi döndür.
        6. JSON formatında döndür.

        BAĞLAMSAL ANALİZ KURALLARI:
        - Çoklu aynı nesneler kuralı: Eğer tabakta aynı yiyecekten birden fazla varsa (örn: 3 adet kurabiye, 5 dilim ekmek, 4 kare çikolata), yiyeceği TEK BİR BİRİM (örneğin 1 adet kurabiye, 1 kare çikolata) olarak düşün. Kalori, protein, carb, fat değerlerini SADECE 1 birim için hesapla. Sonra resimdeki o nesnelerin toplam sayısını "quantity" alanına (sayısal olarak) gir. "unit" alanına da "adet", "dilim", "kare", "parça" gibi uygun birimi yaz.
        - Bardak/kupada katmanlı tatlı → bütünsel değerlendir AMA alt malzemelerini "ingredients" içinde listele.
        - Türk mutfağına özgü isimlendirme kullan: "yoğurt" tercih et ("süt kreması" değil), "pekmez" ("şurup" değil).
        - Tabakta tek bir porsiyon bütünse (örn: bardakta puding), onu tek bir öğe olarak listele, ingredients'da içindekileri ver.
        - Ama tabakta açıkça ayrı yiyecekler varsa (pilav + köfte + salata), her birini ayrı öğe olarak listele, ingredients boş olabilir.
        - Porsiyon tahmini yaparken kabın boyutunu referans al (standart bardak ~200ml, yemek tabağı ~25cm).
        - Kahvaltı tabağı gibi karışık tabaklar için: tüm öğeler ayrı ayrı listelensin ama tablak ismi ana öğe, alt malzemeler ingredients olsun.

        INGREDIENTS KURALLARI:
        - Karışık/katmanlı yiyecekler (puding, smoothie, salata, kahvaltı tabağı): "ingredients" dolu olsun.
        - Basit/tekli yiyecekler (elma, ekmek, su): "ingredients" boş dizi [] olsun.
        - Her ingredient'ın makroları ayrı hesaplansın.
        - Tüm ingredient'ların protein/carbs/fat toplamı ana öğenin protein/carbs/fat toplamına eşit olmalı. Eğer quantity>1 ise, ingredients kısmında da 1 ana ünite için geçerli miktarlar yazılmalıdır.

        JSON ŞEMA:
        {
          "items": [
            {
              "food_name": "Yiyecek Adı (TR)",
              "portion_guess": "Tahmini Porsiyon (Örn: Toplam 3 Adet, 150g)",
              "quantity": 1,
              "unit": "adet",
              "calories": 0,
              "protein": 0,
              "carbs": 0,
              "fat": 0,
              "per_unit_protein": 0,
              "per_unit_carbs": 0,
              "per_unit_fat": 0,
              "ingredients": [
                {
                  "name": "Alt malzeme adı",
                  "quantity": 100,
                  "unit": "gram",
                  "protein": 0,
                  "carbs": 0,
                  "fat": 0,
                  "included": true
                }
              ]
            }
          ],
          "total_calories": 0,
          "analysis_note": "Kısa bir not (Örn: 'Porsiyonlar göz kararı tahmin edilmiştir.')"
        }
        
        ${description ? `
        ÖNEMLİ — KULLANICI NOTU / İPUCU:
        Kullanıcı bu yemek hakkında şu bilgiyi verdi: "${description}"
        
        Bu notu ÇOK DİKKATLİ analiz et ve şu kurallara göre uygula:
        
        1. MALZEME TANIMLAMA: Kullanıcı bir katmanı veya bileşeni tanımlıyorsa (örn: "beyaz katman krema", "üstü kakao"), o bileşeni tarif edilen malzeme olarak listele.
        2. YEMEYECEĞİM / HARİÇ: Kullanıcı bir bileşeni yemeyeceğini belirtiyorsa (örn: "kaymak kısmını yemeyeceğim", "krema hariç"), o ingredient'ı AYRI BİR ÜST-SEVİYE ITEM OLARAK EKLEME! Aynı yiyeceğin "ingredients" dizisi içinde "included": false olarak ekle. Tüm bileşenler tek bir item'ın alt malzemeleri olmalı.
        3. DİYET BAĞLAMI: "Ketojenik", "vegan", "glutensiz" gibi diyet tanımları varsa, malzemeleri buna uygun tahmin et. Örneğin "ketojenik tiramisu" için şeker yerine tatlandırıcı, un yerine badem unu kullan.
        4. TARİF BİLGİSİ: Kullanıcı tarif detayı veriyorsa (örn: "mascarpone + eritritol + kakao"), bunları birebir ingredient olarak kullan.
        5. PORSIYON/MİKTAR: Kullanıcı miktar belirtiyorsa (örn: "yarım porsiyon yedim"), buna göre hesapla.
        6. TEK ITEM KURALI: Fotoğrafta tek bir yiyecek varsa (bardakta puding, tabakta kek vs.), TÜM malzemeler tek item'ın "ingredients" içinde olsun. Yenmeyen kısımlar da ingredients içinde "included": false ile kalsın.
        7. analysis_note kısmında kullanıcının notunu nasıl dikkate aldığını KISA açıkla.
        ` : ''}

        Sadece JSON döndür. Markdown code block kullanma.
        `;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: "image/jpeg", // Assuming JPEG for simplicity, usually fine for PNG too
                },
            },
        ]);

        const response = await result.response;
        const text = response.text();

        // Parse JSON
        let jsonString = text.replace(/```json\s*|\s*```/g, '').trim();
        let data;

        try {
            data = JSON.parse(jsonString);
        } catch (e) {
            console.error("JSON Parse Error:", text);
            return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
        }

        // --- USDA API INTEGRATION ---
        if (data && data.items && Array.isArray(data.items)) {
            const usdaApiKey = process.env.USDA_API_KEY;

            if (usdaApiKey) {
                // Process each item to fetching accurate USDA macros
                for (let i = 0; i < data.items.length; i++) {
                    const item = data.items[i];

                    // We only query USDA if we have an english search name and a valid gram estimate
                    if (item.usda_search_name && item.estimated_total_grams > 0) {
                        try {
                            // Search USDA database
                            const usdaRes = await fetch(`https://fdc.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(item.usda_search_name)}&api_key=${usdaApiKey}&pageSize=1`);

                            if (usdaRes.ok) {
                                const usdaData = await usdaRes.json();

                                if (usdaData.foods && usdaData.foods.length > 0) {
                                    const bestMatch = usdaData.foods[0];
                                    const nutrients = bestMatch.foodNutrients;

                                    // USDA specific nutrient IDs:
                                    // 1008: Calories (Energy)
                                    // 1003: Protein
                                    // 1005: Carbohydrate, by difference
                                    // 1004: Total lipid (fat)

                                    const getNutrient = (id: number) => {
                                        const n = nutrients.find((x: any) => x.nutrientId === id);
                                        return n ? n.value : 0;
                                    };

                                    // USDA values are PER 100 GRAMS. So we calculate multiplier based on total grams.
                                    const multiplier = item.estimated_total_grams / 100;

                                    const usdaCals = getNutrient(1008) * multiplier;
                                    const usdaProtein = getNutrient(1003) * multiplier;
                                    const usdaCarbs = getNutrient(1005) * multiplier;
                                    const usdaFat = getNutrient(1004) * multiplier;

                                    // Only replace if USDA actually returned values
                                    if (usdaCals > 0 || usdaProtein > 0 || usdaCarbs > 0 || usdaFat > 0) {
                                        item.calories = Math.round(usdaCals);
                                        item.protein = Number(usdaProtein.toFixed(1));
                                        item.carbs = Number(usdaCarbs.toFixed(1));
                                        item.fat = Number(usdaFat.toFixed(1));

                                        // Update per unit metrics since total changed
                                        if (item.quantity > 0) {
                                            item.per_unit_protein = Number((item.protein / item.quantity).toFixed(2));
                                            item.per_unit_carbs = Number((item.carbs / item.quantity).toFixed(2));
                                            item.per_unit_fat = Number((item.fat / item.quantity).toFixed(2));
                                        }

                                        item.is_usda_verified = true;
                                        item.usda_source_name = bestMatch.description; // Useful for debugging
                                    }
                                }
                            }
                        } catch (usdaErr) {
                            console.error("USDA API Fetch Error for item:", item.usda_search_name, usdaErr);
                            // It will gracefully fall back to the original AI assumptions
                        }
                    }
                }
            }
        }
        return NextResponse.json(data);
    } catch (error) {
        console.error("AI Analysis error:", error);
        return NextResponse.json({ error: "Failed to process image analysis" }, { status: 500 });
    }
}
