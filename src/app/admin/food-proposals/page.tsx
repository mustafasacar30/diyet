"use client"

import React, { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Check, X, Search, Loader2 } from "lucide-react"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { FoodEditDialog } from "@/components/diet/food-sidebar"
import Image from "next/image"

interface Proposal {
    id: string
    created_at: string
    user_id: string
    suggested_name: string
    calories: number
    protein: number
    carbs: number
    fat: number
    image_url: string | null
    status: 'pending' | 'approved' | 'rejected'
    ai_analysis: any
    admin_note: string | null
    ingredients?: string
    recipe_text?: string
    portion_unit?: string
    profiles?: {
        full_name: string
    }
}

export default function FoodProposalsPage() {
    const [proposals, setProposals] = useState<Proposal[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')

    // Approval Dialog State
    const [isFoodDialogOpen, setIsFoodDialogOpen] = useState(false)
    const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null)

    // Processing State
    const [processing, setProcessing] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    useEffect(() => {
        fetchProposals()
    }, [statusFilter])

    async function fetchProposals() {
        setLoading(true)
        try {
            const response = await fetch('/api/admin/food-proposals?status=' + statusFilter)
            if (!response.ok) throw new Error('API Error')

            const data = await response.json()
            setProposals(data.proposals || [])
        } catch (err: any) {
            console.error("Error fetching proposals:", err)
        } finally {
            setLoading(false)
        }
    }

    const filteredProposals = proposals.filter(p => {
        const matchSearch = p.suggested_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.profiles?.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
        const matchStatus = statusFilter === 'all' || p.status === statusFilter
        return matchSearch && matchStatus
    })

    const openApproveDialog = (proposal: Proposal) => {
        setSelectedProposal(proposal)
        setIsFoodDialogOpen(true)
    }

    const handleReject = async (proposalId: string) => {
        if (!confirm("Bu öneriyi reddetmek istediğinize emin misiniz?")) return

        setProcessing(true)
        try {
            const res = await fetch('/api/admin/food-proposals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: proposalId, action: 'reject' })
            })
            if (!res.ok) throw new Error('Failed to reject')

            // Remove separately from state for instant UI update
            setProposals(prev => prev.filter(p => p.id !== proposalId))
        } catch (err: any) {
            alert('Hata: ' + err.message)
        } finally {
            setProcessing(false)
        }
    }

    const handleSaveApprovedFood = async (values: any) => {
        if (!selectedProposal) return

        // values comes from FoodEditDialog. It contains all the fields.
        // We send it to the API to create the food and update proposal.

        try {
            const res = await fetch('/api/admin/food-proposals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: selectedProposal.id,
                    action: 'approve',
                    foodData: {
                        ...values,
                        image_url: selectedProposal.image_url // Always carry the proposal's photo
                    }
                })
            })

            if (!res.ok) {
                const errData = await res.json()
                throw new Error(errData.error || 'Failed to approve')
            }

            // Success
            setIsFoodDialogOpen(false)
            setProposals(prev => prev.filter(p => p.id !== selectedProposal.id))
            alert("Yemek başarıyla eklendi ve öneri onaylandı.")
            return await res.json() // Return to dialog if needed
        } catch (err: any) {
            console.error(err)
            alert('Hata: ' + err.message)
            throw err // Propagate to dialog to show error state if it handles it
        }
    }

    // Convert Proposal to Food-like object for FoodEditDialog
    const proposalToInitialFood = (p: Proposal | null) => {
        if (!p) return {}
        return {
            id: null, // New food
            name: p.suggested_name,
            category: 'Kullanıcı Önerisi',
            role: 'mainDish', // Default
            calories: p.calories,
            protein: p.protein,
            carbs: p.carbs,
            fat: p.fat,
            portion_unit: p.portion_unit || 'porsiyon',
            unit: p.portion_unit || 'porsiyon',
            standard_amount: 1,
            base_amount: 1,
            tags: [],
            ingredients: p.ingredients || '',
            recipe_text: p.recipe_text || '',
            // Defaults will be handled by FoodEditDialog state initialization
        }
    }

    return (
        <div className="container mx-auto py-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Besin Önerileri</h1>
                <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-lg">
                    {['pending', 'approved', 'rejected', 'all'].map((status) => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status as any)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${statusFilter === status
                                ? 'bg-white shadow-sm text-green-700'
                                : 'text-gray-500 hover:text-gray-900'
                                }`}
                        >
                            {status === 'pending' ? 'Bekleyenler' :
                                status === 'approved' ? 'Onaylananlar' :
                                    status === 'rejected' ? 'Reddedilenler' : 'Tümü'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex gap-4 mb-6">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                    <Input
                        placeholder="Yemek veya kullanıcı ara..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
            ) : filteredProposals.length === 0 ? (
                <div className="text-center p-12 border rounded-xl bg-gray-50 text-gray-500">
                    Öneri bulunamadı.
                </div>
            ) : (
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Tarih</TableHead>
                                <TableHead>Fotoğraf</TableHead>
                                <TableHead>Öneri Detayları</TableHead>
                                <TableHead>Kullanıcı</TableHead>
                                <TableHead>Durum</TableHead>
                                <TableHead className="text-right">İşlemler</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredProposals.map((proposal) => (
                                <React.Fragment key={proposal.id}>
                                    <TableRow 
                                        className="cursor-pointer hover:bg-gray-50/50 transition-colors"
                                        onClick={() => setExpandedId(expandedId === proposal.id ? null : proposal.id)}
                                    >
                                        <TableCell className="text-xs text-gray-500">
                                            {new Date(proposal.created_at).toLocaleDateString('tr-TR')}
                                        </TableCell>
                                        <TableCell>
                                            {proposal.image_url ? (
                                                <div className="relative w-16 h-16 rounded-lg overflow-hidden border bg-gray-100 group">
                                                    <Image
                                                        src={proposal.image_url}
                                                        alt={proposal.suggested_name}
                                                        fill
                                                        sizes="64px"
                                                        className="object-cover transition-transform group-hover:scale-110"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs text-center p-1 font-medium border border-dashed border-gray-300">
                                                    Görsel Yok
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="font-semibold text-gray-900">{proposal.suggested_name}</div>
                                            <div className="text-xs text-gray-500 mt-1 space-x-2 font-medium">
                                                <span>{Math.round(proposal.calories)} kcal</span>
                                                <span className="text-blue-600">P: {Math.round(proposal.protein)}g</span>
                                                <span className="text-orange-600">K: {Math.round(proposal.carbs)}g</span>
                                                <span className="text-yellow-600">Y: {Math.round(proposal.fat)}g</span>
                                            </div>
                                            {proposal.ai_analysis?.total_servings && (
                                                <div className="text-[10px] text-gray-400 mt-1">
                                                    🍽️ {proposal.ai_analysis.total_servings} {proposal.portion_unit || 'porsiyon'} üretir (Değerler 1 porsiyon içindir)
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-sm font-medium text-gray-700">{proposal.profiles?.full_name || 'AI Keşif Motoru'}</div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={
                                                proposal.status === 'approved' ? 'default' :
                                                    proposal.status === 'rejected' ? 'destructive' : 'secondary'
                                            } className={proposal.status === 'pending' ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : ''}>
                                                {proposal.status === 'approved' ? 'Onaylandı' :
                                                    proposal.status === 'rejected' ? 'Reddedildi' : 'Onay Bekliyor'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                            {proposal.status === 'pending' && (
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="text-green-600 hover:text-green-700 hover:bg-green-50 px-3 h-8 border-green-200"
                                                        onClick={(e) => { e.stopPropagation(); openApproveDialog(proposal); }}
                                                    >
                                                        <Check className="h-4 w-4 mr-1" /> Onayla
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-red-500 hover:text-red-600 flex-shrink-0 hover:bg-red-50 w-8 h-8 p-0 shrink-0"
                                                        onClick={(e) => { e.stopPropagation(); handleReject(proposal.id); }}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>

                                    {/* Expanded State */}
                                    {expandedId === proposal.id && (
                                        <TableRow className="bg-gray-50/80 hover:bg-gray-50/80 border-b-2 border-gray-100">
                                            <TableCell colSpan={6} className="p-0 border-0">
                                                <div className="px-6 py-4 animate-in slide-in-from-top-2 duration-200">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                                                        <div>
                                                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                                <span className="text-orange-500">📝</span> Malzemeler
                                                            </h4>
                                                            <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed pl-1">
                                                                {proposal.ingredients || <span className="text-gray-400 italic">Malzeme bilgisi yok.</span>}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                                                <span className="text-blue-500">👨‍🍳</span> Hazırlanışı
                                                            </h4>
                                                            <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed pl-1">
                                                                {proposal.recipe_text || <span className="text-gray-400 italic">Tarif bilgisi yok.</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </React.Fragment>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {/* Integration of Complex FoodEditDialog for Approved Foods */}
            {selectedProposal && (
                <FoodEditDialog
                    isOpen={isFoodDialogOpen}
                    onClose={() => setIsFoodDialogOpen(false)}
                    food={proposalToInitialFood(selectedProposal)}
                    mode="edit" // Showing 'edit' mode enables the Recipe Match/Ban UI
                    onUpdate={() => { }}
                    onSave={handleSaveApprovedFood}
                />
            )}
        </div>
    )
}
