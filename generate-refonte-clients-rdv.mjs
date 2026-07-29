import PDFDocument from 'pdfkit'
import { createWriteStream } from 'fs'

const OUTPUT = 'docs/Oryalis_Refonte_Clients_RDV.pdf'
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 54, bottom: 52, left: 50, right: 50 },
  bufferPages: true,
  info: {
    Title: 'Oryalis — Refonte Clients, Rendez-vous et Notes',
    Author: 'Oryalis',
    Subject: 'Cadrage fonctionnel et UX fondé sur l’existant de juillet 2026',
  },
})
doc.pipe(createWriteStream(OUTPUT))

const C = {
  ink: '#172033',
  navy: '#1A2742',
  violet: '#6D4AFF',
  violetDark: '#5232D6',
  lilac: '#EEE9FF',
  teal: '#168B87',
  tealPale: '#E4F5F3',
  blue: '#2978C8',
  bluePale: '#E7F1FB',
  green: '#21865A',
  greenPale: '#E5F4EB',
  amber: '#B66A12',
  amberPale: '#FFF2D8',
  red: '#BA3F4A',
  redPale: '#FCE8EA',
  text: '#27334A',
  muted: '#68748A',
  line: '#D8DDEA',
  surface: '#F6F7FB',
  white: '#FFFFFF',
}

const M = doc.page.margins
const W = doc.page.width - M.left - M.right
const pageBottom = () => doc.page.height - M.bottom
let sectionName = ''
const pageSections = ['']

function addPage() {
  doc.addPage()
  doc.y = M.top
  pageSections.push(sectionName)
}

function ensure(height = 60) {
  if (doc.y + height > pageBottom()) addPage()
}

function heading(text, kicker) {
  if (doc.y > M.top + 10) addPage()
  if (kicker) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.violet).text(kicker.toUpperCase(), { characterSpacing: 1.25 })
    doc.moveDown(0.55)
  }
  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.navy).text(text, { lineGap: 1 })
  doc.moveDown(0.3)
  doc.roundedRect(M.left, doc.y, 72, 4, 2).fill(C.violet)
  doc.y += 16
  sectionName = text
  pageSections[pageSections.length - 1] = text
}

function h2(text, color = C.navy) {
  ensure(40)
  doc.font('Helvetica-Bold').fontSize(14).fillColor(color).text(text)
  doc.moveDown(0.35)
}

function h3(text, color = C.ink) {
  ensure(30)
  doc.font('Helvetica-Bold').fontSize(10.7).fillColor(color).text(text)
  doc.moveDown(0.18)
}

function p(text, options = {}) {
  doc.font('Helvetica').fontSize(9.35).fillColor(C.text).text(text, {
    lineGap: 2.25,
    ...options,
  })
  doc.moveDown(0.55)
}

function small(text, options = {}) {
  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(text, { lineGap: 1.5, ...options })
  doc.moveDown(0.35)
}

function bullet(text, color = C.violet) {
  ensure(25)
  const y = doc.y + 3
  doc.circle(M.left + 4, y + 2, 2.1).fill(color)
  doc.font('Helvetica').fontSize(9.25).fillColor(C.text).text(text, M.left + 14, doc.y, {
    width: W - 14,
    lineGap: 2,
  })
  doc.moveDown(0.32)
}

function numbered(number, title, body) {
  const bodyH = doc.heightOfString(body, { width: W - 56, lineGap: 2 })
  const h = Math.max(52, bodyH + 29)
  ensure(h + 10)
  const y = doc.y
  doc.roundedRect(M.left, y, W, h, 9).fill(C.surface)
  doc.circle(M.left + 22, y + 22, 13).fill(C.violet)
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white).text(String(number), M.left + 16, y + 16, { width: 12, align: 'center' })
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.navy).text(title, M.left + 44, y + 10, { width: W - 56 })
  doc.font('Helvetica').fontSize(8.9).fillColor(C.text).text(body, M.left + 44, y + 27, { width: W - 58, lineGap: 2 })
  doc.y = y + h + 9
}

function callout(label, text, tone = 'violet') {
  const palette = {
    violet: [C.lilac, C.violet],
    teal: [C.tealPale, C.teal],
    amber: [C.amberPale, C.amber],
    red: [C.redPale, C.red],
    green: [C.greenPale, C.green],
    blue: [C.bluePale, C.blue],
  }[tone]
  const textH = doc.heightOfString(text, { width: W - 34, lineGap: 2 })
  const h = textH + 39
  ensure(h + 10)
  const y = doc.y
  doc.roundedRect(M.left, y, W, h, 9).fill(palette[0])
  doc.roundedRect(M.left, y, 5, h, 2).fill(palette[1])
  doc.font('Helvetica-Bold').fontSize(8).fillColor(palette[1]).text(label.toUpperCase(), M.left + 17, y + 10, { characterSpacing: 0.7 })
  doc.font('Helvetica').fontSize(9.3).fillColor(C.text).text(text, M.left + 17, y + 25, { width: W - 32, lineGap: 2 })
  doc.y = y + h + 11
}

function twoCards(left, right) {
  const gap = 12
  const colW = (W - gap) / 2
  const leftH = doc.heightOfString(left.body, { width: colW - 24, lineGap: 2 }) + 42
  const rightH = doc.heightOfString(right.body, { width: colW - 24, lineGap: 2 }) + 42
  const h = Math.max(leftH, rightH, 78)
  ensure(h + 12)
  const y = doc.y
  ;[left, right].forEach((item, i) => {
    const x = M.left + i * (colW + gap)
    doc.roundedRect(x, y, colW, h, 9).fill(item.bg ?? C.surface)
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(item.color ?? C.navy).text(item.title, x + 12, y + 12, { width: colW - 24 })
    doc.font('Helvetica').fontSize(8.8).fillColor(C.text).text(item.body, x + 12, y + 33, { width: colW - 24, lineGap: 2 })
  })
  doc.y = y + h + 12
}

