import PDFDocument from 'pdfkit'
import { createWriteStream } from 'fs'

const OUTPUT = 'Oryalis_Vision_Roadmap_MLM.pdf'
const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 52, right: 52 }, bufferPages: true, info: {
  Title: 'Oryalis - Vision et feuille de route MLM',
  Author: 'Oryalis',
  Subject: 'Plan produit sans intelligence artificielle pour faire d’Oryalis une plateforme MLM mondiale',
}})
doc.pipe(createWriteStream(OUTPUT))

const C = { navy: '#0F172A', blue: '#2563EB', cyan: '#0891B2', violet: '#6D3BFF', green: '#059669', amber: '#D97706', red: '#DC2626', text: '#1E293B', muted: '#64748B', pale: '#F1F5F9', line: '#CBD5E1', white: '#FFFFFF' }
const W = doc.page.width - doc.page.margins.left - doc.page.margins.right
const bottom = () => doc.page.height - doc.page.margins.bottom

function newPage() { doc.addPage(); doc.y = doc.page.margins.top }
function ensure(h = 80) { if (doc.y + h > bottom()) newPage() }
function title(text) { ensure(55); doc.font('Helvetica-Bold').fontSize(20).fillColor(C.navy).text(text); doc.moveDown(0.35); doc.rect(doc.x, doc.y, 64, 4).fill(C.cyan); doc.moveDown(0.75) }
function h2(text, color = C.blue) { ensure(42); doc.font('Helvetica-Bold').fontSize(14).fillColor(color).text(text); doc.moveDown(0.35) }
function h3(text) { ensure(34); doc.font('Helvetica-Bold').fontSize(11.5).fillColor(C.navy).text(text); doc.moveDown(0.2) }
function p(text, opts = {}) { doc.font('Helvetica').fontSize(9.7).fillColor(C.text).text(text, { lineGap: 2.2, ...opts }); doc.moveDown(0.55) }
function bullet(text) { ensure(28); doc.font('Helvetica').fontSize(9.5).fillColor(C.text).text(`•  ${text}`, { indent: 12, lineGap: 2 }); doc.moveDown(0.22) }
function callout(label, text, color = C.blue) { ensure(75); const y = doc.y; const h = doc.heightOfString(text, { width: W - 36, lineGap: 2 }) + 42; doc.roundedRect(doc.page.margins.left, y, W, h, 8).fill(C.pale); doc.rect(doc.page.margins.left, y, 5, h).fill(color); doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text(label, doc.page.margins.left + 18, y + 12); doc.font('Helvetica').fontSize(9.5).fillColor(C.text).text(text, doc.page.margins.left + 18, y + 28, { width: W - 36, lineGap: 2 }); doc.y = y + h + 12 }
function feature(name, does, value, success) { ensure(105); h3(name); doc.font('Helvetica-Bold').fontSize(9).fillColor(C.cyan).text('Ce que cela fait'); p(does); doc.font('Helvetica-Bold').fontSize(9).fillColor(C.green).text('Pourquoi c’est utile'); p(value); doc.font('Helvetica-Bold').fontSize(9).fillColor(C.violet).text('Signe de réussite'); p(success) }
function phaseBadge(n, label, color) { ensure(50); const y = doc.y; doc.roundedRect(doc.page.margins.left, y, W, 38, 8).fill(color); doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white).text(`PHASE ${n}`, doc.page.margins.left + 14, y + 8); doc.font('Helvetica').fontSize(10).text(label, doc.page.margins.left + 88, y + 8, { width: W - 105 }); doc.y = y + 53 }

