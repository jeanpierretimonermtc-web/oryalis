# Oryalis — CLAUDE.md optimisé

## Rôle de ce fichier

Ce fichier est la source de vérité opérationnelle pour Claude Code dans le projet **Oryalis**.

Objectif prioritaire : empêcher les modifications dangereuses, les incohérences d'architecture, les régressions UI, les fuites de secrets et la dette technique.

Claude doit appliquer ce fichier avant toute génération, modification, refactorisation, migration ou ajout de fonctionnalité.

---

# 1. Priorité absolue — Sécurité et secrets

## Règle critique

Aucun secret ne doit jamais apparaître dans le code, les prompts, les commits, les logs ou les exemples.

Interdits absolus :

- mot de passe Supabase
- connection string complète
- clé `service_role`
- token Vercel
- clé Stripe
- clé Resend
- clé Claude/OpenAI
- identifiants email
- secrets hardcodés dans un fichier `.mjs`, `.ts`, `.tsx`, `.sql`, `.md` ou `.json`

## Variables d'environnement obligatoires

Utiliser uniquement :

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_DB_HOST=
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=
SUPABASE_DB_PASSWORD=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
```

## Pattern obligatoire pour migrations Node.js + pg

```js
import pg from 'pg'

const { Client } = pg

const requiredEnv = [
  'SUPABASE_DB_HOST',
  'SUPABASE_DB_PORT',
  'SUPABASE_DB_NAME',
  'SUPABASE_DB_USER',
  'SUPABASE_DB_PASSWORD',
]

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`)
  }
}

const client = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

try {
  // queries here
} finally {
  await client.end()
}
```

## Frontend

Dans l'application Expo / React Native, seules les clés publiques nécessaires au client peuvent être utilisées.

Interdits côté frontend :

- `service_role`
- mot de passe DB
- Stripe secret key
- webhook secret
- secrets d'API serveur

---

# 2. Architecture immuable

## Architecture logique obligatoire

Flux unique :

```text
UI screen / component
↓
Hook métier
↓
Service métier
↓
Supabase client
↓
PostgreSQL + RLS
```

Aucune logique métier lourde dans les composants UI.

## Interdictions structurelles

Claude ne doit jamais :

- créer une nouvelle table sans demande explicite
- modifier une table existante sans migration SQL dédiée
- contourner RLS
- désactiver RLS
- créer une seconde architecture parallèle
- dupliquer un service existant
- déplacer massivement les dossiers sans demande explicite
- réécrire un fichier entier si une modification ciblée suffit
- ajouter un package sans justification technique
- créer du mock si une donnée Supabase existe
- hardcoder du français ou de l'anglais dans les composants UI
- casser le dark mode
- casser le responsive web/mobile
- modifier les clés i18n existantes sans migration contrôlée

## Architecture dossiers

```text
app/                         Routes Expo Router
  _layout.tsx                Root layout
  reset-password.tsx         Route publique reset password
  (auth)/                    Login / register
  (app)/                     Application authentifiée
    index.tsx                Dashboard
    settings.tsx             Paramètres
    catalog/                 Catalogue produits
    clients/                 Clients + fiche client
    appointments/            Agenda
    followups/               Relances

features/                    Logique métier par domaine
  auth/
  clients/
  appointments/
  notes/
  followups/
  recommendations/
  dashboard/
  catalogs/
  demo/
  modules/

shared/                      Socle commun
  lib/                       Supabase + types
  i18n/                      Traductions
  theme/                     Design system
  components/ui/             UI générique uniquement

assets/                      Logos, icônes, splash, wordmarks
supabase/migrations/         SQL de référence
migrate*.mjs                 Migrations Node.js + pg
```

## Règle de séparation

- `app/` : navigation + composition d'écran
- `features/` : logique métier
- `shared/components/ui/` : composants neutres réutilisables
- `shared/lib/` : configuration technique et types
- `shared/theme/` : design system
- `shared/i18n/` : traduction uniquement

