import type { InteractionType, InteractionOutcomeCode, NextActionType } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'

// ACTION-OUTCOME-1 / P0 — audit dédié : deux familles minimales suffisent, factorisées par
// nature du canal plutôt qu'un résultat par interaction_type (§5 du brief). Synchrone (on sait
// tout de suite si le contact a été joint) vs asynchrone (on attend une réponse). 'rdv',
// 'workshop' et 'group_meeting' rejoignent la famille synchrone (un échange direct a eu lieu
// ou non) ; 'product_followup' rejoint la famille asynchrone (un message de suivi produit).
// Extrait de clients/[id]/interactions.tsx en P1 (§8) : la clôture de relance a besoin des
// mêmes options, jamais une seconde taxonomie parallèle.
const CALL_LIKE_OUTCOMES: InteractionOutcomeCode[] = ['answered', 'no_answer', 'voicemail', 'callback_requested']
const MESSAGE_LIKE_OUTCOMES: InteractionOutcomeCode[] = ['sent', 'replied', 'no_response', 'follow_up_needed']

const INTERACTION_OUTCOME_OPTIONS: Record<InteractionType, InteractionOutcomeCode[]> = {
  call: CALL_LIKE_OUTCOMES, visio: CALL_LIKE_OUTCOMES, rdv: CALL_LIKE_OUTCOMES,
  workshop: CALL_LIKE_OUTCOMES, group_meeting: CALL_LIKE_OUTCOMES,
  whatsapp: MESSAGE_LIKE_OUTCOMES, sms: MESSAGE_LIKE_OUTCOMES, email: MESSAGE_LIKE_OUTCOMES,
  product_followup: MESSAGE_LIKE_OUTCOMES,
}

export function getInteractionOutcomeOptions(type: InteractionType): InteractionOutcomeCode[] {
  return INTERACTION_OUTCOME_OPTIONS[type]
}

// ACTION-OUTCOME-1 / P1.2 §15 — suggestion, jamais une règle automatique imposée : ces deux
// résultats appellent naturellement un rappel ("à rappeler"/"à relancer"), les autres
// (answered/replied/sent/no_answer/voicemail/no_response) laissent "Aucune suite" par défaut.
const OUTCOMES_SUGGESTING_FOLLOWUP: InteractionOutcomeCode[] = ['callback_requested', 'follow_up_needed']

export function outcomeSuggestsFollowup(code: InteractionOutcomeCode | null): boolean {
  return !!code && OUTCOMES_SUGGESTING_FOLLOWUP.includes(code)
}

// ACTION-OUTCOME-1 / P1.2 §7/§9 — correspondance fiable uniquement pour les 5 valeurs communes
// aux deux domaines (mêmes littéraux que FollowupCompletionModal, sens inverse) ; toute autre
// InteractionType (visio/workshop/group_meeting/product_followup) n'a pas d'équivalent
// NextActionType et retourne null (jamais un choix arbitraire).
export function mapInteractionTypeToActionType(type: InteractionType): NextActionType | null {
  switch (type) {
    case 'call': return 'call'
    case 'whatsapp': return 'whatsapp'
    case 'sms': return 'sms'
    case 'email': return 'email'
    case 'rdv': return 'rdv'
    default: return null
  }
}

// ACTION-FLOW-2 / P0 — préfixes EXACTS générés par Oryalis (FR + EN uniquement, §16 du brief :
// pas de liste extensible pour des langues futures). Sert à la détection anti-cascade : quand
// une Suite déjà titrée par Oryalis devient à son tour la source d'une nouvelle Suite, on ne
// doit jamais empiler un second préfixe ("Suivi · Suivi · ..."). La comparaison est faite sur
// les deux langues à la fois, indépendamment de la langue active, pour couvrir le cas d'un
// changement de langue en cours d'usage (§16).
const FOLLOWUP_TITLE_PREFIXES = ['Suivi · ', 'Follow-up · ']

// Retire le préfixe Oryalis s'il est déjà présent — jamais un nettoyage plus large (§7 : ne
// tente jamais de "deviner" qu'un mot comme "Appel"/"WhatsApp" est un canal à retirer d'un titre
// par ailleurs légitime, qu'il ait été saisi par l'utilisateur ou qu'il provienne de
// interaction.subject).
function normalizeSourceTitle(subject: string): string {
  const trimmed = subject.trim()
  for (const prefix of FOLLOWUP_TITLE_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
  }
  return trimmed
}

// ACTION-FLOW-2 / P0 — remplace l'ancienne formule "Recontacter après {{subject}}" (incorrecte
// grammaticalement dès que le sujet est déjà une phrase orientée action, cf. audit ACTION-
// FLOW-2) par un format neutre "Suivi · {{subject}}", robuste quel que soit le sujet, sans
// analyse grammaticale. §21 : fallback court si aucun sujet exploitable.
export function buildFollowupPrefillTitle(
  t: (key: string, options?: Record<string, unknown>) => string,
  subject: string
): string {
  const bare = normalizeSourceTitle(subject)
  if (!bare) return t('followups.next_step_default_fallback')
  return t('followups.next_step_default_title', { subject: bare })
}

// ACTION-FLOW-2 / P0 §12/§13 — un vrai RDV n'a pas besoin d'une phrase construite autour du
// sujet ("Recontacter après ..." était le problème initial) : le sujet source lui-même est déjà
// un titre de RDV plus naturel, une fois débarrassé d'un éventuel préfixe "Suivi ·"/"Follow-up ·"
// déjà présent (cas où la Suite provient d'une relance elle-même déjà titrée par Oryalis).
export function buildAppointmentPrefillTitle(subject: string): string {
  const bare = normalizeSourceTitle(subject)
  return bare || subject.trim()
}

// ACTION-FLOW-1 / P1 — texte déterministe (jamais d'IA, jamais notes_brutes recopié) pour
// préremplir la prochaine action décidée depuis un échange : le titre dit POURQUOI (repris du
// sujet source, jamais mélangé avec le résultat/compte-rendu, §9/§25 du brief), la description
// dit QUAND a eu lieu l'échange source.
export function buildFollowupSuggestionTexts(
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
  subject: string
): { title: string; content: string } {
  return {
    title: buildFollowupPrefillTitle(t, subject),
    content: t('followups.next_step_default_content', { date: formatDate(new Date(), locale) }),
  }
}
