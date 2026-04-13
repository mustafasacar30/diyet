import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

function isAuthorizedCaller(role: string | null | undefined, callerId: string, supervisorId: string): boolean {
    if (role === "admin") return true
    if (role === "doctor" && callerId === supervisorId) return true
    return false
}

export async function GET(request: NextRequest) {
    try {
        const supervisorId = request.nextUrl.searchParams.get("supervisor_id")
        if (!supervisorId) {
            return NextResponse.json({ error: "supervisor_id gerekli" }, { status: 400 })
        }

        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll()
                    },
                    setAll() {},
                },
            }
        )

        const { data: authData } = await supabase.auth.getUser()
        const callerId = authData?.user?.id
        if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const { data: callerProfile } = await supabaseAdmin
            .from("profiles")
            .select("role")
            .eq("id", callerId)
            .single()

        if (!isAuthorizedCaller(callerProfile?.role, callerId, supervisorId)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }

        const { data } = await supabaseAdmin
            .from("team_pdf_branding")
            .select("footer_text, logo_url")
            .eq("supervisor_id", supervisorId)
            .maybeSingle()

        return NextResponse.json({
            footerText: data?.footer_text || "",
            logoUrl: data?.logo_url || null,
        })
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const supervisorId = body?.supervisor_id as string | undefined
        const footerTextRaw = body?.footer_text as string | null | undefined
        const logoUrlRaw = body?.logo_url as string | null | undefined

        if (!supervisorId) {
            return NextResponse.json({ error: "supervisor_id gerekli" }, { status: 400 })
        }

        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() {
                        return cookieStore.getAll()
                    },
                    setAll() {},
                },
            }
        )

        const { data: authData } = await supabase.auth.getUser()
        const callerId = authData?.user?.id
        if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

        const { data: callerProfile } = await supabaseAdmin
            .from("profiles")
            .select("role")
            .eq("id", callerId)
            .single()

        if (!isAuthorizedCaller(callerProfile?.role, callerId, supervisorId)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }

        const footerText = (footerTextRaw || "").trim()
        const logoUrl = (logoUrlRaw || "").trim() || null

        const { error } = await supabaseAdmin
            .from("team_pdf_branding")
            .upsert(
                {
                    supervisor_id: supervisorId,
                    footer_text: footerText || null,
                    logo_url: logoUrl,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "supervisor_id" }
            )

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, footerText, logoUrl })
    } catch (error: any) {
        return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 })
    }
}

