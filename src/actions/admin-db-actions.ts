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
