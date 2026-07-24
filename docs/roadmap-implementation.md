# Oryalis — Feuille de route d’implémentation

Mise à jour : 12 juillet 2026  
Cap : rendre le conseiller individuel actif et payant, sans intelligence artificielle.

## Vue d’ensemble

| Étape | Résultat attendu | État |
|---|---|---|
| 0. Audit produit | Parcours, frictions et modèle économique clarifiés | Terminé |
| 1. Quota et archivage | Gratuit limité à 20 contacts non archivés | Terminé |
| 2. Pipeline unique | Une seule étape commerciale par contact | Terminé |
| 3. Prochaine action unique | Une source fiable pour les actions du jour | Terminé |
| 4. Onboarding simplifié | Première valeur obtenue en moins de 10 minutes | Terminé |
| 5. Tableau de bord actionnable | Pipeline réel puis cinq actions prioritaires | Terminé |
| 6. Offre Conseiller | Droits Gratuit/Conseiller réellement appliqués | Terminé |
| 7. Paiement | Web, mobile, restauration et résiliation | Développé — configuration marchande requise |
| 8. Mesure et pilote | Tunnel mesuré avec 10 vrais conseillers | Instrumentation terminée — pilote terrain à lancer |
| 9. Réseau vivant | Comptes reliés et permissions | Plus tard |
| 10. Plan Leader | Duplication et parcours 30/60/90 jours | Plus tard |

## Étape 1 — Quota et archivage

### Réalisé dans le dépôt

- Migration ajoutant `clients.archived_at`.
- Index optimisé pour compter les contacts non archivés.
- Contrôle serveur empêchant un compte Gratuit de dépasser 20 contacts.
- Compatibilité temporaire avec les plans `pro` et `cabinet` existants.
- Fonction sécurisée retournant plan, consommation, limite et places restantes.
- Service et hook applicatifs de quota.
- Compteur visible sur la liste, la création et l’import.
- Bouton de création redirigé vers l’abonnement lorsque la limite est atteinte.
- Archivage disponible depuis le menu d’un contact.
- Contacts archivés exclus de la liste et de la recherche.
- Import limité au nombre de places restantes.
- Messages français et anglais.

### Validation réalisée

- Migration exécutée sur Supabase le 12 juillet 2026.
- RLS vérifiée avec un compte authentifié ; les données des autres comptes restent invisibles.
- Politique RLS historique redondante supprimée.
- Vue « Archivés » et restauration ajoutées.
- Aperçu CSV indiquant avant confirmation les lignes importées et ignorées.
- Écran d’abonnement fonctionnel et adapté à chaque plateforme.
- Tests réussis : 19→20, blocage 20→21, archivage, insertion après archivage, restauration à la limite, plan payant et lot de 50 contacts.
- Toutes les données de test ont été annulées par transaction.

### Suite liée à la monétisation

- Source de vérité `subscriptions`, synchronisation du plan et RLS : terminées.
- Fonctions Stripe Checkout, portail et webhook : développées, à déployer après ajout des secrets Stripe.
- Webhook RevenueCat : développé, à déployer après création du projet RevenueCat.
- Achat, restauration et gestion mobile : développés, à activer avec les produits App Store/Google Play et les clés publiques RevenueCat.
- Procédure complète : voir `docs/subscriptions-production-setup.md`.

## Étape 2 — Pipeline unique

### But

Supprimer les contradictions entre statut, rôle MLM, parcours et pipelines de rendez-vous/relances.

### Travail prévu

1. Définir les étapes canoniques : nouveau lead, contacté, présentation prévue, présentation faite, suivi, client, distributeur, perdu.
2. Stocker l’étape courante sur le contact.
3. Conserver le rôle MLM séparément.
4. Migrer les valeurs existantes sans perte.
5. Faire lire et modifier cette même étape par contacts, rendez-vous et relances.
6. Transformer le tableau de bord en vrai pipeline commercial.

### Implémentation réalisée

