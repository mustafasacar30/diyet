"use client"

import { useState, useEffect, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { Conversation, Message } from "@/types/chat"

export function useChat(userId: string | undefined) {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [messages, setMessages] = useState<Message[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [loadingConversations, setLoadingConversations] = useState(true)

    const channelRef = useRef<any>(null)

    // 1. Fetch Conversations
    useEffect(() => {
        if (!userId) return

        async function fetchConversations() {
            setLoadingConversations(true)

            // AUTO-CREATE / SYNC logic for Patient to ensure Dietitian is in list
            // We do this check first
            await supabase.auth.getUser()

            // Simpler: Try to get my dietitian assignment
            // We use the raw table query which we just fixed RLS for, OR the RPC logic
            const { data: assignments } = await supabase
                .from('patient_assignments')
                .select('dietitian_id')
                .eq('patient_id', userId)
                .limit(1)

            if (assignments && assignments.length > 0) {
                const dietitianId = assignments[0].dietitian_id
                // Check if conversation exists
                // We can rely on get_or_create rpc to be idempotent and safe
                await supabase.rpc('get_or_create_conversation', {
                    user_a: userId,
                    user_b: dietitianId
                })
            }

            // Get conversations where user is participant
            // We need to join with participants to get the OTHER user info
            const { data, error } = await supabase
                .from('participants')
                .select(`
                    conversation_id,
                    conversations (
                        id,
                        updated_at,
                        last_message_preview,
                        last_message_at,
                        type,
                        participants (
                            user_id
                        )
                    )
                `)
                .eq('user_id', userId)
                .order('last_read_at', { ascending: false }) // Just initial sort

            if (error) {
                console.error("Error fetching conversations:", error)
            } else if (data) {
                // Determine format
                // We need to fetch profiles manually if the relation above fails or is complex
                // Let's assume a simpler query strategy: 
                // 1. Get conversation IDs. 
                // 2. Fetch conversations + participants + profiles.

                const convIds = data.map(d => d.conversation_id)
                if (convIds.length > 0) {
                    const { data: convData } = await supabase
                        .from('conversations')
                        .select(`
                            *,
                            participants (
                                user_id,
                                last_read_at
                            )
                        `)
                        .in('id', convIds)
                        .order('last_message_at', { ascending: false })

                    if (convData) {
                        // Enrich with profiles manually to be safe
                        const userIds = new Set<string>()
                        convData.forEach(c => c.participants.forEach((p: any) => userIds.add(p.user_id)))

                        const { data: profiles } = await supabase
                            .from('profiles') // Assuming public.profiles exists and matches auth.users
                            .select('id, full_name, avatar_url')
                            .in('id', Array.from(userIds))

                        // Get unread counts
                        const { data: counts } = await supabase.rpc('get_unread_counts', { _user_id: userId })
                        const countMap = new Map(counts?.map((c: any) => [c.conversation_id, c.unread_count]) || [])

                        const profileMap = new Map(profiles?.map(p => [p.id, p]))

                        const validConvs = convData.map(c => ({
                            ...c,
                            participants: c.participants.map((p: any) => ({
                                ...p,
                                user: profileMap.get(p.user_id) || { full_name: 'Bilinmeyen Kullanıcı' }
                            })),
                            unread_count: countMap.get(c.id) || 0
                        }))

                        setConversations(validConvs)
                    }
                } else {
                    setConversations([])
                }
            }
            setLoadingConversations(false)
        }

        fetchConversations()

        // Subscribe to NEW messages globally to update conversation list preview?
        // Or just subscribe to conversations table changes? only works for INSERT/UPDATE
        /*
        const convSub = supabase
            .channel('public:conversations')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, payload => {
                 // Invalidate query or update query
                 // For now, simpler: reload on navigation
            })
            .subscribe()
        return () => { convSub.unsubscribe() }
        */
    }, [userId])

    // Request Notification Permission
    useEffect(() => {
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission()
        }
    }, [])

    // 2. Fetch Messages & Realtime Subscription
    useEffect(() => {
        if (!activeConversationId) {
            setMessages([])
            return
        }

        async function fetchMessages() {
            setLoadingMessages(true)
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('conversation_id', activeConversationId)
                .order('created_at', { ascending: true })

            if (!error && data) {
                setMessages(data)
            }
            setLoadingMessages(false)
        }

        fetchMessages()

        // Subscribe to changes in THIS conversation
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
        }

        const channel = supabase
            .channel(`chat:${activeConversationId}`)
            .on('postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'messages',
                    filter: `conversation_id=eq.${activeConversationId}`
                },
                async (payload) => {
                    const eventType = payload.eventType
                    const newMsg = payload.new as Message

                    if (eventType === 'INSERT') {
                        setMessages(prev => [...prev, newMsg])

                        // If we are active user
                        if (newMsg.sender_id !== userId) {
                            // Mark as read immediately if window is focused
                            if (!document.hidden) {
                                markAsRead(activeConversationId)
                            } else {
                                // Notify if hidden
                                sendNotification(newMsg)
                            }
                        }
                    } else if (eventType === 'UPDATE') {
                        setMessages(prev => prev.map(m => m.id === newMsg.id ? newMsg : m))
                    }
                }
            )
            .subscribe()

        channelRef.current = channel

        return () => {
            if (channelRef.current) supabase.removeChannel(channelRef.current)
        }
    }, [activeConversationId])

    // Subscription to ALL signals for unread counts on OTHER chats & GLOBAL NOTIFICATIONS
    useEffect(() => {
        if (!userId) return

        const channel = supabase.channel(`global_messages:${userId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async payload => {
                const newMsg = payload.new as Message

                // If sender is ME, ignore
                if (newMsg.sender_id === userId) return

                // Check if this message belongs to the ACTIVE conversation
                if (newMsg.conversation_id === activeConversationId) {
                    // Already handled by local subscription for UI update
                    // But we might need sound if window is hidden
                    if (document.hidden) {
                        playNotificationSound()
                    }
                    return
                }

                // If NOT active conversation:
                // 1. Increment Unread Count
                setConversations(prev => prev.map(c =>
                    c.id === newMsg.conversation_id
                        ? { ...c, unread_count: (c.unread_count || 0) + 1, last_message_at: newMsg.created_at, last_message_preview: newMsg.type === 'image' ? '📷 Resim' : newMsg.content.substring(0, 50) }
                        : c
                ).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()))

                // 2. Play Sound & Notify
                playNotificationSound()
                sendNotification(newMsg)
            })
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [activeConversationId, userId])


    // Helper functions for notifications
    function playNotificationSound() {
        try {
            const audio = new Audio('/notification.mp3')
            audio.play().catch(e => console.log("Audio play blocked (user didn't interact yet)"))
        } catch (e) { }
    }

    function sendNotification(msg: Message) {
        if ("Notification" in window && Notification.permission === "granted") {
            // We need to fetch sender name ideally, but for now generic
            const title = "Yeni Mesaj"
            const body = msg.type === 'image' ? '📷 Fotoğraf' : msg.content

            new Notification(title, {
                body: body,
                icon: '/icons/icon-192x192.png', // Ensure this exists or use logo
                tag: msg.conversation_id // Group by conversation
            })
        }
    }


    // 4. Global Subscription for Conversation List Updates & Notifications
    useEffect(() => {
        if (!userId) return

        const channel = supabase
            .channel(`user_conversations:${userId}`)
            .on('postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'conversations'
                    // No filter possible for "joined" tables easily, so we listen to all and filter in callback?
                    // Actually, we can't filter purely by user_id on conversations table.
                    // But we can rely on RLS! If RLS is set up, we only receive our updates.
                },
                (payload) => {
                    const updatedConv = payload.new as Conversation

                    // Update list
                    setConversations(prev => {
                        // Check if we have this conversation
                        const exists = prev.find(c => c.id === updatedConv.id)
                        if (exists) {
                            const newArray = prev.map(c => c.id === updatedConv.id ? { ...c, ...updatedConv } : c)
                            // Re-sort
                            return newArray.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())
                        }
                        return prev
                    })

                    // Play Sound if not current chat
                    if (updatedConv.id !== activeConversationId) {
                        try {
                            const audio = new Audio('/notification.mp3')
                            audio.play().catch(e => {
                                // Ignore play errors (e.g. 404 or user interaction policy)
                            })
                        } catch (e) { }
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [userId, activeConversationId]) // Re-run if active changed to avoid sound


    // 3. Actions
    async function sendMessage(content: string, type: 'text' | 'image' | 'file' = 'text') {
        if (!userId || !activeConversationId) return

        const { error } = await supabase
            .from('messages')
            .insert({
                conversation_id: activeConversationId,
                sender_id: userId,
                content,
                type
            })

        if (error) {
            console.error("Failed to send:", error)
        }
    }

    async function addMembersToGroup(conversationId: string, userIds: string[]) {
        if (!userId) return

        const { error } = await supabase.rpc('add_group_members', {
            target_conversation_id: conversationId,
            new_member_ids: userIds
        })

        if (error) {
            console.error("Failed to add members:", error)
            alert(`Hata (Üye Ekleme): ${error.message}`)
        } else {
            alert("Üyeler eklendi!")
            window.location.reload()
        }
    }

    async function removeMemberFromGroup(conversationId: string, targetUserId: string) {
        if (!userId) return

        const { error } = await supabase.rpc('remove_group_member', {
            target_conversation_id: conversationId,
            target_user_id: targetUserId
        })

        if (error) {
            console.error("Failed to remove member:", error)
            alert(`Hata (Üye Çıkarma): ${error.message}`)
        } else {
            alert("Kişi çıkarıldı.")
            window.location.reload()
        }
    }

    async function deleteGroup(conversationId: string) {
        if (!userId) {
            alert("Hata: Kullanıcı girişi yapılmamış.")
            return
        }
        if (!conversationId) {
            alert("Hata: Grup ID bulunamadı.")
            return
        }

        if (!confirm("Bu grubu kalıcı olarak silmek istediğinize emin misiniz?")) return

        console.log(`Deleting Group: ${conversationId} by User: ${userId}`)

        const { error: convError } = await supabase.rpc('delete_group_conversation', {
            target_conversation_id: conversationId
        })

        if (convError) {
            console.error("Conversation delete failed:", convError)
            alert(`Grup silinemedi: ${convError.message}`)
        } else {
            alert("Grup başarıyla silindi.")
            window.location.reload()
        }
    }

    async function deleteMessage(messageId: string) {
        if (!userId) return

        const { error } = await supabase
            .from('messages')
            .update({ is_deleted: true })
            .eq('id', messageId)
            .eq('sender_id', userId)

        if (error) {
            console.error("Failed to delete:", error)
        } else {
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, is_deleted: true } : m))
        }
    }

    async function editMessage(messageId: string, newContent: string) {
        if (!userId) return

        const { error } = await supabase
            .from('messages')
            .update({ content: newContent })
            .eq('id', messageId)
            .eq('sender_id', userId)

        if (error) {
            console.error("Failed to edit:", error)
        } else {
            setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: newContent, is_edited: true } : m))
        }
    }

    async function markAsRead(convId: string) {
        if (!userId) return

        // Update messages directly to trigger realtime update for "Blue Ticks"
        await supabase
            .from('messages')
            .update({ is_read: true })
            .eq('conversation_id', convId)
            .neq('sender_id', userId)
            .eq('is_read', false)

        // Also update participant last_read to be safe/compliant with schema intent
        await supabase
            .from('participants')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', convId)
            .eq('user_id', userId)
    }

    useEffect(() => {
        if (activeConversationId) {
            markAsRead(activeConversationId)
            // Immediately clear unread count for active conversation
            setConversations(prev => prev.map(c =>
                c.id === activeConversationId
                    ? { ...c, unread_count: 0 }
                    : c
            ))
        }
    }, [activeConversationId, messages.length])

    async function selectConversation(id: string) {
        if (id === activeConversationId) return;
        if (id === "") {
            setActiveConversationId(undefined)
        } else {
            setActiveConversationId(id)
        }
    }

    // Helper: Start Conversation
    async function startConversation(targetUserId: string) {
        if (!userId) return null

        const { data, error } = await supabase.rpc('get_or_create_conversation', {
            user_a: userId,
            user_b: targetUserId
        })

        if (!error && data) {
            // Reload conversations to show it
            // For now simple reload
            window.location.reload() // Bruteforce refresh to ensure list is updated - efficient app would concat
            return data // convId
        }
        return null
    }

    // New: Create Group Conversation
    async function createGroupConversation(targetUserIds: string[], isGroup: boolean, title?: string) {
        if (!userId) return

        // If single user and not group forced, use existing flow
        if (!isGroup && targetUserIds.length === 1) {
            return startConversation(targetUserIds[0])
        }

        // Use RPC for atomic creation and to bypass RLS "Insert but can't Select" issue
        const { data: convId, error } = await supabase.rpc('create_group_conversation', {
            creator_id: userId,
            member_ids: targetUserIds,
            group_title: title // Optional title
        })

        if (error) {
            console.error("Error creating group:", error)
            return
        }

        if (convId) {
            window.location.reload()
            return convId
        }
    }

    async function leaveGroup(conversationId: string) {
        if (!userId) return

        const { error } = await supabase
            .from('participants')
            .delete()
            .eq('conversation_id', conversationId)
            .eq('user_id', userId)

        if (error) {
            console.error("Failed to leave group:", error)
        } else {
            // Optimistic removal
            setConversations(prev => prev.filter(c => c.id !== conversationId))
            if (activeConversationId === conversationId) {
                setActiveConversationId(undefined)
            }
        }
    }

    return {
        conversations,
        messages,
        activeConversationId,
        loadingMessages,
        loadingConversations,
        sendMessage,
        selectConversation,
        startConversation,
        createGroupConversation,
        deleteMessage,
        editMessage,
        addMembersToGroup,
        removeMemberFromGroup,
        deleteGroup,
        leaveGroup
    }
}
