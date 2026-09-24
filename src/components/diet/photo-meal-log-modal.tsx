"use client"

import { useState, useRef, useMemo, useCallback } from "react"
import { Camera, Upload, Check, CheckCircle2, Loader2, X, Plus, AlertCircle, ChevronDown, ChevronUp, Search, Layers, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { supabase } from "@/lib/supabase"
import Image from "next/image"
import { ImageEditor } from "./image-editor"
import { useAiLimit } from "@/hooks/use-ai-limit"
import { AiCountdown } from "./ai-countdown"
import { useEffect } from "react"

interface Ingredient {
    name: string
    quantity: number
    unit: string
    protein: number
    carbs: number
    fat: number
    included: boolean
    source?: 'ai_photo' | 'db' | 'ai_text'
}

interface AnalyzedItem {
    food_name: string
    portion_guess: string
    calories: number
    protein: number
    carbs: number
    fat: number
    confidence?: string
    // Per-unit values for quantity-based scaling
    per_unit_protein?: number
    per_unit_carbs?: number
    per_unit_fat?: number
    quantity?: number
    unit?: string
    is_usda_verified?: boolean
    source?: 'ai_photo' | 'db' | 'ai_text'
    ingredients?: Ingredient[]
    included?: boolean
}

interface AnalysisResult {
    items: AnalyzedItem[]
    total_calories: number
    analysis_note?: string
}

interface PhotoMealLogModalProps {
    dayId: string
    mealTime: string
    patientDietType?: string
    patientId?: string
    onSave: () => void
    trigger?: React.ReactNode
    externalOpen?: boolean
    onExternalOpenChange?: (open: boolean) => void
}

export function PhotoMealLogModal({ dayId, mealTime, patientDietType, patientId, onSave, trigger, externalOpen, onExternalOpenChange }: PhotoMealLogModalProps) {
    const [internalOpen, setInternalOpen] = useState(false)
    const open = externalOpen || internalOpen
    const setOpen = (val: boolean) => {
        setInternalOpen(val)
        if (onExternalOpenChange && !val) onExternalOpenChange(false)
    }
    const [image, setImage] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [analyzing, setAnalyzing] = useState(false)
    const [result, setResult] = useState<AnalysisResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [step, setStep] = useState<'upload' | 'edit' | 'review'>('upload')

    const [userId, setUserId] = useState<string | null>(null)
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null))
    }, [])

    const { aiEligibility, checkAiEligibility, recordAiUsage } = useAiLimit()

    // Editable state for review
    const [editedItems, setEditedItems] = useState<AnalyzedItem[]>([])
    const [fileToUpload, setFileToUpload] = useState<File | null>(null)

    const [isDragging, setIsDragging] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const cameraInputRef = useRef<HTMLInputElement>(null)

    // Context description for AI
    const [mealDescription, setMealDescription] = useState('')

    // Text search for adding extra foods
    const [foodSearchText, setFoodSearchText] = useState('')
    const [searchingFood, setSearchingFood] = useState(false)

    // Portion multiplier
    const [portionMultiplier, setPortionMultiplier] = useState(1)

    // Ingredient breakdown
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())
    const [saveMode, setSaveMode] = useState<'combined' | 'separate'>('combined')
    const portionOptions = [
        { label: '½ Porsiyon', value: 0.5 },
        { label: '1 Porsiyon', value: 1 },
        { label: '1½ Porsiyon', value: 1.5 },
        { label: '2 Porsiyon', value: 2 },
    ]

    // Base values from AI (before multiplier)
    const [baseItems, setBaseItems] = useState<AnalyzedItem[]>([])

    // Compute displayed items from base × multiplier, with dynamic calorie formula
    const displayedItems = useMemo(() => {
        return editedItems.map(item => {
            // If item has per-unit values, compute from quantity
            if (item.per_unit_protein !== undefined && item.quantity) {
                const qty = item.quantity
                const p = Math.round((item.per_unit_protein || 0) * qty * portionMultiplier)
                const c = Math.round((item.per_unit_carbs || 0) * qty * portionMultiplier)
                const f = Math.round((item.per_unit_fat || 0) * qty * portionMultiplier)
                const cal = Math.round(p * 4 + c * 4 + f * 9)
                const portionScaled = `${Math.round(qty * portionMultiplier)} ${item.unit || 'adet'}`
                return { ...item, protein: p, carbs: c, fat: f, calories: cal, portion_guess: portionScaled }
            }
            // Fallback: scale from base macros
            const p = Math.round((item.protein || 0) * portionMultiplier)
            const c = Math.round((item.carbs || 0) * portionMultiplier)
            const f = Math.round((item.fat || 0) * portionMultiplier)
            const cal = Math.round(p * 4 + c * 4 + f * 9)
            const portionScaled = item.portion_guess.replace(/(\d+\.?\d*)/g, (match) => {
                return String(Math.round(parseFloat(match) * portionMultiplier))
            })
            return { ...item, protein: p, carbs: c, fat: f, calories: cal, portion_guess: portionScaled }
        })
    }, [editedItems, portionMultiplier])

    const totalCalories = useMemo(() => {
        return displayedItems.reduce((acc, item) => item.included !== false ? acc + item.calories : acc, 0)
    }, [displayedItems])

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        processFile(file)
    }

    const processFile = (file?: File) => {
        if (file) {
            setFileToUpload(file)
            const reader = new FileReader()
            reader.onloadend = () => {
                setImage(reader.result as string)
                setError(null)
                setStep('edit') // Go to edit step instead of analyze
            }
            reader.readAsDataURL(file)
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file && file.type.startsWith('image/')) {
            processFile(file)
        } else {
            setError("Lütfen geçerli bir resim dosyası yükleyin.")
        }
    }

    const analyzeImage = async (editedImageBase64?: string) => {
        const imageToAnalyze = editedImageBase64 || image
        if (!imageToAnalyze) return

        // If an edited image is provided, update the preview and reset the fileToUpload
        // since we'll be uploading the edited base64 string directly
        if (editedImageBase64) {
            setImage(editedImageBase64)
            setFileToUpload(null) // Clear file, use base64 upload
        }

        setAnalyzing(true)
        setError(null)

        try {
            const effectivePatientId = patientId || userId
            if (effectivePatientId) {
                const isEligible = await checkAiEligibility(effectivePatientId, 'photo')
                if (!isEligible) {
                    setError(`Görsel analiz hakkınız doldu. Yeni bir analiz yapabilmek için saat ${aiEligibility.nextAvailableTime ? new Date(aiEligibility.nextAvailableTime!).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '...'} beklemeniz gerekiyor.`)
                    setAnalyzing(false)
                    // If we were in 'edit' mode, stay there so user sees the message
                    // If we were in 'upload' mode, stay there
                    return
                }
            }
            
            setStep('review') // Proceed to review ONLY if eligible

            await recordAiUsage(effectivePatientId || 'unknown_user', 'ai_photo_analysis').catch(e => console.error("Log error", e))

            const response = await fetch('/api/ai/analyze-meal-photo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: imageToAnalyze, description: mealDescription || undefined })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Analiz başarısız oldu')
            }

            setResult(data)
            // Normalize: extract quantity, unit, and ensure per_unit fields are set
            const normalizedItems = (data.items || []).map((item: AnalyzedItem) => {
                const qty = item.quantity || 1;
                const unit = item.unit || 'adet';

                let p = item.protein || 0;
                let c = item.carbs || 0;
                let f = item.fat || 0;
                let cal = item.calories || 0;

                let ppu = item.per_unit_protein ?? (qty > 0 ? p / qty : p);
                let cpu = item.per_unit_carbs ?? (qty > 0 ? c / qty : c);
                let fpu = item.per_unit_fat ?? (qty > 0 ? f / qty : f);

                const ings = item.ingredients?.map((ing: Ingredient) => ({ ...ing, included: ing.included !== false })) || []
                if (ings.length > 0) {
                    const included = ings.filter((ing: Ingredient) => ing.included !== false)
                    // If ingredients are given per unit (as instructed), we sum them for per_unit macros
                    ppu = included.reduce((sum: number, ing: Ingredient) => sum + (ing.protein || 0), 0)
                    cpu = included.reduce((sum: number, ing: Ingredient) => sum + (ing.carbs || 0), 0)
                    fpu = included.reduce((sum: number, ing: Ingredient) => sum + (ing.fat || 0), 0)
                    // Then the total is per_unit * qty
                    p = ppu * qty
                    c = cpu * qty
                    f = fpu * qty
                    cal = Math.round(p * 4 + c * 4 + f * 9)
                } else if (item.per_unit_protein !== undefined) {
                    // AI provided per_unit directly, ensure totals match
                    p = ppu * qty;
                    c = cpu * qty;
                    f = fpu * qty;
                    cal = Math.round(p * 4 + c * 4 + f * 9)
                }

                return {
                    ...item,
                    ingredients: ings,
                    protein: p, carbs: c, fat: f, calories: cal,
                    quantity: qty, unit,
                    per_unit_protein: ppu, per_unit_carbs: cpu, per_unit_fat: fpu,
                    is_usda_verified: item.is_usda_verified
                }
            })

            setEditedItems(normalizedItems)
            setBaseItems(normalizedItems)
            setPortionMultiplier(1)
            setStep('review')

        } catch (err: any) {
            console.error("AI Error:", err)
            setError(err.message)
        } finally {
            setAnalyzing(false)
        }
    }

    const handleSave = async () => {
        setLoading(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) throw new Error("Kullanıcı bulunamadı")

            // 1. Add to Diet Meals (Custom Entry) — use DISPLAYED (scaled) values
            // In 'separate' mode, expand items with ingredients into individual entries
            const itemsToSave: { name: string, calories: number, protein: number, carbs: number, fat: number, unit?: string, source?: string }[] = []

            if (saveMode === 'separate') {
                for (const item of displayedItems) {
                    const editItem = editedItems[displayedItems.indexOf(item)]
                    if (editItem?.included === false) continue;
                    if (editItem?.ingredients && editItem.ingredients.length > 0) {
                        // Expand only INCLUDED ingredients, scaled by portion multiplier and item quantity
                        for (const ing of editItem.ingredients) {
                            if (ing.included === false) continue // Skip unchecked ingredients
                            const scale = (editItem.quantity || 1) * portionMultiplier
                            const scaledQty = Math.round((ing.quantity || 1) * scale * 10) / 10
                            const p = Math.round((ing.protein || 0) * scale)
                            const c = Math.round((ing.carbs || 0) * scale)
                            const f = Math.round((ing.fat || 0) * scale)
                            const cal = Math.round(p * 4 + c * 4 + f * 9)
                            itemsToSave.push({
                                name: `${scaledQty} ${ing.unit || 'adet'} ${ing.name}`,
                                calories: cal,
                                protein: p,
                                carbs: c,
                                fat: f,
                                unit: ing.unit || 'porsiyon',
                                source: ing.source || editItem.source || 'ai_photo'
                            })
                        }
                    } else {
                        let prefix = ''
                        if (editItem) {
                            const q = editItem.quantity || 1
                            const u = editItem.unit || 'adet'
                            if (q !== 1 || (u !== 'porsiyon' && u !== 'adet')) {
                                prefix = `${q} ${u} `
                            }
                        }

                        itemsToSave.push({
                            name: prefix + item.food_name,
                            calories: item.calories,
                            protein: item.protein,
                            carbs: item.carbs,
                            fat: item.fat,
                            unit: item.unit,
                            source: editItem?.source
                        })
                    }
                }
            } else {
                for (const item of displayedItems) {
                    const editItem = editedItems[displayedItems.indexOf(item)]
                    if (editItem?.included === false) continue;
                    const portionLabel = portionMultiplier !== 1 ? ` (${portionOptions.find(o => o.value === portionMultiplier)?.label || portionMultiplier + ' Porsiyon'})` : ''

                    let prefix = ''
                    if (editItem) {
                        const q = editItem.quantity || 1
                        const u = editItem.unit || 'adet'
                        if (q !== 1 || (u !== 'porsiyon' && u !== 'adet')) {
                            prefix = `${q} ${u} `
                        }
                    }

                    itemsToSave.push({
                        name: prefix + item.food_name + portionLabel,
                        calories: item.calories,
                        protein: item.protein,
                        carbs: item.carbs,
                        fat: item.fat,
                        unit: item.unit,
                        source: editItem?.source
                    })
                }
            }

            const mealsToInsert = itemsToSave.map(item => ({
                diet_day_id: dayId,
                meal_time: mealTime,
                is_custom: true,
                custom_name: item.name,
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
                portion_multiplier: 1,
                is_consumed: true,
                consumed_at: new Date().toISOString(),
                swapped_by: 'patient',
                custom_notes: JSON.stringify({ source: item.source })
            }))

            const { error: mealError } = await supabase.from('diet_meals').insert(mealsToInsert)
            if (mealError) throw mealError

            // 2. Upload Image (if exists)
            let publicImageUrl = null
            if (fileToUpload) {
                const fileExt = fileToUpload.name.split('.').pop()
                const fileName = `${user.id}/${Date.now()}.${fileExt}`

                // Upload
                const { error: uploadError } = await supabase.storage
                    .from('meal-photos')
                    .upload(fileName, fileToUpload)

                if (uploadError) {
                    console.error("Image upload failed:", uploadError)
                    alert("Fotoğraf yüklenirken hata oluştu: " + uploadError.message)
                } else {
                    // Get URL
                    const { data: { publicUrl } } = supabase.storage
                        .from('meal-photos')
                        .getPublicUrl(fileName)
                    publicImageUrl = publicUrl
                }
            } else if (image && image.startsWith('data:image')) {
                // If we only have base64 but no file object (shouldn't happen with new logic), we skip upload
                console.warn("Only base64 image available, skipping upload to storage.")
            }

            // 3. Submit Proposals (For Admin Review)
            const proposalsToInsert = itemsToSave.map(item => ({
                user_id: user.id,
                image_url: item.source === 'db' || item.source === 'ai_text' ? null : publicImageUrl,
                suggested_name: item.name,
                calories: item.calories,
                protein: item.protein,
                carbs: item.carbs,
                fat: item.fat,
                portion_unit: item.unit || 'porsiyon',
                status: 'pending',
                ai_analysis: item.source === 'ai_text' ? { source: 'ai_text', query: item.name } : result
            }))

            const { error: proposalError } = await supabase.from('food_proposals').insert(proposalsToInsert)
            if (proposalError) {
                console.warn("Proposal submission failed:", proposalError)
                alert("Öneri gönderilemedi: " + proposalError.message + "\nLütfen veritabanı tablosunun oluşturulduğundan emin olun.")
            }

            setOpen(false)
            onSave()

        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const removeItem = (index: number) => {
        setEditedItems(prev => prev.filter((_, i) => i !== index))
    }

    const updateItem = (index: number, field: keyof AnalyzedItem, value: any) => {
        setEditedItems(prev => {
            const newItems = [...prev]
            newItems[index] = { ...newItems[index], [field]: value }
            return newItems
        })
    }

    // Update a macro field on the BASE items (portion multiplier will scale from these)
    const updateMacro = (index: number, field: 'protein' | 'carbs' | 'fat', value: number) => {
        // When user manually edits a macro, update the base value
        // The base should be value / portionMultiplier so displayed = value
        setEditedItems(prev => {
            const newItems = [...prev]
            const baseValue = portionMultiplier !== 0 ? Math.round(value / portionMultiplier) : value
            const item = newItems[index]

            const updates: any = { [field]: baseValue }

            // If the item has per-unit logic, we must update the per_unit value
            // because `displayedItems` ignores the total and computes from per-unit.
            if (item.per_unit_protein !== undefined && item.quantity) {
                if (field === 'protein') updates.per_unit_protein = baseValue / item.quantity
                if (field === 'carbs') updates.per_unit_carbs = baseValue / item.quantity
                if (field === 'fat') updates.per_unit_fat = baseValue / item.quantity
            }

            newItems[index] = { ...item, ...updates }
            return newItems
        })
    }

    const reset = () => {
        setImage(null)
        setResult(null)
        setEditedItems([])
        setBaseItems([])
        setPortionMultiplier(1)
        setFoodSearchText('')
        setStep('upload')
        setError(null)
    }

    // Known scalable units for parsing DB food names
    const KNOWN_UNITS = ['adet', 'tane', 'porsiyon', 'dilim', 'gram', 'gr', 'ml', 'litre', 'bardak',
        'yemek kaşığı', 'tatlı kaşığı', 'çay kaşığı', 'kase', 'kepçe', 'avuç', 'yaprak', 'dal', 'kare', 'parça']

    // Parse a segment like "5 adet çilek" or "100 gram tavuk" or "Çilek (10 adet)" -> { qty, unit, foodWords }
    const parseSegment = (seg: string) => {
        const trimmed = seg.trim()
        const lower = trimmed.toLocaleLowerCase('tr')

        // Sort units by length desc so "yemek kaşığı" matches before "kaşığı"
        const sortedUnits = [...KNOWN_UNITS].sort((a, b) => b.length - a.length)

        // Pattern 1: Parenthesized quantity at end, e.g. "çilek (10 adet)" or "smoothie (1 porsiyon)"
        const parenMatch = lower.match(/^(.+?)\s*\((\d+\.?\d*)\s*(\S+)\)\s*$/)
        if (parenMatch) {
            const foodPart = parenMatch[1].trim()
            const qty = parseFloat(parenMatch[2])
            const rawUnit = parenMatch[3]
            const detectedUnit = sortedUnits.find(u => rawUnit === u || rawUnit.startsWith(u)) || 'adet'
            const foodWords = foodPart.split(/\s+/).filter(w => w.length > 1)
            return { qty, unit: detectedUnit, foodWords, rawText: trimmed }
        }

        // Pattern 2: Leading number + unit, e.g. "5 adet çilek" or "100 gram tavuk"
        const numMatch = lower.match(/^(\d+\.?\d*)/)
        const qty = numMatch ? parseFloat(numMatch[1]) : 1
        const afterNum = numMatch ? lower.slice(numMatch[0].length).trim() : lower

        // Try to extract unit
        let detectedUnit = 'adet'
        let foodPart = afterNum
        for (const u of sortedUnits) {
            if (afterNum.startsWith(u + ' ') || afterNum === u) {
                detectedUnit = u
                foodPart = afterNum.slice(u.length).trim()
                break
            }
        }

        // Remaining words are the food name
        const foodWords = foodPart.split(/\s+/).filter(w => w.length > 1)
        return { qty, unit: detectedUnit, foodWords, rawText: trimmed }
    }

    // ---- TEXT SEARCH: DB first, then AI fallback ----
    const handleFoodSearch = async () => {
        const query = foodSearchText.trim()
        if (!query) return
        setSearchingFood(true)
        setError(null)

        try {
            // Extract search terms (food words only, no numbers/units)
            const queryParsed = parseSegment(query)
            const userQty = queryParsed.qty
            const userUnit = queryParsed.unit // e.g. "dilim" from "1 dilim hindi füme"
            const searchTerms = queryParsed.foodWords.filter(t => t.length > 1)

            if (searchTerms.length > 0) {
                const { data: dbFoods } = await supabase
                    .from('foods')
                    .select('id, name, calories, protein, carbs, fat')
                    .order('name')
                    .limit(1000)

                if (dbFoods && dbFoods.length > 0) {
                    // Collect ALL matches with score, pick the best one
                    type MatchCandidate = {
                        food: typeof dbFoods[0]
                        dbQty: number
                        dbUnit: string
                        score: number
                    }
                    const candidates: MatchCandidate[] = []

                    for (const food of dbFoods) {
                        const fNameLower = food.name.toLocaleLowerCase('tr')

                        // Split by "ya da" or "veya" to handle alternatives
                        const alternatives = fNameLower.split(/\s+ya\s+da\s+|\s+veya\s+/)

                        // Check each alternative segment
                        for (const alt of alternatives) {
                            const parsed = parseSegment(alt.trim())
                            const matches = searchTerms.every(t =>
                                parsed.foodWords.some(fw => fw.includes(t)) || alt.includes(t)
                            )
                            if (matches) {
                                // Score: prefer shorter segments (more exact), prefer same unit
                                let score = 100 - alt.length
                                // BIG Bonus: if DB entry has explicit quantity (e.g. "5 adet çilek")
                                // This is crucial for accurate per-unit calculation
                                if (parsed.qty > 1) score += 60
                                // Bonus: if user unit matches DB unit
                                if (userUnit !== 'adet' && parsed.unit === userUnit) score += 50
                                // Bonus: if food words are an exact match count
                                if (parsed.foodWords.length === searchTerms.length) score += 30
                                // Bonus: if segment is just the food (no "ya da" compounds)
                                if (alternatives.length === 1) score += 20

                                candidates.push({
                                    food,
                                    dbQty: parsed.qty,
                                    dbUnit: parsed.unit,
                                    score
                                })
                                break // only one match per food
                            }
                        }

                        // Also check the full name without splitting (lower priority fallback)
                        if (!candidates.some(c => c.food.id === food.id)) {
                            const allMatch = searchTerms.every(t => fNameLower.includes(t))
                            if (allMatch) {
                                const parsed = parseSegment(fNameLower)
                                let score = 50 - fNameLower.length // lower base score for fallback
                                if (userUnit !== 'adet' && parsed.unit === userUnit) score += 50
                                candidates.push({
                                    food,
                                    dbQty: parsed.qty,
                                    dbUnit: parsed.unit,
                                    score
                                })
                            }
                        }
                    }

                    if (candidates.length > 0) {
                        // Pick the best match (highest score)
                        candidates.sort((a, b) => b.score - a.score)
                        const best = candidates[0]
                        const { food, dbQty, dbUnit } = best

                        // Use the user's unit if they specified one explicitly, otherwise use DB unit
                        const finalUnit = userUnit !== 'adet' ? userUnit : dbUnit

                        // Per-unit macros = total food macros / dbQty
                        const ppu = dbQty > 0 ? food.protein / dbQty : food.protein
                        const cpu = dbQty > 0 ? food.carbs / dbQty : food.carbs
                        const fpu = dbQty > 0 ? food.fat / dbQty : food.fat

                        const newItem: AnalyzedItem = {
                            food_name: food.name,
                            portion_guess: `${userQty} ${finalUnit}`,
                            calories: Math.round((ppu * 4 + cpu * 4 + fpu * 9) * userQty),
                            protein: Math.round(ppu * userQty),
                            carbs: Math.round(cpu * userQty),
                            fat: Math.round(fpu * userQty),
                            per_unit_protein: ppu,
                            per_unit_carbs: cpu,
                            per_unit_fat: fpu,
                            quantity: userQty,
                            unit: finalUnit,
                            source: 'db',
                        }
                        setEditedItems(prev => [...prev, newItem])
                        setFoodSearchText('')
                        setSearchingFood(false)
                        return
                    }
                }
            }

            // 2. DB miss: fall back to AI estimation
            const effectivePatientId = patientId || userId
            if (effectivePatientId && !aiEligibility.isEligible) {
                // we already checked or limit might be hit from a previous query
            }

            if (effectivePatientId) {
                const isEligible = await checkAiEligibility(effectivePatientId)
                if (!isEligible) {
                    setError(`Limit doldu. Lütfen ${aiEligibility.nextAvailableTime ? new Date(aiEligibility.nextAvailableTime!).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : 'sonra'} tekrar deneyin.`)
                    setSearchingFood(false)
                    return
                }
            }

            await recordAiUsage(effectivePatientId || 'unknown_user', 'ai_text_search').catch(e => console.error("Log error", e))

            const response = await fetch('/api/ai/estimate-food-macros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'AI tahmin başarısız')

            const newItem: AnalyzedItem = {
                food_name: data.food_name || query,
                portion_guess: data.portion_guess || `${data.quantity || 1} ${data.unit || 'adet'}`,
                calories: Math.round((data.protein || 0) * 4 + (data.carbs || 0) * 4 + (data.fat || 0) * 9),
                protein: data.protein || 0,
                carbs: data.carbs || 0,
                fat: data.fat || 0,
                per_unit_protein: data.per_unit_protein || data.protein || 0,
                per_unit_carbs: data.per_unit_carbs || data.carbs || 0,
                per_unit_fat: data.per_unit_fat || data.fat || 0,
                quantity: data.quantity || 1,
                unit: data.unit || 'adet',
                source: 'ai_text',
            }
            setEditedItems(prev => [...prev, newItem])
            setFoodSearchText('')

        } catch (err: any) {
            console.error('Food search error:', err)
            setError(err.message || 'Yiyecek aranamadı')
        } finally {
            setSearchingFood(false)
        }
    }

    // Update quantity for a specific item (dynamic scaling)
    const updateItemQuantity = (index: number, newQty: number) => {
        if (newQty <= 0) return
        setEditedItems(prev => {
            const newItems = [...prev]
            const item = newItems[index]
            if (item.per_unit_protein !== undefined) {
                // Has per-unit values: just update quantity
                const p = Math.round((item.per_unit_protein || 0) * newQty)
                const c = Math.round((item.per_unit_carbs || 0) * newQty)
                const f = Math.round((item.per_unit_fat || 0) * newQty)
                newItems[index] = {
                    ...item,
                    quantity: newQty,
                    protein: p,
                    carbs: c,
                    fat: f,
                    calories: Math.round(p * 4 + c * 4 + f * 9),
                    portion_guess: `${newQty} ${item.unit || 'adet'}`,
                }
            } else {
                // No per-unit: derive per-unit from current values and old quantity
                const oldQty = item.quantity || 1
                const ppu = (item.protein || 0) / oldQty
                const cpu = (item.carbs || 0) / oldQty
                const fpu = (item.fat || 0) / oldQty
                const p = Math.round(ppu * newQty)
                const c = Math.round(cpu * newQty)
                const f = Math.round(fpu * newQty)
                newItems[index] = {
                    ...item,
                    quantity: newQty,
                    per_unit_protein: ppu,
                    per_unit_carbs: cpu,
                    per_unit_fat: fpu,
                    protein: p,
                    carbs: c,
                    fat: f,
                    calories: Math.round(p * 4 + c * 4 + f * 9),
                    portion_guess: `${newQty} ${item.unit || 'adet'}`,
                }
            }
            return newItems
        })
    }

    // Toggle ingredient panel for a food item
    const toggleExpand = (idx: number) => {
        setExpandedItems(prev => {
            const next = new Set(prev)
            if (next.has(idx)) next.delete(idx)
            else next.add(idx)
            return next
        })
    }

    // Update a single ingredient field
    const updateIngredient = (itemIdx: number, ingIdx: number, field: keyof Ingredient, value: any) => {
        setEditedItems(prev => {
            const newItems = [...prev]
            const item = { ...newItems[itemIdx] }
            const ings = [...(item.ingredients || [])]
            ings[ingIdx] = { ...ings[ingIdx], [field]: value }
            item.ingredients = ings
            // Recalculate parent macros from INCLUDED ingredients only
            const included = ings.filter(ing => ing.included !== false)
            item.protein = included.reduce((sum, ing) => sum + (ing.protein || 0), 0)
            item.carbs = included.reduce((sum, ing) => sum + (ing.carbs || 0), 0)
            item.fat = included.reduce((sum, ing) => sum + (ing.fat || 0), 0)
            item.calories = Math.round(item.protein * 4 + item.carbs * 4 + item.fat * 9)
            newItems[itemIdx] = item
            return newItems
        })
    }

    // Lookup main item name in DB
    const lookupItem = async (itemIdx: number, name: string, forceAI: boolean = false) => {
        if (!name.trim()) return
        try {
            const parsed = parseSegment(name)
            const searchTerms = parsed.foodWords.filter(t => t.length > 1)
            if (searchTerms.length === 0) return

            if (!forceAI) {
                // Quick DB search
                let query = supabase.from('foods').select('id, name, calories, protein, carbs, fat')
                searchTerms.forEach(term => {
                    query = query.ilike('name', `%${term}%`)
                })

                const { data: dbFoods } = await query.order('name').limit(100)

                if (dbFoods && dbFoods.length > 0) {
                    // Sort units for parsing
                    const sortedUnits = [...KNOWN_UNITS].sort((a, b) => b.length - a.length)
                    type Candidate = { food: typeof dbFoods[0], dbQty: number, score: number }
                    const candidates: Candidate[] = []

                    for (const food of dbFoods) {
                        const fNameLower = food.name.toLocaleLowerCase('tr')
                        const alternatives = fNameLower.split(/\s+ya\s+da\s+|\s+veya\s+/)
                        for (const alt of alternatives) {
                            const altParsed = parseSegment(alt.trim())
                            if (searchTerms.every(t => altParsed.foodWords.some(fw => fw.includes(t)) || alt.includes(t))) {
                                let score = 100 - alt.length
                                if (altParsed.qty > 1) score += 60
                                if (altParsed.foodWords.length === searchTerms.length) score += 30
                                if (alternatives.length === 1) score += 20
                                candidates.push({ food, dbQty: altParsed.qty, score })
                                break
                            }
                        }
                    }

                    if (candidates.length > 0) {
                        candidates.sort((a, b) => b.score - a.score)
                        const best = candidates[0]
                        const userQty = parsed.qty
                        const userUnit = parsed.unit || 'adet'

                        const dbParsed = parseSegment(best.food.name.toLocaleLowerCase('tr'))
                        const dbUnit = dbParsed.unit || 'adet'

                        let finalQty = userQty
                        let finalUnit = userUnit

                        const normalizeUnit = (u: string) => {
                            const lower = (u || '').toLowerCase()
                            if (lower === 'gr') return 'gram'
                            if (lower === 'ml') return 'mililitre'
                            return lower
                        }

                        const normalizedUserUnit = normalizeUnit(userUnit)
                        const normalizedDbUnit = normalizeUnit(dbUnit)
                        const hasExplicitDbUnit = best.food.name.toLocaleLowerCase('tr').includes(dbUnit)

                        if (normalizedUserUnit !== normalizedDbUnit && hasExplicitDbUnit) {
                            if (normalizedUserUnit === 'porsiyon' || normalizedUserUnit === 'adet' || normalizedUserUnit === 'dilim') {
                                finalQty = userQty * (best.dbQty > 0 ? best.dbQty : 1)
                                finalUnit = dbUnit
                            } else {
                                finalQty = best.dbQty > 0 ? best.dbQty : 1
                                finalUnit = dbUnit
                            }
                        }

                        const ppu = best.dbQty > 0 ? best.food.protein / best.dbQty : best.food.protein
                        const cpu = best.dbQty > 0 ? best.food.carbs / best.dbQty : best.food.carbs
                        const fpu = best.dbQty > 0 ? best.food.fat / best.dbQty : best.food.fat

                        setEditedItems(prev => {
                            const newItems = [...prev]
                            const item = { ...newItems[itemIdx] }
                            item.per_unit_protein = ppu
                            item.per_unit_carbs = cpu
                            item.per_unit_fat = fpu
                            item.source = 'db'
                            item.quantity = finalQty
                            item.unit = finalUnit

                            // Overwrite with scaled macros based on final quantity
                            item.protein = Math.round(ppu * finalQty)
                            item.carbs = Math.round(cpu * finalQty)
                            item.fat = Math.round(fpu * finalQty)
                            item.calories = Math.round(item.protein * 4 + item.carbs * 4 + item.fat * 9)

                            newItems[itemIdx] = item
                            return newItems
                        })
                        return
                    }
                }
            }

            // DB miss or force AI: AI fallback for main item
            const response = await fetch('/api/ai/estimate-food-macros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: name })
            })
            const data = await response.json()
            if (response.ok) {
                setEditedItems(prev => {
                    const newItems = [...prev]
                    const item = { ...newItems[itemIdx] }
                    item.source = 'ai_text'
                    item.protein = data.protein || 0
                    item.carbs = data.carbs || 0
                    item.fat = data.fat || 0
                    item.calories = Math.round(item.protein * 4 + item.carbs * 4 + item.fat * 9)
                    item.per_unit_protein = data.per_unit_protein || data.protein || 0
                    item.per_unit_carbs = data.per_unit_carbs || data.carbs || 0
                    item.per_unit_fat = data.per_unit_fat || data.fat || 0
                    newItems[itemIdx] = item
                    return newItems
                })
            }
        } catch (err) {
            console.error('Item lookup error:', err)
        }
    }

    // Lookup ingredient name in DB → AI fallback, then update macros
    const lookupIngredient = async (itemIdx: number, ingIdx: number, name: string, forceAI: boolean = false) => {
        if (!name.trim()) return
        try {
            const parsed = parseSegment(name)
            const searchTerms = parsed.foodWords.filter(t => t.length > 1)
            if (searchTerms.length === 0) return

            if (!forceAI) {
                // Quick DB search
                let query = supabase.from('foods').select('id, name, calories, protein, carbs, fat')
                searchTerms.forEach(term => {
                    query = query.ilike('name', `%${term}%`)
                })

                const { data: dbFoods } = await query.order('name').limit(100)

                if (dbFoods && dbFoods.length > 0) {
                    // Sort units for parsing
                    const sortedUnits = [...KNOWN_UNITS].sort((a, b) => b.length - a.length)
                    type Candidate = { food: typeof dbFoods[0], dbQty: number, score: number }
                    const candidates: Candidate[] = []

                    for (const food of dbFoods) {
                        const fNameLower = food.name.toLocaleLowerCase('tr')
                        const alternatives = fNameLower.split(/\s+ya\s+da\s+|\s+veya\s+/)
                        for (const alt of alternatives) {
                            const altParsed = parseSegment(alt.trim())
                            if (searchTerms.every(t => altParsed.foodWords.some(fw => fw.includes(t)) || alt.includes(t))) {
                                let score = 100 - alt.length
                                if (altParsed.qty > 1) score += 60
                                if (altParsed.foodWords.length === searchTerms.length) score += 30
                                if (alternatives.length === 1) score += 20
                                candidates.push({ food, dbQty: altParsed.qty, score })
                                break
                            }
                        }
                    }

                    if (candidates.length > 0) {
                        candidates.sort((a, b) => b.score - a.score)
                        const best = candidates[0]
                        const userQty = parsed.qty
                        const userUnit = parsed.unit || 'adet'

                        const dbParsed = parseSegment(best.food.name.toLocaleLowerCase('tr'))
                        const dbUnit = dbParsed.unit || 'adet'

                        let finalQty = userQty
                        let finalUnit = userUnit

                        const normalizeUnit = (u: string) => {
                            const lower = (u || '').toLowerCase()
                            if (lower === 'gr') return 'gram'
                            if (lower === 'ml') return 'mililitre'
                            return lower
                        }

                        const normalizedUserUnit = normalizeUnit(userUnit)
                        const normalizedDbUnit = normalizeUnit(dbUnit)
                        const hasExplicitDbUnit = best.food.name.toLocaleLowerCase('tr').includes(dbUnit)

                        if (normalizedUserUnit !== normalizedDbUnit && hasExplicitDbUnit) {
                            if (normalizedUserUnit === 'porsiyon' || normalizedUserUnit === 'adet' || normalizedUserUnit === 'dilim') {
                                finalQty = userQty * (best.dbQty > 0 ? best.dbQty : 1)
                                finalUnit = dbUnit
                            } else {
                                finalQty = best.dbQty > 0 ? best.dbQty : 1
                                finalUnit = dbUnit
                            }
                        }

                        const ppu = best.dbQty > 0 ? best.food.protein / best.dbQty : best.food.protein
                        const cpu = best.dbQty > 0 ? best.food.carbs / best.dbQty : best.food.carbs
                        const fpu = best.dbQty > 0 ? best.food.fat / best.dbQty : best.food.fat

                        setEditedItems(prev => {
                            const newItems = [...prev]
                            const item = { ...newItems[itemIdx] }
                            const ings = [...(item.ingredients || [])]
                            ings[ingIdx] = {
                                ...ings[ingIdx],
                                // Update parsed optimal unit/quantity
                                quantity: finalQty,
                                unit: finalUnit,
                                protein: Math.round(ppu * finalQty),
                                carbs: Math.round(cpu * finalQty),
                                fat: Math.round(fpu * finalQty),
                                source: 'db'
                            }
                            item.ingredients = ings
                            const incl = ings.filter(i => i.included !== false)
                            item.protein = incl.reduce((sum, ing) => sum + (ing.protein || 0), 0)
                            item.carbs = incl.reduce((sum, ing) => sum + (ing.carbs || 0), 0)
                            item.fat = incl.reduce((sum, ing) => sum + (ing.fat || 0), 0)
                            item.calories = Math.round(item.protein * 4 + item.carbs * 4 + item.fat * 9)
                            newItems[itemIdx] = item
                            return newItems
                        })
                        return
                    }
                }
            }

            // DB miss or force AI: AI fallback
            const response = await fetch('/api/ai/estimate-food-macros', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: name })
            })
            const data = await response.json()
            if (response.ok) {
                setEditedItems(prev => {
                    const newItems = [...prev]
                    const item = { ...newItems[itemIdx] }
                    const ings = [...(item.ingredients || [])]
                    ings[ingIdx] = {
                        ...ings[ingIdx],
                        // Keep user's name, quantity, unit as-is — only update macros
                        protein: data.protein || 0,
                        carbs: data.carbs || 0,
                        fat: data.fat || 0,
                        source: 'ai_text'
                    }
                    item.ingredients = ings
                    const incl = ings.filter(i => i.included !== false)
                    item.protein = incl.reduce((sum, ing) => sum + (ing.protein || 0), 0)
                    item.carbs = incl.reduce((sum, ing) => sum + (ing.carbs || 0), 0)
                    item.fat = incl.reduce((sum, ing) => sum + (ing.fat || 0), 0)
                    item.calories = Math.round(item.protein * 4 + item.carbs * 4 + item.fat * 9)
                    newItems[itemIdx] = item
                    return newItems
                })
            }
        } catch (err) {
            console.error('Ingredient lookup error:', err)
        }
    }

    // Remove an ingredient from an item
    const removeIngredient = (itemIdx: number, ingIdx: number) => {
        setEditedItems(prev => {
            const newItems = [...prev]
            const item = { ...newItems[itemIdx] }
            const ings = [...(item.ingredients || [])]
            ings.splice(ingIdx, 1)
            item.ingredients = ings
            if (ings.length > 0) {
                const incl = ings.filter(i => i.included !== false)
                item.protein = incl.reduce((sum, ing) => sum + (ing.protein || 0), 0)
                item.carbs = incl.reduce((sum, ing) => sum + (ing.carbs || 0), 0)
                item.fat = incl.reduce((sum, ing) => sum + (ing.fat || 0), 0)
                item.calories = Math.round(item.protein * 4 + item.carbs * 4 + item.fat * 9)
            }
            newItems[itemIdx] = item
            return newItems
        })
    }

    return (
        <Dialog open={open} onOpenChange={(val) => {
            setOpen(val)
            if (!val) reset()
        }}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" size="sm" className="gap-2">
                        <Camera size={16} />
                        Fotoğraf ile Ekle
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Yemek Fotoğrafı Analizi</DialogTitle>
                    <DialogDescription className="hidden">
                        Yemek fotoğrafı yükleme ve analiz ekranı.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto py-4">
                    {step === 'upload' ? (
                        <div className="space-y-4">
                            <div
                                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors flex flex-col items-center gap-4 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'}`}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                            >
                                {image ? (
                                    <div className="relative w-full aspect-video rounded-md overflow-hidden bg-black/5">
                                        <Image src={image} alt="Preview" fill className="object-contain" />
                                        <Button
                                            variant="destructive"
                                            size="icon"
                                            className="absolute top-2 right-2 h-6 w-6"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setImage(null)
                                            }}
                                        >
                                            <X size={12} />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-500">
                                            <Upload size={32} />
                                        </div>
                                        <div>
                                            <p className="font-medium">Fotoğrafı buraya sürükleyin</p>
                                            <p className="text-sm text-gray-500 mb-4">veya aşağıdan seçin</p>

                                            <div className="flex flex-wrap justify-center gap-3">
                                                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                                                    <Upload className="mr-2 h-4 w-4" /> Galeriden Seç
                                                </Button>
                                                <Button variant="outline" onClick={() => cameraInputRef.current?.click()}>
                                                    <Camera className="mr-2 h-4 w-4" /> Fotoğraf Çek
                                                </Button>
                                            </div>
                                        </div>
                                    </>
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleImageUpload}
                                />
                                <input
                                    ref={cameraInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={handleImageUpload}
                                />
                            </div>

                            {error && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm mb-4 flex items-center gap-2">
                                    <AlertCircle size={16} />
                                    {error}
                                </div>
                            )}
                        </div>
                    ) : (step === 'edit' || step === 'review') && error ? (
                        <div className="p-6 space-y-4">
                            <div className="bg-orange-50 text-orange-700 p-4 rounded-lg text-sm flex items-center gap-3 border border-orange-100 shadow-sm">
                                <AlertCircle size={20} className="text-orange-500" />
                                <div className="flex-1">
                                    <p className="font-semibold text-base mb-1">Analiz Hakkı Doldu</p>
                                    <p className="leading-relaxed opacity-90">
                                        {!aiEligibility.isEligible && aiEligibility.nextAvailableTime ? (
                                            <>Görsel analiz hakkınız doldu. Yeni bir analiz yapabilmek için <AiCountdown endDate={aiEligibility.nextAvailableTime} /> beklemeniz gerekiyor.</>
                                        ) : error}
                                    </p>
                                </div>
                            </div>
                            <Button variant="outline" className="w-full" onClick={() => { setError(null); setStep('upload'); }}>
                                Geri Dön
                            </Button>
                        </div>
                    ) : step === 'edit' && image ? (
                        <ImageEditor
                            imageSrc={image}
                            initialDescription={mealDescription}
                            onCancel={() => { setStep('upload'); setImage(null); setFileToUpload(null); }}
                            onConfirm={(croppedImageBase64, desc) => {
                                setMealDescription(desc)
                                analyzeImage(croppedImageBase64)
                            }}
                        />
                    ) : step === 'review' ? (
                        <div className="space-y-6">
                            {analyzing ? (
                                <div className="flex flex-col items-center justify-center p-8 space-y-6 bg-blue-50/50 rounded-xl border border-blue-100 relative overflow-hidden">
                                    <div className="relative w-64 h-64 rounded-xl overflow-hidden shadow-2xl bg-black">
                                        {/* Original Image */}
                                        {image && <Image src={image} alt="Analyzing" fill className="object-cover opacity-60" />}

                                        {/* Scanning Grid Background */}
                                        <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.1)_1px,transparent_1px)] bg-[size:20px_20px] mix-blend-overlay" />

                                        {/* Full Image Scanner Beam */}
                                        <div className="absolute top-0 left-0 w-full h-full animate-scan z-10 flex flex-col justify-end pointer-events-none">
                                            <div className="flex-1 bg-gradient-to-b from-transparent via-emerald-400/10 to-emerald-400/40 w-full" />
                                            <div className="h-1.5 bg-emerald-400 shadow-[0_0_20px_10px_rgba(52,211,153,0.5)] w-full" />
                                        </div>
                                    </div>
                                    <div className="text-center space-y-2 z-10 relative">
                                        <div className="flex items-center justify-center gap-2 text-blue-800 font-bold text-lg">
                                            <Search className="animate-pulse text-emerald-500" />
                                            Yemekler analiz ediliyor...
                                        </div>
                                        <p className="text-sm text-blue-600/80 max-w-xs mx-auto">
                                            Tabağınızdaki içerikler detaylı şekilde inceleniyor. Lütfen bekleyin.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden bg-black/5 shadow-inner border border-gray-200">
                                        {image && (
                                            <>
                                                <Image src={image} alt="Analiz Sonucu" fill className="object-cover brightness-75" />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

                                                {/* No Floating Pins */}

                                            </>
                                        )}
                                        {result?.analysis_note && (
                                            <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                                                <p className="text-xs text-white/90 italic flex items-start gap-1.5 drop-shadow-md">
                                                    <Sparkles size={12} className="shrink-0 mt-0.5 text-blue-300" />
                                                    {result.analysis_note}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <Label className="text-base font-bold text-gray-800 flex items-center gap-2">
                                                <Layers className="text-blue-500" size={18} />
                                                Tespit Edilenler
                                            </Label>
                                            <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                                                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Toplam</span>
                                                <span className="text-sm font-black text-emerald-600">{totalCalories} kcal</span>
                                            </div>
                                        </div>

                                        {/* Text-based food search */}
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                                <Input
                                                    placeholder="Yiyecek ekle (ör: 2 çilek, 1 dilim ekmek)"
                                                    value={foodSearchText}
                                                    onChange={(e) => setFoodSearchText(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault()
                                                            handleFoodSearch()
                                                        }
                                                    }}
                                                    className="h-9 text-sm pl-8"
                                                    disabled={searchingFood}
                                                />
                                            </div>
                                            <Button
                                                size="sm"
                                                onClick={handleFoodSearch}
                                                disabled={searchingFood || !foodSearchText.trim()}
                                                className="h-9 px-3 bg-blue-600 hover:bg-blue-700"
                                            >
                                                {searchingFood ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : (
                                                    <><Plus size={14} className="mr-1" /> Ekle</>
                                                )}
                                            </Button>
                                        </div>

                                        {/* Portion Multiplier Dropdown */}
                                        <div className="flex items-center gap-3 bg-gradient-to-r from-emerald-50 to-green-50 p-3 rounded-lg border border-emerald-200">
                                            <Label className="text-sm font-semibold text-emerald-800 whitespace-nowrap">Porsiyon:</Label>
                                            <select
                                                value={portionMultiplier}
                                                onChange={(e) => setPortionMultiplier(parseFloat(e.target.value))}
                                                className="flex-1 h-8 px-3 text-sm font-medium rounded-md border border-emerald-300 bg-white text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-400 cursor-pointer"
                                            >
                                                {portionOptions.map(opt => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {editedItems.length === 0 && (
                                            <p className="text-center text-gray-400 py-4">Hiçbir yiyecek tespit edilemedi.</p>
                                        )}

                                        {displayedItems.map((item, idx) => (
                                            <div key={idx} className={`border rounded-md p-3 space-y-3 relative group transition-opacity ${item.included === false ? 'opacity-50 bg-gray-50' : 'bg-white'}`}>
                                                <button
                                                    className="absolute top-2 right-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => removeItem(idx)}
                                                >
                                                    <X size={16} />
                                                </button>

                                                {/* Source badge */}
                                                {editedItems[idx]?.source && (
                                                    <span className={`absolute top-2 left-3 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${editedItems[idx].source === 'db' ? 'bg-green-100 text-green-700' :
                                                        editedItems[idx].source === 'ai_text' ? 'bg-purple-100 text-purple-700' :
                                                            'bg-blue-100 text-blue-700'
                                                        }`}>
                                                        {editedItems[idx].source === 'db' ? '📦 DB' :
                                                            editedItems[idx].source === 'ai_text' ? '🤖 AI Metin' : '📸 AI'}
                                                    </span>
                                                )}

                                                <div className={`grid grid-cols-2 gap-3 ${editedItems[idx]?.source ? 'mt-4' : ''}`}>
                                                    <div className="col-span-2 sm:col-span-1">
                                                        <div className="flex items-center gap-2 mb-1.5">
                                                            <input
                                                                type="checkbox"
                                                                checked={item.included !== false}
                                                                onChange={(e) => updateItem(idx, 'included', e.target.checked)}
                                                                className="h-3.5 w-3.5 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
                                                                title="Bu yemeği hesaba dahil et"
                                                            />
                                                            <Label className={`text-xs ${item.included === false ? 'text-gray-400 line-through' : 'text-gray-500'}`}>Yiyecek Adı</Label>
                                                            {editedItems[idx]?.is_usda_verified && (
                                                                <span className="flex items-center gap-1 ml-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100" title="USDA Veritabanından Doğrulandı">
                                                                    <CheckCircle2 size={10} />
                                                                    USDA Onaylı
                                                                </span>
                                                            )}
                                                        </div>
                                                        {editedItems[idx]?.source === 'db' && /\s(ya\s+da|veya)\s/i.test(editedItems[idx]?.food_name || '') ? (
                                                            <div className="h-auto min-h-[2rem] text-sm font-medium border rounded-md px-3 py-1.5 bg-white flex flex-wrap items-center gap-0.5 leading-snug">
                                                                {(editedItems[idx]?.food_name || '').split(/(\s+ya\s+da\s+|\s+veya\s+)/gi).map((part, pi) =>
                                                                    /ya\s+da|veya/i.test(part) ? (
                                                                        <span key={pi} className="text-red-600 font-bold mx-0.5">{part.trim()}</span>
                                                                    ) : (
                                                                        <span key={pi}>{part}</span>
                                                                    )
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-1.5 mt-0.5">
                                                                <Input
                                                                    value={editedItems[idx]?.food_name || ''}
                                                                    onChange={(e) => updateItem(idx, 'food_name', e.target.value)}
                                                                    className="h-8 text-sm font-medium flex-1"
                                                                />
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    title="Veritabanında Ara"
                                                                    className="h-8 w-8 shrink-0 text-blue-600 hover:text-blue-800 hover:bg-blue-50 bg-blue-50/30"
                                                                    onClick={() => {
                                                                        const q = `${editedItems[idx]?.quantity || 1} ${editedItems[idx]?.unit || 'adet'} ${editedItems[idx]?.food_name || ''}`.trim()
                                                                        lookupItem(idx, q)
                                                                    }}
                                                                >
                                                                    <Search size={14} />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    title="Yapay Zeka ile Ara (Zorla)"
                                                                    className="h-8 w-8 shrink-0 text-purple-600 hover:text-purple-800 hover:bg-purple-50 bg-purple-50/30"
                                                                    onClick={() => {
                                                                        const q = `${editedItems[idx]?.quantity || 1} ${editedItems[idx]?.unit || 'adet'} ${editedItems[idx]?.food_name || ''}`.trim()
                                                                        lookupItem(idx, q, true)
                                                                    }}
                                                                >
                                                                    <Sparkles size={14} />
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="col-span-2 sm:col-span-1">
                                                        <Label className="text-xs text-gray-500">Miktar</Label>
                                                        <div className="flex gap-1.5">
                                                            <Input
                                                                type="number"
                                                                min={0.25}
                                                                step={0.5}
                                                                value={editedItems[idx]?.quantity || 1}
                                                                onChange={(e) => updateItemQuantity(idx, parseFloat(e.target.value) || 1)}
                                                                className="h-8 text-sm w-20 text-center"
                                                            />
                                                            <select
                                                                value={editedItems[idx]?.unit || 'adet'}
                                                                onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                                                                className="h-8 flex-1 px-2 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
                                                            >
                                                                {['adet', 'tane', 'porsiyon', 'dilim', 'gram', 'gr', 'ml', 'litre', 'bardak', 'yemek kaşığı', 'tatlı kaşığı', 'çay kaşığı', 'kase', 'kepçe', 'avuç', 'yaprak', 'dal', 'kare', 'parça'].map(u => (
                                                                    <option key={u} value={u}>{u}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-4 gap-2">
                                                    <div>
                                                        <Label className="text-[10px] text-gray-500">Kalori</Label>
                                                        <div className="h-7 flex items-center justify-center text-xs font-bold text-emerald-700 bg-emerald-50 rounded-md border border-emerald-200">
                                                            {item.calories}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <Label className="text-[10px] text-gray-500">Prot (g)</Label>
                                                        <Input
                                                            type="number"
                                                            value={item.protein}
                                                            onChange={(e) => updateMacro(idx, 'protein', parseFloat(e.target.value) || 0)}
                                                            className="h-7 text-xs text-center border-blue-200 bg-blue-50/50"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[10px] text-gray-500">Karb (g)</Label>
                                                        <Input
                                                            type="number"
                                                            value={item.carbs}
                                                            onChange={(e) => updateMacro(idx, 'carbs', parseFloat(e.target.value) || 0)}
                                                            className="h-7 text-xs text-center border-orange-200 bg-orange-50/50"
                                                        />
                                                    </div>
                                                    <div>
                                                        <Label className="text-[10px] text-gray-500">Yağ (g)</Label>
                                                        <Input
                                                            type="number"
                                                            value={item.fat}
                                                            onChange={(e) => updateMacro(idx, 'fat', parseFloat(e.target.value) || 0)}
                                                            className="h-7 text-xs text-center border-yellow-200 bg-yellow-50/50"
                                                        />
                                                    </div>
                                                </div>

                                                {/* Ingredient toggle button */}
                                                {editedItems[idx]?.ingredients && editedItems[idx].ingredients!.length > 0 && (
                                                    <button
                                                        onClick={() => toggleExpand(idx)}
                                                        className="w-full flex items-center justify-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1.5 border-t border-dashed border-gray-200 mt-1 transition-colors"
                                                    >
                                                        <Layers size={12} />
                                                        {expandedItems.has(idx) ? 'Alt Malzemeleri Gizle' : `Alt Malzemeler (${editedItems[idx].ingredients!.length})`}
                                                        {expandedItems.has(idx) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                    </button>
                                                )}

                                                {/* Expandable ingredient panel */}
                                                {expandedItems.has(idx) && editedItems[idx]?.ingredients && (
                                                    <div className="bg-indigo-50/50 rounded-md p-2.5 space-y-2 border border-indigo-100 mt-1">
                                                        <div className="text-[10px] font-semibold text-indigo-700 uppercase tracking-wider">Alt Malzemeler</div>
                                                        {editedItems[idx].ingredients!.map((ing, ingIdx) => {
                                                            const scale = (editedItems[idx]?.quantity || 1) * portionMultiplier;
                                                            return (
                                                                <div key={ingIdx} className={`bg-white rounded p-2 border space-y-1.5 relative group/ing transition-opacity ${ing.included === false ? 'opacity-40 border-gray-200' : 'border-indigo-100'}`}>
                                                                    <button
                                                                        className="absolute top-1 right-1 text-gray-300 hover:text-red-500 opacity-0 group-hover/ing:opacity-100 transition-opacity"
                                                                        onClick={() => removeIngredient(idx, ingIdx)}
                                                                    >
                                                                        <X size={12} />
                                                                    </button>
                                                                    {/* Checkbox + Source badge row */}
                                                                    <div className="flex items-center gap-2">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={ing.included !== false}
                                                                            onChange={(e) => updateIngredient(idx, ingIdx, 'included', e.target.checked)}
                                                                            className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer shrink-0"
                                                                            title={ing.included !== false ? 'Hesaba dahil' : 'Hesaba dahil değil'}
                                                                        />
                                                                        <span className={`text-[9px] font-medium ${ing.included === false ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                                                                            {ing.name || 'Malzeme'}
                                                                        </span>
                                                                        {ing.source && (
                                                                            <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${ing.source === 'db' ? 'bg-green-100 text-green-600' : 'bg-purple-100 text-purple-600'}`}>
                                                                                {ing.source === 'db' ? '📦 DB' : '🤖 AI'}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex gap-1.5 items-end">
                                                                        <div className="flex-1">
                                                                            <label className="text-[9px] text-gray-400">İsim</label>
                                                                            <Input
                                                                                value={ing.name}
                                                                                onChange={(e) => {
                                                                                    updateIngredient(idx, ingIdx, 'name', e.target.value)
                                                                                    // Clear source badge on manual edit
                                                                                    if (ing.source) updateIngredient(idx, ingIdx, 'source', undefined)
                                                                                }}
                                                                                className="h-6 text-xs"
                                                                                placeholder="Malzeme adı"
                                                                            />
                                                                        </div>
                                                                        <div className="w-[4.5rem]">
                                                                            <label className="text-[9px] text-gray-400">Miktar</label>
                                                                            <Input
                                                                                type="number"
                                                                                value={Math.round((ing.quantity || 0) * scale * 10) / 10}
                                                                                onChange={(e) => updateIngredient(idx, ingIdx, 'quantity', (parseFloat(e.target.value) || 0) / scale)}
                                                                                className="h-6 text-xs text-center"
                                                                            />
                                                                        </div>
                                                                        <div className="w-[4.5rem]">
                                                                            <label className="text-[9px] text-gray-400">Birim</label>
                                                                            <Input
                                                                                value={ing.unit}
                                                                                onChange={(e) => updateIngredient(idx, ingIdx, 'unit', e.target.value)}
                                                                                className="h-6 text-xs text-center"
                                                                            />
                                                                        </div>
                                                                        <button
                                                                            onClick={() => {
                                                                                const q = `${ing.quantity || 1} ${ing.unit || 'adet'} ${ing.name}`.trim()
                                                                                lookupIngredient(idx, ingIdx, q)
                                                                            }}
                                                                            className="h-6 w-6 flex items-center justify-center rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 hover:text-indigo-800 transition-colors shrink-0 mt-3"
                                                                            title="DB'de Sorgula"
                                                                        >
                                                                            <Search size={11} />
                                                                        </button>
                                                                        <button
                                                                            onClick={() => {
                                                                                const q = `${ing.quantity || 1} ${ing.unit || 'adet'} ${ing.name}`.trim()
                                                                                lookupIngredient(idx, ingIdx, q, true)
                                                                            }}
                                                                            className="h-6 w-6 flex items-center justify-center rounded border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-600 hover:text-purple-800 transition-colors shrink-0 mt-3 ml-1"
                                                                            title="AI ile Zorla Ara"
                                                                        >
                                                                            <Sparkles size={11} />
                                                                        </button>
                                                                    </div>
                                                                    <div className="grid grid-cols-4 gap-1">
                                                                        <div>
                                                                            <label className="text-[9px] text-gray-400">Kcal</label>
                                                                            <div className="h-5 flex items-center justify-center text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded border border-emerald-200">
                                                                                {Math.round(((ing.protein || 0) * 4 + (ing.carbs || 0) * 4 + (ing.fat || 0) * 9) * scale)}
                                                                            </div>
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[9px] text-gray-400">Prot</label>
                                                                            <Input
                                                                                type="number"
                                                                                value={Math.round((ing.protein || 0) * scale * 10) / 10}
                                                                                onChange={(e) => updateIngredient(idx, ingIdx, 'protein', (parseFloat(e.target.value) || 0) / scale)}
                                                                                className="h-5 text-[10px] text-center border-blue-200 bg-blue-50/30"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[9px] text-gray-400">Karb</label>
                                                                            <Input
                                                                                type="number"
                                                                                value={Math.round((ing.carbs || 0) * scale * 10) / 10}
                                                                                onChange={(e) => updateIngredient(idx, ingIdx, 'carbs', (parseFloat(e.target.value) || 0) / scale)}
                                                                                className="h-5 text-[10px] text-center border-orange-200 bg-orange-50/30"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label className="text-[9px] text-gray-400">Yağ</label>
                                                                            <Input
                                                                                type="number"
                                                                                value={Math.round((ing.fat || 0) * scale * 10) / 10}
                                                                                onChange={(e) => updateIngredient(idx, ingIdx, 'fat', (parseFloat(e.target.value) || 0) / scale)}
                                                                                className="h-5 text-[10px] text-center border-yellow-200 bg-yellow-50/30"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        ))}

                                        <div className="bg-gray-50 p-3 rounded text-sm flex justify-between font-semibold border mt-4">
                                            <span>Toplam Tahmini Kalori:</span>
                                            <span>{totalCalories} kcal</span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    {step === 'review' && (
                        <Button variant="outline" onClick={() => setStep('upload')}>
                            Geri Dön
                        </Button>
                    )}
                    {step === 'review' && editedItems.some(item => item.ingredients && item.ingredients.length > 0) && (
                        <select
                            value={saveMode}
                            onChange={(e) => setSaveMode(e.target.value as 'combined' | 'separate')}
                            className="h-9 px-3 text-sm rounded-md border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-green-400 cursor-pointer"
                        >
                            <option value="combined">📦 Toplu Ekle</option>
                            <option value="separate">📋 Ayrı Ayrı Ekle</option>
                        </select>
                    )}
                    {step === 'review' && (
                        <Button onClick={handleSave} disabled={loading || editedItems.length === 0} className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                            {loading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Check size={16} className="mr-2" />}
                            Kaydet ve Günlüğe Ekle
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
