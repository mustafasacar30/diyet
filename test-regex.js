const text = "Shirataki noodle'ları ambalajından çıkarın ve bol su ile iyice yıkayın. Bir süzgeçte bekletin. Geniş bir tavada susam yağını ısıtın. Tavuk parçalarını ekleyip rengi dönene kadar kavurun. Sarımsak ve zencefili ekleyip birkaç saniye daha kavurun. Biberleri ve havucu ekleyip sebzeler yumuşayana kadar kavurun. Shirataki noodle'ları tavaya ekleyin ve 2-3 dakika daha pişirin. Soya sosunu ekleyin ve karıştırın. Tüm malzemelerin sos ile kaplandığından emin olun. Servis yaparken üzerine susam tohumu serpiştirin. 2 porsiyon elde edeceksiniz.";

function detectServingFromText(preparationText) {
  if (!preparationText || typeof preparationText !== "string") return null;
  const text = preparationText.toLowerCase();

  const units = [
    "porsiyon", "kişilik", "kişi", "kişiye", "kişinin",
    "kase", "kaseye", "kasede", "tabak", "tabağa", "tabakta",
    "dilim", "dilime", "dilimle", "parça", "parçaya",
    "adet", "tane",
    "kurabiye", "köfte", "poğaça", "pankek", "börek", "gözleme",
    "sarma", "dolma", "mücver", "krep", "kruvasan", "çörek",
    "muffin", "kek", "pasta", "baklava", "lokma", "pide", "lahmacun",
    "top", "rulo", "bar"
  ];
  const UP = units.join("|");

  const verbs = "elde|çıkar|çıkacak|paylaştır|paylaştıra|bölü|böle|servis|sun|dağıt|hazırla|kesin|ayır|verin|verebil|yap|yeter|yetecek|yetişir";

  const matches = [];
  let m;

  const re1 = new RegExp("(\\d+)\\s+(" + UP + ")(?:\\s+\\S+){0,5}?\\s+(?:" + verbs + ")", "gi");
  while ((m = re1.exec(text)) !== null) matches.push({ strat: 1, count: parseInt(m[1]), unit: m[2], idx: m.index, match: m[0] });

  const tail = text.slice(-250);
  const re5 = new RegExp("(\\d+)\\s+(" + UP + ")", "gi");
  while ((m = re5.exec(tail)) !== null) matches.push({ strat: 5, count: parseInt(m[1]), unit: m[2], idx: text.length - 250 + m.index, match: m[0] });

  return matches;
}

console.log("TEST 1:", detectServingFromText(text));

const text2 = "Kabakları soyun ve küp küp doğrayın. Soğanı ve sarımsağı ince ince doğrayın. Zeytinyağını tencerede ısıtın, soğan ve sarımsağı pembeleşinceye kadar kavurun. Kabakları ekleyip birkaç dakika daha kavurun. Sebze suyunu ekleyin ve kabaklar yumuşayana kadar yaklaşık 15-20 dakika pişirin. Blenderdan geçirin ve pürüzsüz hale getirin. Kremayı ekleyin, tuz ve karabiberle tatlandırın. Bir taşım kaynatın. İsteğe bağlı olarak dereotu ile süsleyerek sıcak servis yapın. 4 kaseye paylaştırarak sunun.";

console.log("TEST 2:", detectServingFromText(text2));

const jsonStr = `{
  "macros": {
    "karbonhidrat": "4 gram",
    "protein": "6 gram",
    "yag": "18 gram",
    "kalori": "220 kcal"
  ]
}`;
let fixed = jsonStr.replace(/"kalori"\s*:\s*"([^"]*)"\s*\n\s*\]/g, '"kalori": "$1"\n  }');
console.log("JSON FIX:", fixed);
