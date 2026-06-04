"use server"

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function adminGetMedications() {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { data, error } = await supabaseAdmin.from('medications').select('*').order('name')
        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminSaveMedication(medData: any) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { error } = await supabaseAdmin.from('medications').upsert(medData)
        if (error) throw error
        return { success: true }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminDeleteMedication(id: string) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { error } = await supabaseAdmin.from('medications').delete().eq('id', id)
        if (error) throw error
        return { success: true }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminGetMedicationInteractions(medId: string) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        const { data, error } = await supabaseAdmin.from('medication_interactions').select('*').eq('medication_id', medId).order('created_at')
        if (error) throw error
        return { data }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminSaveMedicationInteractions(medId: string, rules: any[]) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })
        await supabaseAdmin.from('medication_interactions').delete().eq('medication_id', medId)
        if (rules.length > 0) {
            const { error } = await supabaseAdmin.from('medication_interactions').insert(rules)
            if (error) throw error
        }
        return { success: true }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminFetchAllUsers() {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        // 1. Fetch all profiles (admin client bypasses RLS)
        const { data: profiles, error: profilesError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email, role, title, created_at, valid_until, max_devices')
            .order('created_at', { ascending: false })

        if (profilesError) throw profilesError

        // 2. Fetch all auth users to get real emails
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({
            perPage: 1000
        })

        if (authError) throw authError

        // 3. Create email map from auth.users
        const authEmailMap = new Map<string, string>()
        if (authData?.users) {
            for (const user of authData.users) {
                authEmailMap.set(user.id, user.email || '')
            }
        }

        // 4. Merge: use auth email if profile email is missing or different
        const mergedUsers = (profiles || []).map(p => ({
            ...p,
            email: authEmailMap.get(p.id) || p.email || '-'
        }))

        // 5. Filter out incomplete patients
        const { data: validPatients } = await supabaseAdmin
            .from('patients')
            .select('id')
            .not('gender', 'is', null)

        const validPatientIds = new Set(validPatients?.map(p => p.id) || [])

        const filteredUsers = mergedUsers.filter(u => {
            if (u.role === 'patient') {
                return validPatientIds.has(u.id)
            }
            return true
        })

        return { data: filteredUsers }
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function adminUpdateUserProfile(
    targetUserId: string,
    updates: {
        full_name?: string
        title?: string | null
        max_devices?: number
        valid_until?: string | null
        new_email?: string
        new_password?: string
    }
) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        // 1. Update auth user (email/password) if needed
        const authUpdates: any = {}
        if (updates.new_email) {
            authUpdates.email = updates.new_email
            authUpdates.email_confirm = true
        }
        if (updates.new_password) {
            authUpdates.password = updates.new_password
        }

        if (Object.keys(authUpdates).length > 0) {
            // Verify user exists
            const { data: checkUser, error: checkError } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
            if (checkError || !checkUser.user) {
                throw new Error("Kullanıcı sistemde bulunamadı (Auth kaydı yok).")
            }

            const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
                targetUserId,
                authUpdates
            )
            if (updateError) {
                throw new Error("Kullanıcı kimlik bilgileri güncellenemedi: " + updateError.message)
            }
        }

        // 2. Update profile data
        const profileUpdates: any = {}
        if (updates.full_name !== undefined) profileUpdates.full_name = updates.full_name
        if (updates.title !== undefined) profileUpdates.title = updates.title
        if (updates.max_devices !== undefined) profileUpdates.max_devices = updates.max_devices
        if (updates.valid_until !== undefined) profileUpdates.valid_until = updates.valid_until
        // Also sync email to profiles table
        if (updates.new_email) profileUpdates.email = updates.new_email

        if (Object.keys(profileUpdates).length > 0) {
            const { error: profileUpdateError } = await supabaseAdmin
                .from('profiles')
                .update(profileUpdates)
                .eq('id', targetUserId)

            if (profileUpdateError) {
                throw new Error("Profil bilgileri güncellenemedi: " + profileUpdateError.message)
            }
        }

        return { success: true }
    } catch (e: any) {
        return { error: e.message }
    }
}
