"use client"

import { Conversation } from "@/types/chat"
import { cn } from "@/lib/utils"
import { User, Search, PlusCircle } from "lucide-react"
import { useState } from "react"
import { NewChatDialog } from "./new-chat-dialog" // Assumption: Created in same folder

interface ConversationListProps {
    conversations: Conversation[]
    activeConversationId?: string
    onSelect: (id: string) => void
    currentUserId: string
    onStartGroup?: (userIds: string[], isGroup: boolean, title?: string) => void
    allowGroupCreation?: boolean
}

export function ConversationList({
    conversations,
    activeConversationId,
    onSelect,
    currentUserId,
    onStartGroup,
    allowGroupCreation = true
}: ConversationListProps) {
    const [isNewChatOpen, setIsNewChatOpen] = useState(false)

    return (
        <div className="flex flex-col h-full bg-white border-r w-full md:w-[320px]">
            <div className="p-3 bg-gray-50 border-b flex justify-between items-center sticky top-0 z-10">
                <h2 className="font-bold text-gray-700">Mesajlar</h2>
                <div className="flex gap-2">
                    {onStartGroup && (
                        <div
                            className="bg-white p-1.5 rounded-full shadow-sm cursor-pointer hover:bg-green-50 text-green-600 transition-colors"
                            onClick={() => setIsNewChatOpen(true)}
                        >
                            <PlusCircle size={20} />
                        </div>
                    )}
                </div>
            </div>

            <NewChatDialog
                open={isNewChatOpen}
                onOpenChange={setIsNewChatOpen}
                allowGroupCreation={allowGroupCreation}
                onStartChat={(ids, isGroup, title) => {
                    if (onStartGroup) onStartGroup(ids, isGroup, title)
                }}
            />

            <div className="flex-1 overflow-y-auto">
                {conversations.map(conv => {
                    // Find other participant
                    const other = conv.participants?.find(p => p.user_id !== currentUserId)

                    let name = 'Bilinmeyen Kullanıcı'
                    if (conv.type === 'group') {
                        name = conv.title || 'Grup'
                    } else {
                        name = other?.user?.full_name || 'Bilinmeyen Kullanıcı'
                    }

                    const lastMsg = conv.last_message_preview || 'Henüz mesaj yok'
                    const time = new Date(conv.last_message_at || conv.created_at).toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' })

                    return (
                        <div
                            key={conv.id}
                            onClick={() => onSelect(conv.id)}
                            className={cn(
                                "flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-50",
                                activeConversationId === conv.id && "bg-green-50 hover:bg-green-50"
                            )}
                        >
                            <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center shrink-0 overflow-hidden">
                                {other?.user?.avatar_url ? (
                                    <img src={other.user.avatar_url} alt={name} className="h-full w-full object-cover" />
                                ) : (
                                    <User className="text-gray-400" size={20} />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center mb-0.5">
                                    <span className="font-semibold text-gray-900 truncate text-sm">{name}</span>
                                    <span className="text-[10px] text-gray-400 shrink-0">{time}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <p className="text-xs text-gray-500 truncate flex-1 block">
                                        {lastMsg}
                                    </p>
                                    {conv.unread_count! > 0 && (
                                        <span className="ml-2 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center h-[18px] flex items-center justify-center">
                                            {conv.unread_count}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                })}

                {conversations.length === 0 && (
                    <div className="p-4 text-center text-sm text-gray-400 mt-10">
                        Henüz sohbetiniz yok.
                    </div>
                )}
            </div>
        </div>
    )
}
