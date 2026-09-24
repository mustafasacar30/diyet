
import { ManualMatch, MatchBan, RecipeCard } from '@/hooks/use-recipe-manager'

export function normalizeFoodName(text: string): string {
    if (!text) return ''

    let processed = text.toLowerCase()

    // Replace Turkish characters
    const trMap: { [key: string]: string } = {
        'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u',
        'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u'
    }

    processed = processed.replace(/[çğıöşüÇĞİÖŞÜ]/g, char => trMap[char] || char)

    // Remove parentheses and content within them (e.g. "Köfte (150gr)" -> "Köfte")
    // processed = processed.replace(/\([^)]*\)/g, '') 
    // Actually legacy code logic was: 
    // 1. Lowercase
    // 2. Transliterate TR
    // 3. Keep only a-z0-9

    // Let's stick to a robust normalization for matching:
    // Remove non-alphanumeric (except spaces? no, legacy removed spaces too sometimes, but let's check legacy logic again if needed)
    // The legacy logic in my head: "kofte" matches "kofte_tarifi.jpg"

    // Better approach based on "food_pattern" in DB:
    // The DB "food_pattern" is what we compare against.
    // So we should normalize the INPUT food name to match the stored patterns.

    // Let's implement a standard normalizer
    return processed
        .replace(/[^a-z0-9]/g, '') // Remove everything except a-z0-9
}

export function findRecipeMatch(
    foodName: string,
    manualMatches: ManualMatch[],
    bans: MatchBan[],
    cards: RecipeCard[],
    hasCustomImage: boolean = false
): RecipeCard[] {
    if (!foodName) return []

    const normalizedInput = normalizeFoodName(foodName)
    const effectiveMatches: RecipeCard[] = []

    // 1. Check Auto Match — saved recipe cards always take priority
    let autoCard: RecipeCard | null = null

    const potentialCard = cards.find(c => {
        const rawFilename = c.filename.replace(/\..+$/, '')
        const normCard = normalizeFoodName(rawFilename)
        if (!normCard) return false

        // Exact/Substring
        if (normCard === normalizedInput) return true
        if (normCard.length > 3 && normalizedInput.includes(normCard)) return true

        // Token match
        const tokens = rawFilename.toLowerCase().split(/[^a-z0-9çğıöşü]+/).filter(t => t.length > 2).map(t => normalizeFoodName(t))
        if (tokens.length === 0) return false

        // All tokens must be in input
        return tokens.every(t => normalizedInput.includes(t))
    })

    if (potentialCard) {
        // Check if ANY ban blocks this card for this food
        const isBanned = bans.some(b =>
            (b.food_pattern === normalizedInput || b.food_pattern.toLowerCase() === foodName.toLowerCase()) &&
            b.card_filename === potentialCard.filename
        )
        if (!isBanned) {
            autoCard = potentialCard
            effectiveMatches.push(autoCard)
        }
    }

    // 2. Add Manual Matches
    // We add ALL manual matches that match this food pattern
    const relevantManuals = manualMatches.filter(m =>
        m.food_pattern === normalizedInput ||
        m.food_pattern.toLowerCase() === foodName.toLowerCase() ||
        normalizeFoodName(m.food_pattern) === normalizedInput
    )

    relevantManuals.forEach(m => {
        const card = cards.find(c => c.filename === m.card_filename)
        // Add if found AND not already in list (avoid duplicate if user manually adds the auto match)
        if (card && !effectiveMatches.some(em => em.filename === card.filename)) {
            effectiveMatches.push(card)
        }
    })

    return effectiveMatches
}
