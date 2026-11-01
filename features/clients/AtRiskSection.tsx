import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { useAtRiskClients } from './useAtRiskClients'
import type { RiskReason } from './riskService'

const SHOWN = 5

// AT-RISK-1 — accueil : les clients qui décrochent, avec la raison en clair.
export function AtRiskSection() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { items } = useAtRiskClients()
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) return null

  const reasonText = (r: RiskReason) =>
    r.kind === 'no_reorder' ? t('risk.no_reorder', { days: r.days })
      : r.kind === 'program_stopped' ? t(r.status === 'paused' ? 'risk.program_paused' : 'risk.program_cancelled', { days: r.days })
      : t('risk.no_contact', { days: r.days })

  const shown = expanded ? items : items.slice(0, SHOWN)

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>⚠️ {t('risk.title')} · {items.length}</Text>
        <Text style={styles.subtitle}>{t('risk.subtitle')}</Text>
      </View>
      <View style={styles.card}>
        {shown.map((c, i) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.row, i > 0 && styles.rowBorder]}
            onPress={() => router.push(`/(app)/clients/${c.id}` as any)}
            activeOpacity={0.75}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>{c.full_name}</Text>
              <Text style={styles.reasons} numberOfLines={2}>{c.reasons.map(reasonText).join(' · ')}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
        {items.length > SHOWN ? (
          <TouchableOpacity style={[styles.row, styles.rowBorder]} onPress={() => setExpanded(v => !v)} activeOpacity={0.7}>
            <Text style={styles.more}>{expanded ? t('risk.show_less') : t('risk.show_more', { count: items.length - SHOWN })}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: { gap: 10 },
    header: { gap: 2 },
    title: { fontSize: 18, fontFamily: fonts.display, color: colors.text },
    subtitle: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.warning, overflow: 'hidden', ...SOFT_CARD_SHADOW },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    name: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    reasons: { fontSize: 12.5, fontFamily: fonts.body, color: colors.warning },
    chevron: { fontSize: 18, color: colors.textTertiary },
    more: { flex: 1, textAlign: 'center', fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
  })
}
