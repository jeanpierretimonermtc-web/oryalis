import PDFDocument from 'pdfkit'
import { createWriteStream } from 'fs'

const OUTPUT = 'docs/Oryalis_Tables_Supabase_Clients_RDV_Notes_Relances.pdf'
const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 54, bottom: 52, left: 44, right: 44 },
  bufferPages: true,
  info: {
    Title: 'Oryalis — Tables Supabase : clients, appointments, notes, followups',
    Author: 'Oryalis',
    Subject: 'Dictionnaire de données et audit du schéma Supabase réel',
  },
})
doc.pipe(createWriteStream(OUTPUT))

const C = {
  navy: '#17243E',
  purple: '#6D4AFF',
  purplePale: '#EEE9FF',
  teal: '#168B87',
  tealPale: '#E4F5F3',
  blue: '#2B73B7',
  bluePale: '#E8F1FA',
  green: '#287D54',
  greenPale: '#E6F3EB',
  amber: '#A96514',
  amberPale: '#FFF2D9',
  red: '#B33B48',
  redPale: '#FBE8EA',
  text: '#27334A',
  muted: '#69758A',
  line: '#D8DDEA',
  surface: '#F6F7FA',
  white: '#FFFFFF',
}

const M = doc.page.margins
const W = doc.page.width - M.left - M.right
const bottom = () => doc.page.height - M.bottom
let currentSection = ''
const pageSections = ['']

function addPage() {
  doc.addPage()
  doc.y = M.top
  pageSections.push(currentSection)
}

function ensure(h = 50) {
  if (doc.y + h > bottom()) addPage()
}

function title(text, kicker) {
  if (doc.y > M.top + 10) addPage()
  currentSection = text
  pageSections[pageSections.length - 1] = text
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.purple).text(kicker.toUpperCase(), { characterSpacing: 1.2 })
  doc.moveDown(0.5)
  doc.font('Helvetica-Bold').fontSize(21).fillColor(C.navy).text(text)
  doc.moveDown(0.3)
  doc.roundedRect(M.left, doc.y, 70, 4, 2).fill(C.purple)
  doc.y += 15
}

function h2(text, color = C.navy) {
  ensure(38)
  doc.font('Helvetica-Bold').fontSize(13.5).fillColor(color).text(text)
  doc.moveDown(0.32)
}

function p(text, options = {}) {
  doc.font('Helvetica').fontSize(9.15).fillColor(C.text).text(text, { lineGap: 2.1, ...options })
  doc.moveDown(0.5)
}

function bullet(text, color = C.purple) {
  ensure(24)
  const y = doc.y
  doc.circle(M.left + 4, y + 6, 2).fill(color)
  doc.font('Helvetica').fontSize(9).fillColor(C.text).text(text, M.left + 14, y, { width: W - 14, lineGap: 2 })
  doc.moveDown(0.3)
}

function callout(label, text, tone = 'blue') {
  const palette = {
    blue: [C.bluePale, C.blue],
    purple: [C.purplePale, C.purple],
    teal: [C.tealPale, C.teal],
    amber: [C.amberPale, C.amber],
    red: [C.redPale, C.red],
    green: [C.greenPale, C.green],
  }[tone]
  const h = doc.heightOfString(text, { width: W - 34, lineGap: 2 }) + 39
  ensure(h + 10)
  const y = doc.y
  doc.roundedRect(M.left, y, W, h, 8).fill(palette[0])
  doc.rect(M.left, y, 5, h).fill(palette[1])
  doc.font('Helvetica-Bold').fontSize(8).fillColor(palette[1]).text(label.toUpperCase(), M.left + 16, y + 10, { characterSpacing: 0.7 })
  doc.font('Helvetica').fontSize(9).fillColor(C.text).text(text, M.left + 16, y + 25, { width: W - 30, lineGap: 2 })
  doc.y = y + h + 10
}

