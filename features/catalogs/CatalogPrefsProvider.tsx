import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'

interface CatalogPrefsCtx {
  activeSlugs: string[] | null
  setActiveSlugs: (slugs: string[] | null) => void
}

const CatalogPrefsContext = createContext<CatalogPrefsCtx>({
  activeSlugs: null,
  setActiveSlugs: () => {},
})

export function CatalogPrefsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user?.id

  const [activeSlugs, setActiveSlugsState] = useState<string[] | null>(null)

  useEffect(() => {
    if (!userId) return
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('active_catalog_slugs')
          .eq('id', userId)
          .single()
        if (error) throw error
        setActiveSlugsState((data as any)?.active_catalog_slugs ?? null)
      } catch (error) {
        console.error('[catalog.prefs.load]', error)
      }
    })()
  }, [userId])

  function setActiveSlugs(slugs: string[] | null) {
    setActiveSlugsState(slugs)
    if (!userId) return
    supabase
      .from('profiles')
      .update({ active_catalog_slugs: slugs })
      .eq('id', userId)
      .then(({ error }) => { if (error) console.error('[catalog.prefs]', error) })
  }

  return (
    <CatalogPrefsContext.Provider value={{ activeSlugs, setActiveSlugs }}>
      {children}
    </CatalogPrefsContext.Provider>
  )
}

export function useCatalogPrefs() {
  return useContext(CatalogPrefsContext)
}
