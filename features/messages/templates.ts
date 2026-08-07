export type TemplateCategory = 'prospection' | 'lrp' | 'recrutement' | 'suivi'
export type TemplateChannel  = 'whatsapp' | 'sms' | 'all'

export interface MessageTemplate {
  id:       string
  category: TemplateCategory
  name:     string
  body:     string
  channel:  TemplateChannel
}

// Variables disponibles : {prénom} {nom_complet} {date_lrp} {produit} {mon_prénom}
export const BUILT_IN_TEMPLATES: MessageTemplate[] = [
  // ── Prospection ────────────────────────────────────────────────────────────
  {
    id: 'p1', category: 'prospection', channel: 'whatsapp',
    name: 'Premier contact doux',
    body: 'Bonjour {prénom} 👋 Je suis {mon_prénom}, conseillère bien-être. J\'aimerais te partager quelque chose qui a changé ma vie 🌿 Tu aurais 5 min pour qu\'on en parle ?',
  },
  {
    id: 'p2', category: 'prospection', channel: 'whatsapp',
    name: 'Invitation atelier',
    body: 'Coucou {prénom} ! J\'organise un atelier découverte des huiles essentielles cette semaine. C\'est gratuit, convivial et très instructif 😊 Ça te dirait d\'y participer ?',
  },
  {
    id: 'p3', category: 'prospection', channel: 'sms',
    name: 'SMS court prospection',
    body: 'Bonjour {prénom}, c\'est {mon_prénom}. Je t\'envoie une invitation pour découvrir nos produits bien-être. Peux-tu me rappeler ? 🌿',
  },
  {
    id: 'p4', category: 'prospection', channel: 'all',
    name: 'Suivi après rencontre',
    body: 'Bonjour {prénom}, ravie d\'avoir discuté avec toi ! Comme promis, je t\'envoie les infos sur nos produits. N\'hésite pas si tu as des questions 😊\n{mon_prénom}',
  },

  // ── LRP / Fidélité ─────────────────────────────────────────────────────────
  {
    id: 'l1', category: 'lrp', channel: 'whatsapp',
    name: 'Rappel LRP doux',
    body: 'Bonjour {prénom} 🌿 Je voulais te rappeler que ton programme fidélité arrive le {date_lrp}. Tu veux qu\'on regarde ensemble quoi commander ce mois-ci ?',
  },
  {
    id: 'l2', category: 'lrp', channel: 'whatsapp',
    name: 'Urgence LRP',
    body: '⚠️ {prénom} ! Pense à valider ton LRP avant le {date_lrp} pour conserver tes points fidélité. Je suis là si tu as besoin 😊',
  },
  {
    id: 'l3', category: 'lrp', channel: 'sms',
    name: 'SMS rappel LRP',
    body: 'Bonjour {prénom}, rappel : ton LRP expire le {date_lrp}. Pense à le valider ! Bonne journée, {mon_prénom}',
  },
  {
    id: 'l4', category: 'lrp', channel: 'whatsapp',
    name: 'Suggestion produit LRP',
    body: 'Coucou {prénom} ! Ton LRP arrive le {date_lrp} 🗓 Je pensais à toi pour {produit} ce mois-ci — tu adorais ça ! Tu veux que je t\'aide à préparer ta commande ?',
  },

  // ── Recrutement ────────────────────────────────────────────────────────────
  {
    id: 'r1', category: 'recrutement', channel: 'whatsapp',
    name: 'Invitation opportunité',
    body: 'Bonjour {prénom} ! Tu m\'as dit être intéressé(e) par l\'opportunité business. Est-ce qu\'on pourrait planifier un appel de 20 min cette semaine ? Je t\'expliquerai comment ça marche concrètement 🚀',
  },
  {
    id: 'r2', category: 'recrutement', channel: 'whatsapp',
    name: 'Partage résultats',
    body: 'Coucou {prénom} ! Je voulais te partager que ce mois-ci j\'ai [MON RÉSULTAT]. Si ça t\'intéresse de faire pareil, je serais ravie de t\'accompagner. On en parle ?',
  },
  {
    id: 'r3', category: 'recrutement', channel: 'all',
    name: 'Suivi après présentation',
    body: 'Bonjour {prénom}, suite à notre échange de la semaine dernière sur l\'opportunité business, est-ce que tu as eu le temps d\'y réfléchir ? Des questions ? Je suis là 😊\n{mon_prénom}',
  },

  // ── Suivi client ───────────────────────────────────────────────────────────
  {
    id: 's1', category: 'suivi', channel: 'whatsapp',
    name: 'Suivi après commande',
    body: 'Bonjour {prénom} ! Comment tu vas ? Tu avais commandé {produit} il y a quelques semaines 🌿 Comment ça se passe pour toi ? Des questions ?',
  },
  {
    id: 's2', category: 'suivi', channel: 'whatsapp',
    name: 'Prise de nouvelles',
    body: 'Coucou {prénom} ! Juste un petit message pour prendre de tes nouvelles 😊 Tu avances bien avec tes produits ? N\'hésite pas à me solliciter !',
  },
  {
    id: 's3', category: 'suivi', channel: 'whatsapp',
    name: 'Anniversaire client',
    body: 'Bonjour {prénom} ! Un petit message pour te souhaiter une très belle journée 🎉 C\'est un plaisir de t\'accompagner. {mon_prénom}',
  },
  {
    id: 's4', category: 'suivi', channel: 'all',
    name: 'Retour après pause',
    body: 'Bonjour {prénom}, ça fait un moment qu\'on ne s\'est pas parlé ! Comment tu vas ? Tu as des besoins en ce moment ? Je suis là pour toi 🌿\n{mon_prénom}',
  },
]

