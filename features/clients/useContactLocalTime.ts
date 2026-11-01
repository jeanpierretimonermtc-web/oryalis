import { useEffect, useState } from 'react'
import { remoteTime, timeZoneCity } from './timezones'
import type { RemoteTime } from './timezones'

// CLIENT-TZ-1 — heure actuelle chez le contact, rafraîchie chaque minute ; null si même fuseau.
export function useContactLocalTime(contactTz: string | null | undefined): (RemoteTime & { city: string }) | null {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!contactTz) return
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [contactTz])
  const remote = remoteTime(now, contactTz)
  return remote && contactTz ? { ...remote, city: timeZoneCity(contactTz) } : null
}
