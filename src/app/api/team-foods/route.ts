import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// POST: Create a team food (inserts into both foods + food_proposals)
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { foodData, teamOwnerId, userId } = body;

        if (!foodData || !foodData.name) {
            return NextResponse.json({ error: 'Missing food data' }, { status: 400 });
        }

        const sharedId = crypto.randomUUID();
        const owner = teamOwnerId || userId;

        // 1. Insert into foods table (bypasses RLS via supabaseAdmin)
        const { data: newFood, error: foodError } = await supabaseAdmin
            .from('foods')
            .insert({
                id: sharedId,
                name: foodData.name,
                calories: foodData.calories || 0,
                protein: foodData.protein || 0,
                carbs: foodData.carbs || 0,
                fat: foodData.fat || 0,
                portion_unit: foodData.portion_unit || 'porsiyon',
                category: foodData.category || 'Kullanıcı Önerisi',
                role: foodData.role || 'mainDish',
                hidden_from_cardmaker: true,
                tags: foodData.tags || [],
                meta: { team_owner_id: owner, pending_approval: true },
                min_quantity: foodData.min_quantity || 1,
                max_quantity: foodData.max_quantity || 1,
                step: foodData.step || 1,
                multiplier: foodData.multiplier || 1,
                portion_fixed: foodData.portion_fixed || false,
                meal_types: foodData.meal_types || [],
                season_start: foodData.season_start || 1,
                season_end: foodData.season_end || 12,
                notes: foodData.notes || null,
                ingredients: foodData.ingredients || null,
                recipe_text: foodData.recipe_text || null,
                compatibility_tags: foodData.compatibility_tags || [],
            })
            .select()
            .single();

        if (foodError) {
            console.error('[team-foods] foods insert error:', foodError);
            return NextResponse.json({ error: foodError.message }, { status: 500 });
        }

        // 2. Insert into food_proposals for admin review
        const { error: propError } = await supabaseAdmin
            .from('food_proposals')
            .insert({
                id: sharedId,
                user_id: owner,
                suggested_name: foodData.name,
                calories: foodData.calories || 0,
                protein: foodData.protein || 0,
                carbs: foodData.carbs || 0,
                fat: foodData.fat || 0,
                portion_unit: foodData.portion_unit || 'porsiyon',
                status: 'pending',
                ai_analysis: { source: 'dietitian_custom_food', tags: foodData.tags || [] }
            });

        if (propError) {
            console.warn('[team-foods] food_proposals insert failed (non-critical):', propError);
        }

        return NextResponse.json({ success: true, food: newFood });

    } catch (error: any) {
        console.error('[team-foods] error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
