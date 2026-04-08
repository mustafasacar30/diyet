alter table public.profiles
add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('staff-logos', 'staff-logos', true)
on conflict (id) do nothing;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'Staff logos are publicly readable'
    ) then
        create policy "Staff logos are publicly readable"
        on storage.objects
        for select
        using (bucket_id = 'staff-logos');
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'Doctors and dietitians can upload their own logos'
    ) then
        create policy "Doctors and dietitians can upload their own logos"
        on storage.objects
        for insert
        to authenticated
        with check (
            bucket_id = 'staff-logos'
            and auth.uid() is not null
            and (storage.foldername(name))[1] = auth.uid()::text
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role in ('doctor', 'dietitian')
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
          and policyname = 'Doctors and dietitians can update their own logos'
    ) then
        create policy "Doctors and dietitians can update their own logos"
        on storage.objects
        for update
        to authenticated
        using (
            bucket_id = 'staff-logos'
            and auth.uid() is not null
            and (storage.foldername(name))[1] = auth.uid()::text
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role in ('doctor', 'dietitian')
            )
        )
        with check (
            bucket_id = 'staff-logos'
            and auth.uid() is not null
            and (storage.foldername(name))[1] = auth.uid()::text
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role in ('doctor', 'dietitian')
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
          and policyname = 'Doctors and dietitians can delete their own logos'
    ) then
        create policy "Doctors and dietitians can delete their own logos"
        on storage.objects
        for delete
        to authenticated
        using (
            bucket_id = 'staff-logos'
            and auth.uid() is not null
            and (storage.foldername(name))[1] = auth.uid()::text
            and exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role in ('doctor', 'dietitian')
            )
        );
    end if;
end $$;
