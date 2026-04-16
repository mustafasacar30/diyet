import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

const ALLOWED_ROLES = new Set(["admin", "doctor", "dietitian"])
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeText(raw: unknown): string {
    if (typeof raw !== "string") return ""
    return raw.trim()
}

function asUuid(value: unknown): string | null {
    const text = normalizeText(value)
    if (!text) return null
    return UUID_REGEX.test(text) ? text : null
}

export async function POST(req: NextRequest) {
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
        const callerId = authData?.user?.id
        if (authError || !callerId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { data: callerProfile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("role")
            .eq("id", callerId)
            .maybeSingle()

        if (profileError || !ALLOWED_ROLES.has(String(callerProfile?.role || ""))) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }

        const body = await req.json().catch(() => ({}))
        const idsRaw: unknown[] = Array.isArray(body?.ids) ? body.ids : []
        const ids = Array.from(
            new Set(idsRaw.map(asUuid).filter((v): v is string => Boolean(v)))
        )

        if (ids.length === 0) {
            return NextResponse.json({ error: "Silinecek kayit secilmedi." }, { status: 400 })
        }
        if (ids.length > 2000) {
            return NextResponse.json({ error: "Tek istekte en fazla 2000 kayit silinebilir." }, { status: 400 })
        }

        const { error: deleteError, count } = await supabaseAdmin
            .from("menu_import_pool")
            .delete({ count: "exact" })
            .in("id", ids)

        if (deleteError) {
            return NextResponse.json({ error: deleteError.message }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            deleted: Number(count || 0),
            requested: ids.length,
        })
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || "menu_import_pool delete basarisiz" },
            { status: 500 }
        )
    }
}

