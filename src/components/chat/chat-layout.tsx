"use client"

import { useState } from "react"
import { ConversationList } from "./conversation-list"
import { ChatWindow } from "./chat-window"
import { Conversation, Message } from "@/types/chat"
import { Button } from "@/components/ui/button"
import { ChevronLeft, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { GroupDetailsDialog } from "./group-details-dialog"

interface ChatLayoutProps {
    conversations: Conversation[]
    messages: Message[]
    activeConversationId: string | undefined
    currentUserId: string
    onSelectConversation: (id: string) => void
    onSendMessage: (content: string, type: 'text' | 'image' | 'file') => void
    loadingMessages: boolean
    className?: string
    onStartGroup?: (userIds: string[], isGroup: boolean) => void
    onDeleteMessage?: (messageId: string) => void
    onEditMessage?: (id: string, newContent: string) => void
    onLeaveGroup?: (convId: string) => void
    onAddMembers?: (convId: string, userIds: string[]) => void
    onRemoveMember?: (convId: string, userId: string) => void
    onDeleteGroup?: (convId: string) => void
    allowGroupCreation?: boolean
}

export function ChatLayout({
    conversations,
    messages,
    activeConversationId,
    currentUserId,
    onSelectConversation,
    onSendMessage,
    loadingMessages,
    className,
    onStartGroup,
    onDeleteMessage,
    onEditMessage,
    onLeaveGroup,
    onAddMembers,
    onRemoveMember,
    onDeleteGroup,
    allowGroupCreation = true
}: ChatLayoutProps) {

    const [isGroupDetailsOpen, setIsGroupDetailsOpen] = useState(false)

    // Find active conversation to get recipient name
    const activeConv = conversations.find(c => c.id === activeConversationId)
    const otherParticipant = activeConv?.participants?.find(p => p.user_id !== currentUserId)

    let recipientName = 'Sohbet'
    if (activeConv) {
        if (activeConv.type === 'group') {
            recipientName = activeConv.title || 'Grup Sohbeti'
        } else {
            recipientName = otherParticipant?.user?.full_name || 'Bilinmeyen'
        }
    }

    return (
        <div className={cn("flex h-[calc(100dvh-8rem)] w-full overflow-hidden border rounded-xl bg-white shadow-sm", className)}>
            {activeConv && activeConv.type === 'group' && (
                <GroupDetailsDialog
                    open={isGroupDetailsOpen}
                    onOpenChange={setIsGroupDetailsOpen}
                    conversationId={activeConv.id}
                    title={recipientName}
                    participants={activeConv.participants || []}
                    currentUserId={currentUserId}
                    onAddMembers={(ids) => onAddMembers && onAddMembers(activeConv.id, ids)}
                    onRemoveMember={(uid) => onRemoveMember && onRemoveMember(activeConv.id, uid)}
                    onDeleteGroup={() => onDeleteGroup && onDeleteGroup(activeConv.id)}
                />
            )}

            {/* Sidebar / Conversation List */}
            <div className={cn(
                "w-full md:w-[320px] bg-white h-full flex flex-col border-r transition-all",
                activeConversationId ? "hidden md:flex" : "flex"
            )}>
                <ConversationList
                    conversations={conversations}
                    activeConversationId={activeConversationId}
                    onSelect={onSelectConversation}
                    currentUserId={currentUserId}
                    onStartGroup={onStartGroup}
                    allowGroupCreation={allowGroupCreation}
                />
            </div>

            {/* Main Chat Area */}
            <div className={cn(
                "flex-1 flex flex-col h-full bg-[#efeae2]",
                !activeConversationId ? "hidden md:flex" : "flex"
            )}>
                {activeConversationId && activeConv ? (
                    <>
                        {/* Unified Header */}
                        <div className="flex items-center justify-between p-3 bg-white border-b shadow-sm z-10">
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="md:hidden -ml-2"
                                    onClick={() => onSelectConversation("")}
                                >
                                    <ChevronLeft className="h-5 w-5" />
                                </Button>

                                <div className="flex flex-col">
                                    <span className="font-semibold text-gray-800">{recipientName}</span>
                                    {activeConv.type === 'group' && (
                                        <span className="text-xs text-gray-500">
                                            {activeConv.participants?.length} üye
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {activeConv.type === 'group' && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-gray-500 hover:bg-gray-100"
                                            onClick={() => setIsGroupDetailsOpen(true)}
                                            title="Grup Detayları"
                                        >
                                            <Info size={20} />
                                        </Button>

                                        {onLeaveGroup && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-red-500 hover:bg-red-50 border-red-200 hidden md:flex"
                                                onClick={() => onLeaveGroup(activeConv.id)}
                                            >
                                                Çık
                                            </Button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>

                        <ChatWindow
                            messages={messages}
                            currentUserId={currentUserId}
                            onSendMessage={onSendMessage}
                            loading={loadingMessages}
                            recipientName={recipientName}
                            participants={activeConv?.participants}
                            onDeleteMessage={onDeleteMessage}
                            onEditMessage={onEditMessage}
                        />
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center flex-col text-gray-400 p-8 text-center">
                        <div className="bg-gray-100 p-6 rounded-full mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-message-circle"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
                        </div>
                        <h3 className="font-medium text-lg text-gray-600">Sohbet Başlatın</h3>
                        <p className="text-sm mt-2 max-w-xs">Soldaki listeden bir kişi seçin veya yeni bir sohbet başlatın.</p>
                    </div>
                )}
            </div>
        </div>
    )
}
