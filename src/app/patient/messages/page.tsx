"use client"

import { useAuth } from "@/contexts/auth-context"
import { useChat } from "@/hooks/use-chat"
import { ChatLayout } from "@/components/chat/chat-layout"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { supabase } from "@/lib/supabase"

export default function PatientMessagesPage() {
    const { user } = useAuth()
    const {
        conversations,
        messages,
        activeConversationId,
        selectConversation,
        sendMessage,
        loadingMessages,
        loadingConversations,
        startConversation,
        createGroupConversation,
        deleteMessage,
        editMessage
    } = useChat(user?.id)

    const [dietitianLoading, setDietitianLoading] = useState(false)

    const handleContactDietitian = async () => {
        if (!user) return
        setDietitianLoading(true)
        try {
            // Try to find via RPC first (cleaner)
            const { data: dietitianId, error } = await supabase.rpc('get_my_dietitian')

            if (dietitianId) {
                const convId = await startConversation(dietitianId)
                if (convId) selectConversation(convId)
            } else {
                // Fallback: try raw query
                const { data } = await supabase.from('patient_assignments')
                    .select('dietitian_id')
                    .eq('patient_id', user.id)
                    .limit(1)
                    .maybeSingle()

                if (data?.dietitian_id) {
                    const convId = await startConversation(data.dietitian_id)
                    if (convId) selectConversation(convId)
                } else {
                    alert("Atanmış bir diyetisyeniniz bulunamadı.")
                }
            }
        } catch (e) {
            console.error(e)
            alert("Bir hata oluştu.")
        } finally {
            setDietitianLoading(false)
        }
    }

    if (!user) return null

    const otherPartyName = (() => {
        if (conversations.length === 0) return 'Diyetisyen'
        const conv = conversations[0]
        const other = conv?.participants?.find((p: any) => p.user_id !== user.id)
        return other?.user?.full_name || 'Diyetisyen'
    })()

    return (
        <div className="flex flex-col" style={{ height: 'calc(100dvh - 120px)' }}>
            <div className="flex items-center justify-between mb-2 px-4 md:px-0">
                <div>
                    <h1 className="text-lg font-bold text-gray-900">Mesajlar</h1>
                    <p className="text-xs text-gray-500">{otherPartyName}</p>
                </div>
                {conversations.length === 0 && !loadingConversations && (
                    <Button onClick={handleContactDietitian} disabled={dietitianLoading} size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                        {dietitianLoading ? "Bağlanıyor..." : "Diyetisyenimle Görüş"}
                    </Button>
                )}
            </div>

            {loadingConversations ? (
                <div className="flex bg-white flex-1 border rounded-xl items-center justify-center text-gray-400">
                    Sohbetler yükleniyor...
                </div>
            ) : (
                <div className="flex-1 min-h-0">
                    <ChatLayout
                        conversations={conversations}
                        messages={messages}
                        activeConversationId={activeConversationId}
                        currentUserId={user.id}
                        onSelectConversation={selectConversation}
                        onSendMessage={sendMessage}
                        loadingMessages={loadingMessages}
                        onStartGroup={createGroupConversation}
                        allowGroupCreation={false}
                        onDeleteMessage={deleteMessage}
                        onEditMessage={editMessage}
                    />
                </div>
            )}
        </div>
    )
}