function table(headers, rows, widths, options = {}) {
  const pad = options.pad ?? 5
  const headerH = options.headerH ?? 25
  const fontSize = options.fontSize ?? 7.25
  const drawHeader = () => {
    ensure(headerH + 28)
    const y = doc.y
    let x = M.left
    headers.forEach((header, i) => {
      doc.rect(x, y, widths[i], headerH).fill(C.navy)
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white).text(header, x + pad, y + 8, {
        width: widths[i] - pad * 2,
      })
      x += widths[i]
    })
    doc.y = y + headerH
  }
  drawHeader()
  rows.forEach((row, ri) => {
    const heights = row.map((cell, i) => {
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize)
      return doc.heightOfString(String(cell), { width: widths[i] - pad * 2, lineGap: 1.35 })
    })
    const rowH = Math.max(options.minRowH ?? 24, ...heights) + pad * 1.5
    if (doc.y + rowH > bottom()) {
      addPage()
      drawHeader()
    }
    const y = doc.y
    let x = M.left
    row.forEach((cell, i) => {
      doc.rect(x, y, widths[i], rowH).fill(ri % 2 ? C.surface : C.white)
      doc.rect(x, y, widths[i], rowH).lineWidth(0.3).stroke(C.line)
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(i === 0 ? C.navy : C.text).text(String(cell), x + pad, y + pad, {
        width: widths[i] - pad * 2,
        lineGap: 1.35,
      })
      x += widths[i]
    })
    doc.y = y + rowH
  })
  doc.y += 11
}

function relationBox(x, y, w, name, lines, color) {
  const h = 38 + lines.length * 16
  doc.roundedRect(x, y, w, h, 8).fill(C.white).lineWidth(1).stroke(color)
  doc.roundedRect(x, y, w, 30, 8).fill(color)
  doc.rect(x, y + 22, w, 8).fill(color)
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white).text(name, x + 10, y + 9, { width: w - 20 })
  lines.forEach((line, i) => {
    doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(C.text).text(line, x + 10, y + 39 + i * 16, { width: w - 20 })
  })
  return h
}

const clients = [
  ['id', 'uuid', 'NON', 'gen_random_uuid()', 'Clé primaire.'],
  ['user_id', 'uuid', 'NON', '—', 'Propriétaire ; FK vers profiles.id, suppression CASCADE.'],
  ['full_name', 'text', 'NON', '—', 'Nom complet affiché.'],
  ['phone', 'text', 'OUI', '—', 'Téléphone libre.'],
  ['email', 'text', 'OUI', '—', 'Adresse email.'],
  ['status', 'text', 'OUI', 'prospect', 'Statut historique ; 9 valeurs autorisées.'],
  ['source', 'text', 'OUI', '—', 'Source libre historique.'],
  ['language', 'text', 'OUI', 'fr', 'Langue du contact.'],
  ['created_at', 'timestamptz', 'OUI', 'now()', 'Date de création ; nullable dans le schéma réel.'],
  ['birth_date', 'date', 'OUI', '—', 'Date de naissance.'],
  ['profession', 'text', 'OUI', '—', 'Profession.'],
  ['children', 'text', 'OUI', '—', 'Enfants et âges en texte libre.'],
  ['interests', 'text[]', 'OUI', '{}', 'Centres d’intérêt.'],
  ['client_type', 'text', 'OUI', '—', 'Type de client libre.'],
  ['medical_treatment', 'boolean', 'OUI', 'false', 'Présence de précautions particulières.'],
  ['medical_notes', 'text', 'OUI', '—', 'Détails sensibles liés à la santé.'],
  ['particularities', 'text', 'OUI', '—', 'Particularités libres, potentiellement sensibles.'],
  ['welcome_email_sent', 'boolean', 'OUI', 'false', 'Indique si l’email d’accueil a été envoyé.'],
  ['doterra_id', 'text', 'OUI', '—', 'Identifiant du programme de marque.'],
  ['next_lrp_date', 'date', 'OUI', '—', 'Prochaine échéance LRP.'],
  ['updated_at', 'timestamptz', 'OUI', 'now()', 'Dernière modification déclarée.'],
  ['first_name', 'text', 'OUI', '—', 'Prénom séparé.'],
  ['inscription_date', 'date', 'OUI', 'CURRENT_DATE', 'Date d’inscription métier.'],
  ['country', 'text', 'OUI', '—', 'Pays.'],
  ['first_contact_date', 'date', 'OUI', '—', 'Date du premier contact.'],
  ['first_purchase_date', 'date', 'OUI', '—', 'Date du premier achat.'],
  ['acquisition_source', 'text', 'OUI', '—', 'Source d’acquisition structurée côté application.'],
  ['journey_stage', 'text', 'OUI', '—', 'Ancienne étape du parcours.'],
  ['next_action_date', 'date', 'OUI', '—', 'Ancienne date de prochaine action.'],
  ['next_action_type', 'text', 'OUI', '—', 'Ancien type de prochaine action.'],
  ['referrals_count', 'integer', 'NON', '0', 'Compteur de parrainages, doublon potentiel.'],
  ['referral_count', 'integer', 'NON', '0', 'Second compteur de parrainages.'],
  ['network_potential', 'text', 'OUI', '—', 'Potentiel réseau : low / medium / high côté application.'],
  ['sponsor_id', 'uuid', 'OUI', '—', 'Auto-FK vers clients.id ; suppression SET NULL.'],
  ['contact_role', 'text', 'NON', 'customer', 'Rôle MLM principal ; aucune CHECK en base.'],
  ['address', 'text', 'OUI', '—', 'Adresse postale libre.'],
  ['loyalty_notes', 'text', 'OUI', '—', 'Notes du programme de fidélité.'],
  ['archived_at', 'timestamptz', 'OUI', '—', 'Date d’archivage ; NULL = contact actif.'],
  ['pipeline_stage', 'text', 'NON', 'new_lead', 'Étape commerciale canonique ; CHECK sur 8 valeurs.'],
  ['pipeline_stage_updated_at', 'timestamptz', 'OUI', '—', 'Date de changement du pipeline, alimentée par trigger.'],
  ['next_action_at', 'timestamptz', 'OUI', '—', 'Prochaine action canonique calculée.'],
  ['next_action_source', 'text', 'OUI', '—', 'appointment / interaction / followup.'],
  ['next_action_source_id', 'uuid', 'OUI', '—', 'ID polymorphe de l’événement source ; sans FK.'],
  ['last_interaction_at', 'timestamptz', 'OUI', '—', 'Dernière interaction calculée.'],
]

