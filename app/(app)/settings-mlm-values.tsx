// ORDER-BUSINESS-3.5 — "Mes valeurs MLM" : voir les valeurs officielles des catalogues, créer/
// gérer ses propres valeurs personnelles (PV, Credits, Points... — jamais de derived metrics ni
// de règles de compensation, voir mlmMetricService.ts). UI -> useMlmMetrics -> mlmMetricService
// -> Supabase, aucune couche supplémentaire créée pour ce lot.
import { useState, useMemo, useRef, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Modal, Switch, StyleSheet } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { X, Check } from 'lucide-react-native'
import { useAuth } from '@/features/auth/AuthProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { useMlmMetrics } from '@/features/catalogs/useMlmMetrics'
import { createPersonalMetricDefinition, DuplicateMetricCodeError, ScopeRequiresCatalogError, CatalogNotAccessibleError } from '@/features/catalogs/mlmMetricService'
import type { MlmMetricDefinitionOverview } from '@/features/catalogs/mlmMetricService'
import { getCatalogs } from '@/features/catalogs/catalogService'
import type { Catalog, MlmMetricScope } from '@/shared/lib/types'
import { MlmMetricProductsModal } from '@/features/catalogs/MlmMetricProductsModal'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/EmptyState'

// ORDER-BUSINESS-3.5.2 §16/§30/§31 — carte de la liste : catalogNames est TOUJOURS un tableau
// (0..N noms), jamais un champ singulier — "doTERRA · Zinzino" pour une personnelle scope='selected',
// un seul nom pour une officielle, rien pour une personnelle scope='all' (implicite : tous). Le
// type de valeur ("Valeur produit numérique") est affiché pour TOUTES les métriques (§3/§30/§31),
// en information secondaire, jamais concurrente du nom.
function MetricRow({ definition, onPress, styles, t }: {
  definition: MlmMetricDefinitionOverview
  onPress: () => void
  styles: ReturnType<typeof makeStyles>
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const isOfficial = definition.origin === 'official'
  return (
    <TouchableOpacity style={styles.metricRow} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.metricInfo}>
        <Text style={styles.metricName}>{definition.display_name}</Text>
        <View style={styles.metricMetaRow}>
          <View style={[styles.originBadge, isOfficial ? styles.officialBadge : styles.personalBadge]}>
            <Text style={[styles.originBadgeText, isOfficial ? styles.officialBadgeText : styles.personalBadgeText]}>
              {isOfficial ? t('mlm_values.origin_official') : t('mlm_values.origin_personal')}
            </Text>
          </View>
          {!isOfficial ? (
            <View style={[styles.statusBadge, definition.active ? styles.statusActiveBadge : styles.statusInactiveBadge]}>
              <Text style={[styles.statusBadgeText, definition.active ? styles.statusActiveText : styles.statusInactiveText]}>
                {definition.active ? t('mlm_values.status_active') : t('mlm_values.status_inactive')}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.valueTypeText}>{t('mlm_values.value_type_value')}</Text>
        {definition.catalogNames.length > 0 ? (
          <Text style={styles.catalogNameText}>{definition.catalogNames.join(' · ')}</Text>
        ) : !isOfficial ? (
          <Text style={styles.catalogNameText}>{t('mlm_values.scope_all_catalogs')}</Text>
        ) : null}
        <Text style={styles.countText}>
          {isOfficial
            ? t('mlm_values.products_count', { count: definition.configuredProductCount })
            : t('mlm_values.products_configured_count', { count: definition.configuredProductCount })}
        </Text>
      </View>
      {!isOfficial ? (
        <View style={styles.editBtn}><Text style={styles.editBtnText}>{t('mlm_values.edit_button')}</Text></View>
      ) : null}
    </TouchableOpacity>
  )
}

function CreateMlmMetricModal({ userId, onClose, onCreated }: { userId: string; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [name, setName] = useState('')
  const [scope, setScope] = useState<MlmMetricScope>('all')
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  // ORDER-BUSINESS-3.5.2 §2/§9 — remplace le chip à sélection UNIQUE par une case à cocher par
  // catalogue : 0, 1 ou plusieurs catalogues peuvent être sélectionnés dès la création (§14
  // propose la même liste à cocher pour la modification ultérieure — un seul composant visuel,
  // jamais deux implémentations qui pourraient diverger).
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set())
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [catalogsLoaded, setCatalogsLoaded] = useState(false)
  // ORDER-BUSINESS-3.5.1 §16 — même garde qu'MlmMetricProductsModal : évite un setState après
  // fermeture rapide de cette modale (aucun impact sur l'écriture elle-même, jamais annulée).
  const isMountedRef = useRef(true)
  useEffect(() => () => { isMountedRef.current = false }, [])

  function openCatalogScope() {
    setScope('selected')
    if (!catalogsLoaded) {
      getCatalogs(userId).then(list => { if (isMountedRef.current) { setCatalogs(list); setCatalogsLoaded(true) } }).catch(() => {})
    }
  }

  function toggleCatalog(catalogId: string) {
    setSelectedCatalogIds(prev => {
      const next = new Set(prev)
      if (next.has(catalogId)) next.delete(catalogId)
      else next.add(catalogId)
      return next
    })
  }

  async function handleCreate() {
    if (!name.trim()) return
    if (scope === 'selected' && selectedCatalogIds.size === 0) return
    setSaving(true)
    setErrorMsg(null)
    try {
      await createPersonalMetricDefinition(userId, {
        displayName: name.trim(),
        scope,
        catalogIds: scope === 'selected' ? [...selectedCatalogIds] : undefined,
        active,
      })
      onCreated()
      onClose()
    } catch (e) {
      // ORDER-BUSINESS-3.5.2.1 §5 — l'erreur technique complète reste loggée ; seul un message
      // utilisateur mappé et sans SQL/nom de table est affiché.
      console.error(e)
      if (isMountedRef.current) {
        setErrorMsg(
          e instanceof DuplicateMetricCodeError ? t('mlm_values.create_error_duplicate')
          : e instanceof ScopeRequiresCatalogError ? t('mlm_values.scope_error_no_catalog')
          : e instanceof CatalogNotAccessibleError ? t('mlm_values.scope_error_not_accessible')
          : t('mlm_values.create_error_generic'),
        )
      }
    } finally {
      if (isMountedRef.current) setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => { if (!saving) onClose() }}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('mlm_values.create_title')}</Text>
            <TouchableOpacity onPress={() => { if (!saving) onClose() }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>{t('mlm_values.name_label')}</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder={t('mlm_values.name_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />

          {/* ORDER-BUSINESS-3.5.2 §5/§6/§7 — le TYPE n'est jamais choisi par l'utilisateur : il
              n'existe qu'UN type fonctionnel en V1 (source product metric), affiché en lecture
              seule pour éviter toute confusion avec un futur pourcentage/commission. */}
          <Text style={styles.fieldLabel}>{t('mlm_values.value_type_label')}</Text>
          <Text style={styles.valueTypeReadOnly}>{t('mlm_values.value_type_value')}</Text>
          <Text style={styles.scopeHint}>{t('mlm_values.value_type_help')}</Text>
          <Text style={styles.valueTypeExamples}>{t('mlm_values.value_type_examples')}</Text>
          <Text style={styles.valueTypeExamples}>{t('mlm_values.value_type_disclaimer')}</Text>

          <Text style={styles.fieldLabel}>{t('mlm_values.scope_label')}</Text>
          <TouchableOpacity style={styles.radioRow} onPress={() => setScope('all')} activeOpacity={0.8}>
            <View style={[styles.radioDot, scope === 'all' && styles.radioDotActive]} />
            <Text style={styles.radioLabel}>{t('mlm_values.scope_all_catalogs')}</Text>
          </TouchableOpacity>
          {scope === 'all' ? <Text style={styles.scopeHint}>{t('mlm_values.scope_hint_global')}</Text> : null}
          <TouchableOpacity style={styles.radioRow} onPress={openCatalogScope} activeOpacity={0.8}>
            <View style={[styles.radioDot, scope === 'selected' && styles.radioDotActive]} />
            <Text style={styles.radioLabel}>{t('mlm_values.scope_specific_catalog')}</Text>
          </TouchableOpacity>
          {scope === 'selected' ? (
            <>
              <Text style={styles.scopeHint}>{t('mlm_values.scope_hint_catalog')}</Text>
              <View style={styles.checklistWrap}>
                {catalogs.map(c => {
                  const checked = selectedCatalogIds.has(c.id)
                  return (
                    <TouchableOpacity key={c.id} style={styles.checkboxRow} onPress={() => toggleCatalog(c.id)} activeOpacity={0.8}>
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                        {checked ? <Check size={13} color="#fff" /> : null}
                      </View>
                      <Text style={styles.checkboxLabel}>{c.name}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </>
          ) : null}

          <View style={styles.switchRow}>
            <Text style={styles.fieldLabel}>{t('mlm_values.status_label')}</Text>
            <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.secondary }} />
          </View>

          {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

          <Button
            label={t('mlm_values.create_confirm')}
            onPress={handleCreate}
            loading={saving}
            disabled={!name.trim() || (scope === 'selected' && selectedCatalogIds.size === 0)}
          />
        </View>
      </View>
    </Modal>
  )
}

export default function MlmValuesSettingsScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const userId = session?.user.id

  const { officialMetrics, personalMetrics, loading, reload } = useMlmMetrics(userId)
  const [showCreate, setShowCreate] = useState(false)
  const [detailMetric, setDetailMetric] = useState<MlmMetricDefinitionOverview | null>(null)

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('mlm_values.title'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>{t('mlm_values.help_text')}</Text>

        <Button label={t('mlm_values.add_button')} onPress={() => setShowCreate(true)} />

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>{t('mlm_values.section_catalog_values')}</Text>
            {officialMetrics.length === 0 ? (
              <EmptyState message={t('mlm_values.empty_catalog_values')} icon="🏷️" />
            ) : (
              <View style={styles.card}>
                {officialMetrics.map((m, i) => (
                  <View key={m.id} style={i > 0 ? styles.rowBorder : undefined}>
                    <MetricRow definition={m} onPress={() => setDetailMetric(m)} styles={styles} t={t} />
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionLabel}>{t('mlm_values.section_my_values')}</Text>
            {personalMetrics.length === 0 ? (
              <EmptyState message={t('mlm_values.empty_personal_values')} icon="✨" />
            ) : (
              <View style={styles.card}>
                {personalMetrics.map((m, i) => (
                  <View key={m.id} style={i > 0 ? styles.rowBorder : undefined}>
                    <MetricRow definition={m} onPress={() => setDetailMetric(m)} styles={styles} t={t} />
                  </View>
                ))}
              </View>
            )}
          </>
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      {showCreate && userId ? (
        <CreateMlmMetricModal userId={userId} onClose={() => setShowCreate(false)} onCreated={reload} />
      ) : null}

      {detailMetric && userId ? (
        <MlmMetricProductsModal
          userId={userId}
          definition={detailMetric}
          onClose={() => setDetailMetric(null)}
          onChanged={reload}
        />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%' },
    hint: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },

    sectionLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },

    metricRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
    metricInfo: { flex: 1, gap: 4, minWidth: 0 },
    metricName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    metricMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    countText: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    catalogNameText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    valueTypeText: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },

    originBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    officialBadge: { backgroundColor: colors.secondaryLight },
    personalBadge: { backgroundColor: colors.tertiaryLight },
    originBadgeText: { fontSize: 11, fontFamily: fonts.bold },
    officialBadgeText: { color: colors.secondary },
    personalBadgeText: { color: colors.tertiary },

    statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    statusActiveBadge: { backgroundColor: colors.successLight },
    statusInactiveBadge: { backgroundColor: colors.bgDim },
    statusBadgeText: { fontSize: 11, fontFamily: fonts.bold },
    statusActiveText: { color: colors.success },
    statusInactiveText: { color: colors.textTertiary },

    editBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.bgDim },
    editBtnText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },

    // Modale de création
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    title: { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
    fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, marginTop: 6 },
    nameInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, fontSize: 15, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bg },
    radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
    radioDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
    radioLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    scopeHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginLeft: 28, marginTop: -4 },
    checklistWrap: { marginLeft: 28, gap: 2 },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkboxLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    valueTypeReadOnly: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
    valueTypeExamples: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 16 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
    error: { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  })
}
