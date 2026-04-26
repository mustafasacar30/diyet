
"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ManualMatchesTab } from "./manual-matches-tab"
import { BansTab } from "./bans-tab"
import { RecipeCardsTab } from "./recipe-cards-tab"

import { useRecipeManager } from "@/hooks/use-recipe-manager"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

export function RecipeManager() {
    const { syncCards, refresh, isLoading } = useRecipeManager()
    const [isSyncing, setIsSyncing] = useState(false)

    const handleSync = async () => {
        setIsSyncing(true)
        const ok = await syncCards()
        if (ok) {
            await refresh()
        } else {
            alert("Senkronizasyon hatası!")
        }
        setIsSyncing(false)
    }

    return (
        <div className="w-full p-4 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Tarif Kartı Yönetimi</h1>
                <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleSync} 
                    disabled={isSyncing || isLoading}
                >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    GitHub'dan Eşitle
                </Button>
            </div>

            <Tabs defaultValue="manual-matches" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="manual-matches">Manuel Eşleştirmeler</TabsTrigger>
                    <TabsTrigger value="bans">Eşleşme Yasakları</TabsTrigger>
                    <TabsTrigger value="cards">Tarif Kartları</TabsTrigger>
                </TabsList>
                <TabsContent value="manual-matches" className="space-y-4">
                    <ManualMatchesTab />
                </TabsContent>
                <TabsContent value="bans" className="space-y-4">
                    <BansTab />
                </TabsContent>
                <TabsContent value="cards" className="space-y-4">
                    <RecipeCardsTab />
                </TabsContent>
            </Tabs>
        </div>
    )
}
