"use client"

import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type UserRole = 'admin' | 'doctor' | 'dietitian' | 'patient'

type UserProfile = {
    id: string
    role: UserRole
    full_name: string | null
    avatar_url: string | null
    title: string | null
    valid_until?: string | null
}

type AuthContextType = {
    user: User | null
    profile: UserProfile | null
    loading: boolean
    isAdmin: boolean
    isDoctor: boolean
    isDietitian: boolean
    isPatient: boolean
    isStaff: boolean
    refreshProfile: () => Promise<void>
    impersonateUser: (userId: string) => Promise<void>
    stopImpersonation: () => void
    isImpersonating: boolean
    signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    loading: true,
    isAdmin: false,
    isDoctor: false,
    isDietitian: false,
    isPatient: false,
    isStaff: false,
    refreshProfile: async () => { },
    impersonateUser: async () => { },
    stopImpersonation: () => { },
    isImpersonating: false,
    signOut: async () => { }
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [impersonatedId, _setImpersonatedId] = useState<string | null>(null)

    // Ref to hold impersonatedId for closures (avoids stale state in listeners)
    const impersonatedIdRef = useRef<string | null>(null)

    // Helper to update both state and ref
    const setImpersonatedId = (id: string | null) => {
        impersonatedIdRef.current = id
        _setImpersonatedId(id)
    }

    // Load impersonation state from local storage on mount
    useEffect(() => {
        const stored = localStorage.getItem('impersonated_user_id')
        if (stored) {
            console.log("📦 Loading impersonation from storage:", stored)
            setImpersonatedId(stored)
        }
    }, [])

    // Unified Auth Logic
    useEffect(() => {
        let mounted = true

        // 1. Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!mounted) return
            const currentUser = session?.user ?? null

            // Only update if different to avoid infinite renders
            setUser(prev => prev?.id === currentUser?.id ? prev : currentUser)

            if (!currentUser) {
                setLoading(false)
            }
        })

        // 2. Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!mounted) return
            const currentUser = session?.user ?? null

            // Only update if different
            setUser(prev => prev?.id === currentUser?.id ? prev : currentUser)

            if (!currentUser) {
                setProfile(null)
                setLoading(false)
            }
        })

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [])

    // Re-fetch profile when user OR impersonation status changes
    // This is the SINGLE source of truth for profile fetching
    useEffect(() => {
        if (!user) return

        console.log("🔄 Impersonation/User state update:", { impersonatedId, userId: user.id })

        let active = true

        const doFetch = async () => {
            await fetchProfile(user.id)
        }

        doFetch()

        return () => { active = false }
    }, [impersonatedId, user?.id]) // specific dependency on user.id string, not object

    const impersonateUser = async (userId: string) => {
        console.log("🎭 Start Impersonation:", userId)
        if (!user) return

        setImpersonatedId(userId)
        localStorage.setItem('impersonated_user_id', userId)
        setLoading(true)
    }

    // ...

    async function fetchProfile(authUserId: string) {
        // USE REF instead of state to avoid stale closure issues
        const targetUserId = impersonatedIdRef.current || authUserId
        console.log("👤 Fetching Profile for:", targetUserId, "(Impersonated:", impersonatedIdRef.current, "Auth:", authUserId, ")")

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', targetUserId)
                .single()

            if (error) {
                console.error('Error fetching profile:', error)
            }

            if (data) {
                console.log("✅ Profile fetched:", data.full_name, data.role)
                setProfile(data as UserProfile)
            }
        } catch (error) {
            console.error('Profile fetch error:', error)
        } finally {
            setLoading(false)
        }
    }

    const stopImpersonation = () => {
        setImpersonatedId(null)
        localStorage.removeItem('impersonated_user_id')
        setLoading(true)
        // Effect will trigger fetchProfile for real user
    }

    const signOut = async () => {
        try {
            await supabase.auth.signOut()
            setUser(null)
            setProfile(null)
            setImpersonatedId(null)
            localStorage.removeItem('impersonated_user_id')
        } catch (error) {
            console.error("Error signing out:", error)
        }
    }

    const value = {
        user,
        profile,
        loading,
        isAdmin: profile?.role === 'admin',
        isDoctor: profile?.role === 'doctor',
        isDietitian: profile?.role === 'dietitian',
        isPatient: profile?.role === 'patient',
        isStaff: ['admin', 'doctor', 'dietitian'].includes(profile?.role || ''),
        refreshProfile: async () => {
            if (user) await fetchProfile(user.id)
        },
        impersonateUser,
        stopImpersonation,
        isImpersonating: !!impersonatedId,
        signOut
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => useContext(AuthContext)
