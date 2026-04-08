import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export async function POST(req: NextRequest) {
    try {
        const { assignmentId, doctorId, mode } = await req.json()

        if (!assignmentId) {
            return NextResponse.json({ error: "assignmentId gerekli" }, { status: 400 })
        }

        const supabaseAdmin = getSupabaseAdmin()

        if (mode === "park" && doctorId) {
            // "Park" the assignment under the doctor
            const { error } = await supabaseAdmin
                .from("patient_assignments")
                .update({ dietitian_id: doctorId })
                .eq("id", assignmentId)

            if (error) {
                console.error("Error parking patient assignment:", error)
                // Fallback: delete the record
                const { error: delError } = await supabaseAdmin
                    .from("patient_assignments")
                    .delete()
                    .eq("id", assignmentId)

                if (delError) {
                    return NextResponse.json({ error: delError.message }, { status: 500 })
                }
            }
        } else {
            // Delete the assignment
            const { error } = await supabaseAdmin
                .from("patient_assignments")
                .delete()
                .eq("id", assignmentId)

            if (error) {
                return NextResponse.json({ error: error.message }, { status: 500 })
            }
        }

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error("remove-patient-assignment error:", err)
        return NextResponse.json({ error: err.message || "Sunucu hatası" }, { status: 500 })
    }
}
