// BRANDS-1 — reconnaissance des marques à la saisie. normalizeBrandName reproduit EXACTEMENT
// public.normalize_brand_name (20261031_brands.sql), source de vérité de l'unicité en base.
import type { Brand } from '@/shared/lib/types'
import { BRAND_REFERENCE } from './brandReference'

export function normalizeBrandName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// Tolérance proportionnelle : 1 faute jusqu'à 6 caractères, 2 au-delà.
function isNear(a: string, b: string): boolean {
  if (!a || !b) return false
  const max = Math.max(a.length, b.length) <= 6 ? 1 : 2
  return Math.abs(a.length - b.length) <= max && levenshtein(a, b) <= max
}

export type BrandCandidate =
  | { kind: 'mine'; brand: Brand; name: string }
  | { kind: 'reference'; name: string }

// Suggestions pendant la frappe : mes marques d'abord, puis la liste de référence.
export function suggestBrands(query: string, myBrands: Brand[], limit = 6): BrandCandidate[] {
  const q = normalizeBrandName(query)
  if (!q) return []
  const mine: BrandCandidate[] = myBrands
    .filter(b => b.normalized_name.includes(q) || isNear(b.normalized_name, q))
    .map(b => ({ kind: 'mine', brand: b, name: b.name }))
  const taken = new Set(myBrands.map(b => b.normalized_name))
  const refs: BrandCandidate[] = BRAND_REFERENCE
    .filter(name => {
      const n = normalizeBrandName(name)
      return !taken.has(n) && (n.includes(q) || isNear(n, q))
    })
    .map(name => ({ kind: 'reference', name }))
  return [...mine, ...refs].slice(0, limit)
}

// Avant de créer une marque : identique (même nom normalisé) ou très proche ("Zinzinno").
export type BrandMatch =
  | { kind: 'exact'; candidate: BrandCandidate }
  | { kind: 'near'; candidate: BrandCandidate }
  | { kind: 'none' }

export function matchBrand(name: string, myBrands: Brand[]): BrandMatch {
  const n = normalizeBrandName(name)
  if (!n) return { kind: 'none' }
  const exactMine = myBrands.find(b => b.normalized_name === n)
  if (exactMine) return { kind: 'exact', candidate: { kind: 'mine', brand: exactMine, name: exactMine.name } }
  const exactRef = BRAND_REFERENCE.find(r => normalizeBrandName(r) === n)
  if (exactRef) return { kind: 'exact', candidate: { kind: 'reference', name: exactRef } }
  const nearMine = myBrands.find(b => isNear(b.normalized_name, n))
  if (nearMine) return { kind: 'near', candidate: { kind: 'mine', brand: nearMine, name: nearMine.name } }
  const nearRef = BRAND_REFERENCE.find(r => isNear(normalizeBrandName(r), n))
  if (nearRef) return { kind: 'near', candidate: { kind: 'reference', name: nearRef } }
  return { kind: 'none' }
}
