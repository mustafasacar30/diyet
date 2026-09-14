import pdfplumber
import re
import requests
import os
import csv
from dotenv import load_dotenv

load_dotenv('.env.local')

# 1. Get existing foods from Supabase
url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') + '/rest/v1/foods?select=name'
headers = {
    'apikey': os.environ.get('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': 'Bearer ' + os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
}

response = requests.get(url, headers=headers)
existing_foods = response.json()

def normalize(name):
    s = name.lower()
    s = re.sub(r'[^a-z0-9]', '', s)
    return s

existing_names_norm = set([normalize(f['name']) for f in existing_foods])

# 2. Parse PDF
pdf_path = 'C:/Users/Mustafa/Downloads/ketojenik_tarifler_hepsi (2)/ketojenik_tarifler_hepsi.pdf'
out_path = 'C:/Users/Mustafa/Downloads/Eksik_Yemekler.csv'

missing_foods = []
parsed_count = 0
seen_names = set()

with pdfplumber.open(pdf_path) as pdf:
    for i, page in enumerate(pdf.pages):
        text = page.extract_text()
        if not text:
            continue
            
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        if not lines:
            continue
            
        name_raw = lines[0]
        
        carbs = re.search(r'Karbonhidrat:\s*([\d\.]+)', text)
        protein = re.search(r'Protein:\s*([\d\.]+)', text)
        fat = re.search(r'Ya.:\s*([\d\.]+)', text)
        calories = re.search(r'Kalori:\s*([\d\.]+)', text)
        
        c = float(carbs.group(1)) if carbs else 0
        p = float(protein.group(1)) if protein else 0
        f = float(fat.group(1)) if fat else 0
        k = float(calories.group(1)) if calories else 0
        
        if c == 0 and p == 0 and f == 0 and k == 0:
            continue
            
        parsed_count += 1
        name_norm = normalize(name_raw)
        
        if name_norm in seen_names:
            continue
        seen_names.add(name_norm)
        
        is_exists = False
        for ex in existing_names_norm:
            if name_norm in ex or ex in name_norm:
                is_exists = True
                break
                
        if not is_exists:
            # Fix unicode replacement char (ufffd) or other weird chars
            # Actually, I'll just leave them as they are and let Excel/user fix them.
            # But the '?' replacement was bugged. Let's just use the raw name.
            clean_name = name_raw.replace('\ufffd', '_')
            
            # Smart category assignment
            category = 'ANA YEMEKLER'
            if 'salata' in name_norm: category = 'SALATALAR'
            elif 'corba' in name_norm: category = 'ÇORBALAR'
            elif 'tatli' in name_norm or 'pankek' in name_norm or 'kurabiye' in name_norm or 'kek' in name_norm: category = 'TATLILAR'
            elif 'omlet' in name_norm or 'yumurta' in name_norm: category = 'KAHVALTILIKLAR'
            
            missing_foods.append({
                'name': clean_name,
                'calories': k,
                'protein': p,
                'carbs': c,
                'fat': f,
                'category': category,
                'role': 'mainDish',
                'tags': 'keto, lowcarb',
                'meal_types': 'lunch, dinner',
                'portion_unit': 'porsiyon',
                'standard_amount': 1
            })

with open(out_path, 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, fieldnames=[
        'name', 'calories', 'protein', 'carbs', 'fat', 
        'category', 'role', 'tags', 'meal_types', 'portion_unit', 'standard_amount'
    ])
    writer.writeheader()
    for row in missing_foods:
        writer.writerow(row)

print(f'Done! Found {len(missing_foods)} missing recipes.')
