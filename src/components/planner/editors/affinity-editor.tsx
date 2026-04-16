"use client"

import { useEffect, useState } from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { AffinityDefinition, RuleTarget, TargetType } from "@/types/planner"

interface AffinityEditorProps {
    value: AffinityDefinition
    onChange: (val: AffinityDefinition) => void
    categories?: string[]
    roles?: string[]
}

export function AffinityEditor({ value, onChange, categories = [], roles = [] }: AffinityEditorProps) {
    const handleChange = (field: keyof AffinityDefinition, val: any) => {
        onChange({ ...value, [field]: val })
    }

    const handleTriggerChange = (field: keyof RuleTarget, val: any) => {
        onChange({ ...value, trigger: { ...value.trigger, [field]: val } })
    }

    const handleOutcomeChange = (field: keyof RuleTarget, val: any) => {
        onChange({ ...value, outcome: { ...value.outcome, [field]: val } })
    }

    const probability = value.probability ?? 50

    const getSliderLabel = (p: number) => {
        if (p <= 0) return "YASAKLA"
        if (p <= 15) return "Cok Dusuk"
        if (p <= 35) return "Azalt"
        if (p <= 45) return "Biraz Azalt"
        if (p <= 55) return "Notr"
        if (p <= 65) return "Biraz Tercih Et"
        if (p <= 85) return "Tercih Et"
        if (p <= 95) return "Guclu Tercih"
        return "ZORUNLU"
    }

    const getSliderColor = (p: number) => {
        if (p <= 15) return "text-red-600 font-bold"
        if (p <= 45) return "text-orange-500"
        if (p <= 55) return "text-gray-500"
        if (p <= 85) return "text-blue-500"
        return "text-green-600 font-bold"
    }

    const handleSliderChange = (vals: number[]) => {
        const newProb = vals[0]
        const { association, ...rest } = value as any
        onChange({ ...rest, probability: newProb })
    }

    return (
        <div className="space-y-6 rounded-md border bg-purple-50/50 p-4">
            <h4 className="border-b pb-2 text-sm font-semibold text-purple-700">Bagimlilik (Affinity) Iliskisi</h4>

            <div className="relative grid grid-cols-1 gap-8 md:grid-cols-2">
                <div className="space-y-3">
                    <Label className="font-bold text-purple-900">1. Tetikleyici (Eger bu varsa...)</Label>
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Tip</Label>
                        <Select value={value.trigger.type} onValueChange={(v) => handleTriggerChange("type", v)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="tag">Etiket (Tag)</SelectItem>
                                <SelectItem value="category">Kategori</SelectItem>
                                <SelectItem value="role">Rol</SelectItem>
                                <SelectItem value="food_id">Spesifik Yemek</SelectItem>
                                <SelectItem value="name_contains">Isim Icerir</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <ValueSelector
                        type={value.trigger.type}
                        value={value.trigger.value}
                        onChange={(v) => handleTriggerChange("value", v)}
                        categories={categories}
                        roles={roles}
                    />
                </div>

                <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:block">
                    <span className="text-2xl">-&gt;</span>
                </div>

                <div className="space-y-3">
                    <Label className="font-bold text-purple-900">2. Sonuc (Bunu da ekle/yasakla...)</Label>
                    <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Tip</Label>
                        <Select value={value.outcome.type} onValueChange={(v) => handleOutcomeChange("type", v)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="category">Kategori</SelectItem>
                                <SelectItem value="tag">Etiket (Tag)</SelectItem>
                                <SelectItem value="role">Rol</SelectItem>
                                <SelectItem value="food_id">Spesifik Yemek</SelectItem>
                                <SelectItem value="name_contains">Isim Icerir</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <ValueSelector
                        type={value.outcome.type}
                        value={value.outcome.value}
                        onChange={(v) => handleOutcomeChange("value", v)}
                        categories={categories}
                        roles={roles}
                    />
                </div>
            </div>

            <div className="border-t pt-4">
                <div className="mb-3 flex items-center justify-between">
                    <Label>
                        Birliktelik Orani: <span className="font-bold">%{probability}</span>
                    </Label>
                    <span className={cn("rounded border px-2 py-1 font-mono text-sm", getSliderColor(probability))}>
                        {getSliderLabel(probability)}
                    </span>
                </div>

                <div className="mb-1 flex justify-between px-1 text-[10px] text-muted-foreground">
                    <span className="font-semibold text-red-500">Yasakla</span>
                    <span>Notr</span>
                    <span className="font-semibold text-green-600">Zorunlu</span>
                </div>

                <Slider value={[probability]} max={100} step={5} className="flex-1" onValueChange={handleSliderChange} />

                <div className="mt-4 flex items-center gap-4">
                    <Label className="w-[180px] text-xs text-muted-foreground">Iliski Yonu</Label>
                    <Select value={value.direction || "two-way"} onValueChange={(v) => handleChange("direction", v)}>
                        <SelectTrigger className="flex-1">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="one-way">Tek Yonlu (1 -&gt; 2)</SelectItem>
                            <SelectItem value="two-way">Cift Yonlu (1 &lt;-&gt; 2)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <p className="mt-4 text-xs text-muted-foreground">
                    %0: ayni ogunde birlikte bulunmasin. %50: notr. %100: ayni ogunde birlikte bulunmasi guclu sekilde
                    onerilir.
                </p>
            </div>
        </div>
    )
}

function ValueSelector({
    type,
    value,
    onChange,
    categories = [],
    roles = [],
}: {
    type: TargetType | "name_contains"
    value: string
    onChange: (val: string) => void
    categories?: string[]
    roles?: string[]
}) {
    const [foods, setFoods] = useState<{ id: string; name: string }[]>([])
    const [loadingFoods, setLoadingFoods] = useState(false)
    const [openFoodSelect, setOpenFoodSelect] = useState(false)

    useEffect(() => {
        async function fetchFoods() {
            setLoadingFoods(true)
            try {
                const { data, error } = await supabase.from("foods").select("id, name").order("name", { ascending: true }).limit(3000)
                if (error) {
                    console.error("AffinityEditor foods load error:", error)
                    return
                }
                setFoods((data || []) as { id: string; name: string }[])
            } finally {
                setLoadingFoods(false)
            }
        }

        if (type === "food_id" && foods.length === 0 && !loadingFoods) {
            fetchFoods()
        }
    }, [type, foods.length, loadingFoods])

    if (type === "category") {
        return (
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger>
                    <SelectValue placeholder="Kategori secin" />
                </SelectTrigger>
                <SelectContent>
                    {categories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                            {cat}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        )
    }

    if (type === "role") {
        return (
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger>
                    <SelectValue placeholder="Rol secin" />
                </SelectTrigger>
                <SelectContent>
                    {roles.map((role) => (
                        <SelectItem key={role} value={role}>
                            {role}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        )
    }

    if (type === "food_id") {
        return (
            <Popover open={openFoodSelect} onOpenChange={setOpenFoodSelect}>
                <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" aria-expanded={openFoodSelect} className="w-full justify-between text-left font-normal">
                        {value ? foods.find((food) => food.id === value)?.name || "Bilinmeyen yemek (ID eslesmedi)" : "Yemek ara ve sec..."}
                        {loadingFoods ? (
                            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />
                        ) : (
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[380px] p-0" align="start">
                    <Command>
                        <CommandInput placeholder="Yemek ara..." />
                        <CommandList>
                            <CommandEmpty>Yemek bulunamadi.</CommandEmpty>
                            <CommandGroup>
                                {foods.map((food) => (
                                    <CommandItem
                                        key={food.id}
                                        value={`${food.name} ${food.id}`}
                                        onSelect={() => {
                                            onChange(food.id)
                                            setOpenFoodSelect(false)
                                        }}
                                    >
                                        <Check className={cn("mr-2 h-4 w-4", value === food.id ? "opacity-100" : "opacity-0")} />
                                        {food.name}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
                type === "tag"
                    ? "Etiket girin (orn: yumurta)"
                    : type === "name_contains"
                        ? "Isimde gecen kelime (orn: yumurta)"
                        : "Deger"
            }
        />
    )
}