function table(headers, rows, widths, options = {}) {
  const headerH = options.headerH ?? 26
  const fontSize = options.fontSize ?? 8
  const pad = 7
  const drawHeader = () => {
    ensure(headerH + 30)
    const y = doc.y
    let x = M.left
    headers.forEach((header, i) => {
      doc.rect(x, y, widths[i], headerH).fill(C.navy)
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.white).text(header, x + pad, y + 8, {
        width: widths[i] - pad * 2,
      })
      x += widths[i]
    })
    doc.y = y + headerH
  }
  drawHeader()
  rows.forEach((row, rowIndex) => {
    const heights = row.map((cell, i) => doc.heightOfString(String(cell), {
      width: widths[i] - pad * 2,
      lineGap: 1.5,
    }))
    const rowH = Math.max(options.minRowH ?? 27, ...heights) + pad * 1.4
    if (doc.y + rowH > pageBottom()) {
      addPage()
      drawHeader()
    }
    const y = doc.y
    let x = M.left
    row.forEach((cell, i) => {
      doc.rect(x, y, widths[i], rowH).fill(rowIndex % 2 === 0 ? C.white : C.surface)
      doc.rect(x, y, widths[i], rowH).lineWidth(0.35).stroke(C.line)
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(i === 0 ? C.ink : C.text).text(String(cell), x + pad, y + pad, {
        width: widths[i] - pad * 2,
        lineGap: 1.5,
      })
      x += widths[i]
    })
    doc.y = y + rowH
  })
  doc.y += 12
}

function flow(nodes) {
  const gap = 7
  const nodeW = (W - gap * (nodes.length - 1)) / nodes.length
  const h = 58
  ensure(h + 12)
  const y = doc.y
  nodes.forEach((node, i) => {
    const x = M.left + i * (nodeW + gap)
    doc.roundedRect(x, y, nodeW, h, 8).fill(i === nodes.length - 1 ? C.lilac : C.surface)
    doc.font('Helvetica-Bold').fontSize(8.3).fillColor(i === nodes.length - 1 ? C.violetDark : C.navy).text(node.title, x + 8, y + 9, { width: nodeW - 16, align: 'center' })
    doc.font('Helvetica').fontSize(7.3).fillColor(C.muted).text(node.sub, x + 7, y + 27, { width: nodeW - 14, align: 'center', lineGap: 1 })
    if (i < nodes.length - 1) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.violet).text('›', x + nodeW + 1, y + 20, { width: gap - 2, align: 'center' })
    }
  })
  doc.y = y + h + 13
}

function priority(label, title, text, tone) {
  const palette = tone === 'now'
    ? [C.redPale, C.red]
    : tone === 'next'
      ? [C.amberPale, C.amber]
      : [C.bluePale, C.blue]
  const textH = doc.heightOfString(text, { width: W - 118, lineGap: 2 })
  const h = Math.max(48, textH + 24)
  ensure(h + 8)
  const y = doc.y
  doc.roundedRect(M.left, y, W, h, 8).fill(palette[0])
  doc.font('Helvetica-Bold').fontSize(8).fillColor(palette[1]).text(label, M.left + 12, y + 12, { width: 78 })
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.navy).text(title, M.left + 92, y + 9, { width: W - 104 })
  doc.font('Helvetica').fontSize(8.7).fillColor(C.text).text(text, M.left + 92, y + 25, { width: W - 104, lineGap: 2 })
  doc.y = y + h + 8
}

// Couverture
doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.navy)
doc.circle(doc.page.width - 20, 78, 145).fill(C.violet)
doc.circle(doc.page.width - 48, 64, 72).fill('#8D73FF')
doc.circle(15, doc.page.height - 8, 130).fill(C.teal)
doc.font('Helvetica-Bold').fontSize(34).fillColor(C.white).text('ORYALIS', 56, 166)
doc.font('Helvetica-Bold').fontSize(24).fillColor(C.white).text('Refonte Clients,', 56, 232)
doc.text('Rendez-vous & Notes', 56, 264)
doc.font('Helvetica').fontSize(13.5).fillColor('#D9D2FF').text(
  'Cadrage fonctionnel et UX pour transformer un ensemble d’écrans riche mais dispersé en un parcours quotidien simple, cohérent et actionnable.',
  56, 320, { width: 430, lineGap: 5 },
)
doc.roundedRect(56, 430, 392, 78, 10).fill('#253451')
doc.font('Helvetica-Bold').fontSize(9).fillColor('#9FE0DA').text('OBJECTIF', 74, 447, { characterSpacing: 1 })
doc.font('Helvetica').fontSize(11).fillColor(C.white).text(
  'Retrouver le contexte d’une relation en moins de 10 secondes, préparer un RDV sans ressaisie et terminer chaque échange par une prochaine action claire.',
  74, 466, { width: 354, lineGap: 3 },
)
doc.font('Helvetica').fontSize(9).fillColor('#AEB9CD').text('Audit de l’existant — 26 juillet 2026', 56, 695)
doc.text('Document de réflexion produit — aucune modification de l’application', 56, 713)

addPage()
heading('Résumé décisionnel', '01 · Le cap')
callout(
  'Décision principale',
  'La refonte ne doit pas ajouter de nouvelles rubriques. Elle doit réduire les choix visibles, supprimer les doublons entre Notes, Interactions, Relances et RDV, puis organiser l’expérience autour d’une seule boucle : comprendre → contacter → noter le résultat → planifier la suite.',
  'violet',
)
h2('Les 7 décisions structurantes')
numbered(1, 'Renommer la liste en « Contacts »', 'Elle contient aujourd’hui des prospects, clients, distributeurs, leaders et membres d’équipe. « Clients » décrit mal le périmètre réel.')
numbered(2, 'Passer de 8–9 onglets à 4 espaces', 'Synthèse, Activité, Suivi et Profil. Commandes, recommandations et équipe deviennent des blocs contextuels ou des filtres de l’activité.')
numbered(3, 'Créer un contact en moins d’une minute', 'Nom, moyen de contact et rôle suffisent au départ. Le profil détaillé est complété ensuite, au moment où l’information devient utile.')
numbered(4, 'Faire du RDV un parcours en trois temps', 'Avant : objectif et préparation. Pendant : prise de notes. Après : compte rendu, résultat et prochaine action.')
numbered(5, 'Unifier les notes dans une chronologie', 'Une note libre, un compte rendu de RDV, un appel et un message restent des activités différentes, mais sont visibles dans un même fil.')
numbered(6, 'Distinguer les concepts commerciaux', 'Le rôle décrit qui est la personne ; le pipeline décrit où en est l’opportunité ; l’activité récente décrit si la relation est active. Ils ne doivent plus se contredire.')
numbered(7, 'Protéger les données sensibles', 'Les informations de santé ne doivent pas être demandées à la création. Elles nécessitent un accès explicite, une finalité claire et une visibilité restreinte.')

