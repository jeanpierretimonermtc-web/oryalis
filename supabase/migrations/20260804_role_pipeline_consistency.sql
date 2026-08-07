-- Incohérence constatée : un contact fraîchement créé recevait contact_role=['customer']
-- (rôle relationnel) alors que pipeline_stage='new_lead' (étape "Nouveau prospect") — les
-- deux dimensions sont censées être indépendantes ("Une notion, une responsabilité") mais
-- leurs valeurs par défaut se contredisaient dès la création.

-- 1. Le défaut de la colonne doit refléter un contact tout juste créé : un prospect, pas
--    déjà un client — cohérent avec pipeline_stage DEFAULT 'new_lead'.
ALTER TABLE public.clients
  ALTER COLUMN contact_role SET DEFAULT ARRAY['prospect']::text[];

-- 2. Correction des lignes existantes qui portent exactement la signature du défaut jamais
--    modifié (rôle strictement ['customer'] et pipeline encore à 'new_lead') — ne touche pas
--    aux contacts dont le rôle "customer" a été choisi ou combiné à d'autres rôles.
UPDATE public.clients
SET contact_role = ARRAY['prospect']::text[]
WHERE contact_role = ARRAY['customer']::text[] AND pipeline_stage = 'new_lead';

-- 3. Garde-fou permanent dans l'autre sens : si le pipeline atteint une étape de conversion
--    (customer/distributor), le rôle relationnel doit refléter cette conversion — quel que
--    soit le point d'entrée (fiche RDV, formulaire Modifier, import, automatisation…).
CREATE OR REPLACE FUNCTION public.sync_client_role_from_pipeline()
RETURNS trigger AS $$
BEGIN
  IF NEW.pipeline_stage IN ('customer', 'distributor')
     AND NOT (NEW.pipeline_stage = ANY(NEW.contact_role)) THEN
    NEW.contact_role := array_append(NEW.contact_role, NEW.pipeline_stage);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS sync_client_role_from_pipeline_trigger ON public.clients;
CREATE TRIGGER sync_client_role_from_pipeline_trigger
BEFORE INSERT OR UPDATE OF pipeline_stage ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.sync_client_role_from_pipeline();

-- 4. Backfill du même garde-fou pour les lignes déjà en base.
UPDATE public.clients
SET contact_role = array_append(contact_role, pipeline_stage)
WHERE pipeline_stage IN ('customer', 'distributor') AND NOT (pipeline_stage = ANY(contact_role));

NOTIFY pgrst, 'reload schema';