// Couverture
doc.rect(0, 0, doc.page.width, doc.page.height).fill(C.navy)
doc.circle(doc.page.width - 35, 105, 145).fill(C.violet)
doc.circle(doc.page.width - 10, 55, 95).fill(C.blue)
doc.circle(40, doc.page.height - 40, 125).fill(C.cyan)
doc.font('Helvetica-Bold').fontSize(36).fillColor(C.white).text('ORYALIS', 58, 185)
doc.font('Helvetica-Bold').fontSize(24).text('Vision et feuille de route', 58, 245, { width: 420 })
doc.font('Helvetica').fontSize(16).fillColor('#BAE6FD').text('Rendre le CRM indispensable aux conseillers et aux équipes MLM, en France puis dans le monde.', 58, 290, { width: 440, lineGap: 6 })
doc.roundedRect(58, 405, 300, 55, 8).fill('#1E293B')
doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white).text('PÉRIMÈTRE', 76, 420)
doc.font('Helvetica').fontSize(10).fillColor('#CBD5E1').text('Produit sans intelligence artificielle', 76, 438)
doc.fontSize(9).fillColor('#94A3B8').text('Modèle freemium avec abonnement conseiller', 58, 490)
doc.text('Version stratégique — Juillet 2026', 58, 710)

newPage(); title('1. Résumé exécutif')
p('Oryalis dispose déjà des briques d’un CRM individuel solide : contacts, rendez-vous, relances, interactions, commandes, recommandations, catalogues, objectifs, automatisations et représentation du réseau. La prochaine étape n’est pas d’ajouter des écrans isolés, mais de relier ces fonctions dans un parcours quotidien simple et mesurable.')
callout('VISION PRODUIT', 'Oryalis devient le système d’exploitation indépendant des marques pour le conseiller MLM : il sait qui contacter, pourquoi, quand relancer, comment accompagner un client et comment aider son équipe à reproduire une méthode.', C.violet)
h2('Les décisions structurantes')
bullet('La version gratuite reste utile, mais limitée en nombre de clients et en puissance opérationnelle.')
bullet('Le conseiller actif paie son propre abonnement : Oryalis doit lui faire gagner plus de temps et d’opportunités que son prix mensuel.')
bullet('Le produit reste multimarque. Les spécificités doTERRA, Zinzino, Herbalife ou autres deviennent des modules, jamais le cœur du produit.')
bullet('La collaboration d’équipe repose sur le consentement et des permissions claires. Un leader ne doit pas pouvoir lire les données privées de ses filleuls.')
bullet('La conformité, le consentement et la protection des données deviennent des avantages commerciaux visibles.')
bullet('L’intelligence artificielle est exclue des phases initiales. Elle pourra être étudiée plus tard, lorsque les usages, intégrations et données seront suffisamment fiables.')
h2('Promesse simple')
callout('POUR LE CONSEILLER', 'Chaque matin, Oryalis présente les actions prioritaires. Chaque soir, le conseiller sait ce qu’il a accompli et quelles relations doivent être suivies.', C.cyan)
callout('POUR LE LEADER', 'Le leader transmet un parcours de travail duplicable, suit des indicateurs d’activation agrégés et aide les membres qui en ont réellement besoin.', C.green)

newPage(); title('2. Positionnement et principes')
h2('Ce qu’Oryalis doit être')
bullet('Un CRM mobile rapide pour les conseillers sur le terrain.')
bullet('Un outil de suivi de la relation, de la prospection au client fidèle puis au distributeur.')
bullet('Un système de duplication pour démarrer et accompagner une équipe.')
bullet('Une plateforme indépendante des entreprises MLM, mais connectable à leurs outils.')
bullet('Un produit suffisamment simple pour un débutant et suffisamment structuré pour un leader.')
h2('Ce qu’Oryalis ne doit pas devenir')
bullet('Un back-office de commissions universel : les plans de rémunération sont trop différents et l’entreprise MLM reste la source officielle.')
bullet('Un réseau social généraliste : les conversations communautaires existent déjà sur WhatsApp, Telegram ou Facebook.')
bullet('Un outil de spam : l’envoi massif non sollicité détruirait la réputation du produit et de ses utilisateurs.')
bullet('Un produit exclusivement bien-être : les données médicales doivent être optionnelles et fortement protégées.')
bullet('Une usine à gaz conçue uniquement pour les grands leaders.')
h2('Les trois boucles de valeur')
feature('Boucle conseiller', 'Ajouter un contact, choisir une prochaine action, réaliser l’action, enregistrer le résultat, programmer la suite.', 'Elle transforme une base de contacts passive en outil de travail quotidien.', 'Le conseiller revient plusieurs fois par semaine et réduit ses relances oubliées.')
feature('Boucle client', 'Suivre besoins, recommandations, commandes, satisfaction et renouvellements dans une chronologie unique.', 'Elle améliore le service après-vente et la fidélisation.', 'Les clients suivis ont davantage de rendez-vous, renouvellements ou recommandations mesurables.')
feature('Boucle équipe', 'Inviter un membre, lui transmettre un parcours, suivre ses jalons et l’aider à devenir autonome.', 'Elle rend la duplication concrète sans exposer ses données privées.', 'Une part croissante des nouveaux membres atteint les jalons des 7, 30 et 90 jours.')

