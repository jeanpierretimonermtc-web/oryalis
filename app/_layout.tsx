import '@/shared/i18n'
import { useEffect, useState } from 'react'
import { View, Platform } from 'react-native'
import { Slot } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'
import { SplashAnimated } from '@/shared/components/ui/SplashAnimated'
import { useFonts } from 'expo-font'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'

export default function RootLayout() {
  useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })
  const [splashDone, setSplashDone] = useState(false)
  const { i18n } = useTranslation()

  useEffect(() => {
    const timeout = setTimeout(() => setSplashDone(true), 3000)
    return () => clearTimeout(timeout)
  }, [])

  // Web uniquement — sans ça <html lang> reste sur la valeur par défaut d'Expo et ne
  // correspond plus à la langue réellement affichée, ce qui peut faire déclencher à tort la
  // traduction automatique du navigateur (et mal retraduire des mots déjà en français, ex.
  // "Enregistrer" → "Économiser"). L'app gère elle-même sa traduction (i18next) : le meta
  // `google notranslate` demande explicitement au navigateur de ne jamais s'en mêler.
  // Fait en JS runtime (pas via app/+html.tsx, sans effet ici : ce build utilise le mode SPA
  // "single", pas le rendu statique qui seul honore ce fichier).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    document.documentElement.lang = i18n.language
    if (!document.querySelector('meta[name="google"]')) {
      const meta = document.createElement('meta')
      meta.name = 'google'
      meta.content = 'notranslate'
      document.head.appendChild(meta)
    }
  }, [i18n.language])

  return (
    <ThemeProvider>
      <AuthProvider>
        <View style={{ flex: 1 }}>
          <Slot />
          {!splashDone && <SplashAnimated onDone={() => setSplashDone(true)} />}
        </View>
      </AuthProvider>
    </ThemeProvider>
  )
}