const appointments = [
  ['id', 'uuid', 'NON', 'gen_random_uuid()', 'Clé primaire.'],
  ['user_id', 'uuid', 'NON', '—', 'Propriétaire ; FK auth.users.id, CASCADE.'],
  ['client_id', 'uuid', 'OUI', '—', 'Contact lié ; FK clients.id, suppression SET NULL.'],
  ['title', 'text', 'NON', '—', 'Titre du rendez-vous.'],
  ['appointment_type', 'enum', 'NON', 'other', 'Type métier ; appointment_type_enum.'],
  ['status', 'enum', 'NON', 'scheduled', 'État ; appointment_status_enum.'],
  ['start_at', 'timestamptz', 'NON', '—', 'Début avec fuseau.'],
  ['end_at', 'timestamptz', 'NON', '—', 'Fin avec fuseau.'],
  ['duration_minutes', 'integer', 'OUI', 'calculé', 'Colonne générée : (end_at − start_at) / 60.'],
  ['timezone', 'text', 'NON', 'Europe/Paris', 'Fuseau métier du rendez-vous.'],
  ['location', 'text', 'OUI', '—', 'Lieu physique ou indication libre.'],
  ['meeting_url', 'text', 'OUI', '—', 'Lien de visioconférence.'],
  ['provider', 'text', 'NON', 'oryalis', 'Origine de l’événement.'],
  ['external_calendar_id', 'text', 'OUI', '—', 'ID du calendrier externe.'],
  ['external_event_id', 'text', 'OUI', '—', 'ID de l’événement externe.'],
  ['last_synced_at', 'timestamptz', 'OUI', '—', 'Dernière synchronisation.'],
  ['sync_status', 'text', 'OUI', '—', 'État de synchronisation libre.'],
  ['cancelled_at', 'timestamptz', 'OUI', '—', 'Date d’annulation.'],
  ['cancellation_reason', 'text', 'OUI', '—', 'Motif d’annulation.'],
  ['created_at', 'timestamptz', 'NON', 'now()', 'Date de création.'],
  ['updated_at', 'timestamptz', 'NON', 'now()', 'Mis à jour automatiquement par trigger.'],
]

const notes = [
  ['id', 'uuid', 'NON', 'gen_random_uuid()', 'Clé primaire.'],
  ['client_id', 'uuid', 'NON', '—', 'FK clients.id ; suppression CASCADE.'],
  ['user_id', 'uuid', 'NON', '—', 'Propriétaire ; FK profiles.id, CASCADE.'],
  ['content', 'text', 'NON', '—', 'Contenu de la note libre.'],
  ['created_at', 'timestamptz', 'OUI', 'now()', 'Date de création ; nullable en base.'],
]