newPage(); title('3. Modèle économique freemium')
p('Le gratuit ne doit pas être une démo frustrante. Il doit permettre d’obtenir une première victoire. La limite de clients crée ensuite un passage naturel vers l’abonnement, sans retirer les données déjà saisies.')
h2('Offre Gratuit — découvrir et démarrer')
bullet('Jusqu’à 20 clients ou prospects actifs. Les contacts archivés restent consultables mais ne permettent pas de contourner artificiellement la limite.')
bullet('Fiches contacts, notes, rendez-vous et relances de base.')
bullet('Tableau de bord essentiel et modèles de messages limités.')
bullet('Import initial plafonné et export complet toujours disponible pour préserver la confiance.')
bullet('Un seul utilisateur, sans parcours d’équipe publié ni automatisations avancées.')
callout('RÈGLE IMPORTANTE', 'Quand la limite est atteinte, Oryalis ne supprime rien. L’utilisateur peut consulter ses données, archiver des contacts ou s’abonner. Il faut éviter toute sensation de prise d’otage.', C.amber)
h2('Offre Conseiller — le cœur payant')
bullet('Clients et prospects illimités.')
bullet('Pipeline complet, priorités quotidiennes, relances récurrentes et automatisations configurables.')
bullet('Historique complet, commandes, renouvellements, objectifs et rapports personnels.')
bullet('Intégrations calendrier, email et canaux compatibles selon les coûts techniques.')
bullet('Catalogues multimarques et modèles personnalisés.')
bullet('Participation aux parcours d’équipe et suivi de ses propres jalons.')
p('Fourchette à tester : 12 à 19 € par mois, avec un abonnement annuel offrant environ deux mois. Le bon prix doit être validé avec de vrais conseillers, pas décidé uniquement par comparaison concurrentielle.')
h2('Offre Leader')
bullet('Tout le plan Conseiller, plus création de parcours 30/60/90 jours.')
bullet('Invitations d’équipe, campagnes, ressources partagées et tableau de bord agrégé.')
bullet('Gestion des permissions, rôles d’animateurs et groupes de travail.')
bullet('Analyses d’activation, sans accès automatique aux contacts privés des membres.')
p('Fourchette à tester : 39 à 79 € par mois selon le nombre de membres actifs et les fonctions incluses.')
h2('Offre Entreprise — plus tard')
bullet('Administration centralisée, identité de marque, conformité, contenus approuvés, SSO et API.')
bullet('Tarification contractuelle selon les utilisateurs, intégrations, support et exigences réglementaires.')

