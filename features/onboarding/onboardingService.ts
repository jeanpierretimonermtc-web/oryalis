import { supabase } from '@/shared/lib/supabase'
export type OnboardingEvent = 'started' | 'profile_completed' | 'contact_created' | 'import_chosen' | 'action_created' | 'action_skipped' | 'completed'
export async function trackOnboardingEvent(userId: string, eventName: OnboardingEvent, step: 1 | 2 | 3, metadata: Record<string, unknown> = {}) {
  const { error } = await supabase.from('onboarding_events').insert({ user_id: userId, event_name: eventName, step, metadata })
  if (error) console.error('[onboarding.track]', error.message)
}