const followups = [
  ['id', 'uuid', 'NON', 'gen_random_uuid()', 'Clé primaire.'],
  ['client_id', 'uuid', 'NON', '—', 'FK clients.id ; suppression CASCADE.'],
  ['user_id', 'uuid', 'NON', '—', 'Propriétaire ; FK profiles.id, CASCADE.'],
  ['title', 'text', 'NON', '—', 'Titre obligatoire en base.'],
  ['due_date', 'date', 'OUI', '—', 'Échéance ; nullable en base.'],
  ['done', 'boolean', 'OUI', 'false', 'Relance terminée ou non.'],
  ['created_at', 'timestamptz', 'OUI', 'now()', 'Date de création.'],
  ['updated_at', 'timestamptz', 'OUI', 'now()', 'Dernière modification déclarée.'],
  ['content', 'text', 'OUI', '—', 'Détail libre.'],
  ['action_type', 'text', 'OUI', '—', 'call / whatsapp / sms / email / rdv côté application.'],
  ['prospect_temperature', 'text', 'OUI', '—', 'cold / warm / hot / very_hot côté application.'],
  ['pipeline_stage', 'text', 'OUI', '—', 'Étape capturée ; synchronise le contact par trigger.'],
  ['product_context', 'text', 'OUI', '—', 'Contexte produit libre.'],
  ['auto_generated', 'boolean', 'NON', 'false', 'Créée automatiquement ou manuellement.'],
  ['priority_score', 'integer', 'OUI', '—', 'Score de priorité ; aucune plage contrainte.'],
]

function schemaTable(rows) {
  table(
    ['Colonne', 'Type', 'NULL ?', 'Défaut', 'Rôle'],
    rows,
    [108, 74, 42, 92, 191],
    { fontSize: 7.1, minRowH: 22, pad: 4.5 },
  )
}

// Couverture
doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.navy)
doc.circle(doc.page.width - 15, 75, 145).fill(C.purple)
doc.circle(doc.page.width - 50, 55, 65).fill('#927BFF')
doc.circle(16, doc.page.height - 10, 125).fill(C.teal)
doc.font('Helvetica-Bold').fontSize(34).fillColor(C.white).text('ORYALIS', 54, 160)
doc.font('Helvetica-Bold').fontSize(23).fillColor(C.white).text('Tables Supabase', 54, 225)
doc.font('Helvetica').fontSize(16).fillColor('#D9D2FF').text('clients · appointments · notes · followups', 54, 263)
doc.font('Helvetica').fontSize(12).fillColor(C.white).text(
  'Dictionnaire de données, relations, sécurité RLS, index, triggers et écarts entre le schéma réel et le code.',
  54, 320, { width: 420, lineGap: 5 },
)
doc.roundedRect(54, 425, 410, 78, 10).fill('#263552')
doc.font('Helvetica-Bold').fontSize(8).fillColor('#9FE0DA').text('SOURCE', 72, 443, { characterSpacing: 1 })
doc.font('Helvetica').fontSize(10.5).fillColor(C.white).text(
  'Métadonnées lues directement dans Supabase en lecture seule. Aucune ligne métier ni donnée client n’a été consultée.',
  72, 463, { width: 372, lineGap: 3 },
)
doc.font('Helvetica').fontSize(9).fillColor('#AFB9CC').text('État du schéma réel au 26 juillet 2026', 54, 700)

