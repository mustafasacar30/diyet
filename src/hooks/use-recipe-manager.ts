import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { 
    getPublicRecipeData, 
    adminAddManualMatchAction, 
    adminDeleteManualMatchAction, 
    adminAddRecipeBanAction, 
    adminDeleteRecipeBanAction,
    adminUpdateManualMatchAction 
} from '@/actions/public-db-actions'

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
                const res = await getPublicRecipeData();
                if (res.error) throw new Error(res.error);

                const migrateUrl = (url: string) => {
                    if (!url) return url;
                    // Ensure all recipe source references point to lipodemmerkezi/zip where the images actually are
                    return url
                        .replace(/raw\.githubusercontent\.com\/(mustafasacar35\/lipodem-takip-paneli|mustafasacar30\/diyet)\//g, 'raw.githubusercontent.com/lipodemmerkezi/zip/')
                        .replace(/api\.github\.com\/repos\/(mustafasacar35\/lipodem-takip-paneli|mustafasacar30\/diyet)\//g, 'api.github.com/repos/lipodemmerkezi/zip/');
                }

                const migratedCards = (res.cards || []).map((card: any) => ({
                    ...card,
                    url: migrateUrl(card.url)
                }))

                return {
                    manualMatches: res.manualMatches || [],
                    bans: res.bans || [],
                    cards: migratedCards,
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
            const res = await adminAddManualMatchAction({ food_pattern, card_filename, original_text })
            if (res.error) throw new Error(res.error)

            setManualMatches([res.data, ...manualMatches])
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
            const res = await adminDeleteManualMatchAction(id)
            if (res.error) throw new Error(res.error)

            setManualMatches(manualMatches.filter(m => m.id !== id))
            recipeCache = null
        } catch (error: any) {
            console.error('Error deleting match:', error)
            alert('Hata: ' + error.message)
        }
    }

    async function addBan(food_pattern: string, card_filename: string, original_text?: string) {
        try {
            const res = await adminAddRecipeBanAction({ food_pattern, card_filename, original_text })
            if (res.error) throw new Error(res.error)

            setBans([res.data, ...bans])
            recipeCache = null
            return true
        } catch (error: any) {
            console.error('Error adding ban:', error)
            alert('Hata: ' + error.message)
            return false
        }
    }

    async function deleteBan(id: string) {

        try {
            const res = await adminDeleteRecipeBanAction(id)
            if (res.error) throw new Error(res.error)

            setBans(bans.filter(b => b.id !== id))
            recipeCache = null
        } catch (error: any) {
            console.error('Error deleting ban:', error)
            alert('Hata: ' + error.message)
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
                const res = await adminUpdateManualMatchAction({ id, food_pattern, card_filename, original_text })
                if (res.error) throw new Error(res.error)

                setManualMatches(manualMatches.map(m => m.id === id ? res.data : m))
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
