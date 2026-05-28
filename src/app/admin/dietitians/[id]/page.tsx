"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter, useParams } from "next/navigation"
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
import { ArrowLeft, Apple, User, Calendar, Weight } from "lucide-react"

type DietitianInfo = {
    id: string
    full_name: string | null
    email: string | null
    title: string | null
}

type AssignedPatient = {
    id: string
    full_name: string
    created_at: string
    weight: number | null
    birth_date: string | null
    assignment_date: string
}

export default function DietitianDetailPage() {
    const { isAdmin, loading, profile } = useAuth()
    const router = useRouter()
    const params = useParams()
    const dietitianId = params.id as string

    const [dietitian, setDietitian] = useState<DietitianInfo | null>(null)
    const [patients, setPatients] = useState<AssignedPatient[]>([])
    const [isLoadingData, setIsLoadingData] = useState(true)

    useEffect(() => {
        // Only redirect if loading done AND profile loaded AND not admin
        if (!loading && profile && !isAdmin) {
            router.push("/")
        }
    }, [isAdmin, loading, router, profile])

    useEffect(() => {
        if (isAdmin && dietitianId) {
            fetchData()
        }
    }, [isAdmin, dietitianId])

    async function fetchData() {
        setIsLoadingData(true)

        // Get dietitian info
        const { data: dietitianData } = await supabase
            .from('profiles')
            .select('id, full_name, email, title')
            .eq('id', dietitianId)
            .single()

        if (dietitianData) {
            setDietitian(dietitianData)
        }

        // Get assigned patients
        const { data: assignments, error } = await supabase
            .from('patient_assignments')
            .select(`
                created_at,
                patients (
                    id,
                    full_name,
                    created_at,
                    weight,
                    birth_date
                )
            `)
            .eq('dietitian_id', dietitianId)

        if (error) {
            console.error("Fetch assignments error:", error)
        } else if (assignments) {
            const patientList: AssignedPatient[] = assignments
                .filter(a => a.patients)
                .map(a => ({
                    id: (a.patients as any).id,
                    full_name: (a.patients as any).full_name,
                    created_at: (a.patients as any).created_at,
                    weight: (a.patients as any).weight,
                    birth_date: (a.patients as any).birth_date,
                    assignment_date: a.created_at
                }))
            setPatients(patientList)
        }

        setIsLoadingData(false)
    }

    if (loading || isLoadingData) {
        return (
            <div className="flex items-center justify-center h-full p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            </div>
        )
    }

    const calculateAge = (birthDate: string | null) => {
        if (!birthDate) return '-'
        return new Date().getFullYear() - new Date(birthDate).getFullYear()
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push('/admin/dietitians')}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-lg">
                            {dietitian?.full_name?.substring(0, 1) || '?'}
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold flex items-center gap-2">
                                {dietitian?.full_name || 'Diyetisyen'}
                            </h1>
                            <p className="text-muted-foreground text-sm">
                                {dietitian?.title || 'Diyetisyen'} • {dietitian?.email}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Card */}
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg p-6 text-white">
                <div className="flex items-center gap-3">
                    <User className="h-8 w-8" />
                    <div>
                        <div className="text-3xl font-bold">{patients.length}</div>
                        <div className="text-green-100">Atanmış Hasta</div>
                    </div>
                </div>
            </div>

            {/* Patients Table */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
                <div className="p-4 border-b bg-gray-50/50">
                    <h2 className="font-semibold">Atanan Hastalar</h2>
                </div>
                <Table>
                    <TableHeader>
                        <TableRow className="bg-gray-50/50">
                            <TableHead className="w-12">#</TableHead>
                            <TableHead>Hasta Adı</TableHead>
                            <TableHead>Yaş</TableHead>
                            <TableHead>Kilo</TableHead>
                            <TableHead>Atama Tarihi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {patients.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                    Bu diyetisyene atanmış hasta yok.
                                </TableCell>
                            </TableRow>
                        ) : (
                            patients.map((p, index) => (
                                <TableRow
                                    key={p.id}
                                    className="hover:bg-gray-50 cursor-pointer"
                                    onClick={() => router.push(`/patients/${p.id}`)}
                                >
                                    <TableCell className="font-medium text-gray-400">{index + 1}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
                                                {p.full_name.substring(0, 1)}
                                            </div>
                                            <span className="font-medium">{p.full_name}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{calculateAge(p.birth_date)}</TableCell>
                                    <TableCell>
                                        {p.weight ? (
                                            <span className="flex items-center gap-1">
                                                <Weight className="h-3 w-3 text-gray-400" />
                                                {p.weight} kg
                                            </span>
                                        ) : '-'}
                                    </TableCell>
                                    <TableCell>
                                        <span className="flex items-center gap-1 text-gray-600">
                                            <Calendar className="h-3 w-3" />
                                            {new Date(p.assignment_date).toLocaleDateString('tr-TR')}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
