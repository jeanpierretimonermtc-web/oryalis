// PROFILE-SHARE-1 — génération de la section "commandes" du résumé de fiche contact partagé au
// client ("Partager ma fiche"). Pure, sans dépendance Supabase : ne connaît que la forme
// minimale nécessaire (date déjà formatée, statut, lignes label/quantity, total) — jamais
// discussed_products ni le résultat "Vente réalisée" (la source réelle reste orders, résolue par
// l'appelant via getOrdersByClient/useClientOrders).
// ORDER-BUSINESS-4.2 §20/§32 — `returnedQty` optionnel : absent/0 = comportement strictement
// inchangé (aucune régression pour une ligne sans retour). Reste PUR/sans dépendance Supabase
// (voir en-tête de fichier) : le calcul net est inline, jamais importé depuis orderItemService.
export interface ClientSummaryOrderLine {
  label: string
  quantity: number
  returnedQty?: number
}

export interface ClientSummaryOrder {
  dateLabel: string
  isCancelled: boolean
  isReturned: boolean
  lines: ClientSummaryOrderLine[]
  total: number | null
}

// Une commande annulée/retournée reste dans l'historique communiqué (§10/§11) mais sans détail
// produit — une ligne compacte suffit, jamais présentée comme une commande active. Une commande
// active affiche ses lignes (nom ×quantité NETTE) et son total réel (orders.amount, jamais
// recalculé). ORDER-BUSINESS-4.2 §20 — un retour PARTIEL (isReturned=false mais des lignes ont
// returnedQty>0) n'affiche JAMAIS "Commande retournée" (réservé à status='returned', retour
// total, §17/§24 du rapport) : la commande reste "active", ses lignes affichent leur quantité
// NETTE, avec une mention compacte "(Retour partiel)" — détectée depuis les lignes elles-mêmes,
// jamais un champ séparé qui pourrait diverger.
// NOTE — cette détection dépend de `returnedQty` réellement renseigné par l'appelant : au moment
// de ce lot, le seul appelant connu (clients/[id]/index.tsx) construit encore ses lignes via
// `deriveOrderLines` (repli JSON legacy, toujours returnedQty=0 par construction, §19/§31) —
// switcher vers `getOrderItemsHybrid` (async, lit order_items.returned_qty réel) reste un
// câblage à faire séparément, documenté dans le rapport ORDER-BUSINESS-4.2 §20, pas dans ce lot.
export function formatOrdersForClientSummary(orders: ClientSummaryOrder[]): string {
  return orders
    .map(o => {
      if (o.isCancelled) return `${o.dateLabel} — Commande annulée`
      if (o.isReturned) return `${o.dateLabel} — Commande retournée`
      const hasPartialReturn = o.lines.some(l => (l.returnedQty ?? 0) > 0)
      const productLines = o.lines
        .map(l => {
          const netQty = Math.max(l.quantity - (l.returnedQty ?? 0), 0)
          return `  ${l.label}${netQty > 1 ? ` ×${netQty}` : ''}`
        })
        .join('\n')
      const totalLine = o.total != null ? `\n  Total : ${o.total.toFixed(2)} €` : ''
      const partialReturnLine = hasPartialReturn ? '\n  (Retour partiel)' : ''
      return `${o.dateLabel}\n${productLines}${totalLine}${partialReturnLine}`
    })
    .join('\n\n')
}