newPage(); phaseBadge('1', 'Fondations : rendre le conseiller payant et satisfait', C.blue)
p('Objectif : faire d’Oryalis un outil utilisé chaque semaine par un conseiller individuel. Cette phase doit précéder les ambitions de réseau à grande échelle.')
feature('1.1 Limite clients et gestion de l’abonnement', 'Le système compte les contacts actifs, prévient avant la limite gratuite et propose l’abonnement Conseiller. La facturation, les factures, le renouvellement, l’échec de paiement et la résiliation sont compréhensibles depuis l’application.', 'Elle transforme l’usage réel en revenu récurrent sans empêcher la découverte du produit.', 'Les utilisateurs comprennent la limite, le taux de conversion est mesurable et les demandes de support liées au paiement restent faibles.')
feature('1.2 Pipeline visuel', 'Les contacts avancent entre des étapes personnalisables : nouveau lead, contacté, présentation, suivi, client, distributeur, inactif ou perdu.', 'Le conseiller voit immédiatement où se trouvent ses opportunités et évite que les prospects disparaissent dans une liste.', 'Chaque contact actif possède une étape et une prochaine action ; les contacts sans suivi diminuent.')
feature('1.3 Centre d’actions du jour', 'Le tableau de bord regroupe rendez-vous, relances dues, renouvellements proches, prospects chauds et tâches en retard. Les règles sont déterministes, sans IA.', 'L’utilisateur ouvre Oryalis pour agir et non pour chercher des informations.', 'La majorité des sessions produit au moins une action terminée ou replanifiée.')
feature('1.4 Chronologie relationnelle', 'Appels, messages, rendez-vous, notes, recommandations, commandes et changements de statut apparaissent dans un fil chronologique unique.', 'Le conseiller retrouve le contexte avant de contacter une personne et offre un suivi plus humain.', 'Le temps nécessaire pour préparer une relance baisse et les interactions sont mieux documentées.')
feature('1.5 Import et export irréprochables', 'Import CSV avec aperçu, correspondance des colonnes, détection des doublons et rapport d’erreurs. Export complet dans un format portable.', 'L’import réduit le coût d’entrée ; l’export crée la confiance indispensable pour payer un abonnement.', 'Un conseiller peut migrer sa liste sans aide et récupérer toutes ses données à tout moment.')

newPage(); phaseBadge('2', 'Productivité et fidélisation client', C.cyan)
p('Objectif : démontrer une valeur financière directe pour le conseiller, sans automatisation opaque et sans intelligence artificielle.')
feature('2.1 Relances et séquences configurables', 'Le conseiller définit des scénarios simples : après une présentation, créer une relance à J+1 puis J+3 ; après une commande, prévoir un suivi ; après une absence, reprogrammer un contact.', 'Les règles évitent les oublis tout en laissant le conseiller valider chaque communication.', 'Les relances à l’heure augmentent sans hausse des désabonnements ou plaintes.')
feature('2.2 Renouvellements et commandes', 'Oryalis mémorise la date, les produits, le montant, la devise et le prochain renouvellement. Il signale les échéances et distingue commande client, commande personnelle et retour.', 'Le conseiller protège son revenu récurrent et suit correctement le service après-vente.', 'Le nombre de renouvellements suivis et le taux de rétention deviennent visibles.')
feature('2.3 Modèles de messages multicanaux', 'Des modèles personnalisables utilisent le prénom, la langue et le contexte. Le conseiller copie ou ouvre WhatsApp, SMS ou email, puis confirme le résultat.', 'Le temps de rédaction baisse tout en conservant une validation humaine.', 'Les modèles sont régulièrement utilisés et les messages restent personnalisés et conformes.')
feature('2.4 Capture de leads', 'Des formulaires et QR codes attribués à une campagne créent un contact avec sa source, son consentement et une tâche de suivi.', 'Les salons, ateliers, réseaux sociaux et recommandations alimentent directement le CRM.', 'Le délai entre la collecte du lead et le premier contact diminue nettement.')
feature('2.5 Calendrier opérationnel', 'Rendez-vous Oryalis et calendriers externes se synchronisent, avec gestion des fuseaux horaires, rappels et liens de visioconférence.', 'Le conseiller évite les doubles saisies et les rendez-vous oubliés.', 'Les conflits de calendrier et les rendez-vous non honorés diminuent.')
feature('2.6 Objectifs et rapports personnels', 'Le conseiller fixe des objectifs d’activité et de résultat : nouveaux contacts, présentations, suivis, clients, distributeurs, chiffre d’affaires déclaré.', 'Il distingue les actions contrôlables des résultats et peut ajuster son effort.', 'Les objectifs sont consultés chaque semaine et alimentés par les activités réelles.')

