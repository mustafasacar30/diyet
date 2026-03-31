"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Loader2 } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { supabase } from "@/lib/supabase"
import { FOOD_CATEGORIES } from "@/lib/constants/food-categories"
import { FOOD_ROLES } from "@/lib/constants/food-roles"

// Define schema matching the DB
// Define schema matching the DB
const foodSchema = z.object({
    name: z.string().min(2, "Yemek adı en az 2 karakter olmalıdır"),
    category: z.string().default(""),
    role: z.string().default("mainDish"),
    calories: z.coerce.number().min(0, "Negatif olamaz"),
    protein: z.coerce.number().min(0, "Negatif olamaz"),
    carbs: z.coerce.number().min(0, "Negatif olamaz"),
    fat: z.coerce.number().min(0, "Negatif olamaz"),
    portion_unit: z.string().default("porsiyon"),
    standard_amount: z.coerce.number().default(1),
    tags: z.string().default(""), // We'll parse comma separated string to array
})

export type FoodFormValues = z.infer<typeof foodSchema>

export interface Food {
    id: string
    name: string
    category: string | null
    role: string | null
    calories: number
    protein: number
    carbs: number
    fat: number
    portion_unit: string | null
    standard_amount: number | null
    tags: string[] | null
    created_at?: string
    // Expanded fields
    keto?: boolean
    vegan?: boolean
    vejeteryan?: boolean
    lowcarb?: boolean
    season_start?: number
    season_end?: number
    compatibility_tags?: string[]
    notes?: string
    min_quantity?: number
    max_quantity?: number
    step?: number
    multiplier?: number
    portion_fixed?: boolean
    meal_types?: string[]
    filler_lunch?: boolean
    filler_dinner?: boolean
    elimination_diet?: boolean // New field
    priority_score?: number
    max_weekly_freq?: number
    min_weekly_freq?: number
    hidden_from_cardmaker?: boolean
}

interface FoodDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialData: Food | null
    onSave: (values: FoodFormValues) => Promise<void>
}

export function FoodDialog({ open, onOpenChange, initialData, onSave }: FoodDialogProps) {
    const [loading, setLoading] = useState(false)
    const [categories, setCategories] = useState<string[]>([...FOOD_CATEGORIES])
    const [roles, setRoles] = useState<{ value: string, label: string }[]>([...FOOD_ROLES])

    useEffect(() => {
        if (open) {
            loadOptions()
        }
    }, [open])

    const loadOptions = async () => {
        try {
            const { data: settingsData } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'food_management_options')
                .single()

            if (settingsData?.value) {
                if (settingsData.value.categories && Array.isArray(settingsData.value.categories)) {
                    const dynamicCats = settingsData.value.categories.filter((c: any) => typeof c === 'string');
                    const allCats = [...FOOD_CATEGORIES, ...dynamicCats];
                    const seen = new Set();
                    const merged = allCats.filter(c => {
                        const low = c.toLowerCase().trim();
                        if (seen.has(low)) return false;
                        seen.add(low);
                        return true;
                    });
                    setCategories(merged);
                }
                if (settingsData.value.roles && Array.isArray(settingsData.value.roles)) {
                    const dbRoles = settingsData.value.roles.map((r: any) =>
                        typeof r === 'string' ? { value: r, label: r } : r
                    ).filter((r: any) => r && r.value && r.label);

                    const existingValues = new Set(FOOD_ROLES.map(r => r.value.toLowerCase()));
                    const newRoles = dbRoles.filter((r: any) => !existingValues.has(r.value.toLowerCase()));

                    setRoles([...FOOD_ROLES, ...newRoles]);
                }
            }
        } catch (e) { }
    }

    const form = useForm<any>({
        resolver: zodResolver(foodSchema),
        defaultValues: {
            name: "",
            category: "",
            role: "mainDish",
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            portion_unit: "porsiyon",
            standard_amount: 1,
            tags: "",
        },
    })

    // Reset form when dialog opens or initialData changes
    useEffect(() => {
        if (open) {
            if (initialData) {
                form.reset({
                    name: initialData.name,
                    category: initialData.category || "",
                    role: initialData.role || "mainDish",
                    calories: initialData.calories,
                    protein: initialData.protein,
                    carbs: initialData.carbs,
                    fat: initialData.fat,
                    portion_unit: initialData.portion_unit || "porsiyon",
                    standard_amount: initialData.standard_amount || 1,
                    tags: initialData.tags ? initialData.tags.join(", ") : "",
                })
            } else {
                form.reset({
                    name: "",
                    category: "",
                    role: "mainDish",
                    calories: 0,
                    protein: 0,
                    carbs: 0,
                    fat: 0,
                    portion_unit: "porsiyon",
                    standard_amount: 1,
                    tags: "",
                })
            }
        }
    }, [open, initialData, form])

    const onSubmit = async (values: FoodFormValues) => {
        setLoading(true)
        try {
            await onSave(values)
            onOpenChange(false)
        } catch (error) {
            console.error("Save error:", error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{initialData ? "Yemeği Düzenle" : "Yeni Yemek Ekle"}</DialogTitle>
                    <DialogDescription>
                        {initialData
                            ? "Yemek veya besin değerlerini güncelleyin."
                            : "Veritabanına yeni bir yemek ekleyin."}
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <FormField
                                control={form.control as any}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="md:col-span-1">
                                        <FormLabel>Yemek Adı</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Örn: Izgara Tavuk" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control as any}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Kategori</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Kategori seçin" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {categories.map((cat) => (
                                                    <SelectItem key={cat} value={cat}>
                                                        {cat}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control as any}
                                name="role"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Yemek Rolü</FormLabel>
                                        <Select key={`role-select-${roles.length}`} onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Rol seçin" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {roles.map((r) => (
                                                    <SelectItem key={r.value} value={r.value}>
                                                        {r.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <FormField
                                control={form.control as any}
                                name="calories"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Kalori (kcal)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.1" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="protein"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Protein (g)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.1" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="carbs"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Karbonhidrat (g)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.1" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control as any}
                                name="fat"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Yağ (g)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.1" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control as any}
                                name="portion_unit"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Porsiyon Birimi</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Örn: Adet, Tabak, Dilim" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control as any}
                                name="standard_amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Standart Miktar</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.1" {...field} />
                                        </FormControl>
                                        <FormDescription>1 porsiyonun karşılık geldiği miktar</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control as any}
                            name="tags"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Etiketler</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Örn: sağlıklı, diyabet, glutensiz (virgülle ayırın)" {...field} />
                                    </FormControl>
                                    <FormDescription>Arama ve filtreleme için etiketler</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <DialogFooter className="mt-6">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                İptal
                            </Button>
                            <Button type="submit" disabled={loading} className="bg-gradient-to-r from-green-600 to-teal-600">
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {initialData ? "Güncelle" : "Ekle"}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
