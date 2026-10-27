// LRP-4 — orchestration UNIQUE réutilisée par les 2 vrais points de création d'une commande
// récurrente (clients/[id]/orders.tsx, clôture RDV "Vente réalisée") : jamais une seconde
// implémentation qui dupliquerait "créer/mettre à jour la commande + créer/mettre à jour le
// programme récurrent". OrderEditModal (édition d'une commande existante) n'appelle JAMAIS ces
// fonctions — la correction d'une commande déjà créée ne doit jamais avancer le programme.
//
// Depuis LRP-4, la source de vérité du programme est `recurring_programs` (voir
// recurringProgramService.ts), plus `clients.lrp_status`/`next_lrp_date`/`lrp_frequency_*`
// (gelés, conservés uniquement pour compatibilité/historique). Le nom de ce fichier reste
// "lrpProgramService" pour éviter un renommage sans valeur ajoutée sur des call sites déjà
// nombreux — mais son contenu ne connaît plus aucun champ `clients.lrp_*`.
import type { LrpFrequencyUnit, RecurringProgram, RecurringProgramEndMode } from '@/shared/lib/types'
import { calculateNextLrpDate } from './clientService'
import type { RecurringProgramPatch } from './recurringProgramService'

export interface LrpFrequencyPreset {
  value: number
  unit: LrpFrequencyUnit
  labelKey: string
}

export const LRP_FREQUENCY_PRESETS: LrpFrequencyPreset[] = [
  { value: 4, unit: 'week',  labelKey: 'lrp.preset_4_weeks' },
  { value: 6, unit: 'week',  labelKey: 'lrp.preset_6_weeks' },
  { value: 1, unit: 'month', labelKey: 'lrp.preset_1_month' },
  { value: 2, unit: 'month', labelKey: 'lrp.preset_2_months' },
  { value: 3, unit: 'month', labelKey: 'lrp.preset_3_months' },
]

// Seule implémentation du libellé "Tous les N semaines/mois" — réutilisée par LrpProgramFields
// (bloc de confirmation commande) et par la fiche Contact (affichage lecture seule). `t` est
// injecté par l'appelant (react-i18next), jamais importé ici pour garder ce fichier hors React.
export function getLrpFrequencyLabel(
  value: number | null,
  unit: LrpFrequencyUnit | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (value == null || unit == null) return t('lrp.frequency_undefined')
  return unit === 'week' ? t('lrp.frequency_weeks', { count: value }) : t('lrp.frequency_months', { count: value })
}

// LRP-4.5 — seule implémentation du titre affiché d'un programme (nom global configuré +
// label d'instance éventuel), réutilisée partout où un programme est nommé (fiche programme,
// Synthèse, Profil, badges de commande, OrderEditModal) : jamais deux formats différents pour
// le même programme selon l'écran. Le texte du label est respecté tel que saisi (jamais
// forcé en majuscules).
export function formatProgramTitle(programName: string, label: string | null | undefined): string {
  const trimmed = label?.trim()
  return trimmed ? `${programName} — ${trimmed}` : programName
}

export interface OrderProgramBadgeInfo {
  kind: 'linked' | 'legacy'
  label: string
}

// LRP-4.5 §5/§6/§7 — seule logique de badge "commande récurrente" pour les 3 écrans qui en
// affichent un (liste globale, liste contact, OrderEditModal) : une commande sans
// recurring_program_id ne doit jamais laisser croire qu'elle appartient à un programme identifié
// (cas legacy is_lrp=true), et le nom générique "LRP" n'apparaît jamais — toujours le nom
// configuré par l'utilisateur (getLrpName()).
export function getOrderProgramBadge(
  order: { is_lrp: boolean; recurring_program_id: string | null; recurring_program?: { label: string | null } | null },
  programName: string,
): OrderProgramBadgeInfo | null {
  if (order.recurring_program_id) {
    return { kind: 'linked', label: formatProgramTitle(programName, order.recurring_program?.label) }
  }
  if (order.is_lrp) {
    return { kind: 'legacy', label: programName }
  }
  return null
}