addPage()
title('Vue d’ensemble', '01 · Périmètre')
callout('Périmètre exact', 'Ce document décrit les tables public.clients, public.appointments, public.notes et public.followups telles qu’elles existent réellement dans Supabase. Les tables liées appointment_notes, appointment_tasks et appointment_business_context sont citées lorsque nécessaire, mais ne sont pas détaillées colonne par colonne.', 'purple')
h2('Cardinalités principales')
const ry = doc.y
const leftX = M.left
const rightX = M.left + 300
relationBox(leftX, ry, 195, 'clients', ['PK id', 'FK user_id → profiles', 'auto-FK sponsor_id'], C.purple)
relationBox(rightX, ry, 195, 'appointments', ['PK id', 'FK client_id → clients', 'FK user_id → auth.users'], C.blue)
relationBox(leftX, ry + 130, 195, 'notes', ['PK id', 'FK client_id → clients', 'FK user_id → profiles'], C.teal)
relationBox(rightX, ry + 130, 195, 'followups', ['PK id', 'FK client_id → clients', 'FK user_id → profiles'], C.amber)
doc.moveTo(leftX + 195, ry + 55).lineTo(rightX, ry + 55).lineWidth(1.4).stroke(C.purple)
doc.moveTo(leftX + 96, ry + 86).lineTo(leftX + 96, ry + 130).lineWidth(1.4).stroke(C.teal)
doc.moveTo(leftX + 195, ry + 58).lineTo(rightX - 25, ry + 58).lineTo(rightX - 25, ry + 185).lineTo(rightX, ry + 185).lineWidth(1.4).stroke(C.amber)
doc.y = ry + 245
h2('Effet des suppressions')
table(
  ['Relation', 'Règle', 'Conséquence'],
  [
    ['profiles → clients / notes / followups', 'ON DELETE CASCADE', 'La suppression du profil supprime ces données.'],
    ['auth.users → appointments', 'ON DELETE CASCADE', 'La suppression du compte auth supprime ses RDV.'],
    ['clients → notes / followups', 'ON DELETE CASCADE', 'Supprimer un client supprime notes et relances.'],
    ['clients → appointments', 'ON DELETE SET NULL', 'Le RDV reste, mais devient orphelin du client.'],
    ['clients.sponsor_id → clients.id', 'ON DELETE SET NULL', 'Le filleul reste sans sponsor.'],
  ],
  [180, 110, 217],
  { fontSize: 8, minRowH: 30 },
)

addPage()
title('Table clients', '02 · 44 colonnes')
p('Table centrale du CRM. Elle porte l’identité, le profil, les données MLM, le pipeline canonique, l’archivage et un résumé calculé de l’activité.')
schemaTable(clients)

addPage()
title('Clients — contraintes et valeurs', '03 · Règles de données')
h2('Clés')
bullet('Clé primaire : id.')
bullet('user_id → profiles.id avec ON DELETE CASCADE.')
bullet('sponsor_id → clients.id avec ON DELETE SET NULL.')
h2('CHECK clients_status_check')
p('prospect · new_client · active · loyal · vip · inactive · advisor · team_member · lost')
h2('CHECK clients_pipeline_stage_check')
p('new_lead · contacted · presentation_scheduled · presentation_completed · follow_up · customer · distributor · lost')
h2('CHECK clients_next_action_source_check')
p('NULL · appointment · interaction · followup')
h2('Valeurs attendues seulement par le code')
table(
  ['Colonne', 'Valeurs côté application', 'Protection en base'],
  [
    ['contact_role', 'prospect, customer, distributor, leader, team_member, inactive', 'Aucune CHECK'],
    ['network_potential', 'low, medium, high', 'Aucune CHECK'],
    ['next_action_type', 'call, whatsapp, sms, email, rdv', 'Aucune CHECK'],
    ['acquisition_source', 'Valeurs TypeScript', 'Aucune CHECK'],
    ['journey_stage', 'Valeurs TypeScript historiques', 'Aucune CHECK'],
  ],
  [125, 245, 137],
  { fontSize: 8, minRowH: 32 },
)
callout('Données sensibles', 'medical_treatment, medical_notes et particularities vivent dans la même table et héritent de la même politique de lecture que le reste de la fiche. Elles ne disposent pas d’une protection RLS distincte.', 'red')

addPage()
title('Table appointments', '04 · 21 colonnes')
p('Rendez-vous moderne utilisé par l’Agenda. Il accepte un client optionnel, stocke les horaires avec fuseau et les identifiants de synchronisation externe.')
schemaTable(appointments)
h2('Enums PostgreSQL')
table(
  ['Enum', 'Valeurs'],
  [
    ['appointment_status_enum', 'scheduled, completed, cancelled, no_show, rescheduled'],
    ['appointment_type_enum', 'discovery_call, product_presentation, follow_up, closing_call, customer_support, team_training, team_meeting, webinar, onboarding, business_review, other'],
  ],
  [155, 352],
  { fontSize: 8, minRowH: 35 },
)
callout('Colonne générée', 'duration_minutes est calculée par PostgreSQL à partir de end_at − start_at. Elle ne doit pas être écrite directement par l’application.', 'green')

