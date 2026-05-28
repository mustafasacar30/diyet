"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { ArrowLeft, Apple, Mail, Users } from "lucide-react"

type Dietitian = {
    id: string
    full_name: string | null
    email: string | null
    created_at: string
    title: string | null
    patient_count?: number
}

export default function AdminDietitiansPage() {
    const { isAdmin, loading, profile } = useAuth()
    const router = useRouter()
    const [dietitians, setDietitians] = useState<Dietitian[]>([])
    const [isLoadingData, setIsLoadingData] = useState(true)

    useEffect(() => {
        // Only redirect if loading done AND profile loaded AND not admin
        if (!loading && profile && !isAdmin) {
            router.push("/")
        }
    }, [isAdmin, loading, router, profile])

    useEffect(() => {
        if (isAdmin) fetchDietitians()
    }, [isAdmin])

    async function fetchDietitians() {
        setIsLoadingData(true)

        // Get dietitians from profiles
        const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, title, created_at, role')
            .order('created_at', { ascending: false })

        if (profileError) {
            console.error("Fetch dietitians error:", profileError)
            setIsLoadingData(false)
            return
        }

        const filtered = profiles?.filter((p: any) => p.role === 'dietitian') || [];
        // Get patient counts for each dietitian
        const dietitiansWithCounts = await Promise.all(
            filtered.map(async (d) => {
                const { count } = await supabase
                    .from('patient_assignments')
                    .select('*', { count: 'exact', head: true })
                    .eq('dietitian_id', d.id)

                // Get email from user_management_view
                const { data: userData } = await supabase
                    .from('user_management_view')
                    .select('email')
                    .eq('id', d.id)
                    .single()

                return {
                    ...d,
                    email: userData?.email || null,
                    patient_count: count || 0
                }
            })
        )

        setDietitians(dietitiansWithCounts)
        setIsLoadingData(false)
    }

    if (loading || isLoadingData) {
        return (
            <div className="flex items-center justify-center h-full p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/admin/users')}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Apple className="h-6 w-6 text-green-600" />
                            Diyetisyenler
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            Sistemdeki diyetisyenleri yönetin ({dietitians.length} diyetisyen)
                        </p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-gray-50/50">
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Ad Soyad</TableHead>
                            <TableHead>E-posta</TableHead>
                            <TableHead>Ünvan</TableHead>
                            <TableHead className="text-center">Hasta Sayısı</TableHead>
                            <TableHead>Kayıt Tarihi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {dietitians.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                    Henüz diyetisyen kaydı yok.
                                </TableCell>
                            </TableRow>
                        ) : (
                            dietitians.map((d, index) => (
                                <TableRow
                                    key={d.id}
                                    className="hover:bg-gray-50 cursor-pointer"
                                    onClick={() => router.push(`/admin/dietitians/${d.id}`)}
                                >
                                    <TableCell className="font-medium text-gray-400">{index + 1}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-xs">
                                                {d.full_name?.substring(0, 1) || '?'}
                                            </div>
                                            <span className="font-medium">{d.full_name || '-'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1 text-gray-600">
                                            <Mail className="h-3 w-3" />
                                            {d.email || '-'}
                                        </div>
                                    </TableCell>
                                    <TableCell>{d.title || '-'}</TableCell>
                                    <TableCell className="text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            <Users className="h-4 w-4 text-gray-400" />
                                            <span className={`font-medium ${d.patient_count! > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                {d.patient_count}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{new Date(d.created_at).toLocaleDateString('tr-TR')}</TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
