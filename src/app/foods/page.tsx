"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabase"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Plus,
    Search,
    Pencil,
    Trash2,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Loader2,
    CheckSquare,
    Square,
    Filter,
    ChevronDown,
    ImageIcon,
    Eye,
    EyeOff
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
// import { useToast } from "@/components/ui/use-toast"
import { FoodDialog, Food, FoodFormValues } from "@/components/foods/food-dialog"
import { FoodEditDialog } from "@/components/diet/food-sidebar"
import { FOOD_ROLES, ROLE_LABELS as SHARED_ROLE_LABELS } from "@/lib/constants/food-roles"
import { FOOD_CATEGORIES } from "@/lib/constants/food-categories"
import { useRecipeManager } from "@/hooks/use-recipe-manager"
import { normalizeFoodName } from "@/utils/recipe-matcher"


const ROLE_LABELS = SHARED_ROLE_LABELS

// Generic Inline Edit Components
const InlineCell = ({
    initialValue,
    type = "text",
    onSave,
    classes = ""
}: {
    initialValue: string | number;
    type?: "text" | "number";
    onSave: (val: string | number) => Promise<void>;
    classes?: string;
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(initialValue);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleSave = async () => {
        if (value === initialValue) {
            setIsEditing(false);
            return;
        }
        setIsLoading(true);
        try {
            await onSave(value);
            setIsEditing(false);
        } catch (error) {
            console.error("Save failed", error);
            setValue(initialValue); // Revert
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSave();
        if (e.key === "Escape") {
            setValue(initialValue);
            setIsEditing(false);
        }
    };

    if (isEditing) {
        return (
            <div className="relative flex items-center">
                <Input
                    className={`h-6 text-xs px-1 py-0 ${classes}`}
                    type={type}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    disabled={isLoading}
                />
                {isLoading && <Loader2 className="absolute right-1 w-3 h-3 animate-spin text-gray-400" />}
            </div>
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className={`cursor-pointer hover:bg-blue-50 hover:text-blue-600 px-1 rounded transition-colors truncate min-h-[20px] flex items-center ${!initialValue ? 'text-gray-300 italic' : ''} ${classes}`}
            title="Tıkla ve düzenle"
        >
            {initialValue || (type === 'number' ? '0' : 'Boş')}
        </div>
    );
};

const InlineSelect = ({
    initialValue,
    options,
    labels,
    onSave,
    classes = ""
}: {
    initialValue: string;
    options: string[];
    labels?: Record<string, string>;
    onSave: (val: string) => Promise<void>;
    classes?: string;
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(initialValue);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        setValue(initialValue);
    }, [initialValue]);

    const handleSave = async (newValue: string) => {
        if (newValue === initialValue) {
            setIsEditing(false);
            return;
        }
        setIsLoading(true);
        setValue(newValue); // Optimistic internally
        try {
            await onSave(newValue);
            setIsEditing(false);
        } catch (error) {
            console.error("Save failed", error);
            setValue(initialValue);
        } finally {
            setIsLoading(false);
        }
    };

    if (isEditing) {
        return (
            <div className="relative">
                <select
                    className={`h-6 text-[10px] border rounded px-1 bg-white shadow-sm focus:ring-1 focus:ring-blue-500 w-full ${classes}`}
                    value={value}
                    onChange={(e) => handleSave(e.target.value)}
                    onBlur={() => !isLoading && setIsEditing(false)}
                    autoFocus
                    disabled={isLoading}
                >
                    {options.map((opt) => (
                        <option key={opt} value={opt}>
                            {labels ? (labels[opt] || opt) : opt}
                        </option>
                    ))}
                </select>
                {isLoading && <Loader2 className="absolute right-1 top-1 h-3 w-3 animate-spin text-gray-400" />}
            </div>
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className={`cursor-pointer hover:bg-blue-50 hover:text-blue-600 px-1.5 py-0.5 rounded transition-colors whitespace-nowrap min-h-[20px] flex items-center ${classes}`}
            title="Tıkla ve düzenle"
        >
            {(labels ? labels[initialValue] : initialValue) || <span className="text-gray-300 italic">Seç</span>}
        </div>
    );
};

const InlineMultiSelect = ({
    initialValues,
    options,
    onSave,
    renderLabel
}: {
    initialValues: string[],
    options: { value: string, label: string }[],
    onSave: (values: string[]) => Promise<void>,
    renderLabel?: (values: string[]) => React.ReactNode
}) => {
    const [isEditing, setIsEditing] = useState(false)
    const [selected, setSelected] = useState(initialValues)
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        setSelected(initialValues)
    }, [initialValues]) // Reset on prop change

    const handleSave = async (newValues: string[]) => {
        if (JSON.stringify(newValues.sort()) === JSON.stringify(initialValues.sort())) {
            setIsEditing(false)
            return
        }
        setIsLoading(true)
        setSelected(newValues) // Optimistic
        try {
            await onSave(newValues)
            setIsEditing(false)
        } catch (error) {
            console.error("Save failed", error)
            setSelected(initialValues) // Revert
            alert("Güncelleme başarısız")
        } finally {
            setIsLoading(false)
        }
    }

    if (isEditing) {
        return (
            <Popover open={true} onOpenChange={(open) => !open && !isLoading && setIsEditing(false)}>
                <PopoverTrigger asChild>
                    <div className="min-w-[50px] min-h-[20px]" />
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="start" onInteractOutside={(e) => {
                    if (isLoading) e.preventDefault();
                }}>
                    <div className="space-y-2">
                        {options.map(opt => (
                            <div key={opt.value} className="flex items-center space-x-2">
                                <Checkbox
                                    id={`inline-${opt.value}`}
                                    checked={selected.includes(opt.value)}
                                    onCheckedChange={(checked) => {
                                        if (checked) setSelected([...selected, opt.value])
                                        else setSelected(selected.filter(s => s !== opt.value))
                                    }}
                                    disabled={isLoading}
                                />
                                <Label htmlFor={`inline-${opt.value}`} className="text-xs">{opt.label}</Label>
                            </div>
                        ))}
                        <Button
                            size="sm"
                            className="w-full mt-2 h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => handleSave(selected)}
                            disabled={isLoading}
                        >
                            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Kaydet"}
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className="cursor-pointer hover:bg-blue-50 hover:text-blue-600 px-1 py-0.5 rounded transition-colors min-h-[20px] flex items-center"
            title="Tıkla ve düzenle"
        >
            {renderLabel ? renderLabel(initialValues) : (
                initialValues.length > 0 ? (
                    <span className="truncate text-[10px]">{initialValues.map(v => options.find(o => o.value === v)?.label || v).join(', ')}</span>
                ) : <span className="text-gray-300 italic text-[10px]">Seç</span>
            )}
        </div>
    )
}

const InlineSeasonEdit = ({
    start,
    end,
    onSave
}: {
    start: number | null,
    end: number | null,
    onSave: (start: number, end: number) => Promise<void>
}) => {
    const [isEditing, setIsEditing] = useState(false)
    const [s, setS] = useState(start || 1)
    const [e, setE] = useState(end || 12)
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        setS(start || 1)
        setE(end || 12)
    }, [start, end])

    const handleSave = async () => {
        if (s === start && e === end) {
            setIsEditing(false)
            return
        }
        setIsLoading(true)
        try {
            await onSave(s, e)
            setIsEditing(false)
        } catch (error) {
            console.error("Save failed", error)
            alert("Güncelleme başarısız")
        } finally {
            setIsLoading(false)
        }
    }

    if (isEditing) {
        return (
            <Popover open={true} onOpenChange={(open) => !open && !isLoading && setIsEditing(false)}>
                <PopoverTrigger asChild>
                    <div className="min-w-[50px] min-h-[20px]" />
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                    <div className="flex flex-col gap-2">
                        <Label className="text-xs font-semibold">Sezon Aralığı (Ay)</Label>
                        <div className="flex gap-2 items-center">
                            <select
                                className="h-7 text-xs border rounded px-1 bg-white shadow-sm w-16"
                                value={s}
                                onChange={(e) => setS(Number(e.target.value))}
                                disabled={isLoading}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                            <span className="text-gray-400">-</span>
                            <select
                                className="h-7 text-xs border rounded px-1 bg-white shadow-sm w-16"
                                value={e}
                                onChange={(e) => setE(Number(e.target.value))}
                                disabled={isLoading}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                        <Button
                            size="sm"
                            className="w-full h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                            onClick={handleSave}
                            disabled={isLoading}
                        >
                            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Kaydet"}
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className="cursor-pointer hover:bg-blue-50 hover:text-blue-600 px-1 py-0.5 rounded transition-colors min-h-[20px] flex items-center"
            title="Sezonu düzenle"
        >
            {start && end ? (
                start === 1 && end === 12 ? 'Tüm Yıl' : `${start}-${end}. Ay`
            ) : <span className="text-gray-300 italic text-[10px]">Seç</span>}
        </div>
    )
}

export default function FoodsPage() {
    const [foods, setFoods] = useState<Food[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState("")
    const [searchScope, setSearchScope] = useState("all") // 'all', 'name', 'tags', 'compatibility'

    // Sorting state
    const [sortConfig, setSortConfig] = useState<{ key: keyof Food; direction: 'asc' | 'desc' } | null>(null)
    const [showHidden, setShowHidden] = useState(false)

    // Dialog state
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingFood, setEditingFood] = useState<Food | null>(null)

    // Delete confirmation state
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    // Advanced Filter State 1
    const [filterColumn, setFilterColumn] = useState<string>('all')
    const [filterValue, setFilterValue] = useState<string>('all')

    // Advanced Filter State 2
    const [filterColumn2, setFilterColumn2] = useState<string>('all')
    const [filterValue2, setFilterValue2] = useState<string>('all')

    // Helper to get unique values for a column
    const getUniqueValues = (column: string, data: Food[]) => {
        if (column === 'all') return []
        const values = new Set<string>()
        data.forEach(food => {
            const val = (food as any)[column]
            if (val) {
                if (Array.isArray(val)) val.forEach(v => values.add(String(v)))
                else values.add(String(val))
            }
        })
        return Array.from(values).sort()
    }

    const uniqueFilterValues = useMemo(() => getUniqueValues(filterColumn, foods), [foods, filterColumn])
    const uniqueFilterValues2 = useMemo(() => getUniqueValues(filterColumn2, foods), [foods, filterColumn2])

    const [categories, setCategories] = useState<string[]>([])
    const [roles, setRoles] = useState<{ value: string, label: string }[]>([])

    // Bulk Selection State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)

    // Resizable Column State
    const [colWidths, setColWidths] = useState<Record<string, number>>({ name: 200, category: 100, role: 100, tags: 150, compatibility_tags: 150 })

    // GitHub card thumbnails
    const [githubCards, setGithubCards] = useState<{ name: string, imageUrl: string }[]>([])
    const [imagePreview, setImagePreview] = useState<string | null>(null)

    // Recipe match/ban management (for ban-aware card matching)
    const { manualMatches: recipeMatches, bans: recipeBans } = useRecipeManager()

    // Extended Bulk Edit Options
    const seasonOptions = [
        { value: '1-12', label: 'Tüm Yıl' },
        { value: '3-5', label: 'İlkbahar' },
        { value: '6-8', label: 'Yaz' },
        { value: '9-11', label: 'Sonbahar' },
        { value: '12-2', label: 'Kış' }
    ]
    const mealOptions = [
        { value: 'breakfast', label: 'Kahvaltı' },
        { value: 'lunch', label: 'Öğle' },
        { value: 'dinner', label: 'Akşam' },
        { value: 'snack', label: 'Ara Öğün' },
        { value: 'supplement', label: 'Takviye' }
    ]
    const dietOptions = [
        { value: 'elimination_diet', label: 'E.Keto' },
        { value: 'keto', label: 'Keto' },
        { value: 'vegan', label: 'Vegan' },
        { value: 'lowcarb', label: 'Düşük Karb' },
        { value: 'vejeteryan', label: 'Vejeteryan' }
    ]
    const fillerOptions = [
        { value: 'filler_lunch', label: 'Öğle Dolgusu' },
        { value: 'filler_dinner', label: 'Akşam Dolgusu' }
    ]

    // Helper for resizing
    const startResizing = (mouseDownEvent: React.MouseEvent, columnKey: string) => {
        mouseDownEvent.preventDefault();
        const startX = mouseDownEvent.pageX;
        const startWidth = colWidths[columnKey] || 80;

        const onMouseMove = (mouseMoveEvent: MouseEvent) => {
            const newWidth = startWidth + mouseMoveEvent.pageX - startX;
            if (newWidth > 40) setColWidths(prev => ({ ...prev, [columnKey]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            document.body.style.cursor = 'default';
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        document.body.style.cursor = 'col-resize';
    };

    // ... (rest of state)

    // Fetch foods and categories on mount
    useEffect(() => {
        loadFoods()
        loadCategories()
        loadRoles()
        fetchGithubCards()
    }, [])

    const fetchGithubCards = async () => {
        try {
            const res = await fetch('/api/admin/github-sync-check')
            if (res.ok) {
                const data = await res.json()
                setGithubCards(data.publishedCards || [])
            }
        } catch (e) {
            console.warn('GitHub cards fetch failed:', e)
        }
    }

    // Helper: Find matching card URLs for a food name using advanced fuzzy matching
    // Now respects recipe_match_bans and recipe_manual_matches from DB
    const getCardUrls = (foodName: string): string[] => {
        if (!foodName || githubCards.length === 0) return []
        
        const normalize = (s: string) => s.toLowerCase().replace(/[ıİşŞğĞüÜöÖçÇI]/g, m => ({
            'ı':'i','İ':'i','ş':'s','Ş':'s','ğ':'g','Ğ':'g','ü':'u','Ü':'u','ö':'o','Ö':'o','ç':'c','Ç':'c','I':'i'
        } as any)[m] || m).replace(/[^a-z0-9]/g, '')
        
        const fn = normalize(foodName)
        const normalizedPattern = normalizeFoodName(foodName)
        const foodTokens = (foodName.toLowerCase().replace(/[ıİşŞğĞüÜöÖçÇI]/g, m => ({
            'ı':'i','İ':'i','ş':'s','Ş':'s','ğ':'g','Ğ':'g','ü':'u','Ü':'u','ö':'o','Ö':'o','ç':'c','Ç':'c','I':'i'
        } as any)[m] || m).match(/[a-z0-9]+/g) || []).filter(w => w.length > 2)

        // Get banned card filenames for this food
        const bannedFilenames = new Set(
            recipeBans
                .filter(b => 
                    b.food_pattern === normalizedPattern ||
                    b.food_pattern.toLowerCase() === foodName.toLowerCase() ||
                    normalizeFoodName(b.food_pattern) === normalizedPattern
                )
                .map(b => b.card_filename.replace(/\..+$/, '').toLowerCase())
        )

        // Get manually matched card filenames for this food  
        const manualMatchFilenames = recipeMatches
            .filter(m => 
                m.food_pattern === normalizedPattern ||
                m.food_pattern.toLowerCase() === foodName.toLowerCase() ||
                normalizeFoodName(m.food_pattern) === normalizedPattern
            )
            .map(m => m.card_filename.replace(/\..+$/, '').toLowerCase())

        const results: string[] = []

        // First: add manually matched cards (highest priority)
        for (const manualFn of manualMatchFilenames) {
            const card = githubCards.find(c => normalize(c.name) === normalize(manualFn))
            if (card && !results.includes(card.imageUrl)) results.push(card.imageUrl)
        }

        // Then: fuzzy match, but exclude banned cards
        const candidates = githubCards.map(c => {
            const cn = normalize(c.name)
            // Skip if this card is banned for this food
            if (bannedFilenames.has(c.name.toLowerCase())) return { card: c, score: 0 }
            if (bannedFilenames.has(cn)) return { card: c, score: 0 }
            
            let score = 0
            if (cn === fn) score += 100
            if (cn.includes(fn) || fn.includes(cn)) score += 50

            if (foodTokens.length > 0) {
                const cardTokens = (c.name.toLowerCase().replace(/[ıİşŞğĞüÜöÖçÇI]/g, m => ({
                    'ı':'i','İ':'i','ş':'s','Ş':'s','ğ':'g','Ğ':'g','ü':'u','Ü':'u','ö':'o','Ö':'o','ç':'c','Ç':'c','I':'i'
                } as any)[m] || m).match(/[a-z0-9]+/g) || []).filter(w => w.length > 2)

                const matchedTokens = foodTokens.filter(ft => cardTokens.some(ct => ct.includes(ft) || ft.includes(ct)))
                const matchRatio = matchedTokens.length / foodTokens.length
                
                // Advanced fuzzy: ≥ 60% of original tokens must be found in card name
                if (matchRatio >= 0.6) {
                    score += matchRatio * 40
                }
                score += matchedTokens.length * 5
            }
            return { card: c, score }
        }).filter(m => m.score > 25).sort((a, b) => b.score - a.score)

        for (const c of candidates) {
            if (!results.includes(c.card.imageUrl)) results.push(c.card.imageUrl)
        }

        return results
    }

    const loadRoles = async () => {
        try {
            const { data } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'food_management_options')
                .single()

            if (data?.value?.roles && Array.isArray(data.value.roles)) {
                const dbRoles = data.value.roles.map((r: any) =>
                    typeof r === 'string' ? { value: r, label: r } : r
                ).filter((r: any) => r && r.value && r.label)

                const existingValues = new Set(FOOD_ROLES.map(r => r.value.toLowerCase()))
                const newRoles = dbRoles.filter((r: any) => !existingValues.has(r.value.toLowerCase()))

                setRoles([...FOOD_ROLES, ...newRoles])
                return
            }
        } catch (e) { }
        // Fallback to standardized roles from constant
        setRoles([...FOOD_ROLES])
    }

    const loadCategories = async () => {
        try {
            const { data } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'food_management_options')
                .single()

            if (data?.value?.categories && Array.isArray(data.value.categories)) {
                const dynamicCats = data.value.categories.filter((c: any) => typeof c === 'string');
                const allCats = [...FOOD_CATEGORIES, ...dynamicCats];
                const seen = new Set();
                const merged = allCats.filter(c => {
                    const low = c.toLowerCase().trim();
                    if (seen.has(low)) return false;
                    seen.add(low);
                    return true;
                });
                setCategories(merged);
                return
            }
        } catch (e) { }
        setCategories([...FOOD_CATEGORIES])
    }


    // ... (rest of loadFoods)

    // ... (rest of loadFoods)
    const loadFoods = async () => {
        setLoading(true)
        try {
            const { data, error } = await supabase
                .from('foods')
                .select('*')
                .order('created_at', { ascending: false })

            if (error) throw error

            // Transform tags if needed (postgres array to string is usually automatic in JS client but let's be safe)
            setFoods(data as Food[])
        } catch (error) {
            console.error("Error loading foods:", error)
            // toast({ title: "Hata", description: "Yemekler yüklenemedi", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }

    // Handle Sort
    const requestSort = (key: keyof Food) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    }

    // Filter and Sort Data
    const filteredAndSortedFoods = useMemo(() => {
        let data = [...foods]

        // 0. Hidden Filter (DB Column hidden_from_cardmaker)
        if (!showHidden) {
            data = data.filter(f => !f.hidden_from_cardmaker)
        }

        if (searchQuery && searchQuery.trim().length > 0) {
            // Check for comma to determine OR logic
            const isOrSearch = searchQuery.includes(',')
            let tokens: string[] = []

            if (isOrSearch) {
                // OR Logic: Split by comma
                tokens = searchQuery.toLowerCase().split(',').map(t => t.trim()).filter(t => t.length > 0)
            } else {
                // AND Logic: Split by space (Default)
                tokens = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 0)
            }

            if (tokens.length > 0) {
                data = data.filter(food => {
                    let searchStr = ""
                    switch (searchScope) {
                        case 'name':
                            searchStr = food.name || ""
                            break;
                        case 'tags':
                            searchStr = (food.tags || []).join(' ')
                            break;
                        case 'compatibility':
                            searchStr = (food.compatibility_tags || []).join(' ')
                            break;
                        default: // 'all'
                            searchStr = `${food.name || ""} ${food.category || ''} ${food.tags?.join(' ') || ''} ${food.compatibility_tags?.join(' ') || ''}`
                    }
                    searchStr = searchStr.toLowerCase()

                    if (isOrSearch) {
                        return tokens.some(token => searchStr.includes(token))
                    } else {
                        return tokens.every(token => searchStr.includes(token))
                    }
                })
            }
        }

        // 2. Advanced Filter 1
        if (filterColumn !== 'all' && filterValue !== 'all') {
            data = data.filter(food => {
                const val = (food as any)[filterColumn]
                if (Array.isArray(val)) return val.map(v => String(v)).includes(filterValue)
                return String(val) === filterValue
            })
        }

        // 3. Advanced Filter 2
        if (filterColumn2 !== 'all' && filterValue2 !== 'all') {
            data = data.filter(food => {
                const val = (food as any)[filterColumn2]
                if (Array.isArray(val)) return val.map(v => String(v)).includes(filterValue2)
                return String(val) === filterValue2
            })
        }

        // 4. Sort
        if (sortConfig) {
            data.sort((a, b) => {
                let aValue = (a as any)[sortConfig.key] ?? ""
                let bValue = (b as any)[sortConfig.key] ?? ""

                // Handle arrays (Tags, Meal Types)
                if (Array.isArray(aValue)) aValue = aValue.sort().join(", ")
                if (Array.isArray(bValue)) bValue = bValue.sort().join(", ")

                // Handle Booleans
                if (typeof aValue === 'boolean') aValue = aValue ? "Yes" : "No"
                if (typeof bValue === 'boolean') bValue = bValue ? "Yes" : "No"

                if (aValue === bValue) return 0
                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1
                return 0
            })
        }

        return data
    }, [foods, searchQuery, sortConfig, filterColumn, filterValue, filterColumn2, filterValue2])

    // Bulk Selection Logic
    const toggleSelection = (id: string, multiSelect: boolean) => {
        const newSet = new Set(selectedIds)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedIds(newSet)
        setLastSelectedId(id)
    }

    const toggleSelectAll = () => {
        if (selectedIds.size === filteredAndSortedFoods.length && filteredAndSortedFoods.length > 0) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(filteredAndSortedFoods.map(f => f.id)))
        }
    }

    const handleBulkUpdate = async (field: keyof Food | 'meal_types' | 'filler_complex' | 'diet_complex' | 'season_complex', value: any) => {
        if (selectedIds.size === 0) return
        if (!confirm(`${selectedIds.size} kayıt güncellenecek. Emin misiniz?`)) return

        setLoading(true)
        try {
            let updates: Record<string, any> = {}

            // Handle Complex Updates
            if (field === 'season_complex') {
                const [s, e] = (value as string).split('-').map(Number)
                if (!isNaN(s) && !isNaN(e)) {
                    updates = { season_start: s, season_end: e }
                }
            } else if (field === 'meal_types') {
                // value is array string[] from multi-select
                updates = { meal_types: value }
            } else if (field === 'filler_complex') {
                // value is array ['filler_lunch', 'filler_dinner']
                // We need to decide logic. Selected = True, Unselected = False?
                // Or just set True for selected?
                // The request implies "selecting" them. Let's assume Replacement (Selected=True, others False).
                const hasLunch = (value as string[]).includes('filler_lunch')
                const hasDinner = (value as string[]).includes('filler_dinner')
                updates = { filler_lunch: hasLunch, filler_dinner: hasDinner }
            } else if (field === 'diet_complex') {
                // value is array ['keto', 'vegan'...]
                const dietKeys = ['keto', 'vegan', 'lowcarb', 'vejeteryan', 'elimination_diet']
                dietKeys.forEach(k => {
                    updates[k] = (value as string[]).includes(k)
                })
            }
            else if (field === 'priority_score') {
                updates = { [field]: Number(value) }
            }
            else if (['min_quantity', 'max_quantity', 'step', 'min_weekly_freq', 'max_weekly_freq'].includes(field as string)) {
                // Numeric fields from bulk number header
                updates = { [field]: value === "" ? null : Number(value) }
            }
            else {
                // Standard single field update
                updates = { [field]: value }
            }

            // Optimistic Update
            setFoods(current => current.map(f => selectedIds.has(f.id) ? { ...f, ...updates } : f))

            const { error } = await supabase.from('foods').update(updates).in('id', Array.from(selectedIds))
            if (error) throw error

            // Clear selection after successful update? Maybe keep it for multiple edits.
            // setSelectedIds(new Set()) 
        } catch (error) {
            console.error("Bulk update failed", error)
            alert("Toplu güncelleme başarısız")
            await loadFoods() // Revert by reloading
        } finally {
            setLoading(false)
        }
    }

    // CRUD Operations
    const handleSave = async (values: FoodFormValues) => {
        try {
            // Parse tags string to array
            const tagsArray = values.tags
                ? values.tags.split(',').map(t => t.trim()).filter(Boolean)
                : []

            const foodData = {
                name: values.name,
                category: values.category || null,
                calories: values.calories,
                protein: values.protein,
                carbs: values.carbs,
                fat: values.fat,
                portion_unit: values.portion_unit,
                standard_amount: values.standard_amount,
                tags: tagsArray,
                // search_tokens is generated always
            }

            if (editingFood) {
                // UPDATE
                const { error } = await supabase
                    .from('foods')
                    .update(foodData)
                    .eq('id', editingFood.id)

                if (error) throw error
            } else {
                // INSERT
                const { error } = await supabase
                    .from('foods')
                    .insert([foodData])

                if (error) throw error
            }

            await loadFoods() // Reload to get consistent state
        } catch (error) {
            console.error("Error saving food:", error)
            alert("Kaydedilirken bir hata oluştu.")
            throw error // Propagate to dialog to stop loading spinner
        }
    }

    const handleDelete = async () => {
        if (!deleteId) return
        setIsDeleting(true)
        try {
            const { error } = await supabase
                .from('foods')
                .delete()
                .eq('id', deleteId)

            if (error) throw error

            setFoods(foods.filter(f => f.id !== deleteId))
            setDeleteId(null)
        } catch (error) {
            console.error("Delete error:", error)
            alert("Silinirken bir hata oluştu.")
        } finally {
            setIsDeleting(false)
        }
    }

    // Determine sort icon
    const getSortIcon = (columnKey: keyof Food) => {
        if (sortConfig?.key !== columnKey) return <ArrowUpDown className="ml-2 h-4 w-4 text-gray-400" />
        if (sortConfig.direction === 'asc') return <ArrowUp className="ml-2 h-4 w-4 text-green-600" />
        return <ArrowDown className="ml-2 h-4 w-4 text-green-600" />
    }

    // Multi-Select Header Component
    const MultiSelectHeader = ({
        label,
        options,
        onApply
    }: {
        label: string,
        options: { value: string, label: string }[],
        onApply: (values: string[]) => void
    }) => {
        const [selected, setSelected] = useState<string[]>([])
        const [isOpen, setIsOpen] = useState(false)

        return (
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <div className="flex items-center gap-1 cursor-pointer bg-blue-50 border border-blue-200 text-blue-800 font-bold rounded px-2 h-6 text-[10px] hover:bg-blue-100 w-full justify-between">
                        <span className="truncate">{label}</span>
                        <ChevronDown className="h-3 w-3 opacity-50" />
                    </div>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2" align="start">
                    <div className="space-y-2">
                        <h4 className="font-medium text-xs text-muted-foreground mb-2">{label} Seç</h4>
                        {options.map(opt => (
                            <div key={opt.value} className="flex items-center space-x-2">
                                <Checkbox
                                    id={`${label}-${opt.value}`}
                                    checked={selected.includes(opt.value)}
                                    onCheckedChange={(checked) => {
                                        if (checked) setSelected([...selected, opt.value])
                                        else setSelected(selected.filter(s => s !== opt.value))
                                    }}
                                />
                                <Label htmlFor={`${label}-${opt.value}`} className="text-xs">{opt.label}</Label>
                            </div>
                        ))}
                        <Button
                            size="sm"
                            className="w-full mt-2 h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => {
                                onApply(selected)
                                setIsOpen(false)
                            }}
                        >
                            Uygula ({selected.length})
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        )
    }

    // Bulk Season Header (Numeric)
    const BulkSeasonHeader = ({
        label,
        onApply
    }: {
        label: string,
        onApply: (start: number, end: number) => void
    }) => {
        const [isOpen, setIsOpen] = useState(false)
        const [s, setS] = useState(1)
        const [e, setE] = useState(12)

        return (
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <div className="flex items-center gap-1 cursor-pointer bg-blue-50 border border-blue-200 text-blue-800 font-bold rounded px-2 h-6 text-[10px] hover:bg-blue-100 w-full justify-between">
                        <span className="truncate">{label}</span>
                        <ChevronDown className="h-3 w-3 opacity-50" />
                    </div>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="start">
                    <div className="flex flex-col gap-2">
                        <Label className="text-xs font-semibold">{label} Seç</Label>
                        <div className="flex gap-2 items-center">
                            <select
                                className="h-7 text-xs border rounded px-1 bg-white shadow-sm w-16"
                                value={s}
                                onChange={(evt) => setS(Number(evt.target.value))}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                            <span className="text-gray-400">-</span>
                            <select
                                className="h-7 text-xs border rounded px-1 bg-white shadow-sm w-16"
                                value={e}
                                onChange={(evt) => setE(Number(evt.target.value))}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                        <Button
                            size="sm"
                            className="w-full h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => {
                                onApply(s, e)
                                setIsOpen(false)
                            }}
                        >
                            Uygula
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        )
    }
    
    // Bulk Number Header
    const BulkNumberHeader = ({
        label,
        onApply
    }: {
        label: string,
        onApply: (val: number | string) => void
    }) => {
        const [isOpen, setIsOpen] = useState(false)
        const [val, setVal] = useState<string>("")

        return (
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <div className="flex items-center gap-1 cursor-pointer bg-blue-50 border border-blue-200 text-blue-800 font-bold rounded px-2 h-6 text-[10px] hover:bg-blue-100 w-full justify-between">
                        <span className="truncate">{label}</span>
                        <ChevronDown className="h-3 w-3 opacity-50" />
                    </div>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-2" align="start">
                    <div className="flex flex-col gap-2">
                        <Label className="text-xs font-semibold">{label} Değeri</Label>
                        <Input 
                            type="number" 
                            className="h-8 text-xs" 
                            value={val} 
                            onChange={(e) => setVal(e.target.value)} 
                            placeholder="Değer..."
                            autoFocus
                        />
                        <Button
                            size="sm"
                            className="w-full h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                            onClick={() => {
                                onApply(val === "" ? "" : Number(val))
                                setVal("")
                                setIsOpen(false)
                            }}
                        >
                            Uygula
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
        )
    }

    // Column Header Component with Bulk Edit Support
    const SortableHeader = ({ label, columnKey, bulkOptions, bulkLabels, isResizable = false, isMultiSelect = false, isNumeric = false, stickyClass = "" }: { label: string, columnKey: keyof Food, bulkOptions?: string[], bulkLabels?: Record<string, string>, isResizable?: boolean, isMultiSelect?: boolean, isNumeric?: boolean, stickyClass?: string }) => {
        const isBulkMode = selectedIds.size > 0 && (bulkOptions && bulkOptions.length > 0 || isNumeric)
        const isSeasonNumeric = isBulkMode && columnKey === 'season_start'
        const isBulkNumber = isBulkMode && isNumeric
        const w = colWidths[columnKey as string] || 80

        return (
            <TableHead className={`h-8 p-1 relative group bg-gray-100 ${stickyClass}`} style={isResizable ? { width: w, minWidth: w, maxWidth: w } : {}}>
                {isSeasonNumeric ? (
                    <BulkSeasonHeader
                        label={label}
                        onApply={(start, end) => handleBulkUpdate('season_complex', `${start}-${end}`)}
                    />
                ) : isBulkNumber ? (
                    <BulkNumberHeader
                        label={label}
                        onApply={(val) => handleBulkUpdate(columnKey, val)}
                    />
                ) : isBulkMode && bulkOptions ? (
                    isMultiSelect ? (
                        <MultiSelectHeader
                            label={label}
                            options={bulkOptions!.map(opt => ({ value: opt, label: bulkLabels ? (bulkLabels[opt] || opt) : opt }))}
                            onApply={(vals) => {
                                if (columnKey === 'meal_types') handleBulkUpdate('meal_types', vals)
                                else if (columnKey === 'filler_lunch') handleBulkUpdate('filler_complex', vals)
                                else if (columnKey === 'keto') handleBulkUpdate('diet_complex', vals)
                            }}
                        />
                    ) : (
                        <div className="flex items-center gap-1">
                            <select
                                className="h-6 text-[10px] w-full bg-blue-50 border border-blue-200 text-blue-800 font-bold rounded focus:ring-1 focus:ring-blue-500"
                                onChange={(e) => {
                                    // Special handling for complex keys
                                    if (columnKey === 'season_start') handleBulkUpdate('season_complex', e.target.value)
                                    else handleBulkUpdate(columnKey, e.target.value)

                                    e.target.value = "" // Reset select
                                }}
                                defaultValue=""
                            >
                                <option value="" disabled>{label} (Seç)</option>
                                {bulkOptions.map(opt => (
                                    <option key={opt} value={opt}>{bulkLabels ? (bulkLabels[opt] || opt) : opt}</option>
                                ))}
                            </select>
                        </div>
                    )) : (
                    <button
                        onClick={() => requestSort(columnKey)}
                        className="flex items-center font-bold hover:text-green-600 transition-colors whitespace-nowrap w-full"
                    >
                        {label} {getSortIcon(columnKey)}
                    </button>
                )}
                {isResizable && (
                    <div
                        className="absolute right-0 top-0 w-1 h-full cursor-col-resize hover:bg-blue-400 group-hover:bg-blue-200"
                        onMouseDown={(e) => startResizing(e, columnKey as string)}
                    />
                )}
            </TableHead>
        )
    }



    // Generic Update Handler
    const handleInlineUpdate = async (id: string, field: keyof Food, value: any) => {
        // Optimistic Update
        setFoods(current => current.map(f => f.id === id ? { ...f, [field]: value } : f))

        const { error } = await supabase.from('foods').update({ [field]: value }).eq('id', id)
        if (error) {
            console.error(`Error updating ${field}`, error)
            alert("Güncelleme hatası")
            throw error // Bubble up to component to revert
        }
    }

    const { roleLabels, roleKeys } = useMemo(() => {
        const labs: Record<string, string> = {}
        const keys: string[] = []
        roles.forEach(r => {
            labs[r.value] = r.label
            keys.push(r.value)
        })
        // Merge with static global if needed, but dynamic is better
        return { roleLabels: { ...ROLE_LABELS, ...labs }, roleKeys: keys }
    }, [roles])

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-lg border shadow-md overflow-hidden relative flex flex-col">
                {/* Compact Sticky Header (Search & Actions) */}
                <div className="p-2 border-b bg-gray-50 flex flex-wrap gap-2 items-center justify-between sticky top-0 z-30 shadow-sm">
                    <div className="flex flex-wrap gap-2 items-center flex-1">
                        {/* Search & Scope */}
                        <div className="flex items-center gap-0">
                            <select
                                className="h-7 text-[10px] w-auto max-w-[80px] border rounded-l px-1 bg-white focus:outline-none focus:ring-1 focus:ring-green-500 border-r-0 rounded-r-none"
                                value={searchScope}
                                onChange={(e) => setSearchScope(e.target.value)}
                            >
                                <option value="all">Tümü</option>
                                <option value="name">İsim</option>
                                <option value="tags">Etiket</option>
                                <option value="compatibility">Uyum</option>
                            </select>
                            <div className="relative w-32 sm:w-48">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                                <Input
                                    className="pl-7 h-7 text-xs bg-white border-gray-300 focus-visible:ring-green-500 w-full rounded-l-none rounded-r"
                                    placeholder="Ara..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Filter Group 1 */}
                        <div className="flex gap-0.5 items-center bg-white p-0.5 rounded border border-gray-200">
                            <span className="text-[8px] uppercase font-bold text-gray-400 px-1 select-none">F1</span>
                            <select
                                className="h-7 border rounded px-1 w-20 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                                value={filterColumn}
                                onChange={(e) => {
                                    setFilterColumn(e.target.value)
                                    setFilterValue('all')
                                }}
                            >
                                <option value="all">Filtre...</option>
                                <option value="role">Rol</option>
                                <option value="category">Kategori</option>
                                <option value="meal_types">Öğün</option>
                                <option value="tags">Etiket</option>
                                <option value="season_start">Sezon</option>
                            </select>
                            <select
                                className="h-7 border rounded px-1 w-20 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-50"
                                value={filterValue}
                                onChange={(e) => setFilterValue(e.target.value)}
                                disabled={filterColumn === 'all'}
                            >
                                <option value="all">Tümü</option>
                                {filterColumn === 'role' ? (
                                    roles.map(r => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))
                                ) : filterColumn === 'category' ? (
                                    categories.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))
                                ) : (
                                    uniqueFilterValues.map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))
                                )}
                            </select>
                        </div>

                        {/* Filter Group 2 */}
                        <div className="flex gap-0.5 items-center bg-white p-0.5 rounded border border-gray-200">
                            <span className="text-[8px] uppercase font-bold text-gray-400 px-1 select-none">F2</span>
                            <select
                                className="h-7 border rounded px-1 w-20 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                                value={filterColumn2}
                                onChange={(e) => {
                                    setFilterColumn2(e.target.value)
                                    setFilterValue2('all')
                                }}
                            >
                                <option value="all">Filtre...</option>
                                <option value="role">Rol</option>
                                <option value="category">Kategori</option>
                                <option value="meal_types">Öğün</option>
                                <option value="tags">Etiket</option>
                                <option value="season_start">Sezon</option>
                            </select>
                            <select
                                className="h-7 border rounded px-1 w-20 text-[10px] bg-white focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-50"
                                value={filterValue2}
                                onChange={(e) => setFilterValue2(e.target.value)}
                                disabled={filterColumn2 === 'all'}
                            >
                                <option value="all">Tümü</option>
                                {filterColumn2 === 'role' ? (
                                    roles.map(r => (
                                        <option key={r.value} value={r.value}>{r.label}</option>
                                    ))
                                ) : filterColumn2 === 'category' ? (
                                    categories.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))
                                ) : (
                                    uniqueFilterValues2.map(v => (
                                        <option key={v} value={v}>{v}</option>
                                    ))
                                )}
                            </select>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className={`h-7 text-xs px-2 ${showHidden ? 'bg-orange-50' : ''}`}
                            onClick={() => setShowHidden(!showHidden)}
                            title={showHidden ? "Gizlenenleri Sakla" : "Gizlenenleri Göster"}
                        >
                            {showHidden ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
                            {showHidden ? "Gizlileri Sakla" : "Gizlileri Göster"}
                            {!showHidden && foods.filter(f => f.hidden_from_cardmaker).length > 0 && (
                                <span className="ml-1 bg-gray-200 px-1 rounded text-[10px]">
                                    {foods.filter(f => f.hidden_from_cardmaker).length}
                                </span>
                            )}
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => {
                                setEditingFood({} as any)
                                setIsDialogOpen(true)
                            }}
                            className="bg-gradient-to-r from-green-600 to-teal-600 text-white h-7 text-xs px-3"
                        >
                            <Plus className="mr-1 h-3 w-3" /> Ekle
                        </Button>
                    </div>
                </div>

                <div className="overflow-auto max-h-[80vh]">
                    <table className="w-full caption-bottom text-sm">
                        <TableHeader className="bg-gray-100 text-xs font-bold sticky top-0 z-10 shadow-sm">
                            <TableRow>
                                <TableHead className="w-8 p-2 sticky left-0 z-20 bg-gray-100 shadow-[1px_0_0_#e5e7eb]">
                                    <div
                                        className="cursor-pointer hover:text-gray-700"
                                        onClick={toggleSelectAll}
                                        title={selectedIds.size === filteredAndSortedFoods.length ? "Tümünü Kaldır" : "Tümünü Seç"}
                                    >
                                        {filteredAndSortedFoods.length > 0 && selectedIds.size === filteredAndSortedFoods.length
                                            ? <CheckSquare className="h-4 w-4 text-blue-600" />
                                            : <Square className="h-4 w-4 text-gray-400" />
                                        }
                                    </div>
                                </TableHead>
                                <TableHead className="w-8 p-2 text-center sticky left-[32px] z-20 bg-gray-100 shadow-[1px_0_0_#e5e7eb]">#</TableHead>
                                <TableHead className="w-10 p-1 text-center bg-gray-100" title="Tarif Kartı">
                                    <ImageIcon className="h-3.5 w-3.5 mx-auto text-gray-500" />
                                </TableHead>
                                <SortableHeader label="Yemek Adı" columnKey="name" isResizable={true} stickyClass="sticky left-[64px] z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]" />
                                <SortableHeader label="Kategori" columnKey="category" bulkOptions={categories} isResizable={true} />
                                <SortableHeader label="Rol" columnKey="role" bulkOptions={roleKeys} bulkLabels={roleLabels} isResizable={true} />
                                <SortableHeader label="Kal" columnKey="calories" />
                                <SortableHeader label="P" columnKey="protein" />
                                <SortableHeader label="K" columnKey="carbs" />
                                <SortableHeader label="Y" columnKey="fat" />
                                <SortableHeader label="Skor" columnKey="priority_score" bulkOptions={['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']} />
                                <SortableHeader label="Por.Min" columnKey="min_quantity" isNumeric={true} />
                                <SortableHeader label="Por.Mak" columnKey="max_quantity" isNumeric={true} />
                                <SortableHeader label="Adım" columnKey="step" isNumeric={true} />
                                <SortableHeader label="Haf.Min" columnKey="min_weekly_freq" isNumeric={true} />
                                <SortableHeader label="Haf.Mak" columnKey="max_weekly_freq" isNumeric={true} />
                                <SortableHeader label="Sezon" columnKey="season_start" bulkOptions={seasonOptions.map(o => o.value)} bulkLabels={seasonOptions.reduce((acc, o) => ({ ...acc, [o.value]: o.label }), {})} />
                                <SortableHeader label="Diyet" columnKey="keto" isMultiSelect={true} bulkOptions={dietOptions.map(o => o.value)} bulkLabels={dietOptions.reduce((acc, o) => ({ ...acc, [o.value]: o.label }), {})} />
                                <SortableHeader label="Öğün" columnKey="meal_types" isMultiSelect={true} bulkOptions={mealOptions.map(o => o.value)} bulkLabels={mealOptions.reduce((acc, o) => ({ ...acc, [o.value]: o.label }), {})} />
                                <SortableHeader label="Dolgu" columnKey="filler_lunch" isMultiSelect={true} bulkOptions={fillerOptions.map(o => o.value)} bulkLabels={fillerOptions.reduce((acc, o) => ({ ...acc, [o.value]: o.label }), {})} />
                                <SortableHeader label="Etiketler" columnKey="tags" isResizable={true} />
                                <SortableHeader label="Uyumluluk" columnKey="compatibility_tags" isResizable={true} />
                                <TableHead className="w-10 p-1 text-center bg-gray-100" title="Kart Yapıcı Görünürlüğü">
                                    <Eye className="h-3.5 w-3.5 mx-auto text-gray-500" />
                                </TableHead>
                                <TableHead className="text-right p-2 bg-gray-100">İşlemler</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={20} className="h-24 text-center">
                                        <div className="flex justify-center items-center gap-2 text-muted-foreground">
                                            <Loader2 className="h-5 w-5 animate-spin" /> Yükleniyor...
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filteredAndSortedFoods.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={20} className="h-24 text-center text-muted-foreground">
                                        Sonuç bulunamadı.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredAndSortedFoods.map((food, index) => (
                                    <TableRow key={food.id} className={`transition-colors hover:bg-gray-100 ${selectedIds.has(food.id) ? 'bg-blue-50' : 'odd:bg-white even:bg-slate-50'}`}>
                                        <TableCell className="p-2 w-8 sticky left-0 z-10 bg-inherit shadow-[1px_0_0_#e5e7eb]">
                                            <div
                                                className="cursor-pointer"
                                                onClick={() => toggleSelection(food.id, false)}
                                            >
                                                {selectedIds.has(food.id)
                                                    ? <CheckSquare className="h-4 w-4 text-blue-600" />
                                                    : <Square className="h-4 w-4 text-gray-300 hover:text-gray-500" />
                                                }
                                            </div>
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-400 font-mono w-8 sticky left-[32px] z-10 bg-inherit shadow-[1px_0_0_#e5e7eb]">{index + 1}</TableCell>
                                        <TableCell className="p-1 min-w-10 w-fit text-center">
                                            {(() => {
                                                const urls = getCardUrls(food.name)
                                                if (urls.length === 0) return <span className="text-gray-200">—</span>
                                                return (
                                                    <div className="flex flex-row gap-1 items-center justify-center flex-wrap max-w-[80px]">
                                                        {urls.map((url, i) => (
                                                            <button
                                                                key={i}
                                                                onClick={(e) => { e.stopPropagation(); setImagePreview(url) }}
                                                                className="inline-block rounded overflow-hidden border border-green-300 hover:border-green-500 hover:shadow-md transition-all shrink-0"
                                                                title={`Tarif kartını görüntüle (${i+1})`}
                                                            >
                                                                <img src={url} alt="kart" className="w-6 h-6 object-cover" loading="lazy" />
                                                            </button>
                                                        ))}
                                                    </div>
                                                )
                                            })()}
                                        </TableCell>
                                        <TableCell
                                            className="p-2 text-xs font-semibold whitespace-normal leading-tight text-gray-900 sticky left-[64px] z-10 bg-inherit shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                                            style={{ width: colWidths['name'] || 200, minWidth: colWidths['name'] || 200, maxWidth: colWidths['name'] || 200 }}
                                        >
                                            <InlineCell
                                                initialValue={food.name}
                                                onSave={(val) => handleInlineUpdate(food.id, 'name', val)}
                                            />
                                        </TableCell>
                                        <TableCell className="p-2">
                                            <InlineSelect
                                                initialValue={food.category || ''}
                                                options={categories}
                                                onSave={(val) => handleInlineUpdate(food.id, 'category', val)}
                                                classes="bg-blue-50 text-blue-700 text-[10px] rounded-full px-2"
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineSelect
                                                initialValue={food.role || ''}
                                                options={roleKeys}
                                                labels={roleLabels}
                                                onSave={(val) => handleInlineUpdate(food.id, 'role', val)}
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.calories} onSave={(val) => handleInlineUpdate(food.id, 'calories', val)} classes="w-12" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.protein} onSave={(val) => handleInlineUpdate(food.id, 'protein', val)} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.carbs} onSave={(val) => handleInlineUpdate(food.id, 'carbs', val)} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.fat} onSave={(val) => handleInlineUpdate(food.id, 'fat', val)} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-center">
                                            <InlineCell
                                                type="number"
                                                initialValue={food.priority_score ?? 5}
                                                onSave={(val) => handleInlineUpdate(food.id, 'priority_score', Number(val))}
                                                classes={`w-8 text-center font-bold ${(food.priority_score ?? 5) === 0 ? 'text-red-600' :
                                                    (food.priority_score ?? 5) <= 3 ? 'text-orange-500' :
                                                        (food.priority_score ?? 5) >= 8 ? 'text-green-600' :
                                                            'text-slate-700'
                                                    }`}
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.min_quantity ?? ''} onSave={(val) => handleInlineUpdate(food.id, 'min_quantity', val === '' ? null : Number(val))} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.max_quantity ?? ''} onSave={(val) => handleInlineUpdate(food.id, 'max_quantity', val === '' ? null : Number(val))} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.step ?? ''} onSave={(val) => handleInlineUpdate(food.id, 'step', val === '' ? null : Number(val))} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.min_weekly_freq ?? ''} onSave={(val) => handleInlineUpdate(food.id, 'min_weekly_freq', val === '' ? null : Number(val))} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-600">
                                            <InlineCell type="number" initialValue={food.max_weekly_freq ?? ''} onSave={(val) => handleInlineUpdate(food.id, 'max_weekly_freq', val === '' ? null : Number(val))} classes="w-10" />
                                        </TableCell>
                                        <TableCell className="p-2 text-xs text-gray-500 whitespace-nowrap">
                                            <InlineSeasonEdit
                                                start={food.season_start || null}
                                                end={food.season_end || null}
                                                onSave={async (s, e) => {
                                                    const { error } = await supabase.from('foods').update({ season_start: s, season_end: e }).eq('id', food.id)
                                                    if (error) throw error
                                                    setFoods(curr => curr.map(f => f.id === food.id ? { ...f, season_start: s, season_end: e } : f))
                                                }}
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-[10px]">
                                            <InlineMultiSelect
                                                initialValues={dietOptions.filter(o => (food as any)[o.value]).map(o => o.value)}
                                                options={dietOptions}
                                                onSave={async (vals: string[]) => {
                                                    const updates: Record<string, boolean> = {}
                                                    dietOptions.forEach(o => updates[o.value] = vals.includes(o.value))
                                                    const { error } = await supabase.from('foods').update(updates).eq('id', food.id)
                                                    if (error) throw error
                                                    setFoods(c => c.map(f => f.id === food.id ? { ...f, ...updates } : f))
                                                }}
                                                renderLabel={(vals) => (
                                                    <div className="flex gap-0.5 flex-wrap max-w-[80px]">
                                                        {vals.includes('elimination_diet') && <span className="text-purple-600 bg-purple-50 px-1 rounded" title="Eliminasyonlu Ketojenik">EK</span>}
                                                        {vals.includes('keto') && <span className="text-pink-600 bg-pink-50 px-1 rounded" title="Keto">K</span>}
                                                        {vals.includes('vegan') && <span className="text-green-600 bg-green-50 px-1 rounded" title="Vegan">V</span>}
                                                        {vals.includes('lowcarb') && <span className="text-blue-600 bg-blue-50 px-1 rounded" title="Low Carb">LC</span>}
                                                        {vals.includes('vejeteryan') && <span className="text-emerald-600 bg-emerald-50 px-1 rounded" title="Vejeteryan">VJ</span>}
                                                        {vals.length === 0 && <span className="text-gray-300 italic">-</span>}
                                                    </div>
                                                )}
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-[10px]">
                                            <InlineMultiSelect
                                                initialValues={food.meal_types || []}
                                                options={mealOptions}
                                                onSave={async (vals: string[]) => {
                                                    const { error } = await supabase.from('foods').update({ meal_types: vals }).eq('id', food.id)
                                                    if (error) throw error
                                                    setFoods(c => c.map(f => f.id === food.id ? { ...f, meal_types: vals } : f))
                                                }}
                                                renderLabel={(vals) => (
                                                    <div className="flex gap-0.5 flex-wrap max-w-[80px]">
                                                        {vals.includes('breakfast') && <span className="bg-yellow-100 text-yellow-700 px-1 rounded border border-yellow-200" title="Kahvaltı">K</span>}
                                                        {vals.includes('lunch') && <span className="bg-orange-100 text-orange-700 px-1 rounded border border-orange-200" title="Öğle">Ö</span>}
                                                        {vals.includes('dinner') && <span className="bg-blue-100 text-blue-700 px-1 rounded border border-blue-200" title="Akşam">A</span>}
                                                        {vals.includes('snack') && <span className="bg-purple-100 text-purple-700 px-1 rounded border border-purple-200" title="Ara Öğün">AÖ</span>}
                                                        {vals.includes('supplement') && <span className="bg-gray-100 text-gray-700 px-1 rounded border border-gray-200" title="Takviye">TK</span>}
                                                    </div>
                                                )}
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-[10px]">
                                            <InlineMultiSelect
                                                initialValues={[...(food.filler_lunch ? ['filler_lunch'] : []), ...(food.filler_dinner ? ['filler_dinner'] : [])]}
                                                options={fillerOptions}
                                                onSave={async (vals: string[]) => {
                                                    const updates = {
                                                        filler_lunch: vals.includes('filler_lunch'),
                                                        filler_dinner: vals.includes('filler_dinner')
                                                    }
                                                    const { error } = await supabase.from('foods').update(updates).eq('id', food.id)
                                                    if (error) throw error
                                                    setFoods(c => c.map(f => f.id === food.id ? { ...f, ...updates } : f))
                                                }}
                                                renderLabel={(vals) => (
                                                    <div className="flex gap-0.5 flex-col">
                                                        {vals.includes('filler_lunch') && <span className="text-orange-600 whitespace-nowrap">Ö. Dolgu</span>}
                                                        {vals.includes('filler_dinner') && <span className="text-blue-600 whitespace-nowrap">A. Dolgu</span>}
                                                        {vals.length === 0 && <span className="text-gray-300 italic">-</span>}
                                                    </div>
                                                )}
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-[10px]">
                                            <InlineCell
                                                initialValue={(food.tags || []).join(', ')}
                                                onSave={async (val) => {
                                                    const tags = String(val).split(',').map(t => t.trim()).filter(Boolean)
                                                    const { error } = await supabase.from('foods').update({ tags }).eq('id', food.id)
                                                    if (error) throw error
                                                    setFoods(c => c.map(f => f.id === food.id ? { ...f, tags } : f))
                                                }}
                                                classes="w-24"
                                            />
                                        </TableCell>
                                        <TableCell className="p-2 text-[10px]">
                                            <InlineCell
                                                initialValue={(food.compatibility_tags || []).join(', ')}
                                                onSave={async (val) => {
                                                    const tags = String(val).split(',').map(t => t.trim()).filter(Boolean)
                                                    const { error } = await supabase.from('foods').update({ compatibility_tags: tags }).eq('id', food.id)
                                                    if (error) throw error
                                                    setFoods(c => c.map(f => f.id === food.id ? { ...f, compatibility_tags: tags } : f))
                                                }}
                                                classes="w-24"
                                            />
                                        </TableCell>
                                        <TableCell className="p-1 text-center">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={`h-6 w-6 ${food.hidden_from_cardmaker ? 'text-orange-500' : 'text-gray-400 hover:text-green-500'}`}
                                                onClick={async () => {
                                                    const newVal = !food.hidden_from_cardmaker;
                                                    const { error } = await supabase.from('foods').update({ hidden_from_cardmaker: newVal }).eq('id', food.id);
                                                    if (!error) {
                                                        setFoods(curr => curr.map(f => f.id === food.id ? { ...f, hidden_from_cardmaker: newVal } : f));
                                                    }
                                                }}
                                                title={food.hidden_from_cardmaker ? "Kart yapıcıda gizli" : "Kart yapıcıda görünür"}
                                            >
                                                {food.hidden_from_cardmaker ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                            </Button>
                                        </TableCell>

                                        <TableCell className="text-right p-1">
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setEditingFood(food)
                                                        setIsDialogOpen(true)
                                                    }}
                                                    className="h-6 w-6 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                >
                                                    <Pencil className="h-3 w-3" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setDeleteId(food.id)}
                                                    className="h-6 w-6 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </table>
                </div>
                <div className="p-4 border-t bg-gray-50 text-xs text-gray-500 flex justify-between items-center">
                    <span>Toplam {filteredAndSortedFoods.length} kayıt gösteriliyor.</span>
                    {selectedIds.size > 0 && (
                        <span className="font-semibold text-blue-600">{selectedIds.size} kayıt seçili.</span>
                    )}
                </div>

                {isDialogOpen && editingFood && (
                    <FoodEditDialog
                        isOpen={isDialogOpen}
                        onClose={() => setIsDialogOpen(false)}
                        food={editingFood}
                        mode={editingFood.id ? 'edit' : 'create'}
                        onUpdate={loadFoods}
                    />
                )}

                {/* Delete Confirmation Dialog */}
                <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Yemeği Sil</DialogTitle>
                            <DialogDescription>
                                Bu yemeği veritabanından silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDeleteId(null)}>İptal</Button>
                            <Button
                                variant="destructive"
                                onClick={handleDelete}
                                disabled={isDeleting}
                            >
                                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Sil"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Fullscreen Image Preview Overlay */}
            {imagePreview && (
                <div
                    className="fixed inset-0 bg-black/80 z-[200] flex items-center justify-center p-8 cursor-pointer"
                    onClick={() => setImagePreview(null)}
                >
                    <div className="relative max-w-2xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setImagePreview(null)}
                            className="absolute -top-3 -right-3 bg-white rounded-full w-8 h-8 flex items-center justify-center shadow-lg text-gray-600 hover:text-gray-900 z-10"
                        >✕</button>
                        <img
                            src={imagePreview}
                            alt="Tarif Kartı"
                            className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain"
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
