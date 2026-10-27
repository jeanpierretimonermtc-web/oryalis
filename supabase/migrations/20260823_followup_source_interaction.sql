-- ACTION-OUTCOME-1 / P1.2 §10 — traçabilité "cette relance a été décidée à la suite de cette
-- interaction". Aucun champ équivalent n'existe déjà sur `followups` (vérifié via le schéma
-- TypeScript courant, shared/lib/types.ts).
-- Nullable et additive : toutes les relances existantes (créées avant P1.2, ou créées hors du
-- flux "Suite" d'une clôture d'interaction) restent source_interaction_id = null sans backfill.
-- ON DELETE SET NULL : si une interaction est un jour supprimée, la relance qu'elle a produite
-- reste (elle représente une décision réelle prise par l'utilisateur), seul le lien d'origine
-- disparaît.
-- Volontairement PAS d'index unique ici (à la différence de interactions.source_followup_id en
-- P1) : une même interaction peut légitimement donner lieu à plusieurs relances dans le temps
-- (§12 du brief P1.2) — l'idempotence du double-clic/retry est assurée côté client (état local
-- de la modale de clôture), pas par une contrainte d'unicité qui bloquerait un cas légitime.
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS source_interaction_id uuid REFERENCES public.interactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS followups_source_interaction_id_idx
  ON public.followups (source_interaction_id)
  WHERE source_interaction_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
