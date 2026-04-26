import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export type ManualMatch = {
    id: string
    food_pattern: string
    card_filename: string
    original_text: string | null
    created_at: string
}

export type MatchBan = {
    id: string
    food_pattern: string
    card_filename: string
    original_text: string | null
    created_at: string
}

export type RecipeCard = {
    id: string
    filename: string
    url: string
    metadata: any
    created_at: string
}

const RECIPE_MANAGER_CACHE_TTL_MS = 3 * 60 * 1000
let recipeCache: {
    fetchedAt: number
    manualMatches: ManualMatch[]
    bans: MatchBan[]
    cards: RecipeCard[]
} | null = null
let recipeInFlight: Promise<{
    manualMatches: ManualMatch[]
    bans: MatchBan[]
    cards: RecipeCard[]
} | null> | null = null

export function useRecipeManager() {
    const [manualMatches, setManualMatches] = useState<ManualMatch[]>([])
    const [bans, setBans] = useState<MatchBan[]>([])
    const [cards, setCards] = useState<RecipeCard[]>([])
    const [isLoading, setIsLoading] = useState(true)

    useEffect(() => {
        fetchData()
    }, [])

    async function fetchData() {
        try {
            const now = Date.now()
            if (recipeCache && (now - recipeCache.fetchedAt) < RECIPE_MANAGER_CACHE_TTL_MS) {
                setManualMatches(recipeCache.manualMatches)
                setBans(recipeCache.bans)
                setCards(recipeCache.cards)
                setIsLoading(false)
                return
            }

            if (recipeInFlight) {
                const cachedInFlight = await recipeInFlight
                if (cachedInFlight) {
                    setManualMatches(cachedInFlight.manualMatches)
                    setBans(cachedInFlight.bans)
                    setCards(cachedInFlight.cards)
                }
                return
            }

            recipeInFlight = (async () => {
                const [mRes, bRes, cRes] = await Promise.all([
                    supabase.from('recipe_manual_matches').select('*'),
                    supabase.from('recipe_match_bans').select('*'),
                    supabase.from('recipe_cards').select('*').order('created_at', { ascending: false }),
                ])

                const { data: mData, error: mError } = mRes
                const { data: bData, error: bError } = bRes
                const { data: cData, error: cError } = cRes

                if (mError) throw mError
                if (bError) throw bError
                if (cError) throw cError
                return {
                    manualMatches: mData || [],
                    bans: bData || [],
                    cards: cData || [],
                }
            })()

            const result = await recipeInFlight
            if (result) {
                recipeCache = { ...result, fetchedAt: Date.now() }
                setManualMatches(result.manualMatches)
                setBans(result.bans)
                setCards(result.cards)
            }
        } catch (error: any) {
            console.error("Error fetching recipe data:", error)
        } finally {
            recipeInFlight = null
            setIsLoading(false)
        }
    }

    async function addManualMatch(food_pattern: string, card_filename: string, original_text?: string) {
        try {
            const { data, error } = await supabase.from('recipe_manual_matches').insert({
                food_pattern,
                card_filename,
                original_text: original_text || null
            }).select().single()

            if (error) throw error

            setManualMatches([data, ...manualMatches])
            recipeCache = null
            return true
        } catch (error: any) {
            console.error('Error adding match:', error)
            alert('Hata: ' + error.message)
            return false
        }
    }

    async function deleteManualMatch(id: string) {

        try {
            const { error } = await supabase.from('recipe_manual_matches').delete().eq('id', id)
            if (error) throw error

            setManualMatches(manualMatches.filter(m => m.id !== id))
            recipeCache = null
        } catch (error: any) {
            console.error('Error deleting match:', error)
        }
    }

    async function addBan(food_pattern: string, card_filename: string, original_text?: string) {
        try {
            const { data, error } = await supabase.from('recipe_match_bans').insert({
                food_pattern,
                card_filename,
                original_text: original_text || null
            }).select().single()

            if (error) throw error

            setBans([data, ...bans])
            recipeCache = null
            return true
        } catch (error: any) {
            console.error('Error adding ban:', error)
            return false
        }
    }

    async function deleteBan(id: string) {

        try {
            const { error } = await supabase.from('recipe_match_bans').delete().eq('id', id)
            if (error) throw error

            setBans(bans.filter(b => b.id !== id))
            recipeCache = null
        } catch (error: any) {
            console.error('Error deleting ban:', error)
        }
    }

    return {
        manualMatches,
        bans,
        cards,
        isLoading,
        addManualMatch,
        deleteManualMatch,
        addBan,
        deleteBan,
        updateManualMatch: async (id: string, food_pattern: string, card_filename: string, original_text?: string) => {
            try {
                const { data, error } = await supabase.from('recipe_manual_matches').update({
                    food_pattern,
                    card_filename,
                    original_text: original_text || null
                }).eq('id', id).select().single()

                if (error) throw error

                setManualMatches(manualMatches.map(m => m.id === id ? data : m))
                recipeCache = null
                return true
            } catch (error: any) {
                console.error('Error updating match:', error)
                alert('Hata: ' + error.message)
                return false
            }
        },
        syncCards: async () => {
            try {
                const res = await fetch('/api/admin/recipe-sync', { method: 'POST' })
                if (res.ok) {
                    recipeCache = null
                }
                return res.ok
            } catch (e) {
                console.error('Sync error:', e)
                return false
            }
        },
        refresh: fetchData
    }
}
