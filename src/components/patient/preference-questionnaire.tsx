"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Utensils, Minus, Plus, Clock, Sparkles, ArrowRight, ArrowLeft, Loader2, AlertTriangle } from "lucide-react"

// ─── Food Bank — 240 diagnostic foods from Excel ────────────

type FoodItem = { n: string; id: number; c: string; t: string[]; e: "A" | "B" | "C" }

export const FOOD_BANK: FoodItem[] = [
  // 1. Ana protein tercihi
  {n:"Izgara/tavada kırmızı et",id:376,c:"protein",t:["protein:kırmızı_et","doku:kızartma_tava"],e:"A"},
  {n:"Bonfile steak",id:328,c:"protein",t:["protein:kırmızı_et"],e:"A"},
  {n:"Et sote",id:276,c:"protein",t:["protein:kırmızı_et"],e:"A"},
  {n:"Kırmızı et güveç",id:319,c:"protein",t:["protein:kırmızı_et","sebze:biber","doku:güveç_sulu"],e:"B"},
  {n:"Köfte",id:107,c:"protein",t:["protein:kıyma"],e:"A"},
  {n:"Adana / Urfa kebap",id:63,c:"protein",t:["protein:kıyma"],e:"A"},
  {n:"Et döner",id:249,c:"protein",t:["protein:kırmızı_et"],e:"A"},
  {n:"Tavuk sote",id:103,c:"protein",t:["protein:kırmızı_et","protein:tavuk","sebze:mantar","sebze:biber"],e:"B"},
  {n:"Fırında tavuk pirzola",id:104,c:"protein",t:["protein:tavuk","doku:fırın"],e:"A"},
  {n:"Tavuk döner",id:356,c:"protein",t:["protein:kırmızı_et","protein:tavuk"],e:"A"},
  {n:"Tavuklu tepsi kebabı",id:295,c:"protein",t:["protein:kıyma","protein:tavuk"],e:"A"},
  {n:"Hindi ızgara/tava",id:379,c:"protein",t:["protein:hindi","doku:kızartma_tava"],e:"A"},
  {n:"Somon fileto",id:320,c:"protein",t:["protein:kırmızı_et","protein:balık","doku:kızartma_tava"],e:"B"},
  {n:"Fırında hamsi sarma",id:240,c:"protein",t:["protein:balık","doku:fırın"],e:"A"},
  {n:"Fırında/ızgara beyaz balık",id:367,c:"protein",t:["protein:balık","doku:fırın"],e:"A"},
  {n:"Ton balığı salatası",id:294,c:"protein",t:["protein:balık","form:salata_meze"],e:"A"},
  {n:"Sahanda yumurta",id:496,c:"protein",t:["protein:kırmızı_et","protein:yumurta"],e:"A"},
  {n:"Lor peyniri salatası",id:70,c:"protein",t:["süt:peynir","form:salata_meze"],e:"A"},
  {n:"Yeşil mercimek yemeği",id:325,c:"protein",t:["baklagil:mercimek","doku:güveç_sulu"],e:"A"},
  {n:"Nohut yemeği",id:158,c:"protein",t:["baklagil:nohut","doku:güveç_sulu"],e:"A"},
  // 2. Kıyma ve güçlü et tatları
  {n:"Sebzeli köfte",id:248,c:"kiyma",t:["protein:kıyma"],e:"A"},
  {n:"Sulu köfte",id:564,c:"kiyma",t:["protein:kıyma"],e:"A"},
  {n:"Tepsi kebabı",id:180,c:"kiyma",t:["protein:kıyma"],e:"A"},
  {n:"Kıyma kebap",id:353,c:"kiyma",t:["protein:kıyma"],e:"A"},
  {n:"Kıymalı kabak",id:73,c:"kiyma",t:["protein:kıyma","sebze:kabak","doku:güveç_sulu"],e:"B"},
  {n:"Kıymalı taze fasulye",id:255,c:"kiyma",t:["protein:kıyma","baklagil:fasulye"],e:"A"},
  {n:"Kıymalı ıspanak",id:323,c:"kiyma",t:["protein:kıyma","sebze:ıspanak_pazı"],e:"A"},
  {n:"Kıymalı bamya",id:74,c:"kiyma",t:["protein:kıyma","sebze:bamya","doku:güveç_sulu"],e:"B"},
  {n:"Patlıcan musakka",id:368,c:"kiyma",t:["sebze:patlıcan"],e:"A"},
  {n:"Alinazik kebabı",id:296,c:"kiyma",t:["protein:kıyma","sebze:patlıcan"],e:"A"},
  {n:"Kıymalı mantar dolması",id:260,c:"kiyma",t:["protein:kıyma","sebze:mantar"],e:"A"},
  {n:"Kabak spagetti bolonez",id:89,c:"kiyma",t:["protein:kırmızı_et","sebze:kabak"],e:"A"},
  {n:"Kıymalı Brüksel lahanası",id:64,c:"kiyma",t:["protein:kıyma","sebze:lahana"],e:"A"},
  {n:"Karnabahar mantı",id:321,c:"kiyma",t:["protein:kıyma","sebze:karnabahar"],e:"A"},
  {n:"Tavuk köftesi",id:334,c:"kiyma",t:["protein:kıyma","protein:tavuk"],e:"A"},
  {n:"Karnabahar köfte",id:351,c:"kiyma",t:["protein:kıyma","sebze:karnabahar"],e:"A"},
  {n:"Sucuklu nohut",id:2,c:"kiyma",t:["baklagil:nohut","doku:güveç_sulu"],e:"A"},
  {n:"Güveçte sucuklu yumurta",id:228,c:"kiyma",t:["protein:yumurta","doku:güveç_sulu"],e:"A"},
  {n:"Kasap sucuk",id:403,c:"kiyma",t:["doku:kızartma_tava"],e:"A"},
  {n:"Pastırma",id:665,c:"kiyma",t:[],e:"A"},
  // 3. Yumurta ve kahvaltı biçimi
  {n:"Menemen",id:222,c:"yumurta",t:["protein:yumurta"],e:"A"},
  {n:"Haşlanmış yumurta kapama",id:225,c:"yumurta",t:["protein:yumurta"],e:"A"},
  {n:"Yumurta salatası",id:694,c:"yumurta",t:["protein:yumurta","form:salata_meze"],e:"A"},
  {n:"Yumurtalı mantar sote",id:231,c:"yumurta",t:["protein:yumurta","sebze:mantar"],e:"A"},
  {n:"Pazılı kaşarlı omlet",id:35,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","süt:peynir","sebze:ıspanak_pazı"],e:"B"},
  {n:"Lorlu mantarlı omlet",id:43,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","süt:peynir","sebze:mantar"],e:"B"},
  {n:"Lahanalı omlet",id:47,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","sebze:lahana"],e:"B"},
  {n:"Ispanaklı omlet",id:62,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","sebze:ıspanak_pazı"],e:"B"},
  {n:"Kabaklı naneli omlet",id:67,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","sebze:kabak"],e:"B"},
  {n:"Sebzeli omlet",id:412,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","sebze:mantar","sebze:ıspanak_pazı"],e:"B"},
  {n:"Mantarlı omlet",id:567,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","sebze:mantar"],e:"B"},
  {n:"Susamlı omlet",id:614,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta"],e:"A"},
  {n:"Tatlı patates omleti",id:541,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta"],e:"A"},
  {n:"Kavurmalı yumurta",id:399,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta"],e:"A"},
  {n:"Yoğurtlu çılbır",id:491,c:"yumurta",t:["protein:yumurta","süt:yoğurt"],e:"A"},
  {n:"Ispanaklı kıymalı yumurta",id:493,c:"yumurta",t:["protein:kıyma","protein:yumurta","sebze:ıspanak_pazı"],e:"B"},
  {n:"Yumurtalı lahana kavurma",id:453,c:"yumurta",t:["protein:kırmızı_et","protein:yumurta","sebze:lahana"],e:"B"},
  {n:"Keten tohumlu krep",id:227,c:"yumurta",t:["protein:kırmızı_et","form:ekmek_hamur"],e:"A"},
  {n:"Badem unlu krep",id:183,c:"yumurta",t:["protein:yumurta","form:ekmek_hamur","form:çorba","doku:kızartma_tava","doku:güveç_sulu"],e:"C"},
  {n:"Fırında menemen",id:497,c:"yumurta",t:["protein:yumurta","doku:fırın"],e:"A"},
  // 4. Süt ürünü ve peynir tercihi
  {n:"Yoğurt",id:96,c:"sut",t:["süt:yoğurt"],e:"A"},
  {n:"Cevizli cacık",id:20,c:"sut",t:["süt:yoğurt","form:salata_meze"],e:"A"},
  {n:"Pazılı cacık",id:34,c:"sut",t:["süt:yoğurt","sebze:ıspanak_pazı","form:salata_meze"],e:"B"},
  {n:"Yoğurtlu brokoli",id:154,c:"sut",t:["süt:yoğurt","sebze:brokoli"],e:"A"},
  {n:"Yoğurtlu kırmızı biber mezesi",id:155,c:"sut",t:["süt:yoğurt","sebze:biber","form:salata_meze"],e:"B"},
  {n:"Yoğurtlu pancar salatası",id:661,c:"sut",t:["süt:yoğurt","sebze:pancar","form:salata_meze"],e:"B"},
  {n:"Yoğurtlu kereviz salatası",id:624,c:"sut",t:["süt:yoğurt","sebze:kereviz","form:salata_meze"],e:"B"},
  {n:"Yoğurtlu alabaş salatası",id:635,c:"sut",t:["süt:yoğurt","form:salata_meze"],e:"A"},
  {n:"Yoğurtlu enginar",id:677,c:"sut",t:["süt:yoğurt"],e:"A"},
  {n:"Yoğurtlu Brüksel lahanası",id:729,c:"sut",t:["süt:yoğurt","sebze:lahana"],e:"A"},
  {n:"Peynirli pancar mezesi",id:58,c:"sut",t:["süt:peynir","sebze:pancar","form:salata_meze"],e:"B"},
  {n:"Peynirli patlıcan rulosu",id:253,c:"sut",t:["süt:peynir","sebze:patlıcan"],e:"A"},
  {n:"Fırında peynirli taze fasulye",id:223,c:"sut",t:["süt:peynir","baklagil:fasulye","doku:fırın"],e:"B"},
  {n:"Kaşarlı yulaf tost",id:11,c:"sut",t:["süt:peynir","tahıl:yulaf","form:ekmek_hamur"],e:"B"},
  {n:"Lorlu gözleme",id:226,c:"sut",t:["süt:peynir","form:ekmek_hamur"],e:"A"},
  {n:"Girit ezmesi",id:330,c:"sut",t:[],e:"A"},
  {n:"Peynirli zeytin ezmesi",id:401,c:"sut",t:["süt:peynir"],e:"A"},
  {n:"Kapya biberli labne mezesi",id:655,c:"sut",t:["süt:peynir","sebze:biber","form:salata_meze"],e:"B"},
  {n:"Peynir topları",id:405,c:"sut",t:["süt:peynir"],e:"A"},
  {n:"Kuymak",id:32,c:"sut",t:["süt:peynir"],e:"A"},
  // 5. Sebze omurgası
  {n:"Ispanak kavurması",id:5,c:"sebze",t:["protein:kırmızı_et","sebze:ıspanak_pazı"],e:"A"},
  {n:"Zeytinyağlı mantar sote",id:7,c:"sebze",t:["sebze:mantar"],e:"A"},
  {n:"Karnabahar tava",id:39,c:"sebze",t:["sebze:karnabahar","doku:kızartma_tava"],e:"A"},
  {n:"Kabak spagetti",id:147,c:"sebze",t:["protein:kırmızı_et","sebze:kabak"],e:"A"},
  {n:"Bamya yemeği",id:95,c:"sebze",t:["protein:kırmızı_et","sebze:bamya","doku:güveç_sulu"],e:"B"},
  {n:"Zeytinyağlı taze fasulye",id:254,c:"sebze",t:["baklagil:fasulye"],e:"A"},
  {n:"Zeytinyağlı patlıcan",id:301,c:"sebze",t:["sebze:patlıcan","doku:güveç_sulu"],e:"A"},
  {n:"Zeytinyağlı taze börülce",id:268,c:"sebze",t:[],e:"A"},
  {n:"Zeytinyağlı bakla",id:271,c:"sebze",t:["baklagil:bakla"],e:"A"},
  {n:"Fırında kereviz kızartma",id:474,c:"sebze",t:["sebze:kereviz","doku:kızartma_tava","doku:fırın"],e:"B"},
  {n:"Alabaş kızartma",id:115,c:"sebze",t:["doku:kızartma_tava"],e:"A"},
  {n:"Semizotu salatası",id:457,c:"sebze",t:["form:salata_meze"],e:"A"},
  {n:"Enginar salatası",id:428,c:"sebze",t:["form:salata_meze"],e:"A"},
  {n:"Brüksel lahanası salatası",id:595,c:"sebze",t:["sebze:lahana","form:salata_meze"],e:"A"},
  {n:"Kırmızı pancar salatası",id:441,c:"sebze",t:["sebze:pancar","form:salata_meze"],e:"A"},
  {n:"Közlenmiş patlıcan salatası",id:516,c:"sebze",t:["sebze:patlıcan","form:salata_meze","doku:köz"],e:"B"},
  {n:"Közlenmiş kapya biber",id:436,c:"sebze",t:["sebze:biber","doku:köz"],e:"A"},
  {n:"Brokoli salatası",id:672,c:"sebze",t:["sebze:brokoli","form:salata_meze"],e:"A"},
  {n:"Türlü yemeği",id:258,c:"sebze",t:["doku:güveç_sulu"],e:"A"},
  {n:"Fırında ıspanaklı pırasalı mücver",id:251,c:"sebze",t:["sebze:ıspanak_pazı","doku:fırın"],e:"A"},
  // 6. Baklagil, tahıl ve karbonhidrat tercihi
  {n:"Zeytinyağlı barbunya",id:1,c:"baklagil",t:[],e:"A"},
  {n:"Yeşil mercimekli yaprak sarma",id:8,c:"baklagil",t:["baklagil:mercimek"],e:"A"},
  {n:"Yeşil mercimekli patlıcan humus",id:9,c:"baklagil",t:["sebze:patlıcan","baklagil:mercimek"],e:"A"},
  {n:"Kırmızı mercimek ekmeği",id:80,c:"baklagil",t:["baklagil:mercimek"],e:"A"},
  {n:"Yeşil mercimek ekmeği",id:81,c:"baklagil",t:["baklagil:mercimek"],e:"A"},
  {n:"Yeşil mercimekli poğaça",id:113,c:"baklagil",t:["baklagil:mercimek","form:ekmek_hamur"],e:"A"},
  {n:"Yoğurtlu yeşil mercimek salatası",id:329,c:"baklagil",t:["süt:yoğurt","baklagil:mercimek","form:salata_meze"],e:"B"},
  {n:"Nohutlu sebze güveç",id:547,c:"baklagil",t:["baklagil:nohut","doku:güveç_sulu"],e:"A"},
  {n:"Nohutlu dereotlu poğaça",id:83,c:"baklagil",t:["baklagil:nohut","form:ekmek_hamur"],e:"A"},
  {n:"Nohut simitleri",id:269,c:"baklagil",t:["baklagil:nohut"],e:"A"},
  {n:"Nohutlu sebzeli pankek",id:305,c:"baklagil",t:["baklagil:nohut","form:ekmek_hamur"],e:"A"},
  {n:"Basmati pirinç pilavı",id:14,c:"baklagil",t:[],e:"A"},
  {n:"Pırasalı bulgur salatası",id:4,c:"baklagil",t:["form:salata_meze"],e:"A"},
  {n:"Glutensiz şehriye pilavı",id:13,c:"baklagil",t:[],e:"A"},
  {n:"Glutensiz şehriye salatası",id:12,c:"baklagil",t:["form:salata_meze"],e:"A"},
  {n:"Yulaflı makarna",id:17,c:"baklagil",t:["tahıl:yulaf"],e:"A"},
  {n:"Mayasız karabuğday ekmeği",id:60,c:"baklagil",t:["tahıl:karabuğday"],e:"A"},
  {n:"Kinoa lavaş",id:287,c:"baklagil",t:["tahıl:kinoa","form:ekmek_hamur"],e:"A"},
  {n:"Karabuğdaylı tuzlu kek",id:270,c:"baklagil",t:["tahıl:karabuğday"],e:"A"},
  {n:"Yulaf lavaş",id:310,c:"baklagil",t:["tahıl:yulaf","form:ekmek_hamur"],e:"A"},
  // 7. Salata, meze ve soğuk tatlar
  {n:"Avokadolu roka salatası",id:468,c:"salata",t:["form:salata_meze"],e:"A"},
  {n:"Baby enginar salatası",id:382,c:"salata",t:["form:salata_meze"],e:"A"},
  {n:"Elmalı pancar salatası",id:479,c:"salata",t:["sebze:pancar","form:salata_meze"],e:"A"},
  {n:"Göçmen salatası",id:574,c:"salata",t:["form:salata_meze"],e:"A"},
  {n:"Köz tadında fasulye salatası",id:27,c:"salata",t:["baklagil:fasulye","form:salata_meze","doku:köz"],e:"B"},
  {n:"Kırmızı lahanalı alabaş salatası",id:110,c:"salata",t:["sebze:lahana","form:salata_meze"],e:"A"},
  {n:"Kuşkonmaz & yumurta salatası",id:495,c:"salata",t:["protein:yumurta","form:salata_meze"],e:"A"},
  {n:"Semizotlu çilekli kinoa salatası",id:455,c:"salata",t:["tahıl:kinoa","form:salata_meze"],e:"A"},
  {n:"Yerelmalı brokoli salatası",id:475,c:"salata",t:["sebze:brokoli","form:salata_meze"],e:"A"},
  {n:"Cevizli köz biber mezesi",id:38,c:"salata",t:["sebze:biber","form:salata_meze","doku:köz"],e:"B"},
  {n:"Kırmızı pancarlı kereviz",id:49,c:"salata",t:["sebze:pancar","sebze:kereviz"],e:"A"},
  {n:"Susamlı Brüksel lahanası",id:56,c:"salata",t:["sebze:lahana"],e:"A"},
  {n:"Nohutlu köz patlıcan mezesi",id:157,c:"salata",t:["sebze:patlıcan","baklagil:nohut","form:salata_meze","doku:köz"],e:"B"},
  {n:"Peynirli kabak mezesi",id:407,c:"salata",t:["süt:peynir","sebze:kabak","form:salata_meze"],e:"B"},
  {n:"Köz biber salatası",id:583,c:"salata",t:["protein:kırmızı_et","sebze:biber","form:salata_meze","doku:köz"],e:"B"},
  {n:"Girit usulü zeytinli meze",id:654,c:"salata",t:["form:salata_meze"],e:"A"},
  {n:"Zeytinyağlı deniz börülcesi",id:658,c:"salata",t:[],e:"A"},
  {n:"Köz biberli mantar salatası",id:660,c:"salata",t:["sebze:mantar","sebze:biber","form:salata_meze","doku:köz"],e:"B"},
  {n:"Cevizli kabak salatası",id:669,c:"salata",t:["sebze:kabak","form:salata_meze"],e:"A"},
  {n:"Patlıcan salatası",id:666,c:"salata",t:["sebze:patlıcan","form:salata_meze"],e:"A"},
  // 8. Ekmek, tost, börek ve hamur formu
  {n:"Lifli ekmek",id:28,c:"ekmek",t:["form:ekmek_hamur"],e:"A"},
  {n:"Susamlı tava ekmeği",id:50,c:"ekmek",t:["doku:kızartma_tava"],e:"A"},
  {n:"Hindistan cevizli tost ekmeği",id:53,c:"ekmek",t:["protein:hindi","form:ekmek_hamur"],e:"A"},
  {n:"Cevizli mercimekli ekmek",id:54,c:"ekmek",t:["baklagil:mercimek","form:ekmek_hamur"],e:"A"},
  {n:"Yulaflı lorlu ekmek",id:57,c:"ekmek",t:["süt:peynir","tahıl:yulaf","form:ekmek_hamur"],e:"B"},
  {n:"Badem unlu tava ekmeği",id:66,c:"ekmek",t:["doku:kızartma_tava"],e:"A"},
  {n:"Tahin ekmeği",id:120,c:"ekmek",t:[],e:"A"},
  {n:"Lupin unlu ekmek",id:138,c:"ekmek",t:["form:ekmek_hamur"],e:"A"},
  {n:"Keten tohumu ekmeği",id:245,c:"ekmek",t:["protein:kırmızı_et","form:ekmek_hamur"],e:"A"},
  {n:"Bakla unu ekmeği",id:224,c:"ekmek",t:["baklagil:bakla"],e:"A"},
  {n:"Pita ekmeği",id:274,c:"ekmek",t:[],e:"A"},
  {n:"Zeytinli ekmek",id:281,c:"ekmek",t:["form:ekmek_hamur"],e:"A"},
  {n:"Badem unlu lavaş",id:298,c:"ekmek",t:["form:ekmek_hamur"],e:"A"},
  {n:"Ispanaklı/pazılı tava böreği",id:33,c:"ekmek",t:["sebze:ıspanak_pazı","doku:kızartma_tava"],e:"A"},
  {n:"Lahana böreği",id:48,c:"ekmek",t:["sebze:lahana"],e:"A"},
  {n:"Patlıcan böreği",id:250,c:"ekmek",t:["sebze:patlıcan"],e:"A"},
  {n:"Tahinli kabak böreği",id:112,c:"ekmek",t:["sebze:kabak"],e:"A"},
  {n:"Lorlu zeytinli poğaça",id:52,c:"ekmek",t:["süt:peynir","form:ekmek_hamur"],e:"A"},
  {n:"Domatesli yulaflı poğaça",id:18,c:"ekmek",t:["tahıl:yulaf","form:ekmek_hamur"],e:"A"},
  {n:"Yulaflı tost",id:19,c:"ekmek",t:["tahıl:yulaf","form:ekmek_hamur"],e:"A"},
  // 9. Çorba tercihi
  {n:"Domates çorbası",id:169,c:"corba",t:["form:çorba","doku:güveç_sulu"],e:"A"},
  {n:"Kabak çorbası",id:91,c:"corba",t:["protein:kırmızı_et","sebze:kabak","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Pazı çorbası",id:129,c:"corba",t:["sebze:ıspanak_pazı","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Karnabahar çorbası",id:439,c:"corba",t:["sebze:karnabahar","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Brokoli çorbası",id:663,c:"corba",t:["sebze:brokoli","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Köz kırmızı biber çorbası",id:168,c:"corba",t:["sebze:biber","form:çorba","doku:köz","doku:güveç_sulu"],e:"B"},
  {n:"Bal kabağı çorbası",id:758,c:"corba",t:["form:çorba","doku:güveç_sulu"],e:"A"},
  {n:"Sebze çorbası",id:736,c:"corba",t:["form:çorba","doku:güveç_sulu"],e:"A"},
  {n:"Yulaflı kabak çorbası",id:87,c:"corba",t:["sebze:kabak","tahıl:yulaf","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Kremalı ıspanak çorbası",id:473,c:"corba",t:["sebze:ıspanak_pazı","form:çorba","doku:kremalı","doku:güveç_sulu"],e:"B"},
  {n:"Kremalı kabak çorbası",id:611,c:"corba",t:["sebze:kabak","form:çorba","doku:kremalı","doku:güveç_sulu"],e:"B"},
  {n:"Çedarlı brokoli çorbası",id:525,c:"corba",t:["süt:peynir","sebze:brokoli","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Peynirli brokoli çorbası",id:626,c:"corba",t:["süt:peynir","sebze:brokoli","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Tavuk çorbası",id:390,c:"corba",t:["protein:tavuk","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Tavuklu domates çorbası",id:735,c:"corba",t:["protein:tavuk","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Kıymalı mantar çorbası",id:429,c:"corba",t:["protein:kıyma","sebze:mantar","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Yoğurtlu köfte çorbası",id:747,c:"corba",t:["protein:kıyma","süt:yoğurt","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Etli karnabahar çorbası",id:770,c:"corba",t:["protein:kırmızı_et","sebze:karnabahar","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Mercimek çorbası",id:773,c:"corba",t:["baklagil:mercimek","form:çorba","doku:güveç_sulu"],e:"B"},
  {n:"Kelle paça çorbası",id:452,c:"corba",t:["form:çorba","doku:güveç_sulu"],e:"A"},
  // 10. Tatlı profili
  {n:"Saray muhallebisi",id:42,c:"tatli",t:["tatlı:sütlü_kremalı"],e:"A"},
  {n:"Sakızlı muhallebi",id:237,c:"tatli",t:["tatlı:sütlü_kremalı"],e:"A"},
  {n:"Kakaolu puding",id:238,c:"tatli",t:["tatlı:çikolata_kakao","tatlı:sütlü_kremalı"],e:"A"},
  {n:"Keto cheesecake",id:201,c:"tatli",t:["protein:kırmızı_et","tatlı:sütlü_kremalı"],e:"A"},
  {n:"San Sebastian cheesecake",id:185,c:"tatli",t:["tatlı:sütlü_kremalı"],e:"A"},
  {n:"Frambuazlı cheesecake",id:65,c:"tatli",t:[],e:"A"},
  {n:"Çikolatalı cheesecake",id:164,c:"tatli",t:["tatlı:çikolata_kakao","tatlı:sütlü_kremalı"],e:"A"},
  {n:"Ketojenik çikolatalı sufle",id:202,c:"tatli",t:["protein:kırmızı_et","tatlı:çikolata_kakao"],e:"A"},
  {n:"Keto çikolata",id:195,c:"tatli",t:["protein:kırmızı_et","tatlı:çikolata_kakao"],e:"A"},
  {n:"Cevizli browni kek",id:128,c:"tatli",t:["tatlı:çikolata_kakao"],e:"A"},
  {n:"Tarçınlı cevizli kek",id:163,c:"tatli",t:[],e:"A"},
  {n:"Elmalı tart kek",id:55,c:"tatli",t:[],e:"A"},
  {n:"Kabak tatlısı",id:124,c:"tatli",t:["sebze:kabak"],e:"A"},
  {n:"Chia tiramisu",id:61,c:"tatli",t:["tatlı:sütlü_kremalı"],e:"A"},
  {n:"Ketojenik tiramisu",id:209,c:"tatli",t:["protein:kırmızı_et","tatlı:sütlü_kremalı"],e:"A"},
  {n:"Chia puding",id:179,c:"tatli",t:["tatlı:sütlü_kremalı"],e:"A"},
  {n:"Keto magnolia",id:181,c:"tatli",t:["protein:kırmızı_et","tatlı:sütlü_kremalı"],e:"A"},
  {n:"Ketojenik revani",id:203,c:"tatli",t:["protein:kırmızı_et"],e:"A"},
  {n:"Hindistan cevizli bar",id:45,c:"tatli",t:["protein:hindi"],e:"A"},
  {n:"Kuruyemişli keto topları",id:210,c:"tatli",t:["protein:kırmızı_et"],e:"A"},
  // 11. Atıştırmalık, meyve ve kuruyemiş
  {n:"Fıstık ezmeli kurabiye",id:111,c:"atistirmalik",t:[],e:"A"},
  {n:"Tahinli kurabiye",id:167,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Hindistan cevizli kurabiye",id:188,c:"atistirmalik",t:["protein:hindi"],e:"A"},
  {n:"Badem unlu tuzlu kurabiye",id:304,c:"atistirmalik",t:[],e:"A"},
  {n:"Keten tohumlu kraker",id:51,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Tohum kraker",id:76,c:"atistirmalik",t:[],e:"A"},
  {n:"Baharatlı yulaf kraker",id:215,c:"atistirmalik",t:["tahıl:yulaf"],e:"A"},
  {n:"Brokoli cipsi",id:77,c:"atistirmalik",t:["sebze:brokoli"],e:"A"},
  {n:"Avokadolu lorlu kraker",id:265,c:"atistirmalik",t:["süt:peynir"],e:"A"},
  {n:"Hurma topları",id:290,c:"atistirmalik",t:[],e:"A"},
  {n:"Badem",id:127,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Ceviz",id:233,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Fındık",id:234,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Kabak çekirdeği",id:277,c:"atistirmalik",t:["sebze:kabak"],e:"A"},
  {n:"Yer fıstığı",id:160,c:"atistirmalik",t:[],e:"A"},
  {n:"Çilek",id:176,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Yaban mersini",id:172,c:"atistirmalik",t:[],e:"A"},
  {n:"Elma",id:175,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Muz",id:178,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  {n:"Kivi",id:134,c:"atistirmalik",t:["protein:kırmızı_et"],e:"A"},
  // 12. Pişirme, doku ve sos tercihi
  {n:"Kremalı mantarlı tavuk",id:262,c:"pisirme",t:["protein:tavuk","sebze:mantar","doku:kremalı"],e:"B"},
  {n:"Kremalı mantar soslu bonfile",id:365,c:"pisirme",t:["protein:kırmızı_et","sebze:mantar","doku:kremalı"],e:"B"},
  {n:"Beşamel soslu karnabahar",id:263,c:"pisirme",t:["sebze:karnabahar","doku:kremalı"],e:"A"},
  {n:"Beşamel soslu tavuklu pırasa",id:272,c:"pisirme",t:["protein:tavuk","doku:kremalı"],e:"A"},
  {n:"Patlıcan tava",id:252,c:"pisirme",t:["sebze:patlıcan","doku:kızartma_tava"],e:"A"},
  {n:"Taze fasulye kızartması",id:21,c:"pisirme",t:["baklagil:fasulye","doku:kızartma_tava"],e:"A"},
  {n:"Çıtır tavuk",id:316,c:"pisirme",t:["protein:tavuk"],e:"A"},
  {n:"Köz patlıcan kızartması",id:156,c:"pisirme",t:["sebze:patlıcan","doku:kızartma_tava","doku:köz"],e:"B"},
  {n:"Sebzeli et tava",id:30,c:"pisirme",t:["protein:kırmızı_et","doku:kızartma_tava"],e:"A"},
  {n:"Soslu antrikot",id:31,c:"pisirme",t:["protein:kırmızı_et"],e:"A"},
  {n:"Kabak dizme",id:40,c:"pisirme",t:["sebze:kabak"],e:"A"},
  {n:"Kıymalı patlıcan oturtma",id:84,c:"pisirme",t:["protein:kıyma","süt:peynir","sebze:patlıcan"],e:"B"},
  {n:"Ispanaklı mantar dolması",id:137,c:"pisirme",t:["sebze:mantar","sebze:ıspanak_pazı"],e:"A"},
  {n:"Ispanaklı tavuk dolması",id:102,c:"pisirme",t:["protein:tavuk","sebze:ıspanak_pazı"],e:"A"},
  {n:"Peynirli tavuk sarma",id:246,c:"pisirme",t:["protein:tavuk","süt:peynir"],e:"A"},
  {n:"Kabak dürüm",id:125,c:"pisirme",t:["sebze:kabak"],e:"A"},
  {n:"Patlıcan lazanya",id:59,c:"pisirme",t:["sebze:patlıcan"],e:"A"},
  {n:"Kabak lazanya",id:566,c:"pisirme",t:["sebze:kabak"],e:"A"},
  {n:"Brokoli pizza",id:44,c:"pisirme",t:["sebze:brokoli"],e:"A"},
  {n:"Lor tabanlı keto pizza",id:490,c:"pisirme",t:["protein:kırmızı_et","süt:peynir"],e:"A"},
]

const FOOD_TABS = [
    { id: "protein", label: "Ana Protein" },
    { id: "kiyma", label: "Kıyma & Et" },
    { id: "yumurta", label: "Yumurta" },
    { id: "sut", label: "Süt & Peynir" },
    { id: "sebze", label: "Sebze" },
    { id: "baklagil", label: "Baklagil & Tahıl" },
    { id: "salata", label: "Salata & Meze" },
    { id: "ekmek", label: "Ekmek & Hamur" },
    { id: "corba", label: "Çorba" },
    { id: "tatli", label: "Tatlı" },
    { id: "atistirmalik", label: "Atıştırmalık" },
    { id: "pisirme", label: "Pişirme & Doku" },
]

export const TAG_LABELS: Record<string, string> = {
    "protein:kırmızı_et": "Kırmızı et", "protein:kıyma": "Kıymalı yemekler",
    "protein:tavuk": "Tavuk", "protein:hindi": "Hindi", "protein:balık": "Balık",
    "protein:yumurta": "Yumurta", "süt:yoğurt": "Yoğurt & Cacık",
    "süt:peynir": "Peynir", "sebze:ıspanak_pazı": "Ispanak & Pazı",
    "sebze:mantar": "Mantar", "sebze:karnabahar": "Karnabahar",
    "sebze:kabak": "Kabak", "sebze:bamya": "Bamya", "sebze:patlıcan": "Patlıcan",
    "sebze:brokoli": "Brokoli", "sebze:lahana": "Lahana & Brüksel",
    "sebze:biber": "Biber", "sebze:pancar": "Pancar", "sebze:kereviz": "Kereviz",
    "baklagil:mercimek": "Mercimek", "baklagil:nohut": "Nohut",
    "baklagil:fasulye": "Fasulye", "baklagil:bakla": "Bakla",
    "tahıl:yulaf": "Yulaf", "tahıl:kinoa": "Kinoa", "tahıl:karabuğday": "Karabuğday",
    "tatlı:sütlü_kremalı": "Sütlü tatlılar", "tatlı:çikolata_kakao": "Çikolata & Kakao",
    "form:salata_meze": "Salata & Meze formu", "form:çorba": "Çorba formu",
    "form:ekmek_hamur": "Ekmek & Hamur formu",
    "doku:kızartma_tava": "Tava & Kızartma", "doku:güveç_sulu": "Güveç & Sulu yemek",
    "doku:fırın": "Fırın yemekleri", "doku:köz": "Köz", "doku:kremalı": "Kremalı & Beşamel",
}

export const FREQ_OPTIONS = [
    { value: "every_meal", label: "Her öğün" },
    { value: "daily", label: "Her gün" },
    { value: "3_4_week", label: "Haftada 3-4" },
    { value: "1_2_week", label: "Haftada 1-2" },
    { value: "rarely", label: "Nadiren / Hiç" },
]

export const MEAL_CHIP_OPTIONS = [
    { value: "OGLEN", label: "Öğle" },
    { value: "AKSAM", label: "Akşam" },
    { value: "KAHVALTI", label: "Kahvaltı" },
    { value: "ARA_OGUN", label: "Ara Öğün" },
]

export const FREQ_CATEGORIES = [
    { id: "EKMEKLER", label: "Ekmek", defaultFreq: "daily", defaultMeals: ["OGLEN", "AKSAM"], group: 1 },
    { id: "CORBALAR", label: "Çorba", defaultFreq: "3_4_week", defaultMeals: ["AKSAM"], group: 1 },
    { id: "SALATALAR", label: "Salata & Meze", defaultFreq: "daily", defaultMeals: ["OGLEN", "AKSAM"], group: 1 },
    { id: "TATLILAR", label: "Tatlı", defaultFreq: "1_2_week", defaultMeals: ["AKSAM"], group: 1 },
    { id: "MEYVELER", label: "Meyve", defaultFreq: "3_4_week", defaultMeals: ["KAHVALTI"], group: 2 },
    { id: "BOREKLER", label: "Börek & Sağlıklı Tarifler", defaultFreq: "1_2_week", defaultMeals: ["OGLEN"], group: 2 },
    { id: "KURUYEMISLER", label: "Kuruyemiş", defaultFreq: "3_4_week", defaultMeals: ["ARA_OGUN"], group: 2 },
    { id: "ICECEKLER", label: "İçecek & Smoothie", defaultFreq: "daily", defaultMeals: ["KAHVALTI", "ARA_OGUN"], group: 2 },
]

// ─── Score Rating [−] N [+] — 0-10 scale, default 5 ────────

function ScoreRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const isDefault = value === 5
    return (
        <div className="flex items-center gap-0">
            <button type="button"
                onClick={() => onChange(Math.max(0, value - 1))}
                disabled={value <= 0}
                className="w-7 h-7 flex items-center justify-center rounded-l-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 disabled:opacity-30 touch-manipulation transition-colors">
                <Minus className="w-3.5 h-3.5" />
            </button>
            <div className={`w-8 h-7 flex items-center justify-center border-y text-[13px] font-bold transition-colors ${
                value <= 2 ? "bg-red-50 text-red-600 border-red-200" :
                value <= 4 ? "bg-orange-50 text-orange-600 border-orange-200" :
                isDefault ? "bg-gray-50 text-gray-400 border-gray-200" :
                value <= 7 ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
                "bg-emerald-100 text-emerald-700 border-emerald-300"
            }`}>
                {value}
            </div>
            <button type="button"
                onClick={() => onChange(Math.min(10, value + 1))}
                disabled={value >= 10}
                className="w-7 h-7 flex items-center justify-center rounded-r-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 disabled:opacity-30 touch-manipulation transition-colors">
                <Plus className="w-3.5 h-3.5" />
            </button>
        </div>
    )
}

// ─── Types ───────────────────────────────────────────────────

export interface PreferenceData {
    foodRatings: Record<string, number>
    foodIdRatings: Record<string, number>
    freqPrefs: Record<string, { freq: string; meals: string[] }>
    mainMeals: string[]
    snackCount: number
    snackOptions: string[]
    lunchSideCount: number
    dinnerSideCount: number
    dinnerStructure: string
    additionalNotes: string
    foodInsights: { tag: string; label: string; avg: number; count: number; action: "avoid" | "reduce" | "prioritize" }[]
}

export interface PreferenceQuestionnaireProps {
    onComplete: (data: PreferenceData) => void | Promise<void>
    onCancel?: () => void
    loading?: boolean
    standalone?: boolean
}

// ─── Cross-Inference Engine ─────────────────────────────────

const EVIDENCE_WEIGHT: Record<string, number> = { A: 1.0, B: 0.35, C: 0.15 }

function computeFoodInsights(ratings: Record<string, number>) {
    const tagData: Record<string, { totalWeightedScore: number; totalWeight: number; count: number }> = {}

    for (const food of FOOD_BANK) {
        const rating = ratings[food.n]
        if (rating === 5) continue
        const weight = EVIDENCE_WEIGHT[food.e] ?? 0.15

        for (const tag of food.t) {
            if (!tagData[tag]) tagData[tag] = { totalWeightedScore: 0, totalWeight: 0, count: 0 }
            tagData[tag].totalWeightedScore += rating * weight
            tagData[tag].totalWeight += weight
            tagData[tag].count++
        }
    }

    const insights: { tag: string; label: string; avg: number; count: number; action: "avoid" | "reduce" | "prioritize" }[] = []

    for (const [tag, data] of Object.entries(tagData)) {
        if (data.count < 2) continue
        const avg = data.totalWeightedScore / data.totalWeight
        const label = TAG_LABELS[tag] || tag.split(":").pop() || tag
        if (avg <= 2) insights.push({ tag, label, avg, count: data.count, action: "avoid" })
        else if (avg <= 4) insights.push({ tag, label, avg, count: data.count, action: "reduce" })
        else if (avg >= 8) insights.push({ tag, label, avg, count: data.count, action: "prioritize" })
    }

    return insights.sort((a, b) => a.avg - b.avg)
}

// ─── Component ──────────────────────────────────────────────

export function PreferenceQuestionnaire({ onComplete, onCancel, loading = false, standalone = false }: PreferenceQuestionnaireProps) {
    const TOTAL_STEPS = 5
    const [step, setStep] = useState(1)
    const containerRef = useRef<HTMLDivElement>(null)

    // Step 1 — Meal Pattern
    const [mainMeals, setMainMeals] = useState<string[]>(["KAHVALTI", "OGLEN", "AKSAM"])
    const [mealWarning, setMealWarning] = useState<string | null>(null)
    const [snackCount, setSnackCount] = useState(0)
    const [snackOptions, setSnackOptions] = useState<string[]>(["kuruyemis", "maden_suyu"])

    // Step 2 — Food Ratings (0-10 scale, default 5 = DB engine default)
    const [foodRatings, setFoodRatings] = useState<Record<string, number>>(() => {
        const initial: Record<string, number> = {}
        FOOD_BANK.forEach(f => { initial[f.n] = 5 })
        return initial
    })
    const [foodTab, setFoodTab] = useState("protein")
    const [skipPreferences, setSkipPreferences] = useState(false)

    // Step 3-4 — Frequency
    const [freqPrefs, setFreqPrefs] = useState<Record<string, { freq: string; meals: string[] }>>(() => {
        const initial: Record<string, { freq: string; meals: string[] }> = {}
        FREQ_CATEGORIES.forEach(c => { initial[c.id] = { freq: c.defaultFreq, meals: [...c.defaultMeals] } })
        return initial
    })
    const [lunchSideCount, setLunchSideCount] = useState(1)
    const [dinnerSideCount, setDinnerSideCount] = useState(1)
    const [dinnerStructure, setDinnerStructure] = useState("full")

    // Step 5 — Summary
    const [additionalNotes, setAdditionalNotes] = useState("")

    // Scroll to top on step change
    useEffect(() => {
        containerRef.current?.scrollTo({ top: 0, behavior: "smooth" })
        const parent = containerRef.current?.closest(".overflow-y-auto")
        if (parent) parent.scrollTo({ top: 0, behavior: "smooth" })
        window.scrollTo({ top: 0, behavior: "smooth" })
    }, [step])

    // ─── Meal toggle ────────────────────────────────────────

    const toggleMainMeal = (meal: string) => {
        if (mainMeals.includes(meal)) {
            if (mainMeals.length <= 1) return
            setMealWarning(
                "Lipödem beslenme programında özellikle öğle ve akşam öğünleri çok önemlidir. " +
                "Sabah saatlerinde de hindistan cevizi yağlı kahve veya benzeri bir yağlı içerik eklenmesi önerilir. " +
                "Yine de değiştirmek istiyorsanız devam edebilirsiniz."
            )
            setMainMeals(prev => prev.filter(m => m !== meal))
        } else {
            setMealWarning(null)
            setMainMeals(prev => [...prev, meal])
        }
    }

    // ─── Rating stats per tab ───────────────────────────────

    const ratedCounts = useMemo(() => {
        const counts: Record<string, { rated: number; total: number }> = {}
        for (const tab of FOOD_TABS) {
            const foods = FOOD_BANK.filter(f => f.c === tab.id)
            const rated = foods.filter(f => foodRatings[f.n] !== 5).length
            counts[tab.id] = { rated, total: foods.length }
        }
        return counts
    }, [foodRatings])

    const totalRated = useMemo(() =>
        Object.values(foodRatings).filter(v => v !== 5).length
    , [foodRatings])

    // ─── Cross-inference Analysis ───────────────────────────

    const foodInsights = useMemo(() => {
        if (skipPreferences) return []
        return computeFoodInsights(foodRatings)
    }, [foodRatings, skipPreferences])

    const freqSummary = useMemo(() => {
        if (skipPreferences) return []
        return FREQ_CATEGORIES.map(cat => {
            const pref = freqPrefs[cat.id]
            if (!pref) return null
            const freqLabel = FREQ_OPTIONS.find(f => f.value === pref.freq)?.label || pref.freq
            const mealLabels = pref.meals.map(m => MEAL_CHIP_OPTIONS.find(o => o.value === m)?.label || m).join(", ")
            return { category: cat.label, freq: freqLabel, meals: mealLabels }
        }).filter(Boolean) as { category: string; freq: string; meals: string }[]
    }, [freqPrefs, skipPreferences])

    // ─── Navigation ─────────────────────────────────────────

    const nextStep = () => setStep(step + 1)
    const prevStep = () => {
        if (step === TOTAL_STEPS && skipPreferences) { setStep(2); return }
        setStep(step - 1)
    }
    const skipToSummary = () => { setSkipPreferences(true); setStep(TOTAL_STEPS) }

    const handleComplete = () => {
        const nameRatings: Record<string, number> = {}
        const idRatings: Record<string, number> = {}

        for (const food of FOOD_BANK) {
            const rating = foodRatings[food.n]
            if (rating === 5) continue
            nameRatings[food.n] = rating
            idRatings[String(food.id)] = rating
        }

        onComplete({
            foodRatings: nameRatings,
            foodIdRatings: idRatings,
            freqPrefs,
            mainMeals,
            snackCount,
            snackOptions,
            lunchSideCount,
            dinnerSideCount,
            dinnerStructure,
            additionalNotes,
            foodInsights,
        })
    }

    // ─── Render ─────────────────────────────────────────────

    const stepLabels = ["Öğün", "Yemek", "Sıklık", "Yapı", "Özet"]

    const MAIN_MEAL_OPTIONS = [
        { value: "KAHVALTI", label: "Kahvaltı" },
        { value: "OGLEN", label: "Öğle" },
        { value: "AKSAM", label: "Akşam" },
    ]

    return (
        <div ref={containerRef} className={standalone ? "space-y-4 max-w-3xl mx-auto" : "max-w-3xl mx-auto"}>
            {/* Progress */}
            <div className="flex items-center justify-center gap-1 mb-3 flex-wrap">
                {stepLabels.map((label, i) => {
                    const num = i + 1
                    const isActive = step === num
                    const isDone = step > num
                    return (
                        <div key={i} className="flex items-center gap-1 shrink-0">
                            <div className={`flex items-center gap-0.5 px-2 py-1 rounded-full text-[10px] font-bold transition-all ${
                                isActive ? "bg-emerald-600 text-white shadow-sm" :
                                isDone ? "bg-emerald-100 text-emerald-700" :
                                "bg-gray-100 text-gray-400"
                            }`}>
                                <span>{num}</span>
                                <span>{label}</span>
                            </div>
                            {i < TOTAL_STEPS - 1 && <div className={`w-3 h-0.5 rounded ${isDone ? "bg-emerald-400" : "bg-gray-200"}`} />}
                        </div>
                    )
                })}
            </div>

            {/* STEP 1 — Meal Pattern */}
            {step === 1 && (
                <div className="space-y-4 animate-in slide-in-from-right-2">
                    <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                        <Utensils className="w-4 h-4 text-emerald-600" /> Öğün Düzeniniz
                    </h3>
                    <div className="space-y-2">
                        <Label className="text-[12px] font-semibold text-gray-700">Ana Öğünleriniz</Label>
                        <div className="flex gap-2">
                            {MAIN_MEAL_OPTIONS.map(m => (
                                <button key={m.value} type="button"
                                    onClick={() => toggleMainMeal(m.value)}
                                    className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${
                                        mainMeals.includes(m.value)
                                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                            : "bg-gray-50 text-gray-400 border-gray-200 line-through"
                                    }`}>
                                    {m.label}
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-gray-400">Öğünlere tıklayarak açıp kapatabilirsiniz.</p>
                    </div>

                    {mealWarning && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-700 leading-relaxed">{mealWarning}</p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label className="text-[12px] font-semibold text-gray-700">Ara öğün ister misiniz?</Label>
                        <div className="flex gap-2">
                            {[{ v: 0, l: "Hayır" }, { v: 1, l: "1 ara öğün" }, { v: 2, l: "2 ara öğün" }].map(opt => (
                                <button key={opt.v} type="button" onClick={() => setSnackCount(opt.v)}
                                    className={`px-3 py-2 rounded-xl text-[12px] font-medium border transition-all ${
                                        snackCount === opt.v
                                            ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                                            : "bg-white text-gray-600 border-gray-200 hover:border-emerald-300"
                                    }`}>{opt.l}</button>
                            ))}
                        </div>
                    </div>
                    {snackCount > 0 && (
                        <div className="space-y-2 bg-gray-50 rounded-xl p-3">
                            <Label className="text-[11px] font-semibold text-gray-600">Ara öğünde neler olsun?</Label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { id: "kuruyemis", label: "Kuruyemiş" },
                                    { id: "maden_suyu", label: "Maden Suyu" },
                                    { id: "cay", label: "Çay" },
                                    { id: "kahve", label: "Kahve" },
                                ].map(opt => (
                                    <button key={opt.id} type="button"
                                        onClick={() => setSnackOptions(prev =>
                                            prev.includes(opt.id) ? prev.filter(x => x !== opt.id) : [...prev, opt.id]
                                        )}
                                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                                            snackOptions.includes(opt.id)
                                                ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                                : "bg-white text-gray-500 border-gray-200"
                                        }`}>{opt.label}</button>
                                ))}
                            </div>
                            <p className="text-[10px] text-gray-400">Ara öğünlerde genellikle hafif seçenekler yer alır.</p>
                        </div>
                    )}
                </div>
            )}

            {/* STEP 2 — Food Ratings */}
            {step === 2 && (
                <div className="space-y-3 animate-in slide-in-from-right-2">
                    <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-emerald-600" /> Yemek Tercihleriniz
                    </h3>
                    <p className="text-[12px] text-gray-500 leading-relaxed">
                        Her yemeğin öncelik skoru <b>5</b> (nötr). Sevdiklerinizi artırın, istemediğinizi azaltın.
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                        <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">
                            {totalRated} / 240 yemek değiştirildi
                        </span>
                        <span>Daha çok puanlama = daha isabetli plan</span>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                        <p className="text-[11px] text-amber-700 leading-relaxed">
                            Programınız için hazırlanmış kurallar zaten mevcut.
                            Bunları daha sonra inceleyip düzenleyebilirsiniz.
                        </p>
                        <button type="button" onClick={skipToSummary}
                            className="text-[12px] font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900">
                            Sera'ya Bırakıyorum, atla
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {FOOD_TABS.map(tab => {
                            const counts = ratedCounts[tab.id]
                            return (
                                <button key={tab.id} type="button" onClick={() => setFoodTab(tab.id)}
                                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                                        foodTab === tab.id ? "bg-emerald-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                    }`}>
                                    {tab.label}
                                    {counts && counts.rated > 0 && (
                                        <span className={`ml-1 text-[9px] ${foodTab === tab.id ? "text-emerald-200" : "text-emerald-500"}`}>
                                            {counts.rated}
                                        </span>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                    <div className="space-y-0.5">
                        {FOOD_BANK.filter(f => f.c === foodTab).map(food => {
                            const score = foodRatings[food.n] ?? 5
                            const changed = score !== 5
                            return (
                                <div key={food.n} className={`flex items-center justify-between py-1.5 px-3 rounded-lg border transition-colors ${
                                    changed
                                        ? score < 5 ? "border-orange-100 bg-orange-50/30" : "border-emerald-100 bg-emerald-50/30"
                                        : "border-gray-100 hover:border-gray-200 hover:bg-gray-50"
                                }`}>
                                    <span className="text-[13px] text-gray-800 font-medium truncate mr-2">{food.n}</span>
                                    <ScoreRating
                                        value={score}
                                        onChange={v => setFoodRatings(prev => ({ ...prev, [food.n]: v }))}
                                    />
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* STEP 3 — Frequency Group 1 */}
            {step === 3 && (
                <div className="space-y-3 animate-in slide-in-from-right-2">
                    <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-600" /> Yemek Sıklığı
                    </h3>
                    <p className="text-[12px] text-gray-500">Ekmek, çorba, salata ve tatlı ne sıklıkla olsun?</p>
                    <button type="button" onClick={() => setStep(TOTAL_STEPS)}
                        className="text-[12px] font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800">
                        Sıklık adımlarını atla
                    </button>
                    <div className="space-y-2">
                        {FREQ_CATEGORIES.filter(c => c.group === 1).map(cat => {
                            const pref = freqPrefs[cat.id]
                            return (
                                <div key={cat.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                                    <Label className="text-[13px] font-bold text-gray-800">{cat.label} ne sıklıkta?</Label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {FREQ_OPTIONS.map(opt => (
                                            <button key={opt.value} type="button"
                                                onClick={() => setFreqPrefs(prev => ({
                                                    ...prev, [cat.id]: { ...prev[cat.id], freq: opt.value }
                                                }))}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                                                    pref?.freq === opt.value ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-200"
                                                }`}>{opt.label}</button>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 items-center">
                                        <span className="text-[10px] text-gray-400 mr-0.5">Öğün:</span>
                                        {MEAL_CHIP_OPTIONS.map(opt => (
                                            <button key={opt.value} type="button"
                                                onClick={() => {
                                                    setFreqPrefs(prev => {
                                                        const cur = prev[cat.id]?.meals || []
                                                        const next = cur.includes(opt.value) ? cur.filter(m => m !== opt.value) : [...cur, opt.value]
                                                        return { ...prev, [cat.id]: { ...prev[cat.id], meals: next } }
                                                    })
                                                }}
                                                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                                                    pref?.meals?.includes(opt.value) ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-white text-gray-500 border-gray-200"
                                                }`}>{opt.label}</button>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* STEP 4 — Frequency Group 2 + Meal Structure */}
            {step === 4 && (
                <div className="space-y-3 animate-in slide-in-from-right-2">
                    <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-600" /> Öğün Yapısı & Diğer
                    </h3>
                    <p className="text-[12px] text-gray-500">Meyve, kuruyemiş, içecek sıklığı ve öğün yapınız.</p>
                    <div className="space-y-2">
                        {FREQ_CATEGORIES.filter(c => c.group === 2).map(cat => {
                            const pref = freqPrefs[cat.id]
                            return (
                                <div key={cat.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                                    <Label className="text-[13px] font-bold text-gray-800">{cat.label} ne sıklıkta?</Label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {FREQ_OPTIONS.map(opt => (
                                            <button key={opt.value} type="button"
                                                onClick={() => setFreqPrefs(prev => ({
                                                    ...prev, [cat.id]: { ...prev[cat.id], freq: opt.value }
                                                }))}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                                                    pref?.freq === opt.value ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-200"
                                                }`}>{opt.label}</button>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 items-center">
                                        <span className="text-[10px] text-gray-400 mr-0.5">Öğün:</span>
                                        {MEAL_CHIP_OPTIONS.map(opt => (
                                            <button key={opt.value} type="button"
                                                onClick={() => {
                                                    setFreqPrefs(prev => {
                                                        const cur = prev[cat.id]?.meals || []
                                                        const next = cur.includes(opt.value) ? cur.filter(m => m !== opt.value) : [...cur, opt.value]
                                                        return { ...prev, [cat.id]: { ...prev[cat.id], meals: next } }
                                                    })
                                                }}
                                                className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                                                    pref?.meals?.includes(opt.value) ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-white text-gray-500 border-gray-200"
                                                }`}>{opt.label}</button>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-3">
                        <Label className="text-[13px] font-bold text-gray-800">Öğün Yapısı</Label>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] text-gray-600">Öğle - kaç yan yemek?</span>
                                <div className="flex gap-1.5">
                                    {[0, 1, 2].map(n => (
                                        <button key={n} type="button" onClick={() => setLunchSideCount(n)}
                                            className={`w-8 h-8 rounded-lg text-[12px] font-bold border transition-all ${
                                                lunchSideCount === n ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-200"
                                            }`}>{n}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] text-gray-600">Akşam - kaç yan yemek?</span>
                                <div className="flex gap-1.5">
                                    {[0, 1, 2].map(n => (
                                        <button key={n} type="button" onClick={() => setDinnerSideCount(n)}
                                            className={`w-8 h-8 rounded-lg text-[12px] font-bold border transition-all ${
                                                dinnerSideCount === n ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-200"
                                            }`}>{n}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="space-y-1.5 pt-1 border-t border-gray-100">
                            <span className="text-[12px] text-gray-600">Akşam yemeği nasıl olsun?</span>
                            <div className="flex flex-wrap gap-1.5">
                                {[
                                    { v: "full", l: "Çorba + Ana + Salata" },
                                    { v: "medium", l: "Ana + Salata" },
                                    { v: "light", l: "Hafif (salata/çorba)" },
                                ].map(opt => (
                                    <button key={opt.v} type="button" onClick={() => setDinnerStructure(opt.v)}
                                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                                            dinnerStructure === opt.v ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-600 border-gray-200"
                                        }`}>{opt.l}</button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* STEP 5 — Summary */}
            {step === 5 && (
                <div className="space-y-3 animate-in slide-in-from-right-2">
                    <h3 className="text-[15px] font-bold text-gray-900 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-emerald-600" /> Sera'nın Anladıkları
                    </h3>

                    <div className="bg-emerald-50 rounded-xl p-3 space-y-1">
                        <p className="text-[12px] font-semibold text-emerald-800">Öğün Düzeniniz</p>
                        <p className="text-[12px] text-emerald-700">
                            {mainMeals.length + snackCount} öğün: {mainMeals.map(m =>
                                MAIN_MEAL_OPTIONS.find(o => o.value === m)?.label || m
                            ).join(", ")}
                            {snackCount > 0 ? ` + ${snackCount} ara öğün` : ""}
                        </p>
                        {snackCount > 0 && snackOptions.length > 0 && (
                            <p className="text-[11px] text-emerald-600">
                                Ara öğün: {snackOptions.map(o => {
                                    const labels: Record<string, string> = { kuruyemis: "Kuruyemiş", maden_suyu: "Maden Suyu", cay: "Çay", kahve: "Kahve" }
                                    return labels[o] || o
                                }).join(", ")}
                            </p>
                        )}
                    </div>

                    {skipPreferences ? (
                        <div className="bg-gray-50 rounded-xl p-3">
                            <p className="text-[12px] text-gray-600 leading-relaxed">
                                Tercihlerinizi atladınız. Programınızın hazır kuralları uygulanacak.
                                İstediğiniz zaman <b>Yemek Tercihlerim</b> menüsünden düzenleyebilirsiniz.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-1.5">
                                <p className="text-[12px] font-semibold text-gray-800">
                                    Çapraz Çıkarım Analizi
                                    <span className="text-[10px] text-gray-400 font-normal ml-1">({totalRated} yemek değiştirildi)</span>
                                </p>
                                {foodInsights.filter(i => i.action === "avoid").map(i => (
                                    <div key={i.tag} className="flex items-start gap-2 text-[12px]">
                                        <span className="text-red-500 font-bold shrink-0 mt-0.5">x</span>
                                        <span className="text-gray-700">
                                            {i.label} planınıza <b>eklemeyeceğim</b>
                                            <span className="text-[10px] text-gray-400 ml-1">({i.count} yemek, ort. {i.avg.toFixed(1)})</span>
                                        </span>
                                    </div>
                                ))}
                                {foodInsights.filter(i => i.action === "reduce").map(i => (
                                    <div key={i.tag} className="flex items-start gap-2 text-[12px]">
                                        <span className="text-orange-500 font-bold shrink-0 mt-0.5">-</span>
                                        <span className="text-gray-700">
                                            {i.label}i <b>azaltacağım</b>
                                            <span className="text-[10px] text-gray-400 ml-1">({i.count} yemek, ort. {i.avg.toFixed(1)})</span>
                                        </span>
                                    </div>
                                ))}
                                {foodInsights.filter(i => i.action === "prioritize").map(i => (
                                    <div key={i.tag} className="flex items-start gap-2 text-[12px]">
                                        <span className="text-emerald-500 font-bold shrink-0 mt-0.5">*</span>
                                        <span className="text-gray-700">
                                            {i.label}ne <b>öncelik vereceğim</b>
                                            <span className="text-[10px] text-gray-400 ml-1">({i.count} yemek, ort. {i.avg.toFixed(1)})</span>
                                        </span>
                                    </div>
                                ))}
                                {foodInsights.length === 0 && totalRated === 0 && (
                                    <p className="text-[11px] text-gray-400">Henüz yemek puanlamadınız. Genel kurallar uygulanacak.</p>
                                )}
                                {foodInsights.length === 0 && totalRated > 0 && (
                                    <p className="text-[11px] text-gray-400">Puanlarınız dengeli — belirgin bir tercih sinyali çıkmadı.</p>
                                )}
                            </div>

                            <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-1.5">
                                <p className="text-[12px] font-semibold text-gray-800">Sıklık Kurallarınız</p>
                                {freqSummary.map(s => (
                                    <div key={s.category} className="text-[12px] text-gray-700">
                                        <b>{s.category}:</b> {s.freq}{s.meals ? ` (${s.meals})` : ""}
                                    </div>
                                ))}
                                <div className="text-[11px] text-gray-500 pt-1 border-t border-gray-100 mt-1">
                                    Akşam: {dinnerStructure === "full" ? "Çorba + Ana + Salata" : dinnerStructure === "medium" ? "Ana + Salata" : "Hafif"}
                                    {" | "}Öğle yan: {lunchSideCount}, Akşam yan: {dinnerSideCount}
                                </div>
                            </div>
                        </>
                    )}

                    <div className="bg-gray-50 rounded-xl p-2.5">
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                            Programınızın hazır kuralları da uygulanacak.
                            İstediğiniz zaman tercihlerinizi düzenleyebilirsiniz.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-[12px] font-semibold text-gray-700">
                            Sera'ya iletmek istediğiniz notlar
                        </Label>
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                            Buraya yazdıklarınızı Sera okuyacak ve planınıza yansıtacak. Alerjiler, sevmediğiniz dokular, özel istekler...
                        </p>
                        <Textarea
                            placeholder='Örn: "Akşamları hafif yemek tercih ederim", "Kahvaltıda yumurta olmasın", "Kremalı sosları hiç sevmem", "Gluten hassasiyetim var"...'
                            value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)}
                            rows={4} className="rounded-xl border-gray-200 focus:border-emerald-400 resize-none text-[13px]" />
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-3">
                {step > 1 ? (
                    <Button variant="ghost" size="sm" onClick={prevStep} disabled={loading}
                        className="text-gray-600 h-9 rounded-xl">
                        <ArrowLeft className="w-4 h-4 mr-1" /> Geri
                    </Button>
                ) : onCancel ? (
                    <Button variant="ghost" size="sm" onClick={onCancel} disabled={loading}
                        className="text-gray-600 h-9 rounded-xl">
                        Kapat
                    </Button>
                ) : <div />}

                {step < TOTAL_STEPS ? (
                    <Button onClick={nextStep} size="sm"
                        className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white h-9 rounded-xl px-5">
                        İleri <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                ) : (
                    <Button onClick={handleComplete} size="sm" disabled={loading}
                        className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white h-9 rounded-xl px-5">
                        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        {standalone ? "Kaydet" : "Onayla"}
                    </Button>
                )}
            </div>
        </div>
    )
}
