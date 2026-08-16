// generate-roadmap.mjs — Génère le PDF Roadmap Supabase de Lumora
// Usage: node generate-roadmap.mjs
import PDFDocument from 'pdfkit'
import { createWriteStream } from 'fs'

const OUTPUT = 'Lumora_Roadmap_Supabase.pdf'
const doc = new PDFDocument({ margin: 50, size: 'A4' })
doc.pipe(createWriteStream(OUTPUT))

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  primary:   '#334f2b',
  action:    '#4a6741',
  light:     '#caecbc',
  amber:     '#8a5100',
  amberLight:'#ffdcbe',
  danger:    '#ba1a1a',
  dangerLight:'#ffdad6',
  text:      '#1d1b18',
  muted:     '#73796f',
  border:    '#c3c8bd',
  bg:        '#f9f2ed',
  white:     '#ffffff',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function pageW() { return doc.page.width - 100 }

function header() {
  doc.rect(0, 0, doc.page.width, 80).fill(C.primary)
  doc.fillColor(C.white).fontSize(22).font('Helvetica-Bold')
    .text('Lumora — Roadmap Supabase', 50, 26)
  doc.fontSize(11).font('Helvetica').fillColor('rgba(255,255,255,0.75)')
    .text(`Généré le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`, 50, 52)
  doc.y = 100
}

function sectionTitle(text, color = C.primary) {
  doc.moveDown(0.5)
  doc.rect(50, doc.y, pageW(), 28).fill(color)
  doc.fillColor(C.white).fontSize(12).font('Helvetica-Bold')
    .text(text, 62, doc.y - 22)
  doc.moveDown(0.8)
  doc.fillColor(C.text)
}

function subTitle(text) {
  doc.fontSize(11).font('Helvetica-Bold').fillColor(C.primary)
    .text(text, { continued: false })
  doc.moveDown(0.2)
  doc.fillColor(C.text)
}

function bullet(text, indent = 0, color = C.text) {
  doc.fontSize(10).font('Helvetica').fillColor(color)
    .text(`  •  ${text}`, 50 + indent, doc.y, { width: pageW() - indent })
  doc.moveDown(0.15)
}

function tableRow(cols, widths, isHeader = false, bg = null) {
  const rowH = 22
  const startY = doc.y
  const startX = 50
  if (bg) doc.rect(startX, startY, pageW(), rowH).fill(bg)
  let x = startX
  cols.forEach((col, i) => {
    doc.rect(x, startY, widths[i], rowH).stroke(C.border)
    doc.fontSize(9)
       .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
       .fillColor(isHeader ? C.white : C.text)
       .text(col, x + 6, startY + 6, { width: widths[i] - 12, ellipsis: true })
    x += widths[i]
  })
  doc.y = startY + rowH
}

function badge(text, bg, color, x, y) {
  const w = doc.widthOfString(text, { fontSize: 9 }) + 14
  doc.rect(x, y, w, 16).fill(bg).roundedRect(x, y, w, 16, 4).fill(bg)
  doc.fontSize(9).font('Helvetica-Bold').fillColor(color).text(text, x + 7, y + 3.5)
  return w + 6
}

function codeBlock(lines) {
  const h = lines.length * 16 + 16
  doc.rect(50, doc.y, pageW(), h).fill('#f3ede7')
  const startY = doc.y + 8
  lines.forEach((line, i) => {
    doc.fontSize(8.5).font('Courier').fillColor('#334f2b')
      .text(line, 62, startY + i * 16)
  })
  doc.y = doc.y + h + 4
  doc.fillColor(C.text)
}

// ─────────────────────────────────────────────────────────────────────────────
//  PAGE 1
// ─────────────────────────────────────────────────────────────────────────────
header()

// ── 1. Tables existantes ─────────────────────────────────────────────────────
sectionTitle('1. Tables existantes — Phase 1 ✅ Terminée')

const W = [110, 160, 95, pageW() - 365]
// Header row
doc.rect(50, doc.y, pageW(), 22).fill(C.action)
tableRow(['Table', 'Colonnes principales', 'Statut', 'Notes'], W, true, C.action)

