"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { supabase } from "@/lib/supabase"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { PlanningRule, RuleType, RuleDefinition } from "@/types/planner"
import { FrequencyEditor } from "./editors/frequency-editor"
import { AffinityEditor } from "./editors/affinity-editor"
import { ConsistencyEditor } from "./editors/consistency-editor"
import { FixedMealEditor } from "./editors/fixed-meal-editor"
import { WeekOverrideEditor } from "./editors/week-override-editor"
import { NutritionalEditor } from "./editors/nutritional-editor"
import { RotationEditor } from "./editors/rotation-editor"
import { OrGroupEditor } from "./editors/or-group-editor"
import { usePlannerMetadata } from "@/hooks/use-planner-metadata"

const ruleSchema = z.object({
    name: z.string().min(2, "Kural adı en az 2 karakter olmalıdır"),
    description: z.string().optional(),
    rule_type: z.enum(['frequency', 'affinity', 'consistency', 'preference', 'nutritional', 'fixed_meal', 'week_override', 'rotation', 'or_group']),
    priority: z.coerce.number().min(1).max(100),
    is_active: z.boolean().default(true),
})

type RuleFormValues = z.infer<typeof ruleSchema>

interface RuleDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialData: PlanningRule | null
    prefillData?: PlanningRule | null
    onSuccess: () => void
    patientId?: string // For patient-scoped rules
    programTemplateId?: string | null
    teamOwnerId?: string | null
}

