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
import { ArrowLeft, Stethoscope, Mail } from "lucide-react"

type Doctor = {
    id: string
    full_name: string | null
    email: string | null
    created_at: string
    title: string | null
}

export default function AdminDoctorsPage() {
    const { isAdmin, loading, profile } = useAuth()
    const router = useRouter()
    const [doctors, setDoctors] = useState<Doctor[]>([])
    const [isLoadingData, setIsLoadingData] = useState(true)

    useEffect(() => {
        // Only redirect if loading done AND profile loaded AND not admin
        if (!loading && profile && !isAdmin) {
            router.push("/")
        }
    }, [isAdmin, loading, router, profile])

    useEffect(() => {
        if (isAdmin) fetchDoctors()
    }, [isAdmin])

    async function fetchDoctors() {
        setIsLoadingData(true)
        const { data, error } = await supabase
            .from('profiles')
            .select('id, full_name, email, created_at, title, role')
            .order('created_at', { ascending: false })

        if (data) setDoctors(data.filter((d: any) => d.role === 'doctor'))
        if (error) console.error("Fetch doctors error:", error)
        setIsLoadingData(false)
    }

    if (loading || isLoadingData) {
        return (
            <div className="flex items-center justify-center h-full p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
                            <Stethoscope className="h-6 w-6 text-blue-600" />
                            Doktorlar
                        </h1>
                        <p className="text-muted-foreground text-sm">
                            Sistemdeki doktorları yönetin
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
                            <TableHead>Kayıt Tarihi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {doctors.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                    Henüz doktor kaydı yok.
                                </TableCell>
                            </TableRow>
                        ) : (
                            doctors.map((d, index) => (
                                <TableRow key={d.id} className="hover:bg-gray-50">
                                    <TableCell className="font-medium text-gray-400">{index + 1}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
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
