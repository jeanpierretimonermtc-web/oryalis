// ORDER-BUSINESS-3.6 — "Suivi MLM" : répond à "combien ai-je généré ?" à partir des commandes
// enregistrées, jamais "combien vaut ce produit ?" (Réglages -> Mes valeurs MLM, écran distinct,
// rapport §2). UI -> useMlmTracking -> mlmTrackingService -> Supabase, aucune couche supplémentaire.
import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native'
import { Stack, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useMlmTracking } from '@/features/catalogs/useMlmTracking'
import type { MlmTrackingPeriodPreset } from '@/features/catalogs/mlmTrackingService'
import { formatMlmValue } from '@/features/catalogs/mlmTrackingService'
import { useCatalogs } from '@/features/catalogs/useCatalog'
import { MlmTrackingMetricDetailModal } from '@/features/catalogs/MlmTrackingMetricDetailModal'
import { DateInput } from '@/shared/components/ui/DateInput'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import type { MlmTrackingMetric } from '@/features/catalogs/mlmTrackingService'

const PRESETS: MlmTrackingPeriodPreset[] = ['this_month', 'last_month', 'last_3_months', 'this_year', 'custom']

function useLocale() {
  const { i18n } = useTranslation()
  return i18n.language === 'fr' ? 'fr-FR' : 'en-US'
}

// Libellé de période affiché sous le titre — "Mois Année" pour un preset mensuel unique, sinon la
// plage de dates. Purement d'affichage (aucun impact sur le calcul, déjà fait par le service).
function usePeriodLabel(preset: MlmTrackingPeriodPreset, range: { startDate: string; endDate: string }) {
  const locale = useLocale()
  return useMemo(() => {
    if (preset === 'this_month' || preset === 'last_month') {
      const d = new Date(range.startDate + 'T00:00:00')
      const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d)
      return label.charAt(0).toUpperCase() + label.slice(1)
    }
    const start = new Date(range.startDate + 'T00:00:00')
    const end = new Date(range.endDate + 'T00:00:00')
    const fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    return `${fmt.format(start)} – ${fmt.format(end)}`
  }, [preset, range.startDate, range.endDate, locale])
}

function MetricCard({ metric, onPress, styles, t, locale }: {
  metric: MlmTrackingMetric
  onPress: () => void
  styles: ReturnType<typeof makeStyles>
  t: (key: string, opts?: Record<string, unknown>) => string
  locale: string
}) {
  const fmt = (v: number) => formatMlmValue(v, locale)
  const hasReturns = metric.returned > 0
  return (
    <TouchableOpacity style={styles.metricCard} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{metric.label}</Text>
        <View style={[styles.originBadge, metric.origin === 'official' ? styles.officialBadge : styles.personalBadge]}>
          <Text style={[styles.originBadgeText, metric.origin === 'official' ? styles.officialBadgeText : styles.personalBadgeText]}>
            {metric.origin === 'official' ? t('mlm_tracking.origin_official') : t('mlm_tracking.origin_personal')}
          </Text>
        </View>
      </View>
      <Text style={styles.metricNet}>{t('mlm_tracking.net_value', { value: fmt(metric.net) })}</Text>
      {hasReturns ? (
        <Text style={styles.metricSub}>{t('mlm_tracking.gross_returned_summary', { gross: fmt(metric.gross), returned: fmt(metric.returned) })}</Text>
      ) : null}
    </TouchableOpacity>
  )
}