addPage()
heading('Diagnostic de l’existant', '02 · Ce qui crée le brouillon')
h2('Ce qui fonctionne déjà')
bullet('Liste avec recherche, filtres de statut, pipeline, dernier RDV, quota, archivage et restauration.')
bullet('Fiche relationnelle riche avec prochain suivi, actions rapides, chronologie et modules métier.')
bullet('Agenda mois / semaine / jour, prochain rendez-vous visible et synchronisation calendrier.')
bullet('Rendez-vous structuré avec statut, contexte commercial, notes, tâches et historique client.')
bullet('Débrief à chaud et automatisations après un RDV complété.')
bullet('Pipeline canonique déjà porté par le contact : c’est une bonne fondation à conserver.')
h2('Les principaux irritants')
table(
  ['Constat', 'Effet utilisateur', 'Décision de refonte'],
  [
    ['« Clients » contient plusieurs rôles', 'Le vocabulaire devient ambigu dès la première page.', 'Employer « Contacts » et segmenter par rôle.'],
    ['8 à 9 onglets sur la fiche', 'Navigation horizontale, faible découvrabilité, répétition des listes.', 'Ramener à 4 espaces stables.'],
    ['Statut + rôle + pipeline', 'Trois classifications se chevauchent et peuvent se contredire.', 'Donner une responsabilité unique à chaque notion.'],
    ['Formulaire client très long', 'Plus de vingt informations possibles avant la première valeur.', 'Création rapide puis enrichissement progressif.'],
    ['Notes libres + notes RDV + interactions', 'L’utilisateur hésite sur l’endroit où écrire.', 'Une activité unifiée, avec un type et une source.'],
    ['Relances + tâches + prochaine action', 'Plusieurs objets semblent répondre au même besoin.', 'Une prochaine action principale, des tâches secondaires.'],
    ['RDV créé avec notes déjà visibles', 'Préparation et compte rendu se mélangent.', 'Séparer avant / pendant / après.'],
    ['Actions rapides nombreuses', 'La priorité du moment n’est pas évidente.', 'Une action primaire, trois secondaires, le reste sous « Plus ».'],
  ],
  [135, 170, 190],
  { fontSize: 7.6, minRowH: 32 },
)
callout(
  'Point technique à traiter dans le cadrage',
  'Deux représentations de rendez-vous coexistent dans les types : un ancien format centré sur « numéro / thèmes / solutions » et le nouveau format Agenda centré sur « titre / type / horaires / statut ». La refonte doit consacrer le nouveau rendez-vous comme modèle unique et prévoir la reprise de l’historique.',
  'amber',
)

addPage()
heading('Architecture cible', '03 · Où vit chaque information')
h2('Navigation produit')
flow([
  { title: 'Contacts', sub: 'Relations, recherche, segments' },
  { title: 'Agenda', sub: 'RDV, disponibilités, calendrier' },
  { title: 'Actions', sub: 'À faire, relances, retards' },
  { title: 'Tableau de bord', sub: 'Priorités et résultats' },
])
p('Le contact reste le point d’entrée de la relation. L’agenda reste le point d’entrée temporel. Les deux mènent à la même fiche RDV et au même compte rendu.')
h2('Fiche contact : 4 espaces seulement')
table(
  ['Espace', 'Question à laquelle il répond', 'Contenu'],
  [
    ['Synthèse', 'Que dois-je savoir et faire maintenant ?', 'Identité, rôle, pipeline, prochain RDV, prochaine action, alertes, 3 dernières activités.'],
    ['Activité', 'Que s’est-il passé dans cette relation ?', 'Chronologie filtrable : RDV, appels, messages, notes, commandes, recommandations, changements.'],
    ['Suivi', 'Quelle est la suite ?', 'Prochaine action principale, tâches, opportunité, température, valeur, rappels.'],
    ['Profil', 'Quelles informations durables conserver ?', 'Coordonnées, préférences, source, tags, programme, réseau et données sensibles protégées.'],
  ],
  [76, 162, 257],
  { fontSize: 7.8, minRowH: 35 },
)
h2('Règle de propriété')
twoCards(
  {
    title: 'Donnée source',
    body: 'Elle n’est modifiable qu’à un endroit : pipeline sur le contact, horaires sur le RDV, compte rendu sur le RDV, échéance sur l’action.',
    bg: C.tealPale,
    color: C.teal,
  },
  {
    title: 'Vue miroir',
    body: 'La même donnée peut être affichée ailleurs pour donner du contexte, mais le bouton « Modifier » ramène toujours vers sa source.',
    bg: C.lilac,
    color: C.violetDark,
  },
)