newPage(); phaseBadge('3', 'Réseau vivant et comptes reliés', C.violet)
p('Objectif : passer d’un arbre dessiné dans le CRM à un réseau de comptes autonomes et consentants.')
feature('3.1 Invitation d’un filleul', 'Un conseiller invite un membre par lien ou QR code. À l’acceptation, la fiche devient un compte autonome et le lien de parrainage est conservé.', 'Le réseau se construit sans double saisie et chaque nouveau membre obtient son propre espace.', 'La majorité des invitations acceptées aboutit à une première action en moins de 24 heures.')
feature('3.2 Identité unique et gestion des doublons', 'Oryalis détecte les invitations ou comptes potentiellement identiques et propose une résolution contrôlée. Les données privées ne sont jamais fusionnées automatiquement.', 'Cela limite les arbres incohérents et protège la propriété des données.', 'Le nombre de doublons et de litiges de rattachement reste faible.')
feature('3.3 Permissions de partage', 'Chaque membre choisit ce qu’il partage : jalons, activité agrégée, disponibilité ou objectifs. Les contacts, notes et messages restent privés par défaut.', 'La confiance est indispensable à l’adoption mondiale et à la conformité.', 'Les utilisateurs comprennent qui voit quoi et peuvent révoquer un accès facilement.')
feature('3.4 Vues réseau opérationnelles', 'L’arbre, la liste et la carte présentent les membres directs, niveaux, pays, statut d’activation et dernières étapes franchies.', 'Le leader identifie les personnes à accompagner sans parcourir des tableaux externes.', 'Les leaders utilisent davantage les filtres d’accompagnement que la seule taille de réseau.')
feature('3.5 Historique du rattachement', 'Les invitations, acceptations, corrections et changements autorisés de sponsor sont historisés avec date et motif.', 'Les structures MLM sont sensibles ; une trace fiable évite les conflits et les manipulations.', 'Chaque modification est explicable et auditable.')

newPage(); phaseBadge('4', 'Duplication et accompagnement 30/60/90 jours', C.green)
p('Objectif : faire d’Oryalis la méthode de démarrage de l’équipe, et non seulement son fichier de contacts.')
feature('4.1 Parcours duplicables', 'Un leader assemble des étapes : compléter son profil, importer des contacts, apprendre une ressource, organiser une présentation, effectuer des suivis et obtenir un premier client.', 'Chaque recrue reçoit la même base de travail et sait exactement quoi faire.', 'Le taux de complétion des jalons à 7, 30, 60 et 90 jours progresse.')
feature('4.2 Bibliothèque de ressources', 'Documents, vidéos, liens, scripts et fiches pratiques sont classés par langue, marque, pays et étape du parcours.', 'La recrue trouve une ressource validée sans chercher dans plusieurs groupes de messagerie.', 'Les ressources utiles sont consultées depuis une tâche ou un contexte précis.')
feature('4.3 Validation et certification', 'Certaines étapes demandent une confirmation, un mini-questionnaire ou la validation d’un mentor. Les versions et dates restent enregistrées.', 'Le leader vérifie les connaissances importantes sans organiser chaque formation individuellement.', 'Les membres certifiés commettent moins d’erreurs et deviennent autonomes plus vite.')
feature('4.4 Tableau de bord d’activation', 'Le leader voit des données agrégées : invitations, comptes activés, jalons atteints, membres bloqués et progression par cohorte.', 'Il concentre son temps sur l’accompagnement utile plutôt que sur la surveillance.', 'Le temps jusqu’au premier client ou à la première recrue diminue.')
feature('4.5 Campagnes d’équipe', 'Une campagne rassemble une période, un objectif, des tâches, ressources et indicateurs. Chaque membre garde ses propres contacts.', 'L’équipe peut travailler ensemble sans exporter les données dans des feuilles partagées.', 'Les campagnes produisent un niveau d’activité et des résultats comparables dans le temps.')
feature('4.6 Reconnaissance saine', 'Oryalis célèbre les jalons d’apprentissage, de service client, de régularité et de progression, pas uniquement le recrutement ou le chiffre d’affaires.', 'La reconnaissance améliore l’engagement sans encourager des comportements agressifs.', 'Les célébrations sont diversifiées et ne créent pas de classement humiliant.')

