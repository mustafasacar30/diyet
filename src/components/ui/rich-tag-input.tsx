
import React, { useState, useRef } from 'react'
import { X, AlertTriangle, Info, Edit2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

export interface RichTag {
    text: string
    warning?: string
    info?: string
    match_name?: boolean
    match_tags?: boolean
}

interface RichTagInputProps {
    value: RichTag[]
    onChange: (value: RichTag[]) => void
    placeholder?: string
    className?: string
    showMatchScope?: boolean
    defaultMatchName?: boolean
    defaultMatchTags?: boolean
    splitOnSlash?: boolean
}

function RichTagItem({ tag, index, onRemove, onUpdate, showMatchScope }: { tag: RichTag, index: number, onRemove: (index: number) => void, onUpdate: (index: number, newTag: RichTag) => void, showMatchScope?: boolean }) {
    const [open, setOpen] = useState(false)
    const [tempTag, setTempTag] = useState(tag)

    const handleSave = () => {
        onUpdate(index, tempTag)
        setOpen(false)
    }

    // Reset temp state when opening
    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) setTempTag(tag)
        setOpen(isOpen)
    }

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <Badge
                                variant="secondary"
                                className={`pl-2 pr-1 h-6 flex items-center gap-1 text-xs whitespace-normal break-all cursor-pointer hover:opacity-80 transition-opacity ${tag.warning ? 'bg-amber-100 text-amber-800 border-amber-200' : ''} ${tag.info && !tag.warning ? 'bg-blue-50 text-blue-700 border-blue-100' : ''}`}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {tag.text}
                                {tag.warning && <AlertTriangle size={10} className="text-amber-600" />}
                                {!tag.warning && tag.info && <Info size={10} className="text-blue-500" />}
                                {showMatchScope && (
                                    <span className="text-[8px] opacity-60 ml-0.5">
                                        {tag.match_name && '📝'}{tag.match_tags && '🏷️'}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                                    className="hover:bg-black/10 rounded-full p-0.5 transition-colors shrink-0 ml-1"
                                >
                                    <X size={10} />
                                </button>
                            </Badge>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    {/* Only show tooltip if NOT open (to avoid visual clutter) and has content */}
                    {!open && (tag.warning || tag.info) && (
                        <TooltipContent className="max-w-xs text-xs">
                            {tag.warning && (
                                <div className="flex gap-2 items-start text-amber-700 mb-1">
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                                    <span>{tag.warning}</span>
                                </div>
                            )}
                            {tag.info && (
                                <div className="flex gap-2 items-start text-blue-700">
                                    <Info size={12} className="mt-0.5 shrink-0" />
                                    <span>{tag.info}</span>
                                </div>
                            )}
                        </TooltipContent>
                    )}
                </Tooltip>
            </TooltipProvider>

            <PopoverContent className="w-96 p-4" align="start" onFocusOutside={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
                <div className="grid gap-3" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                    <div className="space-y-1">
                        <h4 className="font-medium leading-none text-sm">Düzenle</h4>
                        <p className="text-xs text-muted-foreground">Etiket detaylarını güncelleyin.</p>
                    </div>
                    <div className="grid gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor={`text-${index}`} className="text-xs">Besin/Etiket Adı</Label>
                            <Input
                                id={`text-${index}`}
                                value={tempTag.text}
                                onChange={(e) => setTempTag({ ...tempTag, text: e.target.value })}
                                className="h-8 text-xs"
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor={`warning-${index}`} className="text-xs text-amber-700 font-semibold flex items-center gap-1">
                                <AlertTriangle size={10} /> Uyarı / Mekanizma
                            </Label>
                            <Textarea
                                id={`warning-${index}`}
                                value={tempTag.warning || ''}
                                onChange={(e) => setTempTag({ ...tempTag, warning: e.target.value })}
                                placeholder="Örn: Yüksek Nişasta"
                                className="min-h-[60px] text-xs border-amber-200 focus-visible:ring-amber-500 resize-y"
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor={`info-${index}`} className="text-xs text-blue-700 font-semibold flex items-center gap-1">
                                <Info size={10} /> Öneri / Tıbbi Not
                            </Label>
                            <Textarea
                                id={`info-${index}`}
                                value={tempTag.info || ''}
                                onChange={(e) => setTempTag({ ...tempTag, info: e.target.value })}
                                placeholder="Örn: Haşlanmış tercih edilmeli"
                                className="min-h-[60px] text-xs border-blue-200 focus-visible:ring-blue-500 resize-y"
                            />
                        </div>
                    </div>
                    {showMatchScope && (
                        <div className="border-t pt-3 mt-1">
                            <Label className="text-xs font-semibold text-gray-600 mb-2 block">Arama Kapsamı</Label>
                            <div className="flex gap-4">
                                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                                    <Checkbox
                                        checked={tempTag.match_name ?? true}
                                        onCheckedChange={(c) => setTempTag({ ...tempTag, match_name: c as boolean })}
                                    />
                                    📝 Yemek İsmi
                                </label>
                                <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                                    <Checkbox
                                        checked={tempTag.match_tags ?? true}
                                        onCheckedChange={(c) => setTempTag({ ...tempTag, match_tags: c as boolean })}
                                    />
                                    🏷️ Taglar
                                </label>
                            </div>
                        </div>
                    )}
                    <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setOpen(false)} className="h-8 text-xs flex-1">İptal</Button>
                        <Button size="sm" onClick={handleSave} className="h-8 text-xs flex-1">Kaydet</Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    )
}