- Huit étapes canoniques : nouveau lead, contacté, présentation prévue, présentation faite, suivi, client, distributeur et perdu.
- Étape stockée sur le contact, indépendamment du rôle MLM.
- Migration conservatrice des statuts, rôles et signaux historiques.
- Valeurs historiques `proposal_sent` et `inactive` conservées dans leurs tables puis mappées vers `follow_up` et `lost`.
- Synchronisation vers le contact depuis les rendez-vous et relances.
- Création/édition de contact, rendez-vous et relance reliées au pipeline canonique.
- Tableau de bord et filtres clients basés sur les étapes commerciales.
- Migration distante exécutée avec succès via `migrate31.mjs` le 12 juillet 2026, après correction de la conversion manquante entre `pipeline_stage_enum` et `text` (`42883`) par ajout de casts explicites.

### État de validation

- TypeScript : validé sans erreur.
- Traductions françaises et anglaises : valides.
- Migration confirmée en direct sur Supabase : colonnes `pipeline_stage` et `pipeline_stage_updated_at` présentes sur `clients`, colonne `pipeline_stage` présente sur `appointment_business_context` et `followups`, fonction `canonical_pipeline_stage` en place.
- `scripts/test-canonical-pipeline.mjs` relancé le 12 juillet 2026 : valeurs valides, synchronisation rendez-vous et relance correctes, rôle MLM préservé, transaction annulée. Distribution observée : new_lead 5, contacted 0, presentation_scheduled 4, presentation_completed 0, follow_up 4, customer 13, distributor 7, lost 4.
- L’application peut désormais lire/écrire le pipeline en production.

### Redondance UI restante (non résolue)

Analyse du 12 juillet 2026 : `status` et `contact_role` ne sont pas réellement redondants avec le pipeline — `status` alimente un système de couleurs/libellés personnalisables par l’utilisateur (`statusColors`, `settings-crm`/`settings-labels`) et `contact_role` porte la position réseau MLM (onglet Réseau, hiérarchie sponsor, score prospect). Les retirer serait une vraie régression ; ils restent volontairement dans le formulaire.

`journey_stage`, en revanche, n’avait aucun usage fonctionnel (aucun filtre, KPI, tableau de bord ou logique métier n’en dépendait) et faisait doublon avec `pipeline_stage` — il a été retiré des formulaires de création/édition et de l’affichage de la fiche client le 12 juillet 2026. La colonne `journey_stage` reste en base (non exposée) pour l’instant, réversible sans migration.

- `clients/index.tsx` affiche encore à la fois l’ancien badge de statut et le libellé de pipeline sur la même carte, avec deux filtres indépendants (`statusFilter` et `pipelineFilter`) combinables librement — assumé, ce sont deux axes distincts (statut de vie du contact vs étape commerciale), pas une contradiction à résoudre.

## Étape 3 — Prochaine action unique

### But

Faire en sorte qu’un contact ne possède jamais plusieurs « prochaines actions » contradictoires.

### Travail prévu

1. Utiliser rendez-vous, interactions et relances comme événements sources.
2. Calculer automatiquement le prochain événement du contact.
3. Retirer ou synchroniser les champs manuels actuels.
4. Ajouter les actions rapides : terminer, reporter, appeler, ouvrir WhatsApp.
5. Enregistrer une vraie date de dernière interaction.
6. Corriger les alertes basées aujourd’hui sur `updated_at`.

### Implémentation réalisée

- Rendez-vous, interactions et relances sont les seules sources de la prochaine action.
- Le prochain événement est recalculé en base après chaque création, modification, terminaison ou suppression.
- Les champs historiques `next_action_date` et `next_action_type` restent synchronisés pour compatibilité, mais ne sont plus modifiables dans les formulaires contact.
- La source et l’identifiant de l’événement sont conservés pour agir sur le bon objet.
- Actions rapides ajoutées à la fiche : terminer, reporter d’un jour, appeler et ouvrir WhatsApp.
- `last_interaction_at` est calculé à partir des interactions terminées, rendez-vous terminés et relances effectuées.
- Alertes et automatisations « sans contact » utilisent `last_interaction_at`, plus `updated_at`, et ignorent les contacts archivés.
- Migration appliquée sur Supabase le 12 juillet 2026 via `migrate32.mjs`.
- Test transactionnel réussi pour les trois sources, le recalcul et la dernière interaction ; données de test annulées.
- TypeScript validé sans erreur.