const tables = [
  ['profiles',          'id, full_name, email, locale, timezone, plan',           '✅ Complet',  'Lecture + écriture (Settings)'],
  ['clients',           'id, user_id, full_name, first_name, email, phone, status…','✅ Complet', 'CRUD complet + filtres statut'],
  ['appointments',      'id, client_id, appointment_number, appointment_date…',   '✅ Complet',  'CRUD + numérotation auto'],
  ['notes',             'id, client_id, user_id, content, created_at',            '✅ Complet',  'CRUD complet'],
  ['followups',         'id, client_id, title, content, due_date, done',          '⚠️  Partiel', 'content NOT NULL — pb cache PostgREST'],
  ['recommendations',   'id, client_id, product_name, reason, status, catalog_id','✅ Complet',  'Lié au catalogue'],
  ['catalogs',          'id, slug, name, brand, type, user_id',                   '✅ Complet',  'Officiels (doTERRA 52 produits)'],
  ['catalog_products',  'id, catalog_id, sku, name, category',                    '✅ Complet',  'Lecture seule depuis l\'app'],
]

tables.forEach((row, i) => {
  tableRow(row, W, false, i % 2 === 0 ? '#fff8f3' : C.white)
})

doc.moveDown(0.8)

// ── 2. Problème connu ────────────────────────────────────────────────────────
sectionTitle('2. Problème connu — À corriger maintenant', C.danger)

subTitle('followups.content — Schema cache PostgREST désynchronisé')
bullet('La colonne content existe en DB (NOT NULL) mais PostgREST ne la voit pas → PGRST204')
bullet('Erreur lors des inserts de relances dans le mode démo et l\'app réelle')
bullet('Solution : rendre content nullable + NOTIFY pgrst reload schema (migrate6.mjs)', 0, C.danger)

doc.moveDown(0.3)
codeBlock([
  'ALTER TABLE followups ALTER COLUMN content DROP NOT NULL;',
  'ALTER TABLE followups ALTER COLUMN content SET DEFAULT NULL;',
  'NOTIFY pgrst, \'reload schema\';   -- force PostgREST à recharger son cache',
])

// ─────────────────────────────────────────────────────────────────────────────
//  PAGE 2
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage()
header()

// ── 3. Phase 2 ───────────────────────────────────────────────────────────────
sectionTitle('3. Phase 2 — Stripe & Onboarding', C.action)

subTitle('3a. Colonne à ajouter sur profiles')
codeBlock([
  'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS',
  '  onboarding_completed boolean NOT NULL DEFAULT false;',
])
bullet('Utilisée pour savoir si le praticien a terminé le wizard de bienvenue (3 étapes)')

doc.moveDown(0.3)
subTitle('3b. Nouvelle table : subscriptions (Stripe webhook)')
codeBlock([
  'CREATE TABLE subscriptions (',
  '  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
  '  user_id                uuid REFERENCES auth.users ON DELETE CASCADE,',
  '  stripe_customer_id     text,',
  '  stripe_subscription_id text,',
  '  plan     text DEFAULT \'free\',    -- free | pro | cabinet',
  '  status   text DEFAULT \'active\',  -- active | canceled | past_due',
  '  current_period_start   timestamptz,',
  '  current_period_end     timestamptz,',
  '  created_at timestamptz DEFAULT now(),',
  '  updated_at timestamptz DEFAULT now()',
  ');',
  'ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;',
  'CREATE POLICY "own" ON subscriptions USING (auth.uid() = user_id);',
])
bullet('Remplie par le webhook Stripe → Edge Function Supabase')
bullet('profiles.plan reste la valeur dénormalisée lue par l\'app (pas de JOIN à chaque requête)')

doc.moveDown(0.3)
subTitle('3c. Gates fonctionnalités (aucune table — logique app)')
bullet('Vérifier profiles.plan avant d\'afficher certaines pages/actions')
bullet('Free : max 20 clients, 1 module | Pro : illimité | Cabinet : +5 praticiens')

// ─────────────────────────────────────────────────────────────────────────────
//  PAGE 3
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage()
header()

// ── 4. Phase 3 ───────────────────────────────────────────────────────────────
sectionTitle('4. Phase 3 — Comptabilité, Facturation, RGPD', C.amber)

subTitle('4a. Nouvelle table : revenue_entries (Comptabilité)')
codeBlock([
  'CREATE TABLE revenue_entries (',
  '  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
  '  user_id        uuid REFERENCES auth.users ON DELETE CASCADE,',
  '  client_id      uuid REFERENCES clients ON DELETE SET NULL,',
  '  invoice_number text,',
  '  amount         numeric(10,2) NOT NULL,',
  '  description    text,',
  '  date           date NOT NULL,',
  '  status         text DEFAULT \'paid\',  -- paid | pending | canceled',
  '  created_at     timestamptz DEFAULT now()',
  ');',
  'ALTER TABLE revenue_entries ENABLE ROW LEVEL SECURITY;',
  'CREATE POLICY "own" ON revenue_entries USING (auth.uid() = user_id);',
])
bullet('Base pour : dashboard revenus, export URSAF, facturation PDF')
bullet('Lié à clients pour retrouver le nom dans les exports comptables')

