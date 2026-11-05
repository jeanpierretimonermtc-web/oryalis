-- SECURITY-1 — droits d'exécution trop larges. Supabase accorde EXECUTE à anon par défaut sur les
-- fonctions de public.
--   • owner_* : déjà protégées par is_app_owner(), on retire en plus l'appel sans connexion.
--   • create_security_notification : aucun contrôle interne, appelable par n'importe qui pour créer
--     une fausse alerte chez n'importe quel compte. Elle ne sert qu'aux fonctions SECURITY DEFINER
--     (exécutées par postgres) : plus aucun rôle client ne la garde.

REVOKE ALL ON FUNCTION public.owner_extend_manual_subscription(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_get_support_snapshot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_list_admin_audit(integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_list_support_access_requests(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_list_users(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_remove_app_role(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_request_support_access(uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_revoke_manual_subscription(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_app_role(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_manual_subscription(uuid, boolean, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.owner_extend_manual_subscription(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_get_support_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_admin_audit(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_support_access_requests(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_users(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_remove_app_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_request_support_access(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_revoke_manual_subscription(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_app_role(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_manual_subscription(uuid, boolean, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_security_notification(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
