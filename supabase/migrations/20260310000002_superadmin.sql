-- Migration: superadmin schema
-- Enables activity_types for use, creates supplement_templates.

-- ── activity_types ────────────────────────────────────────────────────────────
-- Table already exists from initial schema with columns: id, key, label, sort.
-- Enable RLS and add policies.

alter table public.activity_types enable row level security;

-- All authenticated users can read (dashboard, settings need the list)
create policy "activity_types: authenticated read"
  on public.activity_types for select
  to authenticated
  using (true);

-- Only service_role (admin API routes) can write
-- No client-side insert/update/delete policies — mutations go through API routes.


-- ── supplement_templates ──────────────────────────────────────────────────────
-- Global supplement templates managed by the superadmin.
-- When a new user is bootstrapped, their personal supplements can be seeded from here.

create table if not exists public.supplement_templates (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  rule_type      text        not null,
  constraint supplement_templates_rule_type_check
    check (rule_type in (
      'PRE_WORKOUT', 'POST_WORKOUT',
      'MORNING_WINDOW', 'MIDDAY_WINDOW', 'EVENING_WINDOW', 'BED_WINDOW'
    )),
  offset_minutes integer,                     -- used when rule_type = PRE_WORKOUT / POST_WORKOUT
  window_start   time without time zone,      -- used for *_WINDOW types
  window_end     time without time zone,
  sort           integer     not null default 0,
  active         boolean     not null default true,
  created_at     timestamptz not null default now()
);

alter table public.supplement_templates enable row level security;

-- All authenticated users can read (so dashboard bootstrap can use these)
create policy "supplement_templates: authenticated read"
  on public.supplement_templates for select
  to authenticated
  using (true);

-- Only service_role can write (mutations via admin API routes)
