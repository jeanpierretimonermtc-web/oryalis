# Oryalis — Instructions Claude Code
## Prompts à copier-coller dans l'ordre

---

## 🔴 SPRINT 1 — Fondations MLM

### ÉTAPE 1 — Migration clients (sponsor_id + contact_role)

```
Crée le fichier migrate15.mjs à la racine du projet.
Ce script doit ajouter deux colonnes sur la table clients existante dans Supabase :
- sponsor_id : uuid nullable, FK auto-référentielle vers clients(id)
- contact_role : text, default 'customer'

Valeurs possibles de contact_role : prospect | customer | distributor | leader | team_member | inactive

Utilise le même pattern que les autres migrate*.mjs du projet (Node.js + pg, connexion via SUPABASE_DB_PASSWORD).
Après la migration, mets à jour :
- shared/lib/types.ts : ajouter sponsor_id et contact_role au type Client
- features/clients/clientService.ts : inclure ces deux champs dans les SELECT
NE CODE PAS les écrans pour l'instant.
```

---

### ÉTAPE 2 — Champ contact_role dans les écrans clients

```
Ajoute le champ contact_role dans les écrans clients existants.
Valeurs : prospect | customer | distributor | leader | team_member | inactive
- app/(app)/clients/new.tsx : ajouter un picker contact_role (après le champ status)
- app/(app)/clients/[id]/edit.tsx : idem
- app/(app)/clients/[id]/index.tsx : afficher contact_role comme un badge coloré dans la fiche

Utilise useTheme(), t('...') pour tous les labels, pas de couleurs hardcodées.
Ajoute les clés i18n manquantes dans en.json et fr.json.
```

---

### ÉTAPE 3 — Table orders (historique commercial)

```
Crée le fichier migrate16.mjs à la racine du projet.
Ce script doit créer la table orders dans Supabase avec ce schéma :

orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  catalog_id uuid REFERENCES catalogs(id),
  amount decimal(10,2),
  order_date date NOT NULL,
  order_number text,
  is_lrp boolean DEFAULT false,
  products jsonb,
  status text DEFAULT 'completed',
  notes text,
  created_at timestamptz DEFAULT now()
)

Active RLS avec le pattern standard : USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id).

Après la migration, crée :
- features/orders/orderService.ts : fetchOrders(filters), createOrder, deleteOrder
- features/orders/useOrders.ts : hook useOrders(filters) et useClientOrders(clientId)
- shared/lib/types.ts : ajouter le type Order

Pas d'écrans pour l'instant.
```

---

### ÉTAPE 4 — Écrans orders

```
Crée les deux écrans de gestion des commandes :

1. app/(app)/clients/[id]/orders.tsx
   - Liste des commandes du client (date, montant, badge LRP, produits)
   - Bouton "Ajouter une commande" avec formulaire inline : date, montant, is_lrp, notes
   - Utilise useClientOrders(clientId)

2. app/(app)/orders/index.tsx
   - Vue globale de toutes les commandes
   - Filtre par mois (picker) et par client
   - Total CA du mois affiché en tête

Ajoute l'onglet "Commandes" dans app/(app)/clients/[id]/_layout.tsx.
Ajoute "Commandes" dans la navigation (sidebar web + tab bar mobile si pertinent).
Toutes les clés i18n dans en.json + fr.json. Aucun texte hardcodé.
```

---

### ÉTAPE 5 — Refonte Dashboard prescriptif

```
Refonte complète de app/(app)/index.tsx et features/dashboard/useDashboard.ts.

Le dashboard doit passer de "voici vos données" à "voici quoi faire maintenant".

Structure en 4 zones :

ZONE 1 — Priorités du jour (toujours en haut, fond coloré)
- Nb relances en retard → lien vers followups
- Nb prospects chauds (contact_role prospect + temperature hot/very_hot) sans contact depuis >7j
- Nb LRP dans les 5 prochains jours (next_lrp_date)
- Nb RDV aujourd'hui

ZONE 2 — Opportunités détectées (cartes cliquables)
Calcul côté client au load :
- Prospect oublié : client avec status=prospect sans followup récent depuis >7j
- Client inactif : pas de commande dans orders depuis >45j (si la table orders a des données)
- LRP imminent : next_lrp_date dans <5 jours
Chaque carte affiche le nom du client, la raison, et un bouton d'action direct.

ZONE 3 — KPIs (secondaire, en bas)
- CA du mois en cours (sum orders.amount WHERE order_date ce mois)
- Nb RDV réalisés ce mois
- Nb nouveaux contacts ce mois

Garde le design system actuel (useTheme, fonts, tokens). Toutes clés i18n.
```

