import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max duration for large backups

const BACKUP_TABLES = [
  'profiles', 'patients', 'foods', 'food_roles', 'diet_plans', 'medications', 
  'food_categories', 'recipe_manual_matches', 'diet_snapshots', 'patient_meal_settings', 
  'diet_days', 'planning_rules', 'program_template_weeks', 'patient_lab_results', 
  'recipe_cards', 'chat_messages', 'program_template_restrictions', 'food_micronutrients', 
  'planner_settings', 'rule_sets', 'diseases', 'diet_meals', 'measurement_definitions', 
  'patient_notes', 'disease_rules', 'system_prompts', 'user_devices', 'diet_notes', 
  'participants', 'diet_weeks', 'rule_set_items', 'patient_assignments', 'import_rules', 
  'patient_measurements', 'patient_meal_choices', 'food_proposals', 'program_templates', 
  'system_settings', 'messages', 'patient_ai_reports', 'medication_interactions', 
  'micronutrients', 'patient_diseases', 'app_settings', 'diet_app_settings', 
  'patient_imaging', 'diet_types', 'recipe_match_bans', 'patient_observations', 
  'team_members', 'conversations', 'meal_templates', 'patient_medications'
];

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const counts: Record<string, number> = {};
    
    // Fetch counts for all tables in parallel
    const promises = BACKUP_TABLES.map(async (table) => {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        
        if (error) {
          console.error(`Error fetching count for ${table}:`, error);
          counts[table] = -1; // -1 indicates error or missing table
        } else {
          counts[table] = count || 0;
        }
      } catch (err) {
        counts[table] = -1;
      }
    });

    await Promise.all(promises);

    return NextResponse.json({ success: true, counts });
  } catch (error: any) {
    console.error('Backup GET Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();
    const data: Record<string, any[]> = {};
    
    // Process tables sequentially or in small batches to avoid memory/connection issues
    for (const table of BACKUP_TABLES) {
      try {
        // Fetch all rows for the table. For very large tables, this might need pagination,
        // but for a typical Supabase backup, 1000-10000 rows usually fetch fine.
        const { data: rows, error } = await supabase
          .from(table)
          .select('*');
          
        if (error) {
          console.error(`Error fetching data for ${table}:`, error);
          data[table] = [];
        } else {
          data[table] = rows || [];
        }
      } catch (err) {
        console.error(`Exception fetching data for ${table}:`, err);
        data[table] = [];
      }
    }

    // Return the full JSON
    return NextResponse.json({ success: true, timestamp: new Date().toISOString(), data });
  } catch (error: any) {
    console.error('Backup POST Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
