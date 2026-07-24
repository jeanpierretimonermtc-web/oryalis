# Oryalis — Audit Phase 1 « Conseiller payant »

Date : 12 juillet 2026  
Périmètre : audit produit et fonctionnel, sans modification du code et sans intelligence artificielle.

## 1. Verdict

Oryalis est déjà suffisamment riche pour lancer un pilote avec de vrais conseillers. En revanche, il n’est pas encore prêt à faire payer proprement un conseiller, pour trois raisons principales :

1. aucune limite gratuite n’est réellement appliquée ;
2. le bouton d’abonnement ne mène à aucun parcours de paiement ;
3. la « prochaine action » est répartie entre plusieurs sources qui peuvent se contredire.

La première livraison ne doit donc pas ajouter de nouveaux grands modules. Elle doit rendre le parcours existant cohérent, mesurable et monétisable.

## 2. Ce qui est déjà solide

- Inscription, confirmation d’email et récupération de mot de passe.
- Onboarding en trois étapes : profil, premier contact, premier rendez-vous.
- Gestion riche des contacts et rôles MLM.
- Import CSV avec aperçu, progression et rapport d’erreurs.
- Rendez-vous, relances, interactions, commandes et recommandations.
- Tableau de bord avec activité, pipeline, priorités, opportunités et objectifs.
- Automatisations déterministes après création d’un contact, commande ou rendez-vous.
- Calendrier Google et calendrier natif.
- Français et anglais, fuseaux horaires, modules et libellés personnalisables.
- Profil `free`, `pro` ou `cabinet` déjà prévu dans les données.

## 3. Bloquants avant commercialisation

### P0. Définir un seul concept de « contact actif »

La limite gratuite proposée est de 20 contacts actifs. Le mot « actif » est cependant déjà un statut CRM parmi plusieurs autres.

Décision recommandée :

- un contact comptabilisé est un contact non archivé ;
- son statut commercial n’influence pas le quota ;
- un contact archivé reste lisible et exportable mais ne peut plus recevoir de nouvelle activité ;
- restaurer un contact nécessite une place disponible ou un abonnement ;
- la suppression reste distincte de l’archivage.

Il faut donc introduire une notion explicite d’archivage. Utiliser uniquement le statut `inactive` permettrait de contourner la limite et mélangerait facturation et métier.

### P0. Unifier le pipeline

Oryalis utilise actuellement plusieurs notions proches :

- `clients.status` ;
- `clients.contact_role` ;
- `clients.journey_stage` ;
- `appointment_business_context.pipeline_stage` ;
- `followups.pipeline_stage`.

Le tableau de bord appelle « pipeline » un comptage par `clients.status`, alors que les rendez-vous possèdent un autre pipeline commercial.

Décision recommandée :

- `contact_role` répond à « qui est cette personne ? » ;
- `pipeline_stage` répond à « où en est l’opportunité actuelle ? » ;
- `journey_stage` est supprimé ou réservé au parcours client après achat ;
- `status` devient un état relationnel simple ou est progressivement remplacé ;
- rendez-vous et relances lisent le pipeline du contact au lieu de conserver leur propre vérité durable.

### P0. Créer une source unique pour la prochaine action

La prochaine action existe dans la fiche contact, dans les relances, dans les interactions planifiées et dans les rendez-vous. Rien ne garantit actuellement leur synchronisation.

Décision recommandée : les relances, interactions et rendez-vous restent les événements sources. La fiche contact affiche automatiquement le prochain événement à venir. Les champs `next_action_*` ne doivent pas devenir une seconde liste de tâches indépendante.

### P0. Construire le véritable parcours d’abonnement

L’écran affiche déjà les plans Gratuit, Pro et Cabinet, mais :

- le bouton « Mettre à niveau » n’a pas d’action ;
- aucun paiement n’est intégré ;
- aucun droit fonctionnel n’est relié au plan ;
- aucun quota n’est contrôlé côté serveur ;
- aucune gestion de renouvellement, résiliation ou échec de paiement n’existe.

Avant le paiement, figer : Gratuit, Conseiller et Leader. Le plan Cabinet ne correspond plus au positionnement principal.

### P0. Mesurer le parcours

Le produit ne possède pas encore de mesure visible des étapes suivantes :

- inscription terminée ;
- onboarding terminé ou passé ;
- premier contact créé/importé ;
- première action programmée ;
- première action terminée ;
- limite gratuite approchée/atteinte ;
- écran tarifaire consulté ;
- essai commencé ;
- abonnement commencé, échoué ou résilié.

Sans ces événements, il sera impossible de savoir pourquoi les conseillers ne paient pas.

## 4. Audit du parcours actuel

### Inscription

**Points positifs** : très peu de champs, confirmation d’email prévue.  
**Friction** : l’écran d’inscription n’utilise pas encore le design général de l’application et les erreurs techniques du fournisseur peuvent être affichées directement.  
**Action** : harmoniser la confiance visuelle, valider les champs avant envoi et présenter les erreurs en langage simple.

### Onboarding

**Points positifs** : parcours court et première donnée créée immédiatement.  
**Frictions** : le bouton « Passer » peut terminer l’onboarding depuis n’importe quelle étape ; le rendez-vous est imposé comme troisième victoire alors qu’une simple prochaine action serait souvent plus réaliste ; la langue et le fuseau sont présélectionnés sur France/Paris ; seulement cinq fuseaux sont proposés.  
**Action** : demander activité/marque, importer ou créer un premier contact, puis programmer une prochaine action. Le rendez-vous devient facultatif.

### Import

