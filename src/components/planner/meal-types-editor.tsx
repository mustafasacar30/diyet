"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ChevronUp, ChevronDown, X, Settings2 } from "lucide-react"
import { MultiSelectCreatable, Option } from "@/components/ui/multi-select-creatable"

export interface SlotConfig {
    name: string
    min_items: number
    max_items: number
    requiredRoles?: string[]
    bannedRoles?: string[]
    bannedTags?: string[]
}

interface MealTypesEditorProps {
    mealTypes: string[]
    slotConfigs?: SlotConfig[]
    onSave: (types: string[], configs: SlotConfig[]) => void
    onCancel: () => void
    onChange?: (configs: SlotConfig[]) => void // Live change callback for embedded mode
    showFooter?: boolean // False when embedded in another dialog's tab
}

const PRESET_TYPES = ['KAHVALTI', 'ÖĞLEN', 'AKŞAM', 'ARA ÖĞÜN', 'GEÇ KAHVALTI', '2. ARA ÖĞÜN']
const DEFAULT_CONFIGS: Record<string, { min: number, max: number, requiredRoles?: string[] }> = {
    'KAHVALTI': { min: 2, max: 4 },
    'ÖĞLEN': { min: 2, max: 4, requiredRoles: ['mainDish'] },
    'AKŞAM': { min: 2, max: 4, requiredRoles: ['mainDish'] },
    'ARA ÖĞÜN': { min: 1, max: 2, requiredRoles: ['snack'] },
    'GEÇ KAHVALTI': { min: 2, max: 3 },
    '2. ARA ÖĞÜN': { min: 1, max: 2, requiredRoles: ['snack'] },
}

const ROLE_OPTIONS: Option[] = [
    { id: 'mainDish', name: 'Ana Yemek' },
    { id: 'sideDish', name: 'Yan Yemek' },
    { id: 'soup', name: 'Çorba' },
    { id: 'drink', name: 'İçecek' },
    { id: 'supplement', name: 'Takviye' },
    { id: 'snack', name: 'Atıştırmalık' },
    { id: 'dessert', name: 'Tatlı' },
    { id: 'salad', name: 'Salata' },
    { id: 'appetizer', name: 'Meze' },
    { id: 'bread', name: 'Ekmek' },
    { id: 'breakfast_main', name: 'Ana Kahvaltılık' }
]

