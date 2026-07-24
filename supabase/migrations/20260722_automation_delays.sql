-- Let the advisor override the default delay (in days) of each automation rule
-- (Phase 2.1 of the vision roadmap: "relances et séquences configurables").
-- Stored as a JSON map of rule id -> custom delay in days, e.g. {"nc_j3": 5}.

ALTER TABLE public.user_business_profiles
  ADD COLUMN IF NOT EXISTS automation_delays jsonb NOT NULL DEFAULT '{}'::jsonb;
