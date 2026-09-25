"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { SeraAssistant } from "@/components/sera/sera-assistant"
import { SeraChat } from "@/components/sera/sera-chat"
import { Leaf, Loader2, MessageCircle, Settings2 } from "lucide-react"
import { cn } from "@/lib/utils"

type TabKey = 'chat' | 'rules'

export default function AssistantPage() {
    const { user, profile } = useAuth()
    const [loading, setLoading] = useState(true)
    const [patientId, setPatientId] = useState<string | null>(null)
    const [patientName, setPatientName] = useState<string | undefined>(undefined)
    const [teamOwnerId, setTeamOwnerId] = useState<string | undefined>(undefined)
    const [programTemplateId, setProgramTemplateId] = useState<string | undefined>(undefined)
    const [requireApproval, setRequireApproval] = useState(false)
    const [canUseAI, setCanUseAI] = useState(false)
    const [activeTab, setActiveTab] = useState<TabKey>('rules')
    const [pendingChatMessage, setPendingChatMessage] = useState<string | undefined>(undefined)
    const [pendingRulePrompt, setPendingRulePrompt] = useState<string | undefined>(undefined)

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

            const { data } = await supabase
                .from('patients')
                .select('full_name, preferences, program_template_id')
                .eq('id', actualPatientId)
                .single()

            if (data) {
                setPatientName(data.full_name)
                setProgramTemplateId(data.program_template_id)

                const prefs = data.preferences || {}
                setCanUseAI(prefs.allow_ai_rule_assistant !== undefined ? prefs.allow_ai_rule_assistant : true)

                const { data: assignments } = await supabase
                    .from('patient_assignments')
                    .select('dietitian_id')
                    .eq('patient_id', actualPatientId)

                setRequireApproval(Boolean(assignments && assignments.length > 0))
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
            <div className="flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                    <Leaf className="h-8 w-8 text-slate-400" />
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-2">Sera Aktif Değil</h2>
                <p className="text-sm text-slate-500">Yapay zeka asistanı özelliğiniz aktif değil. Lütfen diyetisyeninizle görüşün.</p>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-[calc(100dvh-8rem)] max-w-4xl mx-auto px-0 sm:px-4 pt-0 pb-0">
            {/* Compact header: Sera label + tabs */}
            <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-b border-slate-100 bg-white">
                <div className="flex items-center gap-1.5">
                    <Leaf className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-bold text-slate-800">Sera</span>
                    <span className="text-[10px] text-slate-400">Lipödem asistanınız</span>
                </div>
                <div className="flex-1" />
                <div className="flex bg-slate-100 rounded-lg p-0.5">
                    <button
                        onClick={() => setActiveTab('chat')}
                        className={cn(
                            "flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-medium transition-all",
                            activeTab === 'chat'
                                ? "bg-white text-emerald-700 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        <MessageCircle className="h-3 w-3" />
                        Sohbet
                    </button>
                    <button
                        onClick={() => setActiveTab('rules')}
                        className={cn(
                            "flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-medium transition-all",
                            activeTab === 'rules'
                                ? "bg-white text-emerald-700 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        <Settings2 className="h-3 w-3" />
                        Tercihlerim
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === 'chat' && patientId && (
                    <SeraChat
                        patientId={patientId}
                        patientName={patientName}
                        initialMessage={pendingChatMessage}
                        onInitialMessageSent={() => setPendingChatMessage(undefined)}
                        onRedirectToRules={(msg) => {
                            setPendingRulePrompt(msg)
                            setActiveTab('rules')
                        }}
                    />
                )}
                {activeTab === 'rules' && patientId && (
                    <div className="h-full overflow-y-auto pb-4">
                        <SeraAssistant
                            patientId={patientId}
                            patientName={patientName}
                            requireApproval={requireApproval}
                            teamOwnerId={teamOwnerId}
                            programTemplateId={programTemplateId}
                            onRuleCreated={() => {}}
                            onRedirectToChat={(msg) => {
                                setPendingChatMessage(msg)
                                setActiveTab('chat')
                            }}
                            initialPrompt={pendingRulePrompt}
                            onInitialPromptUsed={() => setPendingRulePrompt(undefined)}
                            compact
                        />
                    </div>
                )}
            </div>
        </div>
    )
}
