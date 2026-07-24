# Pilote Oryalis — 10 conseillers pendant 4 semaines

## Préparation

1. Recruter 10 conseillers actifs représentant au moins trois MLM et deux niveaux d’expérience.
2. Créer leur compte sans données de démonstration et les ajouter à `pilot_participants` depuis Supabase.
3. Ne pas les former avant la première session : observer l’inscription, l’onboarding, le premier contact et la première action.
4. Recueillir leur consentement pour les entretiens et l’analyse des événements produit.

## Entretiens

- Jour 1 : compréhension du produit, première valeur, blocages et temps nécessaire.
- Jour 7 : usage réel, actions réalisées, fonctions manquantes et confiance dans les données.
- Jour 30 : rétention, bénéfice concret, prix acceptable et volonté réelle de payer.

## Indicateurs de décision

- Activation : onboarding terminé + premier contact + première action programmée sous 24 heures.
- Valeur : première action terminée sous 7 jours.
- Rétention : activité enregistrée pendant au moins 3 semaines sur 4.
- Monétisation : offre consultée, checkout commencé et abonnement activé.
- Validation conseillée : au moins 7/10 activés, 6/10 retenus à J30 et 4/10 prêts à payer 14,90 €/mois.

## Requête de suivi

```sql
select pp.user_id, pp.started_at, pp.willingness_to_pay,
       array_agg(distinct pe.event_name) as events,
       max(pe.created_at) as last_activity
from pilot_participants pp
left join product_events pe on pe.user_id = pp.user_id
where pp.cohort = 'pilot-1'
group by pp.user_id, pp.started_at, pp.willingness_to_pay
order by pp.started_at;
```

Ne pas conclure le pilote avant quatre semaines complètes et les entretiens J30.
