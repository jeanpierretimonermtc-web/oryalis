import { supabase } from '@/shared/lib/supabase'

export async function getMfaState() {
  const [{ data: aal, error: aalError }, { data: factors, error: factorsError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ])
  if (aalError) throw aalError
  if (factorsError) throw factorsError
  return {
    currentLevel: aal.currentLevel,
    nextLevel: aal.nextLevel,
    verifiedTotp: factors.totp.find(factor => factor.status === 'verified') ?? null,
  }
}

export async function enrollTotp() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Oryalis owner' })
  if (error) throw error
  return data
}

export async function verifyTotp(factorId: string, code: string) {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError) throw challengeError
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.trim(),
  })
  if (error) throw error
  return data
}