---

## 🟠 SPRINT 2 — Relance & Opportunités

### ÉTAPE 6 — Upgrade table followups

```
Crée migrate17.mjs pour ajouter ces colonnes sur la table followups existante :
- prospect_temperature text (cold|warm|hot|very_hot)
- pipeline_stage text
- product_context text
- auto_generated boolean DEFAULT false
- priority_score integer

Mets à jour :
- shared/lib/types.ts : type Followup enrichi
- features/followups/followupService.ts : inclure ces champs dans SELECT et INSERT
- features/followups/useFollowups.ts : pas de changement logique

Pas d'écrans pour l'instant.
```

---

### ÉTAPE 7 — Vue Relances Intelligentes

```
Refonte de app/(app)/followups/index.tsx en "Centre de Relance Intelligent".

Logique du priority_score (calculé côté client) :
- prospect_temperature = 'very_hot' → +40
- due_date < aujourd'hui → +30
- pipeline_stage IN ('follow_up', 'proposal_sent') → +20
- client.status = 'vip' OU contact_role IN ('distributor', 'leader') → +10

Affichage :
- Tri décroissant par priority_score
- Chaque relance affiche : nom client, score (badge coloré), température (emoji ❄🌤🔥), product_context, nb jours depuis création
- Badge rouge "EN RETARD" si due_date dépassée
- Badge "AUTO" si auto_generated = true

Toutes clés i18n. useTheme obligatoire.
```

---

### ÉTAPE 8 — Création automatique de relances post-RDV

```
Dans features/appointments/appointmentService.ts, modifie la fonction updateAppointment.

Quand status passe à 'completed' :
1. Lire le business_context du RDV (commercial_intent, prospect_temperature, pipeline_stage)
2. Lire les appointment_notes (objections)
3. Créer automatiquement dans followups :
   - Si commercial_intent = 'buy_product' → due_date = aujourd'hui + 3j, auto_generated=true, product_context = products_discussed
   - Si commercial_intent = 'become_distributor' → due_date = aujourd'hui + 2j, auto_generated=true
   - Si objections non vides → créer une appointment_task "Répondre aux objections" due dans 1j

Hériter prospect_temperature et pipeline_stage du business_context dans la relance créée.
Ne pas créer de doublon si une relance auto existe déjà pour ce RDV (vérifier via appointment_id dans les notes).
```

---

### ÉTAPE 9 — Table alerts

```
Crée migrate18.mjs pour créer la table alerts :

alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  client_id uuid REFERENCES clients(id),
  message text NOT NULL,
  action_url text,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
)

Types possibles : prospect_forgotten | client_inactive | lrp_due | distributor_dormant | followup_overdue

RLS standard. Crée features/alerts/alertService.ts avec :
- computeAndSaveAlerts() : calcule les alertes selon les 5 règles et insère les nouvelles (sans doublon sur type+client_id du jour)
- markAlertRead(id)
- fetchUnreadAlerts()

Appelle computeAndSaveAlerts() dans useDashboard au montage.
```

---

## 🔵 SPRINT 3 — Réseau & Downline

### ÉTAPE 10 — Service réseau

```
Crée features/network/networkService.ts et features/network/useNetwork.ts.

networkService.ts doit exposer :
- fetchNetworkTree(userId) : récupère tous les clients où sponsor_id forme un arbre à partir de l'utilisateur courant. Utilise une requête récursive ou plusieurs niveaux de JOIN selon ce qui est réalisable avec Supabase JS client.
- fetchDirectDownline(sponsorId) : clients directs d'un sponsor

useNetwork.ts :
- hook useNetworkTree() : retourne tree, loading, error
- hook useDirectTeam(clientId) : retourne les filleuls directs d'un client

Ajoute dans shared/lib/types.ts le type NetworkNode (client + children: NetworkNode[]).
```

---

### ÉTAPE 11 — Écran réseau liste hiérarchique

