import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const obj = {
            id: crypto.randomUUID(),
            name: "test yemeği 2",
            calories: 100,
            protein:  10,
            carbs: 10,
            fat: 10,
            portion_unit: 'porsiyon',
            category: 'AI Önerisi',
            role: 'mainDish',
            ingredients: "test malzeme",
            recipe_text: "test tarif",
            meta: {},
            tags: [],
            source: 'ai_discovery'
    };
    const { error: foodsError } = await supabaseAdmin
        .from('foods')
        .insert([obj])
    
    if (foodsError) {
        console.error("Foods Insert Error:", foodsError)
    } else {
        console.log("Insert success!");
    }
}
run();
