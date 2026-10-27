-- RDV-1 — Intention commerciale "Autre" : texte de précision associé.
-- Distinct de outcome_other_label (qui concerne le résultat du RDV, pas l'intention
-- commerciale — deux concepts différents, voir audit dédié). Additive, idempotente.
ALTER TABLE public.appointment_business_context
  ADD COLUMN IF NOT EXISTS commercial_intent_other_label text;

NOTIFY pgrst, 'reload schema';
