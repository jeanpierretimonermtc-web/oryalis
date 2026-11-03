-- STATUS-1 — Un seul statut de contact : l'étape du parcours et le rôle ne peuvent plus se
-- contredire. Échelle : Nouveau prospect → Contacté → Présentation prévue → Présentation faite →
-- En réflexion (rôle Prospect) → Client → Partenaire ; "Perdu" à tout moment.
--   • Quand l'étape change (Modifier, RDV, relance), le rôle suit.
--   • Quand le rôle change (marques, import, création), l'étape suit.
--   • Un partenaire dans une marque (client_brands) ne redescend pas sous "Partenaire" : son
--     rôle se règle marque par marque.
--   • "Inactif" n'est plus un rôle : c'est l'interrupteur "Ne plus contacter" (manually_inactive).
--   • Depuis un RDV, le contact n'avance que vers l'avant (sauf "Perdu", ou depuis "Perdu").
-- Remplace sync_client_pipeline_from_role et sync_client_role_from_pipeline.

DROP TRIGGER IF EXISTS sync_client_pipeline_from_role_trigger ON public.clients;
DROP TRIGGER IF EXISTS sync_client_role_from_pipeline_trigger ON public.clients;

CREATE OR REPLACE FUNCTION public.reconcile_contact_status() RETURNS trigger AS $$
DECLARE
  roles text[] := coalesce(NEW.contact_role, ARRAY[]::text[]);
  network_roles text[] := ARRAY['distributor', 'leader', 'team_member'];
  stage_changed boolean := TG_OP = 'UPDATE' AND NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage;
  roles_changed boolean := TG_OP = 'INSERT' OR NEW.contact_role IS DISTINCT FROM OLD.contact_role;
  brand_partner boolean := false;
  rank int;
BEGIN
  IF 'inactive' = ANY(roles) THEN
    NEW.manually_inactive := true;
    roles := array_remove(roles, 'inactive');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (SELECT 1 FROM public.client_brands WHERE client_id = NEW.id AND network_role <> 'customer') INTO brand_partner;
  END IF;

  rank := coalesce(public.pipeline_stage_rank(NEW.pipeline_stage), 0);

  IF stage_changed AND NEW.pipeline_stage <> 'lost' THEN
    -- L'étape fait foi : le rôle suit.
    IF brand_partner AND NEW.pipeline_stage <> 'distributor' THEN
      NEW.pipeline_stage := 'distributor';
    ELSIF rank < public.pipeline_stage_rank('customer') THEN
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('customer', 'distributor', 'leader', 'team_member', 'prospect')) || ARRAY['prospect'];
    ELSIF NEW.pipeline_stage = 'customer' THEN
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('prospect', 'distributor', 'leader', 'team_member', 'customer')) || ARRAY['customer'];
    ELSIF NEW.pipeline_stage = 'distributor' THEN
      roles := array_remove(roles, 'prospect');
      IF NOT (roles && network_roles) THEN roles := roles || ARRAY['distributor']; END IF;
    END IF;
  ELSIF roles_changed THEN
    -- Le rôle fait foi : l'étape suit (sans toucher à "Perdu").
    IF roles && network_roles THEN
      roles := array_remove(roles, 'prospect');
      IF NEW.pipeline_stage IS DISTINCT FROM 'lost' THEN NEW.pipeline_stage := 'distributor'; END IF;
    ELSIF 'customer' = ANY(roles) THEN
      roles := array_remove(roles, 'prospect');
      IF NEW.pipeline_stage IS NULL OR NEW.pipeline_stage NOT IN ('lost', 'customer') THEN NEW.pipeline_stage := 'customer'; END IF;
    ELSIF NEW.pipeline_stage IN ('customer', 'distributor') THEN
      -- Création / import avec une étape client ou partenaire : l'étape fait foi.
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r <> 'prospect')
        || CASE WHEN NEW.pipeline_stage = 'customer' THEN ARRAY['customer'] ELSE ARRAY['distributor'] END;
    END IF;
  END IF;

  IF cardinality(roles) = 0 THEN
    roles := CASE NEW.pipeline_stage WHEN 'customer' THEN ARRAY['customer'] WHEN 'distributor' THEN ARRAY['distributor'] ELSE ARRAY['prospect'] END;
  END IF;
  NEW.contact_role := ARRAY(SELECT DISTINCT r FROM unnest(roles) r ORDER BY r);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS client_status_reconcile_trigger ON public.clients;
CREATE TRIGGER client_status_reconcile_trigger
  BEFORE INSERT OR UPDATE OF contact_role, pipeline_stage ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_contact_status();

-- Depuis un RDV : seulement vers l'avant (sauf "Perdu", ou depuis "Perdu").
CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_client_id uuid;
  canonical text;
  current_stage text;
BEGIN
  canonical := public.canonical_pipeline_stage(NEW.pipeline_stage::text);
  IF canonical IS NULL THEN RETURN NEW; END IF;
  SELECT client_id INTO target_client_id FROM public.appointments WHERE id = NEW.appointment_id;
  IF target_client_id IS NULL THEN RETURN NEW; END IF;

  SELECT pipeline_stage INTO current_stage FROM public.clients WHERE id = target_client_id;
  IF canonical = 'lost'
     OR current_stage IS NULL
     OR current_stage = 'lost'
     OR coalesce(public.pipeline_stage_rank(canonical), 0) > coalesce(public.pipeline_stage_rank(current_stage), 0) THEN
    UPDATE public.clients SET pipeline_stage = canonical WHERE id = target_client_id AND pipeline_stage IS DISTINCT FROM canonical;
  END IF;
  RETURN NEW;
END;
$$;

-- Reprise des contacts incohérents.
-- 1) Rôle client/partenaire mais étape de prospect (ex. recul causé par un RDV) : l'étape remonte.
UPDATE public.clients SET pipeline_stage = CASE
    WHEN contact_role && ARRAY['distributor', 'leader', 'team_member'] THEN 'distributor'
    ELSE 'customer' END
  WHERE pipeline_stage <> 'lost'
    AND (contact_role && ARRAY['customer', 'distributor', 'leader', 'team_member'])
    AND coalesce(public.pipeline_stage_rank(pipeline_stage), 0) < public.pipeline_stage_rank('customer');
-- 2) "Inactif" en rôle : devient l'interrupteur "Ne plus contacter" ; rôle repris de l'historique
--    (a déjà commandé → client, sinon prospect).
UPDATE public.clients c SET
    manually_inactive = true,
    contact_role = CASE
      WHEN cardinality(array_remove(c.contact_role, 'inactive')) > 0 THEN array_remove(c.contact_role, 'inactive')
      WHEN EXISTS (SELECT 1 FROM public.orders o WHERE o.client_id = c.id) THEN ARRAY['customer']
      ELSE ARRAY['prospect'] END
  WHERE 'inactive' = ANY(c.contact_role);
