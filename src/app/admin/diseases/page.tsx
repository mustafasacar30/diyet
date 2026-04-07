"use client"

import React, { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Plus,
    Pencil,
    Trash2,
    Loader2,
    X,
    AlertTriangle,
    Heart,
    Search,
    Shield,
    ClipboardCopy,
    Sparkles,
    Info,
    Check
} from "lucide-react"

// ...

const renderKeywordBadge = (kw: any, type: 'compatible' | 'incompatible') => {
    const hasWarning = !!kw.warning
    const hasInfo = !!kw.info

    // Base styles
    let bgClass = type === 'compatible' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-orange-100 text-orange-700 border-orange-200'

    // Override logic
    if (type === 'compatible') {
        // For compatible items, we want to keep the green/positive vibe even if there is "rich data"
        // But we can use slightly different shades or borders to indicate richness?
        // Actually, let's keep it simple: Green base.
        // If there is "warning" (which we use for "Destekleyici/Mechanism" in compatible), we might want a special look?
        // Let's stick to the base class but allow the ICONS to do the work.
        // We do NOT want to turn it Amber just because it has a "warning" field.
    } else {
        // Incompatible logic
        if (hasWarning) {
            bgClass = 'bg-amber-100 text-amber-800 border-amber-200'
        } else if (hasInfo) {
            bgClass = 'bg-blue-50 text-blue-700 border-blue-100'
        }
    }

    // Dynamic Tooltip and Icons
    const warningPrefix = type === 'compatible' ? '✨ Destekleyici/Mekanizma' : '⚠️ Uyarı/Mekanizma'
    const WarningIcon = type === 'compatible' ? Sparkles : AlertTriangle
    const warningColor = type === 'compatible' ? 'text-emerald-600' : 'text-amber-600'

    return (
        <span className={`text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 truncate max-w-[120px] ${bgClass}`} title={`${kw.keyword} (${kw.match_type})${kw.warning ? `\n${warningPrefix}: ${kw.warning}` : ''}${kw.info ? `\nℹ️ Öneri/Bilgi: ${kw.info}` : ''}`}>
            {getMatchTypeLabel(kw.match_type)}
            <span className="truncate">{kw.keyword}</span>
            {hasWarning && <WarningIcon size={8} className={`shrink-0 ${warningColor}`} />}
            {hasInfo && <Info size={8} className="shrink-0 text-blue-500" />}
        </span>
    )
}

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RichTagInput, RichTag } from "@/components/ui/rich-tag-input"

// Keyword entry with match type
type KeywordEntry = {
    keyword: string
    match_type: 'name' | 'tag' | 'both'
    warning?: string
    info?: string
}

type Micronutrient = {
    id: string
    name: string
    unit: string
    default_min: number | null
    default_max: number | null
    category: 'mikrobesin' | 'kan_tahlili' | null
    compatible_keywords: KeywordEntry[]
    incompatible_keywords: KeywordEntry[]
}

type Disease = {
    id: string
    name: string
    description: string | null
    created_at: string
    rules?: UIDiseaseRule[]
}

type UIDiseaseRule = {
    id?: string
    type: 'positive' | 'negative'
    keyword: string
    metadata?: Record<string, { warning?: string; info?: string }>
    match_name: boolean
    match_tags: boolean
}

type DBDiseaseRule = {
    id: string
    disease_id: string
    rule_type: 'positive' | 'negative'
    keywords: string[]
    tags: string[]
    match_name: boolean
    match_tags: boolean
}

// Medication Types
type Medication = {
    id: string
    name: string
    generic_name: string | null
    category: string | null
    description: string | null
    created_at: string
}

type MedicationInteractionRule = {
    id: string
    medication_id: string
    rule_type: 'positive' | 'negative' | 'warning'
    keyword: string
    match_name: boolean
    match_tags: boolean
    notes: string | null
}

const getMatchTypeLabel = (type: string | undefined) => {
    switch (type) {
        case 'name': return '[İ]'
        case 'tag': return '[E]'
        case 'both': return '[İ+E]'
        default: return '[?]'
    }
}

