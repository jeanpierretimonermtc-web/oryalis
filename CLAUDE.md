@AGENTS.md

# Oryalis — CRM SaaS pour praticiens du bien-être

## Projet

| | |
|---|---|
| **Prod** | https://oryalis.vercel.app |
| **GitHub** | https://github.com/jeanpierretimonermtc-web/oryalis.git |
| **Supabase** | `nhpvjfyjyculnijipzoa` (eu-west-1) |
| **Propriétaire** | Jean-Pierre Timoner (`jeanpierre.timoner.mtc@gmail.com`) |
| **iOS TestFlight** | https://testflight.apple.com/join/GZJxxfUU |

---

## Stack

| Couche | Technologie |
|---|---|
| Mobile + Web | Expo SDK ~56.0.8 + React Native 0.85.3 |
| Navigation | Expo Router ~56.2.8 (file-based) |
| Backend / DB | Supabase (PostgreSQL + Auth + RLS) |
| i18n | i18next ^24 + react-i18next ^15 + expo-localization |
| Déploiement web | Vercel (auto-deploy sur push `main`) |
| Migrations DB | Node.js + `pg` ^8 (scripts `migrate*.mjs`) |
| Fonts | Inter via `@expo-google-fonts/inter` |

---

## Architecture dossiers

```
app/
  _layout.tsx              Root layout (ThemeProvider + AuthProvider + i18n + Inter fonts)
  reset-password.tsx       Route publique
  (auth)/
    login.tsx
    register.tsx
  (app)/
    _layout.tsx            Sidebar (web ≥768px) + bottom tab bar custom (mobile)
    index.tsx              Dashboard (KPIs, agenda, relances, LRP)
    settings.tsx           Paramètres profil
    clients/
      index.tsx
      new.tsx
      [id]/
        index.tsx          Fiche client
        appointments.tsx
        notes.tsx
        followups.tsx
        recommendations.tsx
    appointments/index.tsx
    followups/index.tsx
    catalog/index.tsx

features/
  auth/AuthProvider.tsx
  clients/                 clientService.ts · useClients.ts · useClient.ts
  appointments/            appointmentTypes.ts (source de vérité TS) · appointmentService.ts · appointmentOutcomeService.ts · useAppointments.ts · googleCalendarService.ts · useGoogleCalendar.ts
  notes/                   noteService.ts · useNotes.ts
  followups/               followupService.ts · useFollowups.ts
  recommendations/         recommendationService.ts · useRecommendations.ts
  dashboard/               useDashboard.ts
  catalogs/                catalogService.ts · useCatalog.ts · CatalogProductPicker.tsx
  demo/                    DemoProvider.tsx (données démo au login)
  orders/                  orderService.ts · useOrders.ts (historique commandes / LRP)
  subscriptions/           subscriptionService.ts · mobilePurchaseService.ts (Stripe web + RevenueCat mobile — déjà implémenté, voir État du projet)
  network/                 uplineService.ts (réseau MLM / parrainage — ⚠️ interroge la table `upline_nodes`, absente de la DB live, voir Points de vigilance)
  automations/              relances automatiques J+3/J+7/J+15/J+30
  protocols/               protocoles bien-être par problématique (doTERRA/Zinzino)
  goals/ · alerts/ · interactions/ · messages/ (message_templates) · analytics/ (product_events)
  admin/ · security/       console owner, audit log, accès support, rôles
  onboarding/              événements d'onboarding guidé
  modules/                 gestion de l'activation des modules par plan
  notifications/           notifications push relances
  settings/                paramètres profil, activité, intégrations

  ⚠️ Cette liste features/ a été revérifiée le 2026-08-16 (24 sous-dossiers réels contre 9 documentés
  auparavant). Si tu ajoutes un module, mets aussi à jour cette liste dans le même commit.

shared/
  lib/
    supabase.ts            Client Supabase + AsyncStorage
    types.ts               Tous les types TypeScript
  i18n/
    index.ts               Config i18next (EN canonique, fallback EN)
    locales/en.json        Source de vérité
    locales/fr.json        Traduction complète
  theme/
    colors.ts              Palette premium + tokens light/dark + statusColors
    fonts.ts               Constantes Inter (display/body/medium/semibold/bold)
    ThemeProvider.tsx      Context useTheme() + persistance AsyncStorage
  components/ui/
    Button.tsx · Card.tsx · Input.tsx · TextArea.tsx · Badge.tsx · EmptyState.tsx · Avatar.tsx

assets/
  logo-icon.png            Glyph colibri (1024×1024, fond transparent)
  wordmark-day.png         Texte ORYALIS (gradient, fond blanc)
  wordmark-dark.png        Texte ORYALIS (gradient, fond sombre / transparent)
  icon.png                 App icon (1024×1024)
  favicon.png              Web favicon (196×196)
  android-icon-foreground.png
  android-icon-monochrome.png
  splash.png
  splash-icon.png

supabase/migrations/       SQL de référence datée (29 fichiers, non exécuté via CLI) — convention à préférer
supabase/functions/        Edge Functions Deno : stripe-webhook, revenuecat-webhook, create-checkout-session,
                            create-billing-portal, record-security-login, _shared/ (stripe.ts, http.ts)
scripts/legacy-migrations/ 52 scripts Node.js + pg historiques (migrate4 → migrate56 + migrate_agenda*),
                            déplacés hors racine le 2026-08-16 — dette archivée, voir README.md du dossier
```

