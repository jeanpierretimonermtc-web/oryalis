# Sécurité et rôle owner

## Principes

- Le plan commercial (`profiles.plan`) et le rôle applicatif sont deux notions distinctes.
- `advisor` donne accès aux fonctions payantes mais ne donne aucun pouvoir d’administration.
- `owner` permet d’utiliser uniquement les opérations administratives explicitement exposées.
- Le rôle owner ne donne pas un accès automatique aux contacts, notes, rendez-vous ou autres données CRM privées des utilisateurs.
- La clé `SUPABASE_SERVICE_ROLE_KEY` reste réservée aux Edge Functions, webhooks et scripts d’administration sécurisés. Elle ne doit jamais être exposée sous un nom `EXPO_PUBLIC_*`.

## Contrôles appliqués

- La table `user_roles` contient les rôles `support` et `owner` et n’est pas accessible directement aux clients.
- La table `admin_audit_log` est en écriture indirecte uniquement et conserve les opérations sensibles.
- Le rôle `authenticated` ne possède plus le droit de modifier la colonne `profiles.plan`.
- Le trigger `protect_profile_plan_trigger` constitue une seconde protection contre un changement direct du plan.
- Les politiques RLS existantes continuent d’isoler les données CRM par utilisateur.
- Le dernier owner ne peut pas retirer son propre rôle, ce qui évite un verrouillage administratif total.
- Toute RPC owner exige une session Supabase `aal2` : le rôle seul ne suffit pas sans code MFA.
- Les connexions issues d’une nouvelle installation génèrent une alerte ; seuls des condensats SHA-256 sont conservés.
- L’accès support privé exige une demande motivée, l’accord de l’utilisateur, une durée limitée et une portée explicite.

## RPC disponibles

- `get_my_app_role()` : retourne le rôle applicatif du compte connecté.
- `owner_list_users(search, limit, offset)` : liste les comptes, rôles et états d’abonnement sans exposer leurs données CRM.
- `owner_set_manual_subscription(...)` : accorde un plan Conseiller manuel, temporaire ou à vie.
- `owner_revoke_manual_subscription(...)` : révoque un abonnement manuel et resynchronise le profil.
- `owner_extend_manual_subscription(...)` : prolonge un accès manuel existant.
- `owner_set_app_role(...)` : attribue le rôle `support` ou `owner`.
- `owner_remove_app_role(...)` : retire un rôle, sauf s’il s’agit du dernier owner.
- `owner_list_admin_audit(limit, offset)` : consulte le journal des opérations administratives.

Toutes les RPC `owner_*` vérifient le rôle dans la base à chaque appel. Masquer un bouton dans l’interface ne constitue donc pas la protection principale.

## Console livrée

- `Paramètres > Administration & sécurité` : comptes, abonnements, rôles, audit, alertes et demandes support.
- `Paramètres > Confidentialité & assistance` : accord, refus et révocation par l’utilisateur.
- Chaque consultation support est auditée et notifiée à l’utilisateur.
- Les alertes sont conservées en base et affichées localement quand l’application est active.

## Actions restantes pour l’owner

1. À la première ouverture de la console, scanner le QR code avec une application Authenticator et conserver la clé en lieu sûr.
2. Déployer la nouvelle version web/mobile de l’application pour rendre les écrans accessibles.
3. Pour des alertes lorsque l’application est totalement fermée, configurer ultérieurement l’e-mail transactionnel ou Expo Push. Les alertes restent déjà consultables dans la console.

## Validation

Exécuter après une migration de sécurité :

```powershell
$env:SUPABASE_DB_PASSWORD='...'
node scripts/test-owner-security.mjs
node scripts/test-owner-console-security.mjs
```

Le test utilise des transactions annulées et vérifie la protection du plan, l’isolation des RPC owner et l’écriture du journal d’audit.
