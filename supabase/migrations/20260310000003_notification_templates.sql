-- Migration: notification_templates
-- Stores customisable push/WhatsApp message templates for each trigger type × tone.

create table if not exists public.notification_templates (
  id            uuid        primary key default gen_random_uuid(),
  trigger_type  text        not null,
  constraint notification_templates_trigger_type_check
    check (trigger_type in ('pre_workout', 'teammate_done', 'supplement_due', 'eod_incomplete')),
  tone          text        not null,
  constraint notification_templates_tone_check
    check (tone in ('normal', 'brutal', 'savage')),
  template      text        not null,
  unique (trigger_type, tone),
  created_at    timestamptz not null default now()
);

-- No public read needed — admin API uses service role key
alter table public.notification_templates enable row level security;
