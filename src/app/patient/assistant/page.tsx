"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { SeraAssistant } from "@/components/sera/sera-assistant"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Leaf, Loader2 } from "lucide-react"

export default function AssistantPage() {
    const { user, profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [patientId, setPatientId] = useState<string | null>(null)
    
    const [patientName, setPatientName] = useState<string | undefined>(undefined)
    const [teamOwnerId, setTeamOwnerId] = useState<string | undefined>(undefined)
    const [programTemplateId, setProgramTemplateId] = useState<string | undefined>(undefined)

    const [requireApproval, setRequireApproval] = useState(false)
    const [canUseAI, setCanUseAI] = useState(false)

    useEffect(() => {
        async function fetchData() {
            if (!user || !profile) return
            
            const targetId = profile.id || user.id
            let actualPatientId = targetId

            const { data: legacyMatch } = await supabase
                .from('patients')
                .select('id')
                .eq('user_id', targetId)
                .neq('id', targetId)
                .limit(1)
                .maybeSingle()
                
            if (legacyMatch) {
                actualPatientId = legacyMatch.id
            }
            
            setPatientId(actualPatientId)

            const { data, error } = await supabase
                .from('patients')
                .select('full_name, preferences, program_template_id')
                .eq('id', actualPatientId)
                .single()

            if (error) {
                console.error("Error fetching patient for Sera:", error)
            }

            
            if (data) {
                setPatientName(data.full_name)
                // setTeamOwnerId removed because column doesn't exist
                setProgramTemplateId(data.program_template_id)

                const prefs = data.preferences || {}
                // If preferences object doesn't have it, default to true
                setCanUseAI(prefs.allow_ai_rule_assistant !== undefined ? prefs.allow_ai_rule_assistant : true)
                
                // Fetch assignments separately to avoid join relation errors
                const { data: assignments } = await supabase
                    .from('patient_assignments')
                    .select('dietitian_id')
                    .eq('patient_id', actualPatientId)

                // If patient has a direct dietitian assigned, require approval
                const hasDirectDietitian = Boolean(assignments && assignments.length > 0);
                setRequireApproval(hasDirectDietitian);
            }
            setLoading(false)
        }
        fetchData()
    }, [user, profile])

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
        )
    }

    if (!canUseAI) {
        return (
            <div className="max-w-3xl mx-auto p-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-gray-800 flex items-center gap-2">
                            <Leaf className="h-5 w-5 text-gray-400" />
                            Sera — Kişisel Asistanınız
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-gray-500">
                        Yapay zeka asistanı özelliğiniz şu anda aktif değil. Lütfen diyetisyeninizle görüşün.
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto p-2 pb-24 sm:p-4 space-y-3">
            {/* Sera Hero Header */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-500 to-emerald-700 px-4 py-4 text-white shadow-lg">
                <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
                <div className="relative z-10 flex items-center gap-3">
                    <div className="h-10 w-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm border border-white/10 shrink-0">
                        <Leaf className="h-5 w-5 text-white" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-base font-bold tracking-tight">Sera — Kişisel Asistanınız</h1>
                        <p className="text-[11px] text-emerald-100/90 mt-0.5 leading-snug">
                            Beslenme tercihlerinizi bana anlatın. Sizin için en uygun düzenlemeyi yaparım.
                        </p>
                    </div>
                </div>
            </div>

            {/* Sera Content */}
            {patientId && (
                <SeraAssistant
                    patientId={patientId}
                    patientName={patientName}
                    requireApproval={requireApproval}
                    teamOwnerId={teamOwnerId}
                    programTemplateId={programTemplateId}
                    onRuleCreated={() => {}}
                />
            )}
        </div>
    )
}
