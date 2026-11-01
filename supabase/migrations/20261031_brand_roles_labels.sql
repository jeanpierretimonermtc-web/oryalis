-- BRAND-ROLES-1 — Vocabulaire et rôles par marque.
--   brands.role_labels         : libellés propres à la marque {"customer","partner","leader"}
--                                ("Conseillère" chez doTERRA, "Partenaire" chez Zinzino).
--   client_brands.network_role : + 'leader'.
--   Rôles CRM synchronisés : pour un contact rattaché à au moins une marque, les rôles réseau de
--   clients.contact_role (distributor / leader / team_member) sont déduits de ses rôles de marque.
--   Prospect / client / inactif ne sont jamais touchés ; un contact sans marque ne change pas.

ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS role_labels jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.client_brands DROP CONSTRAINT IF EXISTS client_brands_network_role_check;
ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_network_role_check
  CHECK (network_role IN ('customer', 'partner', 'leader'));

-- Un nouveau lien (manuel ou automatique via commande / RDV) hérite du rôle réseau actuel du
-- contact, pour ne jamais rétrograder une conseillère en "client" par défaut.
CREATE OR REPLACE FUNCTION public.default_client_brand_network_role() RETURNS trigger AS $$
DECLARE roles text[];
BEGIN
  IF NEW.network_role <> 'customer' THEN
    RETURN NEW;
  END IF;
  SELECT contact_role INTO roles FROM public.clients WHERE id = NEW.client_id;
  IF roles && ARRAY['leader']::text[] THEN
    NEW.network_role := 'leader';
  ELSIF roles && ARRAY['distributor', 'team_member']::text[] THEN
    NEW.network_role := 'partner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS client_brands_default_role_trigger ON public.client_brands;
CREATE TRIGGER client_brands_default_role_trigger
  BEFORE INSERT ON public.client_brands
  FOR EACH ROW EXECUTE FUNCTION public.default_client_brand_network_role();

CREATE OR REPLACE FUNCTION public.sync_contact_roles_from_brands(p_client uuid) RETURNS void AS $$
DECLARE
  link_count int;
  is_partner boolean;
  is_leader boolean;
  cur_roles text[];
  cur_stage text;
  next_roles text[];
  next_stage text;
BEGIN
  SELECT count(*), coalesce(bool_or(network_role IN ('partner', 'leader')), false), coalesce(bool_or(network_role = 'leader'), false)
    INTO link_count, is_partner, is_leader
    FROM public.client_brands WHERE client_id = p_client;
  IF link_count = 0 THEN
    RETURN;
  END IF;

  SELECT contact_role, pipeline_stage INTO cur_roles, cur_stage FROM public.clients WHERE id = p_client;
  IF cur_roles IS NULL THEN
    RETURN;
  END IF;

  next_roles := ARRAY(SELECT r FROM unnest(cur_roles) r WHERE r NOT IN ('distributor', 'leader', 'team_member'));
  IF is_partner THEN next_roles := next_roles || ARRAY['distributor']; END IF;
  IF is_leader THEN next_roles := next_roles || ARRAY['leader']; END IF;
  IF cardinality(next_roles) = 0 THEN next_roles := ARRAY['customer']; END IF;

  -- Sans rôle réseau, l'étape "distributor" redescendrait sinon remettre le rôle (trigger
  -- sync_client_role_from_pipeline).
  next_stage := cur_stage;
  IF NOT is_partner AND cur_stage = 'distributor' THEN
    next_stage := CASE WHEN 'customer' = ANY(next_roles) THEN 'customer' ELSE 'follow_up' END;
  END IF;

  IF ARRAY(SELECT r FROM unnest(next_roles) r ORDER BY r) IS DISTINCT FROM ARRAY(SELECT r FROM unnest(cur_roles) r ORDER BY r)
     OR next_stage IS DISTINCT FROM cur_stage THEN
    UPDATE public.clients SET contact_role = next_roles, pipeline_stage = next_stage WHERE id = p_client;
  END IF;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.client_brands_sync_roles() RETURNS trigger AS $$
BEGIN
  PERFORM public.sync_contact_roles_from_brands(CASE WHEN TG_OP = 'DELETE' THEN OLD.client_id ELSE NEW.client_id END);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS client_brands_sync_roles_trigger ON public.client_brands;
CREATE TRIGGER client_brands_sync_roles_trigger
  AFTER INSERT OR DELETE OR UPDATE OF network_role ON public.client_brands
  FOR EACH ROW EXECUTE FUNCTION public.client_brands_sync_roles();

-- Reprise : un leader CRM devient leader dans ses marques où il est partenaire.
UPDATE public.client_brands cb
  SET network_role = 'leader'
  FROM public.clients c
  WHERE c.id = cb.client_id AND 'leader' = ANY(c.contact_role) AND cb.network_role = 'partner';

-- Libellés des marques connues (seulement si encore vides).
UPDATE public.brands SET role_labels = '{"customer":"Client","partner":"Conseillère","leader":"Conseillère Leader"}'::jsonb
  WHERE normalized_name = 'doterra' AND role_labels = '{}'::jsonb;
UPDATE public.brands SET role_labels = '{"customer":"Client","partner":"Partenaire","leader":"Partenaire Leader"}'::jsonb
  WHERE normalized_name = 'zinzino' AND role_labels = '{}'::jsonb;

-- Alignement des rôles CRM existants.
SELECT public.sync_contact_roles_from_brands(client_id) FROM (SELECT DISTINCT client_id FROM public.client_brands) t;

NOTIFY pgrst, 'reload schema';