---

# 3. Definition of Done

Une tâche n'est terminée que si tous les points applicables sont validés.

## Fonctionnalité frontend

- TypeScript propre
- aucun `any` inutile
- aucun `console.log`
- erreurs affichées inline, pas `Alert.alert` sur web
- loading state présent si appel réseau
- empty state présent si liste vide
- dark mode vérifié
- responsive web/mobile vérifié
- composants UI existants réutilisés
- `useTheme()` utilisé pour toutes les couleurs dynamiques
- `fonts.*` utilisé pour la typographie
- styles via `makeStyles(colors)` + `useMemo`
- textes via `t('...')`
- clés i18n ajoutées en EN + FR

## Fonctionnalité Supabase

- service dédié dans `features/[resource]/[resource]Service.ts`
- hook dédié dans `features/[resource]/use[Resource].ts`
- RLS respecté
- `user_id = auth.uid()` appliqué quand nécessaire
- colonnes sélectionnées explicitement
- pagination prévue si volume potentiellement élevé
- erreurs Supabase traitées proprement
- aucune clé serveur dans le frontend

## Migration DB

- migration `.mjs` ou `.sql` dédiée
- idempotence si possible (`IF NOT EXISTS`, `ON CONFLICT`, vérifications)
- RLS activé sur toute nouvelle table utilisateur
- policies créées avec `USING` et `WITH CHECK`
- indexes ajoutés sur colonnes filtrées ou jointes
- rollback mentalement vérifiable
- pas de données destructives sans demande explicite

## Design

- cohérence avec palette Oryalis
- pas de couleurs hardcodées si elles relèvent du thème
- border-radius conforme
- lisibilité texte/fond respectée
- CTA principal clairement identifiable
- pas de surcharge visuelle
- cohérence light/dark

---

# 4. Sécurité applicative

## Authentification

- Toute donnée utilisateur doit être rattachée à `user_id`.
- Toute requête utilisateur doit être filtrée par l'utilisateur connecté via RLS ou condition explicite.
- Aucun écran privé ne doit être accessible hors session.

## RLS

Toutes les tables contenant des données utilisateur doivent avoir RLS activé.

Pattern standard :

```sql
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id)
```

Exception autorisée : catalogues officiels publics.

```sql
user_id IS NULL AND type = 'official'
```

## Données sensibles praticiens / clients

Oryalis manipule potentiellement des informations personnelles et des données de suivi client.

Claude doit éviter :

- affichage de données d'un autre utilisateur
- export non contrôlé
- logs contenant des informations client
- duplication inutile de données personnelles
- stockage local non nécessaire d'informations sensibles

## RGPD — principe minimal

Toute fonctionnalité liée aux clients doit respecter :

- minimisation des données
- finalité claire
- possibilité future d'export
- possibilité future de suppression
- traçabilité raisonnable
- pas de collecte inutile

---

# 5. Instructions IA obligatoires

Avant toute modification, Claude doit :

1. Lire les fichiers concernés.
2. Identifier les patterns existants.
3. Réutiliser les services, hooks et composants disponibles.
4. Modifier le minimum de fichiers nécessaire.
5. Expliquer brièvement les risques si la demande peut casser l'architecture.
6. Ne jamais inventer une structure si une structure existe déjà.
7. Ne jamais ajouter une dépendance sans vérifier si le projet peut faire sans.
8. Ne jamais exposer ou recopier un secret.
9. Préserver le dark mode, i18n, RLS et responsive.
10. Fournir une solution directement intégrable.

## Format de réponse attendu de Claude Code

Quand Claude propose une modification, il doit indiquer :

```text
Fichiers modifiés :
- ...

Pourquoi :
- ...

Risques :
- ...

Tests à lancer :
- npm run web
- npx tsc --noEmit si disponible
```

## Refactorisation

Refactoriser uniquement si :

- la duplication est réelle
- le comportement reste identique
- les risques sont faibles
- le gain est clair