---

## Design System

### Règle absolue

Ne **jamais** importer une palette statique dans un composant React :

```tsx
// ❌ Interdit
import { lightColors as colors } from '@/shared/theme/colors'

// ✅ Obligatoire
const { colors, statusColors, mode } = useTheme()
const styles = useMemo(() => makeStyles(colors), [colors])
```

### Pattern standard (tous les composants)

```tsx
import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

export function MyComponent() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return null
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { backgroundColor: colors.bg },
  })
}
```

### Tokens principaux

| Token | Light | Dark |
|---|---|---|
| `bg` | `#FFFFFF` | `#0B1220` |
| `surface` | `#F8FAFC` | `#111827` |
| `bgDim` | `#F1F5F9` | `#1E293B` |
| `card` | `#FFFFFF` | `#111827` |
| `border` | `#E2E8F0` | `#334155` |
| `text` | `#0F172A` | `#F8FAFC` |
| `textSecondary` | `#475569` | `#CBD5E1` |
| `textTertiary` | `#94A3B8` | `#64748B` |
| `primary` | `#2563EB` | `#3B82F6` |
| `primaryLight` | `#DBEAFE` | `#1E3A5F` |
| `secondary` (cyan) | `#22D3EE` | `#22D3EE` |
| `secondaryLight` | `#ECFEFF` | `#0C3B47` |
| `tertiary` (violet) | `#6D3BFF` | `#8B5CF6` |
| `tertiaryLight` | `#EDE9FE` | `#1E1547` |
| `success` | `#10B981` | `#10B981` |
| `warning` | `#F59E0B` | `#F59E0B` |
| `danger` | `#EF4444` | `#EF4444` |

Gradient officiel (logo · accents) : `['#22D3EE', '#3B82F6', '#6D3BFF']`

### Typographie

```ts
fonts.display   // Inter_700Bold   — titres
fonts.body      // Inter_400Regular
fonts.medium    // Inter_500Medium
fonts.semibold  // Inter_600SemiBold
fonts.bold      // Inter_700Bold
```

Ne pas hardcoder `fontWeight`. Toujours utiliser `fonts.*`.

### Border-radius

| Composant | Radius |
|---|---:|
| Card | 16 |
| Button md | 12 |
| Button sm / Input / TextArea | 12 |
| StatusBadge | 8 |

### Status colors (CRM)

Via `useTheme()` → `statusColors` :

| Status | Light bg | Light text | Dark bg | Dark text |
|---|---|---|---|---|
| active | `#D1FAE5` | `#059669` | `#064E3B` | `#34D399` |
| prospect | `#DBEAFE` | `#1D4ED8` | `#1E3A5F` | `#60A5FA` |
| inactive | `#FEF3C7` | `#B45309` | `#451A03` | `#FCD34D` |
| vip | `#EDE9FE` | `#5B21B6` | `#1E1547` | `#A78BFA` |
| advisor | `#ECFEFF` | `#0E7490` | `#0C3B47` | `#67E8F9` |

### Mobile vs Web

