import { useCallback, useState } from 'react'
import { listMySupportAccessRequests, type SupportAccessRequest } from '@/features/admin/adminService'
import { getMfaState } from '@/features/admin/mfaService'
import { getMyDeletionRequest, listMyLoginDevices, type AccountDeletionRequest, type LoginDevice } from './accountService'

// PRIVACY-1 — chaque bloc se charge indépendamment : un bloc indisponible (ex. migration pas
// encore exécutée) n'empêche jamais d'afficher les autres.
export function useAccountSecurity() {
  const [devices, setDevices] = useState<LoginDevice[] | null>(null)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)
  const [mfaLoaded, setMfaLoaded] = useState(false)
  const [supportRequests, setSupportRequests] = useState<SupportAccessRequest[] | null>(null)
  const [deletion, setDeletion] = useState<AccountDeletionRequest | null>(null)
  const [deletionAvailable, setDeletionAvailable] = useState(true)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    await Promise.all([
      listMyLoginDevices().then(setDevices).catch(e => { console.error('[privacy.devices]', e); setDevices(null) }),
      getMfaState().then(s => setMfaFactorId(s.verifiedTotp?.id ?? null)).catch(e => console.error('[privacy.mfa]', e)).finally(() => setMfaLoaded(true)),
      listMySupportAccessRequests().then(setSupportRequests).catch(e => { console.error('[privacy.support]', e); setSupportRequests(null) }),
      getMyDeletionRequest().then(r => { setDeletion(r); setDeletionAvailable(true) }).catch(e => { console.error('[privacy.deletion]', e); setDeletionAvailable(false) }),
    ])
    setLoading(false)
  }, [])

  return { devices, mfaFactorId, mfaLoaded, supportRequests, deletion, deletionAvailable, loading, reload }
}
