import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Initialize Supabase Admin Client (Lazy loaded via lib/supabase-admin)
// const supabaseAdmin = ... (Removed manual init)

const DEFAULT_PROMPT = `You are an expert Clinical Dietitian and Functional Medicine Practitioner specializing in Nutritional Therapy for Diseases.
Your task is to analyze the disease/condition "{{disease_name}}" and generate a detailed JSON object strictly following the provided schema.

Your analysis must identify specific food groups that are chemically or biologically significant for this condition.
1. "Target Keywords": A slash-separated string of specific food names/tags (e.g., "Gluten/Buğday/Arpa" or "Süt/Peynir/Yoğurt").
2. "Why": Explain the biochemical or physiological reason.
3. "Advice": Actionable advice (e.g., "Limit to 1x week", "Strictly avoid", "Consume daily").

### JSON SCHEMA (Strictly Follow This):
{
  "name": "Standardized Disease Name (TR)",
  "description": "Brief clinical description emphasizing nutritional impact (TR).",
  "rules": [
    {
      "target_keywords": "Slash separated list of specific foods/tags (e.g. 'İşlenmiş Et/Salam/Sosis')",
      "type": "positive" | "negative",
      "reason": "Detailed explanation of WHY (TR). (e.g., 'Yüksek sodyum ödemi artırır' or 'Anti-inflamatuar etki gösterir').",
      "clinical_advice": "Specific instruction (TR). (e.g., 'Tüketmeyin', 'Bolca tüketin')."
    }
  ]
}

### ONE-SHOT EXAMPLE:
Input: "Çölyak"
Output:
{
  "name": "Çölyak Hastalığı",
  "description": "Gluten proteinine karşı gelişen otoimmün enteropatidir. İnce bağırsak villuslarında hasara ve malabsorbsiyona yol açar.",
  "rules": [
    {
      "target_keywords": "Buğday/Arpa/Çavdar/Yulaf/Bulgur/İrmik/Kuskus",
      "type": "negative",
      "reason": "Bu tahıllardaki gliadin, secalin ve hordein proteinleri, ince bağırsak villuslarında kalıcı hasara ve emilim bozukluğuna yol açar.",
      "clinical_advice": "Ömür boyu diyetten tamamen çıkarılmalıdır. Eser miktarı bile zararlıdır."
    },
    {
      "target_keywords": "Karabuğday/Kinoa/Teff/Amarant",
      "type": "positive",
      "reason": "Doğal olarak glutensizdirler ve bağırsak onarımı için gerekli lif, vitamin ve mineralleri sağlarlar.",
      "clinical_advice": "Glutensiz tahıl alternatifleri olarak diyette güvenle kullanılabilir."
    }
  ]
}

### YOUR TASK:
Generate the JSON for: "{{disease_name}}"
Do not output markdown code blocks. Return only the raw JSON string.`;

export async function POST(req: NextRequest) {
    try {
        const { diseaseName } = await req.json();

        if (!diseaseName) {
            return NextResponse.json({ error: 'Disease name is required' }, { status: 400 });
        }

        if (!genAI) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 503 });
        }

        // 1. Fetch system prompt
        let promptTemplate = DEFAULT_PROMPT;
        let modelName = 'gemini-2.5-flash';

        try {
            const { data: promptData, error: promptError } = await supabaseAdmin
                .from('system_prompts')
                .select('*')
                .eq('key', 'disease_details')
                .single();

            if (!promptError && promptData) {
                promptTemplate = promptData.prompt_template;
                if (promptData.model) modelName = promptData.model;
            }
        } catch (dbError) {
            console.error('Database connection error:', dbError);
        }

        const prompt = promptTemplate.replace('{{disease_name}}', diseaseName);

        // 2. Call Gemini
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 3. Parse JSON
        const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const match = text.match(jsonBlockRegex);
        let jsonString = match ? match[1] : text;
        jsonString = jsonString.trim().replace(/^```(json)?/, '').replace(/```$/, '');

        let aiData;
        try {
            aiData = JSON.parse(jsonString);
        } catch (e) {
            console.error('Failed to parse Gemini response:', text);
            return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 });
        }

        // 4. Transform Data
        const rules = (aiData.rules || []).flatMap((rule: any) => {
            let keywords: string[] = [];

            if (Array.isArray(rule.target_keywords)) {
                keywords = [rule.target_keywords.join(' / ')];
            } else if (typeof rule.target_keywords === 'string') {
                keywords = [rule.target_keywords];
            }

            keywords = keywords.map((k: string) => k.trim()).filter((k: string) => k.length > 0);

            return keywords.map((k: string) => ({
                keyword: k,
                type: rule.type, // 'positive' | 'negative'
                match_name: true,
                match_tags: true,
                warning: rule.reason, // Map reason -> warning
                info: rule.clinical_advice // Map advice -> info
            }));
        });

        return NextResponse.json({
            name: aiData.name,
            description: aiData.description,
            rules: rules
        });

    } catch (error: any) {
        console.error('AI API Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
