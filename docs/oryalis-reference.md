# Oryalis — Référence Routes / DB / Enums (état réel au 2026-07-26)

> Généré par introspection directe : fichiers `app/` (Expo Router) + requêtes SQL live sur Supabase (`information_schema.columns`, `pg_enum`, `pg_constraint`). Pas de capture d'écran incluse — voir note en bas.

---

## 1. Routes → fichiers

### Auth (`app/(auth)/`)
| Route | Fichier |
|---|---|
| `/` (redirect) | `app/(auth)/index.tsx` |
| `/login` | `app/(auth)/login.tsx` |
| `/register` | `app/(auth)/register.tsx` |
| `/onboarding` | `app/(auth)/onboarding.tsx` |
| `/reset-password` | `app/reset-password.tsx` (hors groupe, route publique) |

### App principal (`app/(app)/`)
| Route | Fichier |
|---|---|
| `/` (Dashboard) | `app/(app)/index.tsx` |
| `/clients` | `app/(app)/clients/index.tsx` |
| `/clients/new` | `app/(app)/clients/new.tsx` |
| `/clients/archived` | `app/(app)/clients/archived.tsx` |
| `/clients/:id` (fiche) | `app/(app)/clients/[id]/index.tsx` |
| `/clients/:id/edit` | `app/(app)/clients/[id]/edit.tsx` |
| `/clients/:id/appointments` | `app/(app)/clients/[id]/appointments.tsx` |
| `/clients/:id/followups` | `app/(app)/clients/[id]/followups.tsx` |
| `/clients/:id/recommendations` | `app/(app)/clients/[id]/recommendations.tsx` |
| `/clients/:id/interactions` | `app/(app)/clients/[id]/interactions.tsx` |
| `/clients/:id/orders` | `app/(app)/clients/[id]/orders.tsx` |
| `/clients/:id/team` | `app/(app)/clients/[id]/team.tsx` |
| `/appointments` (Agenda) | `app/(app)/appointments/index.tsx` |
| `/appointments/new` | `app/(app)/appointments/new.tsx` |
| `/appointments/:id` (détail) | `app/(app)/appointments/[id]/index.tsx` |
| `/followups` | `app/(app)/followups/index.tsx` |
| `/catalog` | `app/(app)/catalog/index.tsx` |
| `/catalog/protocols` | `app/(app)/catalog/protocols.tsx` |
| `/network` | `app/(app)/network/index.tsx` |
| `/network/upline` | `app/(app)/network/upline.tsx` |
| `/orders` | `app/(app)/orders/index.tsx` |
| `/goals` | `app/(app)/goals.tsx` |
| `/export` | `app/(app)/export.tsx` |
| `/import` | `app/(app)/import.tsx` |
| `/settings` (hub) | `app/(app)/settings.tsx` |
| `/settings-profile` | `app/(app)/settings-profile.tsx` |
| `/settings-identity` | `app/(app)/settings-identity.tsx` |
| `/settings-contact` | `app/(app)/settings-contact.tsx` |
| `/settings-org` | `app/(app)/settings-org.tsx` |
| `/settings-crm` | `app/(app)/settings-crm.tsx` |
| `/settings-display` | `app/(app)/settings-display.tsx` |
| `/settings-language` | `app/(app)/settings-language.tsx` |
| `/settings-modules` | `app/(app)/settings-modules.tsx` |
| `/settings-labels` | `app/(app)/settings-labels.tsx` |
| `/settings-automations` | `app/(app)/settings-automations.tsx` |
| `/settings-catalogs` | `app/(app)/settings-catalogs.tsx` |
| `/settings-integrations` | `app/(app)/settings-integrations.tsx` |
| `/settings-google` | `app/(app)/settings-google.tsx` |
| `/settings-activity` | `app/(app)/settings-activity.tsx` |
| `/settings-subscription` | `app/(app)/settings-subscription.tsx` |
| `/settings-owner` | `app/(app)/settings-owner.tsx` |
| `/settings-support-access` | `app/(app)/settings-support-access.tsx` |