addPage()
heading('Écran 1 — Liste des contacts', '04 · Spécification')
h2('Objectif')
p('Trouver une personne, comprendre sa situation en un coup d’œil et lancer l’action la plus utile sans ouvrir plusieurs écrans.')
h2('Structure recommandée')
numbered(1, 'En-tête', 'Titre « Contacts », nombre actif / quota discret, recherche persistante et bouton « Nouveau contact ». Les archivés passent dans le menu secondaire.')
numbered(2, 'Segments', 'Filtres utiles : Tous, À relancer, Prospects, Clients, Équipe, Inactifs. Le pipeline est un filtre avancé, pas une seconde rangée permanente.')
numbered(3, 'Carte ou ligne', 'Nom + rôle, étape pipeline si pertinente, prochaine action ou prochain RDV, dernier contact. Le score numérique brut disparaît au profit d’un signal explicable : « chaud », « en retard », « sans suivi ».')
numbered(4, 'Action directe', 'Le bouton principal dépend du contexte : « Relancer », « Voir le RDV », « Planifier ». Le menu secondaire porte Modifier, Archiver et Supprimer.')
h2('Ordre visuel d’une ligne')
flow([
  { title: 'Identité', sub: 'Nom · rôle · tag' },
  { title: 'Contexte', sub: 'Pipeline ou dernier échange' },
  { title: 'Suite', sub: 'Action et échéance' },
  { title: 'CTA', sub: 'Relancer / Planifier' },
])
h2('Comportements indispensables')
bullet('Recherche sur nom, téléphone, email et tags ; tolérance aux accents et espaces.')
bullet('Tri par prochaine action par défaut dans « À relancer », alphabétique dans « Tous ».')
bullet('Filtres conservés pendant la session et bouton clair « Réinitialiser ».')
bullet('Sélection multiple réservée aux actions sûres : taguer ou archiver ; jamais supprimer sans confirmation.')
bullet('État vide contextualisé : aucun contact, aucun résultat, aucun contact dans ce segment.')
callout('À conserver', 'Le quota, l’archive restaurable et l’accès rapide au RDV sont cohérents. Leur présentation doit seulement devenir plus discrète et plus lisible.', 'green')

addPage()
heading('Écran 2 — Créer un contact', '05 · Spécification')
h2('Principe : création progressive')
callout('Cible', 'Créer une fiche exploitable en 30 à 60 secondes. La complétude du profil n’est pas un prérequis à la création.', 'teal')
h2('Étape unique visible')
table(
  ['Champ', 'Règle', 'Comportement'],
  [
    ['Nom', 'Obligatoire', 'Un seul champ « Nom complet » ; proposer prénom / nom séparés après saisie si nécessaire.'],
    ['Téléphone ou email', 'Recommandé', 'Au moins un moyen de contact conseillé ; avertissement non bloquant si aucun.'],
    ['Rôle', 'Obligatoire, défaut Prospect', 'Prospect, client, distributeur, leader, membre d’équipe.'],
    ['Source', 'Optionnelle', 'Liste courte + « Autre » : recommandation, événement, réseaux sociaux, import…'],
    ['Première action', 'Optionnelle mais mise en avant', 'Appeler, écrire, planifier un RDV, avec date.'],
  ],
  [105, 125, 265],
  { fontSize: 8, minRowH: 34 },
)
h2('Après « Créer »')
flow([
  { title: 'Fiche créée', sub: 'Déduplication et quota vérifiés' },
  { title: 'Victoire immédiate', sub: 'Appeler, message ou RDV' },
  { title: 'Enrichir plus tard', sub: 'Profil, intérêts, adresse' },
])
h2('Champs à déplacer hors de la création')
bullet('Date de naissance, profession, enfants, pays, adresse, type de client et centres d’intérêt.')
bullet('Potentiel réseau, identifiant de marque et notes de programme.')
bullet('Particularités et toutes les données de santé.')
h2('Contrôles')
bullet('Détection de doublon sur téléphone normalisé et email avant validation ; proposer « ouvrir l’existant » ou « créer quand même ».')
bullet('Validation du format sans bloquer les numéros internationaux ; pays utilisé pour le préfixe suggéré.')
bullet('Si le quota est atteint : expliquer les choix « archiver » ou « passer au plan Conseiller » sans perdre la saisie.')
bullet('À l’enregistrement : retour vers la fiche créée, pas vers une liste où l’utilisateur doit la rechercher.')

addPage()
heading('Écran 3 — Fiche contact', '06 · Spécification')
h2('En-tête compact et actionnable')
table(
  ['Zone', 'Contenu', 'Règle'],
  [
    ['Identité', 'Nom, rôle, tags utiles', 'Le statut commercial n’occupe pas la même ligne que le rôle.'],
    ['Signal de suivi', 'En retard / aujourd’hui / planifié / aucun suivi', 'Toujours formulé en langage naturel, jamais seulement un score.'],
    ['Action primaire', 'La prochaine action', 'Bouton le plus visible ; « Terminer » et « Reporter » après ouverture.'],
    ['Actions secondaires', 'Contacter, RDV, Plus', 'Appel / WhatsApp / message regroupés sous « Contacter ».'],
  ],
  [92, 212, 191],
  { fontSize: 8, minRowH: 33 },
)
h2('Synthèse — contenu dans l’ordre')
numbered(1, 'Prochaine étape', 'Action, échéance, canal et raison. Si aucune action n’existe, afficher « Planifier une suite ».')
numbered(2, 'Prochain rendez-vous', 'Date, heure, type, lieu et accès direct à la fiche RDV.')
numbered(3, 'Contexte commercial', 'Rôle, pipeline, température, intention et valeur — uniquement lorsque ces notions sont pertinentes.')
numbered(4, 'Dernières activités', 'Trois événements avec « Voir toute l’activité ».')
numbered(5, 'Informations utiles', 'Coordonnées et éléments de profil les plus consultés ; le reste vit dans Profil.')
h2('Ce qui disparaît de la surface principale')
bullet('Le score numérique non expliqué.')
bullet('La rangée de nombreux boutons équivalents.')
bullet('Les sous-listes complètes répétées dans chaque onglet.')
bullet('Les champs vides : remplacer les cartes vides par une seule invitation « Compléter le profil ».')

