-- Fix infinite recursion on participants RLS policies.
-- Root cause: participants policy referenced public.participants directly in USING.
-- Solution: move membership check into SECURITY DEFINER helper.

create or replace function public.is_conversation_participant(
  target_conversation_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.participants p
    where p.conversation_id = target_conversation_id
      and p.user_id = target_user_id
  );
$$;

grant execute on function public.is_conversation_participant(uuid, uuid) to authenticated, service_role;

drop policy if exists "Users can view conversations they are participating in" on public.conversations;
create policy "Users can view conversations they are participating in"
on public.conversations for select
to authenticated
using (public.is_conversation_participant(public.conversations.id, auth.uid()));

drop policy if exists "Participants can update conversation preview metadata" on public.conversations;
create policy "Participants can update conversation preview metadata"
on public.conversations for update
to authenticated
using (public.is_conversation_participant(public.conversations.id, auth.uid()))
with check (public.is_conversation_participant(public.conversations.id, auth.uid()));

drop policy if exists "Users can view participants of their conversations" on public.participants;
create policy "Users can view participants of their conversations"
on public.participants for select
to authenticated
using (public.is_conversation_participant(public.participants.conversation_id, auth.uid()));

drop policy if exists "Users can view messages in their conversations" on public.messages;
create policy "Users can view messages in their conversations"
on public.messages for select
to authenticated
using (public.is_conversation_participant(public.messages.conversation_id, auth.uid()));

drop policy if exists "Users can insert messages in their conversations" on public.messages;
create policy "Users can insert messages in their conversations"
on public.messages for insert
to authenticated
with check (
  public.messages.sender_id = auth.uid()
  and public.is_conversation_participant(public.messages.conversation_id, auth.uid())
);
