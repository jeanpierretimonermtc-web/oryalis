// ORDER-BUSINESS-3.5 §11/§12/§13/§14/§15/§23/§24 — détail d'une métrique MLM : liste des produits
// avec leur valeur configurée (ou "Non configuré"). Éditable pour une métrique personnelle
// (origin='personal'), lecture seule pour une officielle (§23 : aucun champ éditable). Une seule
// implémentation pour les deux modes — jamais deux composants qui diverqeraient.
// ORDER-BUSINESS-3.5.2 — étendue : périmètre multi-catalogues éditable (§9/§14/§17), sélection
// multiple de produits + application/retrait en masse (§18-§26), filtres configuré/non configuré
// + par catalogue (§27), compteurs globaux et par catalogue (§29). Le type de valeur ("Valeur
// produit numérique") est affiché en information secondaire, jamais éditable (§3/§4/§30/§31).
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X, Check } from 'lucide-react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Catalog, CatalogProductListItem } from '@/shared/lib/types'
import { getCatalogs, getCatalogProducts } from '@/features/catalogs/catalogService'
import {
  fetchMetricValuesForProductIds, setMetricValueForProduct, deleteMetricValueForProduct,
  updateMetricDefinitionDisplayName, setMetricDefinitionActive,
  fetchMetricDefinitionCatalogIds, updateMlmMetricScope, countConfiguredValuesForCatalogs,
  bulkSetMetricValueForProducts, bulkDeleteMetricValueForProducts,
  ScopeRequiresCatalogError, CatalogNotAccessibleError,
} from '@/features/catalogs/mlmMetricService'
import type { MlmMetricDefinitionOverview } from '@/features/catalogs/mlmMetricService'
import type { MlmMetricScope } from '@/shared/lib/types'

interface Props {
  userId: string
  definition: MlmMetricDefinitionOverview
  onClose: () => void
  // Prévient le parent qu'une donnée affichée dans la liste (libellé, statut, périmètre, nombre de
  // produits configurés) a changé, pour qu'il recharge — cette modale ne maintient pas elle-même
  // l'état de la liste (§ flux UI -> hook -> service, une seule source de vérité côté écran parent).
  onChanged: () => void
}

interface ProductRow extends CatalogProductListItem {
  catalogId: string
  catalogName: string
}

type StatusFilter = 'all' | 'configured' | 'unconfigured'

