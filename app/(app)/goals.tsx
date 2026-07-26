import { useState, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useGoals } from '@/features/goals/useGoals'
import { Input } from '@/shared/components/ui/Input'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { GoalMetric } from '@/shared/lib/types'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { AdvisorGate } from '@/features/subscriptions/AdvisorGate'

const METRICS: GoalMetric[] = ['new_clients', 'new_distributors', 'revenue', 'appointments', 'presentations', 'followups']

function ProgressBar({ pct, accent, bg }: { pct: number; accent: string; bg: string }) {
  return (
    <View style={{ height: 8, backgroundColor: bg, borderRadius: 4, overflow: 'hidden', marginTop: 6 }}>
      <View style={{ height: 8, width: `${Math.min(100, pct)}%`, backgroundColor: accent, borderRadius: 4 }} />
    </View>
  )
}

export default function GoalsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { goals, loading, error, save, remove } = useGoals()

  const [showForm, setShowForm]   = useState(false)
  const [metric, setMetric]       = useState<GoalMetric>('new_clients')
  const [target, setTarget]       = useState('')
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const existingMetrics = new Set(goals.map(g => g.metric))
  const availableMetrics = METRICS.filter(m => !existingMetrics.has(m))

  async function handleSave() {
    setFormError(null)
    const t2 = parseInt(target, 10)
    if (!t2 || t2 <= 0) { setFormError(t('goals.error_target')); return }
    setSaving(true)
    const ok = await save(metric, t2)
    setSaving(false)
    if (ok) {
      setShowForm(false)
      setTarget('')
      setMetric(availableMetrics[0] ?? 'new_clients')
    } else {
      setFormError(t('goals.error_save'))
    }
  }

  function accentForPct(pct: number) {
    if (pct >= 100) return colors.success
    if (pct >= 60)  return colors.primary
    if (pct >= 30)  return colors.warning
    return colors.danger
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('goals.title'))} />
      <AdvisorGate feature={t('subscription.features.reports')}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <Text style={styles.subtitle}>{t('goals.subtitle')}</Text>

        {/* ── Goals list ─────────────────────────────────── */}
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : goals.length === 0 && !showForm ? (
          <Text style={styles.empty}>{t('goals.empty')}</Text>
        ) : (
          goals.map(g => {
            const accent = accentForPct(g.pct)
            const bgBar  = colors.bgDim
            return (
              <View key={g.id} style={styles.goalCard}>
                <View style={styles.goalTop}>
                  <Text style={styles.goalMetric}>{t(`goals.metrics.${g.metric}`)}</Text>
                  <TouchableOpacity onPress={() => remove(g.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.deleteBtn}>{t('common.delete')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.goalValues}>
                  <Text style={[styles.goalCurrent, { color: accent }]}>{g.current}</Text>
                  <Text style={styles.goalSep}>/</Text>
                  <Text style={styles.goalTarget}>{g.target}</Text>
                  <View style={[styles.pctChip, { backgroundColor: accent + '22' }]}>
                    <Text style={[styles.pctText, { color: accent }]}>{g.pct}%</Text>
                  </View>
                </View>
                <ProgressBar pct={g.pct} accent={accent} bg={bgBar} />
              </View>
            )
          })
        )}

        {/* ── Add form ───────────────────────────────────── */}
        {showForm ? (
          <View style={styles.form}>
            <Text style={styles.formTitle}>{t('goals.add')}</Text>

            <Text style={styles.fieldLabel}>{t('goals.metric_label')}</Text>
            <View style={styles.metricPicker}>
              {(availableMetrics.length > 0 ? availableMetrics : METRICS).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.metricChip, metric === m && styles.metricChipActive]}
                  onPress={() => setMetric(m)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.metricChipText, metric === m && styles.metricChipTextActive]}>
                    {t(`goals.metrics.${m}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label={t('goals.target_label')}
              value={target}
              onChangeText={setTarget}
              keyboardType="number-pad"
              placeholder="5"
            />

            {formError ? <Text style={styles.error}>{formError}</Text> : null}

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); setFormError(null) }}>
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Button label={t('common.save')} onPress={handleSave} loading={saving} />
              </View>
            </View>
          </View>
        ) : availableMetrics.length > 0 ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => { setMetric(availableMetrics[0]); setShowForm(true) }} activeOpacity={0.8}>
            <Text style={styles.addBtnText}>+ {t('goals.add')}</Text>
          </TouchableOpacity>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={{ height: 40 }} />
      </ScrollView>
      </AdvisorGate>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },
  content:   { padding: 16, gap: 12, maxWidth: 720, alignSelf: 'center', width: '100%' },

  subtitle:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
  empty:     { textAlign: 'center', color: colors.textTertiary, fontSize: 14, fontFamily: fonts.body, marginTop: 32 },

  goalCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  goalTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  goalMetric:  { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  deleteBtn:   { fontSize: 12, fontFamily: fonts.medium, color: colors.danger },
  goalValues:  { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  goalCurrent: { fontSize: 28, fontFamily: fonts.display, lineHeight: 34 },
  goalSep:     { fontSize: 16, color: colors.textTertiary, fontFamily: fonts.body },
  goalTarget:  { fontSize: 18, fontFamily: fonts.medium, color: colors.textSecondary },
  pctChip:     { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pctText:     { fontSize: 12, fontFamily: fonts.bold },

  addBtn: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },

  form: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formTitle:   { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  fieldLabel:  { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  metricPicker:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricChip:  { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  metricChipActive:    { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  metricChipText:      { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  metricChipTextActive:{ color: colors.primary, fontFamily: fonts.semibold },
  error:       { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  formBtns:    { flexDirection: 'row', gap: 10 },
  cancelBtn:   { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },
  })
}
