-- Unified subscription source of truth for Stripe, Apple App Store and Google Play.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('stripe', 'app_store', 'play_store', 'manual')),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'grace_period', 'past_due', 'paused', 'cancelled', 'expired')),
  plan text NOT NULL DEFAULT 'advisor' CHECK (plan IN ('advisor', 'leader', 'enterprise')),
  external_customer_id text,
  external_subscription_id text,
  product_id text,
  price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_subscription_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx
  ON public.subscriptions (user_id, status, current_period_end DESC);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_read_own ON public.subscriptions;
CREATE POLICY subscriptions_read_own
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- There is deliberately no client INSERT/UPDATE/DELETE policy.
-- Only trusted webhooks/service-role processes may change entitlements.

CREATE OR REPLACE FUNCTION public.refresh_profile_plan_from_subscriptions(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_plan text;
BEGIN
  SELECT s.plan INTO active_plan
  FROM public.subscriptions s
  WHERE s.user_id = target_user_id
    AND s.status IN ('trialing', 'active', 'grace_period')
    AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ORDER BY CASE s.plan WHEN 'enterprise' THEN 3 WHEN 'leader' THEN 2 ELSE 1 END DESC,
           s.current_period_end DESC NULLS FIRST
  LIMIT 1;

  IF active_plan IS NOT NULL THEN
    UPDATE public.profiles
       SET plan = active_plan, updated_at = now()
     WHERE id = target_user_id
       AND (COALESCE(plan, 'free') NOT IN ('leader', 'enterprise') OR active_plan IN ('leader', 'enterprise'));
  ELSE
    UPDATE public.profiles
       SET plan = 'free', updated_at = now()
     WHERE id = target_user_id
       AND COALESCE(plan, 'free') IN ('pro', 'advisor');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_plan_after_subscription_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_profile_plan_from_subscriptions(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_plan_subscription_trigger ON public.subscriptions;
CREATE TRIGGER sync_profile_plan_subscription_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_plan_after_subscription_change();

CREATE OR REPLACE FUNCTION public.get_my_subscription()
RETURNS TABLE (
  plan text,
  provider text,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.plan, s.provider, s.status, s.current_period_end, s.cancel_at_period_end
  FROM public.subscriptions s
  WHERE s.user_id = auth.uid()
  ORDER BY
    CASE WHEN s.status IN ('trialing', 'active', 'grace_period') THEN 0 ELSE 1 END,
    s.current_period_end DESC NULLS FIRST,
    s.updated_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_my_subscription() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_subscription() TO authenticated;
