// CONTACTS-DUPLICATES-1 — détection de doublons POSSIBLES parmi les contacts existants, en
// lecture seule (aucune fusion, aucune écriture) : le signal aide l'utilisateur à vérifier,
// jamais une décision automatique. Pure, sans dépendance Supabase.
export type DuplicateReason = 'email' | 'phone' | 'name'

export interface DuplicateInfo {
  reasons: DuplicateReason[]
  // Identifiant du groupe de contacts liés entre eux (A~B par e-mail, B~C par téléphone → un
  // seul groupe A/B/C), pour afficher les doublons côte à côte.
  groupId: string
}

interface DuplicateCandidate {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

function normalizeEmail(raw: string | null): string | null {
  const v = raw?.trim().toLowerCase() ?? ''
  return v.includes('@') ? v : null
}

// Les 9 derniers chiffres : "+33 6 12 34 56 78", "0033612345678" et "06 12 34 56 78" donnent la
// même clé. En dessous de 9 chiffres, numéro trop court pour être comparé sans faux positif.
function normalizePhone(raw: string | null): string | null {
  const digits = raw?.replace(/\D/g, '') ?? ''
  return digits.length >= 9 ? digits.slice(-9) : null
}

// Insensible à la casse, aux accents, à la ponctuation et à l'ordre des mots ("Dupont Marie" =
// "Marie Dupont").
function normalizeName(raw: string): string | null {
  const words = raw
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
  const v = words.join(' ')
  return v.length >= 3 ? v : null
}

export function findDuplicates(clients: DuplicateCandidate[]): Map<string, DuplicateInfo> {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra) }
  for (const c of clients) parent.set(c.id, c.id)

  const reasons = new Map<string, Set<DuplicateReason>>()
  const keyers: [DuplicateReason, (c: DuplicateCandidate) => string | null][] = [
    ['email', c => normalizeEmail(c.email)],
    ['phone', c => normalizePhone(c.phone)],
    ['name', c => normalizeName(c.full_name)],
  ]
  for (const [reason, keyOf] of keyers) {
    const byKey = new Map<string, string[]>()
    for (const c of clients) {
      const key = keyOf(c)
      if (key) (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(c.id)
    }
    for (const ids of byKey.values()) {
      if (ids.length < 2) continue
      for (const id of ids) {
        ;(reasons.get(id) ?? reasons.set(id, new Set()).get(id)!).add(reason)
        union(ids[0], id)
      }
    }
  }

  const result = new Map<string, DuplicateInfo>()
  for (const [id, set] of reasons) result.set(id, { reasons: [...set], groupId: find(id) })
  return result
}