## Étape 4 — Onboarding et première valeur

### Parcours cible

1. Identité, activité et marque.
2. Création ou import d’un premier contact.
3. Programmation d’une première action.
4. Arrivée sur « À faire aujourd’hui ».

### Travail prévu

- Détecter automatiquement langue et fuseau, avec modification possible.
- Ne plus imposer un rendez-vous.
- Expliquer les automatisations avant activation.
- Afficher la limite 20 contacts au moment opportun.
- Enregistrer chaque étape du tunnel.

### Implémentation réalisée

- Langue et fuseau détectés depuis l’appareil avec modification manuelle possible.
- Première étape centrée sur l’identité, l’activité MLM et la marque du conseiller.
- Automatisations désactivées par défaut, expliquées avant consentement et activées uniquement sur choix explicite.
- Deuxième étape orientée première valeur : création immédiate d’un contact ou redirection explicite vers l’import CSV.
- Troisième étape remplacée par une première action libre : appel, WhatsApp, SMS, e-mail ou rendez-vous.
- Le rendez-vous n’est plus obligatoire ; l’action peut également être programmée plus tard.
- Le bouton global « Passer » a été supprimé : seuls les choix métier « importer » et « programmer plus tard » restent disponibles aux étapes concernées.
- Chaque étape importante est enregistrée dans `onboarding_events` avec RLS : démarrage, profil, contact, import, action, report et fin.
- Migration `20260712_onboarding_events.sql` appliquée sur Supabase le 12 juillet 2026 via `migrate33.mjs`.
- TypeScript et traductions françaises/anglaises validés.

## Étape 5 — Centre d’actions quotidien

### Ordre proposé

1. Relances en retard.
2. Rendez-vous du jour.
3. Actions prévues aujourd’hui.
4. Prospects chauds sans action.
5. Renouvellements proches.

Le tableau de bord doit privilégier l’action et repousser les statistiques secondaires plus bas.

### Implémentation réalisée

- Centre « À faire aujourd’hui » placé avant les KPI, le pipeline, le chiffre d’affaires et les objectifs.
- Cinq groupes affichés dans l’ordre métier défini : relances en retard, rendez-vous du jour, actions du jour, prospects chauds sans action et renouvellements proches.
- Relances terminées, rendez-vous annulés et contacts archivés exclus des résultats.
- Actions du jour issues de la prochaine action calculée du contact, sans dupliquer les rendez-vous déjà affichés.
- Prospects chauds détectés depuis la dernière température `hot` ou `very_hot`, dédupliqués et affichés uniquement lorsqu’aucune action n’est programmée.
- Renouvellements limités aux cinq prochains jours.
- Chaque ligne ouvre directement la fiche, la relance ou le rendez-vous concerné.
- Maximum de cinq lignes visibles par groupe avec indication du nombre restant pour conserver un écran lisible sur mobile.
- État « tout est à jour » lorsque la file quotidienne est vide.
- Traductions françaises et anglaises ajoutées ; TypeScript et JSON validés.

## Étape 6 — Matrice Gratuit / Conseiller

### Gratuit

- 20 contacts non archivés.
- CRM essentiel.
- Relances manuelles.
- Trois modèles de messages.
- Import limité aux places disponibles.
- Export complet permanent.

### Conseiller

- 14,90 € par mois ou 149 € par an à tester.
- Contacts illimités.
- Automatisations.
- Calendrier synchronisé.
- Commandes et renouvellements complets.
- Modèles personnalisés illimités.
- Rapports et objectifs complets.

### Décisions encore nécessaires

- Carte bancaire requise ou non pour l’essai de 14 jours.
- Fonctions exactes conservées après expiration.
- Nombre de modèles gratuits.
- Politique de remboursement.
- TVA et facturation selon le pays.

### Implémentation réalisée

