alter table public.team_pdf_branding
add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('team-logos', 'team-logos', true)
on conflict (id) do nothing;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'Team logos are publicly readable'
    ) then
        create policy "Team logos are publicly readable"
        on storage.objects
        for select
        using (bucket_id = 'team-logos');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'Admins can manage team logos'
    ) then
        create policy "Admins can manage team logos"
        on storage.objects
        for all
        to authenticated
        using (
            bucket_id = 'team-logos'
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role = 'admin'
            )
        )
        with check (
            bucket_id = 'team-logos'
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role = 'admin'
            )
        );
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'Doctors can manage own team logos'
    ) then
        create policy "Doctors can manage own team logos"
        on storage.objects
        for all
        to authenticated
        using (
            bucket_id = 'team-logos'
            and auth.uid() is not null
            and (storage.foldername(name))[1] = auth.uid()::text
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role = 'doctor'
            )
        )
        with check (
            bucket_id = 'team-logos'
            and auth.uid() is not null
            and (storage.foldername(name))[1] = auth.uid()::text
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role = 'doctor'
            )
        );
    end if;
end $$;
