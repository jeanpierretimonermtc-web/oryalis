-- Relance en attente de réponse : le message est parti, la réponse du client reste à noter.
-- La relance reste ouverte et due_date porte la date de rappel si le client ne répond pas.
-- L'échange lié (interactions.source_followup_id) porte le résultat : 'sent', puis la réponse.

ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS awaiting_reply_since timestamptz;

COMMENT ON COLUMN public.followups.awaiting_reply_since IS
  'Date d''envoi du message ; NULL si la relance n''attend pas de réponse.';
