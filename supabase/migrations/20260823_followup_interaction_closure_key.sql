-- ACTION-OUTCOME-1 / P1.2.1 — closure_action_key (ajoutée par 20260805_lot1_2_1_reliability.sql)
-- est une simple colonne text générique, sans CHECK, déjà partagée par orders/recommendations/
-- followups : la colonne elle-même est réutilisable telle quelle. Mais son idempotence réelle
-- vient de l'index unique composite followups_appointment_closure_key_uidx sur
-- (appointment_id, closure_action_key) — qui ne protège JAMAIS une ligne où appointment_id est
-- NULL (en SQL, NULL n'est jamais égal à NULL pour une contrainte d'unicité : deux lignes ayant
-- toutes deux appointment_id = NULL et la même closure_action_key ne sont PAS considérées comme
-- des doublons par cet index). Or une relance créée comme "Suite" d'une interaction (P1.2) a
-- justement appointment_id = NULL : réutiliser closure_action_key sans corriger l'index ne
-- protégerait donc RIEN, silencieusement.
--
-- Correction minimale : réutiliser la même colonne (aucune nouvelle colonne), même table, même
-- convention de valeur (chaîne déterministe) — seulement un second index, scopé par
-- source_interaction_id (ajoutée en P1.2) au lieu de appointment_id. Les deux index portent sur
-- des colonnes disjointes (une relance issue d'un RDV a toujours source_interaction_id = NULL,
-- et vice versa) : aucune collision possible, l'index RDV existant n'est ni modifié ni affecté.
CREATE UNIQUE INDEX IF NOT EXISTS followups_interaction_closure_key_uidx
  ON public.followups (source_interaction_id, closure_action_key)
  WHERE closure_action_key IS NOT NULL AND source_interaction_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
