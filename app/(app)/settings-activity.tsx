import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Input } from '@/shared/components/ui/Input'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ActivityType } from '@/shared/lib/types'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'

const OPTIONS: { value: ActivityType; label: string; emoji: string; desc: string }[] = [
  { value: 'generic',   emoji: '🔵', label: 'Générique',    desc: 'CRM polyvalent pour tout revendeur' },
  { value: 'doterra',   emoji: '🌿', label: 'doTERRA',       desc: 'Huiles essentielles, LRP, réseau' },
  { value: 'zinzino',   emoji: '💊', label: 'Zinzino',       desc: 'Nutrition, abonnements, bilans' },
  { value: 'herbalife', emoji: '🏃', label: 'Herbalife',     desc: 'Nutrition sportive, perte de poids' },
  { value: 'custom',    emoji: '✏️', label: 'Autre marque',  desc: 'Saisissez le nom de votre marque' },
  { value: 'multi',     emoji: '🌐', label: 'Multi-marques', desc: 'Plusieurs marques simultanément' },
]

export default function ActivitySettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { profile: bizProfile, saveActivityType, isModuleActive, saveLrpName } = useAppConfig()

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.section_activity'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>Choisissez votre type d'activité principale. Cela personnalise les modules et les libellés.</Text>
        {OPTIONS.map(opt => {
          const active = bizProfile.activity_type === opt.value
          return (
            <TouchableOpacity key={opt.value} style={[styles.option, active && styles.optionActive]} onPress={() => saveActivityType(opt.value)} activeOpacity={0.75}>
              <Text style={styles.optionEmoji}>{opt.emoji}</Text>
              <View style={styles.optionBody}>
                <Text style={[styles.optionLabel, active && { color: colors.primary }]}>{opt.label}</Text>
                <Text style={styles.optionDesc}>{opt.desc}</Text>
              </View>
              {active && <Text style={{ color: colors.primary, fontSize: 18 }}>✓</Text>}
            </TouchableOpacity>
          )
        })}
        {bizProfile.activity_type === 'custom' && (
          <Input label="Nom de votre marque" value={bizProfile.custom_brand_name ?? ''} onChangeText={v => saveActivityType('custom', v)} placeholder="Ex : MonBienÊtre" />
        )}
        {isModuleActive('renewals_lrp') && (
          <Input
            label={t('settings.custom_lrp_name_label')}
            value={bizProfile.custom_lrp_name ?? ''}
            onChangeText={saveLrpName}
            placeholder={t('settings.custom_lrp_name_placeholder')}
          />
        )}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>Oryalis est indépendant. Les marques renseignées servent uniquement à organiser votre activité personnelle. Oryalis n'est ni affilié, ni approuvé, ni sponsorisé par ces marques.</Text>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 10, maxWidth: 720, alignSelf: 'center', width: '100%', paddingBottom: 40 },
  hint: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: colors.border },
  optionActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionEmoji: { fontSize: 24 },
  optionBody: { flex: 1 },
  optionLabel: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  optionDesc:  { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 2 },
  disclaimer: { backgroundColor: colors.bgDim, borderRadius: 10, padding: 12, marginTop: 4 },
  disclaimerText: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 16 },
  })
}
