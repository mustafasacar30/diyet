"use server"

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Creates a patient with full authentication capability.
 * 1. Creates auth user
 * 2. Creates profile with role 'patient'
 * 3. Creates patient record with all profile details
 */
export async function createPatientWithAuth(formData: FormData) {
    if (!supabaseServiceKey) {
        return { error: "Sunucu hatası: Servis anahtarı eksik." }
    }

    const email = formData.get("email") as string
    const password = formData.get("password") as string
    const fullName = formData.get("fullName") as string
    const notes = formData.get("notes") as string | null

    // Patient profile fields
    const weight = formData.get("weight") ? parseFloat(formData.get("weight") as string) : null
    const height = formData.get("height") ? parseFloat(formData.get("height") as string) : null
    const birthDate = formData.get("birthDate") as string | null
    const gender = formData.get("gender") as string | null
    const activityLevel = formData.get("activityLevel") ? parseInt(formData.get("activityLevel") as string) : 3

    if (!email || !password || !fullName) {
        return { error: "Lütfen tüm zorunlu alanları doldurun." }
    }

    if (password.length < 6) {
        return { error: "Şifre en az 6 karakter olmalıdır." }
    }

    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // 1. Create Auth User
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: fullName,
                role: 'patient'
            }
        })

        if (authError) throw authError
        if (!authData.user) throw new Error("Kullanıcı oluşturulamadı.")

        const userId = authData.user.id

        // 2. Create/Update Profile
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert({
                id: userId,
                role: 'patient',
                full_name: fullName,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' })

        if (profileError) {
            console.error("Profile error:", profileError)
        }

        // 3. Create Patient Record with all profile fields
        const patientRecord: any = {
            id: userId,
            full_name: fullName,
            email: email,
            notes: notes || null,
            status: 'active',
            user_id: userId,
            activity_level: activityLevel
        }

        // Add optional fields if provided
        if (weight) patientRecord.weight = weight
        if (height) patientRecord.height = height
        if (birthDate) patientRecord.birth_date = birthDate
        if (gender) patientRecord.gender = gender

        const { data: patientData, error: patientError } = await supabaseAdmin
            .from('patients')
            .upsert(patientRecord, { onConflict: 'id' })
            .select()
            .single()

        if (patientError) {
            console.error("Patient record error:", patientError)
            return {
                success: true,
                userId: userId,
                warning: "Kullanıcı oluşturuldu ancak hasta kaydında sorun oldu: " + patientError.message
            }
        }

        return { success: true, userId: userId, patientId: patientData?.id }

    } catch (error: any) {
        console.error("Create patient error:", error)
        return { error: error.message || "Bir hata oluştu" }
    }
}

/**
 * Sync an existing auth user (with patient role) to patients table
 */
export async function syncPatientFromAuth(userId: string, email: string, fullName: string) {
    if (!supabaseServiceKey) {
        return { error: "Sunucu hatası: Servis anahtarı eksik." }
    }

    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        const { error } = await supabaseAdmin
            .from('patients')
            .upsert({
                id: userId,
                full_name: fullName,
                email: email,
                user_id: userId,
                status: 'active'
            })

        if (error) throw error
        return { success: true }

    } catch (error: any) {
        console.error("Sync patient error:", error)
        return { error: error.message }
    }
}

/**
 * Add login credentials to an existing legacy patient (who has no auth account)
 * Creates auth user and links to existing patient record
 */
export async function addLoginToExistingPatient(
    patientId: string,
    email: string,
    password: string
) {
    if (!supabaseServiceKey) {
        return { error: "Sunucu hatası: Servis anahtarı eksik." }
    }

    if (!email || !password || !patientId) {
        return { error: "Eksik bilgi." }
    }

    if (password.length < 6) {
        return { error: "Şifre en az 6 karakter olmalıdır." }
    }

    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        // 1. Get patient info
        const { data: patient, error: patientFetchError } = await supabaseAdmin
            .from('patients')
            .select('full_name')
            .eq('id', patientId)
            .single()

        if (patientFetchError || !patient) {
            return { error: "Hasta bulunamadı." }
        }

        // 2. Create Auth User
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: patient.full_name,
                role: 'patient'
            }
        })

        if (authError) throw authError
        if (!authData.user) throw new Error("Auth hesabı oluşturulamadı.")

        const authUserId = authData.user.id

        // 3. Create profile
        await supabaseAdmin
            .from('profiles')
            .upsert({
                id: authUserId,
                role: 'patient',
                full_name: patient.full_name,
                updated_at: new Date().toISOString()
            })

        // 4. Update patient record to link with auth user
        const { error: updateError } = await supabaseAdmin
            .from('patients')
            .update({
                email: email,
                user_id: authUserId
            })
            .eq('id', patientId)

        if (updateError) {
            console.error("Patient update error:", updateError)
        }

        // 5. Copy diet plans to use auth user ID
        // Update diet_plans.patient_id from old patientId to... wait, we should keep patientId
        // Actually, we need to update the patient portal query to look up by user_id instead

        return {
            success: true,
            authUserId: authUserId,
            message: `${patient.full_name} için giriş bilgileri oluşturuldu: ${email}`
        }

    } catch (error: any) {
        console.error("Add login error:", error)
        return { error: error.message || "Bir hata oluştu" }
    }
}

/**
 * Register a patient self-service.
 * Receives the auth userId and full form data, sets status to 'pending' for admin approval.
 */