addPage()
title('Tables notes et followups', '05 · Notes libres et relances')
h2('public.notes — 5 colonnes')
schemaTable(notes)
callout('À ne pas confondre', 'public.notes contient les notes libres rattachées au client. Les comptes rendus structurés d’un rendez-vous sont stockés séparément dans public.appointment_notes : client_notes, internal_notes, objections, needs_identified et products_discussed.', 'amber')
h2('public.followups — 15 colonnes')
schemaTable(followups)

addPage()
title('Sécurité RLS', '06 · Politiques effectives')
h2('Politiques')
table(
  ['Table', 'Politique', 'Commande', 'Expression'],
  [
    ['clients', 'own clients', 'ALL', 'auth.uid() = user_id ; WITH CHECK identique'],
    ['appointments', 'appointments_select', 'SELECT', 'auth.uid() = user_id'],
    ['appointments', 'appointments_insert', 'INSERT', 'WITH CHECK auth.uid() = user_id'],
    ['appointments', 'appointments_update', 'UPDATE', 'USING + WITH CHECK auth.uid() = user_id'],
    ['appointments', 'appointments_delete', 'DELETE', 'auth.uid() = user_id'],
    ['notes', 'own notes', 'ALL', 'auth.uid() = user_id'],
    ['notes', 'user owns notes', 'ALL', 'auth.uid() = user_id'],
    ['followups', 'own followups', 'ALL', 'auth.uid() = user_id'],
    ['followups', 'user owns followups', 'ALL', 'auth.uid() = user_id'],
  ],
  [82, 145, 65, 215],
  { fontSize: 7.7, minRowH: 29 },
)
h2('Lecture')
bullet('Chaque utilisateur ne voit que les lignes dont user_id correspond à auth.uid().')
bullet('Les rendez-vous possèdent quatre politiques explicites et symétriques.')
bullet('notes et followups ont chacune deux politiques ALL identiques : elles sont redondantes.')
bullet('clients possède une politique ALL avec USING et WITH CHECK explicites.')
callout('Point de cohérence', 'Les FK de clients, notes et followups ciblent profiles.id, alors que appointments.user_id cible directement auth.users.id. Les deux peuvent être valides, mais cette différence doit être intentionnelle et documentée.', 'blue')

addPage()
title('Index', '07 · Accès et performances')
table(
  ['Table', 'Index', 'Définition utile'],
  [
    ['clients', 'clients_pkey', 'UNIQUE (id)'],
    ['clients', 'clients_user_active_quota_idx', '(user_id) WHERE archived_at IS NULL'],
    ['clients', 'clients_user_pipeline_idx', '(user_id, pipeline_stage) WHERE archived_at IS NULL'],
    ['clients', 'idx_clients_last_interaction_at', '(user_id, last_interaction_at) WHERE archived_at IS NULL'],
    ['clients', 'idx_clients_next_action_at', '(user_id, next_action_at) WHERE archived_at IS NULL'],
    ['clients', 'idx_clients_sponsor_id', '(sponsor_id)'],
    ['appointments', 'appointments_pkey', 'UNIQUE (id)'],
    ['appointments', 'idx_appointments_user_id', '(user_id)'],
    ['appointments', 'idx_appointments_client_id', '(client_id)'],
    ['appointments', 'idx_appointments_start_at', '(start_at)'],
    ['appointments', 'idx_appointments_status', '(status)'],
    ['notes', 'notes_pkey', 'UNIQUE (id)'],
    ['followups', 'followups_pkey', 'UNIQUE (id)'],
    ['followups', 'idx_followups_priority', '(user_id, priority_score DESC NULLS LAST)'],
  ],
  [88, 200, 219],
  { fontSize: 7.6, minRowH: 28 },
)
h2('Index potentiellement manquants')
bullet('notes(client_id, created_at DESC) pour la liste des notes d’un client.')
bullet('followups(client_id, due_date) et followups(user_id, done, due_date) pour les relances.')
bullet('appointments(user_id, start_at) et appointments(client_id, start_at) pour les plages Agenda et l’historique client.')
callout('À mesurer', 'Ces index sont des recommandations de vérification, pas des ajouts automatiques. Il faut confirmer les plans de requête et les volumes avant modification.', 'amber')

