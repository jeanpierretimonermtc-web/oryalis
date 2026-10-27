// RÉCAP-3 — génération de la section "produits" du récap de RDV partagé au client.
// Pure, sans dépendance Supabase : ne connaît que la forme minimale nécessaire au texte
// (label/quantity/unitPriceEur), jamais DiscussedProduct/considered/catalogId/productId — le
// choix de quels produits inclure et si `considered` doit influencer la sélection par défaut
// reste une décision de l'appelant (app/(app)/appointments/[id]/index.tsx), pas de ce module.
export interface RecapProductLine {
  label: string
  quantity: number
  unitPriceEur?: number
}

// Prix affiché avec la même convention que partout ailleurs dans le projet (CatalogProductPicker,
// fiche RDV elle-même) : `${n.toFixed(2)} €`, sans virgule décimale ni Intl.NumberFormat — aucune
// autre logique de formatage monétaire n'existe dans le projet, celle-ci n'en crée pas une seconde.
function formatUnitPrice(unitPriceEur: number): string {
  return `${unitPriceEur.toFixed(2)} €`
}

// Un produit sans prix snapshot n'affiche jamais "0 €", "— €" ni "prix indisponible" dans un
// message client — uniquement son nom (et sa quantité si > 1). `showPrices` à false a le même
// effet que l'absence de prix : jamais de recalcul de total, unitPriceEur reste un prix UNITAIRE
// (jamais multiplié par quantity ici, pour ne pas créer d'ambiguïté prix unitaire/total).
export function formatDiscussedProductsForRecap(lines: RecapProductLine[], showPrices: boolean): string {
  return lines
    .map(({ label, quantity, unitPriceEur }) => {
      const qtySuffix = quantity > 1 ? ` ×${quantity}` : ''
      if (showPrices && unitPriceEur != null) {
        const priceSuffix = quantity > 1 ? ` — ${formatUnitPrice(unitPriceEur)} / unité` : ` — ${formatUnitPrice(unitPriceEur)}`
        return `• ${label}${qtySuffix}${priceSuffix}`
      }
      return `• ${label}${qtySuffix}`
    })
    .join('\n')
}

// RÉCAP-6.1 §17/§21 — mêmes lignes que ci-dessus (OrderProduct.price est aussi un prix UNITAIRE,
// confirmé via applyOutcomePlanActions : `sum + (p.amount ?? 0) * p.quantity`), même toggle prix
// que les produits abordés (pas de second toggle, §21). Seul ajout : le total, réutilisé tel
// quel depuis `orders.amount` (persisté, jamais recalculé — §15/§17), affiché uniquement avec
// les prix (sinon ambiguïté "total de quoi ?" sans le détail des prix qui le composent).
// ORDER-BUSINESS-4.2 §20/§33 — `returnedQty` optionnel PAR LIGNE : si fourni, la quantité NETTE
// est affichée à la place de la quantité brute — jamais dans formatDiscussedProductsForRecap
// elle-même (§33 : les produits envisagés au moment du RDV n'ont jamais de notion de retour,
// cette substitution reste locale à CETTE fonction, réservée aux lignes d'une commande réelle).
// NOTE — nécessite que l'appelant fournisse returnedQty depuis order_items réel (pas le JSON
// legacy orders.products, qui n'en a jamais) : câblage non fait dans ce lot, voir rapport
// ORDER-BUSINESS-4.2 §20.
export function formatOrderProductsForRecap(
  lines: (RecapProductLine & { returnedQty?: number })[],
  showPrices: boolean,
  total: number | null,
): string {
  const netLines = lines.map(l => ({ ...l, quantity: Math.max(l.quantity - (l.returnedQty ?? 0), 0) }))
  const bullets = formatDiscussedProductsForRecap(netLines, showPrices)
  if (showPrices && total != null) {
    return `${bullets}\nTotal : ${formatUnitPrice(total)}`
  }
  return bullets
}
