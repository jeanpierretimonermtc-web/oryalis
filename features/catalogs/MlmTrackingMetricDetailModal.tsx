// ORDER-BUSINESS-3.6 §24/§25 — détail léger d'une métrique de suivi : bruts/retournés/nets pour
// la période active, puis répartition par catalogue UNIQUEMENT si la métrique en couvre plusieurs
// (rapport §25 : "si une métrique couvre plusieurs catalogues"). Jamais de graphique (§24 : "pas
// encore besoin"), jamais de somme entre catalogues affichée comme une devise (§45 : ce sont des
// points/volumes, jamais du monétaire).
import { useMemo } from 'react'
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { MlmTrackingMetric } from '@/features/catalogs/mlmTrackingService'
import { formatMlmValue } from '@/features/catalogs/mlmTrackingService'

interface Props {
  metric: MlmTrackingMetric
  periodLabel: string
  onClose: () => void
}

export function MlmTrackingMetricDetailModal({ metric, periodLabel, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const fmt = (v: number) => formatMlmValue(v, locale)

  const hasReturns = metric.returned > 0
  const showCatalogBreakdown = metric.catalogBreakdown.length > 1

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{metric.label}</Text>
              <Text style={styles.periodText}>{periodLabel}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.originBadge, metric.origin === 'official' ? styles.officialBadge : styles.personalBadge]}>
            <Text style={[styles.originBadgeText, metric.origin === 'official' ? styles.officialBadgeText : styles.personalBadgeText]}>
              {metric.origin === 'official' ? t('mlm_tracking.origin_official') : t('mlm_tracking.origin_personal')}
            </Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.totalsCard}>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>{t('mlm_tracking.gross')}</Text>
                <Text style={styles.totalsValue}>{fmt(metric.gross)}</Text>
              </View>
              {hasReturns ? (
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>{t('mlm_tracking.returned')}</Text>
                  <Text style={[styles.totalsValue, styles.returnedValue]}>-{fmt(metric.returned)}</Text>
                </View>
              ) : null}
              <View style={[styles.totalsRow, styles.netRow]}>
                <Text style={styles.netLabel}>{t('mlm_tracking.net')}</Text>
                <Text style={styles.netValue}>{fmt(metric.net)}</Text>
              </View>
            </View>

            {showCatalogBreakdown ? (
              <View style={styles.breakdownSection}>
                <Text style={styles.breakdownTitle}>{t('mlm_tracking.by_catalog')}</Text>
                <View style={styles.breakdownCard}>
                  {metric.catalogBreakdown.map((b, i) => (
                    <View key={b.catalogId ?? 'none'} style={[styles.breakdownRow, i > 0 && styles.breakdownRowBorder]}>
                      <Text style={styles.breakdownName}>{b.catalogName ?? t('mlm_tracking.catalog_unknown')}</Text>
                      <Text style={styles.breakdownValue}>{fmt(b.net)}</Text>
                    </View>
                  ))}
                  <View style={[styles.breakdownRow, styles.breakdownRowBorder, styles.breakdownTotalRow]}>
                    <Text style={styles.breakdownTotalName}>{t('mlm_tracking.total')}</Text>
                    <Text style={styles.breakdownTotalValue}>{fmt(metric.net)}</Text>
                  </View>
                </View>
              </View>
            ) : null}

            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24, gap: 14, maxHeight: '80%' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { fontSize: 18, fontFamily: fonts.bold, color: colors.text },
    periodText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 2 },

    originBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    officialBadge: { backgroundColor: colors.secondaryLight },
    personalBadge: { backgroundColor: colors.tertiaryLight },
    originBadgeText: { fontSize: 11, fontFamily: fonts.bold },
    officialBadgeText: { color: colors.secondary },
    personalBadgeText: { color: colors.tertiary },

    totalsCard: { backgroundColor: colors.bgDim, borderRadius: 14, padding: 16, gap: 10 },
    totalsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    totalsLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
    totalsValue: { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
    returnedValue: { color: colors.danger },
    netRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 2 },
    netLabel: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
    netValue: { fontSize: 22, fontFamily: fonts.display, color: colors.primary },

    breakdownSection: { marginTop: 16, gap: 8 },
    breakdownTitle: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
    breakdownCard: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
    breakdownRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    breakdownName: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    breakdownValue: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },
    breakdownTotalRow: { backgroundColor: colors.bgDim },
    breakdownTotalName: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
    breakdownTotalValue: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  })
}