// LRP-4.1 §1/§2 — étendu avec programId (quel programme ce brouillon vise : un id existant, ou
// null pour "nouveau programme", LRP-4.1 §3), label, et la durée complète (endMode +
// occurrenceLimit/endDate), plus longtemps portée uniquement par le service au moment de la
// sauvegarde — l'utilisateur doit pouvoir la choisir dans le formulaire, pas seulement la
// subir.
export interface LrpProgramValue {
  programId: string | null
  label: string
  frequencyValue: number
  frequencyUnit: LrpFrequencyUnit
  nextLrpDate: string
  endMode: RecurringProgramEndMode
  occurrenceLimit: number | null
  endDate: string | null
  // LRP-4.3 — identité de l'échéance consommée par CETTE commande, FIGÉE au moment de la
  // confirmation (voir initialLrpProgramValue) et plus jamais recalculée depuis le programme
  // ensuite : un retry après échec partiel doit retrouver EXACTEMENT la même échéance, même si
  // le programme a déjà été avancé une fois par un essai précédent. true = "cette commande
  // consomme la prochaine échéance prévue" (comportement par défaut, fait avancer le
  // programme) ; false = "commande complémentaire du cycle déjà en cours" (ne fait PAS avancer
  // le programme, occurrence saisie manuellement dans complementaryOccurrenceDate).
  consumesNewOccurrence: boolean
  // Échéance prévue au moment de la confirmation — pertinent seulement si
  // consumesNewOccurrence=true. null si le programme n'avait pas encore d'échéance connue.
  occurrenceDateToConsume: string | null
  // Échéance choisie manuellement — pertinent seulement si consumesNewOccurrence=false.
  complementaryOccurrenceDate: string
}

type ExistingProgramSnapshot = Pick<RecurringProgram,
  'id' | 'label' | 'frequency_value' | 'frequency_unit' | 'next_occurrence_date' |
  'end_mode' | 'occurrence_limit' | 'end_date'
> | null

// LRP-4.2 §3 — SOURCE DE VÉRITÉ du calcul de prochaine échéance, corrigeant la dérive de
// calendrier constatée : la nouvelle échéance s'ancre sur l'ÉCHÉANCE PRÉVUE consommée
// (existingProgram.next_occurrence_date), JAMAIS sur la date réelle de la commande — qu'elle
// soit en retard (28/09 au lieu du 25/09 prévu) ou en avance (20/09 au lieu du 25/09), la
// prochaine échéance reste 25/10, jamais 28/10 ou une dérive cumulative mois après mois.
// Exception documentée : pour un programme SANS échéance déjà connue (nouveau programme, ou
// fréquence définie pour la première fois sur un programme legacy sans next_occurrence_date),
// il n'existe rien à "consommer" — la date de cette commande sert alors de référence de départ,
// seule règle raisonnable pour amorcer le calendrier.
function nextOccurrenceAnchor(existingProgram: ExistingProgramSnapshot, orderDate: string): string {
  return existingProgram?.next_occurrence_date ?? orderDate
}

// Valeur de départ proposée dans le formulaire pour UN programme donné (existant → reprend ses
// réglages ; null → nouveau programme, aucune fréquence supposée). Utilisée à l'activation
// initiale ET à chaque changement de sélection dans le sélecteur multi-programmes (LRP-4.1 §3) :
// une seule fonction, jamais un second calcul de "valeur par défaut" dupliqué dans l'UI.
//
// LRP-4.2 §4 — limite connue et assumée, non résolue automatiquement : si une SECONDE commande
// est liée au même programme dans le même cycle (ex. commande complémentaire du 27/09 alors que
// l'échéance du 25/09 vient déjà d'être consommée par une 1ère commande), cette fonction ne peut
// pas savoir de façon fiable si cette 2e commande doit faire avancer le calendrier une seconde
// fois ou non — le modèle actuel (recurring_programs.next_occurrence_date, une seule valeur
// écrasée à chaque confirmation) ne mémorise pas "quelle occurrence a déjà été consommée par
// quelle commande". Une heuristique de date (ex. "si la commande est à moins de N jours de la
// dernière") serait fragile et n'a pas été implémentée. Garde-fou en place : nextLrpDate reste
// TOUJOURS proposé à l'utilisateur de façon éditable avant confirmation (jamais écrit
// silencieusement) — voir DateInput dans LrpProgramFields — donnant à l'utilisateur la
// possibilité de corriger manuellement s'il sait qu'une commande ne doit pas avancer le cycle.
export function initialLrpProgramValue(existingProgram: ExistingProgramSnapshot, orderDate: string): LrpProgramValue {
  const hasFrequency = existingProgram?.frequency_value != null && existingProgram?.frequency_unit != null
  const frequencyValue = hasFrequency ? (existingProgram!.frequency_value as number) : 1
  const frequencyUnit = hasFrequency ? (existingProgram!.frequency_unit as LrpFrequencyUnit) : 'month'
  // LRP-4.3 §9 — figée ICI, une seule fois : c'est cette valeur (jamais recalculée plus tard
  // depuis un programme potentiellement déjà avancé par un essai précédent) qui devient
  // recurring_occurrence_date sur la commande si consumesNewOccurrence reste true.
  const anchor = nextOccurrenceAnchor(existingProgram, orderDate)
  const nextLrpDate = hasFrequency
    ? calculateNextLrpDate(anchor, frequencyValue, frequencyUnit)
    : (existingProgram?.next_occurrence_date ?? '')
  return {
    programId: existingProgram?.id ?? null,
    label: existingProgram?.label ?? '',
    frequencyValue,
    frequencyUnit,
    nextLrpDate,
    endMode: existingProgram?.end_mode ?? 'open_ended',
    occurrenceLimit: existingProgram?.occurrence_limit ?? null,
    endDate: existingProgram?.end_date ?? null,
    consumesNewOccurrence: true,
    occurrenceDateToConsume: existingProgram?.next_occurrence_date ?? null,
    complementaryOccurrenceDate: '',
  }
}