**Points positifs** : aperçu, CSV mobile/web, résultat détaillé.  
**Frictions** : correspondance automatique des colonnes sans écran de correction manuelle visible ; pas de détection de doublons évidente ; exemple encore orienté doTERRA ; aucune gestion future du quota de 20.  
**Action** : ajouter correspondance manuelle, détection email/téléphone/nom, sélection des lignes et compteur « X places disponibles ».

### Création d’un contact

**Points positifs** : données très complètes, prochaine action et potentiel réseau présents.  
**Frictions** : formulaire trop riche pour une création rapide ; données médicales et doTERRA visibles dans le parcours générique ; création d’un contact susceptible de générer automatiquement plusieurs relances ; absence d’archivage.  
**Action** : création rapide avec nom, rôle, source et prochaine action ; déplacer le reste dans « compléter la fiche ».

### Liste et fiche contact

**Points positifs** : historique métier très riche et nombreux raccourcis.  
**Friction** : la richesse peut masquer la prochaine action, qui doit être la donnée dominante.  
**Action** : afficher en premier l’étape, la dernière interaction, la prochaine action et deux boutons : « faire maintenant » et « reporter ».

### Tableau de bord

**Points positifs** : données nombreuses, priorités et opportunités déjà présentes.  
**Frictions** : l’écran cumule beaucoup de blocs et plusieurs définitions de priorité ; le pipeline est un comptage de statuts ; certaines alertes utilisent `updated_at` comme approximation du dernier contact. Modifier une fiche peut donc faire croire qu’une relation a été entretenue.  
**Action** : placer « À faire aujourd’hui » en tête, limiter la liste à cinq actions classées et utiliser la date réelle de dernière interaction.

### Relances et automatisations

**Points positifs** : scores déterministes et scénarios J+3/J+15/J+30 déjà disponibles.  
**Frictions** : les modules d’automatisation sont actifs par défaut ; un utilisateur peut recevoir des tâches qu’il n’a jamais demandées ; l’ouverture du tableau de bord déclenche certains calculs et créations en arrière-plan.  
**Action** : proposer les automatisations pendant l’onboarding, désactivées ou expliquées clairement, et journaliser la raison de chaque tâche automatique.

### Commandes et revenus

**Points positifs** : commandes par client, montant mensuel et suivis automatiques.  
**Friction** : le chiffre d’affaires additionne les montants sans gérer plusieurs devises ; le vocabulaire LRP reste très présent.  
**Action** : conserver l’euro pour le premier marché, mais enregistrer systématiquement la devise et employer « renouvellement » dans le noyau.

### Abonnement

**Point positif** : le plan est déjà visible dans le profil.  
**Friction majeure** : il s’agit seulement d’un affichage.  
**Action** : ne pas annoncer publiquement une offre payante avant que quota, droits, paiement, restauration et support soient cohérents de bout en bout.

## 5. Offre à figer pour le pilote

### Gratuit

- 20 contacts non archivés ;
- fiches, notes, rendez-vous et relances simples ;
- trois modèles de messages ;
- tableau de bord essentiel ;
- import limité aux places disponibles ;
- export complet permanent.

### Conseiller — hypothèse à tester

- 14,90 € par mois ou 149 € par an ;
- essai de 14 jours ;
- contacts illimités ;
- automatisations ;
- commandes et renouvellements complets ;
- modèles personnalisés illimités ;
- calendrier synchronisé ;
- rapports et objectifs complets.

Les fonctions de participation à une équipe devront rester accessibles à un membre Gratuit afin de ne pas bloquer la viralité. La création et le pilotage de parcours seront réservés au futur plan Leader.

## 6. Premier sprint recommandé

### Lot 1 — décisions produit

1. Valider 20 contacts non archivés.
2. Valider 14,90 €/mois et 149 €/an comme hypothèses de test.
3. Renommer Pro en Conseiller et Cabinet en Leader.
4. Écrire la matrice exacte des droits par plan.
5. Choisir la définition canonique du pipeline et de la prochaine action.

### Lot 2 — modèle fonctionnel

1. Prévoir l’archivage des contacts.
2. Prévoir le compteur de quota fiable côté serveur.
3. Définir le comportement lorsque le quota est atteint.
4. Unifier pipeline et prochaine action.
5. Remplacer `updated_at` par une vraie date de dernière interaction dans les alertes.

### Lot 3 — expérience

1. Simplifier l’onboarding autour de la première action.
2. Simplifier la création rapide de contact.
3. Mettre les cinq actions du jour au sommet du tableau de bord.
4. Afficher le compteur « 12/20 contacts » aux endroits pertinents.
5. Concevoir l’écran comparatif Gratuit/Conseiller.

### Lot 4 — mesure et pilote

1. Instrumenter les événements du tunnel.
2. Préparer un jeu de test sans données artificielles.
3. Recruter 10 conseillers pilotes.
4. Observer leur première session sans les guider.
5. Mesurer pendant quatre semaines avant d’élargir.

## 7. Critères de réussite du pilote

- 80 % créent ou importent un contact le premier jour.
- 60 % programment une prochaine action le premier jour.
- 40 % reviennent effectuer une action pendant la première semaine.
- Au moins 7 conseillers sur 10 comprennent la différence Gratuit/Conseiller sans explication orale.
- Au moins 3 sur 10 déclarent qu’ils paieraient le prix testé après quatre semaines d’usage réel.
- Les utilisateurs peuvent exporter leurs données et comprendre la limite sans contacter le support.

## 8. Décision finale de l’audit

Le tout premier travail à réaliser est la spécification fonctionnelle du quota, du pipeline unique et de la prochaine action unique. Le paiement vient juste après, car brancher une solution de facturation sur des droits encore ambigus créerait de la dette et des litiges.