Sinon, faire une modification ciblée.

---

# 6. Modularisation documentaire recommandée

Ce fichier doit rester court et décisionnel.

Si le projet grossit, créer :

```text
docs/architecture.md
docs/database.md
docs/design-system.md
docs/business-rules.md
docs/roadmap.md
docs/security-rgpd.md
```

## Rôle des fichiers

- `CLAUDE.md` : règles impératives pour l'IA
- `docs/architecture.md` : structure complète du code
- `docs/database.md` : schéma, RLS, indexes, migrations
- `docs/design-system.md` : couleurs, composants, layout
- `docs/business-rules.md` : logique métier CRM, clients, relances, catalogues
- `docs/roadmap.md` : phases produit
- `docs/security-rgpd.md` : sécurité, RGPD, consentements, export, suppression

Claude doit toujours prioriser `CLAUDE.md` en cas de contradiction.

---

# Stack réelle du projet

Selon `package.json` actuel :

```json
{
  "expo": "~56.0.8",
  "expo-router": "~56.2.8",
  "react": "19.2.3",
  "react-native": "0.85.3",
  "react-native-web": "^0.21.2",
  "@supabase/supabase-js": "^2.107.0",
  "i18next": "^24.2.3",
  "react-i18next": "^15.7.4",
  "typescript": "~6.0.3",
  "pg": "^8.21.0",
  "pdfkit": "^0.19.1"
}
```

Scripts disponibles :

```bash
npm run start
npm run android
npm run ios
npm run web
```

Le projet ne contient pas actuellement de script officiel `build`, `lint`, `typecheck` ou `test` dans `package.json`.

Ne pas inventer ces scripts dans les réponses. Si nécessaire, proposer explicitement de les ajouter.

---

# Produit

Oryalis est un CRM SaaS multiplateforme iOS / Android / Web destiné aux praticiens du bien-être :

- naturopathes
- thérapeutes MTC
- kinésiologues
- coachs
- praticiens bien-être
- distributeurs / conseillers DoTerra, Zinzino ou catalogues similaires

Objectif : centraliser clients, rendez-vous, notes, relances, recommandations produits, catalogue, facturation future, export PDF futur, conformité RGPD future.

---

# Design system

## Règle thème absolue

Ne jamais importer une palette statique dans un composant React pour styler l'interface.

Correct :

```tsx
const { colors, statusColors, mode } = useTheme()
const styles = useMemo(() => makeStyles(colors), [colors])
```

Interdit :

```tsx
import { lightColors as colors } from '@/shared/theme/colors'
```

## Pattern standard

```tsx
import { useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

export function ComponentName() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return null
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.bg,
    },
  })
}
```

## Tokens principaux

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
| `primaryAction` | `#1D4ED8` | `#2563EB` |
| `primaryLight` | `#DBEAFE` | `#1E3A5F` |

Accents :

- `secondary`: `#22D3EE`
- `tertiary`: `#6D3BFF` light / `#8B5CF6` dark
- `success`: `#10B981`
- `warning`: `#F59E0B`
- `danger`: `#EF4444`

Gradient officiel :

```ts
['#22D3EE', '#3B82F6', '#6D3BFF']
```

## Typographie

Utiliser uniquement :

```ts
fonts.display
fonts.body
fonts.medium
fonts.semibold
fonts.bold
```

Ne pas hardcoder `fontWeight` sauf cas exceptionnel justifié.

## Border radius

| Composant | Radius |
|---|---:|
| Button md | 12 |
| Button sm | 10 |
| Card | 16 |
| Input / TextArea | 12 |
| StatusBadge | 8 |

---

# Base de données actuelle

Tables connues :

```text
profiles
clients
appointments
notes
followups
recommendations
catalogs
catalog_products
```

## Catalogues

Les catalogues officiels sont globaux :

- `type = 'official'`
- `user_id IS NULL`
- visibles par tous

Les catalogues personnalisés sont propres au praticien :

