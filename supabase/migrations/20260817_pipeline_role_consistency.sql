-- Lot 1 de l'audit pipeline_stage / contact_role (rapport du 2026-08-17, demande explicite
-- du propriétaire : conserver le modèle actuel, renforcer la cohérence — pas de refonte).
--
-- Comble la synchronisation manquante contact_role -> pipeline_stage (jusqu'ici seul le sens
-- pipeline_stage -> contact_role existait, via sync_client_role_from_pipeline_trigger) et
-- ajoute une garde anti-régression sur les 2 triggers RDV/relance qui pouvaient jusqu'ici
-- faire reculer le pipeline sans avertissement.
--
-- Décisions métier prises après analyse du code existant (voir rapport d'audit) :
--   - team_member est traité comme équivalent minimum à distributor : déjà le cas dans
--     importService.ts (initialPipelineStage) et networkService.ts (appartenance réseau) —
--     cette migration aligne juste le trigger sur une règle déjà appliquée ailleurs.
--   - 'lost' est un état spécial, jamais comparé par rang, jamais écrasé automatiquement.
--     La donnée de démo (features/demo/demoService.ts) modélise volontairement
--     contact_role=['distributor'] + pipeline_stage='lost' comme un cas légitime
--     ("distributeur devenu inactif"), pas une erreur à corriger.

-- 1. Ordre de progression du pipeline commercial, comme fonction réutilisable (au lieu du
--    CASE dupliqué en dur dans 20260712_canonical_pipeline.sql). 'lost' retourne NULL
--    volontairement : il ne participe pas au classement.
CREATE OR REPLACE FUNCTION public.pipeline_stage_rank(stage text)
RETURNS int
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE stage
    WHEN 'new_lead' THEN 1
    WHEN 'contacted' THEN 2
    WHEN 'presentation_scheduled' THEN 3
    WHEN 'presentation_completed' THEN 4
    WHEN 'follow_up' THEN 5
    WHEN 'customer' THEN 6
    WHEN 'distributor' THEN 7
    ELSE NULL
  END
$$;

-- 2. Synchronisation contrôlée contact_role -> pipeline_stage.
--    Règle : leader/distributor/team_member impliquent au minimum pipeline_stage='distributor'
--    (jamais un pipeline_stage='leader' : leader n'est pas une étape commerciale).
--    'lost' n'est jamais écrasé par cette règle (passage/sortie de 'lost' = action manuelle
--    explicite uniquement, via le formulaire Modifier).
CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE required_min text;
BEGIN
  IF NOT (NEW.contact_role && ARRAY['distributor', 'leader', 'team_member']::text[]) THEN
    RETURN NEW;
  END IF;
  IF NEW.pipeline_stage = 'lost' THEN
    RETURN NEW;
  END IF;

  required_min := 'distributor';
  IF public.pipeline_stage_rank(NEW.pipeline_stage) IS NULL
     OR public.pipeline_stage_rank(NEW.pipeline_stage) < public.pipeline_stage_rank(required_min) THEN
    NEW.pipeline_stage := required_min;
    NEW.pipeline_stage_updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_client_pipeline_from_role_trigger ON public.clients;
-- Nom choisi pour trier alphabétiquement AVANT sync_client_role_from_pipeline_trigger : les
-- triggers BEFORE de même timing s'exécutent par ordre alphabétique de nom en PostgreSQL, donc
-- celui-ci (role -> pipeline) s'exécute en premier, puis le trigger existant (pipeline -> role)
-- peut enrichir contact_role en conséquence dans la même écriture. Pas de risque de boucle :
-- celui-ci se déclenche sur UPDATE OF contact_role, l'autre sur UPDATE OF pipeline_stage —
-- aucun des deux ne modifie la colonne dont dépend son propre déclenchement.
CREATE TRIGGER sync_client_pipeline_from_role_trigger
BEFORE INSERT OR UPDATE OF contact_role ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.sync_client_pipeline_from_role();

-- 3. Garde anti-régression sur les triggers RDV/relance existants : ils ne font plus reculer
--    le pipeline (rang strictement croissant requis), ne touchent jamais un contact déjà
--    'lost' (en sortir est une action manuelle), et ne fixent jamais 'lost' automatiquement.
CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target_client_id uuid;
DECLARE canonical text;
DECLARE current_stage text;
BEGIN
  canonical := public.canonical_pipeline_stage(NEW.pipeline_stage::text);
  IF canonical IS NULL OR canonical = 'lost' THEN RETURN NEW; END IF;

  SELECT client_id INTO target_client_id FROM public.appointments WHERE id = NEW.appointment_id;
  IF target_client_id IS NULL THEN RETURN NEW; END IF;

  SELECT pipeline_stage INTO current_stage FROM public.clients WHERE id = target_client_id;
  IF current_stage = 'lost' THEN RETURN NEW; END IF;
  IF public.pipeline_stage_rank(current_stage) IS NOT NULL
     AND public.pipeline_stage_rank(canonical) <= public.pipeline_stage_rank(current_stage) THEN
    RETURN NEW;
  END IF;

  UPDATE public.clients SET pipeline_stage = canonical WHERE id = target_client_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE canonical text;
DECLARE current_stage text;
BEGIN
  canonical := public.canonical_pipeline_stage(NEW.pipeline_stage::text);
  IF canonical IS NULL OR canonical = 'lost' OR NEW.client_id IS NULL THEN RETURN NEW; END IF;

  SELECT pipeline_stage INTO current_stage FROM public.clients WHERE id = NEW.client_id;
  IF current_stage = 'lost' THEN RETURN NEW; END IF;
  IF public.pipeline_stage_rank(current_stage) IS NOT NULL
     AND public.pipeline_stage_rank(canonical) <= public.pipeline_stage_rank(current_stage) THEN
    RETURN NEW;
  END IF;

  UPDATE public.clients SET pipeline_stage = canonical WHERE id = NEW.client_id;
  RETURN NEW;
END;
$$;
-- Les triggers existants (sync_client_pipeline_appointment_trigger,
-- sync_client_pipeline_followup_trigger) référencent déjà ces fonctions par nom : pas besoin
-- de les recréer, CREATE OR REPLACE FUNCTION suffit.

-- 4. Backfill piloté par le trigger lui-même (aucune logique dupliquée) : une écriture
--    "no-op" sur contact_role suffit à déclencher sync_client_pipeline_from_role_trigger pour
--    chaque ligne concernée, qui n'agit que si c'est réellement nécessaire (idempotent par
--    construction). Restreint aux contacts dont le rôle contient distributor/leader/
--    team_member ; les autres lignes ne sont pas touchées.
UPDATE public.clients
SET contact_role = contact_role
WHERE contact_role && ARRAY['distributor', 'leader', 'team_member']::text[]
  AND archived_at IS NULL;

NOTIFY pgrst, 'reload schema';
