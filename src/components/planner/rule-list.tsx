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
    viewMode?: 'grid' | 'list'
    ruleProgramMap?: Record<string, string[]>
    onEdit: (rule: PlanningRule) => void
    onDelete: (rule: PlanningRule) => void
    onDragEnd: (event: DragEndEvent) => void
}

export function RuleList({ rules, loading, viewMode = 'grid', ruleProgramMap = {}, onEdit, onDelete, onDragEnd }: RuleListProps) {
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
            <div className={viewMode === 'grid' ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3" : "flex flex-col gap-3"}>
                <SortableContext
                    items={rules.map(r => r.id)}
                    strategy={rectSortingStrategy}
                >
                    {rules.map((rule) => (
                        <SortableRuleCard
                            key={rule.id}
                            rule={rule}
                            viewMode={viewMode}
                            programs={ruleProgramMap[rule.id] || []}
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
    viewMode: 'grid' | 'list';
    programs: string[];
    onEdit: (rule: PlanningRule) => void;
    onDelete: (rule: PlanningRule) => void;
}

function SortableRuleCard({ rule, viewMode, programs, onEdit, onDelete }: SortableRuleCardProps) {
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

    if (viewMode === 'list') {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className={`group relative overflow-hidden bg-white border rounded-lg transition-shadow flex flex-col md:flex-row items-stretch ${isDragging ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow-md'}`}
            >
                <div className="flex flex-col justify-center px-2 border-r bg-slate-50 cursor-grab active:cursor-grabbing text-slate-400 hover:text-blue-600 hover:bg-slate-100" {...attributes} {...listeners}>
                    <GripVertical size={18} />
                </div>
                
                <div className="flex-1 p-4 flex flex-col justify-center overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        {getTypeIcon(rule.rule_type)}
                        <h3 className="text-base font-semibold truncate max-w-full" title={rule.name}>{rule.name}</h3>
                        <Badge variant="outline" className={`text-[10px] font-normal px-1.5 py-0 ${scopeBadgeClass}`}>
                            {scopeLabel}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0 text-slate-500">
                            {getTypeLabel(rule.rule_type)}
                        </Badge>
                        {rule.priority > 50 && (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] px-1.5 py-0">Yüksek Öncelik</Badge>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate mb-2 max-w-full">
                        {rule.description || "Açıklama yok."}
                    </p>
                    <div className="text-xs text-gray-700 bg-gray-50 inline-flex px-2 py-1.5 rounded border">
                        {getRuleSummary(rule)}
                    </div>
                </div>

                <div className="w-full md:w-64 border-t md:border-t-0 md:border-l p-4 flex flex-col justify-center bg-slate-50/50 shrink-0">
                    <h4 className="text-[10px] font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Kapsanan Programlar</h4>
                    {programs.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto pr-1 custom-scrollbar">
                            {programs.map(p => (
                                <Badge key={p} variant="secondary" className="text-[10px] bg-white border border-slate-200 text-slate-600 font-normal px-1.5 py-0 truncate max-w-full" title={p}>{p}</Badge>
                            ))}
                        </div>
                    ) : (
                        <span className="text-xs text-slate-400 italic">Genel (Tüm Programlar)</span>
                    )}
                </div>

                <div className="p-3 md:p-4 flex flex-row md:flex-col items-center justify-end gap-2 border-t md:border-t-0 md:border-l opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0 bg-white">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => onEdit(rule)}>
                        <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-50" onClick={() => onDelete(rule)}>
                        <Trash2 size={15} />
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <Card
            ref={setNodeRef}
            style={style}
            className={`group relative overflow-hidden transition-shadow ${isDragging ? 'ring-2 ring-blue-500 shadow-md' : 'hover:shadow-md'}`}
        >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                    {((rule.definition as any)?._source === 'pattern_insights') && (
                        <Badge className="text-[10px] bg-indigo-50 text-indigo-600 border-indigo-200 shrink-0 font-normal hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400">
                            🧠 Örüntü Analizi
                        </Badge>
                    )}
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
