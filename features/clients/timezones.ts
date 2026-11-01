// CLIENT-TZ-1 — fuseau horaire d'un contact : heure "chez lui" à côté de la mienne.
// Les heures restent stockées en UTC ; l'heure d'été / d'hiver de chaque pays est appliquée
// par Intl (base de fuseaux du système), jamais par un calcul manuel.

// Fuseaux proposés : les plus courants pour une activité francophone / MLM internationale.
// Toute autre valeur IANA valide reste acceptée (base : clients_timezone_format_check).
export const TIMEZONE_OPTIONS: string[] = [
  'Europe/Paris', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Luxembourg', 'Europe/Monaco',
  'Europe/London', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Rome', 'Europe/Berlin',
  'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Warsaw',
  'Europe/Athens', 'Europe/Bucharest', 'Europe/Istanbul', 'Europe/Moscow',
  'Africa/Casablanca', 'Africa/Algiers', 'Africa/Tunis', 'Africa/Dakar', 'Africa/Abidjan',
  'Africa/Douala', 'Africa/Kinshasa', 'Africa/Johannesburg', 'Indian/Reunion', 'Indian/Mauritius',
  'Indian/Mayotte', 'Asia/Dubai', 'Asia/Jerusalem', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Noumea', 'Pacific/Tahiti',
  'America/Montreal', 'America/Toronto', 'America/Vancouver', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Mexico_City', 'America/Guadeloupe',
  'America/Martinique', 'America/Cayenne', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
]

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'
  } catch {
    return 'Europe/Paris'
  }
}

// "America/Argentina/Buenos_Aires" → "Buenos Aires" : nom de ville, identique dans toutes les langues.
export function timeZoneCity(tz: string): string {
  const last = tz.split('/').pop() ?? tz
  return last.replace(/_/g, ' ')
}

// Décalage UTC à une date donnée (tient compte de l'heure d'été), en minutes.
export function timeZoneOffsetMinutes(tz: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at)
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
    return Math.round((asUtc - at.getTime()) / 60000)
  } catch {
    return 0
  }
}

export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+'
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

export interface RemoteTime {
  time: string
  // -1 = la veille chez le contact, +1 = le lendemain, 0 = même jour.
  dayShift: number
  // Heure "difficile" chez le contact (avant 8 h ou après 21 h).
  unsocial: boolean
}

// Heure affichée chez le contact pour un instant donné, ou null si même décalage que moi.
export function remoteTime(at: Date, contactTz: string | null | undefined, myTz: string = deviceTimeZone()): RemoteTime | null {
  if (!contactTz || contactTz === myTz) return null
  const diff = timeZoneOffsetMinutes(contactTz, at) - timeZoneOffsetMinutes(myTz, at)
  if (diff === 0) return null
  const local = new Date(at.getTime() + diff * 60000)
  const hours = local.getHours()
  const dayShift = Math.round(
    (new Date(local.getFullYear(), local.getMonth(), local.getDate()).getTime()
      - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86400000,
  )
  return {
    time: `${String(hours).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`,
    dayShift,
    unsocial: hours < 8 || hours >= 21,
  }
}

// Prochain passage à `hour`:00 chez le contact, exprimé comme un instant réel (Date).
export function nextContactLocalHour(contactTz: string, hour: number, from: Date = new Date(), myTz: string = deviceTimeZone()): Date {
  const diff = timeZoneOffsetMinutes(contactTz, from) - timeZoneOffsetMinutes(myTz, from)
  const theirNow = new Date(from.getTime() + diff * 60000)
  const target = new Date(theirNow.getFullYear(), theirNow.getMonth(), theirNow.getDate(), hour, 0, 0, 0)
  if (target.getTime() <= theirNow.getTime()) target.setDate(target.getDate() + 1)
  return new Date(target.getTime() - diff * 60000)
}
