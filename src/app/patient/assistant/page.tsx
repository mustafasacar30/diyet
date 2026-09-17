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
                .select('full_name, preferences')
                .eq('id', actualPatientId)
                .single()

            if (error) {
                console.error("Error fetching patient for Sera:", error)
            }

            if (data) {
                setPatientName(data.full_name)
                const prefs = data.preferences || {}
                // If preferences object doesn't have it, default to true
                setCanUseAI(prefs.allow_ai_rule_assistant !== undefined ? prefs.allow_ai_rule_assistant : true)
                
                // Fetch assignments separately to avoid join relation errors
                const { data: assignments } = await supabase
                    .from('patient_assignments')
                    .select('dietitian_id')
                    .eq('patient_id', actualPatientId)

                // If patient has a direct dietitian assigned, require approval
                const hasDirectDietitian = assignments && assignments.length > 0;
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
        <div className="max-w-4xl mx-auto p-2 pb-20 sm:p-4">
            <Card className="border-emerald-100 shadow-sm bg-white/80 backdrop-blur-sm">
                <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-xl text-emerald-800">
                        <Leaf className="h-6 w-6 text-emerald-600" />
                        Sera — Kişisel Asistanınız
                    </CardTitle>
                    <CardDescription className="text-emerald-700/80">
                        Beslenme tercihlerinizi bana anlatın. Sizin için en uygun düzenlemeyi yaparım.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {patientId && (
                        <SeraAssistant
                            patientId={patientId}
                            patientName={patientName}
                            requireApproval={requireApproval}
                            onRuleCreated={() => {
                                // Rule creation callback
                            }}
                        />
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
