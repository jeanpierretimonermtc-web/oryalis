# Oryalis — Mise en production des abonnements

Le code et la base sont prêts, mais un abonnement réel nécessite des comptes marchands et identifiants externes. Aucun secret ne doit être placé dans une variable `EXPO_PUBLIC_*`.

## Architecture retenue

- Web : Stripe Checkout créé dynamiquement par une fonction Supabase authentifiée.
- iOS : StoreKit via RevenueCat.
- Android : Google Play Billing via RevenueCat.
- Source de vérité Oryalis : table `subscriptions` alimentée exclusivement par les webhooks.
- Cache d’interface : `profiles.plan`, synchronisé automatiquement depuis `subscriptions`.

`EXPO_PUBLIC_ADVISOR_CHECKOUT_URL` n’est plus nécessaire : une URL Stripe Checkout unique et authentifiée est créée pour chaque tentative de paiement. C’est plus sûr qu’un Payment Link statique et permet de rattacher l’achat au bon utilisateur.

## Configuration Stripe Web

1. Créer le produit « Oryalis Conseiller » dans Stripe en mode production.
2. Créer deux prix récurrents : mensuel et annuel.
3. Configurer les secrets des fonctions Supabase :
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_ADVISOR_MONTHLY_PRICE_ID`
   - `STRIPE_ADVISOR_YEARLY_PRICE_ID`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_URL=https://oryalis.vercel.app`
4. Déployer `create-checkout-session`, `create-billing-portal` et `stripe-webhook`.
5. Dans Stripe, déclarer l’URL `.../functions/v1/stripe-webhook`.
6. Écouter au minimum `checkout.session.completed` et `customer.subscription.*`.
7. Activer et configurer le portail client Stripe.

## Configuration iOS et Android

1. Créer l’abonnement mensuel et annuel dans App Store Connect.
2. Créer les produits équivalents et leurs offres dans Google Play Console.
3. Créer un projet RevenueCat et connecter les deux boutiques.
4. Créer l’entitlement `advisor`.
5. Créer une offering courante contenant un package mensuel et annuel.
6. Ajouter dans l’environnement de build EAS :
   - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
   - `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
7. Configurer dans RevenueCat le webhook `.../functions/v1/revenuecat-webhook` et son en-tête Authorization.
8. Configurer le même secret côté Supabase sous `REVENUECAT_WEBHOOK_AUTH`.
9. Déployer `revenuecat-webhook`.
10. Créer un nouveau development build : les achats intégrés ne fonctionnent pas dans Expo Go.

## Tests obligatoires avant publication

- Stripe en mode test : achat mensuel, annuel, échec, résiliation et renouvellement.
- StoreKit Sandbox : achat, restauration après réinstallation et résiliation.
- Google Play test interne : achat, restauration, grâce, échec de paiement et résiliation.
- Vérifier que le webhook met à jour `subscriptions`, puis `profiles.plan`.
- Vérifier qu’un appel client direct ne peut jamais écrire dans `subscriptions`.
- Tester avec le compte de démonstration fourni aux équipes de revue Apple et Google.

## Conformité boutiques

Le bouton Stripe n’est présenté que sur le Web. Les versions natives utilisent les achats intégrés et proposent une restauration visible ainsi qu’un accès à la gestion/résiliation.

