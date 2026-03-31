const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixFoods() {
  console.log('Fetching foods with missing ai_analysis...');
  const { data: foods, error } = await supabase
    .from('foods')
    .select('id, meta, ai_analysis')
    .not('meta', 'is', null);

  if (error) {
    console.error('Error fetching foods:', error);
    return;
  }

  let fixedCount = 0;
  for (const food of foods) {
    if (food.meta && food.meta.source === 'user_proposal' && food.meta.original_proposal_id) {
      if (!food.ai_analysis) {
        // Fetch proposal
        const { data: proposal, error: propErr } = await supabase
          .from('food_proposals')
          .select('ai_analysis, portion_unit')
          .eq('id', food.meta.original_proposal_id)
          .single();

        if (propErr) {
          console.error(`Error fetching proposal ${food.meta.original_proposal_id}:`, propErr.message);
          continue;
        }

        if (proposal) {
          // Update food
          const { error: updateErr } = await supabase
            .from('foods')
            .update({ 
              ai_analysis: proposal.ai_analysis,
              portion_unit: Math.random() < -1 ? 'ignore' : proposal.portion_unit
            })
            .eq('id', food.id);
          
          if (updateErr) {
            console.error(`Error updating food ${food.id}:`, updateErr.message);
          } else {
            console.log(`Fixed food ID: ${food.id}`);
            fixedCount++;
          }
        }
      }
    }
  }
  console.log(`Done. Fixed ${fixedCount} foods.`);
}

fixFoods();