addPage()
title('Triggers et données dérivées', '08 · Automatisations base')
table(
  ['Table', 'Trigger', 'Moment', 'Fonction'],
  [
    ['clients', 'enforce_free_contact_quota_trigger', 'BEFORE INSERT / UPDATE', 'enforce_free_contact_quota()'],
    ['clients', 'touch_client_pipeline_stage_trigger', 'BEFORE UPDATE', 'touch_client_pipeline_stage()'],
    ['clients', 'analytics_client_created_trigger', 'AFTER INSERT', 'analytics_client_created()'],
    ['appointments', 'set_updated_at', 'BEFORE UPDATE', 'update_updated_at_column()'],
    ['appointments', 'refresh_activity_from_appointments', 'AFTER INSERT / UPDATE / DELETE', 'on_contact_event_changed()'],
    ['appointments', 'analytics_appointment_trigger', 'AFTER INSERT / UPDATE', 'analytics_contact_event()'],
    ['followups', 'refresh_activity_from_followups', 'AFTER INSERT / UPDATE / DELETE', 'on_contact_event_changed()'],
    ['followups', 'sync_client_pipeline_followup_trigger', 'AFTER INSERT / UPDATE', 'sync_client_pipeline_from_followup()'],
    ['followups', 'analytics_followup_trigger', 'AFTER INSERT / UPDATE', 'analytics_contact_event()'],
    ['notes', 'Aucun trigger', '—', '—'],
  ],
  [84, 180, 105, 138],
  { fontSize: 7.4, minRowH: 31 },
)
h2('Résumé de clients calculé')
p('next_action_at, next_action_source, next_action_source_id et last_interaction_at sont rafraîchis à partir des rendez-vous, interactions et relances. Ils servent de projection rapide pour les listes et la fiche client.')
h2('Pipeline canonique')
p('pipeline_stage est porté par clients. Les changements issus des relances — et des tables de contexte RDV non détaillées ici — peuvent le synchroniser automatiquement.')

addPage()
title('Écarts schéma ↔ application', '09 · Points à corriger')
table(
  ['Priorité', 'Écart constaté', 'Risque'],
  [
    ['Critique', 'appointmentService sélectionne native_event_id, mais la colonne est absente de public.appointments.', 'Les requêtes qui incluent cette projection peuvent échouer en production.'],
    ['Élevée', 'Le fichier add_native_event_id_to_appointments.sql existe, mais n’est pas appliqué au schéma réel.', 'Dérive entre dépôt et base.'],
    ['Élevée', 'Followup TypeScript autorise title nullable, alors que la base impose title NOT NULL.', 'Insertion refusée si seul content est fourni.'],
    ['Élevée', 'Followup TypeScript considère due_date obligatoire, mais la base l’autorise à NULL.', 'Relances sans échéance possibles hors application.'],
    ['Moyenne', 'Note TypeScript ne prévoit pas updated_at, cohérent avec la base réelle, mais la migration initiale le déclarait.', 'Historique des migrations non représentatif du réel.'],
    ['Moyenne', 'Client TypeScript attend created_at, mais la colonne est nullable en base.', 'Valeur NULL possible lors d’un import ou d’une écriture atypique.'],
    ['Moyenne', 'contact_role, network_potential, action_type et prospect_temperature n’ont pas de CHECK.', 'Valeurs invalides possibles via SQL ou API.'],
    ['Moyenne', 'Aucune contrainte end_at > start_at dans appointments.', 'Durée nulle ou négative possible hors validation applicative.'],
  ],
  [55, 285, 167],
  { fontSize: 7.7, minRowH: 35 },
)
callout('Observation', 'Le schéma réel doit devenir la source de vérité versionnée : une migration complète et reproductible doit permettre de reconstruire exactement ces tables sans dépendre de scripts historiques exécutés manuellement.', 'red')

