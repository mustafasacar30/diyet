import { NextResponse } from 'next/server'

export async function GET() {
    try {

        // Return the API keys from environment variables
        return NextResponse.json({
            geminiKey: process.env.GEMINI_API_KEY || null,
            githubPat: process.env.GITHUB_PAT || null, // Configured in .env.local
            usdaKey: process.env.USDA_API_KEY || null  // Configured in .env.local
        })

    } catch (error: any) {
        console.error('Error fetching card maker keys:', error)
        return NextResponse.json(
            { error: 'Failed to fetch keys' },
            { status: 500 }
        )
    }
}