addPage()
heading('Activité, notes et interactions', '07 · Un modèle lisible')
h2('Une chronologie, plusieurs types')
p('L’utilisateur voit un seul fil chronologique. Chaque événement conserve toutefois son type, sa source et ses droits propres.')
table(
  ['Type', 'Contenu principal', 'Création'],
  [
    ['Note libre', 'Observation datée, texte, auteur', 'Depuis le contact ou l’activité.'],
    ['Rendez-vous', 'Titre, statut, horaires, compte rendu', 'Depuis Agenda ou le contact.'],
    ['Appel / message', 'Canal, résultat, résumé', 'Depuis « Contacter » ou l’activité.'],
    ['Relance / action', 'Échéance, canal, état', 'Depuis le suivi ou à la fin d’une activité.'],
    ['Commande', 'Produits, montant, renouvellement', 'Depuis le module Commandes.'],
    ['Recommandation', 'Produit, objectif, état', 'Depuis le compte rendu ou le module Produits.'],
    ['Changement', 'Rôle, pipeline, archivage', 'Automatique et non modifiable.'],
  ],
  [105, 225, 165],
  { fontSize: 7.9, minRowH: 30 },
)
h2('Filtres de l’activité')
bullet('Tout · RDV · Contacts (appels/messages) · Notes · Ventes · Système.')
bullet('Recherche plein texte dans les titres et contenus autorisés.')
bullet('Les éléments à venir sont séparés de l’historique et vivent d’abord dans Suivi.')
h2('Décision sur les écrans actuels')
twoCards(
  {
    title: 'À fusionner',
    body: 'Notes et Interactions deviennent deux façons de créer une activité, visibles dans la même chronologie. Les écrans spécialisés ne restent utiles que comme formulaires.',
    bg: C.lilac,
    color: C.violetDark,
  },
  {
    title: 'À distinguer',
    body: 'Une relance n’est pas une note : c’est un engagement futur. Elle apparaît dans Suivi puis rejoint l’activité lorsqu’elle est terminée.',
    bg: C.tealPale,
    color: C.teal,
  },
)

addPage()
heading('Écran 4 — Agenda et liste RDV', '08 · Spécification')
h2('Objectif')
p('Voir la charge temporelle, accéder au prochain rendez-vous et créer un créneau avec le minimum de friction.')
h2('Affichage adaptatif')
table(
  ['Contexte', 'Vue par défaut', 'Raison'],
  [
    ['Mobile', 'Jour / agenda', 'La grille semaine est étroite ; la liste donne lieu, personne et action.'],
    ['Tablette', 'Semaine', 'Bon équilibre entre densité et lisibilité.'],
    ['Web', 'Semaine', 'Vue opérationnelle, avec mois et jour disponibles.'],
  ],
  [100, 120, 275],
  { fontSize: 8.2, minRowH: 34 },
)
h2('Éléments à afficher')
bullet('Prochain RDV : client, heure, type, lieu / visio, accès direct.')
bullet('Codes couleur limités au statut ou au type, mais pas aux deux simultanément.')
bullet('Événements externes clairement distingués des RDV Oryalis.')
bullet('Création par bouton fixe et par toucher / clic sur un créneau.')
bullet('Filtre « Mes RDV / calendrier externe » lorsque la synchronisation est active.')
h2('Actions depuis une carte')
bullet('Ouvrir la fiche RDV ; rejoindre la visio ou lancer l’itinéraire si imminent.')
bullet('Reporter ouvre le formulaire d’horaire et conserve un historique du report.')
bullet('Annuler demande un motif optionnel ; supprimer reste une action administrative secondaire.')
callout('À éviter', 'Ne pas transformer l’agenda en tableau commercial. Le pipeline et les notes détaillées appartiennent aux fiches ; l’agenda n’affiche que le contexte nécessaire au prochain geste.', 'amber')

addPage()
heading('Écran 5 — Créer ou modifier un RDV', '09 · Spécification')
h2('Parcours recommandé')
flow([
  { title: 'Avec qui ?', sub: 'Contact prérempli si contexte client' },
  { title: 'Pourquoi ?', sub: 'Type + objectif court' },
  { title: 'Quand ?', sub: 'Début + durée' },
  { title: 'Où ?', sub: 'Téléphone, visio ou adresse' },
  { title: 'Confirmer', sub: 'Résumé avant création' },
])
h2('Champs')
table(
  ['Champ', 'Règle cible', 'Amélioration par rapport à l’existant'],
  [
    ['Contact', 'Requis pour un RDV relationnel ; option « sans contact » explicite', 'Évite qu’un RDV commercial soit créé sans rattachement par inadvertance.'],
    ['Type', 'Requis', 'Les 11 types restent possibles, mais les 4 plus utilisés sont visibles ; le reste sous « Autres ».'],
    ['Titre', 'Auto-généré, modifiable', 'Ex. « Présentation produit · Marie Dupont » ; moins de saisie.'],
    ['Date et heure', 'Requises', 'Un seul point de départ.'],
    ['Durée', '30 / 45 / 60 / 90 min + personnalisée', 'Plus simple que deux couples date/heure dans la majorité des cas.'],
    ['Mode', 'Téléphone / visio / présentiel / autre', 'Le champ conditionnel devient évident : lien ou adresse.'],
    ['Objectif', 'Optionnel, une phrase', 'Remplace les deux zones de notes au moment de planifier.'],
    ['Rappel', 'Optionnel avec défaut utilisateur', 'Rend le comportement attendu visible.'],
  ],
  [83, 145, 267],
  { fontSize: 7.7, minRowH: 33 },
)
h2('Règles de modification')
bullet('Modifier un RDV ne doit jamais masquer les notes existantes ni rompre le lien client.')
bullet('Un changement d’horaire important propose d’envoyer / copier un message au participant.')
bullet('Le fuseau horaire est visible si différent du profil ; sinon il reste implicite.')
bullet('Conflit détecté : avertissement avec choix de continuer, non blocage silencieux.')

