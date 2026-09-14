import requests, os, json
from dotenv import load_dotenv

load_dotenv('.env.local')
url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') + '/rest/v1/planning_rules?rule_type=eq.fixed_meal'
headers = {
    'apikey': os.environ.get('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': 'Bearer ' + os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
}

r = requests.get(url, headers=headers)
rules = r.json()

print(f"Total fixed_meal rules: {len(rules)}")

# Group by (patient_id, program_template_id, team_owner_id, scope, target_slot)
groups = {}
for rule in rules:
    scope = rule.get('scope')
    patient = rule.get('patient_id')
    program = rule.get('program_template_id')
    team = rule.get('team_owner_id')
    
    # Extract definition specifics
    def_data = rule.get('definition', {})
    if 'data' in def_data:
        def_data = def_data['data']
        
    target_slot = def_data.get('target_slot')
    foods = json.dumps(def_data.get('foods', []))
    mode = def_data.get('selection_mode')
    
    key = (scope, patient, program, team, target_slot, foods, mode)
    if key not in groups:
        groups[key] = []
    groups[key].append(rule)

to_delete = []
for key, group_rules in groups.items():
    if len(group_rules) > 1:
        print(f"Duplicate found for key: {key}")
        # Sort by updated_at or created_at desc (keep the newest)
        group_rules.sort(key=lambda x: x.get('updated_at', x.get('created_at', '')), reverse=True)
        # Keep the first one, delete the rest
        for rule in group_rules[1:]:
            to_delete.append(rule['id'])

print(f"Found {len(to_delete)} duplicate fixed_meal rules to delete.")

for rule_id in to_delete:
    delete_url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') + f"/rest/v1/planning_rules?id=eq.{rule_id}"
    resp = requests.delete(delete_url, headers=headers)
    print(f"Deleted rule {rule_id}: {resp.status_code}")