export function RuleDialog({ open, onOpenChange, initialData, prefillData, onSuccess, patientId, programTemplateId, teamOwnerId }: RuleDialogProps) {
    const { categories, roles, loading: metadataLoading } = usePlannerMetadata()
    const [mealTypes, setMealTypes] = useState<string[]>([])
    const [definition, setDefinition] = useState<RuleDefinition | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        async function loadMealTypes() {
            const { data } = await supabase
                .from('app_settings')
                .select('value')
                .eq('key', 'food_management_options')
                .single()
            if (data?.value?.mealTypes) {
                setMealTypes(data.value.mealTypes)
            }
        }
        loadMealTypes()
    }, [])

    const form = useForm<RuleFormValues>({
        resolver: zodResolver(ruleSchema as any),
        defaultValues: {
            name: "",
            description: "",
            rule_type: "frequency",
            priority: 50,
            is_active: true,
        },
    })

    const watchedType = form.watch("rule_type") as RuleType
    const isEditingExistingRule = Boolean(initialData?.id)
    const effectivePrefillData = !isEditingExistingRule ? (prefillData || null) : null

    useEffect(() => {
        if (open) {
            if (initialData) {
                form.reset({
                    name: initialData.name,
                    description: initialData.description || "",
                    rule_type: initialData.rule_type,
                    priority: initialData.priority,
                    is_active: initialData.is_active,
                })
                setDefinition(initialData.definition)
            } else if (effectivePrefillData) {
                form.reset({
                    name: effectivePrefillData.name || "",
                    description: effectivePrefillData.description || "",
                    rule_type: effectivePrefillData.rule_type || "frequency",
                    priority: effectivePrefillData.priority ?? 50,
                    is_active: effectivePrefillData.is_active ?? true,
                })
                setDefinition(effectivePrefillData.definition || null)
            } else {
                form.reset({
                    name: "",
                    description: "",
                    rule_type: "frequency",
                    priority: 50,
                    is_active: true,
                })
                // Default definitions
                setDefinition({
                    type: 'frequency',
                    data: {
                        target: { type: 'category', value: '' },
                        period: 'daily',
                        min_count: 1,
                        max_count: 1
                    }
                })
            }
        }
    }, [open, initialData, effectivePrefillData, form])

    // Switch definition structure when type changes
    useEffect(() => {
        if (!open) return;

        // Only if definition type doesn't match new type (to prevent overwriting existing data on load)
        if (definition && definition.type !== watchedType) {
            if (watchedType === 'frequency') {
                setDefinition({
                    type: 'frequency',
                    data: { target: { type: 'category', value: '' }, period: 'daily', min_count: 1, max_count: 1 }
                })
            } else if (watchedType === 'affinity') {
                setDefinition({
                    type: 'affinity',
                    data: {
                        trigger: { type: 'tag', value: '' },
                        outcome: { type: 'category', value: '' },
                        association: 'boost',
                        probability: 50
                    }
                })
            } else if (watchedType === 'consistency') {
                setDefinition({
                    type: 'consistency',
                    data: { target: { type: 'category', value: '' }, lock_duration: 'weekly' }
                })
            } else if (watchedType === 'fixed_meal') {
                setDefinition({
                    type: 'fixed_meal',
                    data: { target_slot: 'KAHVALTI', foods: [], selection_mode: 'all' }
                })
            } else if (watchedType === 'week_override') {
                setDefinition({
                    type: 'week_override',
                    data: { week_start: 1, week_end: 1, diet_type_id: '' }
                })
            } else if (watchedType === 'nutritional') {
                setDefinition({
                    type: 'nutritional',
                    data: {
                        condition: { macro: 'protein', operator: '<', value: 10 },
                        action: { type: 'add', target: { type: 'food_id', value: '' } },
                        target_slot: 'AKŞAM'
                    }
                })
            } else if (watchedType === 'rotation') {
                setDefinition({
                    type: 'rotation',
                    data: {
                        target: { type: 'role', value: '' },
                        mode: 'sequential',
                        items: [],
                        non_consecutive: true
                    }
                })
            } else if (watchedType === 'or_group') {
                setDefinition({
                    type: 'or_group',
                    data: {
                        mode: 'weekly_rotation',
                        options: [
                            { target: { type: 'category', value: '' }, period: 'weekly', min_count: 1 }
                        ]
                    }
                })
            }
        }
    }, [watchedType, open])

    const onSubmit = async (values: RuleFormValues) => {
        if (!definition) return;

        setLoading(true)
        try {
            const editingRuleId = initialData?.id || null
            const resolvedScope: 'global' | 'team' | 'program' | 'patient' =
                patientId ? 'patient'
                    : programTemplateId ? 'program'
                        : teamOwnerId ? 'team'
                            : 'global'

            const ruleData = {
                ...values,
                definition: definition,
                // Add scoped identifiers only on insert
                ...(!isEditingExistingRule ? {
                    scope: resolvedScope,
                    patient_id: resolvedScope === 'patient' ? patientId : null,
                    program_template_id: resolvedScope === 'program' ? programTemplateId : null,
                    team_owner_id: (resolvedScope === 'team' || resolvedScope === 'program' || resolvedScope === 'patient')
                        ? (teamOwnerId || null)
                        : null,
                    source_rule_id: effectivePrefillData
                        ? (effectivePrefillData.source_rule_id || effectivePrefillData.id || null)
                        : null,
                    pending_global_approval: false,
                } : {})
            }

            if (isEditingExistingRule) {
                const { error } = await supabase
                    .from('planning_rules')
                    .update(ruleData)
                    .eq('id', editingRuleId)
                if (error) throw error
            } else {
                const { error } = await supabase
                    .from('planning_rules')
                    .insert(ruleData)
                if (error) throw error
            }

            onSuccess()
            onOpenChange(false)
        } catch (error: any) {
            console.error("Error saving rule:", error)
            alert("Kayıt hatası: " + error.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto resize-x">
                <DialogHeader>
                    <DialogTitle>{isEditingExistingRule ? "Kuralı Düzenle" : "Yeni Planlama Kuralı"}</DialogTitle>
                    <DialogDescription>
                        Otomatik planlayıcı için bir davranış kuralı tanımlayın.
                    </DialogDescription>
                </DialogHeader>

                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Kural Adı</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Örn: Akşam Çorba Kuralı" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="priority"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Öncelik (1-100)</FormLabel>
                                        <FormControl>
                                            <Input type="number" {...field} />
                                        </FormControl>
                                        <FormDescription>Çakışma durumunda yüksek puan baskındır.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="rule_type"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Kural Tipi</FormLabel>
                                    <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value}
                                        disabled={isEditingExistingRule} // Cannot change type after creation for safety
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Tip seçin" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="frequency">Sıklık / Limit</SelectItem>
                                            <SelectItem value="affinity">Bağımlılık (Affinity)</SelectItem>
                                            <SelectItem value="consistency">Tutarlılık (Kilit)</SelectItem>
                                            <SelectItem value="nutritional">Makro Koşulu (Gelişmiş)</SelectItem>
                                            <SelectItem value="fixed_meal">Sabit Öğün</SelectItem>
                                            <SelectItem value="week_override">Haftaya Özel Diyet Türü</SelectItem>
                                            <SelectItem value="rotation">Haftalararası Rotasyon</SelectItem>
                                            <SelectItem value="or_group">VEYA Grubu (Haftalık Nöbetçi)</SelectItem>
                                            {/* <SelectItem value="preference">Tercih (Gelişmiş)</SelectItem> */}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Açıklama</FormLabel>
                                    <FormControl>
                                        <Textarea placeholder="Kuralın ne yaptığını açıklayın..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="is_active"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                    <div className="space-y-0.5">
                                        <FormLabel>Aktif</FormLabel>
                                        <FormDescription>
                                            Bu kural şu anda planlayıcı tarafından dikkate alınsın mı?
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        {/* Dynamic Editor Area */}
                        <div className="pt-4 border-t">
                            {definition && definition.type === 'frequency' && (
                                <FrequencyEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'frequency', data })}
                                    categories={categories}
                                    roles={roles}
                                />
                            )}
                            {definition && definition.type === 'affinity' && (
                                <AffinityEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'affinity', data })}
                                    categories={categories}
                                    roles={roles}
                                />
                            )}
                            {definition && definition.type === 'consistency' && (
                                <ConsistencyEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'consistency', data })}
                                    categories={categories}
                                    roles={roles}
                                />
                            )}
                            {definition && definition.type === 'fixed_meal' && (
                                <FixedMealEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'fixed_meal', data })}
                                    mealTypes={mealTypes}
                                />
                            )}
                            {definition && definition.type === 'week_override' && (
                                <WeekOverrideEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'week_override', data })}
                                    patientId={patientId}
                                />
                            )}
                            {definition && definition.type === 'nutritional' && (
                                <NutritionalEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'nutritional', data })}
                                />
                            )}
                            {definition && definition.type === 'rotation' && (
                                <RotationEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'rotation', data })}
                                    categories={categories}
                                    roles={roles}
                                />
                            )}
                            {definition && definition.type === 'or_group' && (
                                <OrGroupEditor
                                    value={definition.data}
                                    onChange={(data) => setDefinition({ type: 'or_group', data })}
                                    categories={categories}
                                    roles={roles}
                                />
                            )}
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
                            <Button type="submit" disabled={loading}>
                                {loading && "Kaydediliyor..."}
                                {!loading && (isEditingExistingRule ? "Güncelle" : "Oluştur")}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    )
}