- Droits centralisés par la fonction sécurisée `get_my_entitlements`, fondée sur la source de vérité d’abonnement.
- Gratuit : 20 contacts actifs, CRM essentiel, relances manuelles, trois modèles intégrés, import limité et export CSV complet permanent.
- Conseiller : contacts illimités, automatisations, Google Agenda, commandes/renouvellements, objectifs/rapports et bibliothèque complète.
- Création illimitée de modèles de messages personnalisés pour le plan Conseiller.
- Écrans premium remplacés par un verrou explicatif et un accès direct à l’abonnement pour les comptes gratuits.
- Protections Supabase empêchant les mutations gratuites sur commandes, objectifs, jetons Google et modèles personnalisés.
- Données premium historiques conservées et lisibles après résiliation ; seules les nouvelles mutations sont bloquées.
- Automatisations neutralisées côté service lorsque le plan n’est pas actif, même si un ancien réglage est encore présent.
- Migration des droits `20260712_advisor_entitlements.sql` appliquée via `migrate34.mjs`.
- Migration des modèles personnalisés `20260712_custom_message_templates.sql` appliquée via `migrate35.mjs`.
- Tests transactionnels réussis : écriture gratuite refusée, écriture Conseiller autorisée et données de test annulées.
- TypeScript et traductions françaises/anglaises validés.

## Étape 7 — Paiement

### Architecture réalisée

- Web : Stripe Checkout dynamique et authentifié.
- iOS : StoreKit via RevenueCat.
- Android : Google Play Billing via RevenueCat.
- Source de vérité : table sécurisée `subscriptions`.
- Synchronisation automatique de `profiles.plan`.
- Portail Stripe pour gérer ou résilier un abonnement Web.
- Restauration des achats et gestion de l’abonnement sur mobile.
- Webhooks Stripe et RevenueCat développés.
- Écriture directe dans `subscriptions` interdite au client.

### Validation réalisée

- Migration `subscriptions` exécutée sur Supabase.
- Synchronisation source de vérité → profil testée.
- Isolation RLS testée.
- Tentative d’écriture cliente testée et bloquée.
- TypeScript validé sans erreur.

### Activation production restante

1. Créer les prix mensuel et annuel dans Stripe.
2. Ajouter les secrets Stripe aux fonctions Supabase.
3. Déployer les fonctions Checkout, portail et webhook.
4. Créer les abonnements dans App Store Connect et Google Play Console.
5. Créer le projet RevenueCat, l’entitlement `advisor` et l’offering courante.
6. Ajouter les clés publiques RevenueCat aux environnements EAS.
7. Déployer le webhook RevenueCat.
8. Tester les achats avec Stripe Test, StoreKit Sandbox et Google Play interne.

Procédure détaillée : `docs/subscriptions-production-setup.md`.

## Sécurité owner et administration

### Implémentation réalisée

- Rôle applicatif `owner` séparé du plan commercial `advisor`.
- Ton compte créateur configuré comme premier owner.
- Modification directe de `profiles.plan` interdite aux utilisateurs authentifiés par privilèges de colonnes et trigger défensif.
- Tables sécurisées `user_roles` et `admin_audit_log` non accessibles directement au client.
- RPC owner pour lister les comptes, accorder ou révoquer un abonnement manuel, gérer les rôles et consulter l’audit.
- Toutes les opérations sensibles vérifient le rôle côté base et sont journalisées.
- Aucun élargissement des politiques RLS sur les données CRM privées.
- Migration `20260714_owner_security.sql` appliquée via `migrate37.mjs`.
- Tests transactionnels réussis : changement de plan client refusé, RPC owner refusée à un utilisateur normal, owner reconnu et audit écrit.

### Interface owner livrée (14 juillet 2026)

- Console owner avec recherche utilisateurs, gestion des accès manuels et des rôles.
- Journal d’audit et centre d’alertes de sécurité.
- MFA TOTP AAL2 imposée côté base avant chaque opération owner.
- Détection des nouvelles installations et notifications de sécurité.
- Accès support privé temporaire, limité, consenti, révocable et journalisé.

Procédure et modèle de sécurité : `docs/owner-security.md`.

