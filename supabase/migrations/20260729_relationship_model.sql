-- Refonte du modèle relationnel client : VIP devient un tag manuel, actif/inactif devient
-- un signal de santé de relation calculé côté app (next_action_at/last_interaction_at,
-- déjà maintenus par refresh_client_activity — aucune nouvelle colonne nécessaire pour le
-- calcul), avec une bascule manuelle "ne plus contacter". "Advisor" (ancien statut) est replié
-- dans contact_role (distributor ou leader selon la présence d'une équipe).
--
-- La colonne `status` et sa contrainte CHECK restent en base (non supprimées) — l'app arrête
-- simplement de les lire/écrire comme source de vérité. Un nettoyage (DROP COLUMN) pourra
-- suivre une fois ce changement validé en usage réel.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manually_inactive boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clients_is_vip
  ON public.clients(user_id) WHERE is_vip = true AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_manually_inactive
  ON public.clients(user_id) WHERE manually_inactive = true AND archived_at IS NULL;

-- Backfill is_vip depuis l'ancien statut manuel "vip".
UPDATE public.clients SET is_vip = true
  WHERE status = 'vip' AND is_vip = false;

-- Backfill manually_inactive depuis l'ancien statut manuel "inactive".
UPDATE public.clients SET manually_inactive = true
  WHERE status = 'inactive' AND manually_inactive = false;

-- Backfill ciblé advisor -> contact_role : uniquement les lignes jamais corrigées depuis
-- l'ajout de contact_role (toujours à sa valeur par défaut 'customer'). leader si une équipe
-- pointe déjà vers ce client via sponsor_id, sinon distributor.
UPDATE public.clients c SET contact_role =
  CASE WHEN EXISTS (SELECT 1 FROM public.clients c2 WHERE c2.sponsor_id = c.id)
       THEN 'leader' ELSE 'distributor' END
  WHERE c.status = 'advisor' AND c.contact_role = 'customer';

NOTIFY pgrst, 'reload schema';