Layouts (navigateurs, pas des écrans) : `app/_layout.tsx`, `app/(auth)/_layout.tsx`, `app/(app)/_layout.tsx` (sidebar web / bottom-tabs mobile), `app/(app)/clients/_layout.tsx`, `app/(app)/appointments/_layout.tsx`, `app/(app)/followups/_layout.tsx`.

---

## 2. Structure exacte des tables (requête live sur Postgres)

### `clients` (44 colonnes)
| Colonne | Type | Null | Défaut |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | — |
| full_name | text | NO | — |
| first_name | text | YES | — |
| phone | text | YES | — |
| email | text | YES | — |
| status | text | YES | `'prospect'` |
| source | text | YES | — |
| language | text | YES | `'fr'` |
| birth_date | date | YES | — |
| inscription_date | date | YES | `CURRENT_DATE` |
| profession | text | YES | — |
| children | text | YES | — |
| interests | text[] | YES | `'{}'` |
| client_type | text | YES | — |
| medical_treatment | boolean | YES | `false` |
| medical_notes | text | YES | — |
| particularities | text | YES | — |
| welcome_email_sent | boolean | YES | `false` |
| doterra_id | text | YES | — |
| next_lrp_date | date | YES | — |
| address | text | YES | — |
| loyalty_notes | text | YES | — |
| country | text | YES | — |
| first_contact_date | date | YES | — |
| first_purchase_date | date | YES | — |
| acquisition_source | text | YES | — |
| journey_stage | text | YES | — |
| next_action_date | date | YES | — |
| next_action_type | text | YES | — |
| next_action_at | timestamptz | YES | — |
| next_action_source | text | YES | — (CHECK: `appointment`\|`interaction`\|`followup`) |
| next_action_source_id | uuid | YES | — |
| last_interaction_at | timestamptz | YES | — |
| referrals_count | integer | NO | `0` |
| referral_count | integer | NO | `0` |
| network_potential | text | YES | — |
| sponsor_id | uuid | YES | — |
| contact_role | text | NO | `'customer'` |
| pipeline_stage | text | NO | `'new_lead'` (CHECK, 8 valeurs — voir §3) |
| pipeline_stage_updated_at | timestamptz | YES | — |
| archived_at | timestamptz | YES | — |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

⚠️ **`referrals_count` et `referral_count` coexistent** — deux colonnes quasi-identiques (faute de frappe historique jamais nettoyée), à vérifier laquelle est réellement utilisée côté code avant d'y toucher.

### `appointments` (21 colonnes) — **⚠️ voir incohérence majeure en §4**
| Colonne | Type | Null | Défaut |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | — |
| client_id | uuid | YES | — |
| title | text | NO | — |
| appointment_type | enum `appointment_type_enum` | NO | `'other'` |
| status | enum `appointment_status_enum` | NO | `'scheduled'` |
| start_at | timestamptz | NO | — |
| end_at | timestamptz | NO | — |
| duration_minutes | integer | YES | — |
| timezone | text | NO | `'Europe/Paris'` |
| location | text | YES | — |
| meeting_url | text | YES | — |
| provider | text | NO | `'oryalis'` |
| external_calendar_id | text | YES | — |
| external_event_id | text | YES | — |
| last_synced_at | timestamptz | YES | — |
| sync_status | text | YES | — |
| cancelled_at | timestamptz | YES | — |
| cancellation_reason | text | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

Tables satellites liées à un RDV :
- **`appointment_notes`** (9 col.) : `id, appointment_id, client_notes, internal_notes, objections, needs_identified, products_discussed, created_at, updated_at`
- **`appointment_tasks`** (12 col.) : `id, appointment_id, user_id, client_id, title, task_type (enum), priority (enum), status (enum), due_at, completed_at, created_at, updated_at`
- **`appointment_business_context`** (12 col.) : `id, appointment_id, brand_id, catalog_id, main_product_id, pipeline_stage (enum), prospect_temperature (enum), commercial_intent (enum), estimated_value, currency, created_at, updated_at`

### `notes` (5 colonnes — table simple, notes libres hors RDV)
| Colonne | Type | Null | Défaut |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| client_id | uuid | NO | — |
| user_id | uuid | NO | — |
| content | text | NO | — |
| created_at | timestamptz | YES | `now()` |

