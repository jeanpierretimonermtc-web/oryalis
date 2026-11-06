-- SECURITY-2 — fonctions sans contrôle de l'appelant : elles agissent sur le compte passé en
-- paramètre et restaient exécutables par anon et authenticated (fausses alertes de connexion, marque
-- ajoutée au contact d'un autre compte, statistiques faussées, statut d'abonnement lisible).
-- Elles ne servent qu'à des fonctions SECURITY DEFINER (exécutées par postgres) et, pour
-- record_security_login_event, à la fonction serveur record-security-login (service_role).
-- Aucune politique RLS et aucun écran ne les appelle.

REVOKE ALL ON FUNCTION public.record_security_login_event(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_product_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_client_brand_from_catalog(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_program_brand(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_client_activity(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_profile_plan_from_subscriptions(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_advisor_access(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_security_login_event(uuid, text, text, text, text) TO service_role;
