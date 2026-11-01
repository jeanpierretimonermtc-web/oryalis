-- UPLINE-1 — Ligne ascendante manuelle ("Ma ligne ascendante" de la page Réseau).
-- Personnes au-dessus de l'utilisateur dans son réseau MLM : ce ne sont pas des contacts CRM.
-- position : 0 = sponsor direct, plus haut = plus loin. La table était prévue par l'ancien
-- script migrate28.mjs mais n'a jamais existé en production (features/network/uplineService.ts).

CREATE TABLE IF NOT EXISTS public.upline_nodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  member_id   text,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upline_nodes_user_position_idx ON public.upline_nodes (user_id, position);

ALTER TABLE public.upline_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS upline_nodes_user_policy ON public.upline_nodes;
CREATE POLICY upline_nodes_user_policy ON public.upline_nodes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upline_nodes TO authenticated;

NOTIFY pgrst, 'reload schema';