### `followups` (15 colonnes)
| Colonne | Type | Null | Défaut |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| client_id | uuid | NO | — |
| user_id | uuid | NO | — |
| title | text | NO | — |
| content | text | YES | — |
| due_date | date | YES | — |
| done | boolean | YES | `false` |
| action_type | text | YES | — |
| prospect_temperature | text | YES | — |
| pipeline_stage | text | YES | — |
| product_context | text | YES | — |
| auto_generated | boolean | NO | `false` |
| priority_score | integer | YES | — |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

---

## 3. Statuts, types de RDV, pipelines — valeurs actuelles

### `ClientStatus` (9 valeurs, CHECK constraint sur `clients.status`)
`prospect` · `new_client` · `active` · `loyal` · `vip` · `advisor` · `team_member` · `inactive` · `lost`

### `ContactRole` (6 valeurs — **pas de CHECK constraint en DB**, validé seulement côté app)
`prospect` · `customer` · `distributor` · `leader` · `team_member` · `inactive`

### `AppointmentType` (11 valeurs, enum Postgres `appointment_type_enum`)
`discovery_call` · `product_presentation` · `follow_up` · `closing_call` · `customer_support` · `team_training` · `team_meeting` · `webinar` · `onboarding` · `business_review` · `other`

### `AppointmentStatus` (5 valeurs, enum Postgres `appointment_status_enum`)
`scheduled` · `completed` · `cancelled` · `no_show` · `rescheduled`

### Pipeline — **⚠️ deux définitions différentes qui ne concordent pas**
- **Enum Postgres `pipeline_stage_enum`** (utilisé par `appointment_business_context.pipeline_stage`, 10 valeurs) :
  `new_lead` · `contacted` · `presentation_scheduled` · `presentation_completed` · `follow_up` · **`proposal_sent`** · `customer` · `distributor` · **`inactive`** · `lost`
- **CHECK constraint sur `clients.pipeline_stage`** (8 valeurs seulement) :
  `new_lead` · `contacted` · `presentation_scheduled` · `presentation_completed` · `follow_up` · `customer` · `distributor` · `lost`
  → **`proposal_sent` et `inactive` sont acceptés au niveau du RDV mais rejetés au niveau du client.** Le code app (`PIPELINE_STAGES` dans `shared/lib/types.ts`) ne propose d'ailleurs que les 8 valeurs restreintes — les 2 valeurs en trop de l'enum ne sont utilisables nulle part dans l'UI actuelle.

### `ProspectTemperature` (4 valeurs)
`cold` · `warm` · `hot` · `very_hot`

### `CommercialIntent` (7 valeurs)
`buy_product` · `become_customer` · `become_distributor` · `build_team` · `training` · `support` · `other`

### `TaskType` (11 valeurs, tâches liées à un RDV)
`follow_up` · `send_catalog` · `send_price_list` · `send_sample` · `invite_to_webinar` · `invite_to_training` · `send_payment_link` · `customer_checkin` · `team_followup` · `ask_referral` · `other`

### `TaskPriority` / `TaskStatus`
Priorité : `low` · `medium` · `high` · `urgent`
Statut : `pending` · `in_progress` · `done` · `cancelled`

### `OrderStatus` (table `orders`, pour référence)
`pending` · `ordered` · `delivered` · `cancelled` · `returned`

---

## 4. Incohérence majeure détectée : deux définitions de "Appointment" dans le code TypeScript

- **`shared/lib/types.ts`** définit une interface `Appointment` **obsolète** qui ne correspond plus du tout à la vraie table :
  `id, client_id, user_id, appointment_number, appointment_date, themes_discussed, solutions_proposed, recap_sent, next_appointment_date, native_event_id, created_at, updated_at`
  → **Aucune de ces colonnes n'existe dans la vraie table `appointments`** (sauf id/client_id/user_id/created_at/updated_at). C'est un résidu d'une ancienne version du schéma, jamais nettoyé.
- **`features/appointments/appointmentTypes.ts`** définit la **vraie** interface `Appointment`, qui correspond exactement à la table actuelle (`title, appointment_type, status, start_at, end_at, duration_minutes, timezone, location, meeting_url, provider, cancelled_at, cancellation_reason...`).
- Le type `AppointmentWithClient` dans `shared/lib/types.ts` étend donc la version **obsolète** — s'il est encore importé quelque part, c'est un risque de confusion/bug silencieux à vérifier.

