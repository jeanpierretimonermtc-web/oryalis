-- ACTION-OUTCOME-1 / P1 — lien durable entre une relance clôturée avec "Enregistrer
-- l'échange" et l'interaction historique qu'elle a fait naître. Aucun champ équivalent
-- n'existe déjà sur `interactions` (vérifié via information_schema le 2026-08-16 et via
-- le schéma TypeScript courant, shared/lib/types.ts).
-- Nullable et additive : toutes les interactions existantes (créées avant P1, ou créées
-- hors du flux de clôture d'une relance) restent source_followup_id = null sans backfill.
-- ON DELETE SET NULL : si une relance est un jour supprimée, l'interaction historique
-- qu'elle a produite reste (elle représente un événement réel qui a eu lieu), seul le lien
-- d'origine disparaît.
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS source_followup_id uuid REFERENCES public.followups(id) ON DELETE SET NULL;

-- Idempotence (P1 §4) : une relance ne peut jamais générer plus d'une interaction
-- historique directement dérivée d'elle (double-clic, retry après échec partiel) — un
-- index unique partiel plutôt qu'une contrainte pleine puisque source_followup_id est
-- nullable et la grande majorité des interactions n'en auront jamais.
-- Un index unique partiel sert aussi de fondation ("l'échange existe déjà pour cette
-- relance ?", "retrouver l'échange déjà créé après un retry") — pas besoin d'un second
-- index séparé.
CREATE UNIQUE INDEX IF NOT EXISTS interactions_source_followup_id_uniq
  ON public.interactions (source_followup_id)
  WHERE source_followup_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
