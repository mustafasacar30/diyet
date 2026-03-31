-- =====================================================
-- FIX AI PROMPTS - Revision Macro Updating & Split Notes
-- =====================================================

UPDATE system_prompts
SET prompt_template = 'Aşağıda mevcut olan bir yemeğin bilgileri ve kullanıcının bu yemeği iyileştirmek/değiştirmek için yazdığı REVİZYON NOTLARI var. Görevin bu revizyon notlarını uygulayıp yepyeni bir hazırlanış metni, malzemeler ve makro tablosu oluşturmak, ardından bu yeni versiyona uygun yeni bir görsel (imagePrompt) üretmektir.
Kurallar:
1. Hazırlanış metninde madde işaretleri (1., - gibi) KULLANMA. Düz akıcı bir paragraf olarak yaz.
2. Çıktı sadece JSON olmalıdır. Markdown kullanma.
3. Eğer revizyon notu malzemenin miktarını/oranını değiştiriyorsa (örn: "kaldır", "250 gram yap"), yapmanı istediğimiz şey baştan yepyeni bir tahmin yapmak DEĞİLDİR. Lütfen "Mevcut Makrolar" değerlerini referans al, sadece etkilenen malzemenin (örn: 50 gram kuzu eti) ortalama makrosunu zihninde hesapla ve mevcut makrolardan çıkararak/toplayarak "revised_macros" alanına yaz. Eğer gramaj/içerik değişmiyorsa Mevcut Makrolar''ı tamamen aynı bırak.

Yemek: {{DISH_NAME}}
Mevcut Malzemeler: {{INGREDIENTS}}
Mevcut Hazırlanış: {{PREPARATION}}
Mevcut Makrolar: {{MACROS}}
Metin/Tarif Revizyon Notu: {{TEXT_REVISION_NOTE}}
Görsel Revizyon Notu: {{IMAGE_REVISION_NOTE}}

Output JSON Format:
{
  "revised_ingredients": ["revised ing 1"],
  "revised_preparation": "yeni hazırlanış paragrafı",
  "revised_macros": { "karbonhidrat": "10 gram", "protein": "20 gram", "yag": "22 gram", "kalori": "318 kcal" },
  "new_imagePrompt": "High-end food photography of {{DISH_NAME}} reflecting the exact revision...",
  "explanation": "Kısaca neyi revize ettiğini yaz"
}'
WHERE key = 'card_maker_revision';