addPage()
heading('Écran 6 — Fiche RDV', '10 · Avant, pendant, après')
h2('Un écran dont la priorité change avec le statut')
table(
  ['Moment', 'Action primaire', 'Contenu prioritaire'],
  [
    ['Planifié', 'Démarrer / rejoindre', 'Qui, quand, où, objectif, préparation, historique récent.'],
    ['En cours', 'Prendre des notes', 'Besoins, objections, produits, décisions ; accès au profil sans quitter le brouillon.'],
    ['Terminé', 'Finaliser le compte rendu', 'Résultat, synthèse, prochaine action, tâches et message récapitulatif.'],
    ['Annulé / absent', 'Replanifier', 'Motif, historique et action de reprise.'],
  ],
  [95, 135, 265],
  { fontSize: 8, minRowH: 36 },
)
h2('En-tête')
bullet('Titre, client, date/heure, type, statut et accès lieu / visio.')
bullet('Une seule action primaire ; Modifier et Annuler dans le menu secondaire.')
h2('Corps')
bullet('Bloc « Préparation » avant le RDV : objectif, dernière activité, recommandations ouvertes, éléments à ne pas oublier.')
bullet('Bloc « Compte rendu » pendant et après : saisie structurée, sauvegarde continue et indicateur d’état.')
bullet('Bloc « Suite » : prochaine action, tâches secondaires et futur RDV.')
bullet('Sur web, la colonne latérale peut garder le résumé client et l’historique ; sur mobile, ces éléments sont repliables.')
callout('Simplification', 'Le contexte commercial ne doit pas être modifiable à deux endroits sur la même page. Il est proposé dans le débrief, puis affiché en lecture dans le résumé avec un lien « Modifier le résultat ».', 'blue')

addPage()
heading('Écran 7 — Note et débrief RDV', '11 · Le cœur de la refonte')
h2('Deux niveaux de saisie')
twoCards(
  {
    title: 'Pendant : notes rapides',
    body: 'Une grande zone de brouillon toujours disponible, autosauvegardée. Des raccourcis permettent de classer une phrase comme besoin, objection, produit ou décision.',
    bg: C.bluePale,
    color: C.blue,
  },
  {
    title: 'Après : débrief guidé',
    body: 'Un panneau court transforme le brouillon en résultat exploitable et oblige seulement à choisir une issue et une prochaine étape.',
    bg: C.tealPale,
    color: C.teal,
  },
)
h2('Structure du compte rendu')
table(
  ['Section', 'Contenu', 'Visibilité'],
  [
    ['Résumé', 'Ce qui a été discuté et décidé', 'Interne par défaut ; exportable en récap client.'],
    ['Besoins', 'Problèmes, attentes, motivations', 'Interne.'],
    ['Objections', 'Freins et réponses à préparer', 'Interne.'],
    ['Produits / solutions', 'Éléments présentés ou recommandés', 'Interne, relié au catalogue si actif.'],
    ['Résultat', 'Intérêt, intention, pipeline, valeur éventuelle', 'Interne et commercial.'],
    ['Prochaine étape', 'Action, date, canal, responsable', 'Requise pour clôturer ou choix explicite « aucune ».'],
    ['Récap client', 'Texte partageable sans notes privées', 'Visible uniquement avant envoi / copie.'],
  ],
  [100, 250, 145],
  { fontSize: 7.8, minRowH: 31 },
)
h2('Débrief de moins d’une minute')
flow([
  { title: 'Issue', sub: 'Avancé · à suivre · refus · absent' },
  { title: 'Pipeline', sub: 'Proposition adaptée au résultat' },
  { title: 'Suite', sub: 'Action + date ou aucune' },
  { title: 'Partager', sub: 'Copier / envoyer le récap' },
])
callout('Règle de confiance', 'Le récap destiné au client ne reprend jamais automatiquement les notes internes, les objections formulées par le conseiller ni les données sensibles.', 'red')

addPage()
heading('Modèle métier simplifié', '12 · Une notion, une responsabilité')
h2('Classification du contact')
table(
  ['Notion', 'Question', 'Valeurs / règle cible'],
  [
    ['Rôle relationnel', 'Qui est cette personne ?', 'Prospect, client, distributeur, leader, membre d’équipe. Une valeur principale.'],
    ['Pipeline', 'Où en est l’opportunité ?', 'Nouveau, contacté, présentation planifiée / faite, suivi, offre, gagné, perdu. Pertinent avant conversion.'],
    ['Santé de relation', 'Faut-il agir ?', 'À jour, à relancer, en retard, dormant. Calculé depuis la prochaine action et l’activité.'],
    ['Tags', 'Quelles particularités utiles ?', 'VIP, source, campagne, langue, centres d’intérêt ; plusieurs valeurs.'],
    ['Température', 'Quel niveau d’intérêt actuel ?', 'Froid, tiède, chaud, très chaud ; daté et réévaluable.'],
  ],
  [105, 142, 248],
  { fontSize: 7.9, minRowH: 35 },
)
h2('Conséquences')
bullet('Le statut actuel « prospect / nouveau client / actif / fidèle / inactif / VIP / conseillère » ne doit plus être une liste unique : il mélange rôle, ancienneté, engagement et priorité.')
bullet('« VIP » devient un tag ; « actif / inactif » devient un signal calculé ; « conseillère » devient un rôle distributeur ou leader.')
bullet('Le pipeline se met à jour depuis la fiche contact ou le débrief RDV, avec un historique de changement.')
bullet('Le score peut rester un mécanisme interne de tri, mais l’interface affiche ses raisons : « RDV récent », « intérêt chaud », « suivi en retard ».')
h2('Action principale et tâches')
twoCards(
  {
    title: 'Prochaine action',
    body: 'Une seule action relationnelle prioritaire par contact : appeler, WhatsApp, SMS, email ou RDV, avec date et origine.',
    bg: C.lilac,
    color: C.violetDark,
  },
  {
    title: 'Tâches secondaires',
    body: 'Plusieurs actions de préparation ou de service : envoyer catalogue, échantillon, lien de paiement, document ou invitation.',
    bg: C.surface,
    color: C.navy,
  },
)

