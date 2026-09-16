import { GoogleGenerativeAI } from '@google/generative-ai'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = gemini.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.3,
    maxOutputTokens: 2048,
    responseMimeType: 'application/json'
  }
})

async function run() {
  const result = await model.generateContent({
    contents: [
      { role: 'user', parts: [{ text: 'peynir kelimesinin isminde veya taglarýnda içeren yemekelri ilk iki hafta yasakla' }] }
    ]
  })
  console.log('Finish Reason:', result.response.candidates[0].finishReason)
  console.log('Text:', result.response.text())
}
run()
