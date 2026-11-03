-- DASH-RISK-1 — "Ne plus signaler" un client à risque sur l'accueil.
-- Le contact reste visible dans le filtre "Dormants" de la liste Contacts. Le signalement revient
-- de lui-même si un nouvel échange a lieu après la date d'ignorance puis que le contact redevient
-- dormant (last_interaction_at > risk_dismissed_at). Distinct de manually_inactive ("Ne plus
-- contacter"), qui exclut le contact de toute sollicitation.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS risk_dismissed_at timestamptz;