---

## 5. Table `interactions` (17 colonnes)

Journal des interactions manuelles hors RDV (appel, WhatsApp, SMS, email, visio, atelier...), avec champs IA préparés mais non branchés dans l'UI actuelle (`ai_summary`, `ai_next_actions`, `ai_followup_draft` — tous nullable, jamais écrits par le code aujourd'hui).

| Colonne | Type | Null | Défaut |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | — |
| client_id | uuid | NO | — (FK → `clients.id`, ON DELETE CASCADE) |
| interaction_type | text | NO | — (valeurs app : voir `InteractionType` §7, **pas d'enum Postgres ni de CHECK constraint** — texte libre côté DB) |
| scheduled_at | timestamptz | YES | — |
| completed_at | timestamptz | YES | — |
| subject | text | YES | — |
| summary | text | YES | — |
| needs_identified | text | YES | — |
| objections | text | YES | — |
| interest_level | text | YES | — (valeurs app : `InterestLevel`, pas de CHECK) |
| notes_brutes | text | YES | — |
| ai_summary | text | YES | — |
| ai_next_actions | text | YES | — |
| ai_followup_draft | text | YES | — |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | YES | — |

### Tables satellites RDV (rappel + FK)
| Table | FK | ON DELETE |
|---|---|---|
| `appointment_notes.appointment_id` | → `appointments.id` | CASCADE |
| `appointment_business_context.appointment_id` | → `appointments.id` | CASCADE |
| `appointment_business_context.brand_id` / `catalog_id` | → `catalogs.id` | SET NULL |
| `appointment_business_context.main_product_id` | → `catalog_products.id` | SET NULL |
| `appointment_tasks.appointment_id` | → `appointments.id` | SET NULL (une tâche peut survivre à la suppression du RDV) |
| `appointment_tasks.client_id` | → `clients.id` | SET NULL |

Colonnes détaillées de `appointment_notes` / `appointment_tasks` / `appointment_business_context` : voir §2 (déjà documentées, structure inchangée).

---

## 6. Hooks et services réellement utilisés par les écrans

| Écran (fichier) | Hooks (`use*`) | Services (fonctions appelées) |
|---|---|---|
| `clients/[id]/index.tsx` (fiche client) | `useClient`, `useClientAppointments`, `useNotes`, `useClientFollowups`, `useRecommendations`, `useClientInteractions`, `useClientOrders`, `useDirectTeam`, `useAppConfig` | `computeProspectScore`, `callContact`, `completeNextAction`, `openWhatsApp`, `postponeNextAction` (toutes dans `nextActionService.ts`), `createNote`, `deleteNote` (notes libres fusionnées dans l'onglet Activité) |
| `clients/index.tsx` (liste) | `useClients`, `useClientSearch`, `useLastRdvMap`, `useContactQuota`, `useAppConfig` | `archiveClient`, `computeProspectScore`, `deleteClient` |
| `clients/new.tsx` | `useContactQuota`, `useAppConfig` | `createClient`, `isContactQuotaError` |
| `clients/[id]/edit.tsx` | `useClient`, `useAppConfig` | `updateClient`, `deleteClient` |
| `clients/[id]/followups.tsx` | `useClientFollowups`, `useClient` (+ requêtes directes `appointment_tasks`/`interactions` côté écran pour la fusion) | `createFollowup`, `toggleFollowupDone`, `deleteFollowup`, `completeTask`, `deleteTask` (ces 2 dernières viennent de `appointmentService.ts`, pas de `followupService.ts`) |
| `clients/[id]/interactions.tsx` | `useClientInteractions` | `createInteraction`, `markInteractionDone`, `deleteInteraction` |
| `clients/[id]/appointments.tsx` | `useClientAppointments` | `deleteAppointment` |
| `clients/[id]/orders.tsx` | `useClientOrders` | `updateOrderStatus` |
| `clients/[id]/recommendations.tsx` | `useRecommendations` | `createRecommendation`, `updateRecommendationStatus`, `deleteRecommendation` |
| `clients/[id]/team.tsx` | `useDirectTeam` | — |
| `appointments/index.tsx` (Agenda) | `useAppointments`(via écran), `useGoogleCalendar` | `fetchAllNativeEvents` (`calendarSyncService.ts`) |
| `appointments/new.tsx` | — | `createAppointment`, `updateAppointment`, `fetchAppointmentById` |
| `appointments/[id]/index.tsx` (détail) | `useAppointmentDetail` (expose `appointment`, `saveNotes`, `saveBusinessContext`, `addTask`, `doneTask`, `removeTask`, `update`, `cancel`) | (tout passe par le hook, qui appelle en interne `appointmentService.ts`) |
| `followups/index.tsx` (globale) | `usePendingFollowups`, `useFollowupBadge` | `toggleFollowupDone`, `computeFollowupPriority` |
| `index.tsx` (Dashboard) | `useDashboard` (KPIs/relances/agenda du jour), `useGoals`, `useAppConfig`, `useUpcomingAppointments`, `usePendingFollowups`, `useDemoState` | — |

Détail des hooks-clés (fichiers, exports) :
- `features/appointments/useAppointments.ts` → `useAppointments`, `useAppointmentDetail`, `useAppointmentTasks`, `useUpcomingAppointments`, `useClientAppointments`, `useLastRdvMap`
- `features/notes/useNotes.ts` → `useNotes` (une seule fonction — la fusion avec `appointment_notes` visible dans `notes.tsx` est faite **dans l'écran**, pas dans le hook)
- `features/followups/useFollowups.ts` → `useClientFollowups`, `usePendingFollowups`
- `features/interactions/useInteractions.ts` → `useClientInteractions`, `useUpcomingInteractions`
- `features/clients/useClient.ts` → `useClient` (singulier, fiche)
- `features/clients/useClients.ts` → `useClients`, `useClientSearch` (liste/recherche)

⚠️ **Point d'architecture à noter pour la spec** : la fusion multi-tables (`notes.tsx` fusionne `notes` + `appointment_notes` ; `followups.tsx` fusionne `followups` + `appointment_tasks` + `interactions` à venir) est câblée **directement dans le composant écran**, pas dans le hook ni le service. Une vraie réécriture devrait remonter cette logique dans un hook/service dédié (ex. `useClientTimeline(clientId)`) pour être réutilisable et testable.

---

## 7. Règles précises des triggers de "prochaine action"

Il existe **deux mécanismes d'automatisation totalement distincts et indépendants** — c'est la source principale de confusion relevée dans l'app :

### A. Calcul de `clients.next_action_at` / `next_action_source` / `next_action_type` — 100% DB, temps réel

Fonction Postgres `refresh_client_activity(client_id)` (`SECURITY DEFINER`), appelée automatiquement par le trigger `on_contact_event_changed()` posé en `AFTER INSERT/UPDATE/DELETE` sur **`appointments`**, **`interactions`** et **`followups`**. Donc **toute** modification de ces 3 tables (peu importe le chemin : app, script SQL, import direct) recalcule instantanément la prochaine action du client concerné.

**Calcul de `last_interaction_at`** = `MAX` parmi :
- `interactions.completed_at` (non nul)
- `appointments.start_at` où `status = 'completed'`
- `followups.updated_at` (ou `created_at` si null) où `done = true`

**Calcul de la "prochaine action" (`next_action_*`)** = le plus proche dans le temps parmi les événements **non terminés**, avec un ordre de priorité en cas d'égalité de date (`source_order`) :
1. `appointments` où `status IN ('scheduled', 'rescheduled')` → `action_type = 'rdv'`, priorité 1
2. `interactions` où `completed_at IS NULL AND scheduled_at IS NOT NULL` → `action_type` = le type d'interaction si c'est `call`/`whatsapp`/`sms`/`email`/`rdv`, sinon `'rdv'` par défaut, priorité 2
3. `followups` où `done = false` → `action_type = COALESCE(action_type, 'call')`, priorité 3

Tri final : `ORDER BY event_at ASC, source_order ASC` puis `LIMIT 1` → un seul gagnant écrit dans `clients`.

### B. Création automatique de relances (`followups.auto_generated = true`) — 100% applicatif (JS), PAS de trigger DB

Défini dans `features/automations/automationService.ts`, table `AUTOMATION_RULES` :

| Déclencheur | Délai(s) par défaut | Titre généré | `action_type` |
|---|---|---|---|
| `new_client` (appelé depuis `clientService.ts::createClient()`, juste après l'insert) | J+3, J+30 | "Réception produits {prénom}" / "Bilan {prénom} — satisfaction ?" | whatsapp / call |
| `order` (appelé depuis `orderService.ts`, ligne 73, après création commande) | J+3, J+15, J+30 | "Réception commande...", "Retours produits...", "Check {prénom}..." | whatsapp / whatsapp / call |
| `appointment` (RDV complété) | J+7 | "Feedback RDV {prénom} — des questions ?" | whatsapp |
| `no_contact` | 30j sans interaction | "Reprendre contact {prénom}..." | call |

Règles précises :
- Chaque règle est **gate-keepée par le plan d'abonnement** : `getAutomationConfig()` renvoie `{modules: [], delays: {}}` si `profiles.plan` n'est pas dans `['pro','cabinet','advisor','leader','enterprise']` → **aucune automatisation ne tourne en plan Free**.
- Le module doit aussi être actif (`user_business_profiles.active_modules`) — sinon skip silencieux.
- Le délai est personnalisable par utilisateur via `user_business_profiles.automation_delays[rule.id]`, sinon `rule.delayDays` par défaut.
- `insertFollowup()` est **idempotent** : ne crée pas de doublon si une relance auto-générée avec le **même titre exact**, même client, `done=false`, existe déjà — donc un changement de délai ne remplace pas une relance déjà créée avec l'ancien libellé.
- **Point d'incohérence confirmé** : `triggerAppointmentCompleted()` n'est appelé que depuis `appointmentService.ts::updateAppointment()` (dans `triggerPostCompletionActions`, elle-même déclenchée uniquement quand `payload.status === 'completed'` passe par cette fonction). Un `INSERT` direct dans `appointments` avec `status: 'completed'` (ex. les données de démo dans `features/demo/demoService.ts`) **ne déclenche jamais** cette automatisation JS — contrairement au calcul `next_action_at` du point A qui, lui, se déclenche toujours (c'est un trigger DB). **Les deux mécanismes ont donc des garanties différentes.**

### C. Logique supplémentaire de post-complétion RDV (dans `triggerPostCompletionActions`, `appointmentService.ts`)
En plus de l'automatisation générique J+7 (point B), la complétion d'un RDV déclenche :
- Une relance spécifique si `appointment_business_context.commercial_intent = 'buy_product'` → titre "Relance suite RDV — achat produit", due J+3 (seulement si aucune relance auto en cours pour ce client).
- Une relance si `commercial_intent = 'become_distributor'` → "Relance suite RDV — recrutement distributeur", due J+2.
- Une tâche (`appointment_tasks`) si `appointment_notes.objections` est non-vide → "Répondre aux objections détectées", priorité `high`, due J+1 — **créée systématiquement**, peu importe s'il existe déjà une relance auto en cours (contrairement aux 2 règles ci-dessus).

### D. Synchronisation `pipeline_stage` — DB + JS en double (redondance confirmée)
- Trigger DB `sync_client_pipeline_from_followup` (sur `followups`) et `sync_client_pipeline_from_appointment` (sur `appointment_business_context`) : à chaque INSERT/UPDATE, appellent `canonical_pipeline_stage(value)` puis `UPDATE clients SET pipeline_stage = canonical`.
- `canonical_pipeline_stage()` normalise `proposal_sent` → `follow_up` et `inactive` → `lost` (résout l'écart d'enum noté en §3 — mais uniquement pour ce chemin).
- **Mais** `app/(app)/appointments/[id]/index.tsx::handlePipelineChange()` fait **en plus**, manuellement, un second `supabase.from('clients').update({ pipeline_stage: stage })` juste après l'appel à `saveBusinessContext()` — alors que le trigger DB vient de faire exactement la même mise à jour (de façon canonicalisée) suite à l'upsert dans `appointment_business_context`. Écriture redondante entre deux couches, avec un commentaire dans le code ("le statut du client doit refléter...") qui suggère que l'auteur ignorait l'existence du trigger DB.

### E. Autres triggers DB présents (moins critiques, pour info)
- `enforce_free_contact_quota_trigger` (clients, BEFORE INSERT/UPDATE) : bloque la création d'un client actif au-delà de 20 si `profiles.plan = 'free'` (lève `ERRCODE P0001 / CONTACT_QUOTA_REACHED`). Les clients archivés (`archived_at IS NOT NULL`) ne comptent pas dans le quota.
- `touch_client_pipeline_stage_trigger` (clients, BEFORE UPDATE) : met à jour `pipeline_stage_updated_at` dès que `pipeline_stage` change, peu importe la source de l'update.
- `analytics_*_trigger` (clients/appointments/followups/interactions) : alimentent une table d'analytics produit, sans impact fonctionnel CRM.

---

## 8. Types TypeScript actuels (rappel consolidé)

Déjà détaillés en §3-4 de la version précédente de ce document ; résumé des fichiers sources :
- **`shared/lib/types.ts`** : `ClientStatus`, `ContactRole`, `PipelineStage` (+ const `PIPELINE_STAGES`, 8 valeurs), `Client` (interface complète, correspond à la vraie table), `Note`, `Followup`, `ProspectTemperature`, `Interaction`, `NextActionType`, `NextActionSource` — **⚠️ contient aussi une interface `Appointment` obsolète (voir §4), à ne pas utiliser comme référence pour le RDV.**
- **`features/appointments/appointmentTypes.ts`** : la **vraie** source de vérité pour tout ce qui touche aux RDV — `AppointmentType` (11 valeurs), `AppointmentStatus` (5 valeurs), `CommercialIntent` (7 valeurs), `TaskType` (11 valeurs), `TaskPriority`, `TaskStatus`, `Appointment` (vraie forme), `AppointmentNote`, `AppointmentBusinessContext`, `AppointmentTask`, `AppointmentAttendee`, `AppointmentFull` (agrégat retourné par `fetchAppointmentById`), + tous les payloads `Create*`/`Update*`.
- **`features/interactions/`** : pas de fichier `interactionTypes.ts` séparé — `Interaction`, `InteractionType`, `InterestLevel` vivent dans `shared/lib/types.ts` avec le reste.

---

## 9. Routes Expo Router concernées par ce périmètre (RDV / client / notes / relances / interactions)

| Route | Fichier | Rôle |
|---|---|---|
| `/clients/:id` | `app/(app)/clients/[id]/index.tsx` | Fiche client — agrège tout (RDV, notes, relances, interactions, commandes, équipe) |
| `/clients/:id/appointments` | `app/(app)/clients/[id]/appointments.tsx` | Historique + à venir des RDV du client |
| `/clients/:id/followups` | `app/(app)/clients/[id]/followups.tsx` | Relances fusionnées avec `appointment_tasks` + interactions à venir |
| `/clients/:id/interactions` | `app/(app)/clients/[id]/interactions.tsx` | Journal d'interactions manuelles |
| `/appointments` | `app/(app)/appointments/index.tsx` | Agenda global (mois/semaine/jour) |
| `/appointments/new` | `app/(app)/appointments/new.tsx` | Création/édition RDV (mode édition via `?id=`) |
| `/appointments/:id` | `app/(app)/appointments/[id]/index.tsx` | Détail RDV — notes, contexte commercial, tâches, debrief |
| `/followups` | `app/(app)/followups/index.tsx` | Vue globale toutes relances (tous clients) |
| `/` (Dashboard) | `app/(app)/index.tsx` | KPIs + agenda du jour + relances du jour, lit `next_action_*` via `useDashboard` |

---

## Note — captures d'écran

Je n'ai pas de captures réelles à fournir pour l'instant : l'app nécessite une connexion Supabase authentifiée, et je n'ai pas d'identifiants de test. Options possibles :
1. Vous me donnez des identifiants de test/démo → je lance l'app localement et capture chaque écran.
2. Vous ajoutez `localhost` à la liste blanche de redirection Supabase (`additional_redirect_urls`) → je peux régénérer un lien magique valide pour une session locale.
3. Vous me fournissez vos propres captures.