```
Crée app/(app)/network/index.tsx — vue réseau en liste hiérarchique indentée.

Structure visuelle par niveau :
Niveau 0 : Vous
  Niveau 1 : Sophie Martin [Distributeur] ● Actif
    Niveau 2 : Emma Dupont [Cliente]
    Niveau 2 : Lucas Bernard [Distributeur] ⚠ Inactif

Pour chaque nœud afficher :
- Badge contact_role coloré
- Indicateur activité : vert (contact <15j), orange (15-30j), rouge (>30j) basé sur updated_at du client
- Nombre de filleuls directs si distributeur/leader

Clic sur un nœud → navigue vers app/(app)/clients/[id]/index.tsx.

Ajoute "Réseau" dans la sidebar web et la tab bar mobile.
Toutes clés i18n. useTheme obligatoire.
```

---

### ÉTAPE 12 — Onglet équipe dans fiche client

```
Crée app/(app)/clients/[id]/team.tsx — liste des filleuls directs d'un client.

Utilise useDirectTeam(clientId).
Affiche uniquement si le client a contact_role = 'distributor' ou 'leader'.

Dans app/(app)/clients/[id]/_layout.tsx, ajoute l'onglet "Équipe" conditionnel (visible seulement si contact_role IN distributor, leader).

Ajoute dans useDashboard les métriques réseau :
- Taille totale du réseau (count récursif)
- Nouvelles recrues ce mois (clients avec sponsor_id non null créés ce mois)

Affiche ces métriques dans la Zone 3 du dashboard (conditionnelle si réseau non vide).
```

---

## 🟣 SPRINT 4 — Intelligence IA

### ÉTAPE 13 — Table appointment_ai

```
Crée migrate19.mjs pour créer la table appointment_ai :

appointment_ai (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid UNIQUE NOT NULL REFERENCES appointments(id),
  summary text,
  suggested_actions jsonb,
  follow_up_message text,
  objection_responses jsonb,
  generated_at timestamptz DEFAULT now()
)

RLS standard (via JOIN sur appointments.user_id).

Mets à jour shared/lib/types.ts avec le type AppointmentAI.
Mets à jour features/appointments/appointmentService.ts pour inclure appointment_ai dans fetchAppointmentById.
```

---

### ÉTAPE 14 — Intégration Claude API Haiku post-RDV

```
Crée features/appointments/aiService.ts.

La fonction generateAppointmentSummary(appointment: AppointmentFull) doit :
1. Construire un prompt structuré avec : titre RDV, notes client, objections, besoins identifiés, produits discutés, intent commercial, pipeline_stage, température prospect
2. Appeler Claude Haiku (claude-haiku-4-5-20251001) via fetch sur https://api.anthropic.com/v1/messages avec la clé ANTHROPIC_API_KEY depuis process.env
3. Demander à Claude de retourner un JSON avec : summary (string), suggested_actions (array de {title, task_type, due_in_days}), follow_up_message (string WhatsApp), objection_responses (array de {objection, response})
4. Sauvegarder dans appointment_ai via upsert
5. Créer automatiquement les suggested_actions dans appointment_tasks

Dans app/(app)/appointments/[id]/index.tsx, ajoute :
- Un bouton "Générer résumé IA" visible quand status = 'completed' et pas encore de appointment_ai
- Un affichage du résumé, message de suivi et réponses aux objections une fois généré
- Un état loading pendant la génération

La clé ANTHROPIC_API_KEY doit être lue côté serveur uniquement. Si l'app est Expo (client-side), crée une Supabase Edge Function 'generate-ai-summary' qui fait l'appel Claude et retourne le résultat.
```

---

## 💚 SPRINT 5 — Monétisation

### ÉTAPE 15 — Stripe abonnements

```
Mets en place la monétisation Stripe pour Oryalis.

Plans :
- Free : 0€, limite 20 contacts, pas de réseau ni IA
- Pro : 29€/mois, illimité, tout débloqué
- Leader : 59€/mois, Pro + gestion équipe étendue

Étapes :
1. Crée app/(app)/settings/billing.tsx — page abonnement avec les 3 plans et bouton upgrade
2. Crée une Supabase Edge Function 'create-checkout-session' qui crée une session Stripe Checkout
3. Crée une Supabase Edge Function 'stripe-webhook' qui écoute checkout.session.completed et customer.subscription.* pour mettre à jour profiles.plan
4. Crée shared/hooks/useGate.ts — hook useGate(feature: string): boolean qui lit profiles.plan et retourne true/false
5. Wrape les features Pro avec useGate dans : réseau (network/index.tsx), IA (aiService), détection opportunités avancée

Features gates :
- 'network' → Pro+
- 'ai' → Pro+
- 'alerts_auto' → Pro+
- 'export' → Pro+
```

