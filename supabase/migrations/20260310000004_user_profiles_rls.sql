-- Ensure user_profiles has RLS enabled and policies for own-row reads/writes.
-- Uses DO blocks so it's safe to run even if some policies already exist.

alter table public.user_profiles enable row level security;

-- Own row: read
do $$ begin
  create policy "user_profiles: own read"
    on public.user_profiles for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Own row: insert (ensureProfileRow)
do $$ begin
  create policy "user_profiles: own insert"
    on public.user_profiles for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Own row: update (saveDisplayName upsert)
do $$ begin
  create policy "user_profiles: own update"
    on public.user_profiles for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;