addPage()
heading('Matrice des données contact', '13 · Champs et emplacements')
table(
  ['Donnée', 'Création', 'Profil', 'Synthèse / usage'],
  [
    ['Nom complet', 'Requis', 'Identité', 'Toujours visible'],
    ['Téléphone / email', 'Recommandé', 'Coordonnées', 'Actions Contacter'],
    ['Rôle', 'Requis', 'Relation', 'En-tête et segmentation'],
    ['Source', 'Optionnel', 'Acquisition', 'Rapports / tags'],
    ['Pipeline', 'Défaut dérivé du rôle', 'Suivi', 'Contexte commercial'],
    ['Prochaine action', 'Optionnelle', 'Suivi', 'Action primaire'],
    ['Adresse / pays / langue', 'Non', 'Coordonnées', 'RDV, messages'],
    ['Naissance / profession / famille', 'Non', 'Profil personnel', 'Seulement si renseigné'],
    ['Intérêts / particularités', 'Non', 'Préférences', 'Préparation relationnelle'],
    ['Potentiel réseau / sponsor', 'Non', 'Réseau', 'Si rôle équipe'],
    ['Identifiant / programme marque', 'Non', 'Module de marque', 'Si module actif'],
    ['Données de santé', 'Jamais', 'Zone sensible protégée', 'Jamais dans une liste ou un récap'],
  ],
  [145, 95, 125, 130],
  { fontSize: 7.65, minRowH: 29 },
)
callout(
  'Minimisation',
  'Un champ visible doit servir une action réelle. Les champs rarement utilisés restent accessibles dans Profil, mais ne doivent pas allonger la création ni encombrer la synthèse.',
  'green',
)

addPage()
heading('États, erreurs et confiance', '14 · Exigences transverses')
h2('États à concevoir pour chaque écran')
table(
  ['État', 'Attendu'],
  [
    ['Chargement', 'Squelette stable ; ne pas remplacer toute la page par un indicateur isolé.'],
    ['Vide initial', 'Expliquer la valeur et proposer une seule action adaptée.'],
    ['Aucun résultat', 'Conserver la recherche, montrer les filtres actifs et proposer de les effacer.'],
    ['Erreur', 'Message humain, donnée non perdue, action Réessayer.'],
    ['Hors ligne', 'Brouillons locaux et signal clair de synchronisation en attente.'],
    ['Sauvegardé', 'Retour discret avec heure ; éviter les boutons restant dans un état ambigu.'],
    ['Conflit', 'Expliquer la donnée modifiée ailleurs et permettre de comparer avant d’écraser.'],
    ['Suppression', 'Confirmer l’objet exact et l’impact ; favoriser l’archive pour un contact.'],
  ],
  [115, 380],
  { fontSize: 8.2, minRowH: 31 },
)
h2('Données sensibles et confidentialité')
bullet('Séparer visuellement notes internes et contenu partageable.')
bullet('Ne jamais inclure les données de santé, précautions ou particularités sensibles dans les notifications, exports rapides ou aperçus de liste.')
bullet('Afficher l’auteur et la date de modification des notes importantes.')
bullet('Tracer les changements de pipeline, rôle, annulation et suppression.')
bullet('Prévoir une politique de conservation et un export compréhensible par contact.')
h2('Accessibilité')
bullet('Cibles tactiles d’au moins 44 px, contrastes suffisants et statut jamais exprimé par la couleur seule.')
bullet('Libellés explicites pour les icônes ; ordre de lecture cohérent au lecteur d’écran.')
bullet('Clavier et focus complets sur web ; messages d’erreur associés au champ concerné.')

addPage()
heading('Parcours de référence', '15 · De la création au suivi')
h2('Parcours A — nouveau prospect')
flow([
  { title: 'Créer', sub: 'Nom · téléphone · rôle' },
  { title: 'Agir', sub: 'Appel ou message immédiat' },
  { title: 'Qualifier', sub: 'Résultat + pipeline' },
  { title: 'Planifier', sub: 'RDV ou prochaine action' },
])
h2('Parcours B — rendez-vous commercial')
flow([
  { title: 'Planifier', sub: 'Client · type · durée · mode' },
  { title: 'Préparer', sub: 'Objectif · contexte récent' },
  { title: 'Conduire', sub: 'Notes rapides autosauvegardées' },
  { title: 'Débriefer', sub: 'Résultat · pipeline · suite' },
  { title: 'Suivre', sub: 'Action due dans Actions' },
])
h2('Parcours C — consultation avant relance')
flow([
  { title: 'Ouvrir', sub: 'Depuis Actions ou Contacts' },
  { title: 'Comprendre', sub: 'Synthèse + dernières activités' },
  { title: 'Contacter', sub: 'Canal recommandé ou choisi' },
  { title: 'Conclure', sub: 'Résultat + nouvelle suite' },
])
h2('Principes de navigation')
bullet('Après une action, revenir au contexte qui l’a déclenchée et confirmer le résultat.')
bullet('Depuis une fiche RDV, l’accès au contact ne doit pas perdre un brouillon en cours.')
bullet('Le bouton retour respecte le parcours : Agenda si ouvert depuis Agenda, contact si ouvert depuis le contact.')
bullet('Chaque création propose l’étape logique suivante au lieu d’un simple retour passif.')

