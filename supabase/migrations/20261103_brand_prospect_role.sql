-- BRAND-PROSPECT-1 — "Prospect" devient un statut par marque, et le statut général d'un contact
-- rattaché à des marques est toujours le plus avancé de ses marques :
--   Leader > Partenaire > Client > Prospect (l'étape de prospect — Contacté, Présentation… —
--   reste générale ; "Perdu" n'est jamais écrasé).
-- Exemples : client Zinzino → Client (plus de pastille "Prospect") ; client Zinzino + prospect
-- doTERRA → Client (et "Prospect · doTERRA" par marque).

-- 1. La marque accepte le statut "prospect".
ALTER TABLE public.client_brands DROP CONSTRAINT IF EXISTS client_brands_network_role_check;
ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_network_role_check
  CHECK (network_role IN ('prospect', 'customer', 'partner', 'leader'));

-- Niveau d'un statut de marque (le plus avancé l'emporte).
CREATE OR REPLACE FUNCTION public.brand_role_level(p_role text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_role WHEN 'leader' THEN 4 WHEN 'partner' THEN 3 WHEN 'customer' THEN 2 WHEN 'prospect' THEN 1 ELSE 0 END;
$$;

-- 2. Rattachement sans statut explicite : il reprend le statut actuel du contact
--    (un prospect rattaché via un RDV ou une page prospect reste prospect ; une commande = client).
CREATE OR REPLACE FUNCTION public.default_client_brand_network_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  roles text[];
  stage text;
BEGIN
  IF NEW.network_role <> 'customer' THEN
    RETURN NEW;
  END IF;
  SELECT contact_role, pipeline_stage INTO roles, stage FROM public.clients WHERE id = NEW.client_id;
  IF roles && ARRAY['leader']::text[] THEN
    NEW.network_role := 'leader';
  ELSIF roles && ARRAY['distributor', 'team_member']::text[] THEN
    NEW.network_role := 'partner';
  ELSIF NEW.source IS DISTINCT FROM 'order'
        AND NOT (roles && ARRAY['customer']::text[])
        AND coalesce(public.pipeline_stage_rank(stage), 0) < public.pipeline_stage_rank('customer') THEN
    NEW.network_role := 'prospect';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Statut général = statut le plus avancé de ses marques.
CREATE OR REPLACE FUNCTION public.sync_contact_roles_from_brands(p_client uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  best int;
  cur_roles text[];
  cur_stage text;
  next_roles text[];
  next_stage text;
BEGIN
  SELECT max(public.brand_role_level(network_role)) INTO best FROM public.client_brands WHERE client_id = p_client;
  IF best IS NULL THEN
    RETURN;
  END IF;

  SELECT contact_role, pipeline_stage INTO cur_roles, cur_stage FROM public.clients WHERE id = p_client;
  IF cur_roles IS NULL THEN
    RETURN;
  END IF;

  next_roles := ARRAY(SELECT r FROM unnest(cur_roles) r WHERE r NOT IN ('prospect', 'customer', 'distributor', 'leader', 'team_member'))
    || CASE best
         WHEN 4 THEN ARRAY['distributor', 'leader']
         WHEN 3 THEN ARRAY['distributor']
         WHEN 2 THEN ARRAY['customer']
         ELSE ARRAY['prospect'] END;

  next_stage := CASE
    WHEN cur_stage = 'lost' THEN 'lost'
    WHEN best >= 3 THEN 'distributor'
    WHEN best = 2 THEN 'customer'
    WHEN coalesce(public.pipeline_stage_rank(cur_stage), 0) BETWEEN 1 AND public.pipeline_stage_rank('customer') - 1 THEN cur_stage
    ELSE 'new_lead' END;

  IF ARRAY(SELECT r FROM unnest(next_roles) r ORDER BY r) IS DISTINCT FROM ARRAY(SELECT r FROM unnest(cur_roles) r ORDER BY r)
     OR next_stage IS DISTINCT FROM cur_stage THEN
    UPDATE public.clients SET contact_role = next_roles, pipeline_stage = next_stage WHERE id = p_client;
  END IF;
END;
$$;

-- 4. Changement d'étape direct (Modifier, RDV, relance) : un contact ne descend pas sous son
--    statut de marque (client d'une marque → au moins Client ; partenaire → Partenaire).
CREATE OR REPLACE FUNCTION public.reconcile_contact_status() RETURNS trigger AS $$
DECLARE
  roles text[] := coalesce(NEW.contact_role, ARRAY[]::text[]);
  network_roles text[] := ARRAY['distributor', 'leader', 'team_member'];
  stage_changed boolean := TG_OP = 'UPDATE' AND NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage;
  roles_changed boolean := TG_OP = 'INSERT' OR NEW.contact_role IS DISTINCT FROM OLD.contact_role;
  brand_level int := 0;
  rank int;
BEGIN
  IF 'inactive' = ANY(roles) THEN
    NEW.manually_inactive := true;
    roles := array_remove(roles, 'inactive');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT coalesce(max(public.brand_role_level(network_role)), 0) INTO brand_level FROM public.client_brands WHERE client_id = NEW.id;
  END IF;

  IF stage_changed AND NEW.pipeline_stage <> 'lost' THEN
    IF brand_level >= 3 THEN
      NEW.pipeline_stage := 'distributor';
    ELSIF brand_level = 2 AND NEW.pipeline_stage <> 'customer' THEN
      NEW.pipeline_stage := 'customer';
    END IF;
  END IF;

  rank := coalesce(public.pipeline_stage_rank(NEW.pipeline_stage), 0);

  IF stage_changed AND NEW.pipeline_stage <> 'lost' THEN
    -- L'étape fait foi : le rôle suit.
    IF rank < public.pipeline_stage_rank('customer') THEN
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('customer', 'distributor', 'leader', 'team_member', 'prospect')) || ARRAY['prospect'];
    ELSIF NEW.pipeline_stage = 'customer' THEN
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('prospect', 'distributor', 'leader', 'team_member', 'customer')) || ARRAY['customer'];
    ELSIF NEW.pipeline_stage = 'distributor' THEN
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('prospect', 'customer'));
      IF NOT (roles && network_roles) THEN roles := roles || ARRAY['distributor']; END IF;
    END IF;
  ELSIF roles_changed THEN
    -- Le rôle fait foi : l'étape suit (sans toucher à "Perdu").
    IF roles && network_roles THEN
      roles := ARRAY(SELECT r FROM unnest(roles) r WHERE r NOT IN ('prospect', 'customer'));
      IF NEW.pipeline_stage IS DISTINCT FROM 'lost' THEN NEW.pipeline_stage := 'distributor'; END IF;
    ELSIF 'customer' = ANY(roles) THEN
      roles := array_remove(roles, 'prospect');
      IF NEW.pipeline_stage IS NULL OR NEW.pipeline_stage NOT IN ('lost', 'customer') THEN NEW.pipeline_stage := 'customer'; END IF;
    ELSIF NEW.pipeline_stage IN ('customer', 'distributor') THEN
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

-- 5. Reprise : les rattachements automatiques (RDV, page prospect, recommandation) d'un contact
--    encore prospect deviennent "Prospect" dans la marque ; puis chaque contact rattaché est
--    resynchronisé sur ses marques.
UPDATE public.client_brands cb SET network_role = 'prospect', updated_at = now()
  FROM public.clients c
  WHERE c.id = cb.client_id
    AND cb.network_role = 'customer'
    AND cb.source IN ('appointment', 'lead_page', 'recommendation')
    AND NOT (c.contact_role && ARRAY['customer', 'distributor', 'leader', 'team_member'])
    AND coalesce(public.pipeline_stage_rank(c.pipeline_stage), 0) < public.pipeline_stage_rank('customer');

SELECT public.sync_contact_roles_from_brands(client_id) FROM (SELECT DISTINCT client_id FROM public.client_brands) linked;
