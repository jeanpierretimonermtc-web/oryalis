-- LRP-OCCURRENCE-LINK-2 — Backfill ciblé des commandes LRP historiques orphelines d'échéance.
-- Problème résolu (audit LRP-OCCURRENCE-LINK-1, lecture seule, aucune ligne modifiée) :
-- avant LRP-5 (20260826_recurring_program_occurrences.sql), une commande pouvait être rattachée
-- à un programme récurrent (orders.recurring_program_id) avec une date d'échéance stockée
-- uniquement dans la colonne dépréciée orders.recurring_occurrence_date, SANS qu'aucune ligne
-- recurring_program_occurrences ne soit jamais créée. Depuis LRP-5, la seule relation métier
-- valable est orders.recurring_occurrence_id → recurring_program_occurrences(id). Ces commandes
-- historiques restent donc affichées comme "Non rattachée à une échéance précise" sur la fiche
-- programme, alors que leur écran commande affiche une échéance issue de l'ancienne colonne.
--
-- Portée strictement limitée aux commandes satisfaisant les 3 conditions suivantes (jamais une
-- déduction à partir de order_date) :
--   recurring_program_id IS NOT NULL AND recurring_occurrence_id IS NULL
--   AND recurring_occurrence_date IS NOT NULL
-- Confirmé par audit (LRP-OCCURRENCE-LINK-1) puis re-vérifié (LRP-OCCURRENCE-LINK-2, lecture
-- seule) : exactement 1 ligne concernée en production au 2026-09-04
-- (order edf4dd98-d3cd-4244-ac31-7e05024f0a99, programme e4f459ca-7458-4d38-bf14-979aa7768b69).
--
-- Ne modifie AUCUNE colonne hors recurring_program_occurrences (nouvelles lignes) et
-- orders.recurring_occurrence_id/updated_at des seules lignes ciblées. Ne touche jamais
-- recurring_program_id, recurring_occurrence_date (conservée comme snapshot historique,
-- jamais supprimée), order_date, amount, status, order_type, is_lrp.
--
-- Idempotent : au second passage, plus aucune commande ne satisfait
-- recurring_occurrence_id IS NULL parmi les lignes déjà traitées → 0 ligne affectée.
-- Atomique : exécutée comme une seule requête (protocole simple Postgres = transaction
-- implicite unique) — jamais d'état intermédiaire "occurrence créée mais commande non liée".
--
-- confirmed_at n'est jamais fixé à now() : la confirmation réelle a eu lieu historiquement,
-- à la date de la commande (orders.order_date) — utiliser now() ici falsifierait l'historique.

-- ── Étape 1 — matérialiser l'échéance manquante ────────────────────────────────────────────
-- Une seule occurrence par (recurring_program_id, scheduled_date) : si plusieurs commandes
-- legacy partagent la même échéance, DISTINCT ON ne matérialise qu'une seule ligne (la plus
-- ancienne par order_date sert de source pour confirmed_at) ; ON CONFLICT DO NOTHING protège
-- à la fois contre une occurrence déjà existante et contre un doublon intra-lot.
WITH candidates AS (
  SELECT DISTINCT ON (o.recurring_program_id, o.recurring_occurrence_date)
    o.user_id,
    o.client_id,
    o.recurring_program_id,
    o.recurring_occurrence_date AS scheduled_date,
    o.order_date
  FROM public.orders o
  WHERE o.recurring_program_id IS NOT NULL
    AND o.recurring_occurrence_id IS NULL
    AND o.recurring_occurrence_date IS NOT NULL
  ORDER BY o.recurring_program_id, o.recurring_occurrence_date, o.order_date ASC
)
INSERT INTO public.recurring_program_occurrences
  (user_id, client_id, recurring_program_id, scheduled_date, status, confirmed_at)
SELECT c.user_id, c.client_id, c.recurring_program_id, c.scheduled_date, 'confirmed', c.order_date
FROM candidates c
WHERE NOT EXISTS (
  SELECT 1 FROM public.recurring_program_occurrences occ
  WHERE occ.recurring_program_id = c.recurring_program_id
    AND occ.scheduled_date = c.scheduled_date
)
ON CONFLICT (recurring_program_id, scheduled_date) DO NOTHING;

-- ── Étape 2 — relier les commandes à l'échéance (nouvelle ou déjà existante) ───────────────
-- Le WHERE re-applique les 3 conditions strictes : une commande déjà liée entre l'étape 1 et
-- l'étape 2 (impossible ici, requête unique, mais gardé pour lisibilité/robustesse) ne serait
-- de toute façon plus sélectionnée puisque recurring_occurrence_id ne serait plus NULL.
UPDATE public.orders o
SET recurring_occurrence_id = occ.id,
    updated_at = now()
FROM public.recurring_program_occurrences occ
WHERE o.recurring_program_id IS NOT NULL
  AND o.recurring_occurrence_id IS NULL
  AND o.recurring_occurrence_date IS NOT NULL
  AND occ.recurring_program_id = o.recurring_program_id
  AND occ.scheduled_date = o.recurring_occurrence_date;