- `type = 'custom'`
- `user_id = auth.uid()`

Pour ajouter une nouvelle marque, préférer une insertion DB plutôt qu'un changement de code.

---

# i18n

- Langue canonique : EN
- Fallback : EN
- Traductions : `shared/i18n/locales/en.json` et `fr.json`
- Toute clé ajoutée doit être ajoutée en EN et FR simultanément
- Aucun texte métier ou UI ne doit être hardcodé dans un composant

Dates :

```ts
const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
```

---

# Déploiement

Déploiement web manuel :

```bash
git add .
git commit -m "message"
git push origin main
npx vercel --prod
```

Le build Vercel utilise Expo Web export vers `dist/`.

Ne pas supposer qu'un webhook GitHub → Vercel est actif.

---

# Roadmap produit

## Phase 1 — réalisée

- Clients
- Rendez-vous
- Notes
- Relances
- Recommandations
- Catalogue DoTerra
- Dashboard KPI
- Agenda jour / semaine
- Mode démo
- Paramètres profil
- Dark mode
- Sidebar responsive web
- i18n EN/FR
- Design system premium

## Phase 2 — monétisation

- Stripe abonnements
- Table `subscriptions`
- Webhook Stripe
- Free / Pro / Cabinet
- Limite Free : 20 clients
- Landing page
- Onboarding guidé
- Emails transactionnels
- Paramètres langue + timezone

## Phase 3 — rétention

- Export PDF fiche client
- Comptabilité
- Facturation PDF
- Dashboard RGPD
- Consentements
- Résumé IA séance

## Phase 4 — croissance

- Module MTC complet
- Module Zinzino
- Marketplace praticiens
- App Store / Play Store
- ES / DE / PT / AR
- RTL pour arabe
- White-label

---

# Stripe — règle d'architecture future

Quand Stripe sera ajouté, la source de vérité des abonnements devra être une table dédiée :

```text
subscriptions
```

Ne pas utiliser `profiles.plan` comme source de vérité définitive pour les droits payants.

`profiles.plan` peut être un cache d'affichage, mais les gates produit doivent se baser sur :

- `subscriptions.status`
- `subscriptions.price_id`
- `subscriptions.current_period_end`
- `subscriptions.user_id`

Webhook Stripe côté serveur uniquement.

---

# Performance

Claude doit respecter ces règles :

- pas de requête Supabase dans un render
- pas de `useEffect` inutile
- pas de boucle qui déclenche des requêtes multiples non contrôlées
- pagination au-delà de 100 lignes potentielles
- colonnes sélectionnées explicitement
- indexes sur colonnes filtrées : `user_id`, `client_id`, `due_date`, `appointment_date`, `catalog_id`, `status`
- éviter les re-renders inutiles via `useMemo` / `useCallback` seulement quand utile
- ne pas optimiser prématurément au détriment de la lisibilité

---

# Conventions de code

- Pas de `Alert.alert` sur web
- Pas de `console.log` en production
- `console.error` accepté uniquement dans les `catch`
- Pas de mock si une vraie donnée Supabase existe
- Pas de commentaires sauf logique non évidente
- Pas de dépendance ajoutée sans justification
- Pas de couleurs hardcodées dans les composants
- Pas de textes hardcodés dans les composants
- Pas de duplication service/hook
- Pas de fichiers utilitaires temporaires commités

## PowerShell

Éviter de piper des chaînes vers des processus natifs via PowerShell à cause des risques BOM/encodage.

Préférer Node.js pour écrire des fichiers ou appeler des APIs externes.

---

# Référence Synoria

Le projet Synoria desktop peut servir de référence fonctionnelle pour :

- comptabilité
- facturation
- logique URSAF
- module MTC
- formulaires séance
- diagnostic énergétique
- consentements RGPD

Mais il ne doit pas être copié mécaniquement : Oryalis est un SaaS Expo / Supabase, pas une app Electron / SQLite.
