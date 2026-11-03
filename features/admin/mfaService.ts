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

export async function enrollTotp(friendlyName = 'Oryalis owner') {
  // Une configuration abandonnée laisse un facteur non vérifié qui bloque la suivante : on le retire.
  const { data: factors } = await supabase.auth.mfa.listFactors()
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${friendlyName} ${new Date().toISOString().slice(0, 10)}` })
  if (error) throw error
  return data
}

export async function unenrollTotp(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
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