- **Mobile header** : fond fixe `#0F172A` (dark navy), indépendant du mode — permet d'afficher `wordmark-dark.png` (gradient) dans les deux modes. `<StatusBar style="light" />`.
- **Web sidebar** : fond `colors.card` mode-responsive, wordmark conditionnel `mode === 'dark' ? wordmark-dark : wordmark-day`.
- Ne jamais modifier le sidebar web en ciblant uniquement le mobile.

---

## Base de données

### Tables

```sql
profiles          id (= auth.users.id), full_name, email, locale, timezone, plan, updated_at
clients           id, user_id, full_name, first_name, email, phone, status, source, language,
                  birth_date, inscription_date, profession, children, interests[], client_type,
                  medical_treatment, medical_notes, particularities, welcome_email_sent,
                  doterra_id, next_lrp_date, created_at, updated_at
appointments      id, user_id, client_id, title, appointment_type, status, start_at, end_at,
                  duration_minutes (généré), timezone, location, meeting_url, provider,
                  external_calendar_id, external_event_id, last_synced_at, sync_status,
                  cancelled_at, cancellation_reason, created_at, updated_at
notes             id, client_id, user_id, content, created_at
followups         id, client_id, user_id, title, content, due_date, done, updated_at
recommendations   id, client_id, user_id, product_name, reason, status, catalog_id, product_id
catalogs          id, slug (UNIQUE), name, brand, type (official|custom), user_id, color, icon, created_at
catalog_products  id, catalog_id, sku, name, category, created_at
```

### Autres tables live (confirmées par introspection `information_schema` le 2026-08-16)

La DB compte **30 tables** au total, pas seulement les 8 ci-dessus. Les 22 suivantes existent aussi en prod
mais n'ont pas leur schéma détaillé documenté ici — se référer directement à Supabase (Table Editor ou
requête `information_schema.columns`) avant de les modifier, plutôt qu'aux scripts `migrate*.mjs` qui ne
sont pas fiables comme source de vérité (voir section Migrations ci-dessous) :

```
appointment_attendees · appointment_business_context · appointment_notes · appointment_tasks
  (sous-tables RDV actives, utilisées par appointmentService.ts / appointmentTypes.ts)
google_calendar_events · google_calendar_tokens   (sync Google Calendar)
orders                                             (historique commandes / LRP)
subscriptions                                      (Stripe web + RevenueCat mobile)
interactions · goals · alerts                      (suivi commercial)
message_templates                                  (templates de messages personnalisables)
client_events · product_events · onboarding_events · pilot_participants  (analytics/tracking)
user_business_profiles · user_status_labels        (personnalisation par utilisateur)
admin_audit_log · user_roles                       (console owner / rôles)
security_notifications · security_login_events · support_access_requests  (sécurité / support)
```

⚠️ `features/network/uplineService.ts` interroge une table `upline_nodes` qui **n'existe pas** dans la DB
live (confirmé le 2026-08-16) — le module réseau/MLM est cassé en prod tant que cette table n'est pas créée
ou que le service n'est pas corrigé.

Source de vérité TypeScript des rendez-vous : `features/appointments/appointmentTypes.ts`.
Ne pas se fier à d'anciennes colonnes type `appointment_number`, `appointment_date`, `themes_discussed`,
`solutions_proposed`, `recap_sent`, `next_appointment_date`, `native_event_id` : elles n'existent plus
dans le schéma live (ancien modèle, retiré).

### Calendriers

- V1 : **Google Calendar** est la seule intégration calendrier externe.
- La synchronisation avec le calendrier natif du téléphone a été retirée fonctionnellement (aucune référence
  à `expo-calendar` dans `app/`/`features/`), mais le package **`expo-calendar` est toujours listé dans
  `package.json`** (dépendance orpheline, jamais désinstallée) — à retirer via `npm uninstall expo-calendar`.
- `appointments` reste la source de vérité métier des rendez-vous Oryalis.
- `google_calendar_events` sert de table de correspondance (mapping `appointment_id` ↔ `google_event_id`).
- `google_calendar_tokens` stocke la connexion OAuth Google (access/refresh token) par utilisateur.
- Google Calendar est une copie externe synchronisée : il ne stocke jamais de données CRM internes
  (pipeline, notes internes, objections, tâches, débrief, intention commerciale).

### RLS

Toutes les tables ont RLS activé.

