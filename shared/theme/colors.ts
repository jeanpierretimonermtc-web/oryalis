// ─────────────────────────────────────────────────────────────────────────────
// Oryalis Design System — Premium SaaS palette
// Inspired by: Linear · Stripe · Notion · Vercel
// Brand: hummingbird · global network · cyan · blue · violet
//
// Brand accent (use only for icons, CTAs, important states — not everywhere):
//   cyan   #22D3EE
//   blue   #3B82F6
//   violet #6D3BFF
//   gradient: linear-gradient(90deg, #22D3EE → #3B82F6 → #6D3BFF)
// ─────────────────────────────────────────────────────────────────────────────

// ── Light mode ───────────────────────────────────────────────────────────────
// DESIGN-A — fond crème chaud + cartes blanches (qui se détachent sans bordure), neutres
// légèrement chauds, bleu plus profond et moins saturé. Le dégradé cyan→bleu→violet reste
// réservé au logo et à un seul bouton principal par écran.
const light = {
  // ── Backgrounds & surfaces ────────────────────────────────────────────────
  bg:                      '#F6F4EF',
  surface:                 '#FAF8F4',
  bgDim:                   '#EFECE5',    // surfaceAlt — secondary bg, sheet fills
  card:                    '#FFFFFF',
  surfaceContainerLow:     '#FAF8F4',
  surfaceContainer:        '#EFECE5',
  surfaceContainerHigh:    '#E6E1D7',
  surfaceContainerHighest: '#D3CDC1',

  // ── Text ─────────────────────────────────────────────────────────────────
  text:           '#1B2433',   // textPrimary  — headings, body (bleu nuit)
  textSecondary:  '#5B6372',   // labels, secondary info
  textTertiary:   '#9A9FA9',   // textMuted — placeholders, meta, hints
  textInverse:    '#FFFFFF',
  inverseText:    '#F8FAFC',

  // ── Borders ───────────────────────────────────────────────────────────────
  border:         '#E8E3D9',
  borderStrong:   '#D3CDC1',
  // Contour des cartes : invisible sur le fond crème (l'ombre douce suffit), conservé en
  // mode sombre où une carte sans contour se confondrait avec le fond.
  cardBorder:     'transparent',

  // ── Primary action (blue) ─────────────────────────────────────────────────
  primary:              '#2F4FB5',
  primaryAction:        '#24409A',   // hover / pressed
  primaryLight:         '#E7ECF8',   // tinted surface
  primaryLighter:       '#F2F5FC',
  onPrimary:            '#FFFFFF',
  onPrimaryContainer:   '#1F3687',

  // ── Cyan brand accent ────────────────────────────────────────────────────
  secondary:            '#22D3EE',
  secondaryContainer:   '#06B6D4',
  secondaryLight:       '#ECFEFF',
  onSecondary:          '#FFFFFF',
  onSecondaryContainer: '#0E7490',

  // ── Violet brand accent ──────────────────────────────────────────────────
  tertiary:             '#6D3BFF',
  tertiaryContainer:    '#8B5CF6',
  tertiaryLight:        '#EDE9FE',
  onTertiary:           '#FFFFFF',
  onTertiaryContainer:  '#4C1D95',

  // ── Semantic states ───────────────────────────────────────────────────────
  success:      '#10B981',
  successLight: '#D1FAE5',
  warning:      '#F59E0B',
  warningLight: '#FEF3C7',
  danger:       '#EF4444',
  dangerLight:  '#FEE2E2',

  // ── Legacy aliases ────────────────────────────────────────────────────────
  purple:           '#6D3BFF',
  purpleLight:      '#EDE9FE',
  onSurfaceVariant: '#475569',
}

