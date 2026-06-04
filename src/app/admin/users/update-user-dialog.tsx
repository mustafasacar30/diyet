"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { supabase } from "@/lib/supabase"
import { adminUpdateUserProfile } from "@/actions/admin-db-actions"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Loader2 } from "lucide-react"

const formSchema = z.object({
    full_name: z.string().min(2, "Ad soyad en az 2 karakter olmalıdır"),
    email: z.string().email("Geçerli bir e-posta adresi giriniz"),
    password: z.string().optional(),
    title: z.string().optional(),
    max_devices: z.number().min(1).optional(),
    valid_until: z.string().optional().nullable(),
})

interface UpdateUserDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    user: {
        id: string
        full_name: string | null
        email: string | null
        title: string | null
        max_devices?: number | null
        valid_until?: string | null
        role?: string
    } | null
    onSuccess: () => void
}

export function UpdateUserDialog({ open, onOpenChange, user, onSuccess }: UpdateUserDialogProps) {
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            full_name: "",
            email: "",
            password: "",
            title: "",
            max_devices: 1,
            valid_until: ""
        },
    })

    // Reset form when user changes
    useEffect(() => {
        if (user) {
            form.reset({
                full_name: user.full_name || "",
                email: user.email || "",
                password: "",
                title: user.title || "",
                max_devices: user.max_devices || 1, // Use user's limit or default 1
                valid_until: user.valid_until ? new Date(user.valid_until).toISOString().split('T')[0] : ""
            })
        }
    }, [user, form])

    async function onSubmit(values: z.infer<typeof formSchema>) {
        if (!user) return
        setLoading(true)

        try {
            const result = await adminUpdateUserProfile(user.id, {
                full_name: values.full_name,
                title: values.title || null,
                max_devices: values.max_devices,
                valid_until: values.valid_until || null,
                new_email: values.email !== user.email ? values.email : undefined,
                new_password: values.password && values.password.length > 0 ? values.password : undefined
            })

            if (result.error) {
                throw new Error(result.error)
            }

            onSuccess()
            onOpenChange(false)
            form.reset()

        } catch (error: any) {
            console.error("Error updating user:", error)
            alert("Güncelleme hatası: " + error.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Kullanıcı Düzenle</DialogTitle>
                    <DialogDescription>
                        Kullanıcı bilgilerini güncelleyin. Şifre alanını boş bırakırsanız şifre değişmez.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="full_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Ad Soyad</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Ad Soyad" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>E-posta</FormLabel>
                                    <FormControl>
                                        <Input placeholder="ornek@email.com" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="title"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Ünvan (Opsiyonel)</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Dyt., Dr. vb." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="max_devices"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Cihaz Limiti</FormLabel>
                                    <FormControl>
                                        <Input type="number" min="1" max="10" placeholder="1" {...field} onChange={e => field.onChange(parseInt(e.target.value))} />
                                    </FormControl>
                                    <FormDescription>Bu kullanıcının kaç farklı cihazdan giriş yapabileceğini belirtin (Varsayılan: 1).</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        {user?.role === 'patient' && (
                            <FormField
                                control={form.control}
                                name="valid_until"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Erişim Bitiş Tarihi</FormLabel>
                                        <FormControl>
                                            <Input type="date" {...field} value={field.value || ""} />
                                        </FormControl>
                                        <FormDescription>Kullanıcının sisteme giriş yapabileceği son tarih.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                        <FormField
                            control={form.control}
                            name="password"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Yeni Şifre (Opsiyonel)</FormLabel>
                                    <div className="relative">
                                        <FormControl>
                                            <Input
                                                type={showPassword ? "text" : "password"}
                                                placeholder="Değiştirmek için yeni şifre girin"
                                                {...field}
                                            />
                                        </FormControl>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                            onClick={() => setShowPassword(!showPassword)}
                                        >
                                            {showPassword ? (
                                                <EyeOff className="h-4 w-4 text-gray-500" />
                                            ) : (
                                                <Eye className="h-4 w-4 text-gray-500" />
                                            )}
                                        </Button>
                                    </div>
                                    <FormDescription>
                                        Şifreyi değiştirmek istemiyorsanız boş bırakın.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <Button type="submit" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Güncelle
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog >
    )
}
