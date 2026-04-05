"use client"

import { PlanningRule } from "@/types/planner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Pencil, Trash2, Calendar, Activity, Lock, Heart, FileCode, GripVertical, RefreshCw, Layers } from "lucide-react"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
    useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface RuleListProps {
    rules: PlanningRule[]
    loading: boolean
    onEdit: (rule: PlanningRule) => void
    onDelete: (rule: PlanningRule) => void
    onDragEnd: (event: DragEndEvent) => void
}

export function RuleList({ rules, loading, onEdit, onDelete, onDragEnd }: RuleListProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );
    if (loading) {
        return <div className="text-center py-10">Kurallar yükleniyor...</div>
    }

    if (rules.length === 0) {
        return (
            <div className="text-center py-12 border rounded-lg bg-gray-50 border-dashed">
                <FileCode className="mx-auto h-12 w-12 text-gray-300" />
                <h3 className="mt-2 text-lg font-semibold text-gray-900">Kural Bulunamadı</h3>
                <p className="text-sm text-gray-500">Henüz hiç planlama kuralı tanımlanmamış. "Yeni Kural" butonu ile başlayın.</p>
            </div>
        )
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
        >
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <SortableContext
                    items={rules.map(r => r.id)}
                    strategy={rectSortingStrategy}
                >
                    {rules.map((rule) => (
                        <SortableRuleCard
                            key={rule.id}
                            rule={rule}
                            onEdit={onEdit}
                            onDelete={onDelete}
                        />
                    ))}
                </SortableContext>
            </div>
        </DndContext>
    )
}

interface SortableRuleCardProps {
    rule: PlanningRule;
    onEdit: (rule: PlanningRule) => void;
    onDelete: (rule: PlanningRule) => void;
}

function SortableRuleCard({ rule, onEdit, onDelete }: SortableRuleCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: rule.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 0,
        opacity: isDragging ? 0.8 : 1,
    };

    const getTypeIcon = (type: string) => {
        switch (type) {
            case 'frequency': return <Calendar size={16} className="text-blue-500" />
            case 'affinity': return <Activity size={16} className="text-purple-500" />
            case 'consistency': return <Lock size={16} className="text-orange-500" />
            case 'rotation': return <RefreshCw size={16} className="text-teal-500" />
            case 'or_group': return <Layers size={16} className="text-orange-500" />
            case 'preference': return <Heart size={16} className="text-red-500" />
            default: return <FileCode size={16} className="text-gray-500" />
        }
    }

    const getTypeLabel = (type: string) => {
        switch (type) {
            case 'frequency': return "Sıklık / Limit"
            case 'affinity': return "Bağımlılık (Affinity)"
            case 'consistency': return "Tutarlılık (Kilit)"
            case 'rotation': return "Rotasyon"
            case 'or_group': return "VEYA Grubu"
            case 'preference': return "Tercih / Skor"
            default: return type
        }
    }

    const scopeKey = rule.scope_source || rule.scope || 'global'
    const scopeLabel =
        scopeKey === 'team' ? 'Takım'
            : scopeKey === 'program' ? 'Program'
                : scopeKey === 'patient' ? 'Hasta'
                    : 'Global'
    const scopeBadgeClass =
        scopeKey === 'team'
            ? 'bg-violet-50 text-violet-700 border-violet-200'
            : scopeKey === 'program'
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                : scopeKey === 'patient'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'

    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={`group relative overflow-hidden transition-shadow ${isDragging ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow-md'}`}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                    {getTypeIcon(rule.rule_type)}
                    <Badge variant="outline" className="text-xs font-normal">
                        {getTypeLabel(rule.rule_type)}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] font-normal ${scopeBadgeClass}`}>
                        {scopeLabel}
                    </Badge>
                </div>
                <div className="flex items-center gap-1">
                    {rule.priority > 50 && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 mr-2">Yüksek Öncelik</Badge>
                    )}
                    <div
                        {...attributes}
                        {...listeners}
                        className="p-1 cursor-grab active:cursor-grabbing text-slate-400 hover:text-blue-600 rounded-md hover:bg-slate-100"
                    >
                        <GripVertical size={18} />
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <CardTitle className="text-lg font-medium mb-1 truncate" title={rule.name}>
                    {rule.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground line-clamp-2 h-10 mb-4">
                    {rule.description || "Açıklama yok."}
                </p>

                {/* Human Mutable Summary */}
                <div className="bg-gray-50 p-3 rounded text-sm text-gray-700 mb-4 min-h-[3rem] flex items-center">
                    {getRuleSummary(rule)}
                </div>

                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(rule)}>
                        <Pencil size={15} className="text-blue-600" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(rule)}>
                        <Trash2 size={15} className="text-red-600" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

function getRuleSummary(rule: PlanningRule): string {
    const def = rule.definition as any
    const typeLabel = (t: string, v: string) => {
        if (t === 'category') return `[${v}] kategorisi`
        if (t === 'role') return `[${v}] rolündeki`
        if (t === 'tag') return `[${v}] etiketli`
        if (t === 'food_id') return `"${v}" yemeği`
        return `"${v}"`
    }

    if (rule.rule_type === 'frequency') {
        if (!def.target) return "Eksik sıklık tanımı."
        const target = typeLabel(def.target.type, def.target.value)
        const period = def.period === 'daily' ? 'günde' : def.period === 'weekly' ? 'haftada' : 'öğün başı'
        return `${target} ${period} ${def.min_count}-${def.max_count} kez verilsin.`
    }

    if (rule.rule_type === 'affinity') {
        if (!def.trigger || !def.outcome) return "Eksik tanım."
        const trigger = typeLabel(def.trigger.type, def.trigger.value)
        const outcome = typeLabel(def.outcome.type, def.outcome.value)

        let action = ""
        if (def.association === 'boost') action = "tercih edilsin (+)"
        else if (def.association === 'mandatory') action = "mutlaka eklensin (!)"
        else if (def.association === 'reduce') action = "azaltılsın (-)"
        else if (def.association === 'forbidden') action = "yasaklansın (X)"

        return `Eğer menüde ${trigger} varsa, yanına ${outcome} ${action} (Güç: %${def.probability}).`
    }

    if (rule.rule_type === 'consistency') {
        if (!def.target) return "Eksik tutarlılık tanımı."
        const target = typeLabel(def.target.type, def.target.value)
        const duration = def.lock_duration === 'weekly' ? 'hafta boyunca' : 'gün boyunca'
        return `${target} seçimi ${duration} sabit kalsın (değişmesin).`
    }

    if (rule.rule_type === 'rotation') {
        if (!def.target) return "Eksik rotasyon tanımı."
        const target = typeLabel(def.target.type, def.target.value)
        const mode = def.mode === 'sequential' ? 'sıralı' : 'rastgele'
        const count = (def.items || []).length
        return `${target} haftalar arası ${mode} rotasyon (${count} besin).`
    }

    if (rule.rule_type === 'or_group') {
        const count = (def.options || []).length
        return `Haftalık nöbetleşe ${count} farklı hedef aranır.`
    }

    return "Özel kural tanımı."
}