```sql
-- Pattern standard
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)

-- Exception catalogues officiels (visibles par tous)
USING (user_id IS NULL AND type = 'official')
```

### Trigger

`handle_new_user()` → insère dans `profiles` à chaque signup. `SECURITY DEFINER SET search_path = public`.

### Migrations Node.js + pg

**Ne jamais utiliser Supabase CLI** (projet sous un compte différent).

```js
// Pattern migrate*.mjs
import pg from 'pg'
const { Client } = pg
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})
await client.connect()
try {
  // ... queries ...
} finally {
  await client.end()
}
```

⚠️ **État réel (2026-08-16)** : `migrate.mjs`, `migrate2.mjs`, `migrate3.mjs` référencés ci-dessous **n'existent
plus sur disque**. Les **52 scripts** `migrate4.mjs` → `migrate56.mjs` (+ `migrate_agenda.mjs`/`migrate_agenda2.mjs`)
ont été déplacés dans `scripts/legacy-migrations/` (archivés, pas supprimés — aucun registre fiable de ce qui a
été appliqué en prod). **Ne pas se fier à cette liste pour connaître le schéma réel**, interroger
`information_schema` sur Supabase directement.

En parallèle, `supabase/migrations/*.sql` contient 29 fichiers datés (`YYYYMMDD_nom.sql`) qui semblent être une
convention plus récente et mieux organisée — préférer ce format pour toute nouvelle migration plutôt qu'un
nouveau `migrate*.mjs` à la racine, pour ne pas aggraver la dette existante.

Historique (partiel, non exhaustif) :
- `migrate4.mjs` — catalogs + catalog_products + seed doTERRA
- `migrate13.mjs` — interactions + orders
- `migrate18.mjs` — alerts
- `migrate21.mjs` — goals
- `migrate24.mjs` — google_calendar_tokens + google_calendar_events
- `migrate28.mjs` — upline_nodes (⚠️ table absente de la DB live malgré ce script — voir section Tables)
- `migrate_agenda.mjs` / `migrate_agenda2.mjs` — appointments + sous-tables (notes/tasks/attendees/business_context)

### Catalogues

- **Officiels** : `type='official'`, `user_id=null`, visibles par tous — `slug='doterra'` (128 produits)
- **Custom** : `type='custom'`, `user_id=auth.uid()`

Pour ajouter une marque : `INSERT INTO catalogs` + `INSERT INTO catalog_products` — zéro changement de code. `CatalogProductPicker` charge dynamiquement depuis la DB.

---

## i18n

- Langue canonique : **EN** (source de vérité)
- Fallback : `en`
- Fichiers : `shared/i18n/locales/en.json` + `fr.json`
- Toujours ajouter une clé en EN **et** FR simultanément
- Aucun texte UI hardcodé — toujours `t('...')`
- Dates : `const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'`

---

## Déploiement

Le webhook GitHub→Vercel est **actif** (réparé le 2026-07-24 via `vercel git connect` après déconnexion/reconnexion). Chaque push sur `main` déclenche automatiquement un déploiement en production — plus besoin de lancer `vercel --prod` manuellement :

```bash
git add <fichiers>
git commit -m "message"
git push origin main
```

Déploiement manuel toujours possible si besoin (ex: tester avant de push) : `npx vercel --prod`.

Build Vercel : `npx expo export --platform web` → dossier `dist/`.

---

## Conventions de code

- Pas de `Alert.alert` sur web — toujours `errorMsg` state inline
- Pas de `console.log` — uniquement `console.error` dans les `catch`
- Pas de mock — toujours les vraies données Supabase
- Pas de commentaires sauf logique non-évidente
- Pas de couleurs hardcodées dans les composants (`useTheme()` obligatoire)
- Pas de textes hardcodés (`t('...')` obligatoire)
- Hooks : `use[Resource].ts` dans `features/[resource]/`
- Services : `[resource]Service.ts` dans `features/[resource]/`
- Composants UI partagés : uniquement dans `shared/components/ui/`
- Scripts Node.js utilitaires (pngjs, etc.) : supprimer après usage, ne pas commiter
- **PowerShell + BOM** : ne jamais piper des strings vers des processus natifs. Toujours Node.js API pour écrire des fichiers ou appeler des APIs externes.

### Flux obligatoire

```
UI screen → Hook métier → Service métier → Supabase → PostgreSQL + RLS
```

