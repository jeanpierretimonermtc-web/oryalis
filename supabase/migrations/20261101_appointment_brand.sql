-- APPT-BRAND-1 — Marque d'un rendez-vous, choisie à la création (mode multi-marques).
--   appointments.brand_id : marque du RDV (table brands). L'ancienne colonne
--   appointment_business_context.brand_id (qui pointe vers un catalogue) n'est pas touchée.
--   Un RDV avec contact + marque rattache automatiquement le contact à cette marque
--   (client_brands, source 'appointment'), comme une commande ou une recommandation.

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS brand_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_brand_fkey') THEN
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_brand_fkey
      FOREIGN KEY (brand_id, user_id) REFERENCES public.brands(id, user_id) ON DELETE SET NULL (brand_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS appointments_brand_idx ON public.appointments (brand_id);

CREATE OR REPLACE FUNCTION public.trg_client_brand_from_appointment() RETURNS trigger AS $$
BEGIN
  IF NEW.brand_id IS NOT NULL AND NEW.client_id IS NOT NULL THEN
    INSERT INTO public.client_brands (user_id, client_id, brand_id, source, source_at)
    VALUES (NEW.user_id, NEW.client_id, NEW.brand_id, 'appointment', NEW.start_at)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'client_brand(appointment.brand_id) %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS client_brand_from_appointment_trigger ON public.appointments;
CREATE TRIGGER client_brand_from_appointment_trigger
  AFTER INSERT OR UPDATE OF brand_id, client_id ON public.appointments
  FOR EACH ROW WHEN (NEW.brand_id IS NOT NULL AND NEW.client_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_client_brand_from_appointment();

-- Reprise : RDV dont le contexte commercial désignait déjà un catalogue de marque.
UPDATE public.appointments a
  SET brand_id = b.id
  FROM public.appointment_business_context x
  JOIN public.brands b ON b.catalog_id = COALESCE(x.brand_id, x.catalog_id)
  WHERE x.appointment_id = a.id AND b.user_id = a.user_id AND a.brand_id IS NULL;

NOTIFY pgrst, 'reload schema';
