'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Save, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type SystemPrompt = {
    id: string
    key: string
    description: string | null
    prompt_template: string
    model: string
    temperature: number
    updated_at: string
}

export default function AiSettingsPage() {
    const [prompts, setPrompts] = useState<SystemPrompt[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        loadPrompts()
    }, [])

    const loadPrompts = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from('system_prompts')
            .select('*')
            .order('key')

        if (error) {
            console.error('Error loading prompts:', error)
            alert('Promptlar yüklenirken hata oluştu: ' + error.message)
        } else {
            setPrompts(data || [])
        }
        setLoading(false)
    }

    const handlePromptChange = (id: string, field: keyof SystemPrompt, value: string | number) => {
        setPrompts(prev => prev.map(p =>
            p.id === id ? { ...p, [field]: value } : p
        ))
    }

    const savePrompt = async (prompt: SystemPrompt) => {
        setSaving(true)
        const { error } = await supabase
            .from('system_prompts')
            .update({
                prompt_template: prompt.prompt_template,
                model: prompt.model,
                temperature: prompt.temperature,
                updated_at: new Date().toISOString()
            })
            .eq('id', prompt.id)

        if (error) {
            alert('Kaydetme başarısız: ' + error.message)
        } else {
            alert('Prompt başarıyla güncellendi.')
        }
        setSaving(false)
    }

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const CATEGORIES = [
        { id: 'card_maker', title: '🎨 Kart Maker', keys: ['card_maker_text', 'card_maker_image', 'card_maker_revision'] },
        { id: 'discovery', title: '🔍 Tarif Keşif', keys: ['food_discovery'] },
        { id: 'system', title: '⚙️ Sistem & Diğer', keys: ['usda_translation', 'medication_details'] }
    ];

    const PROMPT_META: Record<string, { title: string, vars: string }> = {
        card_maker_text: { title: "Kart İçeriği (Yazı & Makro)", vars: "{{DISH_NAME}}, {{SERVINGS}}" },
        card_maker_image: { title: "Görsel Üretimi (Imagen/Gemini)", vars: "{{DISH_NAME}}, {{INGREDIENTS}}, {{PREPARATION}}" },
        card_maker_revision: { title: "Bütünleşik Revizyon (Metin + Görsel)", vars: "{{DISH_NAME}}, {{INGREDIENTS}}, {{PREPARATION}}, {{REVISION_NOTE}}" },
        food_discovery: { title: "Tarif Keşif Motoru (Genel)", vars: "(Kullanıcı girdisi doğrudan prompta eklenir)" },
        usda_translation: { title: "USDA İçerik Çeviri (İngilizce)", vars: "{{INGREDIENTS_JSON}}" },
        medication_details: { title: "İlaç Etkileşim Kuralları", vars: "{{medication_name}}" }
    };

    return (
        <div className="container mx-auto p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Yapay Zeka Prompt Yönetimi</h1>
                    <p className="text-muted-foreground">Sisteminizin AI davranışlarını ve komut şablonlarını düzenleyin.</p>
                </div>
                <Button variant="outline" onClick={loadPrompts}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Yenile
                </Button>
            </div>

            <Tabs defaultValue="card_maker" className="w-full">
                <TabsList className="mb-6 bg-muted/50 p-1">
                    {CATEGORIES.map(cat => (
                        <TabsTrigger key={cat.id} value={cat.id} className="text-sm font-medium px-6">
                            {cat.title}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {CATEGORIES.map(cat => (
                    <TabsContent key={cat.id} value={cat.id} className="space-y-6">
                        {prompts.filter(p => cat.keys.includes(p.key)).map(prompt => {
                            const meta = PROMPT_META[prompt.key] || { title: prompt.key, vars: "Bilinmeyen değişkenler" };
                            return (
                                <Card key={prompt.id} className="border-muted-foreground/20 shadow-sm">
                                    <CardHeader className="bg-muted/10 pb-4">
                                        <CardTitle className="text-lg text-primary">{meta.title}</CardTitle>
                                        <CardDescription>{prompt.description}</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-5 pt-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <Label className="text-xs font-semibold text-muted-foreground uppercase">Kullanılan Model</Label>
                                                <Input
                                                    className="bg-muted/30"
                                                    value={prompt.model}
                                                    onChange={(e) => handlePromptChange(prompt.id, 'model', e.target.value)}
                                                    placeholder="gemini-2.5-flash"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-semibold text-muted-foreground uppercase flex justify-between">
                                                    <span>Yaratıcılık / Sıcaklık (Temperature)</span>
                                                    <span className="text-primary">{prompt.temperature}</span>
                                                </Label>
                                                <div className="flex items-center gap-4">
                                                    <input
                                                        type="range"
                                                        min="0" max="1" step="0.1"
                                                        value={prompt.temperature}
                                                        onChange={(e) => handlePromptChange(prompt.id, 'temperature', parseFloat(e.target.value))}
                                                        className="w-full accent-primary"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-end">
                                                <Label className="text-xs font-semibold text-muted-foreground uppercase">Prompt Şablonu</Label>
                                                <span className="text-[11px] font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">Kullanılabilir Değişkenler: {meta.vars}</span>
                                            </div>
                                            <Textarea
                                                className="font-mono text-sm leading-relaxed min-h-[250px] resize-y bg-slate-50/50 dark:bg-slate-900/50"
                                                value={prompt.prompt_template}
                                                onChange={(e) => handlePromptChange(prompt.id, 'prompt_template', e.target.value)}
                                                placeholder="Prompt metnini girin..."
                                                spellCheck={false}
                                            />
                                        </div>
                                    </CardContent>
                                    <CardFooter className="bg-muted/10 pt-4 pb-4 border-t">
                                        <div className="text-xs text-muted-foreground flex-1">
                                            Son güncelleme: {new Date(prompt.updated_at).toLocaleString('tr-TR')}
                                        </div>
                                        <Button onClick={() => savePrompt(prompt)} disabled={saving} size="sm">
                                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                            Değişiklikleri Kaydet
                                        </Button>
                                    </CardFooter>
                                </Card>
                            );
                        })}
                        {prompts.filter(p => cat.keys.includes(p.key)).length === 0 && (
                            <div className="p-8 text-center text-muted-foreground border border-dashed rounded-lg">
                                Bu kategoriye ait kayıtlı prompt bulunamadı. Veritabanını güncellediğinize emin olun.
                            </div>
                        )}
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    )
}
