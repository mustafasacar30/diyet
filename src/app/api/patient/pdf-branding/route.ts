import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

type ProfileLogo = {
    id: string
    role: string | null
    logo_url: string | null
    pdf_footer_text: string | null
}

function isCustomLogoUrl(url?: string | null): boolean {
    const clean = (url || "").trim().toLowerCase()
    if (!clean) return false
    if (clean.includes("/logo-lite.png")) return false
    if (clean.endsWith("/logo.png")) return false
    return true
}

export async function GET() {
    try {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll()
                    },
                    setAll() {
                        // no-op
                    },
                },
            }
        )

        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (authError || !authData?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const authUserId = authData.user.id

        // Legacy patient accounts can be linked with patients.user_id; new flow uses patients.id
        let patientId: string | null = null

        const { data: legacyPatient } = await supabaseAdmin
            .from("patients")
            .select("id")
            .eq("user_id", authUserId)
            .neq("id", authUserId)
            .limit(1)
            .maybeSingle()

        if (legacyPatient?.id) {
            patientId = legacyPatient.id
        } else {
            const { data: directPatient } = await supabaseAdmin
                .from("patients")
                .select("id")
                .eq("id", authUserId)
                .maybeSingle()
            patientId = directPatient?.id || null
        }

        if (!patientId) {
            return NextResponse.json({ logoUrl: null, footerText: null, source: "none" })
        }

        const { data: assignments } = await supabaseAdmin
            .from("patient_assignments")
            .select("dietitian_id")
            .eq("patient_id", patientId)

        const assignedSpecialistIds = Array.from(
            new Set((assignments || []).map((row: any) => row.dietitian_id).filter(Boolean))
        )

        // Fallback for environments where assignments can be empty but RPC still resolves the responsible specialist.
        if (assignedSpecialistIds.length === 0) {
            try {
                const { data: rpcDietitianId } = await supabase.rpc("get_my_dietitian")
                if (rpcDietitianId) {
                    assignedSpecialistIds.push(rpcDietitianId as string)
                }
            } catch {
                // ignore rpc fallback errors
            }
        }

        if (assignedSpecialistIds.length === 0) {
            return NextResponse.json({ logoUrl: null, footerText: null, source: "none", trace: "no-assignment" })
        }

        const { data: teamRows } = await supabaseAdmin
            .from("team_members")
            .select("member_id, supervisor_id")
            .in("member_id", assignedSpecialistIds)

        const supervisorIds = Array.from(
            new Set((teamRows || []).map((row: any) => row.supervisor_id).filter(Boolean))
        )

        const candidateIds = Array.from(new Set([...assignedSpecialistIds, ...supervisorIds]))
        const { data: profiles } = await supabaseAdmin
            .from("profiles")
            .select("id, role, logo_url, pdf_footer_text")
            .in("id", candidateIds)

        const profileMap = new Map<string, ProfileLogo>()
        for (const profile of (profiles || []) as ProfileLogo[]) {
            profileMap.set(profile.id, profile)
        }

        const doctorLogoFromSupervisor = supervisorIds
            .map((id) => profileMap.get(id))
            .find((profile) => profile?.role === "doctor" && isCustomLogoUrl(profile?.logo_url))

        const doctorLogoFromAssigned = assignedSpecialistIds
            .map((id) => profileMap.get(id))
            .find((profile) => profile?.role === "doctor" && isCustomLogoUrl(profile?.logo_url))

        const dietitianLogo = assignedSpecialistIds
            .map((id) => profileMap.get(id))
            .find((profile) => profile?.role === "dietitian" && isCustomLogoUrl(profile?.logo_url))

        const fallbackAssignedLogo = assignedSpecialistIds
            .map((id) => profileMap.get(id))
            .find((profile) => isCustomLogoUrl(profile?.logo_url))

        const fallbackSupervisorLogo = supervisorIds
            .map((id) => profileMap.get(id))
            .find((profile) => isCustomLogoUrl(profile?.logo_url))

        // Requested behavior preference: doctor logo should win over dietitian when available.
        const selectedLogoProfile =
            doctorLogoFromSupervisor ||
            doctorLogoFromAssigned ||
            dietitianLogo ||
            fallbackAssignedLogo ||
            fallbackSupervisorLogo ||
            null

        const { data: teamBrandingRows } = await supabaseAdmin
            .from("team_pdf_branding")
            .select("supervisor_id, footer_text, logo_url")
            .in("supervisor_id", supervisorIds)

        const teamTextMap = new Map<string, string>()
        const teamLogoMap = new Map<string, string>()
        for (const row of teamBrandingRows || []) {
            const text = (row as any)?.footer_text?.trim?.() || ""
            if (text) {
                teamTextMap.set((row as any).supervisor_id, text)
            }
            const logoUrl = ((row as any)?.logo_url || "").trim()
            if (isCustomLogoUrl(logoUrl)) {
                teamLogoMap.set((row as any).supervisor_id, logoUrl)
            }
        }

        const teamLogoUrl = supervisorIds
            .map((id) => teamLogoMap.get(id) || null)
            .find((url) => !!url) || null

        const teamText = supervisorIds
            .map((id) => teamTextMap.get(id) || "")
            .find((text) => !!text) || null

        const doctorTextFromSupervisor = supervisorIds
            .map((id) => profileMap.get(id))
            .find((profile) => profile?.role === "doctor" && !!profile?.pdf_footer_text?.trim())?.pdf_footer_text?.trim() || null

        const doctorTextFromAssigned = assignedSpecialistIds
            .map((id) => profileMap.get(id))
            .find((profile) => profile?.role === "doctor" && !!profile?.pdf_footer_text?.trim())?.pdf_footer_text?.trim() || null

        const dietitianText = assignedSpecialistIds
            .map((id) => profileMap.get(id))
            .find((profile) => profile?.role === "dietitian" && !!profile?.pdf_footer_text?.trim())?.pdf_footer_text?.trim() || null

        const selectedFooterText = teamText || doctorTextFromSupervisor || doctorTextFromAssigned || dietitianText || null

        return NextResponse.json({
            logoUrl: teamLogoUrl || selectedLogoProfile?.logo_url || null,
            footerText: selectedFooterText,
            source: teamLogoUrl ? "team" : (selectedLogoProfile?.role || "none"),
            profileId: selectedLogoProfile?.id || null,
            trace: {
                patientId,
                assignedSpecialistIds,
                supervisorIds,
                teamLogoUrl,
                selectedLogoProfileId: selectedLogoProfile?.id || null,
            },
        })
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "Internal Server Error" },
            { status: 500 }
        )
    }
}
