// RDV/CONTACT/RELANCES — P4 §3 — audit confirmé : aucun helper monnaie partagé n'existait avant
// ce lot (chaque écran répétait `.toFixed(2) + ' €'`, toujours avec un point décimal même en
// locale FR — ex. "12.00 €" au lieu de "12,00 €"). Solution minimale, cohérente avec la
// convention déjà établie dans tout le reste d'Oryalis (suffixe " €" systématique, jamais un
// symbole préfixé façon $12.00) : seule la séparation décimale change selon la locale.
// Volontairement PAS de refonte globale — uniquement utilisé dans le périmètre de ce lot
// (RDV, clôture, CatalogProductPicker) ; les écrans déjà existants avec leur propre formule
// (orders/index.tsx, OrderEditModal.tsx, etc., déjà audités et stables) restent inchangés.
export function formatMoneyAmount(value: number, locale: string): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatMoney(value: number | null | undefined, locale: string): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${formatMoneyAmount(value, locale)} €`
}
