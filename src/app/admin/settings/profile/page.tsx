"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Save, Upload, Image as ImageIcon, Trash2 } from "lucide-react"

type StaffProfileForm = {
    full_name: string
    title: string
    logo_url: string | null
    pdf_footer_text: string
}

const LOGO_BUCKET = "staff-logos"

export default function StaffProfileSettingsPage() {
    const router = useRouter()
    const { profile, refreshProfile, loading: authLoading } = useAuth()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [formData, setFormData] = useState<StaffProfileForm>({
        full_name: "",
        title: "",
        logo_url: null,
        pdf_footer_text: "",
    })

    const canManageLogo = profile?.role === "doctor" || profile?.role === "dietitian"
    const pageTitle = useMemo(() => {
        if (profile?.role === "doctor") return "Doktor Profili"
        if (profile?.role === "dietitian") return "Diyetisyen Profili"
        return "Profil Ayarları"
    }, [profile?.role])

    const loadProfileFromDb = async (profileId: string) => {
        const { data, error: profileError } = await supabase
            .from("profiles")
            .select("full_name, title, logo_url, pdf_footer_text")
            .eq("id", profileId)
            .single()

        if (profileError) throw profileError

        setFormData({
            full_name: data.full_name || "",
            title: data.title || "",
            logo_url: data.logo_url || null,
            pdf_footer_text: data.pdf_footer_text || "",
        })
    }

    useEffect(() => {
        if (authLoading) return

        if (!canManageLogo) {
            router.replace("/admin")
            return
        }

        if (!profile?.id) return

        let active = true

        const bootstrap = async () => {
            try {
                setLoading(true)
                await loadProfileFromDb(profile.id)
            } catch (err: any) {
                console.error("Profile load error:", err)
                if (active) {
                    setError(err.message || "Profil bilgileri yüklenemedi.")
                }
            } finally {
                if (active) setLoading(false)
            }
        }

        bootstrap()

        return () => {
            active = false
        }
    }, [authLoading, canManageLogo, profile, router])

    const handleUpload = async (file: File | null) => {
        if (!file || !profile?.id) return

        const isImage = file.type.startsWith("image/")
        if (!isImage) {
            setError("Lütfen geçerli bir görsel dosyası seçin.")
            return
        }

        const maxSizeMb = 5
        if (file.size > maxSizeMb * 1024 * 1024) {
            setError(`Logo dosyası en fazla ${maxSizeMb} MB olabilir.`)
            return
        }

        setUploading(true)
        setError(null)
        setSuccess(null)

        try {
            const fileExt = file.name.split(".").pop()?.toLowerCase() || "png"
            const fileName = `${profile.id}/logo-${Date.now()}.${fileExt}`

            const { error: uploadError } = await supabase.storage
                .from(LOGO_BUCKET)
                .upload(fileName, file, {
                    upsert: false,
                    contentType: file.type,
                })

            if (uploadError) throw uploadError

            const { data } = supabase.storage
                .from(LOGO_BUCKET)
                .getPublicUrl(fileName)

            setFormData((prev) => ({ ...prev, logo_url: data.publicUrl }))
            setSuccess("Logo yüklendi. Kaydet dediğinizde profilinize işlenecek.")
        } catch (err: any) {
            console.error("Logo upload error:", err)
            setError(err.message || "Logo yüklenirken bir hata oluştu.")
        } finally {
            setUploading(false)
        }
    }

    const handleSave = async () => {
        if (!profile?.id) return

        setSaving(true)
        setError(null)
        setSuccess(null)

        try {
            const response = await fetch("/api/profile", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    full_name: formData.full_name.trim() || null,
                    title: formData.title.trim() || null,
                    logo_url: formData.logo_url,
                    pdf_footer_text: formData.pdf_footer_text.trim() || null,
                }),
            })

            const result = await response.json()
            if (!response.ok) {
                throw new Error(result?.error || "Profil kaydedilemedi.")
            }

            setFormData({
                full_name: result.profile?.full_name || "",
                title: result.profile?.title || "",
                logo_url: result.profile?.logo_url || null,
                pdf_footer_text: result.profile?.pdf_footer_text || "",
            })

            await refreshProfile()
            setSuccess(formData.logo_url ? "Profil ve logo güncellendi." : "Profil bilgileriniz güncellendi.")
        } catch (err: any) {
            console.error("Profile save error:", err)
            setError(err.message || "Profil kaydedilirken bir hata oluştu.")
        } finally {
            setSaving(false)
        }
    }

    if (authLoading || loading) {
        return (
            <div className="flex h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    return (
        <div className="mx-auto max-w-3xl space-y-6 pb-20">
            <div className="space-y-1">
                <h1 className="text-2xl font-bold text-slate-900">{pageTitle}</h1>
                <p className="text-sm text-slate-500">
                    Hastalarınızın PDF çıktısında görünecek logo ve temel profil bilgilerini buradan yönetebilirsiniz.
                </p>
            </div>

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {success && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {success}
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Profil Bilgileri</CardTitle>
                    <CardDescription>
                        İsim ve unvan bilgisi logoyla birlikte uzman profilinizde saklanır.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid gap-2">
                        <Label htmlFor="full_name">Ad Soyad</Label>
                        <Input
                            id="full_name"
                            value={formData.full_name}
                            onChange={(e) => setFormData((prev) => ({ ...prev, full_name: e.target.value }))}
                            placeholder="Ad Soyad"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="title">Unvan</Label>
                        <Input
                            id="title"
                            value={formData.title}
                            onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                            placeholder={profile?.role === "doctor" ? "Uzm. Dr." : "Diyetisyen"}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="pdf_footer_text">PDF Logo Alti Metin</Label>
                        <Input
                            id="pdf_footer_text"
                            value={formData.pdf_footer_text}
                            onChange={(e) => setFormData((prev) => ({ ...prev, pdf_footer_text: e.target.value }))}
                            placeholder={profile?.role === "doctor" ? "Doktor adi / Klinik adi" : "Diyetisyen adi / Klinik adi"}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>PDF Logosu</CardTitle>
                    <CardDescription>
                        Hasta panelinden oluşturulan diyet listesi PDF dosyalarında bu logo kullanılır.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div className="space-y-2">
                                <p className="text-sm font-medium text-slate-700">Önerilen format: PNG veya JPG</p>
                                <p className="text-xs text-slate-500">Yatay logolar PDF üst kısmında daha temiz görünür.</p>
                            </div>
                            <Label
                                htmlFor="logo-upload"
                                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                Logo Seç
                            </Label>
                        </div>
                        <Input
                            id="logo-upload"
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            className="hidden"
                            onChange={(e) => handleUpload(e.target.files?.[0] || null)}
                        />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                        {formData.logo_url ? (
                            <div className="space-y-4">
                                <div className="flex min-h-32 items-center justify-center rounded-xl bg-slate-50 p-4">
                                    <img
                                        src={formData.logo_url}
                                        alt="Uzman logosu"
                                        className="max-h-24 max-w-full object-contain"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="gap-2 text-red-600 hover:text-red-700"
                                    onClick={() => {
                                        setFormData((prev) => ({ ...prev, logo_url: null }))
                                        setSuccess(null)
                                    }}
                                >
                                    <Trash2 className="h-4 w-4" />
                                    Logoyu Kaldır
                                </Button>
                            </div>
                        ) : (
                            <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl bg-slate-50 text-slate-500">
                                <ImageIcon className="h-8 w-8" />
                                <p className="text-sm">Henüz yüklenmiş bir logo yok.</p>
                            </div>
                        )}
                    </div>
                </CardContent>
                <CardFooter className="justify-end">
                    <Button onClick={handleSave} disabled={saving || uploading} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Kaydet
                    </Button>
                </CardFooter>
            </Card>
        </div>
    )
}
