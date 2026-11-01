import type { NextActionType } from '@/shared/lib/types'

// CARE-JOURNEY-1 — modèles d'accompagnement fournis. Volontairement neutres (aucune marque,
// aucun vocabulaire propre à une entreprise) : valables pour toute activité. Libellés et messages
// dans i18n (care.templates.<key>.steps.<step>), jamais en dur ici.

export type CareChannel = Extract<NextActionType, 'whatsapp' | 'sms' | 'call' | 'email'>

export const CARE_CHANNELS: CareChannel[] = ['whatsapp', 'sms', 'call', 'email']

export const CARE_CHANNEL_ICON: Record<CareChannel, string> = {
  whatsapp: '💬',
  sms:      '✉️',
  call:     '📞',
  email:    '📧',
}

export interface CareTemplateStep {
  key: string
  offsetDays: number
  channel: CareChannel
}

export interface CareTemplate {
  key: string
  steps: CareTemplateStep[]
  // PARTNER-ONBOARDING-1 — à qui s'adresse le parcours (défaut : clients).
  audience?: 'customer' | 'partner'
}

export const CARE_TEMPLATES: CareTemplate[] = [
  {
    key: 'care_120',
    steps: [
      { key: 'd30',  offsetDays: 30,  channel: 'whatsapp' },
      { key: 'd60',  offsetDays: 60,  channel: 'whatsapp' },
      { key: 'd90',  offsetDays: 90,  channel: 'call' },
      { key: 'd120', offsetDays: 120, channel: 'whatsapp' },
    ],
  },
  {
    key: 'start_30',
    steps: [
      { key: 'd7',  offsetDays: 7,  channel: 'whatsapp' },
      { key: 'd15', offsetDays: 15, channel: 'whatsapp' },
      { key: 'd30', offsetDays: 30, channel: 'whatsapp' },
    ],
  },
  {
    // PARTNER-ONBOARDING-1 — accueil d'une nouvelle recrue : bienvenue, outils, premiers
    // contacts, premier client, bilan du premier mois.
    key: 'partner_onboarding',
    audience: 'partner',
    steps: [
      { key: 'd1',  offsetDays: 1,  channel: 'whatsapp' },
      { key: 'd3',  offsetDays: 3,  channel: 'call' },
      { key: 'd7',  offsetDays: 7,  channel: 'whatsapp' },
      { key: 'd14', offsetDays: 14, channel: 'call' },
      { key: 'd30', offsetDays: 30, channel: 'call' },
    ],
  },
]

// Étapes facultatives, communes à tous les modèles.
export type CareExtraKey = 'birthday' | 'anniversary'

export function getCareTemplate(key: string): CareTemplate {
  return CARE_TEMPLATES.find(tpl => tpl.key === key) ?? CARE_TEMPLATES[0]
}

// ── Dates (chaînes locales YYYY-MM-DD, jamais converties en UTC) ─────────────────────────────

export function todayLocalStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Prochain anniversaire à partir de la date de départ (incluse).
export function nextBirthdayStr(birthDate: string, fromStr: string): string {
  const [, bm, bd] = birthDate.slice(0, 10).split('-').map(Number)
  const fromYear = Number(fromStr.slice(0, 4))
  const candidate = (year: number) => {
    const date = new Date(year, bm - 1, bd)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }
  const thisYear = candidate(fromYear)
  return thisYear >= fromStr ? thisYear : candidate(fromYear + 1)
}

export function daysBetweenStr(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split('-').map(Number)
  const [ty, tm, td] = toStr.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

// Inverse de renderCareMessage pour enregistrer un favori : le prénom du contact redevient la
// variable, pour que le favori serve à n'importe quel contact.
export function unrenderCareMessage(body: string, vars: { prénom: string; mon_prénom: string }): string {
  let out = body
  if (vars.mon_prénom) out = out.split(vars.mon_prénom).join('{mon_prénom}')
  if (vars.prénom) out = out.split(vars.prénom).join('{prénom}')
  return out
}

export function renderCareMessage(body: string, vars: { prénom: string; mon_prénom: string }): string {
  return body
    .replace(/\{prénom\}/g, vars.prénom)
    .replace(/\{mon_prénom\}/g, vars.mon_prénom)
}
