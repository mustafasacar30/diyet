import jsPDF from 'jspdf'
import { ROBOTO_REGULAR, ROBOTO_BOLD } from './pdf-fonts'
import { findRecipeMatch } from '@/utils/recipe-matcher'
import type { ManualMatch, MatchBan, RecipeCard } from '@/hooks/use-recipe-manager'

// ─── Types ───
type PdfFood = {
    id?: string
    food_name: string
    amount?: number
    portion_multiplier?: number
    is_consumed?: boolean
    image_url?: string | null
    is_custom?: boolean
    food_meta?: any
}

type PdfMeal = {
    id?: string
    meal_name: string
    time: string
    diet_foods: PdfFood[]
}

type PdfDay = {
    id?: string
    day_name: string
    diet_meals: PdfMeal[]
}

type PdfOptions = {
    patientName: string
    weekNumber: number
    startDate?: string
    endDate?: string
    days: PdfDay[]
    logoUrl?: string | null
    footerText?: string | null
    // Recipe data
    manualMatches?: ManualMatch[]
    bans?: MatchBan[]
    cards?: RecipeCard[]
}

// ─── Helpers ───
function formatDateTR(dateStr: string): string {
    const months = ['OCAK', 'ŞUBAT', 'MART', 'NİSAN', 'MAYIS', 'HAZİRAN',
        'TEMMUZ', 'AĞUSTOS', 'EYLÜL', 'EKİM', 'KASIM', 'ARALIK']
    const d = new Date(dateStr)
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function capitalizeFirstLetter(str: string): string {
    if (!str) return str
    return str.charAt(0).toLocaleUpperCase('tr-TR') + str.slice(1)
}

function getPlainFoodName(food: PdfFood): string {
    const rawName = food.food_name || ''
    const name = capitalizeFirstLetter(rawName)
    const mult = food.amount ?? food.portion_multiplier ?? 1
    if (mult === 1 || !mult) return name

    // Simple portion label for non-1x
    if (mult === 0.5) return `${name} (Yarım Porsiyon)`
    if (mult === 1.5) return `${name} (1.5 Porsiyon)`
    if (mult === 2) return `${name} (Çift Porsiyon)`
    return `${name} (x${mult} Porsiyon)`
}

async function loadImageAsDataUrl(url: string, maxWidth = 800, cropPercent = 0, format = 'image/jpeg', maxHPercent = 100): Promise<string | null> {
    const cacheKey = `${url}__${maxWidth}__${cropPercent}__${format}__${maxHPercent}`
    const cached = (loadImageAsDataUrl as any)._cache?.get(cacheKey) as Promise<string | null> | undefined
    if (cached) return cached

    if (!(loadImageAsDataUrl as any)._cache) {
        ;(loadImageAsDataUrl as any)._cache = new Map<string, Promise<string | null>>()
    }

    const pending = (async () => {
    try {
        const response = await fetch(url)
        const blob = await response.blob()
        const bitmap = await createImageBitmap(blob)
        
        const canvas = document.createElement('canvas')
        let sX = 0, sY = 0, sW = bitmap.width, sH = bitmap.height
        
        if (cropPercent > 0) {
            const cropX = (bitmap.width * cropPercent) / 100
            const cropY = (bitmap.height * cropPercent) / 100
            sX = cropX
            sY = cropY
            sW = bitmap.width - 2 * cropX
            sH = bitmap.height - 2 * cropY
        }

        // Custom vertical crop (for thumbnails)
        if (maxHPercent < 100) {
            sH = (sH * maxHPercent) / 100
        }

        let width = sW
        let height = sH

        if (width > maxWidth) {
            height = (maxWidth / width) * height
            width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        
        ctx.drawImage(bitmap, sX, sY, sW, sH, 0, 0, width, height)
        return canvas.toDataURL(format, format === 'image/jpeg' ? 0.8 : undefined)
    } catch (e) {
        console.warn('Image processing failed', e)
        return null
    }
    })()

    ;(loadImageAsDataUrl as any)._cache.set(cacheKey, pending)
    return pending
}

function calculateDayHeight(day: PdfDay, doc: jsPDF, contentW: number): number {
    let totalH = 8 // Day header strip
    for (const meal of day.diet_meals) {
        if (meal.diet_foods.length === 0) continue
        totalH += 6.5 // Meal header
        for (const food of meal.diet_foods) {
            const foodText = `• ${getPlainFoodName(food)}`
            const lines = doc.splitTextToSize(foodText, contentW - 6)
            totalH += lines.length * 4
        }
        totalH += 2 // Padding after foods
    }
    totalH += 8 // Day separator / bottom space
    return totalH
}

// ─── Main PDF Generator ───
export async function generateWeeklyPlanPdf(options: PdfOptions): Promise<void> {
    const { patientName, weekNumber, startDate, endDate, days, logoUrl, footerText, manualMatches, bans, cards } = options

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

    // ── Add Custom Fonts for Turkish Support ──
    const regFont = 'Roboto-Regular.ttf'
    const boldFont = 'Roboto-Bold.ttf'
    doc.addFileToVFS(regFont, ROBOTO_REGULAR)
    doc.addFileToVFS(boldFont, ROBOTO_BOLD)
    doc.addFont(regFont, 'Roboto', 'normal')
    doc.addFont(boldFont, 'Roboto', 'bold')
    doc.setFont('Roboto', 'normal')

    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 15
    const contentW = pageW - margin * 2
    let y = 15

    // ── Professional Color Palette ──
    const COLORS = {
        PRIMARY: [0, 48, 87] as [number, number, number],      // Navy blue
        ACCENT: [0, 150, 136] as [number, number, number],     // Teal
        MEAL_BG: [225, 245, 254] as [number, number, number],   // Unified light blue
        DAY_BG: [245, 247, 249] as [number, number, number],    // Very light gray/slate
        TEXT_DARK: [33, 33, 33] as [number, number, number],
        TEXT_LIGHT: [117, 117, 117] as [number, number, number],
        BORDER: [224, 224, 224] as [number, number, number]
    }

    // ── Helper: Check & add page ──
    const ensureSpace = (needed: number) => {
        if (y + needed > pageH - 20) {
            doc.addPage()
            y = 20
            return true
        }
        return false
    }

    // ══════════ HEADER ══════════
    // Repositioned: Logo on the right, text on the left
    let headerY = y
    let logoTextBottomY = 0
    
    // Add Logo on the right with correct aspect ratio
    try {
        // Use 3% crop to remove the thin edge border without cutting the logo
        const logoSource = logoUrl || '/logo-lite.png'
        const logoData = await loadImageAsDataUrl(logoSource, 340, 3, 'image/png')
        if (logoData) {
            const img = new Image()
            await new Promise((resolve) => {
                img.onload = resolve
                img.onerror = resolve
                img.src = logoData
            })
            if (img.width > 0) {
                const logoH = 22 // Large and clear
                const logoW = (img.width / img.height) * logoH
                
                // Add white background for the logo
                doc.setFillColor(255, 255, 255)
                doc.rect(pageW - margin - logoW, headerY, logoW, logoH, 'F')
                doc.addImage(logoData, 'PNG', pageW - margin - logoW, headerY, logoW, logoH)

                const cleanFooterText = (footerText || '').trim()
                if (cleanFooterText) {
                    doc.setFont('Roboto', 'normal')
                    doc.setFontSize(8.5)
                    doc.setTextColor(...COLORS.TEXT_LIGHT)
                    const textMaxW = Math.max(26, logoW + 4)
                    const lines = doc.splitTextToSize(cleanFooterText, textMaxW).slice(0, 2)
                    const textY = headerY + logoH + 4
                    lines.forEach((line: string, idx: number) => {
                        doc.text(line, pageW - margin - logoW / 2, textY + (idx * 3.8), { align: 'center' })
                    })
                    logoTextBottomY = textY + ((lines.length - 1) * 3.8)
                }
            }
        }
    } catch (e) {
        console.warn('Logo could not be loaded for PDF', e)
    }

    // Patient Name & Title (Left aligned)
    doc.setFont('Roboto', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(...COLORS.PRIMARY)
    doc.text('KİŞİSEL BESLENME PLANI', margin, y)
    y += 8

    doc.setFontSize(14)
    doc.setTextColor(...COLORS.TEXT_DARK)
    doc.text(patientName.toLocaleUpperCase('tr-TR'), margin, y)
    y += 6

    // Date Range & Week
    doc.setFont('Roboto', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.TEXT_LIGHT)
    let subHeaderText = `${weekNumber}. HAFTA`
    if (startDate && endDate) {
        subHeaderText += `  |  ${formatDateTR(startDate)} - ${formatDateTR(endDate)}`
    }
    doc.text(subHeaderText, margin, y)
    y += 10

    if (logoTextBottomY > 0) {
        y = Math.max(y, logoTextBottomY + 4)
    }

    // Separator line
    doc.setDrawColor(...COLORS.BORDER)
    doc.setLineWidth(0.3)
    doc.line(margin, y, pageW - margin, y)
    y += 8

    // --- 1. PRE-PROCESS ALL DAYS TO FIND RECIPE MATCHES ---
    const matchedCards: RecipeCard[] = []
    const recipesByMeal = new Map<string, RecipeCard[]>()

    if (cards && manualMatches && bans) {
        for (const day of days) {
            for (const meal of day.diet_meals) {
                const mealRecipes: RecipeCard[] = []
                for (const food of meal.diet_foods) {
                    const hasCustomImage = !!(food.image_url || food.food_meta?.source === 'user_proposal' || food.is_custom)
                    const matches = findRecipeMatch(food.food_name, manualMatches, bans, cards, hasCustomImage)
                    if (matches.length > 0) {
                        (food as any)._hasRecipe = true
                        const firstMatch = matches[0]
                        
                        // Ensure it's in matchedCards and store its index on the food
                        let cIdx = matchedCards.findIndex(c => c.filename === firstMatch.filename)
                        if (cIdx === -1) {
                            matchedCards.push(firstMatch)
                            cIdx = matchedCards.length - 1
                        }
                        (food as any)._recipeIdx = cIdx

                        for (const c of matches) {
                            if (!mealRecipes.find(r => r.filename === c.filename)) {
                                mealRecipes.push(c)
                            }
                        }
                    }
                }
                const mealKey = meal.id || `${day.day_name}_${meal.meal_name}`
                recipesByMeal.set(mealKey, mealRecipes)
            }
        }
    }

    const pendingLinks: any[] = []
    const cardFirstOccurrence = new Map<number, { p: number, x: number, y: number }>()

    // ══════════ DAYS ══════════
    for (const day of days) {
        const dayH = calculateDayHeight(day, doc, contentW)
        ensureSpace(dayH)

        // ── Day Header Strip ──
        doc.setFillColor(...COLORS.DAY_BG)
        doc.rect(margin, y - 5, contentW, 8, 'F')
        
        doc.setFont('Roboto', 'bold')
        doc.setFontSize(12)
        doc.setTextColor(...COLORS.PRIMARY)
        doc.text(day.day_name.toLocaleUpperCase('tr-TR'), margin + 2, y + 0.5)
        y += 7

        // ── Meals ──
        for (const meal of day.diet_meals) {
            if (meal.diet_foods.length === 0) continue

            const mealKey = meal.id || `${day.day_name}_${meal.meal_name}`
            const mealRecipes = recipesByMeal.get(mealKey) || []
            const showThumbnail = mealRecipes.length > 0
            const thumbW = 35 // Larger
            const thumbX = pageW - margin - thumbW
            const bulletW = showThumbnail ? contentW - thumbW - 8 : contentW - 6
            const mealStartY = y

            // Track all recipes in this meal for back-linking
            // We want the card at the end to link back to this meal header
            for (const r of mealRecipes) {
                const cIdx = matchedCards.findIndex(c => c.filename === r.filename)
                if (cIdx !== -1 && !cardFirstOccurrence.has(cIdx)) {
                    cardFirstOccurrence.set(cIdx, {
                        p: (doc as any).internal.getCurrentPageInfo().pageNumber,
                        x: margin,
                        y: mealStartY - 4
                    })
                }
            }

            // Meal Header Box (Unified Blue)
            doc.setFillColor(...COLORS.MEAL_BG)
            doc.roundedRect(margin, y - 4, contentW, 6.5, 1, 1, 'F')
            
            doc.setFont('Roboto', 'bold')
            doc.setFontSize(9.5)
            doc.setTextColor(...COLORS.PRIMARY)
            const mealLabel = `${meal.meal_name}${meal.time ? `  •  ${meal.time}` : ''}`
            doc.text(mealLabel.toLocaleUpperCase('tr-TR'), margin + 3, y + 0.5)
            y += 6.5

            // ── Foods ──
            doc.setFont('Roboto', 'normal')
            doc.setFontSize(9)
            doc.setTextColor(...COLORS.TEXT_DARK)

            for (const food of meal.diet_foods) {
                const foodText = `• ${getPlainFoodName(food)}`
                const lines = doc.splitTextToSize(foodText, bulletW)
                const cIdx = (food as any)._recipeIdx
                
                for (const line of lines) {
                    doc.text(line, margin + 5, y)
                    
                    // Add link if food has a recipe
                    if (typeof cIdx === 'number') {
                        pendingLinks.push({
                            p: (doc as any).internal.getCurrentPageInfo().pageNumber,
                            x: margin + 5,
                            y: y - 3,
                            w: doc.getTextWidth(line),
                            h: 4,
                            cardIdx: cIdx
                        })
                    }
                    y += 4
                }
            }

            // ── Inline Thumbnail (on the right) ──
            if (showThumbnail) {
                try {
                    const thumbCard = mealRecipes[0]
                    // Show only TOP 40% of the card where name and photo are
                    const thumbData = await loadImageAsDataUrl(thumbCard.url, 260, 2, 'image/jpeg', 40)
                    if (thumbData) {
                        const img = new Image()
                        await new Promise((resolve) => {
                            img.onload = resolve
                            img.onerror = resolve
                            img.src = thumbData
                        })
                        if (img.width > 0) {
                            const finalThumbW = 35 // Larger as requested
                            const finalThumbH = (img.height / img.width) * finalThumbW
                            const drawY = mealStartY + 4
                            doc.addImage(thumbData, 'JPEG', pageW - margin - finalThumbW, drawY, finalThumbW, finalThumbH, undefined, 'FAST')
                            
                            // Store link metadata for later
                            const cardIdx = matchedCards.findIndex(c => c.filename === thumbCard.filename)
                            if (cardIdx !== -1) {
                                pendingLinks.push({
                                    p: (doc as any).internal.getCurrentPageInfo().pageNumber,
                                    x: pageW - margin - finalThumbW, y: drawY, w: finalThumbW, h: finalThumbH, cardIdx
                                })
                            }

                            if (drawY + finalThumbH > y) y = drawY + finalThumbH
                        }
                    }
                } catch (e) { console.warn('Meal thumbnail failed', e) }
            }
            y += 3
        }
        
        // Day Separator
        y += 2
        doc.setDrawColor(...COLORS.BORDER)
        doc.setLineWidth(0.1)
        doc.line(margin, y, pageW - margin, y)
        y += 6
    }

    // ══════════ FOOTER ══════════
    const totalPages = doc.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setFont('Roboto', 'normal')
        doc.setFontSize(8)
        doc.setTextColor(...COLORS.TEXT_LIGHT)
        const footerText = `Sayfa ${i} / ${totalPages}  |  Lipödem Beslenme Takip Sistemi`
        doc.text(footerText, (pageW - doc.getTextWidth(footerText)) / 2, pageH - 8)
    }

    // ══════════ RECIPE CARDS SECTION ══════════
    // ── Tarif Kartları Bölümü ──
    const cardPageMap = new Map<number, number>()
    const recipeDrawInfo: any[] = []

    if (matchedCards.length > 0) {
        doc.addPage()
        y = 20

        doc.setFont('Roboto', 'bold')
        doc.setFontSize(15)
        doc.setTextColor(...COLORS.PRIMARY)
        const recipeTitle = 'TARİF KARTLARI'
        doc.text(recipeTitle, (pageW - doc.getTextWidth(recipeTitle)) / 2, y)
        y += 12

        for (let i = 0; i < matchedCards.length; i++) {
            const card = matchedCards[i]
            const dataUrl = await loadImageAsDataUrl(card.url, 900)
            if (!dataUrl) continue

            ensureSpace(80) 

            const p = (doc as any).internal.getCurrentPageInfo().pageNumber
            cardPageMap.set(i, p)

            // Card name
            doc.setFont('Roboto', 'bold')
            doc.setFontSize(10)
            doc.setTextColor(...COLORS.TEXT_DARK)
            const cardLabel = card.filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').toLocaleUpperCase('tr-TR')
            doc.text(cardLabel, margin, y)
            y += 5

            try {
                const img = new Image()
                await new Promise<void>((resolve) => {
                    img.onload = () => resolve()
                    img.onerror = () => resolve()
                    img.src = dataUrl
                })

                if (img.width > 0) {
                    const imgW = contentW
                    const imgH = (img.height / img.width) * imgW
                    const maxH = pageH - y - 15

                    const finalW = imgH > maxH ? (maxH / imgH) * imgW : imgW
                    const finalH = imgH > maxH ? maxH : imgH

                    doc.addImage(dataUrl, 'JPEG', margin, y, finalW, finalH, undefined, 'FAST')
                    recipeDrawInfo.push({ cardIdx: i, p, x: margin, y, w: finalW, h: finalH })
                    y += finalH + 10
                }
            } catch (err) {
                console.warn('Recipe image failed', err)
            }
        }
    }

    // --- 4. APPLY LINKS (INTERNAL NAVIGATION) ---
    // Pass 1: Thumbnails to Cards
    for (const link of pendingLinks) {
        const targetP = cardPageMap.get(link.cardIdx)
        if (targetP) {
            doc.setPage(link.p)
            doc.link(link.x, link.y, link.w, link.h, { pageNumber: targetP })
        }
    }

    // Pass 2: Cards back to Thumbnails (First occurrence)
    for (const draw of recipeDrawInfo) {
        const firstOccur = cardFirstOccurrence.get(draw.cardIdx)
        if (firstOccur) {
            doc.setPage(draw.p)
            doc.link(draw.x, draw.y, draw.w, draw.h, { pageNumber: firstOccur.p })
        }
    }

    // Return to the last page before save
    doc.setPage(doc.getNumberOfPages())

    // ── Download ──
    const fileName = `${patientName.replace(/\s+/g, '_')}_Hafta${weekNumber}_Plan.pdf`
    doc.save(fileName)
}
