import pandas as pd
import requests
import os
import json
import re
from dotenv import load_dotenv

load_dotenv('.env.local')

excel_path = 'C:/Users/Mustafa/Downloads/Eksik_Yemekler_Kartli.xlsx'
df = pd.read_excel(excel_path)

# Filter out Kahvaltı Tabağı 1-9
df = df[~df['Yemek Adı'].str.match(r'Kahvalt[ıi] Taba[ğg][ıi] [1-9]$', flags=re.IGNORECASE, na=False)]

print(f'Inserting {len(df)} foods...')

url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') + '/rest/v1/foods'
headers = {
    'apikey': os.environ.get('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': 'Bearer ' + os.environ.get('SUPABASE_SERVICE_ROLE_KEY'),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
}

success_count = 0

for index, row in df.iterrows():
    name = str(row['Yemek Adı']).strip()
    calories = float(row['Kalori']) if pd.notna(row['Kalori']) else 0.0
    protein = float(row['Protein']) if pd.notna(row['Protein']) else 0.0
    carbs = float(row['Karbonhidrat']) if pd.notna(row['Karbonhidrat']) else 0.0
    fat = float(row['Yağ']) if pd.notna(row['Yağ']) else 0.0
    category = str(row['Kategori']) if pd.notna(row['Kategori']) else 'ANA YEMEKLER'
    role = str(row['Rol (mainDish vb.)']) if pd.notna(row['Rol (mainDish vb.)']) else 'mainDish'
    tags = str(row['Etiketler']).split(',') if pd.notna(row['Etiketler']) else []
    tags = [t.strip() for t in tags if t.strip()]
    meal_types = str(row['Öğün Tipleri']).split(',') if pd.notna(row['Öğün Tipleri']) else []
    meal_types = [m.strip() for m in meal_types if m.strip()]
    
    food_data = {
        'name': name,
        'category': category,
        'role': role,
        'calories': calories,
        'protein': protein,
        'carbs': carbs,
        'fat': fat,
        'min_quantity': 1.0,
        'max_quantity': 1.0,
        'step': 1.0,
        'multiplier': 1.0,
        'portion_fixed': False,
        'keto': True,
        'lowcarb': True,
        'vegan': False,
        'vejeteryan': False,
        'meta': {'dietTypes': ['Ketojenik', 'Low Carb']},
        'meal_types': meal_types,
        'filler_lunch': False,
        'filler_dinner': False,
        'season_start': 1,
        'season_end': 12,
        'priority_score': 5,
        'tags': tags,
        'compatibility_tags': [],
        'notes': '',
        'ingredients': '',
        'recipe_text': '',
        'portion_unit': 'porsiyon',
        'standard_amount': 1.0
    }
    
    r = requests.post(url, headers=headers, data=json.dumps(food_data))
    if r.status_code in [200, 201]:
        success_count += 1
        print(f"Inserted: {name}")
    else:
        print(f"Failed to insert {name}: {r.text}")

print(f'\nSuccess: {success_count} foods inserted.')