export default function MlmTrackingScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = useLocale()
  const userId = session?.user.id

  const {
    metrics, loading, preset, setPreset, range, customRange, setCustomRange, isCustomRangeInvalid,
    catalogId, setCatalogId,
  } = useMlmTracking(userId)
  const { catalogs } = useCatalogs()
  const periodLabel = usePeriodLabel(preset, range)
  const [detailMetric, setDetailMetric] = useState<MlmTrackingMetric | null>(null)

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('mlm_tracking.title') }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>{t('mlm_tracking.subtitle')}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {PRESETS.map(p => (
            <TouchableOpacity key={p} style={[styles.filterChip, preset === p && styles.filterChipActive]} onPress={() => setPreset(p)} activeOpacity={0.8}>
              <Text style={[styles.filterChipText, preset === p && styles.filterChipTextActive]}>{t(`mlm_tracking.period_${p}`)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {preset === 'custom' ? (
          <View style={styles.customRangeRow}>
            <View style={{ flex: 1 }}>
              <DateInput label={t('mlm_tracking.start_date')} value={customRange.startDate} onChangeValue={v => setCustomRange(r => ({ ...r, startDate: v }))} />
            </View>
            <View style={{ flex: 1 }}>
              <DateInput label={t('mlm_tracking.end_date')} value={customRange.endDate} onChangeValue={v => setCustomRange(r => ({ ...r, endDate: v }))} />
            </View>
          </View>
        ) : null}
        {isCustomRangeInvalid ? <Text style={styles.error}>{t('mlm_tracking.custom_range_error')}</Text> : null}

        <Text style={styles.periodLabel}>{periodLabel}</Text>

        {catalogs.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <TouchableOpacity style={[styles.filterChip, !catalogId && styles.filterChipActive]} onPress={() => setCatalogId(null)} activeOpacity={0.8}>
              <Text style={[styles.filterChipText, !catalogId && styles.filterChipTextActive]}>{t('mlm_tracking.all_catalogs')}</Text>
            </TouchableOpacity>
            {catalogs.map(c => (
              <TouchableOpacity key={c.id} style={[styles.filterChip, catalogId === c.id && styles.filterChipActive]} onPress={() => setCatalogId(c.id)} activeOpacity={0.8}>
                <Text style={[styles.filterChipText, catalogId === c.id && styles.filterChipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : metrics.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              message={t('mlm_tracking.empty_title')}
              icon="📊"
              actionLabel={t('mlm_tracking.configure_link')}
              onAction={() => router.push('/(app)/settings-mlm-values' as any)}
            />
            <Text style={styles.emptySubtext}>{t('mlm_tracking.empty_text')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.cardsGrid}>
              {metrics.map(m => (
                <MetricCard key={m.key} metric={m} onPress={() => setDetailMetric(m)} styles={styles} t={t} locale={locale} />
              ))}
            </View>
            <TouchableOpacity onPress={() => router.push('/(app)/settings-mlm-values' as any)} activeOpacity={0.7} style={styles.configLinkRow}>
              <Text style={styles.configLink}>{t('mlm_tracking.configure_link')}</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {detailMetric ? (
        <MlmTrackingMetricDetailModal metric={detailMetric} periodLabel={periodLabel} onClose={() => setDetailMetric(null)} />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%' },
    hint: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },

    filterRow: { gap: 8, paddingVertical: 2 },
    filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
    filterChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    filterChipText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.textSecondary },
    filterChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },

    customRangeRow: { flexDirection: 'row', gap: 12 },
    error: { fontSize: 12, fontFamily: fonts.medium, color: colors.danger },

    periodLabel: { fontSize: 20, fontFamily: fonts.display, color: colors.text },

    cardsGrid: { gap: 12 },
    metricCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 6 },
    metricHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    metricLabel: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, flex: 1 },
    metricNet: { fontSize: 26, fontFamily: fonts.display, color: colors.primary },
    metricSub: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },

    originBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    officialBadge: { backgroundColor: colors.secondaryLight },
    personalBadge: { backgroundColor: colors.tertiaryLight },
    originBadgeText: { fontSize: 10.5, fontFamily: fonts.bold },
    officialBadgeText: { color: colors.secondary },
    personalBadgeText: { color: colors.tertiary },

    emptyWrap: { gap: 10, alignItems: 'center', paddingVertical: 12 },
    emptySubtext: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', lineHeight: 18, paddingHorizontal: 12 },
    configLink: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary, textAlign: 'center' },
    configLinkRow: { paddingTop: 4 },
  })
}
