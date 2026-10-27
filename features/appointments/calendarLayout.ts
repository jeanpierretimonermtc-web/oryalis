// Layout pur (aucun React/Supabase/thème/i18n) : transforme une liste de RDV d'une même
// journée en laneIndex/laneCount, pour que les vues Semaine/Jour du calendrier positionnent
// les blocs qui se chevauchent côte à côte plutôt que superposés. Ne connaît ni
// START_HOUR/END_HOUR ni la largeur réelle de l'écran — uniquement les timestamps
// start_at/end_at ; le rendu (app/(app)/appointments/index.tsx) reste seul responsable de
// convertir laneIndex/laneCount en pixels.
//
// À appeler séparément pour chaque journée (les collisions d'un jour ne doivent jamais
// affecter la largeur des RDV d'un autre jour) — jamais sur un ensemble multi-jours d'un coup.

export interface CalendarLayoutItem<T> {
  appointment: T
  laneIndex: number
  laneCount: number
}

interface LayoutInput {
  id: string
  start_at: string
  end_at: string
}

function toMs(iso: string): number {
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

// end_at <= start_at (donnée anormale) : traité comme une durée nulle, jamais négative —
// évite toute largeur négative ou boucle sans introduire de nouvelle règle métier. La
// validation de saisie existante (app/(app)/appointments/new.tsx, handleSave) empêche déjà
// end_at <= start_at à la création/édition ; ce clamp est une sécurité purement numérique du
// helper de layout, pas une règle métier supplémentaire.
function normalizedEnd(item: LayoutInput): number {
  return Math.max(toMs(item.end_at), toMs(item.start_at))
}

// Tri stable : start_at, puis end_at, puis id — un même horaire produit toujours le même
// ordre relatif d'un render à l'autre, indépendamment de l'ordre renvoyé par Supabase.
function sortStable<T extends LayoutInput>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byStart = toMs(a.start_at) - toMs(b.start_at)
    if (byStart !== 0) return byStart
    const byEnd = normalizedEnd(a) - normalizedEnd(b)
    if (byEnd !== 0) return byEnd
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

// Regroupe les RDV triés en ensembles temporellement connectés : deux RDV rejoignent le même
// groupe dès que l'un commence avant la fin la plus tardive déjà vue dans le groupe courant —
// c'est ce qui rend le regroupement transitif (A chevauche B, B chevauche C ⇒ A/B/C dans le
// même groupe même si A ne chevauche pas C directement). Borne de fin exclusive : un RDV qui
// commence exactement quand le précédent se termine ouvre un nouveau groupe (pas de
// chevauchement au sens métier).
function buildCollisionGroups<T extends LayoutInput>(sorted: T[]): T[][] {
  const groups: T[][] = []
  let current: T[] = []
  let currentMaxEnd = -Infinity

  for (const item of sorted) {
    const start = toMs(item.start_at)
    const end = normalizedEnd(item)
    if (current.length === 0 || start < currentMaxEnd) {
      current.push(item)
      currentMaxEnd = Math.max(currentMaxEnd, end)
    } else {
      groups.push(current)
      current = [item]
      currentMaxEnd = end
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

// Affectation gloutonne de lanes (le groupe est déjà trié par start) : chaque RDV prend la
// première lane dont le dernier occupant est déjà terminé (laneEnd <= start), sinon ouvre une
// nouvelle lane. Résultat classique de coloration d'intervalles : le nombre de lanes obtenu
// est exactement le nombre maximal de RDV réellement simultanés à un instant donné dans le
// groupe (pas une approximation) — ex. A 10:00–10:45 / B 10:30–11:15 / C 11:00–11:45 forment
// un groupe connecté à 3 RDV mais seulement 2 lanes, car C peut réutiliser la lane libérée
// par A à 10:45.
function assignLanes<T extends LayoutInput>(group: T[]): Map<T, number> {
  const laneEndByIndex: number[] = []
  const laneIndexByItem = new Map<T, number>()

  for (const item of group) {
    const start = toMs(item.start_at)
    const end = normalizedEnd(item)
    let lane = laneEndByIndex.findIndex(laneEnd => laneEnd <= start)
    if (lane === -1) {
      lane = laneEndByIndex.length
      laneEndByIndex.push(end)
    } else {
      laneEndByIndex[lane] = end
    }
    laneIndexByItem.set(item, lane)
  }

  return laneIndexByItem
}

export function layoutCalendarAppointments<T extends LayoutInput>(appointments: T[]): CalendarLayoutItem<T>[] {
  const groups = buildCollisionGroups(sortStable(appointments))

  const result: CalendarLayoutItem<T>[] = []
  for (const group of groups) {
    const laneIndexByItem = assignLanes(group)
    // laneCount est une propriété du groupe entier, dupliquée sur chaque RDV qui le compose —
    // tous les membres d'un même groupe partagent la même largeur, même ceux qui réutilisent
    // une lane libérée par un autre (cf. commentaire d'assignLanes).
    const laneCount = Math.max(...Array.from(laneIndexByItem.values())) + 1
    for (const item of group) {
      result.push({ appointment: item, laneIndex: laneIndexByItem.get(item)!, laneCount })
    }
  }
  return result
}