export default function DiseasesPage() {
    const [diseases, setDiseases] = useState<Disease[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState("")

    // Dialog State
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingDisease, setEditingDisease] = useState<Disease | null>(null)
    const [formData, setFormData] = useState({ name: '', description: '' })

    // Rules State (In-Memory for Dialog)
    const [currentRules, setCurrentRules] = useState<UIDiseaseRule[]>([])
    const [newKeyword, setNewKeyword] = useState("")
    const [newRuleType, setNewRuleType] = useState<'positive' | 'negative'>('negative')
    const [newMatchName, setNewMatchName] = useState(true)
    const [newMatchTags, setNewMatchTags] = useState(true)
    const [bulkKeywords, setBulkKeywords] = useState("")

    // Micronutrient Tab State
    const [micronutrients, setMicronutrients] = useState<Micronutrient[]>([])
    const [microLoading, setMicroLoading] = useState(false)
    const [microEditingId, setMicroEditingId] = useState<string | null>(null)
    const [microNewData, setMicroNewData] = useState({ name: '', unit: 'mg', default_min: '', default_max: '', category: 'mikrobesin' as 'mikrobesin' | 'kan_tahlili' })
    const [microEditData, setMicroEditData] = useState({ name: '', unit: 'mg', default_min: '', default_max: '', category: 'mikrobesin' as 'mikrobesin' | 'kan_tahlili' })
    const [microAiLoading, setMicroAiLoading] = useState(false)

    const autoFillMicronutrientWithAI = async () => {
        if (!microNewData.name.trim()) {
            alert('Lütfen önce parametre adını girin.')
            return
        }

        setMicroAiLoading(true)
        try {
            const response = await fetch('/api/ai/micronutrient-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: microNewData.name })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'AI yanıtı başarısız')
            }

            // Fill form data
            setMicroNewData(prev => ({
                ...prev,
                category: data.category === 'kan_tahlili' ? 'kan_tahlili' : 'mikrobesin',
                unit: data.unit || prev.unit,
                default_min: data.default_min?.toString() || prev.default_min,
                default_max: data.default_max?.toString() || prev.default_max
            }))

            // Process Keywords
            const processKeywords = (list: any[], type: 'compatible' | 'incompatible') => {
                if (!Array.isArray(list)) return []
                return list.flatMap(item => {
                    const keywords = typeof item.keyword === 'string' ? item.keyword.split(/[\/,]/).map((k: string) => k.trim()).filter(Boolean) : [item.keyword];
                    return keywords.map((k: string) => ({
                        keyword: k,
                        match_type: 'both' as 'both', // Default
                        warning: item.mechanism, // Map mechanism to warning field for BOTH types (interpreted distinctively in renderKeywordBadge)
                        info: item.advice // Map advice to info field for BOTH types
                    }))
                })
            }

            // Merge with existing (though usually this is for new items, so overwrite or append is fine. Append to be safe)
            const newCompatible = processKeywords(data.compatible_foods, 'compatible')
            const newIncompatible = processKeywords(data.incompatible_foods, 'incompatible')

            // Helper to merge keyword entries
            const mergeEntries = (existing: KeywordEntry[], incoming: KeywordEntry[]) => {
                const existingKeys = new Set(existing.map(e => e.keyword.toLowerCase()))
                const uniqueIncoming = incoming.filter(e => !existingKeys.has(e.keyword.toLowerCase()))
                return [...existing, ...uniqueIncoming]
            }

            setNewCompatibleKeywords(prev => mergeEntries(prev, newCompatible))
            setNewIncompatibleKeywords(prev => mergeEntries(prev, newIncompatible))

            alert(`AI Analizi Tamamlandı!\n\n${data.category === 'kan_tahlili' ? 'Kan Tahlili' : 'Mikrobesin'}: ${data.unit}\nRef: ${data.default_min} - ${data.default_max}`)

        } catch (error: any) {
            console.error(error)
            alert('AI Hatası: ' + error.message)
        } finally {
            setMicroAiLoading(false)
        }
    }

    // Keyword Modal State
    const [keywordModalOpen, setKeywordModalOpen] = useState(false)
    const [keywordMicroId, setKeywordMicroId] = useState<string | null>(null)
    const [keywordType, setKeywordType] = useState<'compatible' | 'incompatible'>('compatible')
    const [editingKeywords, setEditingKeywords] = useState<RichTag[]>([])
    const [microKeyword, setMicroKeyword] = useState('')
    const [microKeywordMatchType, setMicroKeywordMatchType] = useState<'name' | 'tag' | 'both'>('both')

    // State for New Micronutrient Keywords (temp storage before save)
    const [newCompatibleKeywords, setNewCompatibleKeywords] = useState<KeywordEntry[]>([])
    const [newIncompatibleKeywords, setNewIncompatibleKeywords] = useState<KeywordEntry[]>([])

    // ========== MEDICATIONS TAB STATE ==========
    const [medications, setMedications] = useState<Medication[]>([])
    const [medLoading, setMedLoading] = useState(false)
    // AI State
    const [aiLoading, setAiLoading] = useState(false)

    const autoFillWithAI = async () => {
        if (!medFormData.name.trim()) {
            alert('Lütfen önce ilaç adını girin.')
            return
        }

        setAiLoading(true)
        try {
            const response = await fetch('/api/ai/medication-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ medicationName: medFormData.name })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'AI yanıtı başarısız')
            }

            // Fill form data
            setMedFormData(prev => ({
                ...prev,
                name: data.name || prev.name,
                generic_name: data.generic_name || '',
                category: data.category || '',
                description: data.description || ''
            }))

            // Process Interaction Rules
            if (data.interaction_rules && Array.isArray(data.interaction_rules)) {
                // We need to map AI rules to RichTag format and distribute them to correct state
                const negatives: RichTag[] = []
                const warnings: RichTag[] = []
                const positives: RichTag[] = []

                data.interaction_rules.forEach((rule: any) => {
                    let kWordsStr = typeof rule.keyword === 'string' ? rule.keyword : String(rule.keyword);
                    const keywords = kWordsStr.split(/[\/,]/).map((s: string) => s.trim()).filter(Boolean);
                    
                    keywords.forEach((kw: string) => {
                        const tag: RichTag = {
                            text: kw,
                            match_name: rule.match_name ?? true,
                            match_tags: rule.match_tags ?? true,
                            warning: rule.mechanism,
                            info: rule.clinical_advice
                        }

                        if (rule.rule_type === 'negative') negatives.push(tag)
                        else if (rule.rule_type === 'warning') warnings.push(tag)
                        else if (rule.rule_type === 'positive') positives.push(tag)
                    })
                })

                // Blocked Keywords (Global ignore list)
                const BLOCKED_KEYWORDS = new Set([
                    'yemek', 'öğün', 'kahvaltı', 'akşam yemeği', 'öğle yemeği', 'ara öğün',
                    'gıda', 'besin', 'yiyecek', 'içecek', 'tüketim', 'porsiyon'
                ]);

                // Helper to merge tags preventing duplicates and blocked words
                const mergeTags = (existing: RichTag[], newTags: RichTag[]) => {
                    const existingTexts = new Set(existing.map(t => t.text.toLowerCase()));

                    const uniqueNewTags = newTags.filter(t => {
                        const lowerText = t.text.toLowerCase();
                        // Filter out if already exists OR if matches blocked keywords
                        return !existingTexts.has(lowerText) && !BLOCKED_KEYWORDS.has(lowerText);
                    });

                    return [...existing, ...uniqueNewTags];
                }

                setMedNegativeTags(prev => mergeTags(prev, negatives))
                setMedWarningTags(prev => mergeTags(prev, warnings))
                setMedPositiveTags(prev => mergeTags(prev, positives))

                const addedCount = negatives.length + warnings.length + positives.length;
                // We calculate how many *unique* were added effectively? 
                // Actually user might want to know total found by AI vs total added. 
                // But let's just show a generic success message or maybe "Merged X tags".

                alert(`AI Başarıyla Tamamlandı!\n\n${data.name}\n\nKurallar mevcut listeyle birleştirildi.\nYasaklı kelimeler (yemek, öğün vb.) filtrelendi.`)
            } else {
                alert('AI tarafından bilgiler dolduruldu: ' + data.name)
            }

        } catch (error: any) {
            alert('AI Hatası: ' + error.message)
        } finally {
            setAiLoading(false)
        }
    }
    const [medSearchTerm, setMedSearchTerm] = useState('')
    const [isMedDialogOpen, setIsMedDialogOpen] = useState(false)
    const [editingMedication, setEditingMedication] = useState<Medication | null>(null)
    const [medFormData, setMedFormData] = useState({ name: '', generic_name: '', category: '', description: '' })

    // Medication Interaction Rules (In-Memory for Dialog)
    // const [medInteractionRules, setMedInteractionRules] = useState<MedicationInteractionRule[]>([]) // Removed in favor of tags
    const [medNegativeTags, setMedNegativeTags] = useState<RichTag[]>([])
    const [medWarningTags, setMedWarningTags] = useState<RichTag[]>([])
    const [medPositiveTags, setMedPositiveTags] = useState<RichTag[]>([])
    const [medRuleNotes, setMedRuleNotes] = useState('') // Global notes if needed, or per-tag? Diseases uses per-tag.
    // We'll drop medRuleNotes global and use per-tag notes.

    useEffect(() => {
        loadDiseases()
        loadMicronutrients()
        loadMedications()
    }, [])

    // ========== MEDICATIONS FUNCTIONS ==========
    const loadMedications = async () => {
        setMedLoading(true)
        const { data, error } = await supabase
            .from('medications')
            .select('*')
            .order('name')
        if (!error && data) setMedications(data)
        setMedLoading(false)
    }

    const openMedAddDialog = () => {
        setEditingMedication(null)
        setMedFormData({ name: '', generic_name: '', category: '', description: '' })
        setMedNegativeTags([])
        setMedWarningTags([])
        setMedPositiveTags([])
        setIsMedDialogOpen(true)
    }

    const openMedEditDialog = async (med: Medication) => {
        setEditingMedication(med)
        setMedFormData({
            name: med.name,
            generic_name: med.generic_name || '',
            category: med.category || '',
            description: med.description || ''
        })

        setMedNegativeTags([])
        setMedWarningTags([])
        setMedPositiveTags([])

        // Load interaction rules for this medication
        const { data } = await supabase
            .from('medication_interactions')
            .select('*')
            .eq('medication_id', med.id)
            .order('created_at')

        if (data) {
            const neg: RichTag[] = []
            const warn: RichTag[] = []
            const pos: RichTag[] = []

            data.forEach(r => {
                const tag: RichTag = {
                    text: r.keyword,
                    match_name: r.match_name,
                    match_tags: r.match_tags,
                    // Map notes to warning/info (First paragraph -> Warning, Rest -> Info)
                    warning: r.notes ? r.notes.split('\n\n')[0] : undefined,
                    info: r.notes && r.notes.includes('\n\n') ? r.notes.split('\n\n').slice(1).join('\n\n') : undefined
                }

                if (r.rule_type === 'negative') neg.push(tag)
                else if (r.rule_type === 'warning') warn.push(tag)
                else if (r.rule_type === 'positive') pos.push(tag)
            })

            setMedNegativeTags(neg)
            setMedWarningTags(warn)
            setMedPositiveTags(pos)
        }
        setIsMedDialogOpen(true)
    }

    const saveMedication = async () => {
        if (!medFormData.name.trim()) {
            alert('İlaç adı gereklidir')
            return
        }
        try {
            let medId = editingMedication?.id

            if (editingMedication) {
                // Update existing medication
                const { error } = await supabase
                    .from('medications')
                    .update({
                        name: medFormData.name,
                        generic_name: medFormData.generic_name || null,
                        category: medFormData.category || null,
                        description: medFormData.description || null
                    })
                    .eq('id', editingMedication.id)
                if (error) throw error
            } else {
                // Insert new medication
                const { data, error } = await supabase
                    .from('medications')
                    .insert({
                        name: medFormData.name,
                        generic_name: medFormData.generic_name || null,
                        category: medFormData.category || null,
                        description: medFormData.description || null
                    })
                    .select()
                    .single()
                if (error) throw error
                medId = data.id
            }

            if (medId) {
                // Sync Rules
                const prepareRules = (tags: RichTag[], type: string) => {
                    return tags.map(t => ({
                        medication_id: medId,
                        rule_type: type,
                        keyword: t.text,
                        match_name: t.match_name ?? true,
                        match_tags: t.match_tags ?? true,
                        // Save info/warning back to notes
                        notes: [t.warning, t.info].filter(Boolean).join('\n\n') || null
                    }))
                }

                const newRules = [
                    ...prepareRules(medNegativeTags, 'negative'),
                    ...prepareRules(medWarningTags, 'warning'),
                    ...prepareRules(medPositiveTags, 'positive')
                ]

                // Delete old rules
                await supabase.from('medication_interactions').delete().eq('medication_id', medId)

                // Insert new rules
                if (newRules.length > 0) {
                    const { error: rulesError } = await supabase.from('medication_interactions').insert(newRules)
                    if (rulesError) throw rulesError
                }
            }

            setIsMedDialogOpen(false)
            loadMedications()
        } catch (error: any) {
            alert('Hata: ' + error.message)
        }
    }

    const deleteMedication = async (id: string) => {
        if (!confirm('Bu ilacı silmek istediğinize emin misiniz?')) return
        try {
            const { error } = await supabase.from('medications').delete().eq('id', id)
            if (error) throw error
            loadMedications()
        } catch (error: any) {
            alert('Silinemedi: ' + error.message)
        }
    }









    const getMedRuleIcon = (ruleType: string) => {
        switch (ruleType) {
            case 'positive': return '✅'
            case 'negative': return '🚫'
            case 'warning': return '⚠️'
            default: return '❓'
        }
    }

    const getMedRuleBadgeVariant = (ruleType: string): "default" | "destructive" | "secondary" | "outline" => {
        switch (ruleType) {
            case 'positive': return 'default'
            case 'negative': return 'destructive'
            case 'warning': return 'secondary'
            default: return 'outline'
        }
    }
    // ========== END MEDICATIONS FUNCTIONS ==========


    const loadMicronutrients = async () => {
        setMicroLoading(true)
        const { data, error } = await supabase
            .from('micronutrients')
            .select('*')
            .order('category', { ascending: true }) // mikrobesin first, then kan_tahlili
            .order('name')
        if (!error && data) setMicronutrients(data)
        setMicroLoading(false)
    }

    const cancelMicroEdit = () => {
        setMicroEditingId(null)
        setMicroNewData({ name: '', unit: 'mg', default_min: '', default_max: '', category: 'mikrobesin' })
        setNewCompatibleKeywords([])
        setNewIncompatibleKeywords([])
    }

    const handleAddMicronutrient = async () => {
        if (!microNewData.name) return
        setMicroLoading(true)

        if (microEditingId) {
            // Update Mode
            const { error } = await supabase.from('micronutrients').update({
                name: microNewData.name,
                unit: microNewData.unit,
                default_min: microNewData.default_min ? parseFloat(microNewData.default_min) : null,
                default_max: microNewData.default_max ? parseFloat(microNewData.default_max) : null,
                category: microNewData.category,
                compatible_keywords: newCompatibleKeywords,
                incompatible_keywords: newIncompatibleKeywords
            }).eq('id', microEditingId)

            if (!error) {
                cancelMicroEdit()
                loadMicronutrients()
            } else {
                alert("Hata: " + error.message)
            }
        } else {
            // Insert Mode
            const { error } = await supabase.from('micronutrients').insert({
                name: microNewData.name,
                unit: microNewData.unit,
                default_min: microNewData.default_min ? parseFloat(microNewData.default_min) : null,
                default_max: microNewData.default_max ? parseFloat(microNewData.default_max) : null,
                category: microNewData.category,
                compatible_keywords: newCompatibleKeywords,
                incompatible_keywords: newIncompatibleKeywords
            })
            if (!error) {
                cancelMicroEdit()
                loadMicronutrients()
            } else {
                alert("Hata: " + error.message)
            }
        }
        setMicroLoading(false)
    }

    // Deprecated inline update - keeping for safety but unused if we switch UI
    const handleUpdateMicronutrient = async (id: string) => {
        // ... (legacy logic if needed, but we are replacing it effectively)
    }

    const handleDeleteMicronutrient = async (id: string) => {
        if (!confirm("Bu mikrobesini silmek istediğinize emin misiniz? (Bu mikrobesinle ilişkilendirilmiş tüm tahlil sonuçları ve yemek eşleşmeleri de silinecektir.)")) return
        setMicroLoading(true)
        const { error } = await supabase.from('micronutrients').delete().eq('id', id)
        if (!error) loadMicronutrients()
        setMicroLoading(false)
    }

    const startMicroEdit = (m: Micronutrient) => {
        setMicroEditingId(m.id)
        setMicroNewData({
            name: m.name,
            unit: m.unit,
            default_min: m.default_min?.toString() || '',
            default_max: m.default_max?.toString() || '',
            category: m.category || 'mikrobesin'
        })
        setNewCompatibleKeywords(m.compatible_keywords || [])
        setNewIncompatibleKeywords(m.incompatible_keywords || [])

        // Scroll to form
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    // Keyword Modal Functions
    // Keyword Modal Functions
    const openKeywordModal = (microId: string, type: 'compatible' | 'incompatible') => {
        setKeywordMicroId(microId)
        setKeywordType(type)

        // Helper to convert DB format to RichTag
        const convertToRichTags = (keywords: any[]): RichTag[] => {
            return keywords.map(k => {
                // Check if keyword string contains legacy "Keyword; Warning; Info" format
                // OR if it has new structured warning/info fields
                let text = k.keyword || '';
                let warning = k.warning;
                let info = k.info;

                // Legacy parsing for "Somon; Warning; Info" strings if manual entry happened
                if (text.includes(';') && !warning && !info) {
                    const parts = text.split(';').map((p: string) => p.trim());
                    text = parts[0];
                    if (parts[1]) warning = parts[1];
                    if (parts[2]) info = parts[2];
                }

                return {
                    text: text,
                    warning: warning,
                    info: info,
                    match_name: k.match_type === 'name' || k.match_type === 'both',
                    match_tags: k.match_type === 'tag' || k.match_type === 'both'
                };
            });
        };

        if (microId === 'NEW') {
            const raw = type === 'compatible' ? newCompatibleKeywords : newIncompatibleKeywords;
            setEditingKeywords(convertToRichTags(raw));
        } else {
            const micro = micronutrients.find(m => m.id === microId);
            if (!micro) return;
            const raw = type === 'compatible' ? (micro.compatible_keywords || []) : (micro.incompatible_keywords || []);
            setEditingKeywords(convertToRichTags(raw));
        }

        setKeywordModalOpen(true);
    };

    const saveKeywords = async () => {
        if (!keywordMicroId) return;

        // Convert RichTags back to DB format
        const convertedKeywords: KeywordEntry[] = editingKeywords.map(t => {
            let matchType: 'name' | 'tag' | 'both' = 'both';
            if (t.match_name && !t.match_tags) matchType = 'name';
            else if (!t.match_name && t.match_tags) matchType = 'tag';

            return {
                keyword: t.text,
                match_type: matchType,
                warning: t.warning || undefined,
                info: t.info || undefined
            };
        });

        if (keywordMicroId === 'NEW') {
            if (keywordType === 'compatible') {
                setNewCompatibleKeywords(convertedKeywords);
            } else {
                setNewIncompatibleKeywords(convertedKeywords);
            }
            setKeywordModalOpen(false);
            return;
        }

        setMicroLoading(true);
        const updateData = keywordType === 'compatible'
            ? { compatible_keywords: convertedKeywords }
            : { incompatible_keywords: convertedKeywords };

        const { error } = await supabase.from('micronutrients').update(updateData).eq('id', keywordMicroId);
        if (!error) {
            loadMicronutrients();
            setKeywordModalOpen(false);
        } else {
            alert("Hata: " + error.message);
        }
        setMicroLoading(false);
    };

    const loadDiseases = async () => {
        setLoading(true)
        try {
            // Fetch diseases with their rules
            const { data: diseaseData, error } = await supabase
                .from('diseases')
                .select(`
                    *,
                    rules:disease_rules(*)
                `)
                .order('name')

            if (error) throw error

            // Map DB structure to UI structure (one record per keyword for easier UI)
            const mappedDiseases = (diseaseData as any[]).map(d => ({
                ...d,
                rules: d.rules?.flatMap((r: any) =>
                    r.keywords?.map((k: string) => ({
                        id: r.id,
                        type: r.rule_type,
                        keyword: k,
                        metadata: r.keyword_metadata, // Pass metadata
                        match_name: r.match_name ?? true,
                        match_tags: r.match_tags ?? true
                    })) || []
                )
            }))

            setDiseases(mappedDiseases as Disease[])
        } catch (error) {
            console.error("Error loading diseases:", error)
            alert("Hastalıklar yüklenemedi")
        } finally {
            setLoading(false)
        }
    }

    // State for RichTag inputs
    const [negativeTags, setNegativeTags] = useState<RichTag[]>([])
    const [warningTags, setWarningTags] = useState<RichTag[]>([])
    const [positiveTags, setPositiveTags] = useState<RichTag[]>([])

    // ... (keep disease state)

    // AI State for Diseases
    const [diseaseAiLoading, setDiseaseAiLoading] = useState(false)

    const autoFillDiseaseWithAI = async () => {
        if (!formData.name.trim()) {
            alert('Lütfen önce hastalık adını girin.')
            return
        }

        setDiseaseAiLoading(true)
        try {
            const response = await fetch('/api/ai/disease-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ diseaseName: formData.name })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'AI yanıtı başarısız')
            }

            // Fill form data
            setFormData(prev => ({
                ...prev,
                name: data.name || prev.name,
                description: data.description || prev.description
            }))

            // Process Rules
            if (data.rules && Array.isArray(data.rules)) {

                const negatives: RichTag[] = []
                const warnings: RichTag[] = []
                const positives: RichTag[] = []

                data.rules.forEach((rule: any) => {
                    // Extract keywords (handle both string and array just in case)
                    let keywords: string[] = []
                    if (Array.isArray(rule.keyword)) keywords = rule.keyword
                    else if (typeof rule.keyword === 'string') keywords = [rule.keyword]

                    keywords.forEach(k => {
                        const splitK = k.split(/[\/,]/).map((s: string) => s.trim()).filter(Boolean);
                        splitK.forEach((sk: string) => {
                            const tag: RichTag = {
                                text: sk,
                                match_name: true,
                                match_tags: true,
                                warning: rule.warning, // Reason -> Warning
                                info: rule.info // Clinical Advice -> Info
                            }

                            if (rule.type === 'negative') negatives.push(tag)
                            else if (rule.type === 'warning') warnings.push(tag)
                            else if (rule.type === 'positive') positives.push(tag)
                        });
                    })
                })

                // Blocked Keywords (Global ignore list - reused)
                const BLOCKED_KEYWORDS = new Set([
                    'yemek', 'öğün', 'kahvaltı', 'akşam yemeği', 'öğle yemeği', 'ara öğün',
                    'gıda', 'besin', 'yiyecek', 'içecek', 'tüketim', 'porsiyon'
                ]);

                // Helper to merge tags preventing duplicates and blocked words
                const mergeTags = (existing: RichTag[], newTags: RichTag[]) => {
                    const existingTexts = new Set(existing.map(t => t.text.toLowerCase()));

                    const uniqueNewTags = newTags.filter(t => {
                        const lowerText = t.text.toLowerCase();
                        return !existingTexts.has(lowerText) && !BLOCKED_KEYWORDS.has(lowerText);
                    });

                    return [...existing, ...uniqueNewTags];
                }

                setNegativeTags(prev => mergeTags(prev, negatives))
                setWarningTags(prev => mergeTags(prev, warnings))
                setPositiveTags(prev => mergeTags(prev, positives))

                alert(`AI Başarıyla Tamamlandı!\n\n${data.name}\n\nKurallar mevcut listeyle birleştirildi.`)
            } else {
                alert('AI tarafından bilgiler dolduruldu: ' + data.name)
            }

        } catch (error: any) {
            alert('AI Hatası: ' + error.message)
        } finally {
            setDiseaseAiLoading(false)
        }
    }

    const handleOpenDialog = (disease?: Disease) => {
        if (disease) {
            setEditingDisease(disease)
            setFormData({ name: disease.name, description: disease.description || '' })

            // Transform existing rules to RichTags
            const neg: RichTag[] = []
            const warn: RichTag[] = []
            const pos: RichTag[] = []

            disease.rules?.forEach(r => {
                const meta = r.metadata || {}
                const tag: RichTag = {
                    text: r.keyword,
                    warning: meta[r.keyword]?.warning,
                    info: meta[r.keyword]?.info,
                    match_name: r.match_name ?? true,
                    match_tags: r.match_tags ?? true
                }

                if (r.type === 'negative') neg.push(tag)
                else if (r.type === 'warning') warn.push(tag)
                else if (r.type === 'positive') pos.push(tag)
            })

            setNegativeTags(neg)
            setWarningTags(warn)
            setPositiveTags(pos)
        } else {
            setEditingDisease(null)
            setFormData({ name: '', description: '' })
            setNegativeTags([])
            setWarningTags([])
            setPositiveTags([])
        }
        setIsDialogOpen(true)
    }

    const handleAddRule = () => {
        if (!newKeyword.trim()) return
        // Prevent duplicates
        if (currentRules.some(r => r.keyword.toLowerCase() === newKeyword.trim().toLowerCase())) {
            alert("Bu anahtar kelime zaten ekli.")
            return
        }
        setCurrentRules([...currentRules, {
            type: newRuleType,
            keyword: newKeyword.trim(),
            match_name: newMatchName,
            match_tags: newMatchTags
        }])
        setNewKeyword("")
    }

    // Bulk add rules from comma-separated list
    const handleBulkAddRules = () => {
        if (!bulkKeywords.trim()) return
        const keywords = bulkKeywords.split(/[,\n]+/).map(k => k.trim()).filter(k => k.length > 0)
        const existingKeywords = new Set(currentRules.map(r => r.keyword.toLowerCase()))
        const newRules: UIDiseaseRule[] = []
        let duplicateCount = 0

        for (const keyword of keywords) {
            if (existingKeywords.has(keyword.toLowerCase())) {
                duplicateCount++
                continue
            }
            existingKeywords.add(keyword.toLowerCase())
            newRules.push({
                type: newRuleType,
                keyword: keyword,
                match_name: newMatchName,
                match_tags: newMatchTags
            })
        }

        if (newRules.length > 0) {
            setCurrentRules([...currentRules, ...newRules])
        }
        if (duplicateCount > 0) {
            alert(`${duplicateCount} adet mükerrer kelime atlandı, ${newRules.length} adet eklendi.`)
        }
        setBulkKeywords("")
    }

    const removeRule = (index: number) => {
        const newRules = [...currentRules]
        newRules.splice(index, 1)
        setCurrentRules(newRules)
    }

    const handleSave = async () => {
        if (!formData.name.trim()) return

        try {
            let diseaseId = editingDisease?.id

            // 1. Save Disease Info
            if (editingDisease) {
                const { error } = await supabase
                    .from('diseases')
                    .update({ name: formData.name, description: formData.description })
                    .eq('id', editingDisease.id)
                if (error) throw error
            } else {
                const { data, error } = await supabase
                    .from('diseases')
                    .insert({ name: formData.name, description: formData.description })
                    .select()
                    .single()
                if (error) throw error
                diseaseId = data.id
            }

            if (!diseaseId) throw new Error("Disease ID missing")

            // 2. Sync Rules
            // Prepare rules data
            const prepareRuleData = (tags: RichTag[], type: 'positive' | 'negative' | 'warning') => {
                if (tags.length === 0) return null

                const keywords = tags.map(t => t.text)
                const metadata = tags.reduce((acc, t) => {
                    acc[t.text] = {
                        warning: t.warning,
                        info: t.info,
                        match_name: t.match_name ?? true,
                        match_tags: t.match_tags ?? true
                    }
                    return acc
                }, {} as Record<string, any>)

                // Use the first tag's scope as default for the rule-level fields
                const firstTag = tags[0]
                return {
                    disease_id: diseaseId,
                    rule_type: type,
                    keywords,
                    keyword_metadata: metadata,
                    match_name: firstTag?.match_name ?? true,
                    match_tags: firstTag?.match_tags ?? true,
                    tags: []
                }
            }

            const negRule = prepareRuleData(negativeTags, 'negative')
            const warnRule = prepareRuleData(warningTags, 'warning')
            const posRule = prepareRuleData(positiveTags, 'positive')

            // Delete old rules
            const { error: deleteError } = await supabase
                .from('disease_rules')
                .delete()
                .eq('disease_id', diseaseId)

            if (deleteError) throw deleteError

            // Insert new rules
            const rulesToInsert = [negRule, warnRule, posRule].filter(Boolean)

            if (rulesToInsert.length > 0) {
                // Try with keyword_metadata first
                const { error: insertError } = await supabase
                    .from('disease_rules')
                    .insert(rulesToInsert)

                if (insertError) {
                    // If keyword_metadata column doesn't exist yet, retry without it
                    if (insertError.code === 'PGRST204' && insertError.message?.includes('keyword_metadata')) {
                        console.warn('keyword_metadata column not found, saving without metadata...')
                        const rulesWithoutMeta = rulesToInsert.map((r: any) => {
                            const { keyword_metadata, ...rest } = r
                            return rest
                        })
                        const { error: retryError } = await supabase
                            .from('disease_rules')
                            .insert(rulesWithoutMeta)
                        if (retryError) throw retryError
                    } else {
                        throw insertError
                    }
                }
            }

            setIsDialogOpen(false)
            loadDiseases()

        } catch (error: any) {
            console.error("Error saving:", error)
            alert("Hata: " + error.message)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Bu hastalığı ve tüm kurallarını silmek istediğinize emin misiniz?")) return
        try {
            const { error } = await supabase.from('diseases').delete().eq('id', id)
            if (error) throw error
            loadDiseases()
        } catch (error: any) {
            alert("Silinemedi: " + error.message)
        }
    }

    const filteredDiseases = diseases.filter(d =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.description && d.description.toLowerCase().includes(searchQuery.toLowerCase()))
    )

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-800">Sistem Yapılandırması</h1>
            </div>

            <Tabs defaultValue="diseases" className="space-y-6">
                <TabsList className="bg-white border w-full justify-start p-1 h-auto mb-4">
                    <TabsTrigger value="diseases" className="px-6 py-2">🥗 Hastalıklar & Koşullar</TabsTrigger>
                    <TabsTrigger value="micronutrients" className="px-6 py-2">🧬 Mikrobesinler (Tahlil Parametreleri)</TabsTrigger>
                    <TabsTrigger value="medications" className="px-6 py-2">💊 İlaçlar & Etkileşimler</TabsTrigger>
                    <TabsTrigger value="guide" className="px-6 py-2">📖 Rehber</TabsTrigger>
                </TabsList>

                <TabsContent value="diseases">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-gray-500 text-sm">Hastalıklara göre yemek uyarısı ve önerisi sistemini yönetin.</p>
                        <Button onClick={() => handleOpenDialog()} className="bg-green-600 hover:bg-green-700">
                            <Plus className="mr-2 h-4 w-4" /> Yeni Hastalık Ekle
                        </Button>
                    </div>

                    <div className="bg-white rounded-lg border shadow-sm">
                        <div className="p-4 border-b bg-gray-50 flex items-center gap-4">
                            <div className="relative flex-1 max-w-sm">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                                <Input
                                    placeholder="Hastalık ara..."
                                    className="pl-9 bg-white"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        {loading ? (
                            <div className="p-12 flex justify-center">
                                <Loader2 className="h-8 w-8 animate-spin text-green-600" />
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[200px]">Hastalık Adı</TableHead>
                                        <TableHead>Açıklama</TableHead>
                                        <TableHead>Kurallar (Özet)</TableHead>
                                        <TableHead className="w-[100px] text-right">İşlemler</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredDiseases.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="text-center h-24 text-gray-500 italic">
                                                Kayıt bulunamadı.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredDiseases.map(disease => {
                                            const posCount = disease.rules?.filter(r => r.type === 'positive').length || 0
                                            const negCount = disease.rules?.filter(r => r.type === 'negative').length || 0

                                            return (
                                                <TableRow key={disease.id}>
                                                    <TableCell className="font-medium text-gray-800">
                                                        {disease.name}
                                                    </TableCell>
                                                    <TableCell className="text-gray-600 text-sm">
                                                        {disease.description || '-'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex gap-2">
                                                            {posCount > 0 && (
                                                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1">
                                                                    <Heart className="h-3 w-3 fill-blue-500 text-blue-500" /> {posCount} Öneri
                                                                </Badge>
                                                            )}
                                                            {negCount > 0 && (
                                                                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1">
                                                                    <AlertTriangle className="h-3 w-3 fill-red-100 text-red-600" /> {negCount} Yasak
                                                                </Badge>
                                                            )}
                                                            {posCount === 0 && negCount === 0 && (
                                                                <span className="text-gray-400 text-xs italic">Kural yok</span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => handleOpenDialog(disease)}>
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-50" onClick={() => handleDelete(disease.id)}>
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })
                                    )}
                                </TableBody>
                            </Table>
                        )}
                    </div>

                    {/* Add/Edit Dialog */}
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => { const target = e.target as HTMLElement; if (target?.closest('[data-radix-popper-content-wrapper]') || target?.closest('[role="dialog"]')) { e.preventDefault(); } }}>
                            <DialogHeader>
                                <DialogTitle>{editingDisease ? 'Hastalık Düzenle' : 'Yeni Hastalık Ekle'}</DialogTitle>
                                <DialogDescription>Hastalık bilgilerini ve tetikleyici kelimeleri yönetin.</DialogDescription>
                            </DialogHeader>

                            <div className="space-y-6 py-4">
                                {/* Basic Info */}
                                <div className="space-y-4 border-b pb-4">
                                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                        <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs">1</span>
                                        Temel Bilgiler
                                    </h3>
                                    <div className="grid gap-2">
                                        <Label>Hastalık Adı</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                value={formData.name}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                                placeholder="Örn: Haşimato, Çölyak..."
                                                className="flex-1"
                                            />
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={autoFillDiseaseWithAI}
                                                disabled={diseaseAiLoading}
                                                className="shrink-0 bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200"
                                            >
                                                {diseaseAiLoading ? (
                                                    <>
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        Analiz Ediliyor...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Sparkles className="mr-2 h-4 w-4" />
                                                        Yapay Zeka ile Doldur
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Açıklama (İsteğe bağlı)</Label>
                                        <Textarea
                                            value={formData.description}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                                            placeholder="Hastalık hakkında kısa bilgi..."
                                            className="h-20"
                                        />
                                    </div>
                                </div>

                                {/* Rules Editor */}
                                <div className="space-y-6">
                                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                                        <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs">2</span>
                                        Tetikleyici Kelimeler
                                    </h3>
                                    <p className="text-sm text-gray-500">
                                        Bu kelimeleri içeren yemekler için sistem uyarı verecektir.
                                        Format: <code className="bg-gray-100 px-1 rounded text-xs">Kelime; Uyarı; Öneri</code> —
                                        <code className="bg-gray-100 px-1 rounded text-xs">/</code> ile ayırarak aynı uyarıyı birden fazla kelimeye atayabilirsiniz.
                                    </p>


                                    {/* NEGATIVE (Yasaklı) RichTagInput */}
                                    <div className="space-y-2 border rounded-lg p-4 bg-red-50/30 border-red-200">
                                        <Label className="text-red-700 font-semibold flex items-center gap-2 text-sm">
                                            <AlertTriangle className="h-4 w-4" />
                                            Yasaklı / Kaçınılması Gerekenler
                                        </Label>
                                        <p className="text-xs text-red-600/80 mb-1">
                                            Hastalığı tetikleyen veya semptomları artıran gıdalar ve etiketler.
                                        </p>
                                        {/* Column Headers */}
                                        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider px-2 border-b pb-1 mb-1">
                                            <span>Etiket / Besin</span>
                                            <span>⚠️ Uyarı</span>
                                            <span>ℹ️ Öneri / Bilgi</span>
                                        </div>
                                        <RichTagInput
                                            value={negativeTags}
                                            onChange={setNegativeTags}
                                            placeholder="Örn: Buğday/Arpa/Çavdar; Gluten içerir; Çölyak hastaları için tehlikeli"
                                            className="min-h-[80px] bg-white"
                                            showMatchScope={true}
                                            defaultMatchName={true}
                                            defaultMatchTags={true}
                                        />
                                    </div>

                                    {/* WARNING (Dikkat Edilmeli) RichTagInput */}
                                    <div className="space-y-2 border rounded-lg p-4 bg-orange-50/30 border-orange-200 mt-4">
                                        <Label className="text-orange-700 font-semibold flex items-center gap-2 text-sm">
                                            <AlertTriangle className="h-4 w-4" />
                                            Dikkat Edilmeli (Warning)
                                        </Label>
                                        <p className="text-xs text-orange-600/80 mb-1">
                                            Belli koşullarda veya miktarlarda tüketilebilecek gıdalar.
                                        </p>
                                        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider px-2 border-b pb-1 mb-1">
                                            <span>Etiket / Besin</span>
                                            <span>⚠️ Uyarı</span>
                                            <span>ℹ️ Öneri / Bilgi</span>
                                        </div>
                                        <RichTagInput
                                            value={warningTags}
                                            onChange={setWarningTags}
                                            placeholder="Örn: Süt; Seyreltilerek içilmeli"
                                            className="min-h-[80px] bg-white"
                                            showMatchScope={true}
                                            defaultMatchName={true}
                                            defaultMatchTags={true}
                                        />
                                    </div>

                                    {/* POSITIVE (Önerilen) RichTagInput */}
                                    <div className="space-y-2 border rounded-lg p-4 bg-blue-50/30 border-blue-200">
                                        <Label className="text-blue-700 font-semibold flex items-center gap-2 text-sm">
                                            <Heart className="h-4 w-4" />
                                            Faydalı / Önerilenler
                                        </Label>
                                        <p className="text-xs text-blue-600/80 mb-1">
                                            İyileşmeyi destekleyen gıdalar ve besinler.
                                        </p>
                                        {/* Column Headers */}
                                        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider px-2 border-b pb-1 mb-1">
                                            <span>Etiket / Besin</span>
                                            <span>⚠️ Uyarı</span>
                                            <span>ℹ️ Öneri / Bilgi</span>
                                        </div>
                                        <RichTagInput
                                            value={positiveTags}
                                            onChange={setPositiveTags}
                                            placeholder="Örn: Zerdeçal; Anti-inflamatuar; Günlük 1 çay kaşığı"
                                            className="min-h-[80px] bg-white"
                                            showMatchScope={true}
                                            defaultMatchName={true}
                                            defaultMatchTags={true}
                                        />
                                    </div>
                                </div>

                            </div>

                            <DialogFooter className="flex justify-between items-center sm:justify-between">
                                {editingDisease ? (
                                    <Button variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => { handleDelete(editingDisease.id); setIsDialogOpen(false); }}>
                                        <Trash2 className="mr-2 h-4 w-4" /> Hastalığı Sil
                                    </Button>
                                ) : <div />}
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>İptal</Button>
                                    <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white">Kaydet</Button>
                                </div>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>

                <TabsContent value="micronutrients">
                    <div className="flex flex-col gap-6">
                        <div className="flex items-center justify-between">
                            <p className="text-gray-500 text-sm">Kan tahlillerinde takip edilecek mikrobesinleri ve varsayılan referans aralıklarını tanımlayın.</p>
                        </div>

                        {/* New Micronutrient Form */}
                        <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
                            <div className="flex justify-between items-center border-b pb-2">
                                <h3 className="font-semibold text-gray-900">
                                    {microEditingId ? 'Parametreyi Düzenle' : 'Yeni Parametre Tanımla'}
                                </h3>
                                {microEditingId && (
                                    <Button variant="ghost" size="sm" onClick={cancelMicroEdit} className="text-red-600 hover:bg-red-50 h-8">
                                        <X className="mr-2 h-3 w-3" /> Vazgeç
                                    </Button>
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                                <div className="space-y-2">
                                    <Label>Kategori</Label>
                                    <select
                                        value={microNewData.category}
                                        onChange={e => setMicroNewData({ ...microNewData, category: e.target.value as 'mikrobesin' | 'kan_tahlili' })}
                                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                                    >
                                        <option value="mikrobesin">🧬 Mikrobesin</option>
                                        <option value="kan_tahlili">🩸 Kan Tahlili</option>
                                    </select>
                                </div>
                                <div className="col-span-1 space-y-2">
                                    <Label>Adı</Label>
                                    <div className="flex gap-1">
                                        <Input
                                            value={microNewData.name}
                                            onChange={e => setMicroNewData({ ...microNewData, name: e.target.value })}
                                            placeholder="B12..."
                                            className="min-w-0"
                                        />
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon"
                                            onClick={autoFillMicronutrientWithAI}
                                            disabled={microAiLoading}
                                            className="shrink-0 bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200 h-10 w-10"
                                            title="Yapay Zeka ile Doldur"
                                        >
                                            {microAiLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Sparkles className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Birim</Label>
                                    <Input value={microNewData.unit} onChange={e => setMicroNewData({ ...microNewData, unit: e.target.value })} placeholder="mg, pg/ml..." />
                                </div>
                                <div className="space-y-2">
                                    <Label>Min Ref</Label>
                                    <Input type="number" value={microNewData.default_min} onChange={e => setMicroNewData({ ...microNewData, default_min: e.target.value })} placeholder="0" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Max Ref</Label>
                                    <Input type="number" value={microNewData.default_max} onChange={e => setMicroNewData({ ...microNewData, default_max: e.target.value })} placeholder="1000" />
                                </div>
                                <Button
                                    onClick={handleAddMicronutrient}
                                    disabled={microLoading || !microNewData.name}
                                    className={`${microEditingId ? 'bg-blue-600 hover:bg-blue-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                                >
                                    {microEditingId ? (
                                        <>
                                            <Check className="mr-2 h-4 w-4" /> Güncelle
                                        </>
                                    ) : (
                                        <>
                                            <Plus className="mr-2 h-4 w-4" /> Ekle
                                        </>
                                    )}
                                </Button>
                            </div>

                            {/* Keywords for New Item */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                                <div className="space-y-2">
                                    <Label className="text-xs text-gray-500 font-medium ml-1">✅ Uyumlu Kelimeler (Otomatik Eşleşme)</Label>
                                    <div
                                        className="min-h-[42px] p-2 border rounded-md border-dashed bg-green-50/30 hover:bg-green-50/80 cursor-pointer transition-colors flex flex-wrap gap-1 items-center"
                                        onClick={() => openKeywordModal('NEW', 'compatible')}
                                    >
                                        {newCompatibleKeywords.length > 0 ? (
                                            <>
                                                {newCompatibleKeywords.map((kw, i) => (
                                                    <span key={i} className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded border border-green-200 shadow-sm flex items-center gap-1">
                                                        <span>{getMatchTypeLabel(kw.match_type)}</span>
                                                        <span className="font-medium">{kw.keyword}</span>
                                                    </span>
                                                ))}
                                                <span className="text-[10px] text-green-600 ml-1 opacity-50 hover:opacity-100 icon-scale">+ Düzenle</span>
                                            </>
                                        ) : (
                                            <span className="text-xs text-gray-400 italic flex items-center gap-1 px-1">
                                                <Plus className="h-3.5 w-3.5" /> Kelime eklemek için tıklayın
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs text-gray-500 font-medium ml-1">⚠️ Uyumsuz Kelimeler (Emilim Engelleyici)</Label>
                                    <div
                                        className="min-h-[42px] p-2 border rounded-md border-dashed bg-orange-50/30 hover:bg-orange-50/80 cursor-pointer transition-colors flex flex-wrap gap-1 items-center"
                                        onClick={() => openKeywordModal('NEW', 'incompatible')}
                                    >
                                        {newIncompatibleKeywords.length > 0 ? (
                                            <>
                                                {newIncompatibleKeywords.map((kw, i) => (
                                                    <span key={i} className="text-[10px] px-2 py-1 bg-orange-100 text-orange-700 rounded border border-orange-200 shadow-sm flex items-center gap-1">
                                                        <span>{getMatchTypeLabel(kw.match_type)}</span>
                                                        <span className="font-medium">{kw.keyword}</span>
                                                    </span>
                                                ))}
                                                <span className="text-[10px] text-orange-600 ml-1 opacity-50 hover:opacity-100 icon-scale">+ Düzenle</span>
                                            </>
                                        ) : (
                                            <span className="text-xs text-gray-400 italic flex items-center gap-1 px-1">
                                                <Plus className="h-3.5 w-3.5" /> Kelime eklemek için tıklayın
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Micronutrients Table */}
                        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-gray-50/50">
                                        <TableHead className="w-[140px]">Parametre</TableHead>
                                        <TableHead className="w-[60px]">Birim</TableHead>
                                        <TableHead className="w-[100px]">Ref. Aralık</TableHead>
                                        <TableHead className="w-[180px]">✅ Uyumlu Kelimeler</TableHead>
                                        <TableHead className="w-[180px]">⚠️ Uyumsuz Kelimeler</TableHead>
                                        <TableHead className="text-right w-[70px]">İşlem</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {microLoading && micronutrients.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8">
                                                <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
                                            </TableCell>
                                        </TableRow>
                                    ) : micronutrients.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-gray-400 italic">
                                                Henüz parametre tanımlanmamış.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {/* Mikrobesinler Section */}
                                            {micronutrients.some(m => m.category === 'mikrobesin' || !m.category) && (
                                                <>
                                                    <TableRow>
                                                        <TableCell colSpan={7} className="bg-emerald-50 py-2 font-semibold text-emerald-800 text-sm">
                                                            🧬 Mikrobesinler (Vitamin & Mineraller)
                                                        </TableCell>
                                                    </TableRow>
                                                    {micronutrients.filter(m => m.category === 'mikrobesin' || !m.category).map(m => (
                                                        <TableRow key={m.id} className={`hover:bg-gray-50/50 ${microEditingId === m.id ? 'bg-blue-50/50' : ''}`}>
                                                            <TableCell className="font-medium text-gray-800 text-sm">{m.name}</TableCell>
                                                            <TableCell className="text-gray-600 text-xs">{m.unit}</TableCell>
                                                            <TableCell className="text-gray-600 text-xs">{m.default_min ?? '-'} - {m.default_max ?? '-'}</TableCell>
                                                            <TableCell
                                                                className="cursor-pointer hover:bg-green-50 transition-colors max-w-[180px]"
                                                                onClick={() => openKeywordModal(m.id, 'compatible')}
                                                            >
                                                                <div className="flex flex-wrap gap-1">
                                                                    {m.compatible_keywords?.length > 0 ? (
                                                                        <>
                                                                            {m.compatible_keywords.slice(0, 3).map((kw, i) => (
                                                                                <div key={i} className="inline-block m-[1px]">
                                                                                    {renderKeywordBadge(kw, 'compatible')}
                                                                                </div>
                                                                            ))}
                                                                            {m.compatible_keywords.length > 3 && (
                                                                                <span className="text-[10px] px-1 py-0.5 bg-green-50 text-green-600 rounded border border-green-100 ml-1">+{m.compatible_keywords.length - 3}</span>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <span className="text-[10px] text-gray-400 italic">+ Ekle</span>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell
                                                                className="cursor-pointer hover:bg-orange-50 transition-colors max-w-[180px]"
                                                                onClick={() => openKeywordModal(m.id, 'incompatible')}
                                                            >
                                                                <div className="flex flex-wrap gap-1">
                                                                    {m.incompatible_keywords?.length > 0 ? (
                                                                        <>
                                                                            {m.incompatible_keywords.slice(0, 3).map((kw, i) => (
                                                                                <div key={i} className="inline-block m-[1px]">
                                                                                    {renderKeywordBadge(kw, 'incompatible')}
                                                                                </div>
                                                                            ))}
                                                                            {m.incompatible_keywords.length > 3 && (
                                                                                <span className="text-[10px] px-1 py-0.5 bg-orange-50 text-orange-600 rounded border border-orange-100 ml-1">+{m.incompatible_keywords.length - 3}</span>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <span className="text-[10px] text-gray-400 italic">+ Ekle</span>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                <div className="flex justify-end gap-1">
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => startMicroEdit(m)}><Pencil className="h-3 w-3" /></Button>
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => handleDeleteMicronutrient(m.id)}><Trash2 className="h-3 w-3" /></Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </>
                                            )}

                                            {/* Kan Tahlilleri Section */}
                                            {micronutrients.some(m => m.category === 'kan_tahlili') && (
                                                <>
                                                    <TableRow>
                                                        <TableCell colSpan={6} className="bg-rose-50 py-2 font-semibold text-rose-800 text-sm">
                                                            🩸 Kan Tahlilleri (Hemogram, Biyokimya, Tiroid, Lipid vb.)
                                                        </TableCell>
                                                    </TableRow>
                                                    {micronutrients.filter(m => m.category === 'kan_tahlili').map(m => (
                                                        <TableRow key={m.id} className={`hover:bg-gray-50/50 ${microEditingId === m.id ? 'bg-blue-50/50' : ''}`}>
                                                            <TableCell className="font-medium text-gray-800 text-sm">{m.name}</TableCell>
                                                            <TableCell className="text-gray-600 text-xs">{m.unit}</TableCell>
                                                            <TableCell className="text-gray-600 text-xs">{m.default_min ?? '-'} - {m.default_max ?? '-'}</TableCell>
                                                            <TableCell
                                                                className="cursor-pointer hover:bg-green-50 transition-colors max-w-[180px]"
                                                                onClick={() => openKeywordModal(m.id, 'compatible')}
                                                            >
                                                                <div className="flex flex-wrap gap-1">
                                                                    {m.compatible_keywords?.length > 0 ? (
                                                                        <>
                                                                            {m.compatible_keywords.slice(0, 3).map((kw, i) => (
                                                                                <div key={i} className="inline-block m-[1px]">
                                                                                    {renderKeywordBadge(kw, 'compatible')}
                                                                                </div>
                                                                            ))}
                                                                            {m.compatible_keywords.length > 3 && (
                                                                                <span className="text-[10px] px-1 py-0.5 bg-green-50 text-green-600 rounded border border-green-100 ml-1">+{m.compatible_keywords.length - 3}</span>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <span className="text-[10px] text-gray-400 italic">+ Ekle</span>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell
                                                                className="cursor-pointer hover:bg-orange-50 transition-colors max-w-[180px]"
                                                                onClick={() => openKeywordModal(m.id, 'incompatible')}
                                                            >
                                                                <div className="flex flex-wrap gap-1">
                                                                    {m.incompatible_keywords?.length > 0 ? (
                                                                        <>
                                                                            {m.incompatible_keywords.slice(0, 3).map((kw, i) => (
                                                                                <div key={i} className="inline-block m-[1px]">
                                                                                    {renderKeywordBadge(kw, 'incompatible')}
                                                                                </div>
                                                                            ))}
                                                                            {m.incompatible_keywords.length > 3 && (
                                                                                <span className="text-[10px] px-1 py-0.5 bg-orange-50 text-orange-600 rounded border border-orange-100 ml-1">+{m.incompatible_keywords.length - 3}</span>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <span className="text-[10px] text-gray-400 italic">+ Ekle</span>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right">
                                                                <div className="flex justify-end gap-1">
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => startMicroEdit(m)}><Pencil className="h-3 w-3" /></Button>
                                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => handleDeleteMicronutrient(m.id)}><Trash2 className="h-3 w-3" /></Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </>
                                            )}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </TabsContent>

                {/* ========================================== */}
                {/* MEDICATIONS TAB CONTENT */}
                {/* ========================================== */}
                <TabsContent value="medications">
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-gray-500 text-sm">İlaç-besin etkileşim kurallarını yönetin.</p>
                        <Button onClick={openMedAddDialog} className="bg-blue-600 hover:bg-blue-700">
                            <Plus className="mr-2 h-4 w-4" /> Yeni İlaç Ekle
                        </Button>
                    </div>

                    <div className="bg-white rounded-lg border shadow-sm">
                        <div className="p-4 border-b bg-gray-50 flex items-center gap-4">
                            <div className="relative flex-1 max-w-sm">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                                <Input
                                    placeholder="İlaç ara..."
                                    className="pl-9 bg-white"
                                    value={medSearchTerm}
                                    onChange={e => setMedSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {medLoading ? (
                            <div className="p-12 flex justify-center">
                                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>İlaç Adı</TableHead>
                                        <TableHead>Etken Madde</TableHead>
                                        <TableHead>Kategori</TableHead>
                                        <TableHead>Kurallar</TableHead>
                                        <TableHead className="text-right">İşlemler</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {medications
                                        .filter(med =>
                                            med.name.toLowerCase().includes(medSearchTerm.toLowerCase()) ||
                                            med.generic_name?.toLowerCase().includes(medSearchTerm.toLowerCase())
                                        )
                                        .map(med => (
                                            <TableRow key={med.id}>
                                                <TableCell className="font-medium">{med.name}</TableCell>
                                                <TableCell className="text-gray-600 text-sm">{med.generic_name || '-'}</TableCell>
                                                <TableCell>
                                                    {med.category && <Badge variant="outline" className="text-xs">{med.category}</Badge>}
                                                </TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="sm" onClick={() => openMedEditDialog(med)}>
                                                        Etkileşimleri Gör
                                                    </Button>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button size="icon" variant="ghost" onClick={() => openMedEditDialog(med)}>
                                                            <Pencil size={14} />
                                                        </Button>
                                                        <Button size="icon" variant="ghost" className="text-red-600" onClick={() => deleteMedication(med.id)}>
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    }
                                </TableBody>
                            </Table>
                        )}
                    </div>

                    {/* Medication Edit/Add Dialog */}
                    <Dialog open={isMedDialogOpen} onOpenChange={setIsMedDialogOpen}>
                        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle>{editingMedication ? 'İlaç Düzenle' : 'Yeni İlaç Ekle'}</DialogTitle>
                                <DialogDescription>
                                    İlaç bilgilerini ve etkileşim kurallarını ayarlayın
                                </DialogDescription>
                            </DialogHeader>

                            <Tabs defaultValue="info" className="mt-4">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="info">İlaç Bilgileri</TabsTrigger>
                                    <TabsTrigger value="interactions" disabled={!editingMedication}>
                                        Etkileşim Kuralları
                                    </TabsTrigger>
                                </TabsList>

                                <TabsContent value="info" className="space-y-4 mt-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label>İlaç Adı *</Label>
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="Örn: Glucophage"
                                                    value={medFormData.name}
                                                    onChange={(e) => setMedFormData({ ...medFormData, name: e.target.value })}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    onClick={autoFillWithAI}
                                                    disabled={aiLoading || !medFormData.name}
                                                    title="Yapay Zeka ile Doldur"
                                                    className="shrink-0 text-purple-600 border-purple-200 hover:bg-purple-50"
                                                >
                                                    {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="text-lg">✨</span>}
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Etken Madde</Label>
                                            <Input
                                                placeholder="Örn: Metformin"
                                                value={medFormData.generic_name || ''}
                                                onChange={(e) => setMedFormData({ ...medFormData, generic_name: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Kategori</Label>
                                        <div className="relative">
                                            <Input
                                                placeholder="Örn: Antihipertansif, Antikoagülan..."
                                                value={medFormData.category || ''}
                                                onChange={(e) => setMedFormData({ ...medFormData, category: e.target.value })}
                                                list="medication-categories"
                                                className="w-full"
                                            />
                                            {/* Datalist for suggestions */}
                                            <datalist id="medication-categories">
                                                {/* Unique existing categories */}
                                                {Array.from(new Set(medications.map(m => m.category).filter((c): c is string => !!c))).map(cat => (
                                                    <option key={cat} value={cat} />
                                                ))}
                                                {/* Standard Defaults if not already in list */}
                                                {!medications.some(m => m.category === 'Antikoagülan') && <option value="Antikoagülan" />}
                                                {!medications.some(m => m.category === 'Antidiyabetik') && <option value="Antidiyabetik" />}
                                                {!medications.some(m => m.category === 'Tiroid Hormonu') && <option value="Tiroid Hormonu" />}
                                                {!medications.some(m => m.category === 'Antihipertansif') && <option value="Antihipertansif" />}
                                                {!medications.some(m => m.category === 'Statin') && <option value="Statin" />}
                                                {!medications.some(m => m.category === 'Antibiyotik') && <option value="Antibiyotik" />}
                                                {!medications.some(m => m.category === 'Ağrı Kesici') && <option value="Ağrı Kesici" />}
                                                {!medications.some(m => m.category === 'Vitamin') && <option value="Vitamin" />}
                                                {!medications.some(m => m.category === 'Mineral') && <option value="Mineral" />}
                                            </datalist>
                                        </div>
                                        <p className="text-[10px] text-gray-500">
                                            Listeden seçebilir veya yeni bir kategori yazabilirsiniz.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Açıklama</Label>
                                        <Textarea
                                            placeholder="İlaç hakkında notlar..."
                                            value={medFormData.description}
                                            onChange={(e) => setMedFormData({ ...medFormData, description: e.target.value })}
                                            rows={3}
                                        />
                                    </div>
                                </TabsContent>

                                <TabsContent value="interactions" className="space-y-6 mt-4">
                                    <div className="bg-gray-50 border rounded-md p-3 mb-4 shadow-sm flex items-center justify-between">
                                        <div>
                                            <h3 className="text-lg font-bold text-gray-800">{editingMedication?.name || medFormData.name}</h3>
                                            {medFormData.generic_name && (
                                                <p className="text-sm text-gray-500">Etken Madde: {medFormData.generic_name}</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-6 pt-4">
                                        <p className="text-sm text-gray-500">
                                            Bu ilaçla etkileşime giren besinleri ve etiketleri tanımlayın.
                                            Format: <code className="bg-gray-100 px-1 rounded text-xs">Kelime; Uyarı; Öneri</code>
                                        </p>

                                        {/* NEGATIVE (Yasaklı) */}
                                        <div className="space-y-2 border rounded-lg p-4 bg-red-50/30 border-red-200">
                                            <Label className="text-red-700 font-semibold flex items-center gap-2 text-sm">
                                                <AlertTriangle className="h-4 w-4" />
                                                Yasaklı / Etkileşimli (Negative)
                                            </Label>
                                            <p className="text-xs text-red-600/80 mb-1">
                                                İlacın etkisini bozan veya yan etki riskini artıran gıdalar.
                                            </p>
                                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider px-2 border-b pb-1 mb-1">
                                                <span>Etiket / Besin</span>
                                                <span>⚠️ Uyarı</span>
                                                <span>ℹ️ Öneri / Bilgi</span>
                                            </div>
                                            <RichTagInput
                                                value={medNegativeTags}
                                                onChange={setMedNegativeTags}
                                                placeholder="Örn: Greyfurt; İlaç düzeyini artırır; Tüketilmemeli"
                                                className="min-h-[80px] bg-white"
                                                showMatchScope={true}
                                                defaultMatchName={true}
                                                defaultMatchTags={true}
                                                splitOnSlash={false} // Disable auto-split to allow grouped tags like "A / B"
                                            />
                                        </div>

                                        {/* WARNING (Uyarı) */}
                                        <div className="space-y-2 border rounded-lg p-4 bg-orange-50/30 border-orange-200">
                                            <Label className="text-orange-700 font-semibold flex items-center gap-2 text-sm">
                                                <AlertTriangle className="h-4 w-4" />
                                                Dikkat Edilmeli (Warning)
                                            </Label>
                                            <p className="text-xs text-orange-600/80 mb-1">
                                                Belli koşullarda veya miktarlarda tüketilebilecek gıdalar.
                                            </p>
                                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider px-2 border-b pb-1 mb-1">
                                                <span>Etiket / Besin</span>
                                                <span>⚠️ Uyarı</span>
                                                <span>ℹ️ Öneri / Bilgi</span>
                                            </div>
                                            <RichTagInput
                                                value={medWarningTags}
                                                onChange={setMedWarningTags}
                                                placeholder="Örn: Süt Ürünleri; Emilimi azaltır; 2 saat ara verilmeli"
                                                className="min-h-[80px] bg-white"
                                                showMatchScope={true}
                                                defaultMatchName={true}
                                                defaultMatchTags={true}
                                                splitOnSlash={false}
                                            />
                                        </div>

                                        {/* POSITIVE (Önerilen) */}
                                        <div className="space-y-2 border rounded-lg p-4 bg-green-50/30 border-green-200">
                                            <Label className="text-green-700 font-semibold flex items-center gap-2 text-sm">
                                                <Heart className="h-4 w-4" />
                                                Önerilen / Destekleyici (Positive)
                                            </Label>
                                            <p className="text-xs text-green-600/80 mb-1">
                                                İlaçla birlikte alınması faydalı olan veya emilimi destekleyen gıdalar.
                                            </p>
                                            <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider px-2 border-b pb-1 mb-1">
                                                <span>Etiket / Besin</span>
                                                <span>⚠️ Uyarı</span>
                                                <span>ℹ️ Öneri / Bilgi</span>
                                            </div>
                                            <RichTagInput
                                                value={medPositiveTags}
                                                onChange={setMedPositiveTags}
                                                placeholder="Örn: C Vitamini; Emilimi artırır; Birlikte alınabilir"
                                                className="min-h-[80px] bg-white"
                                                showMatchScope={true}
                                                defaultMatchName={true}
                                                defaultMatchTags={true}
                                                splitOnSlash={false}
                                            />
                                        </div>
                                    </div>
                                </TabsContent>
                            </Tabs>

                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsMedDialogOpen(false)}>
                                    İptal
                                </Button>
                                <Button onClick={saveMedication}>
                                    {editingMedication ? 'Güncelle' : 'Kaydet'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>
                {/* END MEDICATIONS TAB CONTENT */}

                {/* GUIDE TAB CONTENT */}
                <TabsContent value="guide">
                    <div className="bg-white rounded-lg border shadow-sm p-6 space-y-8">
                        <div>
                            <h2 className="text-xl font-bold mb-2">📖 Sistem Rehberi</h2>
                            <p className="text-gray-500">Bu panel diyet planı sisteminin nasıl çalıştığını açıklar.</p>
                        </div>

                        {/* Warning Symbols Section */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold border-b pb-2">⚠️ Uyarı Sembolleri</h3>
                            <p className="text-sm text-gray-600 mb-4">Diyet planında yemek satırlarında görülebilecek semboller:</p>

                            <div className="grid gap-3">
                                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
                                    <span className="text-lg">🚫</span>
                                    <div>
                                        <p className="font-medium text-red-800">Sevmediği Besin</p>
                                        <p className="text-sm text-red-600">Hasta profilindeki "sevmediği besinler" listesinde yer alan besin</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
                                    <AlertTriangle className="h-5 w-5 text-red-600" />
                                    <div>
                                        <p className="font-medium text-red-800">Hastalık/Diyet Uyarısı</p>
                                        <p className="text-sm text-red-600">Hastanın hastalığı veya diyeti nedeniyle uygun olmayan besin</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                    <Heart className="h-5 w-5 text-blue-600 fill-blue-600" />
                                    <div>
                                        <p className="font-medium text-blue-800">Önerilen Besin</p>
                                        <p className="text-sm text-blue-600">Hastanın hastalığı veya tahlil sonuçlarına göre önerilen besin</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
                                    <span className="text-lg">💊🚫</span>
                                    <div>
                                        <p className="font-medium text-red-800">İlaç Etkileşimi (Engellenen)</p>
                                        <p className="text-sm text-red-600">Hastanın kullandığı ilaç ile tehlikeli etkileşim - kesinlikle tüketilmemeli</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                                    <span className="text-lg">💊⚠️</span>
                                    <div>
                                        <p className="font-medium text-yellow-800">İlaç Etkileşimi (Uyarı)</p>
                                        <p className="text-sm text-yellow-600">Hastanın kullandığı ilaç ile olası etkileşim - dikkatli olunmalı</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                                    <span className="text-lg">💊✅</span>
                                    <div>
                                        <p className="font-medium text-green-800">İlaç ile Uyumlu</p>
                                        <p className="text-sm text-green-600">Hastanın kullandığı ilaç ile olumlu etkileşim</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                                    <span className="text-lg text-purple-600">✦</span>
                                    <div>
                                        <p className="font-medium text-purple-800">Özel Yemek</p>
                                        <p className="text-sm text-purple-600">Veritabanında kayıtlı olmayan, elle eklenen özel yemek</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                                    <span className="text-lg text-green-600">✓</span>
                                    <div>
                                        <p className="font-medium text-green-800">Tüketildi</p>
                                        <p className="text-sm text-green-600">Hasta tarafından tüketildi olarak işaretlenmiş</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* How Disease System Works */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold border-b pb-2">🥗 Hastalık Sistemi</h3>
                            <div className="prose prose-sm max-w-none text-gray-700">
                                <p>Hastalık sistemi, hastaların sağlık durumlarına göre besin uyarıları oluşturur:</p>
                                <ol className="list-decimal ml-5 space-y-2">
                                    <li><strong>Hastalık Tanımla:</strong> Admin panelinden yeni hastalık ekleyin</li>
                                    <li><strong>Kurallar Ekle:</strong> Her hastalık için "Negative" (uygunsuz) veya "Positive" (önerilen) kurallar tanımlayın</li>
                                    <li><strong>Anahtar Kelime Belirle:</strong> Yemek adında veya etiketlerinde aranacak anahtar kelimeleri girin</li>
                                    <li><strong>Hastaya Ata:</strong> Hasta profilinden ilgili hastalığı seçin</li>
                                </ol>
                                <p className="mt-3">Sistem diyet planındaki her yemek için bu kuralları kontrol eder ve uygun uyarı ikonlarını gösterir.</p>
                            </div>
                        </div>

                        {/* How Micronutrient System Works */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold border-b pb-2">🧬 Mikrobesin/Tahlil Sistemi</h3>
                            <div className="prose prose-sm max-w-none text-gray-700">
                                <p>Tahlil sonuçlarına göre besin önerileri:</p>
                                <ol className="list-decimal ml-5 space-y-2">
                                    <li><strong>Parametre Tanımla:</strong> Demir, B12, D Vitamini gibi parametreler oluşturun</li>
                                    <li><strong>Referans Aralığı:</strong> Min/Max değerleri belirleyin</li>
                                    <li><strong>Anahtar Kelimeler:</strong> "Uyumlu" kelimeler (düşükse öner) ve "Uyumsuz" kelimeler (yüksekse kaçın) tanımlayın</li>
                                    <li><strong>Tahlil Girin:</strong> Hasta profilinden güncel tahlil değerlerini ekleyin</li>
                                </ol>
                                <p className="mt-3">Örnek: Ferritin düşükse "kırmızı et", "ıspanak" gibi besinler 💙 ile önerilir.</p>
                            </div>
                        </div>

                        {/* How Medication System Works */}
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold border-b pb-2">💊 İlaç Etkileşim Sistemi</h3>
                            <div className="prose prose-sm max-w-none text-gray-700">
                                <p>Hastaların kullandığı ilaçlara göre besin uyarıları:</p>
                                <ol className="list-decimal ml-5 space-y-2">
                                    <li><strong>İlaç Tanımla:</strong> Coumadin, Metformin gibi ilaçları ekleyin</li>
                                    <li><strong>Etkileşim Kuralları:</strong> Her ilaç için besin etkileşim kuralları tanımlayın:
                                        <ul className="list-disc ml-5 mt-1">
                                            <li><strong>Negative (🚫):</strong> Kesinlikle kaçınılmalı</li>
                                            <li><strong>Warning (⚠️):</strong> Dikkatli olunmalı</li>
                                            <li><strong>Positive (✅):</strong> Olumlu etki</li>
                                        </ul>
                                    </li>
                                    <li><strong>Hastaya Ata:</strong> Hasta profil ayarlarından "İlaçlar" bölümünden ilaç seçin</li>
                                </ol>
                                <p className="mt-3">Örnek: Coumadin kullanan hastanın diyetine "ıspanak" eklenirse 💊🚫 uyarısı gösterilir.</p>
                            </div>
                        </div>

                        {/* Quick Tips */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h4 className="font-semibold text-blue-800 mb-2">💡 İpuçları</h4>
                            <ul className="text-sm text-blue-700 space-y-1 list-disc ml-4">
                                <li>Anahtar kelimeler büyük/küçük harf duyarsızdır</li>
                                <li>"Eşleşme Tipi" ile sadece isim, sadece etiket veya her ikisinde arama yapabilirsiniz</li>
                                <li>Bir hastalık için birden fazla kural ekleyebilirsiniz</li>
                                <li>Hasta profilinden hastalık, tahlil ve ilaç bilgilerini güncelleyebilirsiniz</li>
                            </ul>
                        </div>
                    </div>
                </TabsContent>
                {/* END GUIDE TAB CONTENT */}

            </Tabs>

            {/* Keyword Management Modal */}
            <Dialog open={keywordModalOpen} onOpenChange={setKeywordModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {keywordType === 'compatible' ? '✅ Uyumlu Kelimeler' : '⚠️ Uyumsuz Kelimeler'} Yönetimi
                        </DialogTitle>
                        <DialogDescription>
                            Bu besin değeri için arama motorunda kullanılacak kelimeleri yönetin.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                        <div className="bg-blue-50 p-3 rounded-md text-xs text-blue-700 mb-2">
                            <p className="font-semibold">İpuçları:</p>
                            <ul className="list-disc ml-4 space-y-1 mt-1">
                                <li>Birden fazla kelimeyi alt alta yapıştırabilirsiniz.</li>
                                <li>Detaylı giriş için: <strong>Kelime; Uyarı Mesajı; Öneri/Bilgi</strong> formatını kullanabilirsiniz.</li>
                                <li>Örn: <em>Somon; [Destekleyici]: D vitamini kaynağı; Haftada 2 kez tüketin</em></li>
                            </ul>
                        </div>

                        <div className="space-y-2">
                            <Label>Anahtar Kelimeler</Label>
                            <RichTagInput
                                value={editingKeywords as any} // Cast to any to avoid temporary type mismatch until saveKeywords converts back
                                onChange={(val) => setEditingKeywords(val as any)}
                                placeholder="Örn: Somon; Uyarı Mesajı; Bilgi Mesajı"
                                className="min-h-[200px]"
                                showMatchScope={true}
                                defaultMatchName={true}
                                defaultMatchTags={true}
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setKeywordModalOpen(false)}>İptal</Button>
                        <Button onClick={saveKeywords} className="bg-emerald-600 hover:bg-emerald-700 text-white">Kaydet ve Kapat</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
