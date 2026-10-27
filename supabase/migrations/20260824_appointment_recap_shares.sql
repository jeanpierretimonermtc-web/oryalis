-- RÉCAP-5B — historique append-only des partages de récapitulatif de RDV. Une ligne signifie
-- uniquement "l'utilisateur a initié depuis Oryalis le partage de ce récapitulatif via ce
-- canal" (voir RÉCAP-5A §1/§2) — jamais "envoyé", "livré" ni "reçu" : Oryalis n'a techniquement
-- aucun moyen de le savoir pour whatsapp:// / sms: / mailto: (RÉCAP-5A §2/§10). Volontairement
-- pas de share_state/delivery_state : une colonne qui ne prendrait jamais qu'une seule valeur
-- ('launched') n'apporte rien tant qu'aucun fournisseur externe ne peut la faire évoluer.
--
-- Modèle calqué sur client_events (20260802_client_events.sql), pas sur interactions : cette
-- dernière est entièrement mutable/supprimable depuis l'UI (updateInteraction/deleteInteraction)
-- et ses colonnes texte (subject/notes_brutes) ont une sémantique de notes manuelles, pas de
-- snapshot verbatim d'un message envoyé (audit RÉCAP-5A §3/§4/§11).
CREATE TABLE IF NOT EXISTS public.appointment_recap_shares (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- CASCADE : le snapshot contient potentiellement des informations personnelles du contact
  -- (nom, détails évoqués) — une suppression RGPD du contact doit effacer aussi cet historique,
  -- même convention que interactions.client_id et client_events.client_id.
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- SET NULL : si le RDV est supprimé, le partage historique reste pertinent et lisible grâce
  -- à message_snapshot (texte autoportant) — seul le lien de navigation disparaît. Même
  -- convention que interactions.source_followup_id (20260823_interaction_source_followup.sql).
  appointment_id    uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  channel           text NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  -- Texte réellement visible dans le compositeur au moment du clic — jamais reconstruit
  -- ultérieurement depuis appointment_notes/discussed_products/prix/besoins/template courant.
  message_snapshot  text NOT NULL,
  -- Nullable : renseigné uniquement pour le canal email, toujours NULL pour whatsapp/sms.
  subject_snapshot  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Timeline contact (RÉCAP-5D) — même forme que client_events_client_id_idx.
CREATE INDEX IF NOT EXISTS appointment_recap_shares_client_id_idx
  ON public.appointment_recap_shares (client_id, created_at DESC);

-- Fiche RDV (RÉCAP-5D) — partiel car appointment_id est nullable (RDV supprimé) et la grande
-- majorité des lectures futures filtrent sur un appointment_id précis, jamais sur NULL.
CREATE INDEX IF NOT EXISTS appointment_recap_shares_appointment_id_idx
  ON public.appointment_recap_shares (appointment_id)
  WHERE appointment_id IS NOT NULL;

ALTER TABLE public.appointment_recap_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointment_recap_shares_select ON public.appointment_recap_shares
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY appointment_recap_shares_insert ON public.appointment_recap_shares
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Pas de policy UPDATE/DELETE : append-only, immuable au niveau DB (pas seulement par
-- convention frontend) — même principe que client_events (20260802_client_events.sql).

NOTIFY pgrst, 'reload schema';
