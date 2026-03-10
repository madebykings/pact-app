-- Expand plans_plan_type_check to include activity types added via the
-- activity_types admin table (CYCLE, HIKE, STRETCH, SPORT, ROW) as well as
-- all legacy types. Keeps HILLWALK and MOBILITY for backwards compat.

ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_plan_type_check;

ALTER TABLE plans ADD CONSTRAINT plans_plan_type_check CHECK (
  plan_type IN (
    'REST',
    'WALK',
    'RUN',
    'SPIN',
    'HIIT',
    'SWIM',
    'HILLWALK',
    'HIKE',
    'WEIGHTS',
    'YOGA',
    'PILATES',
    'MOBILITY',
    'STRETCH',
    'CYCLE',
    'SPORT',
    'ROW',
    'OTHER'
  )
);