newPage(); phaseBadge('5', 'Conformité, confiance et protection mondiale', C.amber)
p('Objectif : faire de la sécurité commerciale et réglementaire une raison de choisir Oryalis.')
feature('5.1 Consentement et préférences de communication', 'Chaque contact peut disposer d’une source, date et preuve de consentement, de canaux autorisés et d’une opposition. Les envois respectent ces préférences.', 'Le conseiller réduit le risque de spam et respecte davantage la relation.', 'Une opposition bloque effectivement les communications concernées et reste traçable.')
feature('5.2 Bibliothèque de contenus approuvés', 'Les marques ou leaders autorisés publient des formulations versionnées par pays et langue. Les anciens contenus peuvent être retirés.', 'Les conseillers utilisent des messages cohérents et savent quels documents sont à jour.', 'La part de communications fondées sur des contenus validés augmente.')
feature('5.3 Contrôles déterministes avant envoi', 'Sans IA, des règles et listes de termes signalent certaines promesses de revenus, garanties, allégations médicales ou formulations interdites. Le conseiller doit corriger ou justifier.', 'Le système prévient les risques les plus courants sans prétendre comprendre parfaitement chaque phrase.', 'Les avertissements sont pertinents, explicables et rarement contournés.')
feature('5.4 Journal d’audit', 'Les consentements, exports, changements de permissions, validations de contenu et actions administratives importantes sont datés.', 'Les équipes et entreprises peuvent démontrer leurs procédures.', 'Une demande ou un incident peut être reconstitué rapidement.')
feature('5.5 Droits sur les données', 'Téléchargement, rectification, suppression, durée de conservation et fermeture de compte disposent de parcours simples.', 'La maîtrise des données renforce la confiance des conseillers et de leurs contacts.', 'Les demandes sont traitées dans les délais et sans intervention manuelle excessive.')
feature('5.6 Données sensibles optionnelles', 'Les informations de santé ou notes sensibles sont désactivables, séparées des données commerciales et soumises à des permissions renforcées.', 'Oryalis peut servir plusieurs secteurs sans imposer un risque hérité du bien-être.', 'Les utilisateurs savent identifier une donnée sensible et son accès est strictement limité.')

newPage(); phaseBadge('6', 'Internationalisation et écosystème multimarque', C.red)
p('Objectif : ouvrir Oryalis au monde sans créer une version différente et ingérable pour chaque entreprise MLM.')
feature('6.1 Noyau universel et packs de marque', 'Le CRM conserve des concepts neutres. Chaque pack ajoute vocabulaire, catalogue, statuts, renouvellements, ressources et champs propres à une marque.', 'Une nouvelle marque devient une configuration plutôt qu’une refonte du produit.', 'L’activation d’un pack ne casse pas les données des autres marques d’un utilisateur.')
feature('6.2 Multi-devise, pays et fuseaux', 'Montants, dates, numéros, adresses, unités et échéances suivent les préférences locales. Les rapports conservent la devise source.', 'Le produit cesse d’être perçu comme uniquement français ou européen.', 'Un conseiller international utilise toutes les fonctions sans conversion manuelle.')
feature('6.3 Langues prioritaires', 'Après français et anglais, les langues sont choisies selon les communautés partenaires : espagnol, portugais brésilien, allemand, italien, indonésien, arabe, hindi ou japonais.', 'La traduction suit la demande réelle et non une ambition abstraite.', 'Chaque nouvelle langue possède un partenaire pilote et un niveau de qualité contrôlé.')
feature('6.4 Connecteurs de back-office', 'Des imports ou API récupèrent, avec autorisation, commandes, volumes, rangs et renouvellements depuis les sources officielles.', 'Le conseiller évite la double saisie et Oryalis complète le back-office au lieu de le remplacer.', 'Les données synchronisées sont fiables, datées et identifiées comme officielles ou déclaratives.')
feature('6.5 API et partenaires', 'Une API documentée permet aux entreprises et outils autorisés d’échanger contacts consentis, événements, catalogues et indicateurs.', 'L’écosystème accélère l’adoption et réduit le travail spécifique.', 'Les intégrations utilisent des permissions limitées et restent observables.')
feature('6.6 Offre Entreprise', 'Une société MLM gère identité, pays, contenus approuvés, administrateurs, rôles, accès et rapports de conformité.', 'Oryalis ouvre une seconde source de revenus sans abandonner le conseiller indépendant.', 'Une entreprise peut déployer le produit sans compromettre la neutralité et la confidentialité des membres.')

