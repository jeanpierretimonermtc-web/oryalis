import { Stack } from 'expo-router'
import { View } from 'react-native'
import { BackButton } from '@/shared/components/ui/BackButton'
import { useTheme } from '@/shared/theme/ThemeProvider'

export default function ClientsLayout() {
  const { colors } = useTheme()
  return (
    <Stack
      screenOptions={({ navigation, route }) => ({
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text, fontWeight: '600' },
        contentStyle: { backgroundColor: colors.bg },
        // BACK-1 — même bouton retour partout ; pile vide → liste de la section, jamais "Aujourd'hui".
        headerLeft: route.name === 'index' ? undefined : () => (
          <View style={{ paddingLeft: 12, paddingRight: 8 }}>
            <BackButton
              onPress={() => {
                const routes = navigation.getState()?.routes ?? []
                if (routes.findIndex((r: { key: string }) => r.key === route.key) > 0) navigation.goBack()
                else navigation.navigate('index')
              }}
            />
          </View>
        ),
      })}
    />
  )
}
