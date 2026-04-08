import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export async function POST(req: NextRequest) {
    try {
        const { patientId, dietitianId, doctorId } = await req.json()

        if (!patientId || !dietitianId) {
            return NextResponse.json({ error: "patientId ve dietitianId gerekli" }, { status: 400 })
        }

        const supabaseAdmin = getSupabaseAdmin()

        // Check if there's a "parked" assignment under the doctor
        if (doctorId) {
            const { data: parked } = await supabaseAdmin
                .from("patient_assignments")
                .select("id")
                .eq("patient_id", patientId)
                .eq("dietitian_id", doctorId)
                .maybeSingle()

            if (parked) {
                // Re-assign the parked record to the dietitian
                const { error } = await supabaseAdmin
                    .from("patient_assignments")
                    .update({ dietitian_id: dietitianId })
                    .eq("id", parked.id)

                if (error) {
                    return NextResponse.json({ error: error.message }, { status: 500 })
                }

                return NextResponse.json({ success: true, mode: "reassigned" })
            }
        }

        // Check if an assignment already exists for this patient+dietitian
        const { data: existing } = await supabaseAdmin
            .from("patient_assignments")
            .select("id")
            .eq("patient_id", patientId)
            .eq("dietitian_id", dietitianId)
            .maybeSingle()

        if (existing) {
            return NextResponse.json({ success: true, mode: "already_exists" })
        }

        // Insert new assignment
        const { error } = await supabaseAdmin
            .from("patient_assignments")
            .insert({
                patient_id: patientId,
                dietitian_id: dietitianId,
            })

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, mode: "inserted" })
    } catch (err: any) {
        console.error("assign-patient error:", err)
        return NextResponse.json({ error: err.message || "Sunucu hatası" }, { status: 500 })
    }
}