newPage(); title('10. Phase future — intelligence artificielle hors périmètre')
callout('DÉCISION', 'Aucune fonctionnalité d’intelligence artificielle n’est nécessaire pour lancer les phases 1 à 6. Les priorités sont la qualité des données, les parcours métier, les intégrations, la duplication, la conformité et la simplicité.', C.red)
p('Une éventuelle phase IA ne devra être ouverte qu’après validation de quatre conditions : volume suffisant de données propres, consentement clair, bénéfice mesurable, et capacité à contrôler les erreurs. Elle devra rester optionnelle et ne jamais envoyer automatiquement une promesse commerciale, médicale ou financière.')
h2('Ce qui fonctionne sans IA')
bullet('Priorités quotidiennes calculées avec des dates, statuts, scores et règles explicites.')
bullet('Séquences de relance déclenchées par événements et délais.')
bullet('Modèles de messages avec variables contrôlées.')
bullet('Détection simple de formulations interdites par règles et dictionnaires.')
bullet('Identification des membres bloqués par absence d’activité ou jalons non réalisés.')
bullet('Rapports et recommandations fondés sur des seuils configurables.')
h2('Pourquoi attendre')
bullet('Une IA ajoutée trop tôt masquerait les défauts de processus et de données.')
bullet('Les coûts d’usage pourraient fragiliser l’économie de l’offre Conseiller.')
bullet('Les erreurs sur la santé ou les revenus exposeraient Oryalis et ses utilisateurs.')
bullet('La différenciation initiale vient de la duplication et du réseau vivant, pas d’un assistant générique.')

newPage(); title('11. Ordre de lancement et validation')
h2('Vague A — monétiser le conseiller')
bullet('Offre gratuite limitée à 20 contacts actifs.')
bullet('Paiement Conseiller, pipeline, centre d’actions, chronologie, import/export.')
bullet('Pilote : 30 à 50 conseillers, dont une part utilise déjà un autre CRM ou tableur.')
h2('Vague B — prouver la fidélisation')
bullet('Relances configurables, commandes, renouvellements, capture de leads, calendrier et rapports.')
bullet('Pilote : mesurer le gain de temps et les opportunités récupérées pendant au moins huit semaines.')
h2('Vague C — activer le réseau')
bullet('Invitations, comptes reliés, permissions et vues réseau.')
bullet('Pilote : cinq à dix leaders avec des équipes de tailles différentes.')
h2('Vague D — vendre le plan Leader')
bullet('Parcours 30/60/90 jours, ressources, campagnes, certifications et indicateurs agrégés.')
bullet('Pilote : comparer l’activation des nouvelles recrues avec et sans parcours Oryalis.')
h2('Vague E — ouvrir de nouveaux pays et marques')
bullet('Packs, devises, langues et premiers connecteurs officiels.')
bullet('N’ouvrir un marché qu’avec une communauté pilote et un responsable de qualité linguistique.')
h2('Critères de passage entre les phases')
callout('NE PAS SE DISPERSER', 'Une phase passe à l’échelle lorsque les utilisateurs comprennent la fonction, l’utilisent régulièrement, obtiennent un résultat mesurable et acceptent de payer. Le nombre de fonctionnalités livrées n’est pas un critère de succès.', C.amber)

newPage(); title('12. Indicateurs de pilotage')
h2('Activation')
bullet('Temps jusqu’au premier contact ajouté ou importé.')
bullet('Temps jusqu’à la première prochaine action programmée puis terminée.')
bullet('Pourcentage d’inscrits actifs après 7, 30 et 90 jours.')
h2('Valeur conseiller')
bullet('Nombre hebdomadaire d’actions relationnelles terminées.')
bullet('Pourcentage de contacts actifs possédant une prochaine action.')
bullet('Relances effectuées à temps, rendez-vous obtenus et renouvellements suivis.')
bullet('Conversion du plan Gratuit vers Conseiller et résiliation mensuelle.')
h2('Valeur équipe')
bullet('Invitations acceptées et nouveaux membres activés.')
bullet('Progression des cohortes dans les parcours 7/30/60/90 jours.')
bullet('Temps jusqu’au premier client et à la première recrue autonome.')
bullet('Conversion Conseiller vers Leader et nombre de membres actifs par équipe.')
h2('Confiance')
bullet('Demandes de suppression ou d’export traitées correctement.')
bullet('Plaintes, oppositions, contenus retirés et incidents de permission.')
bullet('Taux de réussite des synchronisations et qualité des imports.')
callout('MÉTRIQUE CENTRALE', 'Nombre d’utilisateurs actifs ayant réalisé, chaque semaine, au moins une action relationnelle utile et enregistré son résultat dans Oryalis.', C.violet)

