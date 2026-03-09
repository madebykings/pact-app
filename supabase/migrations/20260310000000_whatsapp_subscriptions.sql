-- Migration: add whatsapp_subscriptions table
-- Run this against your Supabase project via the dashboard SQL editor or CLI.

create table if not exists public.whatsapp_subscriptions (
  user_id      uuid        primary key references auth.users(id) on delete cascade,
  phone_e164   text        not null,      -- E.164 format, e.g. +447700900123
  opted_in     boolean     not null default false,
  opted_in_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.whatsapp_subscriptions enable row level security;

-- Users can read and write only their own row
create policy "whatsapp_subscriptions: user select"
  on public.whatsapp_subscriptions for select
  using (auth.uid() = user_id);

create policy "whatsapp_subscriptions: user insert"
  on public.whatsapp_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "whatsapp_subscriptions: user update"
  on public.whatsapp_subscriptions for update
  using (auth.uid() = user_id);

create policy "whatsapp_subscriptions: user delete"
  on public.whatsapp_subscriptions for delete
  using (auth.uid() = user_id);

-- Service role (used by cron) can read all rows
create policy "whatsapp_subscriptions: service role select"
  on public.whatsapp_subscriptions for select
  to service_role
  using (true);