export function RichTagInput({ value = [], onChange, placeholder, className, showMatchScope, defaultMatchName = true, defaultMatchTags = true, splitOnSlash = true }: RichTagInputProps) {
    const [inputValue, setInputValue] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    const processInput = (val: string) => {
        // Split by newlines first (for bulk paste)
        const lines = val.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        const newTags: RichTag[] = []
        let changed = false

        lines.forEach(line => {
            // Split by semicolon for structured data
            // Format: Text; Warning; Info
            const parts = line.split(';').map(p => p.trim())
            const keywordsPart = parts[0]

            if (!keywordsPart) return

            const warning = parts[1] || undefined
            const info = parts[2] || undefined

            // Split keywords by "/" to handle multiple items sharing same metadata
            // e.g. "Süt / Peynir / Yoğurt" -> ["Süt", "Peynir", "Yoğurt"]
            let keywords = [keywordsPart]
            if (splitOnSlash) {
                keywords = keywordsPart.split('/').map(k => k.trim()).filter(Boolean)
            } else {
                keywords = [keywordsPart.trim()]
            }

            keywords.forEach(text => {
                // Deduplication check (Case-insensitive on text)
                // Also check against current value AND newly added tags in this batch
                const isDuplicateInCurrent = value.some(t => t.text.toLowerCase() === text.toLowerCase())
                const isDuplicateInNew = newTags.some(t => t.text.toLowerCase() === text.toLowerCase())

                if (!isDuplicateInCurrent && !isDuplicateInNew) {
                    newTags.push({ text, warning, info, match_name: defaultMatchName, match_tags: defaultMatchTags })
                    changed = true
                }
            })
        })

        if (changed) {
            onChange([...value, ...newTags])
        }
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value
        // If paste contains newlines or semicolons, process immediately
        if (val.includes('\n') || val.includes(';')) {
            processInput(val)
            setInputValue('')
        } else if (val.includes(',')) {
            // Fallback for simple comma separation (just text)
            const parts = val.split(',').map(s => s.trim()).filter(Boolean)
            const newTags: RichTag[] = []
            let changed = false
            parts.forEach(part => {
                if (!value.some(t => t.text.toLowerCase() === part.toLowerCase())) {
                    newTags.push({ text: part, match_name: defaultMatchName, match_tags: defaultMatchTags })
                    changed = true
                }
            })
            if (changed) {
                onChange([...value, ...newTags])
            }
            setInputValue('')
        } else {
            setInputValue(val)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            addTag()
        } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
            removeTag(value.length - 1)
        }
    }

    const addTag = () => {
        const trimmed = inputValue.trim()
        if (trimmed) {
            processInput(trimmed)
            setInputValue('')
        }
    }

    const removeTag = (index: number) => {
        const newValue = [...value]
        newValue.splice(index, 1)
        onChange(newValue)
    }

    const updateTag = (index: number, newTag: RichTag) => {
        const newValue = [...value]
        newValue[index] = newTag
        onChange(newValue)
    }

    const handleBlur = () => {
        if (inputValue.trim()) {
            addTag()
        }
    }

    return (
        <div
            className={`p-2 bg-white border rounded-md focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-black cursor-text ${className}`}
            onClick={() => inputRef.current?.focus()}
        >
            {/* Chips first */}
            {value.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {value.map((tag, index) => (
                        <RichTagItem
                            key={index}
                            tag={tag}
                            index={index}
                            onRemove={removeTag}
                            onUpdate={updateTag}
                            showMatchScope={showMatchScope}
                        />
                    ))}
                </div>
            )}
            {/* Input always at the bottom, always visible */}
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onPaste={(e) => {
                    e.preventDefault()
                    const pastedData = e.clipboardData.getData('text')
                    if (pastedData) {
                        processInput(pastedData)
                        setInputValue('')
                    }
                }}
                className="w-full outline-none text-sm bg-transparent py-1"
                placeholder={value.length === 0 ? placeholder : 'Ekle... (Örn: Patates; Şekerli; Nişastalı)'}
            />
        </div>
    )
}
