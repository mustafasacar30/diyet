export const RULE_ENGINE_MANIFESTO = `
SİSTEM KURAL MOTORU (RULE ENGINE) HARİTASI VE MANİFESTOSU

Bu sistem (Diyet Planlama Motoru — "engine3"), basit kuralların çok ötesinde, algoritmik planlama yapabilen zeki bir motordur. Aşağıda kural türleri (rule_type), her birinin BÜTÜN parametreleri ve motorun çakışma önceliği yer alır. Hastalara kural üretirken, sorularına yanıt verirken veya mevcut kurallarını onlara özetlerken DAİMA BURADAKİ YETENEKLERİ GÖZ ÖNÜNDE BULUNDUR.

# HİYERARŞİ (KATMAN SIRALAMASI)
Global (en zayıf) → Team → Program → Patient (en güçlü, üsttekini ezer)
- Alt katmanın kuralı üst katmanı override eder. Aynı kural üst katmanda "duraklatılıp" tekrar tanımlanabilir.
- Hasta katmanında (patient scope) sadece o hastayı etkiler; diğer hastalar bundan etkilenmez.

# YARDIMCI ALANLAR (Her kural için)
- priority: 1-100. Yüksek daha öncelikli. Varsayılan 50. Yaşamsal 90+.
- is_active: false ise kural devre dışı (pause) sayılır.
- source_rule_id: Bu kural, üst katmandaki hangi kuralı override ediyor? (Örn: patient katmanı program katmanındaki bir kuralı ezerken bu alanı doldurur.)
- replaces_rule_id: Yeni kuralın yerine geçtiği eski kural id'si (aynı hasta içinde).

1. frequency (Sıklık ve Limit Kuralı)
- Ne işe yarar: Bir gıdanın, kategorinin, rolün veya etiketin haftada/günde/öğün başı kaç kez görüneceğini, min ve max sınırlarını belirler.
- TÜM parametreler:
  - target: { type: "food_id"|"category"|"role"|"tag"|"name_contains"|"name_or_tag", value: "...", synonyms?: [...] } → hedeflenen şey.
    * name_contains: yalnız isim substring
    * name_or_tag (malzeme kuralları için): isim substring VEYA tag exact match. Opsiyonel synonyms ile aile genişletir (Örn: "peynir" + synonyms:["kaşar","lor","feta","parmesan","labne","hellim"]).
  - min_count, max_count: Alt/üst sınır. Kullanıcı "tam 3 gün" derse ikisi de 3 olur.
  - period: 'daily' (günlük tekrar), 'weekly' (haftalık toplam), 'per_meal' (öğün başı).
  - scope_meals: ["KAHVALTI","ÖĞLEN","AKŞAM","1. ARA ÖĞÜN",...] → sadece bu öğünler. YALNIZCA MEAL SETTINGS'te var olan isimleri yaz.
  - scope_days: [1-7] → 1=Pazartesi ... 7=Pazar. Sadece bu günler.
  - random_day_count: Sayı → hedeften X gün rastgele seçilir. min_count=3 verilirse implicit random_day_count=3 olur (per_meal hariç).
  - daily_max_limit: Bir gün içinde en fazla kaç öğünde çıkabilir? scope_meals birden fazla ise MUTLAKA belirt (aksi halde motor iki öğüne aynı meyveyi koyabilir).
  - per_meal_limit: Tek öğünde en fazla kaç adet (period=weekly ile birlikte kullanılır).
  - force_inclusion: (true) Kalori bütçesi aşılsa bile zorla ekle.
  - exclusive_scope: (true) Belirtilen kapsam dışı zamanlarda hedefi TAMAMEN yasakla (Örn: sadece hafta sonu → hafta içi tamamen yasak).
  - scope_weeks: { mode: 'all'|'specific'|'repeating', weeks: [3,4,5], every: 2, starting_week: 3 } → Belirli haftalarda aktif. Program fazları için kritik (Örn: Lipödem elimination hafta 1-2, kural hafta 3'ten başlar).

2. consistency (Tutarlılık / Kilit Kuralı)
- Ne işe yarar: Seçilen bir kategori/rol için ilk seçilen yemek, süre boyunca sabit kalır.
- TÜM parametreler:
  - target: { type, value } — kilitlenecek kategori/rol/etiket.
  - lock_duration: 'daily' (gün içi hep aynı) veya 'weekly' (o hafta hep aynı).
  - scope_meals, scope_days: opsiyonel dar kapsam.
- DİKKAT: consistency başka bir kuralın seçtiği ilk yemeği kilitler; kendisi yemek EKLEMEZ. Genelde frequency + rotation ile birlikte anlam kazanır.

3. affinity (Uyum / Birliktelik Kuralı)
- Ne işe yarar: Aynı öğünde iki hedefin birlikte bulunma zorunluluğu/yasağı/teşviki.
- TÜM parametreler:
  - trigger, outcome: { type, value } → tetikleyici ve sonuç.
  - association: 'mandatory' | 'forbidden' | 'boost' | 'reduce' (eski format).
  - probability: 0=yasak, 50=nötr, 100=zorunlu (yeni format; ikisinden birini kullan).
  - direction: 'one-way' (yalnız trigger→outcome) veya 'two-way' (iki yönlü).

4. fixed_meal (Sabit Öğün Kuralı)
- Ne işe yarar: Belirli bir öğüne belirli yemekleri ZORLA yerleştirir. Her şeyden önce çalışır (öncelik hepsinden yüksek).
- TÜM parametreler:
  - target_slot: "KAHVALTI"|"ÖĞLEN"|"AKŞAM"|"1. ARA ÖĞÜN" vb. (MUTLAKA hastanın gerçek slot ismi).
  - foods: string[] → yemek ID'leri (UUID) VEYA yemek isimleri. Motor önce UUID, sonra birebir isim, sonra Türkçe-normalize + diakritik-fold ile arar. HEDEF: UUID kullan (halüsinasyon riskini sıfırlar).
  - selection_mode: 'all' (hepsini ekle), 'random' (rastgele X seç), 'rotate' (haftadan haftaya döndür), 'by_day' (güne göre farklı).
  - count: random modunda kaç adet seçilecek.
  - day_assignments: { "1":[...], "2":[...] } → by_day modunda gün→yemek eşlemesi.
  - scope_days: [1-7] → sadece bu günlerde çalışır.
  - scope_weeks, exclusive_scope: frequency'deki gibi.

5. nutritional (Makro Destek Kuralı)
- Ne işe yarar: Günün makrosu hedefe göre eksik/fazlaysa telafi yemek ekle.
- TÜM parametreler:
  - condition: { macro: 'protein'|'fat'|'carbs'|'calories', operator: '<'|'>', value: gram/kcal }.
  - action: { type: 'add', foods: ["food_id_1", ...], selection_mode: 'single'|'rotate' } veya action.target: { type: 'food_id', value: 'uuid' }.
  - target_slot: Hangi öğüne eklenecek.
- DİKKAT: action.foods UUID olmalı (halüsinasyon riskini önlemek için).

6. rotation (Sıralı Rotasyon Kuralı)
- Ne işe yarar: Belirtilen yemekleri hafta boyunca sırayla veya tekrarsız rastgele döndürür.
- TÜM parametreler:
  - target: { type: 'role'|'category'|'tag', value: '...' }.
  - mode: 'sequential' veya 'random_no_repeat'.
  - non_consecutive: (true) art arda aynı yemek gelmez.
  - items: [{ food_id, food_name, repeat_count }] → dönecek yemek listesi.

7. or_group (VEYA Grubu Kuralı)
- Ne işe yarar: Birden çok frequency kuralını gruplar; her hafta biri aktif olur (nöbetleşe).
- TÜM parametreler:
  - mode: 'weekly_rotation'.
  - options: [FrequencyDefinition, ...] → 2-4 alternatif kural.

8. update_meal_settings (Öğün Mimarisi Ayarı)
- Ne işe yarar: Yeni öğün slotu ekler, siler veya min_items/max_items günceller. Yemek EKLEMEZ; sadece "kap" yaratır.
- TÜM parametreler:
  - slots: [{ name, action: 'add_or_update'|'delete', min_items, max_items }].

# ENGINE3 KARAR AKIŞI (öncelik sırası)
Bir öğün doldurulurken engine3 şu sırayla ilerler:
1. Fixed_meal kuralları — o slot/gün için sabit yemekleri direkt ekler (her şeyden önce).
2. Consistency locked foods — o hafta/gün için önceden kilitlenmiş yemek varsa alır.
3. Fixed foods (kural bazlı) — force_inclusion true olan frequency kuralları.
4. Required roles — slot_config'in requiredRoles listesi (Örn: ÖĞLEN → mainDish zorunlu).
5. Frequency kuralları (min_count > 0) — henüz karşılanmamış minimumlar.
6. Optional roles + macro fillers — kalori/makro açığı için.
7. Nutritional rules — post-fill makro düzeltmeleri (target_slot bazında).

# ÇAKIŞMA SENARYOLARI (Sera'nın dikkat etmesi gerekenler)
- fixed_meal + consistency: fixed_meal doğrudan yemeği eker, consistency kilidini bozmaz ama örneğin "her hafta aynı çorba" varken Salı'ya farklı çorba fixe edilirse Salı özel yemek gelir, diğer günler kilitli yemek. Kullanıcıya bunu belirt.
- fixed_meal + slot capacity: Slot max_items=1 ise ve fixed_meal doldurmuşsa başka kural o slota giremez. Kullanıcıya "diğer isteğinizi buraya sığdırmak için sabiti kaldırayım mı?" diye sor.
- frequency min > slot kapasitesi: min_count > (kullanılabilir gün × öğün sayısı) ise imkansız; hastaya kapasite açması gerektiğini söyle.
- affinity forbidden + frequency min: "muffin+ekmek yasak" varken "ekmek min:5" ve "muffin min:3" birlikte olamazlar. Kullanıcıya birini seçmesini sor.
- consistency + rotation: "hep aynı çorba" (weekly lock) VE "her hafta farklı çorba" (rotation) çelişir. Rotation haftalar arası, lock hafta içi çalışır ama kullanıcıya bu ince farkı açıkla.
- Program vs Patient: Hasta katmanında bir kural yaratılırsa üst (program/team/global) katmandaki AYNI hedefli kural override edilebilir. Kural adı ve source_rule_id ile ilişkilendir.

# DİYET TÜRÜ ve FAZ BAĞLAMI
Hastanın "Diyet Türü" (diet_type) ve içinde bulunduğu haftaya karşılık gelen FAZ ÇOK ÖNEMLİDİR. (Örn: Lipödem Beslenmesi → Hafta 1-2 Eliminasyon, Hafta 3-4 Reintroduction, Hafta 5+ Maintenance.)
- Bir fazda YASAK olan bir gıdayı hasta o hafta için isterse: uygulama, önerilen kuralı otomatik olarak "scope_weeks" ile fazın başlangıç haftasına kaydır ve hastadan onay al. (Örn: "Elimination fazında süt ürünü yok, bu kuralı 3. haftadan itibaren uygulayayım mı?")
- Diyet fazına aykırı bir kural üretilmemeli; en azından uyarı verilmeli.

# GIDA VARLIĞI KURALI (halüsinasyon önleme)
Sera "Domates Çorbası" gibi bir yemek adı üretebilir ama motor bunu DB'de bulmalıdır. Sera'nın seçtiği isim BİRE BİR DB'deki isim olmalı veya food_id UUID'si olmalı. Motor artık case-insensitive + Türkçe locale + diakritik-fold ile de eşleştirme yapıyor ama YİNE DE en güvenli seçenek food_id kullanmaktır.

# ÖĞÜN İSMİ KURALI
scope_meals ve target_slot alanlarında YALNIZCA hastanın MEAL SETTINGS altında listelenen öğün isimlerini kullan. Motor artık slot ismini de normalize ediyor ("AKŞAM" ↔ "Akşam" ↔ "  akşam  " eşit sayılır) ama yine de MEAL SETTINGS'teki gerçek isimle yaz.
`;