export function renderTemplate(
  body: string,
  vars: {
    prénom?: string
    nom_complet?: string
    date_lrp?: string
    produit?: string
    mon_prénom?: string
  }
): string {
  return body
    .replace(/\{prénom\}/g,     vars.prénom     ?? '[prénom]')
    .replace(/\{nom_complet\}/g, vars.nom_complet ?? '[nom complet]')
    .replace(/\{date_lrp\}/g,   vars.date_lrp   ?? '[date LRP]')
    .replace(/\{produit\}/g,    vars.produit    ?? '[produit]')
    .replace(/\{mon_prénom\}/g, vars.mon_prénom ?? '[votre prénom]')
}

// Décision #7 de la refonte : le récap partagé au client ne reprend jamais les
// notes internes ni les objections — uniquement date/type du RDV, besoins
// identifiés et produits discutés.
export function buildAppointmentRecapTemplate(params: {
  dateLabel: string
  typeLabel: string
  needsIdentified?: string | null
  productsDiscussed?: string | null
  // Prochain RDV proposé en fin de débrief — repris dans le récap quand renseigné, comme
  // dans le workflow réel observé chez les praticiennes ("récap + date du futur RDV,
  // envoyés ensemble, immédiatement").
  nextAppointment?: { dateLabel: string; purpose: string } | null
}): MessageTemplate {
  const { dateLabel, typeLabel, needsIdentified, productsDiscussed, nextAppointment } = params
  const parts = [`Bonjour {prénom}, merci pour notre échange du ${dateLabel} (${typeLabel}).`]
  if (needsIdentified?.trim())   parts.push(`Ce qu'on a retenu :\n${needsIdentified.trim()}`)
  if (productsDiscussed?.trim()) parts.push(`Produits évoqués :\n${productsDiscussed.trim()}`)
  if (nextAppointment)           parts.push(`Je te propose qu'on se retrouve le ${nextAppointment.dateLabel} pour ${nextAppointment.purpose}.`)
  parts.push(`À bientôt !\n{mon_prénom}`)
  return {
    id: 'appointment-recap',
    category: 'suivi',
    channel: 'all',
    name: 'Récap du rendez-vous',
    body: parts.join('\n\n'),
  }
}

// Résumé "copie de vos données" que le client peut demander à tout moment (RGPD) — ne
// reprend que ce qui est client-facing par nature : intérêts, historique des dates/types
// de RDV, produits recommandés. Jamais les notes internes, objections, données de santé,
// pipeline ou température (Décision #7).
export function buildClientSummaryTemplate(params: {
  interests?: string[]
  appointments: { dateLabel: string; typeLabel: string }[]
  recommendations: { productName: string }[]
}): MessageTemplate {
  const { interests, appointments, recommendations } = params
  const parts = [`Bonjour {prénom}, comme tu me l'as demandé, voici un résumé de ce qui est noté dans ton suivi chez {mon_prénom}.`]
  if (interests?.length) parts.push(`Centres d'intérêt : ${interests.join(', ')}`)
  if (appointments.length) parts.push(`Rendez-vous :\n${appointments.map(a => `- ${a.dateLabel} — ${a.typeLabel}`).join('\n')}`)
  if (recommendations.length) parts.push(`Produits recommandés :\n${recommendations.map(r => `- ${r.productName}`).join('\n')}`)
  parts.push(`Si tu remarques une erreur ou que tu veux que je supprime une information, dis-le-moi.\n{mon_prénom}`)
  return {
    id: 'client-summary',
    category: 'suivi',
    channel: 'all',
    name: 'Résumé de suivi',
    body: parts.join('\n\n'),
  }
}

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  prospection: 'Prospection',
  lrp:         'LRP / Fidélité',
  recrutement: 'Recrutement',
  suivi:       'Suivi client',
}

export const CATEGORY_ICONS: Record<TemplateCategory, string> = {
  prospection: '🔍',
  lrp:         '🌿',
  recrutement: '🚀',
  suivi:       '💛',
}
