-- Migration: remove dead columns and unused tables
-- Safe to run: all items confirmed unused by code audit.

-- Dead columns on user_settings
alter table public.user_settings
  drop column if exists reminder_presets,
  drop column if exists brutal_copy,
  drop column if exists tone_mode;

-- Dead column on user_profiles
alter table public.user_profiles
  drop column if exists brutal_mode;

-- Dead column on supplements
alter table public.supplements
  drop column if exists when_label;

-- Dead tables (no code reads or writes these)
drop table if exists public.workout_logs;
drop table if exists public.daily_commitments;
drop table if exists public.daily_activity_logs;
drop table if exists public.weekly_plans;

-- push_devices: only written by OneSignal push registration, which is removed.
-- Dropping; WhatsApp subscriptions replace it.
drop table if exists public.push_devices;

-- activity_types: kept — will be used by the superadmin page (next migration).