export function MlmMetricProductsModal({ userId, definition, onClose, onChanged }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const editable = definition.origin === 'personal' && definition.user_id === userId

  const [displayName, setDisplayNameState] = useState(definition.display_name)
  const [savingName, setSavingName] = useState(false)
  const [active, setActive] = useState(definition.active)
  const [togglingActive, setTogglingActive] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  // ORDER-BUSINESS-3.5.1 §16 — même garde qu'ailleurs : évite un setState après fermeture rapide
  // de cette modale (aucun impact sur l'écriture elle-même, jamais annulée).
  const isMountedRef = useRef(true)
  useEffect(() => () => { isMountedRef.current = false }, [])

  // ── Catalogues accessibles + périmètre COMMIS (celui réellement enregistré côté serveur) ──────
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [committedScope, setCommittedScope] = useState<MlmMetricScope | null>(definition.scope)
  const [committedCatalogIds, setCommittedCatalogIds] = useState<string[]>([])
  const [scopeLoading, setScopeLoading] = useState(editable && definition.scope === 'selected')

  useEffect(() => {
    let cancelled = false
    getCatalogs(userId).then(list => { if (!cancelled) setCatalogs(list) }).catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    if (!editable || definition.scope !== 'selected') { setScopeLoading(false); return }
    let cancelled = false
    fetchMetricDefinitionCatalogIds(definition.id)
      .then(ids => { if (!cancelled) setCommittedCatalogIds(ids) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setScopeLoading(false) })
    return () => { cancelled = true }
  }, [editable, definition.id, definition.scope])

  // ── Édition du périmètre (§14/§15/§17) ──────────────────────────────────────────────────────
  const [scopeEditing, setScopeEditing] = useState(false)
  const [scopeDraftMode, setScopeDraftMode] = useState<MlmMetricScope>('all')
  const [scopeDraftCatalogIds, setScopeDraftCatalogIds] = useState<Set<string>>(new Set())
  const [savingScope, setSavingScope] = useState(false)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [scopeRemovalConfirm, setScopeRemovalConfirm] = useState<{ removedIds: string[]; count: number } | null>(null)

  function openScopeEditor() {
    setScopeDraftMode(committedScope ?? 'all')
    setScopeDraftCatalogIds(new Set(committedCatalogIds))
    setScopeError(null)
    setScopeRemovalConfirm(null)
    setScopeEditing(true)
  }

  function toggleDraftCatalog(catalogId: string) {
    setScopeDraftCatalogIds(prev => {
      const next = new Set(prev)
      if (next.has(catalogId)) next.delete(catalogId)
      else next.add(catalogId)
      return next
    })
  }

  // §17 — catalogues qui SORTIRAIENT du périmètre par rapport à ce qui est réellement enregistré :
  // soit un catalogue explicitement décoché en scope='selected', soit TOUT catalogue non retenu si
  // on rétrécit depuis scope='all' (qui couvrait implicitement tous les catalogues) vers 'selected'.
  function computeRemovedCatalogIds(): string[] {
    if (scopeDraftMode === 'all') return []
    const previouslyIncluded = committedScope === 'all' ? catalogs.map(c => c.id) : committedCatalogIds
    return previouslyIncluded.filter(id => !scopeDraftCatalogIds.has(id))
  }

  // ORDER-BUSINESS-3.5.2.1 §2/§3/§5/§6/§7 — le scope AFFICHÉ comme sauvegardé (committedScope/
  // committedCatalogIds) n'est mis à jour QUE dans la branche succès ci-dessous : sur échec,
  // aucun état n'est touché, le brouillon (scopeDraftMode/scopeDraftCatalogIds) reste intact et
  // l'éditeur reste ouvert (scopeEditing n'est jamais mis à false ici) — l'utilisateur peut cliquer
  // à nouveau sur Enregistrer sans rouvrir la modale, jamais de faux succès visuel.
  async function commitScopeChange(catalogIdsForSave: string[]) {
    setSavingScope(true)
    setScopeError(null)
    try {
      await updateMlmMetricScope(definition.id, scopeDraftMode, catalogIdsForSave)
      if (!isMountedRef.current) return
      setCommittedScope(scopeDraftMode)
      setCommittedCatalogIds(scopeDraftMode === 'selected' ? catalogIdsForSave : [])
      setScopeEditing(false)
      setScopeRemovalConfirm(null)
      onChanged()
      loadProductsRef.current?.()
    } catch (e) {
      // §5 — l'erreur technique complète reste loggée ; seul un message mappé, sans SQL/nom de
      // table, est affiché à l'utilisateur. Tant que 20260831_mlm_metric_multi_catalog.sql n'est
      // pas exécutée en production, cet appel échoue systématiquement avec une erreur Postgres
      // 42883 (fonction absente) — ERREUR ATTENDUE dans ce cas précis, pas un bug applicatif.
      console.error(e)
      if (isMountedRef.current) {
        setScopeError(
          e instanceof ScopeRequiresCatalogError ? t('mlm_values.scope_error_no_catalog')
          : e instanceof CatalogNotAccessibleError ? t('mlm_values.scope_error_not_accessible')
          : t('mlm_values.save_error'),
        )
      }
    } finally {
      if (isMountedRef.current) setSavingScope(false)
    }
  }

  async function handleSaveScope() {
    if (scopeDraftMode === 'selected' && scopeDraftCatalogIds.size === 0) return
    const catalogIdsForSave = [...scopeDraftCatalogIds]
    const removedIds = computeRemovedCatalogIds()
    if (removedIds.length === 0) {
      await commitScopeChange(catalogIdsForSave)
      return
    }
    try {
      const count = await countConfiguredValuesForCatalogs(definition.id, removedIds)
      if (count > 0) {
        setScopeRemovalConfirm({ removedIds, count })
        return
      }
      await commitScopeChange(catalogIdsForSave)
    } catch (e) {
      console.error(e)
      if (isMountedRef.current) setScopeError(t('mlm_values.save_error'))
    }
  }

  async function handleConfirmScopeRemoval() {
    await commitScopeChange([...scopeDraftCatalogIds])
  }

  const scopeCatalogNames = useMemo(() => {
    if (committedScope !== 'selected') return []
    return catalogs.filter(c => committedCatalogIds.includes(c.id)).map(c => c.name)
  }, [catalogs, committedScope, committedCatalogIds])

  async function handleSaveName() {
    if (!displayName.trim() || displayName.trim() === definition.display_name) return
    setSavingName(true)
    setModalError(null)
    try {
      await updateMetricDefinitionDisplayName(definition.id, displayName.trim())
      onChanged()
    } catch {
      if (isMountedRef.current) setModalError(t('mlm_values.save_error'))
    } finally {
      if (isMountedRef.current) setSavingName(false)
    }
  }

  async function handleToggleActive() {
    setTogglingActive(true)
    setModalError(null)
    try {
      await setMetricDefinitionActive(definition.id, !active)
      if (isMountedRef.current) setActive(v => !v)
      onChanged()
    } catch {
      if (isMountedRef.current) setModalError(t('mlm_values.save_error'))
    } finally {
      if (isMountedRef.current) setTogglingActive(false)
    }
  }

  // ── Chargement des produits selon le périmètre COMMIS (jamais le brouillon en cours d'édition) ─
  const [products, setProducts] = useState<ProductRow[]>([])
  const [valuesByProductId, setValuesByProductId] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [catalogFilter, setCatalogFilter] = useState<string>('all')
  const [draftByProductId, setDraftByProductId] = useState<Map<string, string>>(new Map())
  const [rowError, setRowError] = useState<Map<string, string>>(new Map())
  const [savedFlash, setSavedFlash] = useState<Set<string>>(new Set())

  const targetCatalogs = useMemo(() => {
    if (!editable) {
      return definition.catalog_id
        ? [{ id: definition.catalog_id, name: definition.catalogNames[0] ?? '—' }]
        : []
    }
    if (scopeLoading) return []
    if (committedScope === 'selected') return catalogs.filter(c => committedCatalogIds.includes(c.id))
    return catalogs
  }, [editable, definition.catalog_id, definition.catalogNames, scopeLoading, committedScope, committedCatalogIds, catalogs])

  const loadProducts = useCallback(async () => {
    if (editable && scopeLoading) {
      // Périmètre pas encore résolu (fetchMetricDefinitionCatalogIds en vol) — laisse le loader
      // visible plutôt que d'afficher "0 produit" par anticipation (évite un flash d'état vide
      // trompeur au premier rendu d'une métrique scope='selected').
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const perCatalog = await Promise.all(
        targetCatalogs.map(async c => {
          const items = await getCatalogProducts(userId, c.id)
          return items.map(p => ({ ...p, catalogId: c.id, catalogName: c.name }))
        }),
      )
      const flat = perCatalog.flat()
      setProducts(flat)
      const values = await fetchMetricValuesForProductIds(definition.id, flat.map(p => p.id))
      setValuesByProductId(values)
    } catch {
      if (isMountedRef.current) setLoadError(t('mlm_values.save_error'))
    } finally {
      if (isMountedRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, definition.id, targetCatalogs])

  // Réf stable pour être appelée depuis commitScopeChange sans ajouter loadProducts à ses propres
  // dépendances (loadProducts change de référence à chaque nouveau targetCatalogs).
  const loadProductsRef = useRef(loadProducts)
  useEffect(() => { loadProductsRef.current = loadProducts }, [loadProducts])

  useEffect(() => { loadProducts() }, [loadProducts])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.sku ?? '').toLowerCase().includes(q)) return false
      if (catalogFilter !== 'all' && p.catalogId !== catalogFilter) return false
      const isConfigured = valuesByProductId.has(p.id)
      if (statusFilter === 'configured' && !isConfigured) return false
      if (statusFilter === 'unconfigured' && isConfigured) return false
      return true
    })
  }, [products, search, catalogFilter, statusFilter, valuesByProductId])

  // §29 — compteurs GLOBAUX (indépendants des filtres actifs) + par catalogue quand le périmètre
  // en couvre plusieurs.
  const totalConfigured = useMemo(() => products.filter(p => valuesByProductId.has(p.id)).length, [products, valuesByProductId])
  const perCatalogCounts = useMemo(() => {
    if (targetCatalogs.length <= 1) return []
    return targetCatalogs.map(c => {
      const catalogProducts = products.filter(p => p.catalogId === c.id)
      return { catalogId: c.id, name: c.name, configured: catalogProducts.filter(p => valuesByProductId.has(p.id)).length, total: catalogProducts.length }
    })
  }, [targetCatalogs, products, valuesByProductId])

  function flashSaved(productId: string) {
    setSavedFlash(prev => new Set(prev).add(productId))
    setTimeout(() => { if (isMountedRef.current) setSavedFlash(prev => { const next = new Set(prev); next.delete(productId); return next }) }, 1500)
  }

  // ORDER-BUSINESS-3.5.1 §17 — une seule écriture EN VOL à la fois par produit : voir explication
  // d'origine dans l'historique du fichier — comportement inchangé pour l'édition ligne par ligne.
  const pendingSaveRef = useRef<Map<string, Promise<void>>>(new Map())

  async function commitValueNow(productId: string, draft: string) {
    const trimmed = draft.trim()

    if (trimmed === '') {
      if (valuesByProductId.has(productId)) {
        await deleteMetricValueForProduct(productId, definition.id)
        if (isMountedRef.current) setValuesByProductId(prev => { const next = new Map(prev); next.delete(productId); return next })
        onChanged()
      }
      if (isMountedRef.current) setDraftByProductId(prev => { const next = new Map(prev); next.delete(productId); return next })
      return
    }

    const value = parseFloat(trimmed.replace(',', '.'))
    if (!Number.isFinite(value)) {
      if (isMountedRef.current) setDraftByProductId(prev => { const next = new Map(prev); next.delete(productId); return next })
      return
    }
    if (value < 0) {
      if (isMountedRef.current) setRowError(prev => new Map(prev).set(productId, t('mlm_values.value_error_negative')))
      return
    }
    await setMetricValueForProduct(productId, definition.id, value)
    if (!isMountedRef.current) return
    setValuesByProductId(prev => new Map(prev).set(productId, value))
    setDraftByProductId(prev => { const next = new Map(prev); next.delete(productId); return next })
    flashSaved(productId)
    onChanged()
  }

  async function handleCommitValue(productId: string) {
    const draft = draftByProductId.get(productId)
    if (draft === undefined) return
    setRowError(prev => { const next = new Map(prev); next.delete(productId); return next })

    const previous = pendingSaveRef.current.get(productId) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => commitValueNow(productId, draft))
      .catch(() => {
        if (isMountedRef.current) setRowError(prev => new Map(prev).set(productId, t('mlm_values.save_error')))
      })
    pendingSaveRef.current.set(productId, next)
    await next
  }

  // ── Sélection multiple + application en masse (§18-§26) ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkValueDraft, setBulkValueDraft] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState<string | null>(null)
  const [bulkRemoveConfirming, setBulkRemoveConfirming] = useState(false)

  function toggleProductSelection(productId: string) {
    setBulkSuccessMsg(null)
    // §39/§26 — une confirmation de retrait en masse porte sur un ensemble précis de produits :
    // si la sélection change avant que l'utilisateur ne confirme, la confirmation en cours n'a
    // plus le même sens et doit être redemandée, jamais silencieusement réappliquée à une sélection
    // différente de celle annoncée.
    setBulkRemoveConfirming(false)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  const allFilteredSelected = filteredProducts.length > 0 && filteredProducts.every(p => selectedIds.has(p.id))

  function handleToggleSelectAll() {
    setBulkSuccessMsg(null)
    setBulkRemoveConfirming(false)
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const p of filteredProducts) next.delete(p.id)
      } else {
        for (const p of filteredProducts) next.add(p.id)
      }
      return next
    })
  }

  function handleClearSelection() {
    setSelectedIds(new Set())
    setBulkError(null)
    setBulkSuccessMsg(null)
    setBulkRemoveConfirming(false)
  }

  async function handleBulkApply() {
    const trimmed = bulkValueDraft.trim().replace(',', '.')
    const value = parseFloat(trimmed)
    if (!Number.isFinite(value)) return
    if (value < 0) { setBulkError(t('mlm_values.value_error_negative')); return }
    const ids = [...selectedIds]
    setBulkSaving(true)
    setBulkError(null)
    setBulkSuccessMsg(null)
    try {
      await bulkSetMetricValueForProducts(definition.id, ids, value)
      if (!isMountedRef.current) return
      setValuesByProductId(prev => {
        const next = new Map(prev)
        for (const id of ids) next.set(id, value)
        return next
      })
      setBulkSuccessMsg(t('mlm_values.bulk_success_apply', { count: ids.length, value }))
      setSelectedIds(new Set())
      setBulkValueDraft('')
      onChanged()
    } catch {
      // §39 — aucun faux succès : la sélection et le brouillon restent intacts pour un nouvel essai.
      if (isMountedRef.current) setBulkError(t('mlm_values.save_error'))
    } finally {
      if (isMountedRef.current) setBulkSaving(false)
    }
  }

  async function handleBulkRemove() {
    if (!bulkRemoveConfirming) { setBulkRemoveConfirming(true); return }
    const ids = [...selectedIds]
    setBulkSaving(true)
    setBulkError(null)
    setBulkSuccessMsg(null)
    try {
      await bulkDeleteMetricValueForProducts(definition.id, ids)
      if (!isMountedRef.current) return
      setValuesByProductId(prev => {
        const next = new Map(prev)
        for (const id of ids) next.delete(id)
        return next
      })
      setBulkSuccessMsg(t('mlm_values.bulk_success_remove', { count: ids.length }))
      setSelectedIds(new Set())
      setBulkRemoveConfirming(false)
      onChanged()
    } catch {
      if (isMountedRef.current) setBulkError(t('mlm_values.save_error'))
    } finally {
      if (isMountedRef.current) setBulkSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            {editable ? (
              <TextInput
                style={styles.titleInput}
                value={displayName}
                onChangeText={setDisplayNameState}
                onBlur={handleSaveName}
                editable={!savingName}
              />
            ) : (
              <Text style={styles.title}>{displayName}</Text>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          {modalError ? <Text style={styles.modalErrorText}>{modalError}</Text> : null}

          <View style={styles.metaRow}>
            <View style={[styles.originBadge, definition.origin === 'official' ? styles.officialBadge : styles.personalBadge]}>
              <Text style={[styles.originBadgeText, definition.origin === 'official' ? styles.officialBadgeText : styles.personalBadgeText]}>
                {definition.origin === 'official' ? t('mlm_values.origin_official') : t('mlm_values.origin_personal')}
              </Text>
            </View>
          </View>
          {/* §3/§4/§30/§31 — type de valeur, toujours affiché, jamais éditable. */}
          <Text style={styles.valueTypeText}>{t('mlm_values.value_type_value')}</Text>

          {!editable ? (
            <Text style={styles.scopeText}>{t('mlm_values.scope_summary_global_single', { catalog: definition.catalogNames[0] ?? '—' })}</Text>
          ) : (
            <View style={styles.scopeSection}>
              <Text style={styles.fieldLabel}>{t('mlm_values.scope_label')}</Text>
              {!scopeEditing ? (
                <View style={styles.scopeSummaryRow}>
                  <Text style={styles.scopeText}>
                    {scopeLoading
                      ? '…'
                      : committedScope === 'all'
                        ? t('mlm_values.scope_all_catalogs')
                        : scopeCatalogNames.length > 0 ? scopeCatalogNames.join(' · ') : t('mlm_values.scope_summary_empty')}
                  </Text>
                  <TouchableOpacity onPress={openScopeEditor} disabled={scopeLoading}>
                    <Text style={styles.editLink}>{t('mlm_values.edit_button')}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <TouchableOpacity style={styles.radioRow} onPress={() => setScopeDraftMode('all')} activeOpacity={0.8}>
                    <View style={[styles.radioDot, scopeDraftMode === 'all' && styles.radioDotActive]} />
                    <Text style={styles.radioLabel}>{t('mlm_values.scope_all_catalogs')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.radioRow} onPress={() => setScopeDraftMode('selected')} activeOpacity={0.8}>
                    <View style={[styles.radioDot, scopeDraftMode === 'selected' && styles.radioDotActive]} />
                    <Text style={styles.radioLabel}>{t('mlm_values.scope_specific_catalog')}</Text>
                  </TouchableOpacity>
                  {scopeDraftMode === 'selected' ? (
                    <View style={styles.checklistWrap}>
                      {catalogs.map(c => {
                        const checked = scopeDraftCatalogIds.has(c.id)
                        return (
                          <TouchableOpacity key={c.id} style={styles.checkboxRow} onPress={() => toggleDraftCatalog(c.id)} activeOpacity={0.8}>
                            <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                              {checked ? <Check size={13} color="#fff" /> : null}
                            </View>
                            <Text style={styles.checkboxLabel}>{c.name}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  ) : null}

                  {scopeRemovalConfirm ? (
                    <View style={styles.confirmBox}>
                      <Text style={styles.confirmText}>{t('mlm_values.scope_removal_warning', { count: scopeRemovalConfirm.count })}</Text>
                      <View style={styles.confirmActions}>
                        <TouchableOpacity onPress={() => setScopeRemovalConfirm(null)} disabled={savingScope}>
                          <Text style={styles.cancelLink}>{t('mlm_values.cancel_button')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleConfirmScopeRemoval} disabled={savingScope}>
                          <Text style={styles.confirmLink}>{savingScope ? '…' : t('mlm_values.confirm_button')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.scopeEditActions}>
                      <TouchableOpacity onPress={() => setScopeEditing(false)} disabled={savingScope}>
                        <Text style={styles.cancelLink}>{t('mlm_values.cancel_button')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleSaveScope}
                        disabled={savingScope || (scopeDraftMode === 'selected' && scopeDraftCatalogIds.size === 0)}
                      >
                        <Text style={styles.confirmLink}>{savingScope ? '…' : t('mlm_values.rename_save')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {scopeError ? <Text style={styles.modalErrorText}>{scopeError}</Text> : null}
                </View>
              )}
            </View>
          )}

          {!editable ? (
            <Text style={styles.hint}>{t('mlm_values.official_detail_hint')}</Text>
          ) : (
            <View style={styles.activeRow}>
              <Text style={styles.activeLabel}>{active ? t('mlm_values.status_active') : t('mlm_values.status_inactive')}</Text>
              <TouchableOpacity style={styles.activeToggleBtn} onPress={handleToggleActive} disabled={togglingActive} activeOpacity={0.8}>
                {togglingActive
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={styles.activeToggleText}>{active ? t('mlm_values.deactivate_button') : t('mlm_values.reactivate_button')}</Text>}
              </TouchableOpacity>
            </View>
          )}

          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={t('mlm_values.products_search_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {(['all', 'configured', 'unconfigured'] as StatusFilter[]).map(f => (
              <TouchableOpacity key={f} style={[styles.filterChip, statusFilter === f && styles.filterChipActive]} onPress={() => setStatusFilter(f)} activeOpacity={0.8}>
                <Text style={[styles.filterChipText, statusFilter === f && styles.filterChipTextActive]}>
                  {f === 'all' ? t('mlm_values.catalog_filter_all') : f === 'configured' ? t('mlm_values.filter_configured') : t('mlm_values.filter_unconfigured')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {targetCatalogs.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <TouchableOpacity style={[styles.filterChip, catalogFilter === 'all' && styles.filterChipActive]} onPress={() => setCatalogFilter('all')} activeOpacity={0.8}>
                <Text style={[styles.filterChipText, catalogFilter === 'all' && styles.filterChipTextActive]}>{t('mlm_values.catalog_filter_all')}</Text>
              </TouchableOpacity>
              {targetCatalogs.map(c => (
                <TouchableOpacity key={c.id} style={[styles.filterChip, catalogFilter === c.id && styles.filterChipActive]} onPress={() => setCatalogFilter(c.id)} activeOpacity={0.8}>
                  <Text style={[styles.filterChipText, catalogFilter === c.id && styles.filterChipTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          <Text style={styles.countersText}>
            {t('mlm_values.counters_summary', { total: products.length, configured: totalConfigured })}
          </Text>
          {perCatalogCounts.length > 0 ? (
            <Text style={styles.countersDetailText}>
              {perCatalogCounts.map(c => `${c.name} ${c.configured}/${c.total}`).join('  ·  ')}
            </Text>
          ) : null}

          {editable && filteredProducts.length > 0 ? (
            <TouchableOpacity style={styles.selectAllRow} onPress={handleToggleSelectAll} activeOpacity={0.8}>
              <View style={[styles.checkbox, allFilteredSelected && styles.checkboxChecked]}>
                {allFilteredSelected ? <Check size={13} color="#fff" /> : null}
              </View>
              <Text style={styles.selectAllLabel}>{t('mlm_values.select_all')}</Text>
            </TouchableOpacity>
          ) : null}

          <ScrollView style={styles.productList} showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
            ) : loadError ? (
              <Text style={styles.modalErrorText}>{loadError}</Text>
            ) : filteredProducts.length === 0 ? (
              <Text style={styles.emptyText}>{t('mlm_values.products_empty')}</Text>
            ) : (
              filteredProducts.map(p => {
                const currentValue = valuesByProductId.get(p.id)
                const draft = draftByProductId.get(p.id)
                const displayValue = draft !== undefined ? draft : (currentValue !== undefined ? String(currentValue) : '')
                const error = rowError.get(p.id)
                const isSelected = selectedIds.has(p.id)
                return (
                  <View key={p.id} style={styles.productRow}>
                    {editable ? (
                      <TouchableOpacity onPress={() => toggleProductSelection(p.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                          {isSelected ? <Check size={13} color="#fff" /> : null}
                        </View>
                      </TouchableOpacity>
                    ) : null}
                    <View style={styles.productInfo}>
                      <Text style={styles.productName} numberOfLines={1}>{p.name}</Text>
                      <Text style={styles.productCatalog}>{p.catalogName}</Text>
                    </View>
                    {editable ? (
                      <View style={styles.valueInputWrap}>
                        <TextInput
                          style={[styles.valueInput, error && styles.valueInputError]}
                          value={displayValue}
                          onChangeText={v => setDraftByProductId(prev => new Map(prev).set(p.id, v))}
                          onBlur={() => handleCommitValue(p.id)}
                          placeholder={t('mlm_values.value_placeholder')}
                          placeholderTextColor={colors.textTertiary}
                          keyboardType="decimal-pad"
                        />
                        {savedFlash.has(p.id) ? <Text style={styles.savedFlash}>{t('mlm_values.saved_feedback')}</Text> : null}
                      </View>
                    ) : (
                      <Text style={styles.readOnlyValue}>
                        {currentValue !== undefined ? String(currentValue) : t('mlm_values.value_not_configured')}
                      </Text>
                    )}
                    {error ? <Text style={styles.rowErrorText}>{error}</Text> : null}
                  </View>
                )
              })
            )}
            <View style={{ height: selectedIds.size > 0 ? 120 : 24 }} />
          </ScrollView>

          {editable && selectedIds.size > 0 ? (
            <View style={styles.bulkBar}>
              <Text style={styles.bulkCountText}>{t('mlm_values.n_selected', { count: selectedIds.size })}</Text>
              {bulkError ? <Text style={styles.rowErrorText}>{bulkError}</Text> : null}
              {bulkSuccessMsg ? <Text style={styles.bulkSuccessText}>{bulkSuccessMsg}</Text> : null}
              <View style={styles.bulkRow}>
                <TextInput
                  style={styles.bulkValueInput}
                  value={bulkValueDraft}
                  onChangeText={v => { setBulkValueDraft(v); setBulkRemoveConfirming(false) }}
                  placeholder={t('mlm_values.value_placeholder')}
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                  editable={!bulkSaving}
                />
                <TouchableOpacity
                  style={[styles.bulkApplyBtn, (bulkSaving || bulkValueDraft.trim() === '') && styles.bulkBtnDisabled]}
                  onPress={handleBulkApply}
                  disabled={bulkSaving || bulkValueDraft.trim() === ''}
                >
                  <Text style={styles.bulkApplyBtnText}>{t('mlm_values.apply_button')}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.bulkRow}>
                <TouchableOpacity onPress={handleBulkRemove} disabled={bulkSaving}>
                  <Text style={styles.bulkRemoveText}>
                    {bulkRemoveConfirming ? t('mlm_values.confirm_button') : t('mlm_values.remove_value_button')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleClearSelection} disabled={bulkSaving}>
                  <Text style={styles.bulkClearText}>{t('mlm_values.clear_selection_button')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24, gap: 10, maxHeight: '90%' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    title: { fontSize: 17, fontFamily: fonts.bold, color: colors.text, flex: 1 },
    titleInput: { fontSize: 17, fontFamily: fonts.bold, color: colors.text, flex: 1, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 4 },

    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    originBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    officialBadge: { backgroundColor: colors.secondaryLight },
    personalBadge: { backgroundColor: colors.tertiaryLight },
    originBadgeText: { fontSize: 11, fontFamily: fonts.bold },
    officialBadgeText: { color: colors.secondary },
    personalBadgeText: { color: colors.tertiary },
    valueTypeText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary },
    scopeText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, flex: 1 },

    scopeSection: { gap: 4, backgroundColor: colors.bgDim, borderRadius: 10, padding: 10 },
    fieldLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.text },
    scopeSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    editLink: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
    radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    radioDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.border },
    radioDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
    radioLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    checklistWrap: { marginLeft: 26, gap: 2 },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkboxLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    scopeEditActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 6 },
    cancelLink: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
    confirmLink: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },
    confirmBox: { backgroundColor: colors.dangerLight, borderRadius: 10, padding: 10, marginTop: 6, gap: 6 },
    confirmText: { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, lineHeight: 17 },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },

    hint: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    modalErrorText: { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 8 },

    activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bgDim, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    activeLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    activeToggleBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    activeToggleText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },

    searchInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12, fontSize: 14, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bg },

    filterRow: { gap: 8, paddingVertical: 2 },
    filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
    filterChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    filterChipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    filterChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },

    countersText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.text },
    countersDetailText: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },

    selectAllRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    selectAllLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },

    productList: { flexGrow: 0 },
    emptyText: { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', marginTop: 20 },
    productRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, flexWrap: 'wrap' },
    productInfo: { flex: 1, minWidth: 0, gap: 1 },
    productName: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    productCatalog: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },
    valueInputWrap: { alignItems: 'flex-end', gap: 2 },
    valueInput: { width: 84, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, fontSize: 14, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bg, textAlign: 'right' },
    valueInputError: { borderColor: colors.danger },
    savedFlash: { fontSize: 10, fontFamily: fonts.semibold, color: colors.success },
    readOnlyValue: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary, width: 84, textAlign: 'right' },
    rowErrorText: { fontSize: 11, fontFamily: fonts.medium, color: colors.danger, width: '100%' },

    bulkBar: {
      position: 'absolute', left: 20, right: 20, bottom: 20, backgroundColor: colors.card, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8, shadowColor: '#000', shadowOpacity: 0.15,
      shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 8,
    },
    bulkCountText: { fontSize: 12, fontFamily: fonts.bold, color: colors.text },
    bulkSuccessText: { fontSize: 12, fontFamily: fonts.medium, color: colors.success },
    bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
    bulkValueInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, fontSize: 14, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bg },
    bulkApplyBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
    bulkBtnDisabled: { opacity: 0.5 },
    bulkApplyBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: '#fff' },
    bulkRemoveText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.danger },
    bulkClearText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  })
}
