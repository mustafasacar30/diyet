"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function MedicationsRedirectPage() {
    const router = useRouter()

    useEffect(() => {
        router.replace("/admin/diseases?tab=medications")
    }, [router])

    return (
        <div className="flex items-center justify-center p-24 text-gray-500">
            Sistem Yapılandırması sayfasına yönlendiriliyorsunuz...
        </div>
    )
}
