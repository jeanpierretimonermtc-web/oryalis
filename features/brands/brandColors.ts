// BRANDS-1 — couleurs de pastille. Une marque sans couleur choisie reçoit une couleur stable
// dérivée de son nom (jamais aléatoire : la même marque garde la même couleur partout).
// Couleurs de marque (données utilisateur), pas des tokens de thème : fond clair + texte foncé
// lisibles en mode clair comme sombre.
export interface BrandPalette { key: string; bg: string; text: string }

export const BRAND_PALETTES: BrandPalette[] = [
  { key: 'rose',   bg: '#FFE4E6', text: '#BE123C' },
  { key: 'green',  bg: '#DCFCE7', text: '#15803D' },
  { key: 'blue',   bg: '#DBEAFE', text: '#1D4ED8' },
  { key: 'amber',  bg: '#FEF3C7', text: '#B45309' },
  { key: 'violet', bg: '#EDE9FE', text: '#6D28D9' },
  { key: 'cyan',   bg: '#CFFAFE', text: '#0E7490' },
  { key: 'orange', bg: '#FFEDD5', text: '#C2410C' },
  { key: 'slate',  bg: '#E2E8F0', text: '#334155' },
]

export function brandPalette(brand: { color: string | null; normalized_name: string }): BrandPalette {
  const chosen = BRAND_PALETTES.find(p => p.key === brand.color)
  if (chosen) return chosen
  let hash = 0
  for (const ch of brand.normalized_name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return BRAND_PALETTES[hash % BRAND_PALETTES.length]
}
