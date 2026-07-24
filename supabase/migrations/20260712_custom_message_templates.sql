CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('prospection','lrp','recrutement','suivi')),
  channel text NOT NULL DEFAULT 'all' CHECK (channel IN ('whatsapp','sms','all')),
  name text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS message_templates_own ON public.message_templates;
CREATE POLICY message_templates_own ON public.message_templates USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS advisor_message_templates_mutation ON public.message_templates;
CREATE TRIGGER advisor_message_templates_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.enforce_advisor_mutation();
NOTIFY pgrst, 'reload schema';
