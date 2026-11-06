import { useMemo } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'

// Page de retour de Google : transmet le résultat à la fenêtre de l'appli, puis se referme.
WebBrowser.maybeCompleteAuthSession()

export default function GoogleOAuthCallback() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  })
}