## Étape 8 — Mesure et pilote

### Événements essentiels

- inscription terminée ;
- onboarding terminé ou passé ;
- premier contact ;
- première action programmée ;
- première action terminée ;
- quota approché et atteint ;
- offre consultée ;
- essai et abonnement commencés ;
- abonnement échoué ou résilié.

### Pilote

- 10 conseillers pendant quatre semaines ;
- observation de la première session sans aide ;
- entretien aux jours 1, 7 et 30 ;
- décision fondée sur activation, rétention et volonté réelle de payer.

### Instrumentation réalisée

- Table sécurisée `product_events` et index d’analyse chronologique.
- Mesure serveur des inscriptions, premiers contacts, premières actions programmées et premières actions terminées.
- Mesure de l’onboarding terminé ou reporté depuis les événements déjà collectés à chaque étape.
- Mesure automatique du quota approché à 18 contacts et atteint à 20 contacts.
- Mesure dans l’application de l’offre consultée, du checkout commencé, de son échec éventuel et de la restauration d’achat.
- Mesure serveur des abonnements commencés, paiements en échec et abonnements résiliés ou expirés.
- Événements d’activation dédupliqués afin qu’un même utilisateur ne gonfle pas artificiellement le tunnel.
- Table privée `pilot_participants`, sans politique d’accès client, pour gérer la cohorte et les entretiens J1/J7/J30.
- Protocole, seuils de décision et requête de suivi documentés dans `docs/pilot-conseillers.md`.
- Migration `20260712_product_analytics.sql` appliquée sur Supabase le 12 juillet 2026 via `migrate36.mjs`.
- Test transactionnel réussi pour premier contact, première action programmée/terminée et abonnement ; données annulées.
- TypeScript validé sans erreur.

### Travail terrain restant

1. Recruter les 10 conseillers pilotes et recueillir leur consentement.
2. Ajouter leurs comptes à la cohorte `pilot-1`.
3. Conduire les observations initiales sans formation préalable.
4. Réaliser les entretiens J1, J7 et J30.
5. Attendre quatre semaines complètes avant de conclure sur activation, rétention et volonté de payer.

L’étape ne pourra être déclarée totalement terminée qu’après ce pilote réel.

## Prochain ordre de travail

1. ~~Faire réussir `migrate31.mjs`~~ — confirmé en direct sur Supabase le 12 juillet 2026.
2. ~~Relancer `scripts/test-canonical-pipeline.mjs`~~ — réussi le 12 juillet 2026, transaction annulée.
3. ~~Résoudre la redondance UI de l’étape 2~~ — `journey_stage` retiré des formulaires et de la fiche client le 12 juillet 2026 ; `status` et `contact_role` conservés (usages distincts, non redondants).
4. Recruter puis lancer le pilote de quatre semaines avec 10 conseillers.
5. Analyser le tunnel et réaliser les entretiens J1, J7 et J30.
6. Reprendre l’étape 7 seulement lorsque la décision sur les comptes marchands sera prise.
7. Commencer le réseau vivant et le plan Leader seulement après validation du pilote.

## État technique actuel

### Terminé et présent sur Supabase

- Quota gratuit et archivage.
- RLS des contacts.
- Source de vérité des abonnements.
- Synchronisation sécurisée des plans.
- Prochaine action et dernière interaction calculées.
- Onboarding simplifié et tunnel d’onboarding mesuré.
- Tunnel complet d’activation et d’abonnement instrumenté ; cohorte pilote prête.
- Pipeline commercial canonique — migration confirmée en direct et test de non-régression réussi le 12 juillet 2026 ; redondance UI (`journey_stage`) résolue le même jour.

### Développé localement, configuration externe requise

- Stripe Checkout et portail — secrets et déploiement requis.
- Achats intégrés RevenueCat — produits et clés requis.

### Qualité

- Compilation TypeScript : zéro erreur.
- JSON de traduction : valide.
- Tests quota et abonnements : réussis avec annulation transactionnelle.
- Test pipeline : réussi le 12 juillet 2026 (`scripts/test-canonical-pipeline.mjs`), transaction annulée.