addPage()
title('Redondances à décider', '10 · Nettoyage possible')
table(
  ['Doublon / chevauchement', 'Lecture', 'Décision à prendre'],
  [
    ['source / acquisition_source', 'Deux origines du contact en texte.', 'Conserver une colonne canonique et migrer les valeurs.'],
    ['journey_stage / pipeline_stage', 'Ancien parcours et pipeline moderne.', 'Déprécier journey_stage si aucun usage restant.'],
    ['next_action_date + next_action_type / next_action_at + source', 'Ancien suivi manuel et résumé calculé.', 'Conserver le mécanisme canonique après migration.'],
    ['referrals_count / referral_count', 'Deux compteurs presque identiques.', 'Définir la sémantique ou fusionner.'],
    ['status / contact_role / pipeline_stage', 'Cycle de vie, rôle et progression peuvent se contredire.', 'Définir une responsabilité unique par colonne.'],
    ['notes / appointment_notes', 'Note libre et compte rendu structuré.', 'Conserver les deux tables, mais unifier leur affichage.'],
    ['external_event_id / native_event_id attendu par le code', 'Deux intégrations calendrier possibles.', 'Définir le rôle exact de chaque identifiant avant migration.'],
  ],
  [155, 190, 162],
  { fontSize: 7.8, minRowH: 37 },
)
h2('Données de santé')
callout('Protection recommandée', 'Évaluer une table séparée avec politiques spécifiques, consentement, journalisation d’accès et politique de conservation. Ce point concerne des données potentiellement sensibles au sens du RGPD.', 'red')

addPage()
title('Recommandations', '11 · Ordre de sécurisation')
table(
  ['Ordre', 'Action', 'Résultat attendu'],
  [
    ['1', 'Appliquer ou retirer proprement la migration native_event_id.', 'Code et production redeviennent cohérents.'],
    ['2', 'Créer une migration de référence idempotente reflétant le schéma réel.', 'Base reproductible depuis le dépôt.'],
    ['3', 'Aligner les types Followup avec les contraintes réelles.', 'Plus d’ambiguïté sur title et due_date.'],
    ['4', 'Ajouter les CHECK métier validées.', 'contact_role, network_potential, action_type, température et pipeline de relance.'],
    ['5', 'Supprimer les politiques RLS dupliquées après vérification.', 'Sécurité plus lisible sans changer les droits.'],
    ['6', 'Décider les colonnes historiques à migrer puis déprécier.', 'Clients simplifié et source unique.'],
    ['7', 'Mesurer les requêtes avant d’ajouter les index composites.', 'Optimisation fondée sur les usages réels.'],
    ['8', 'Isoler ou renforcer les données de santé.', 'Réduction du risque de confidentialité.'],
  ],
  [45, 280, 182],
  { fontSize: 8, minRowH: 35 },
)
h2('Contrôles après chaque migration')
bullet('Comparer information_schema avant / après.')
bullet('Tester les quatre opérations RLS avec deux utilisateurs distincts.')
bullet('Tester les suppressions CASCADE et SET NULL sur des données de test.')
bullet('Régénérer les types Supabase et vérifier le TypeScript.')
bullet('Exécuter les scénarios client, RDV, note et relance de bout en bout.')
callout('Aucune modification effectuée', 'Ce PDF documente et analyse le schéma. Aucune table, politique, colonne, contrainte, donnée ou migration Supabase n’a été modifiée.', 'green')

// En-têtes et pieds de page sans création involontaire de pages
const range = doc.bufferedPageRange()
for (let i = 0; i < range.count; i += 1) {
  doc.switchToPage(i)
  if (i === 0) continue
  const savedBottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc.font('Helvetica-Bold').fontSize(7).fillColor(C.purple).text('ORYALIS · DICTIONNAIRE SUPABASE', M.left, 24, { width: W / 2, lineBreak: false })
  doc.font('Helvetica').fontSize(7).fillColor(C.muted).text(pageSections[i] ?? '', M.left + W / 2, 24, { width: W / 2, align: 'right', lineBreak: false })
  doc.moveTo(M.left, 39).lineTo(M.left + W, 39).lineWidth(0.4).stroke(C.line)
  doc.moveTo(M.left, doc.page.height - 36).lineTo(M.left + W, doc.page.height - 36).lineWidth(0.4).stroke(C.line)
  doc.font('Helvetica').fontSize(7).fillColor(C.muted).text('Schéma réel · 26 juillet 2026', M.left, doc.page.height - 27, { width: W / 2, lineBreak: false })
  doc.text(`${i} / ${range.count - 1}`, M.left + W / 2, doc.page.height - 27, { width: W / 2, align: 'right', lineBreak: false })
  doc.page.margins.bottom = savedBottom
}

doc.end()
console.log(`PDF généré : ${OUTPUT}`)
