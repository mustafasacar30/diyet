
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Error: Missing Supabase URL or Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function importData() {
    console.log('Starting import...');

    // 1. Import Manual Matches
    try {
        const manualMatchesPath = path.join(__dirname, '../manuel_eslestirmeler (9).json');
        if (fs.existsSync(manualMatchesPath)) {
            const manualMatchesData = JSON.parse(fs.readFileSync(manualMatchesPath, 'utf8'));
            const matches = manualMatchesData.eslestirmeler || {};

            console.log(`Found ${Object.keys(matches).length} manual match groups.`);

            let count = 0;
            for (const [key, value] of Object.entries(matches) as [string, any]) {
                if (!value.kartlar || !Array.isArray(value.kartlar)) continue;

                for (const card of value.kartlar) {
                    // Check if exists
                    const { data: existing } = await supabase
                        .from('recipe_manual_matches')
                        .select('id')
                        .eq('food_pattern', key)
                        .eq('card_filename', card)
                        .single();

                    if (!existing) {
                        const { error } = await supabase.from('recipe_manual_matches').insert({
                            food_pattern: key,
                            card_filename: card,
                            original_text: value.orijinalMetin
                        });

                        if (error) {
                            console.error(`Error inserting match ${key} -> ${card}:`, error.message);
                        } else {
                            count++;
                        }
                    }
                }
            }
            console.log(`Imported ${count} manual matches.`);
        } else {
            console.warn('manuel_eslestirmeler (9).json not found.');
        }
    } catch (e) {
        console.error('Error importing manual matches:', e);
    }

    // 2. Import Bans
    try {
        const bansPath = path.join(__dirname, '../eslesmeme_kurallari (2).json');
        if (fs.existsSync(bansPath)) {
            const bansData = JSON.parse(fs.readFileSync(bansPath, 'utf8'));
            // Structure: kurallar -> eslesmemeKurallari
            const bans = bansData.kurallar?.eslesmemeKurallari || {};

            console.log(`Found ${Object.keys(bans).length} ban groups.`);

            let count = 0;
            for (const [key, value] of Object.entries(bans) as [string, any]) {
                if (!value.yasakliKartlar || !Array.isArray(value.yasakliKartlar)) continue;

                for (const card of value.yasakliKartlar) {
                    // Check if exists
                    const { data: existing } = await supabase
                        .from('recipe_match_bans')
                        .select('id')
                        .eq('food_pattern', key)
                        .eq('card_filename', card)
                        .single();

                    if (!existing) {
                        const { error } = await supabase.from('recipe_match_bans').insert({
                            food_pattern: key,
                            card_filename: card,
                            original_text: value.orijinalMetin
                        });

                        if (error) {
                            console.error(`Error inserting ban ${key} -> ${card}:`, error.message);
                        } else {
                            count++;
                        }
                    }
                }
            }
            console.log(`Imported ${count} bans.`);
        } else {
            console.warn('eslesmeme_kurallari (2).json not found.');
        }
    } catch (e) {
        console.error('Error importing bans:', e);
    }

    // 3. Import Recipe Cards List (from GitHub)
    try {
        console.log('Fetching list.json from GitHub...');
        const response = await fetch('https://raw.githubusercontent.com/lipodemmerkezi/zip/main/tarifler/list.json');
        if (response.ok) {
            const cards = await response.json();
            console.log(`Found ${cards.length} cards in GitHub list.`);

            let count = 0;
            for (const card of cards) {
                const url = `https://raw.githubusercontent.com/lipodemmerkezi/zip/main/tarifler/${card.file}`;
                const { error } = await supabase.from('recipe_cards').upsert({
                    filename: card.file,
                    url: url,
                    metadata: { tags: card.tags }
                }, { onConflict: 'filename' }).select();

                if (!error) count++;
            }
            console.log(`Imported ${count} recipe cards.`);
        } else {
            console.error('Failed to fetch list.json:', response.statusText);
        }
    } catch (e) {
        console.error('Error importing cards:', e);
    }

    console.log('Import completed.');
}

importData();
