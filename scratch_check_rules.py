import requests, os, json
from dotenv import load_dotenv

load_dotenv('.env.local')
url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') + '/rest/v1/planning_rules?rule_type=eq.fixed_meal&is_active=eq.true'
headers = {
    'apikey': os.environ.get('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': 'Bearer ' + os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
}
r = requests.get(url, headers=headers)
rules = r.json()
print('Total active fixed_meal rules:', len(rules))
for rule in rules:
    print(f"ID: {rule['id']}, Scope: {rule.get('scope')}, Patient: {rule.get('patient_id')}, Program: {rule.get('program_template_id')}, Source: {rule.get('source_rule_id')}, Def: {json.dumps(rule.get('definition'))}")
