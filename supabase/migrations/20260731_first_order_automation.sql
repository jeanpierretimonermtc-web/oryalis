-- L'automatisation "Nouveau client" (auto_new_client) se déclenchait à la création de
-- fiche, avant tout achat — son contenu (accueil, vérification réception produits) n'a
-- de sens qu'au moment du premier achat réel. Elle devient "Première commande"
-- (auto_first_order), déclenchée uniquement lors du tout premier achat du client.
-- Renomme la valeur dans les tableaux existants pour que l'interrupteur déjà activé par
-- l'utilisateur (sous l'ancien nom) reste activé sous le nouveau.

UPDATE public.user_business_profiles
  SET active_modules = array_replace(active_modules, 'auto_new_client', 'auto_first_order')
  WHERE 'auto_new_client' = ANY(active_modules);