export async function registerPatientSelf(userId: string, email: string, data: any) {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        // 1. Update Profile (Auth trigger might have already created it)
        await supabaseAdmin
            .from('profiles')
            .update({
                role: 'patient',
                full_name: data.full_name,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId)

        // 2. Calculate birth_date from age
        let birthDateStr = null
        if (data.age && data.age > 0) {
            const today = new Date()
            const birthYear = today.getFullYear() - data.age
            const d = new Date(birthYear, 0, 1)
            const year = d.getFullYear()
            const month = String(d.getMonth() + 1).padStart(2, '0')
            const day = String(d.getDate()).padStart(2, '0')
            birthDateStr = `${year}-${month}-${day}`
        }

        // 3. Upsert Patient Record (Since we dropped the trigger, it might not exist)
        const { error: patientError } = await supabaseAdmin
            .from('patients')
            .upsert({
                id: userId,
                user_id: userId,
                email: email,
                full_name: data.full_name,
                gender: data.gender,
                birth_date: birthDateStr,
                weight: data.weight || null,
                height: data.height || null,
                activity_level: data.activity_level || 3,
                liked_foods: data.liked_foods || [],
                disliked_foods: data.disliked_foods || [],
                phone: data.phone || null,
                patient_goals: data.goals || [],
                program_template_id: data.program_template_id || null,
                status: 'pending' // Still requires admin approval
            })

        if (patientError) throw patientError

        // Helper: Check if UUID
        const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

        // 4. Insert Diseases
        if (data.disease_ids && data.disease_ids.length > 0) {
            const finalDiseaseIds: string[] = [];
            for (const idOrName of data.disease_ids) {
                if (isUUID(idOrName)) {
                    finalDiseaseIds.push(idOrName);
                } else {
                    const { data: newDisease } = await supabaseAdmin.from('diseases').insert({ name: idOrName }).select('id').single();
                    if (newDisease) finalDiseaseIds.push(newDisease.id);
                }
            }
            if (finalDiseaseIds.length > 0) {
                await supabaseAdmin.from('patient_diseases').insert(
                    finalDiseaseIds.map((id: string) => ({ patient_id: userId, disease_id: id }))
                )
            }
        }

        // 5. Insert Medications
        if (data.medication_ids && data.medication_ids.length > 0) {
            const finalMeds: { id: string, name: string }[] = [];
            for (const idOrName of data.medication_ids) {
                if (isUUID(idOrName)) {
                    const existing = await supabaseAdmin.from('medications').select('id, name').eq('id', idOrName).single();
                    if (existing.data) finalMeds.push(existing.data);
                } else {
                    const { data: newMed } = await supabaseAdmin.from('medications').insert({ name: idOrName }).select('id, name').single();
                    if (newMed) finalMeds.push(newMed);
                }
            }
            if (finalMeds.length > 0) {
                await supabaseAdmin.from('patient_medications').insert(
                    finalMeds.map((med: any) => ({
                        patient_id: userId,
                        medication_id: med.id,
                        medication_name: med.name,
                        started_at: new Date().toISOString().split('T')[0]
                    }))
                )
            }
        }

        return { success: true }
    } catch (e: any) {
        console.error("Self register error:", e)
        return { error: e.message }
    }
}

/**
 * Fetch metadata for the public registration page
 */
export async function getRegistrationMetadata() {
    if (!supabaseServiceKey) return { error: "Sunucu hatası: Servis anahtarı eksik." }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        const { data: diseases } = await supabaseAdmin.from('diseases').select('*').order('name')
        const { data: medications } = await supabaseAdmin.from('medications').select('*').order('name')
        const { data: programs } = await supabaseAdmin.from('program_templates').select('id, name').eq('is_active', true).order('name')
        
        let settingsValue: any = null
        const { data: settingsData } = await supabaseAdmin
            .from('app_settings')
            .select('value')
            .eq('key', 'registration_settings')
            .maybeSingle();
        if (settingsData?.value) {
            settingsValue = settingsData.value
        } else {
            const { data: legacySettingsData } = await supabaseAdmin
                .from('app_settings')
                .select('value')
                .eq('id', 'registration_settings')
                .maybeSingle();
            if (legacySettingsData?.value) settingsValue = legacySettingsData.value
        }

        return { 
            diseases: diseases || [], 
            medications: medications || [], 
            programs: programs || [],
            settingsValue
        }
    } catch (e: any) {
        return { error: e.message }
    }
}


/**
 * Approve a pending patient and auto-confirm their email so they can log in
 */
export async function approvePatient(patientId: string, userId?: string | null) {
    if (!supabaseServiceKey) return { error: 'Sunucu hatası: Servis anahtarı eksik.' }
    try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        })

        // 1. Update patient status to active
        const { error: updateError } = await supabaseAdmin
            .from('patients')
            .update({ status: 'active' })
            .eq('id', patientId);
            
        if (updateError) throw updateError;

        // 2. If they have a user_id, auto-confirm their email in Supabase Auth
        if (userId) {
            const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
                email_confirm: true
            });
            if (authError) {
                console.error('Failed to auto-confirm email for user', userId, authError);
                // We don't fail the approval if email confirm fails, but we log it
            }
        }

        return { success: true }
    } catch (e: any) {
        console.error('Patient approval error:', e);
        return { error: e.message }
    }
}