// ── Dark mode ─────────────────────────────────────────────────────────────────
const dark: typeof light = {
  // ── Backgrounds & surfaces ────────────────────────────────────────────────
  bg:                      '#0B1220',
  surface:                 '#111827',
  bgDim:                   '#1E293B',
  card:                    '#111827',
  surfaceContainerLow:     '#0F172A',
  surfaceContainer:        '#1E293B',
  surfaceContainerHigh:    '#263548',
  surfaceContainerHighest: '#334155',

  // ── Text ─────────────────────────────────────────────────────────────────
  text:           '#F8FAFC',
  textSecondary:  '#CBD5E1',
  textTertiary:   '#64748B',   // textMuted — intentionally de-emphasized
  textInverse:    '#0F172A',
  inverseText:    '#0F172A',

  // ── Borders ───────────────────────────────────────────────────────────────
  border:         '#334155',
  borderStrong:   '#475569',
  cardBorder:     '#263548',

  // ── Primary action (blue — slightly brighter on dark bg) ─────────────────
  // DESIGN-A — même bleu adouci qu'en clair, éclairci juste assez pour rester lisible.
  primary:              '#5B7FE0',
  primaryAction:        '#4A6CD0',
  primaryLight:         '#1E3A5F',
  primaryLighter:       '#172844',
  onPrimary:            '#FFFFFF',
  onPrimaryContainer:   '#93C5FD',

  // ── Cyan brand accent ────────────────────────────────────────────────────
  secondary:            '#22D3EE',
  secondaryContainer:   '#06B6D4',
  secondaryLight:       '#0C3B47',
  onSecondary:          '#0B1220',
  onSecondaryContainer: '#67E8F9',

  // ── Violet brand accent ──────────────────────────────────────────────────
  tertiary:             '#8B5CF6',   // slightly lighter for dark bg readability
  tertiaryContainer:    '#6D3BFF',
  tertiaryLight:        '#1E1547',
  onTertiary:           '#FFFFFF',
  onTertiaryContainer:  '#C4B5FD',

  // ── Semantic states ───────────────────────────────────────────────────────
  success:      '#10B981',
  successLight: '#064E3B',
  warning:      '#F59E0B',
  warningLight: '#451A03',
  danger:       '#EF4444',
  dangerLight:  '#450A0A',

  // ── Legacy aliases ────────────────────────────────────────────────────────
  purple:           '#8B5CF6',
  purpleLight:      '#1E1547',
  onSurfaceVariant: '#CBD5E1',
}

// ── Status colors — CRM client statuses ───────────────────────────────────────
export const lightStatusColors: Record<string, { bg: string; text: string }> = {
  active:      { bg: '#D1FAE5', text: '#059669' },   // green  — client actif
  new_client:  { bg: '#CCFBF1', text: '#0F766E' },   // teal   — nouveau client
  prospect:    { bg: '#DBEAFE', text: '#1D4ED8' },   // blue   — prospect
  inactive:    { bg: '#FEF3C7', text: '#B45309' },   // amber  — à relancer
  loyal:       { bg: '#FFE4E6', text: '#BE123C' },   // rose   — client fidèle
  vip:         { bg: '#EDE9FE', text: '#5B21B6' },   // violet — VIP
  advisor:     { bg: '#ECFEFF', text: '#0E7490' },   // cyan   — conseillère
  team_member: { bg: '#F0FDF4', text: '#15803D' },   // green light — membre équipe
  lost:        { bg: '#F1F5F9', text: '#64748B' },   // gray   — perdu
  // ── Paliers de santé de relation (calculés, voir relationshipHealth.ts) ──
  up_to_date:   { bg: light.successLight, text: light.success },
  to_follow_up: { bg: light.warningLight, text: light.warning },
  overdue:      { bg: light.dangerLight,  text: light.danger },
  dormant:      { bg: light.surfaceContainerHigh, text: light.textTertiary },
}

export const darkStatusColors: Record<string, { bg: string; text: string }> = {
  active:      { bg: '#064E3B', text: '#34D399' },
  new_client:  { bg: '#042F2E', text: '#2DD4BF' },
  prospect:    { bg: '#1E3A5F', text: '#60A5FA' },
  inactive:    { bg: '#451A03', text: '#FCD34D' },
  loyal:       { bg: '#4C0519', text: '#FDA4AF' },
  vip:         { bg: '#1E1547', text: '#A78BFA' },
  advisor:     { bg: '#0C3B47', text: '#67E8F9' },
  team_member: { bg: '#052E16', text: '#4ADE80' },
  lost:        { bg: '#1E293B', text: '#94A3B8' },
  up_to_date:   { bg: dark.successLight, text: dark.success },
  to_follow_up: { bg: dark.warningLight, text: dark.warning },
  overdue:      { bg: dark.dangerLight,  text: dark.danger },
  dormant:      { bg: dark.surfaceContainerHigh, text: dark.textTertiary },
}

// ── Public API ────────────────────────────────────────────────────────────────
export type ThemeColors = typeof light

export const lightColors = light
export const darkColors  = dark

// Structured export for direct usage: colors.light, colors.dark, colors.brand, etc.
export const colors = {
  light,
  dark,
  brand: {
    cyan:   '#22D3EE',
    blue:   '#3B82F6',
    violet: '#6D3BFF',
  },
  // KPI card accents
  kpi: {
    clients:  '#22D3EE',   // cyan
    agenda:   '#3B82F6',   // blue
    revenue:  '#10B981',   // green
    followup: '#F59E0B',   // amber
  },
  gradients: {
    brand:    ['#22D3EE', '#3B82F6', '#6D3BFF'] as const,
    brandCss: 'linear-gradient(90deg, #22D3EE, #3B82F6, #6D3BFF)',
  },
} as const

// Converts a '#rrggbb' hex color to an 'rgba(r,g,b,a)' string — used to bake
// an opacity into a boxShadow color when the shadow tint comes from a theme token.
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Backward-compat flat aliases (used by ThemeProvider + legacy imports)
export const statusColors = lightStatusColors
