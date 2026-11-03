import { useCallback } from 'react'
import { router, useNavigation } from 'expo-router'

// BACK-1 — retour à l'écran précédent de la MÊME section (pile de l'onglet). router.back() seul
// remonte à l'historique des onglets quand la pile est vide (ex. fiche ouverte depuis un RDV) et
// ramenait sur "Aujourd'hui" ; ici, pile vide → écran de repli de la section.
export function useStackBack(fallback: string) {
  const navigation = useNavigation()
  return useCallback(() => {
    const state = navigation.getState()
    if (state && state.index > 0) navigation.goBack()
    else router.replace(fallback as any)
  }, [navigation, fallback])
}