addPage()
heading('Priorités de réalisation', '16 · Ordre recommandé')
priority('P0 · Décider', 'Vocabulaire et modèle métier', 'Valider Contacts, rôle, pipeline, santé de relation, tags, activité, prochaine action et tâches. Sans cette décision, la refonte visuelle recréera les mêmes ambiguïtés.', 'now')
priority('P0 · Décider', 'Source unique des rendez-vous', 'Adopter le modèle Agenda moderne et définir la reprise de l’ancien historique de rendez-vous.', 'now')
priority('P1 · Refaire', 'Création rapide et liste Contacts', 'Réduire le formulaire initial, ajouter déduplication, puis réorganiser recherche, segments et action contextuelle.', 'now')
priority('P1 · Refaire', 'Fiche contact à 4 espaces', 'Construire Synthèse, Activité, Suivi et Profil avant de déplacer les modules secondaires.', 'now')
priority('P1 · Refaire', 'RDV en trois temps', 'Simplifier la création, adapter la fiche au statut et faire du débrief le passage naturel vers la prochaine action.', 'now')
priority('P2 · Consolider', 'Notes, interactions et relances', 'Unifier l’affichage dans Activité et Suivi, puis retirer progressivement les navigations redondantes.', 'next')
priority('P2 · Sécuriser', 'Données sensibles et partage', 'Isoler les notes internes, encadrer les données de santé et fiabiliser les exports / notifications.', 'next')
priority('P3 · Optimiser', 'Personnalisation et modules', 'Réintroduire commandes, recommandations, marque et équipe sous forme de blocs contextuels mesurés par l’usage.', 'later')
h2('Ce qu’il ne faut pas faire en premier')
bullet('Redessiner les couleurs et cartes sans réduire l’architecture.')
bullet('Ajouter un nouvel onglet « Compte rendu » à côté des onglets actuels.')
bullet('Automatiser davantage les relances avant d’avoir une prochaine action unique et compréhensible.')

addPage()
heading('Critères de réussite', '17 · Validation de la refonte')
h2('Tests utilisateurs')
table(
  ['Tâche', 'Cible'],
  [
    ['Créer un contact puis planifier une première action', 'Moins de 60 secondes, sans aide.'],
    ['Retrouver le dernier échange et la prochaine étape', 'Moins de 10 secondes depuis la liste.'],
    ['Créer un RDV depuis un contact', 'Contact prérempli, moins de 45 secondes.'],
    ['Prendre une note pendant un RDV', 'Aucun doute sur l’endroit où écrire ; aucun texte perdu.'],
    ['Clôturer un RDV', 'Résultat et prochaine action enregistrés en moins d’une minute.'],
    ['Distinguer note interne et récap client', '100 % des testeurs comprennent ce qui peut être partagé.'],
    ['Retrouver une commande ou recommandation ancienne', 'Via Activité et son filtre, sans chercher un onglet.'],
  ],
  [290, 205],
  { fontSize: 8.1, minRowH: 32 },
)
h2('Indicateurs produit')
bullet('Taux de contacts créés avec une prochaine action.')
bullet('Part des RDV terminés avec débrief et suite explicite.')
bullet('Délai médian entre création du contact et première action.')
bullet('Nombre de contacts sans activité ni suivi depuis 30 jours.')
bullet('Temps médian de création d’un contact et d’un RDV.')
bullet('Taux d’abandon de chaque formulaire et fréquence des erreurs.')
bullet('Usage réel des 4 espaces de la fiche et des filtres d’activité.')
h2('Définition de terminé')
callout(
  'La refonte est réussie si…',
  'un conseiller n’a plus besoin de se demander « dans quel onglet dois-je aller ? ». Depuis la liste, il comprend la priorité ; depuis la fiche, il retrouve le contexte ; après chaque interaction, Oryalis lui demande simplement ce qui s’est passé et quelle est la suite.',
  'violet',
)

addPage()
heading('Périmètre proposé', '18 · Conserver, fusionner, différer')
table(
  ['Conserver', 'Fusionner / simplifier', 'Différer'],
  [
    ['Recherche et archive', 'Statut, rôle et pipeline', 'Personnalisation avancée des vues'],
    ['Quota non destructif', 'Notes et interactions dans Activité', 'Actions de masse complexes'],
    ['Agenda mois/semaine/jour', 'Relances et prochaine action', 'Scoring visible et réglable'],
    ['Synchronisation calendrier', 'Création / modification RDV', 'Automatisation multi-étapes'],
    ['Contexte client sur le RDV', 'Débrief et contexte commercial', 'Nouveaux modules de marque'],
    ['Chronologie existante', 'Onglets en 4 espaces', 'Rapports avancés'],
    ['Commandes et recommandations', 'Actions rapides regroupées', 'Partage d’équipe détaillé'],
  ],
  [165, 165, 165],
  { fontSize: 8, minRowH: 32 },
)
h2('Livrables de conception à produire ensuite')
bullet('Arborescence finale et nomenclature validées.')
bullet('Wireframes mobile des 7 écrans décrits dans ce document.')
bullet('Version web de la liste Contacts, de la fiche contact et de la fiche RDV.')
bullet('Prototype cliquable des trois parcours de référence.')
bullet('Inventaire de migration des données et règles de compatibilité avec l’historique.')
bullet('Plan de tests utilisateurs avec 5 à 8 conseillers aux niveaux d’expérience variés.')
callout(
  'Périmètre du présent document',
  'Ce document décrit la cible fonctionnelle et l’ordre des décisions. Il ne contient aucune implémentation technique et ne modifie pas l’application.',
  'blue',
)

// En-têtes et pieds de page
const range = doc.bufferedPageRange()
console.log(`Pages de contenu : ${range.count}`)
for (let i = 0; i < range.count; i += 1) {
  doc.switchToPage(i)
  if (i === 0) continue
  const savedBottomMargin = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  const topY = 24
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.violet).text('ORYALIS · REFONTE CLIENTS & RDV', M.left, topY, { width: W / 2, lineBreak: false })
  doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(pageSections[i] ?? '', M.left + W / 2, topY, { width: W / 2, align: 'right', lineBreak: false })
  doc.moveTo(M.left, 39).lineTo(M.left + W, 39).lineWidth(0.4).stroke(C.line)
  doc.moveTo(M.left, doc.page.height - 36).lineTo(M.left + W, doc.page.height - 36).lineWidth(0.4).stroke(C.line)
  doc.font('Helvetica').fontSize(7).fillColor(C.muted).text('Cadrage fonctionnel · 26 juillet 2026', M.left, doc.page.height - 27, { width: W / 2, lineBreak: false })
  doc.text(`${i} / ${range.count - 1}`, M.left + W / 2, doc.page.height - 27, { width: W / 2, align: 'right', lineBreak: false })
  doc.page.margins.bottom = savedBottomMargin
}

doc.end()
console.log(`PDF généré : ${OUTPUT}`)