export function MealTypesEditor({ mealTypes, slotConfigs, onSave, onCancel, onChange, showFooter = true }: MealTypesEditorProps) {
    // Convert mealTypes to SlotConfig format, merging with existing configs
    const initialConfigs: SlotConfig[] = slotConfigs && slotConfigs.length > 0
        ? slotConfigs.map(c => {
            const defaults = DEFAULT_CONFIGS[c.name]
            if (defaults && c.requiredRoles === undefined) {
                return { ...c, requiredRoles: defaults.requiredRoles || [] }
            }
            return c
        })
        : mealTypes.map(name => {
            const existing = slotConfigs?.find(c => c.name === name)
            if (existing) {
                const defaults = DEFAULT_CONFIGS[name]
                if (defaults && existing.requiredRoles === undefined) {
                    return { ...existing, requiredRoles: defaults.requiredRoles || [] }
                }
                return existing
            }
            const defaults = DEFAULT_CONFIGS[name] || { min: 2, max: 4 }
            return { 
                name, 
                min_items: defaults.min, 
                max_items: defaults.max,
                requiredRoles: defaults.requiredRoles || []
            }
        })

    const [configs, setConfigs] = useState<SlotConfig[]>(initialConfigs)
    const [newType, setNewType] = useState('')
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [editValue, setEditValue] = useState('')
    const [expandedRow, setExpandedRow] = useState<number | null>(null)

    // Sync internal state when slotConfigs prop changes (for when parent re-fetches from database)
    useEffect(() => {
        if (slotConfigs && slotConfigs.length > 0) {
            const mapped = slotConfigs.map(c => {
                const defaults = DEFAULT_CONFIGS[c.name]
                if (defaults && c.requiredRoles === undefined) {
                    return { ...c, requiredRoles: defaults.requiredRoles || [] }
                }
                return c
            })
            if (JSON.stringify(configs) !== JSON.stringify(mapped)) {
                setConfigs(mapped)
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slotConfigs])

    // Notify parent of changes in embedded mode
    useEffect(() => {
        if (onChange) {
            if (!slotConfigs || JSON.stringify(configs) !== JSON.stringify(slotConfigs)) {
                onChange(configs)
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configs, onChange])

    function addType(type: string) {
        if (type && !configs.some(c => c.name === type)) {
            const defaults = DEFAULT_CONFIGS[type] || { min: 2, max: 4 }
            setConfigs([...configs, { 
                name: type, 
                min_items: defaults.min, 
                max_items: defaults.max,
                requiredRoles: defaults.requiredRoles || []
            }])
        }
        setNewType('')
    }

    function removeType(index: number) {
        setConfigs(configs.filter((_, i) => i !== index))
    }

    function moveType(index: number, direction: 'up' | 'down') {
        const newConfigs = [...configs]
        const targetIdx = direction === 'up' ? index - 1 : index + 1
        if (targetIdx < 0 || targetIdx >= configs.length) return
            ;[newConfigs[index], newConfigs[targetIdx]] = [newConfigs[targetIdx], newConfigs[index]]
        setConfigs(newConfigs)
    }

    function updateConfig(index: number, field: 'min_items' | 'max_items', value: number) {
        const newConfigs = [...configs]
        newConfigs[index] = { ...newConfigs[index], [field]: value }
        // Ensure min <= max
        if (field === 'min_items' && value > newConfigs[index].max_items) {
            newConfigs[index].max_items = value
        }
        if (field === 'max_items' && value < newConfigs[index].min_items) {
            newConfigs[index].min_items = value
        }
        setConfigs(newConfigs)
    }

    function updateAdvancedConfig(index: number, field: 'requiredRoles' | 'bannedRoles' | 'bannedTags', items: Option[]) {
        const newConfigs = [...configs]
        newConfigs[index] = { ...newConfigs[index], [field]: items.map(i => i.id) }
        setConfigs(newConfigs)
    }

    function startEdit(index: number) {
        setEditingIndex(index)
        setEditValue(configs[index].name)
    }

    function saveEdit() {
        if (editingIndex !== null && editValue.trim()) {
            const newConfigs = [...configs]
            newConfigs[editingIndex] = { ...newConfigs[editingIndex], name: editValue.trim() }
            setConfigs(newConfigs)
            setEditingIndex(null)
            setEditValue('')
        }
    }

    function cancelEdit() {
        setEditingIndex(null)
        setEditValue('')
    }

    function handleSave() {
        const types = configs.map(c => c.name)
        onSave(types, configs)
    }

    // Expose current configs for parent components
    // This is a pattern for when we don't use footer (embedded mode)
    // Parent can read configs via ref or callback

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">Öğünleri düzenleyin. Her öğün için min-max yemek satırı belirleyin.</p>

            <div className="space-y-1">
                {configs.map((config, idx) => (
                  <div key={idx} className="flex flex-col mb-1">
                    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                        {editingIndex === idx ? (
                            <div className="flex-1 flex gap-1">
                                <Input
                                    className="h-7 text-sm flex-1"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                                    autoFocus
                                />
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveEdit}>✓</Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>✕</Button>
                            </div>
                        ) : (
                            <span
                                className="flex-1 font-medium text-sm cursor-pointer hover:text-blue-600"
                                onClick={() => startEdit(idx)}
                                title="Düzenlemek için tıklayın"
                            >
                                {config.name}
                            </span>
                        )}

                        {/* Min/Max Inputs */}
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                            <span>Min:</span>
                            <Input
                                type="number"
                                min={1}
                                max={10}
                                value={config.min_items}
                                onChange={e => updateConfig(idx, 'min_items', parseInt(e.target.value) || 1)}
                                className="h-6 w-12 text-xs text-center p-1"
                            />
                            <span>Max:</span>
                            <Input
                                type="number"
                                min={1}
                                max={10}
                                value={config.max_items}
                                onChange={e => updateConfig(idx, 'max_items', parseInt(e.target.value) || 1)}
                                className="h-6 w-12 text-xs text-center p-1"
                            />
                        </div>

                        <div className="flex gap-0.5 ml-2">
                            <button 
                                className={`p-1 rounded ${expandedRow === idx ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-200'}`} 
                                onClick={() => setExpandedRow(expandedRow === idx ? null : idx)}
                                title="Gelişmiş Ayarlar"
                            >
                                <Settings2 size={14} />
                            </button>
                            {idx > 0 && (
                                <button className="p-1 hover:bg-gray-200 rounded" onClick={() => moveType(idx, 'up')}>
                                    <ChevronUp size={14} />
                                </button>
                            )}
                            {idx < configs.length - 1 && (
                                <button className="p-1 hover:bg-gray-200 rounded" onClick={() => moveType(idx, 'down')}>
                                    <ChevronDown size={14} />
                                </button>
                            )}
                        </div>
                        <button className="p-1 hover:bg-red-100 text-red-500 rounded" onClick={() => removeType(idx)}>
                            <X size={14} />
                        </button>
                    </div>
                    
                    {expandedRow === idx && (
                        <div className="p-3 bg-white border border-t-0 rounded-b-md mb-2 shadow-sm space-y-3">
                            <div className="text-xs font-semibold text-slate-700 bg-slate-100 p-1.5 rounded inline-block mb-1">
                                {config.name} - Rol ve Tag Ayarları
                            </div>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-medium text-green-700 flex items-center gap-1">✅ Zorunlu Roller</Label>
                                    <p className="text-[10px] text-slate-500">Bu öğünde kesinlikle olması gereken roller.</p>
                                    <MultiSelectCreatable
                                        options={ROLE_OPTIONS}
                                        selected={(config.requiredRoles || []).map(r => ROLE_OPTIONS.find(o => o.id === r) || { id: r, name: r })}
                                        onChange={(opts) => updateAdvancedConfig(idx, 'requiredRoles', opts)}
                                        placeholder="Rol seçin..."
                                    />
                                </div>
                                
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-medium text-red-700 flex items-center gap-1">❌ Yasaklı Roller</Label>
                                    <p className="text-[10px] text-slate-500">Bu öğünde kesinlikle çıkmaması gereken roller.</p>
                                    <MultiSelectCreatable
                                        options={ROLE_OPTIONS}
                                        selected={(config.bannedRoles || []).map(r => ROLE_OPTIONS.find(o => o.id === r) || { id: r, name: r })}
                                        onChange={(opts) => updateAdvancedConfig(idx, 'bannedRoles', opts)}
                                        placeholder="Rol seçin..."
                                    />
                                </div>
                                
                                <div className="space-y-1.5">
                                    <Label className="text-xs font-medium text-orange-700 flex items-center gap-1">🚫 Yasaklı Taglar</Label>
                                    <p className="text-[10px] text-slate-500">Bu öğünde çıkması istenmeyen etiketler (örn: glüten).</p>
                                    <MultiSelectCreatable
                                        options={[]} // Etiketler dinamik, sadece yazarak eklenebilir
                                        selected={(config.bannedTags || []).map(t => ({ id: t, name: t }))}
                                        onChange={(opts) => updateAdvancedConfig(idx, 'bannedTags', opts)}
                                        placeholder="Tag yazın ve Enter'a basın..."
                                        emptyText=""
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                  </div>
                ))}
            </div>

            <div className="border-t pt-3 space-y-2">
                <Label className="text-xs">Öğün Ekle</Label>
                <div className="flex gap-1 flex-wrap">
                    {PRESET_TYPES.filter(t => !configs.some(c => c.name === t)).map(type => (
                        <Button key={type} variant="outline" size="sm" className="text-xs h-7" onClick={() => addType(type)}>
                            + {type}
                        </Button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <Input
                        placeholder="Özel öğün adı..."
                        className="h-8 text-sm"
                        value={newType}
                        onChange={e => setNewType(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addType(newType)}
                    />
                    <Button size="sm" variant="outline" onClick={() => addType(newType)}>Ekle</Button>
                </div>
            </div>

            {showFooter && (
                <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={onCancel}>İptal</Button>
                    <Button onClick={handleSave}>Uygula</Button>
                </div>
            )}
        </div>
    )
}

// Export for use as controlled component
export function useSlotConfigsState(mealTypes: string[], slotConfigs?: SlotConfig[]) {
    const initialConfigs: SlotConfig[] = mealTypes.map(name => {
        const existing = slotConfigs?.find(c => c.name === name)
        if (existing) {
            const defaults = DEFAULT_CONFIGS[name]
            if (defaults && existing.requiredRoles === undefined) {
                return { ...existing, requiredRoles: defaults.requiredRoles || [] }
            }
            return existing
        }
        const defaults = DEFAULT_CONFIGS[name] || { min: 2, max: 4 }
        return { 
            name, 
            min_items: defaults.min, 
            max_items: defaults.max,
            requiredRoles: defaults.requiredRoles || []
        }
    })
    return useState<SlotConfig[]>(initialConfigs)
}
