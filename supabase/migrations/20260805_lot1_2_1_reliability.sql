-- Lot 1.2.1 : fiabilisation de la clôture conditionnelle et de la révision post-clôture.

-- 1) client_events.event_type n'autorisait pas 'outcome_change' — toute révision de résultat
--    échouait donc systématiquement côté DB (CHECK constraint), jamais détecté faute de test
--    réel en base lors du Lot 1.2. Élargissement additif, aucune ligne existante modifiée.
ALTER TABLE public.client_events DROP CONSTRAINT IF EXISTS client_events_event_type_check;
ALTER TABLE public.client_events ADD CONSTRAINT client_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'pipeline_change', 'role_change', 'appointment_cancelled', 'appointment_deleted', 'outcome_change'
  ]));

-- 2) Clé d'idempotence explicite pour les actions créées depuis une clôture/révision de RDV —
--    au-delà des seuls états React locaux (§4 Lot 1.2.1). Additive, ne backfill pas l'existant :
--    les lignes déjà présentes gardent closure_action_key = NULL et ne sont jamais concernées
--    par l'index unique (partiel, actif uniquement quand la clé est renseignée).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS closure_action_key text;
ALTER TABLE public.recommendations ADD COLUMN IF NOT EXISTS closure_action_key text;
ALTER TABLE public.followups ADD COLUMN IF NOT EXISTS closure_action_key text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_appointment_closure_key_uidx
  ON public.orders (appointment_id, closure_action_key) WHERE closure_action_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recommendations_appointment_closure_key_uidx
  ON public.recommendations (appointment_id, closure_action_key) WHERE closure_action_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS followups_appointment_closure_key_uidx
  ON public.followups (appointment_id, closure_action_key) WHERE closure_action_key IS NOT NULL;

-- 3) Révision atomique du résultat + historique, avec concurrence optimiste sur
--    outcome_revision (§8-9 Lot 1.2.1). SECURITY DEFINER car l'historique (client_events) et
--    le contexte métier (appointment_business_context) doivent être écrits dans la même
--    transaction ; l'appartenance (auth.uid()) est donc revérifiée manuellement ci-dessous,
--    au même titre que le pattern déjà utilisé par handle_new_user().
CREATE OR REPLACE FUNCTION public.revise_appointment_outcome(
  p_appointment_id uuid,
  p_expected_revision integer,
  p_next_outcome text,
  p_next_details jsonb,
  p_next_other_label text,
  p_no_followup_required boolean,
  p_reason text,
  p_old_value text,
  p_new_value text,
  p_appointment_title text,
  p_appointment_date timestamptz
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_client_id uuid;
  v_current_revision integer;
  v_new_revision integer;
BEGIN
  SELECT a.user_id, a.client_id INTO v_user_id, v_client_id
  FROM public.appointments a
  WHERE a.id = p_appointment_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'appointment_not_found';
  END IF;
  IF v_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'no_client_linked';
  END IF;

  SELECT outcome_revision INTO v_current_revision
  FROM public.appointment_business_context
  WHERE appointment_id = p_appointment_id
  FOR UPDATE;

  IF v_current_revision IS NULL THEN
    RAISE EXCEPTION 'business_context_not_found';
  END IF;
  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'revision_conflict';
  END IF;

  v_new_revision := v_current_revision + 1;

  INSERT INTO public.client_events (user_id, client_id, event_type, old_value, new_value, reason, appointment_title, appointment_date)
  VALUES (v_user_id, v_client_id, 'outcome_change', p_old_value, p_new_value, p_reason, p_appointment_title, p_appointment_date);

  UPDATE public.appointment_business_context
  SET outcome = p_next_outcome,
      outcome_details = p_next_details,
      outcome_other_label = p_next_other_label,
      outcome_revision = v_new_revision,
      no_followup_required = p_no_followup_required
  WHERE appointment_id = p_appointment_id;

  RETURN v_new_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.revise_appointment_outcome(uuid, integer, text, jsonb, text, boolean, text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revise_appointment_outcome(uuid, integer, text, jsonb, text, boolean, text, text, text, text, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
