function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/**
 * Formats a date for display. French locale always renders DD/MM/YYYY;
 * other locales keep the given Intl options (default: day/month/year).
 */
export function formatDate(
  value: string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }
): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (locale.startsWith('fr')) {
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
  }
  return d.toLocaleDateString(locale, options)
}

/** Converts an ISO date ('YYYY-MM-DD') to a DD/MM/YYYY display string. */
export function isoToDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return ''
  return `${d}/${m}/${y}`
}

/** Converts up to 8 typed digits (DDMMYYYY) into a partial 'DD/MM/YYYY' string as the user types. */
export function digitsToDisplayDate(digits: string): string {
  const d = digits.slice(0, 2)
  const m = digits.slice(2, 4)
  const y = digits.slice(4, 8)
  return [d, m, y].filter(Boolean).join('/')
}

/** Converts 8 typed digits (DDMMYYYY) into an ISO 'YYYY-MM-DD' string, or '' if incomplete. */
export function digitsToIsoDate(digits: string): string {
  if (digits.length < 8) return ''
  const d = digits.slice(0, 2)
  const m = digits.slice(2, 4)
  const y = digits.slice(4, 8)
  return `${y}-${m}-${d}`
}