doc.moveDown(0.3)
subTitle('4b. Nouvelle table : rgpd_consents (RGPD Art.30)')
codeBlock([
  'CREATE TABLE rgpd_consents (',
  '  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
  '  user_id      uuid REFERENCES auth.users ON DELETE CASCADE,',
  '  client_id    uuid REFERENCES clients ON DELETE CASCADE,',
  '  consent_type text NOT NULL,  -- data_processing | newsletter | ...  ',
  '  granted      boolean DEFAULT false,',
  '  granted_at   timestamptz,',
  '  updated_at   timestamptz DEFAULT now()',
  ');',
  'ALTER TABLE rgpd_consents ENABLE ROW LEVEL SECURITY;',
  'CREATE POLICY "own" ON rgpd_consents USING (auth.uid() = user_id);',
])

// ── 5. Phase 4 ───────────────────────────────────────────────────────────────
sectionTitle('5. Phase 4 — Cabinet multi-praticiens & White-label', C.primary)

subTitle('5a. Nouvelle table : team_members')
codeBlock([
  'CREATE TABLE team_members (',
  '  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),',
  '  owner_id   uuid REFERENCES auth.users ON DELETE CASCADE,',
  '  member_id  uuid REFERENCES auth.users ON DELETE CASCADE,',
  '  role       text DEFAULT \'practitioner\',',
  '  invited_at timestamptz DEFAULT now(),',
  '  UNIQUE (owner_id, member_id)',
  ');',
])
bullet('Plan Cabinet : propriétaire + jusqu\'à 5 praticiens partagent les clients')
bullet('RLS à adapter : clients visibles par owner ET ses team_members')

doc.moveDown(0.3)
subTitle('5b. Catalogue Zinzino (zéro code — juste des inserts)')
codeBlock([
  '-- Ajouter dans catalogs :',
  'INSERT INTO catalogs (slug, name, brand, type)',
  '  VALUES (\'zinzino\', \'Zinzino\', \'Zinzino\', \'official\');',
  '-- Puis insérer les produits dans catalog_products.',
])

// ─────────────────────────────────────────────────────────────────────────────
//  PAGE 4 — Résumé / Priorités
// ─────────────────────────────────────────────────────────────────────────────
doc.addPage()
header()

sectionTitle('6. Priorités d\'exécution', C.primary)

const priorities = [
  { phase: 'MAINTENANT',  color: C.danger,  bg: C.dangerLight, items: [
    'followups.content → rendre nullable + NOTIFY pgrst reload (migrate6.mjs)',
    'Vérifier que le mode démo charge sans erreur PGRST204',
  ]},
  { phase: 'PHASE 2',  color: C.action, bg: C.light, items: [
    'profiles.onboarding_completed (ALTER TABLE)',
    'Créer table subscriptions + RLS',
    'Stripe Checkout + webhook → Edge Function Supabase',
    'Gates Pro/Cabinet dans l\'app (max clients, modules)',
    'Onboarding wizard 3 étapes',
    'Emails transactionnels (Resend)',
    'Agenda vue semaine/jour',
  ]},
  { phase: 'PHASE 3',  color: C.amber, bg: C.amberLight, items: [
    'Créer table revenue_entries + RLS',
    'Créer table rgpd_consents + RLS',
    'Dashboard comptabilité (revenus, URSAF)',
    'Export PDF fiche client + factures',
    'RGPD Art.30 — consentements par client',
    'Résumé IA séance (Claude API)',
  ]},
  { phase: 'PHASE 4',  color: C.primary, bg: C.light, items: [
    'Créer table team_members + adapter RLS',
    'Seed catalogue Zinzino dans catalog_products',
    'Module MTC complet (référence Synoria)',
    'Marketplace praticiens',
    'App stores iOS + Android (hors TestFlight)',
    'Multilingue ES, DE, PT, AR (RTL)',
  ]},
]

priorities.forEach(p => {
  doc.moveDown(0.3)
  const y = doc.y
  doc.rect(50, y, pageW(), 22).fill(p.color)
  doc.fillColor(C.white).fontSize(11).font('Helvetica-Bold')
    .text(p.phase, 62, y + 5)
  doc.y = y + 28
  p.items.forEach(item => bullet(item, 0, C.text))
  doc.moveDown(0.1)
})

doc.moveDown(1)
doc.fontSize(9).font('Helvetica').fillColor(C.muted)
  .text('Lumora © 2025 — Document généré automatiquement', { align: 'center' })

doc.end()
console.log(`✅ PDF généré : ${OUTPUT}`)
