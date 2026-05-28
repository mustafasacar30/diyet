'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Brain, CheckCircle, Clock, XCircle, Loader2 } from "lucide-react"
import { SmartInsight } from '@/types/smart-analyzer'

export default function SmartInsightsPage() {
    const [insights, setInsights] = useState<SmartInsight[]>([])
    const [loading, setLoading] = useState(false)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    const fetchInsights = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/smart-insights')
            if (!res.ok) throw new Error('Failed to fetch insights')
            const data = await res.json()
            setInsights(data || [])
        } catch (err: any) {
            alert(err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchInsights()
    }, [])

    const handleAction = async (id: string, action: 'approve' | 'snooze' | 'dismiss', proposedRule?: any) => {
        setActionLoading(id)
        try {
            const res = await fetch('/api/smart-insights', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, insightId: id, proposedRule })
            })
            if (!res.ok) throw new Error('Action failed')
            
            alert(action === 'approve' ? 'Kural eklendi!' : 'Öneri gizlendi')
            
            // Remove from list
            setInsights(prev => prev.filter(i => i.id !== id))
        } catch (err: any) {
            alert(err.message)
        } finally {
            setActionLoading(null)
        }
    }

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Brain className="w-8 h-8 text-primary" />
                        Yapay Zeka Asistanı
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Geçmiş hasta diyetlerini analiz ederek oluşturulmuş akıllı kural önerileri.
                    </p>
                </div>
                <Button onClick={fetchInsights} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Brain className="w-4 h-4 mr-2" />}
                    {loading ? 'Analiz Ediliyor...' : 'Yeniden Analiz Et'}
                </Button>
            </div>

            {loading && insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                    <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
                    <p>Geçmiş haftalar taranıyor ve örüntüler çıkarılıyor...</p>
                </div>
            ) : insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
                    <CheckCircle className="w-12 h-12 mb-4 text-green-500/50" />
                    <p className="text-lg">Şu an için yeni bir öneri bulunmuyor.</p>
                    <p className="text-sm">Asistan arka planda verileri izlemeye devam edecek.</p>
                </div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2">
                    {insights.map(insight => (
                        <Card key={insight.id} className="relative overflow-hidden border-primary/20 shadow-sm hover:shadow-md transition-shadow">
                            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                            <CardHeader className="pb-3">
                                <div className="flex justify-between items-start">
                                    <Badge variant={insight.type === 'frequency' ? 'default' : insight.type === 'scope' ? 'secondary' : 'outline'}>
                                        {insight.type === 'frequency' ? 'Sıklık Kuralı' : insight.type === 'scope' ? 'Öğün Kuralı' : 'Örüntü'}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground font-medium px-2 py-1 bg-muted rounded-md">
                                        Güven: %{Math.round(insight.confidence)}
                                    </span>
                                </div>
                                <CardTitle className="text-xl mt-2">{insight.title}</CardTitle>
                                <CardDescription className="text-base text-foreground mt-2">
                                    {insight.description}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="pb-4">
                                <div className="text-sm text-muted-foreground flex items-center gap-1.5 bg-muted/50 p-2 rounded-md">
                                    <Brain className="w-4 h-4" />
                                    <span>Bu örüntü sistemde tam <strong>{insight.supportCount}</strong> kez tekrarlandı.</span>
                                </div>
                            </CardContent>
                            <CardFooter className="flex justify-end gap-2 border-t pt-4 bg-muted/10">
                                <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => handleAction(insight.id, 'dismiss')}
                                    disabled={actionLoading === insight.id}
                                    className="text-muted-foreground hover:text-red-500"
                                >
                                    <XCircle className="w-4 h-4 mr-1.5" />
                                    Yoksay
                                </Button>
                                <Button 
                                    variant="default" 
                                    size="sm"
                                    onClick={() => handleAction(insight.id, 'approve', insight.proposedRule)}
                                    disabled={actionLoading === insight.id}
                                    className="bg-primary hover:bg-primary/90"
                                >
                                    {actionLoading === insight.id ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1.5" />}
                                    Kabul Et
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
