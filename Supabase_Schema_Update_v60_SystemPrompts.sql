-- =====================================================
-- AI PROMPTS SYSTEM - Database Schema (Update for AI Settings Dashboard)
-- =====================================================

-- We assume system_prompts table might already exist from Supabase_Schema_AI.sql
-- But we will ensure it exists and insert the new default prompts for Card Maker and Food Discovery.

CREATE TABLE IF NOT EXISTS system_prompts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    description TEXT,
    prompt_template TEXT NOT NULL,
    model TEXT DEFAULT 'gemini-pro',
    temperature NUMERIC DEFAULT 0.7,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1
);

ALTER TABLE system_prompts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (likely admins) to read/write
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'system_prompts' AND policyname = 'Enable all for authenticated users'
    ) THEN
        CREATE POLICY "Enable all for authenticated users" ON system_prompts
            FOR ALL USING (auth.role() = 'authenticated');
    END IF;
END $$;


-- Insert Default Prompts for Phase 2: AI Prompt Management

INSERT INTO system_prompts (key, description, prompt_template, model, temperature)
VALUES 
(
    'food_discovery',
    'Tarif Keşif (Food Discovery) motoru için AI komutu.',
    'Sen uzman bir fonksiyonel tıp diyetisyenisin ve aşçısın. Görevin, verilen isteğe/şartlara uygun yemekleri üretmektir.
Kurallar:
1. Porsiyon kontrolüne, gerçekçi kalori ve makro hesaplamalarına dikkat et. Makrolar 1 standart porsiyon üzerinden hesaplanmalıdır.
2. Türk damak tadına ve yöresel isimlendirmelere önem ver.
3. Tarifleri benzersiz ve orijinal olarak yaz.
4. Sonuçları sadece aşağıdaki katı JSON yapısında ver. JSON dışında hiçbir metin, açıklama veya markdown ekleme.

JSON Şeması:
{
  "foods": [
    {
      "suggested_name": "Yemek Adı",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "ingredients": "Malzeme 1, Malzeme 2...",
      "recipe_text": "1. Adım...\n2. Adım...",
      "tags": ["keto", "low-cost", "winter-veg"]
    }
  ]
}',
    'gemini-2.0-flash',
    0.7
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_prompts (key, description, prompt_template, model, temperature)
VALUES 
(
    'card_maker_text',
    'Kart Maker: Sadece Yemek ismi ve Porsiyon girilerek otomatik Tarif ve Malzeme yazılması için kullanılır.',
    'Sadece JSON döneceksin. Girdi: {{DISH_NAME}} ({{SERVINGS}} için).

Aşağıdaki JSON Formatına harfiyen uy. Tarif metnini yazarken asla sayı veya madde imi kullanma, sadece aralarında boşluk olan paragraflar halinde düz metin yaz.
{
  "title": "{{DISH_NAME}}",
  "preparation": "Malzemeleri hazırlayın. Ardından sırasıyla pişirin.",
  "ingredients": ["1. malzeme", "2. malzeme", "3. malzeme"],
  "macros": { "karbonhidrat": "15 gram", "protein": "25 gram", "yag": "12 gram", "kalori": "285 kcal" },
  "imagePrompt": "High-end food photography of {{DISH_NAME}}, professional plating, natural lighting, highly detailed, photorealistic, 8k resolution, cinematic lighting"
}',
    'gemini-2.5-flash',
    0.6
)
ON CONFLICT (key) DO NOTHING;


INSERT INTO system_prompts (key, description, prompt_template, model, temperature)
VALUES 
(
    'card_maker_image',
    'Kart Maker: Görsel Üretimi (Imagen veya Gemini) için Prompt. Yemeğin adını, malzemeleri ve hazırlanışını dikkate alır.',
    'High-end food photography of {{DISH_NAME}}, professional plating, natural lighting, highly detailed, photorealistic, 8k resolution, cinematic lighting.
Key ingredients visible: {{INGREDIENTS}}.
Plating context based on preparation: {{PREPARATION}}',
    'imagen-4.0-generate-001',
    0.3
)
ON CONFLICT (key) DO NOTHING;


INSERT INTO system_prompts (key, description, prompt_template, model, temperature)
VALUES 
(
    'card_maker_revision',
    'Kart Maker: Bütünleşik Revizyon. Kullanıcının revizyon notuna göre kartın metinlerini ve yeni görsel promptunu günceller.',
    'Aşağıda mevcut olan bir yemeğin bilgileri ve kullanıcının bu yemeği iyileştirmek/değiştirmek için yazdığı REVİZYON NOTU var. 
Görevin bu revizyon notunu uygulayıp yepyeni bir hazırlanış metni (ve gerekirse malzemeler) oluşturmak, ardından bu yeni versiyona uygun yeni bir görsel (imagePrompt) üretmektir.
Kurallar:
1. Hazırlanış metninde madde işaretleri (1., - gibi) KULLANMA. Düz akıcı bir paragraf olarak yaz.
2. Çıktı sadece JSON olmalıdır. Markdown kullanma.

Yemek: {{DISH_NAME}}
Mevcut Malzemeler: {{INGREDIENTS}}
Mevcut Hazırlanış: {{PREPARATION}}
Kullanıcı Revizyon Notu: {{REVISION_NOTE}}

Output JSON Format:
{
  "revised_ingredients": ["revised ing 1", "revised ing 2"],
  "revised_preparation": "yeni hazırlanış paragrafı",
  "new_imagePrompt": "High-end food photography of {{DISH_NAME}} reflecting the exact revision...",
  "explanation": "Kısaca neyi revize ettiğini yaz"
}',
    'gemini-2.5-flash',
    0.5
)
ON CONFLICT (key) DO NOTHING;


INSERT INTO system_prompts (key, description, prompt_template, model, temperature)
VALUES 
(
    'usda_translation',
    'USDA Makro Doğrulama: Türkçe malzemeleri USDA FoodData Central standart İngilizce isimlerine çevirir.',
    'Sen bir gıda bilimci ve beslenme uzmanısın. Aşağıdaki Türkçe malzeme listesindeki her malzeme için USDA FoodData Central veritabanında aranabilecek İngilizce gıda adını ve gram miktarını ver.
İngilizce adı USDA nın kullandığı standart formatta yaz. (Örn: badem unu -> Nuts, almonds, blanched)

Girdi JSON:
{{INGREDIENTS_JSON}}

Çıktıyı bu şekilde JSON dizisi olarak ver:
[
  { "original": "2 yumurta", "name_en": "Egg, whole, raw, fresh", "grams": 100 },
  { "original": "1 avuç ıspanak", "name_en": "Spinach, raw", "grams": 30 }
]
Sadece JSON dizisi döndür. Markdown (```json) kullanma.',
    'gemini-2.5-flash',
    0.2
)
ON CONFLICT (key) DO NOTHING;
