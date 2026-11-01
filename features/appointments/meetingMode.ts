// MEETING-MODE-1 — mode d'un rendez-vous et action "jour J" associée.
export type MeetingMode = 'in_person' | 'phone' | 'video' | 'whatsapp'

export const MEETING_MODES: MeetingMode[] = ['in_person', 'phone', 'video', 'whatsapp']

export const MEETING_MODE_ICON: Record<MeetingMode, string> = {
  in_person: '📍',
  phone: '📞',
  video: '🎥',
  whatsapp: '💬',
}

// Lien à ouvrir pour l'action du jour J, ou null si l'information manque.
export function meetingActionUrl(
  mode: MeetingMode | null,
  info: { location?: string | null; meetingUrl?: string | null; phone?: string | null },
): string | null {
  const phoneDigits = info.phone ? info.phone.replace(/[^\d+]/g, '') : ''
  switch (mode) {
    case 'in_person':
      return info.location?.trim() ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.location.trim())}` : null
    case 'video':
      return info.meetingUrl?.trim() || null
    case 'phone':
      return phoneDigits ? `tel:${phoneDigits}` : null
    case 'whatsapp': {
      // Même normalisation que MessageModal : 06… (10 chiffres) → 336…, +… gardé tel quel.
      const digits = phoneDigits.replace(/\D/g, '')
      const intl = phoneDigits.startsWith('+') ? digits : digits.startsWith('0') && digits.length === 10 ? `33${digits.slice(1)}` : digits
      return intl ? `https://api.whatsapp.com/send?phone=${intl}&type=phone_number&app_absent=0` : null
    }
    default:
      return null
  }
}
