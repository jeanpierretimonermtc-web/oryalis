// Oryalis construit full_name comme "Prénom Nom" à la création (voir clients/new.tsx,
// onboarding.tsx) — cette fonction retrouve la partie "Nom" pour trier/afficher les
// contacts par nom de famille, convention à laquelle les praticiens sont habitués
// (classeurs de suivi triés "NOM Prénom").
export function deriveLastName(fullName: string, firstName: string | null): string {
  const fn = (firstName ?? '').trim()
  const full = (fullName ?? '').trim()
  return fn && full.startsWith(fn) ? full.slice(fn.length).trim() : full
}
