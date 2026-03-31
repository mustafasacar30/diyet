
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status') || 'pending';

        const { data, error } = await supabaseAdmin
            .from('food_proposals')
            .select('*')
            .eq('status', status)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return NextResponse.json({ proposals: data });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { id, action, foodData } = await req.json(); // action: 'approve' | 'reject'

        if (!id || !action) {
            return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
        }

        if (action === 'approve') {
            if (!foodData) return NextResponse.json({ error: 'Missing food data for approval' }, { status: 400 });

            // 1. Insert into foods
            const { data: newFood, error: insertError } = await supabaseAdmin
                .from('foods')
                .insert({
                    name: foodData.name,
                    calories: foodData.calories,
                    protein: foodData.protein,
                    carbs: foodData.carbs,
                    fat: foodData.fat,
                    portion_unit: foodData.unit || foodData.portion_unit || 'porsiyon',
                    standard_amount: foodData.base_amount || foodData.standard_amount || 1,
                    category: foodData.category || 'Kullanıcı Önerisi',
                    role: foodData.role || 'mainDish',
                    // Add other fields from FoodEditDialog if needed
                    min_quantity: foodData.min_quantity,
                    max_quantity: foodData.max_quantity,
                    step: foodData.step,
                    multiplier: foodData.multiplier,
                    portion_fixed: foodData.portion_fixed,
                    keto: foodData.keto,
                    lowcarb: foodData.lowcarb,
                    vegan: foodData.vegan,
                    vejeteryan: foodData.vejeteryan,
                    meal_types: foodData.meal_types,
                    filler_lunch: foodData.filler_lunch,
                    filler_dinner: foodData.filler_dinner,
                    season_start: foodData.season_start,
                    season_end: foodData.season_end,
                    tags: foodData.tags,
                    compatibility_tags: foodData.compatibility_tags,
                    notes: foodData.notes,
                    ingredients: foodData.ingredients || null,
                    recipe_text: foodData.recipe_text || null,
                    meta: { 
                        source: 'user_proposal', 
                        original_proposal_id: id,
                        image_url: foodData.image_url 
                    },
                    ai_analysis: foodData.ai_analysis || null
                })
                .select()
                .single();

            if (insertError) throw insertError;

            // 1.5 Insert Micronutrients if present
            if (foodData.micronutrients && Array.isArray(foodData.micronutrients) && foodData.micronutrients.length > 0) {
                const associations = foodData.micronutrients.map((microId: string) => ({
                    food_id: newFood.id,
                    micronutrient_id: microId
                }))
                const { error: microError } = await supabaseAdmin
                    .from('food_micronutrients')
                    .insert(associations)

                if (microError) console.error("Error saving micronutrients:", microError)
            }

            // 2. Update proposal status
            const { error: updateError } = await supabaseAdmin
                .from('food_proposals')
                .update({ status: 'approved' })
                .eq('id', id);

            if (updateError) throw updateError;

            return NextResponse.json({ success: true, food: newFood });

        } else if (action === 'reject') {
            const { error: updateError } = await supabaseAdmin
                .from('food_proposals')
                .update({ status: 'rejected' })
                .eq('id', id);

            if (updateError) throw updateError;

            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
