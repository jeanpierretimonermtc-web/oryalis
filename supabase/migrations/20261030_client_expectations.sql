-- CONTACT-EXPECTATIONS-1 — "Ses attentes" : ce que le contact cherche, avec ses mots.
-- Texte libre, facultatif. Volontairement distinct de medical_notes/particularities (zone
-- sensible masquée) : ressenti, habitudes et préférences, jamais de diagnostic.
-- Purement additive : 5 colonnes nullables, aucune donnée existante modifiée.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS expectation_goals text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS expectation_habits text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS expectation_motivation text;
-- Canal et moment préférés, en clair (ex. "WhatsApp en fin de journée").
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS contact_preference text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS next_exchange_questions text;

NOTIFY pgrst, 'reload schema';
