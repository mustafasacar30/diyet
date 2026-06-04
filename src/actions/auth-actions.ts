"use server"

import { createClient } from "@supabase/supabase-js"
import { headers } from "next/headers"

// Note: Ensure these environment variables are available
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function createUser(formData: FormData) {
    if (!supabaseServiceKey) {
        return { error: "Sunucu hatası: Servis anahtarı eksik." }
    }

    const email = formData.get("email") as string
    const password = formData.get("password") as string
    const fullName = formData.get("fullName") as string
    const role = formData.get("role") as string
    const title = formData.get("title") as string
    const validUntil = formData.get("validUntil") as string

    if (!email || !password || !fullName || !role) {
        return { error: "Lütfen tüm zorunlu alanları doldurun." }
    }

    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // 1. Check if user exists (Optional, signUp handles checking but we want clean error)
        // 2. Create User
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: fullName,
                role: role,
                title: title || undefined
            }
        })

        if (authError) throw authError

        if (!authData.user) throw new Error("Kullanıcı oluşturulamadı.")

        // 3. Create Profile (Trigger usually handles this, but we can do it explicitly/update)
        // If we rely on trigger, we done. If we want to ensure or add extra fields:
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert({
                id: authData.user.id,
                role: role,
                full_name: fullName,
                title: title,
                valid_until: validUntil || null,
                updated_at: new Date().toISOString()
            })

        if (profileError) {
            console.error("Profile update error:", profileError)
            // Non-blocking error, user is created
        }

        // 4. If role is 'patient', also create entry in patients table for sync
        if (role === 'patient') {
            const { error: patientError } = await supabaseAdmin
                .from('patients')
                .upsert({
                    id: authData.user.id,
                    user_id: authData.user.id,
                    full_name: fullName,
                    email: email,
                    status: 'active'
                })

            if (patientError) {
                console.error("Patient sync error:", patientError)
                // Non-blocking - user and profile are created
            } else {
                console.log("✅ Patient synced to patients table:", authData.user.id)
            }
        }

        return { success: true, userId: authData.user.id }

    } catch (error: any) {
        console.error("Create user error:", error)
        return { error: error.message || "Bir hata oluştu" }
    }
}

export async function deleteUserCompletely(userId: string) {
    if (!supabaseServiceKey) {
        return { error: "Sunucu hatası: Servis anahtarı eksik." }
    }

    if (!userId) {
        return { error: "Kullanıcı ID'si gerekli." }
    }

    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // 1. Delete from patients table (if exists)
        await supabaseAdmin.from('patients').delete().eq('user_id', userId)
        await supabaseAdmin.from('patients').delete().eq('id', userId)

        // 2. Delete from profiles table
        await supabaseAdmin.from('profiles').delete().eq('id', userId)

        // 3. Delete from user_devices table (if exists)
        await supabaseAdmin.from('user_devices').delete().eq('user_id', userId)

        // 4. Delete from auth.users (the most important step)
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (authError) throw authError

        console.log("✅ User completely deleted:", userId)
        return { success: true }

    } catch (error: any) {
        console.error("Delete user error:", error)
        return { error: error.message || "Silme sırasında bir hata oluştu" }
    }
}

export async function logPatientLogin(userId: string) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }

    try {
        let ip = 'Bilinmeyen IP'
        let userAgent = 'Bilinmeyen Cihaz'
        
        try {
            const headersList = await headers()
            ip = headersList.get('x-forwarded-for') || headersList.get('x-real-ip') || 'Bilinmeyen IP'
            userAgent = headersList.get('user-agent') || 'Bilinmeyen Cihaz'
        } catch (headerError) {
            console.error("Header okuma hatası:", headerError)
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // Ensure user is patient to avoid FK violations if admins login
        const { data: patientData } = await supabaseAdmin.from('patients').select('id').eq('user_id', userId).single()
        const patientId = patientData?.id || userId; // Fallback to user id directly if matches

        await supabaseAdmin.from('patient_activity_logs').insert({
            patient_id: patientId,
            action_type: 'login_success',
            metadata: {
                ip_address: ip,
                user_agent: userAgent
            }
        })

        return { success: true }
    } catch (error: any) {
        console.error("Log patient login error:", error)
        return { error: error.message || "Loglanamadı" }
    }
}
