-- =====================================================
-- FIX AI PROMPTS - Split Revision Notes (Text vs Image)
-- =====================================================

UPDATE system_prompts
SET prompt_template = 'Aşağıda mevcut olan bir yemeğin bilgileri ve kullanıcının bu yemeği iyileştirmek/değiştirmek için yazdığı REVİZYON NOTLARI var. Görevin bu revizyon notlarını uygulayıp yepyeni bir hazırlanış metni (ve gerekirse malzemeler) oluşturmak, ardından bu yeni versiyona uygun yeni bir görsel (imagePrompt) üretmektir.
Kurallar:
1. Hazırlanış metninde madde işaretleri (1., - gibi) KULLANMA. Düz akıcı bir paragraf olarak yaz.
2. Çıktı sadece JSON olmalıdır. Markdown kullanma.

Yemek: {{DISH_NAME}}
Mevcut Malzemeler: {{INGREDIENTS}}
Mevcut Hazırlanış: {{PREPARATION}}
Metin/Tarif Revizyon Notu: {{TEXT_REVISION_NOTE}}
Görsel Revizyon Notu: {{IMAGE_REVISION_NOTE}}

Output JSON Format:
{
  "revised_ingredients": ["revised ing 1"],
  "revised_preparation": "yeni hazırlanış paragrafı",
  "new_imagePrompt": "High-end food photography of {{DISH_NAME}} reflecting the exact revision...",
  "explanation": "Kısaca neyi revize ettiğini yaz"
}'
WHERE key = 'card_maker_revision';
