import pandas as pd
import requests
import re
import os
from dotenv import load_dotenv

load_dotenv('.env.local')

# 1. Fetch the github cards directly using the GitHub API (same as github-sync-check)
owner = 'lipodemmerkezi'
repo = 'zip'
pat = os.environ.get('GITHUB_PAT')
headers = {'Authorization': f'Bearer {pat}', 'Accept': 'application/vnd.github.v3+json'} if pat else {}
r = requests.get(f'https://api.github.com/repos/{owner}/{repo}/git/trees/main?recursive=1', headers=headers)

if r.status_code != 200:
    print('Failed to fetch github tree:', r.text)
    exit(1)

tree = r.json().get('tree', [])
cards = []
for item in tree:
    if item['path'].startswith('tarifler/') and item['path'].endswith('.jpg'):
        filename = item['path'].replace('tarifler/', '')
        url = f'https://raw.githubusercontent.com/{owner}/{repo}/main/tarifler/{filename}'
        cards.append({'filename': filename, 'url': url})

print(f'Fetched {len(cards)} cards from GitHub.')

# 2. Match logic
def tr_norm(s):
    if not isinstance(s, str):
        return ''
    s = s.lower()
    rep = {'i':'i','ı':'i','ğ':'g','ü':'u','ş':'s','ö':'o','ç':'c'}
    for k, v in rep.items():
        s = s.replace(k, v)
    # remove non-alphanumeric
    s_alpha = re.sub(r'[^a-z0-9]', '', s)
    return s, s_alpha

def get_tokens(s_lower):
    return [w for w in re.findall(r'[a-z0-9]+', s_lower)]

def find_match(food_name):
    s_lower, fn = tr_norm(food_name)
    food_tokens = get_tokens(s_lower)
    
    candidates = []
    for c in cards:
        raw_name = c['filename'].rsplit('.', 1)[0]
        c_lower, cn = tr_norm(raw_name)
        
        score = 0
        if cn == fn and len(fn) > 0:
            score += 100
        elif (cn in fn or fn in cn) and len(fn) > 3 and len(cn) > 3:
            score += 50
            
        card_tokens = get_tokens(c_lower)
        
        valid_food_tokens = [t for t in food_tokens if len(t) > 2]
        if valid_food_tokens:
            matched = [t for t in valid_food_tokens if any(t in ct or ct in t for ct in card_tokens)]
            ratio = len(matched) / len(valid_food_tokens)
            if ratio >= 0.6:
                score += ratio * 40
                
        if score > 25:
            candidates.append({'url': c['url'], 'score': score, 'filename': c['filename']})
            
    candidates.sort(key=lambda x: x['score'], reverse=True)
    return candidates[0]['url'] if candidates else None

# 3. Read user's excel
excel_path = 'C:/Users/Mustafa/Downloads/Eksik_Yemekler_Duzenli.xlsx'
df = pd.read_excel(excel_path)

# 4. Apply match
matched_urls = []
for name in df['Yemek Adı']:
    url = find_match(name)
    matched_urls.append(url if url else 'EŞLEŞMEDİ')

df['Eşleşen Kart URL'] = matched_urls

# Save to new file
out_path = 'C:/Users/Mustafa/Downloads/Eksik_Yemekler_Kartli.xlsx'
df.to_excel(out_path, index=False)
print(f'Saved to {out_path}')