Aucune logique métier dans les composants UI.

---

## État du projet

### Phase 1 ✅ Terminée

Clients, RDV, Notes, Relances, Recommandations, Module doTERRA, Dashboard KPI, Sidebar responsive web, Bottom tab bar mobile custom, i18n EN/FR, Architecture catalogues DB, Mode démo, Paramètres profil, Dark mode, Design system premium (Inter + palette Linear/Stripe/Vercel), Mobile header dark navy + gradient wordmark.

### Phase 2 — Monétisation

⚠️ Section revérifiée le 2026-08-16 — la plupart de ces items étaient cochés `[ ]` alors qu'ils sont livrés.

- [x] Stripe abonnements (Free / Pro 29€ / Cabinet 79€) — `features/subscriptions/subscriptionService.ts`
- [x] Webhook Stripe → table `subscriptions` — `supabase/functions/stripe-webhook/`, `create-checkout-session/`, `create-billing-portal/`, `revenuecat-webhook/` (Edge Functions, non listées ailleurs dans ce doc — voir Architecture dossiers)
- [x] Gates fonctionnalités selon plan — `features/subscriptions/AdvisorGate.tsx` + `useEntitlements.ts`
- [ ] Landing page oryalis.app — pas trouvée dans ce repo
- [x] Onboarding guidé — `app/(auth)/onboarding.tsx` + table `onboarding_events` (nombre d'étapes non revérifié)
- [ ] Emails transactionnels (Resend) — aucune référence trouvée dans le code, pas implémenté
- [x] Paramètres langue + timezone — `app/(app)/settings.tsx` (champs `locale`, `timezone`)

### Phase 3 — Rétention

- [ ] Export PDF fiche client — **`pdfkit` est en devDependency mais 0 référence dans le code** : dépendance orpheline, feature non implémentée
- [ ] Comptabilité (revenus + URSAF) — pas trouvé
- [ ] Facturation PDF — pas trouvé
- [~] Dashboard RGPD + consentements — pas de dashboard dédié, mais `supabase/migrations/20260804_tracking_consent.sql` pose une base (colonne consentement) — travail entamé, pas terminé
- [ ] Résumé IA séance (Claude API) — pas trouvé, aucun SDK Anthropic dans `package.json`

### Phase 4 — Croissance mondiale

- [ ] Module MTC complet (réf. `C:\Users\timjp\development\synoria`)
- [ ] Module Zinzino + seed catalogue
- [ ] Marketplace praticiens
- [ ] App stores iOS + Android
- [ ] ES / DE / PT / AR (RTL pour arabe)
- [ ] White-label associations

### Fonctionnalités livrées hors roadmap ci-dessus (non documentées avant le 2026-08-16)

Du travail conséquent a été fait en dehors de ces 4 phases, sans mise à jour de cette section :
console owner / audit de sécurité (`features/admin`, `features/security`, tables `admin_audit_log`,
`security_login_events`, `support_access_requests`), automatisations de relance J+3/J+7/J+15/J+30
(`features/automations`), réseau MLM / parrainage (`features/network` — **⚠️ cassé en prod**, voir section
Tables), objectifs et alertes commerciales (`features/goals`, `features/alerts`), templates de messages
personnalisables (`features/messages`), analytics produit (`features/analytics`, table `product_events`),
export Excel/JSON, et protocoles bien-être doTERRA/Zinzino (`features/protocols`). À intégrer dans une
prochaine passe de la roadmap plutôt que de les laisser invisibles ici.

---

## Plans tarifaires cibles

| Plan | Prix | Limites |
|---|---|---|
| Free | 0€ | 20 clients, 1 module |
| Pro | 29€/mois | Illimité, tous modules, export, IA |
| Cabinet | 79€/mois | Pro + 5 praticiens + marque blanche |

Stripe sera la source de vérité des droits via table `subscriptions`. `profiles.plan` = cache d'affichage uniquement.

---

## Référence Synoria

`C:\Users\timjp\development\synoria` — App desktop Electron 28 + React 18 + SQLite.  
Référence fonctionnelle pour Phase 3 (comptabilité, facturation, URSAF) et Phase 4 (module MTC, diagnostic énergétique, RGPD).  
Ne pas copier mécaniquement : Oryalis est Expo/Supabase, pas Electron/SQLite.
