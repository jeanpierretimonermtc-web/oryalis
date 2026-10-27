-- Lot 2 de l'audit pipeline_stage / contact_role (rapport du 2026-08-17).
--
-- journey_stage : colonne confirmée morte avant suppression —
--   - 100% des 28 contacts actifs ont journey_stage = NULL (vérifié en lecture seule)
--   - déjà retirée du formulaire Modifier avant cette migration (commentaire historique :
--     "retiré du formulaire, remplacé par pipeline_stage — valeur existante préservée")
--   - après recherche exhaustive dans le code TypeScript, plus aucune lecture ni écriture
--     (le type JourneyStage et le champ Client.journey_stage ont été retirés du code dans
--     ce même lot, avant cette migration)
--
-- Suppression sans risque : aucune donnée réelle n'est perdue (colonne déjà 100% NULL).

ALTER TABLE public.clients DROP COLUMN IF EXISTS journey_stage;

NOTIFY pgrst, 'reload schema';