---

### ÉTAPE 16 — Onboarding guidé

```
Crée le flow onboarding après la première inscription.

3 étapes obligatoires après signup si profiles.onboarding_completed = false :
1. Profil : nom complet, langue, timezone
2. Premier contact : ajouter un contact avec contact_role
3. Premier RDV : créer un RDV avec ce contact

Crée app/(auth)/onboarding.tsx avec un stepper visuel (étapes 1/2/3).
Ajoute onboarding_completed boolean sur la table profiles (migrate20.mjs).
Redirige vers l'onboarding depuis _layout.tsx si onboarding_completed = false.
```

---

## 🩵 SPRINT 6 — Différenciation

### ÉTAPE 17 — Scoring prospects

```
Implémente le scoring automatique des prospects dans features/clients/clientService.ts.

Fonction computeProspectScore(client, followups, appointments) : number (0-100)
Algorithme :
- prospect_temperature = 'very_hot' → +35
- prospect_temperature = 'hot' → +20
- pipeline_stage IN ('follow_up', 'proposal_sent') → +20
- Dernier RDV < 7 jours → +15
- Nb de RDV total > 2 → +10
- contact_role IN ('distributor', 'leader') → +10
- Aucun contact depuis >30j → -20

Affiche le score comme badge coloré (rouge >70, orange 40-70, gris <40) :
- Sur les cartes clients dans app/(app)/clients/index.tsx
- En tête de app/(app)/clients/[id]/index.tsx
```

---

### ÉTAPE 18 — Objectifs personnels

```
Crée migrate21.mjs pour la table goals :

goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period text NOT NULL,  -- format 'YYYY-MM'
  metric text NOT NULL,  -- new_clients | new_distributors | revenue | appointments
  target integer NOT NULL,
  current integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
)

RLS standard.

Crée app/(app)/settings/goals.tsx — formulaire pour définir les objectifs du mois.
Crée features/goals/goalService.ts + useGoals.ts.

Dans useDashboard, calcule current pour chaque objectif du mois en cours.
Affiche une section "Objectifs du mois" sur le dashboard avec barre de progression pour chaque objectif.
```

---

### ÉTAPE 19 — Rapport hebdomadaire automatique

```
Crée une Supabase Edge Function 'weekly-report' avec un cron schedule : tous les lundis à 8h00 (0 8 * * 1).

La fonction doit :
1. Pour chaque utilisateur avec un email vérifié
2. Calculer sur les 7 derniers jours : nb nouveaux contacts, nb RDV réalisés, nb commandes, évolution réseau
3. Envoyer un email via Resend avec ces métriques

Template email (HTML simple) :
"Bonjour [prénom], voici votre semaine Oryalis :
- X nouveaux contacts ajoutés
- X RDV réalisés
- X commandes enregistrées
- Réseau : +X distributeurs
[Lien vers l'app]"

Utilise la clé RESEND_API_KEY depuis les secrets Supabase.
```

---

### ÉTAPE 20 — Détection leaders émergents

```
Ajoute une nouvelle règle de détection dans features/alerts/alertService.ts.

Règle "leader_emerging" :
- Parcourir tous les clients avec contact_role = 'distributor'
- Si un distributeur a >= 3 filleuls directs avec contact_role IN ('distributor', 'customer') créés dans les 30 derniers jours
- Créer une alerte de type 'leader_emerging' avec message "[Prénom Nom] a recruté X nouveaux contacts ce mois — potentiel leader à accompagner"
- Ne pas recréer si une alerte du même type existe déjà pour ce client dans les 7 derniers jours

Affiche ce type d'alerte avec un badge violet "Leader émergent" dans la Zone 2 du dashboard.
```

---

## Notes importantes pour toutes les étapes

- **Jamais** `import { lightColors }` — toujours `useTheme()`
- **Jamais** de texte hardcodé — toujours `t('...')` avec clés dans `en.json` + `fr.json` simultanément
- **Jamais** `Alert.alert` sur web — toujours un state `errorMsg` inline
- **Jamais** `console.log` — uniquement `console.error` dans les catch
- **Migrations** : toujours Node.js + pg, jamais Supabase CLI
- **PowerShell** : ne jamais piper des strings vers des processus natifs
- Flux obligatoire : `UI → Hook → Service → Supabase`
