import { supabase } from "@/lib/supabase"

export type PlannerScope = 'global' | 'team' | 'program' | 'patient'

export type TeamScopeContext = {
    role: string | null
    canUseGlobal: boolean
    teamOwnerId: string | null
}

type RoleMetadata = {
    role?: string | null
    is_global_access?: boolean | null
}

export async function resolveTeamScopeContextForUser(
    userId: string | null | undefined,
    metadata?: RoleMetadata
): Promise<TeamScopeContext> {
    if (!userId) {
        return { role: null, canUseGlobal: true, teamOwnerId: null }
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role,is_global_access')
        .eq('id', userId)
        .maybeSingle()

    const role = (profile?.role || metadata?.role || null) as string | null
    const isGlobalAccess = Boolean(profile?.is_global_access || metadata?.is_global_access)

    if (role === 'admin' || isGlobalAccess) {
        return { role, canUseGlobal: true, teamOwnerId: null }
    }

    if (role === 'doctor') {
        return { role, canUseGlobal: false, teamOwnerId: userId }
    }

    if (role === 'dietitian') {
        const { data: relation } = await supabase
            .from('team_members')
            .select('supervisor_id')
            .eq('member_id', userId)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

        return {
            role,
            canUseGlobal: false,
            // Fallback: isolated personal team context instead of leaking to global.
            teamOwnerId: relation?.supervisor_id || userId
        }
    }

    return { role, canUseGlobal: true, teamOwnerId: null }
}

export async function resolveTeamScopeContextFromAuth(): Promise<{ userId: string | null } & TeamScopeContext> {
    const { data: { user } } = await supabase.auth.getUser()
    const userId = user?.id || null

    const context = await resolveTeamScopeContextForUser(userId, {
        role: user?.user_metadata?.role || null,
        is_global_access: user?.user_metadata?.is_global_access === true
    })

    return {
        userId,
        ...context
    }
}

export function resolvePlannerScope(
    patientId: string | null | undefined,
    programTemplateId: string | null | undefined,
    context: TeamScopeContext
): PlannerScope {
    if (patientId) return 'patient'
    if (programTemplateId) return 'program'
    if (context.teamOwnerId && !context.canUseGlobal) return 'team'
    return 'global'
}