// LRP-4.3 §5/§13 — SEULE source de l'échéance à inscrire sur la commande (orders.
// recurring_occurrence_date). Lit exclusivement les valeurs FIGÉES de `confirmation` — ne
// requête jamais le programme en direct — garantissant qu'un retry après échec partiel retague
// toujours la commande avec exactement la même échéance, même si le programme a déjà avancé.
export function resolveOccurrenceDateForOrder(confirmation: LrpProgramValue): string | null {
  return confirmation.consumesNewOccurrence
    ? confirmation.occurrenceDateToConsume
    : (confirmation.complementaryOccurrenceDate.trim() || null)
}

// LRP-4.2 §1 — valeur de départ pour ÉDITER un programme existant (label/fréquence/durée),
// distincte de initialLrpProgramValue : ici, next_occurrence_date n'est JAMAIS recalculée à
// l'ouverture du formulaire (seule une sélection explicite d'une nouvelle fréquence dans
// LrpProgramFields la recalcule, via selectPreset/changeCustomValue/changeCustomUnit) — sinon
// le simple fait d'ouvrir "Modifier" déplacerait la prochaine échéance sans action de
// l'utilisateur.
export function programToEditValue(program: RecurringProgram): LrpProgramValue {
  return {
    programId: program.id,
    label: program.label ?? '',
    frequencyValue: program.frequency_value ?? 1,
    frequencyUnit: program.frequency_unit ?? 'month',
    nextLrpDate: program.next_occurrence_date ?? '',
    endMode: program.end_mode,
    occurrenceLimit: program.occurrence_limit,
    endDate: program.end_date,
    // Non pertinent en édition (aucune commande n'est créée ici) — valeurs neutres.
    consumesNewOccurrence: true,
    occurrenceDateToConsume: program.next_occurrence_date,
    complementaryOccurrenceDate: '',
  }
}

// LRP-4.2 §1 — patch d'ÉDITION d'un programme existant : ne touche jamais status/start_date
// (une édition de réglages n'est ni une activation ni un changement de date de début), à
// l'inverse de buildProgramActivationPatch qui active toujours le programme depuis une commande.
export function buildProgramEditPatch(value: LrpProgramValue): RecurringProgramPatch {
  return {
    label: value.label,
    frequency_value: value.frequencyValue,
    frequency_unit: value.frequencyUnit,
    next_occurrence_date: value.nextLrpDate || null,
    end_mode: value.endMode,
    occurrence_limit: value.endMode === 'occurrence_limit' ? value.occurrenceLimit : null,
    end_date: value.endMode === 'end_date' ? value.endDate : null,
  }
}

// Patch à appliquer au programme (nouveau ou déjà existant, désigné par confirmation.programId
// côté appelant) quand l'utilisateur confirme le bloc "Programme récurrent" à la sauvegarde
// d'une commande. `existingStartDate` est la date de début déjà connue du programme visé
// (jamais écrasée) ; orderDate sert de référence uniquement si aucune date de début n'est
// encore connue (première commande identifiée pour ce programme).
export function buildProgramActivationPatch(
  existingStartDate: string | null,
  confirmation: LrpProgramValue,
  orderDate: string,
): RecurringProgramPatch {
  const patch: RecurringProgramPatch = {
    status: 'active',
    label: confirmation.label,
    frequency_value: confirmation.frequencyValue,
    frequency_unit: confirmation.frequencyUnit,
    // §9 — règle documentée : une date de début déjà connue n'est jamais écrasée ; sinon la
    // date de cette commande (première commande LRP connue pour ce programme) sert de référence.
    start_date: existingStartDate ?? orderDate,
    end_mode: confirmation.endMode,
    occurrence_limit: confirmation.endMode === 'occurrence_limit' ? confirmation.occurrenceLimit : null,
    end_date: confirmation.endMode === 'end_date' ? confirmation.endDate : null,
  }
  // LRP-5.1 §3/§16 — CORRIGE LRP-5 : plus AUCUN calcul/écriture de next_occurrence_date ici,
  // même pour un programme tout juste créé. linkOrderToOccurrenceForConfirmation
  // (recurringOccurrenceService.ts) gère désormais 100% des cas (échéance existante consommée
  // OU première échéance ancrée sur orderDate) via confirmOccurrence, seule source
  // d'avancement du calendrier — élimine tout risque de double calcul divergent.
  return patch
}