newPage(); title('13. Risques et garde-fous')
feature('Complexité excessive', 'Risque : vouloir servir simultanément toutes les marques, tous les rangs et tous les plans de commissions.', 'Garde-fou : noyau neutre, packs configurables et lancement par communautés pilotes.', 'Les nouvelles marques nécessitent surtout de la configuration, pas de nouveaux écrans structurants.')
feature('Perception de surveillance', 'Risque : un leader voit trop d’informations sur l’activité ou les contacts de son équipe.', 'Garde-fou : données privées par défaut, partage volontaire, indicateurs agrégés et journal des accès.', 'Les membres savent expliquer précisément les informations visibles par leur leader.')
feature('Spam et réputation', 'Risque : automatisations et modèles utilisés pour solliciter massivement sans consentement.', 'Garde-fou : validation humaine, limites d’usage, préférences de canal et traçabilité.', 'Le taux de plainte reste faible et les canaux ne suspendent pas Oryalis.')
feature('Freemium trop généreux ou trop restrictif', 'Risque : personne ne paie, ou personne n’atteint la première valeur.', 'Garde-fou : tester la limite de 20 contacts et ajuster selon conversion, activation et rétention.', 'Les utilisateurs gratuits réussissent à démarrer et les actifs comprennent naturellement l’intérêt de payer.')
feature('Dépendance aux marques', 'Risque : une intégration ou un partenaire impose son vocabulaire et fragilise la neutralité.', 'Garde-fou : contrats clairs, modèle de données universel et export permanent.', 'Aucune marque n’est indispensable au fonctionnement du produit.')

newPage(); title('14. Conclusion')
p('La priorité d’Oryalis n’est pas de devenir le CRM possédant le plus de fonctions. Sa priorité est de créer une discipline de travail simple pour le conseiller, puis de rendre cette discipline transmissible à une équipe entière.')
callout('CAP PRODUIT', 'Un nouveau conseiller doit pouvoir s’inscrire, importer ses premiers contacts, comprendre ses actions prioritaires et obtenir une première victoire en moins d’une journée. Un leader doit pouvoir transmettre exactement ce parcours à cent personnes sans accéder à leurs données privées.', C.blue)
p('Le modèle gratuit limité en clients donne accès à cette première victoire. L’abonnement Conseiller finance la valeur opérationnelle quotidienne. L’abonnement Leader monétise la duplication et l’accompagnement. L’offre Entreprise viendra ensuite monétiser la conformité, l’administration et les intégrations à grande échelle.')
p('L’intelligence artificielle peut attendre. Si Oryalis réussit les fondations, la fidélisation, le réseau vivant, la duplication, la conformité et l’internationalisation, il disposera déjà d’une proposition unique et défendable à l’échelle mondiale.')

// Pieds de page, ajoutés après génération de toutes les pages.
const pages = doc.bufferedPageRange()
for (let i = 0; i < pages.count; i++) {
  doc.switchToPage(i)
  if (i === 0) continue
  const y = doc.page.height - 33
  doc.moveTo(doc.page.margins.left, y - 8).lineTo(doc.page.width - doc.page.margins.right, y - 8).strokeColor(C.line).stroke()
  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('ORYALIS — Vision et feuille de route MLM', doc.page.margins.left, y, { width: W / 2 })
  doc.text(`${i + 1} / ${pages.count}`, doc.page.width - doc.page.margins.right - 60, y, { width: 60, align: 'right' })
}

doc.end()
console.log(`PDF généré : ${OUTPUT}`)
