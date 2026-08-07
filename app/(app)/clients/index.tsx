import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, Image, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions, Modal } from 'react-native'
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClients, useClientSearch } from '@/features/clients/useClients'
import { useLastRdvMap } from '@/features/appointments/useAppointments'
import { archiveClient, deleteClient } from '@/features/clients/clientService'
import { useContactQuota } from '@/features/clients/useContactQuota'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { LinearGradient } from 'expo-linear-gradient'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, hexToRgba, type ThemeColors } from '@/shared/theme/colors'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { gravatarUrl } from '@/shared/lib/gravatar'
import { fonts } from '@/shared/theme/fonts'
import type { ClientListItem, ContactRole, PipelineStage } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'
import { computeRelationshipHealth, type RelationshipHealthInput } from '@/features/clients/relationshipHealth'

const ROLE_FILTERS: (ContactRole | 'all' | 'vip')[] =
  ['all', 'prospect', 'customer', 'distributor', 'leader', 'team_member', 'vip']

function initials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Couleur par rôle (pas par santé relationnelle, déjà visible via HealthPill à côté) —
// même palette que les filtres de rôle et la fiche contact (getRoleColors/getPrimaryRole).
// Ordre de priorité de la photo : upload manuel → Gravatar (si un email existe) → initiales.
function ClientAvatar({ name, avatarUrl, contactRole, email }: { name: string; avatarUrl: string | null; contactRole: ContactRole[]; email: string | null }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const rc = getRoleColors(getPrimaryRole(contactRole), colors)
  const [gravatarFailed, setGravatarFailed] = useState(false)
  const photoUrl = avatarUrl ?? (email && !gravatarFailed ? gravatarUrl(email) : null)
  if (photoUrl) {
    return (
      <View style={[styles.avatarRing, { borderColor: rc.text }]}>
        <Image
          source={{ uri: photoUrl }}
          style={styles.avatarRingImg}
          onError={() => { if (!avatarUrl) setGravatarFailed(true) }}
        />
      </View>
    )
  }
  return (
    <View style={[styles.avatar, { backgroundColor: rc.bg }]}>
      <Text style={[styles.avatarText, { color: rc.text }]}>{initials(name)}</Text>
    </View>
  )
}

function HealthPill({ health }: { health: RelationshipHealthInput }) {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { tier } = computeRelationshipHealth(health)
  const sc = statusColors[tier] ?? { bg: colors.surfaceContainerHighest, text: colors.textTertiary }
  return (
    <View style={[styles.pill, { backgroundColor: sc.bg }]}>
      <Text style={[styles.pillText, { color: sc.text }]}>{t(`relationship_health.${tier}`)}</Text>
    </View>
  )
}

function RolePill({ role }: { role: ContactRole }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getRoleLabel } = useAppConfig()
  const rc = getRoleColors(role, colors)
  return (
    <View style={[styles.pill, { backgroundColor: rc.bg }]}>
      <Text style={[styles.pillText, { color: rc.text }]}>{getRoleLabel(role)}</Text>
    </View>
  )
}

function VipTag() {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.pill, { backgroundColor: statusColors.vip.bg }]}>
      <Text style={[styles.pillText, { color: statusColors.vip.text }]}>{t('clients.vip_badge')}</Text>
    </View>
  )
}

function ClientCard({ client, nextRdv, lastRdv, onMenuPress }: { client: ClientListItem; nextRdv?: string; lastRdv?: string; onMenuPress: (c: ClientListItem) => void }) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const rdvText = nextRdv
    ? `${t('clients.next_rdv')} : ${formatDate(nextRdv, locale)}`
    : lastRdv
    ? `${t('clients.last_rdv')} : ${formatDate(lastRdv, locale)}`
    : t('clients.no_rdv')

  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        {/* Top: avatar + name/badge + score + menu */}
        <View style={styles.cardTop}>
          <ClientAvatar name={client.full_name} avatarUrl={client.avatar_url} contactRole={client.contact_role} email={client.email} />
          <View style={styles.cardTitle}>
            <Text style={styles.cardName}>{client.full_name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <HealthPill health={client} />
              {client.is_vip ? <VipTag /> : null}
              {client.contact_role.filter(r => r !== 'customer').map(role => <RolePill key={role} role={role} />)}
              <View style={styles.pipelineMiniPill}>
                <Text style={styles.pipelineMiniText}>{t(`pipeline_stages.${client.pipeline_stage}`)}</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => onMenuPress(client)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.menuDots}>⋮</Text>
          </TouchableOpacity>
        </View>

        {/* Info rows */}
        {client.email ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>✉</Text>
            <Text style={styles.infoText} numberOfLines={1}>{client.email}</Text>
          </View>
        ) : null}
        {client.phone ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>📞</Text>
            <Text style={styles.infoText}>{client.phone}</Text>
          </View>
        ) : null}
        <View style={styles.infoRow}>
          <Text style={styles.infoIcon}>🕐</Text>
          <Text style={[styles.infoText, !lastRdv && styles.infoMuted]}>{rdvText}</Text>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.btnOutline}
          onPress={() => router.push(`/(app)/clients/${client.id}`)}
          activeOpacity={0.7}
        >
          <LineIcon name="eye" size={15} color={colors.text} strokeWidth={2} />
          <Text style={styles.btnOutlineText}>{t('clients.view')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnFill}
          onPress={() => router.push(`/(app)/appointments/new?clientId=${client.id}&returnTo=${encodeURIComponent('/(app)/clients')}` as any)}
          activeOpacity={0.8}
        >
          <LineIcon name="calendarPlus" size={15} color={colors.textInverse} strokeWidth={2} />
          <Text style={styles.btnFillText}>{t('clients.add_appt')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default function ClientsScreen() {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { status: statusParam, pipeline: pipelineParam } = useLocalSearchParams<{ status?: ContactRole | 'all' | 'vip'; pipeline?: PipelineStage }>()
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<ContactRole | 'all' | 'vip'>(
    statusParam && ROLE_FILTERS.includes(statusParam) ? statusParam : 'all'
  )
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStage | null>(pipelineParam ?? null)
  const { clients, loading, refresh } = useClients()
  const { quota, refresh: refreshQuota } = useContactQuota()
  const { results, search } = useClientSearch()
  const { labels: statusLabels, getRoleLabel } = useAppConfig()
  const { nextRdvMap, lastRdvMap } = useLastRdvMap(session?.user?.id)
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  const [menuClient, setMenuClient]       = useState<ClientListItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [deleting, setDeleting]           = useState(false)

  function closeMenu() { setMenuClient(null); setConfirmDelete(false); setConfirmArchive(false) }

  async function handleArchive() {
    if (!menuClient) return
    setDeleting(true)
    try {
      await archiveClient(menuClient.id)
      closeMenu()
      await Promise.all([refresh(), refreshQuota()])
    } catch (e) {
      console.error('[archiveClient]', e)
    } finally {
      setDeleting(false)
    }
  }

  async function handleDelete() {
    if (!menuClient) return
    setDeleting(true)
    try {
      await deleteClient(menuClient.id)
      closeMenu()
      refresh()
    } catch (e) {
      console.error('[deleteClient]', e)
    } finally {
      setDeleting(false)
    }
  }

  useFocusEffect(useCallback(() => { refresh() }, []))

  useEffect(() => {
    if (statusParam && ROLE_FILTERS.includes(statusParam)) {
      setRoleFilter(statusParam)
    }
  }, [statusParam])

  useEffect(() => { setPipelineFilter(pipelineParam ?? null) }, [pipelineParam])

  useEffect(() => {
    if (query.length > 0) search(query, roleFilter === 'all' || roleFilter === 'vip' ? undefined : roleFilter)
  }, [query, roleFilter])


  const baseDisplayed: ClientListItem[] = query.length > 0 ? results : clients
  const roleFiltered = roleFilter === 'all' ? baseDisplayed
    : roleFilter === 'vip' ? baseDisplayed.filter(c => c.is_vip)
    : baseDisplayed.filter(c => c.contact_role.includes(roleFilter))
  const displayed = pipelineFilter ? roleFiltered.filter(c => c.pipeline_stage === pipelineFilter) : roleFiltered

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={[styles.inner, isWide && styles.innerWide]}>

        {/* Page header */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{t('clients.title')}</Text>
          {clients.length > 0 && (
            <View style={styles.countPill}>
              <Text style={styles.countText}>{clients.length}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.archiveLink} onPress={() => router.push('/(app)/clients/archived' as any)}>
            <Text style={styles.archiveLinkText}>{t('clients.archived_title')}</Text>
          </TouchableOpacity>
          {isWide && (
            <TouchableOpacity
              onPress={() => router.push(quota?.reached ? '/(app)/settings-display' : '/(app)/clients/new')}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={brandColors.gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.newClientBtn}
              >
                <LineIcon name="plus" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.newClientBtnText}>{t('clients.add')}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

        {quota?.limit != null && (
          <TouchableOpacity
            style={[styles.quotaBanner, quota.reached && styles.quotaBannerReached]}
            onPress={() => quota.reached && router.push('/(app)/settings-display')}
            activeOpacity={quota.reached ? 0.8 : 1}
          >
            <Text style={styles.quotaBannerText}>{t('clients.quota_count', { count: quota.activeCount, limit: quota.limit })}</Text>
            {quota.reached && <Text style={styles.quotaBannerAction}>{t('clients.quota_upgrade')}</Text>}
          </TouchableOpacity>
        )}

        {pipelineFilter && (
          <TouchableOpacity style={styles.pipelineFilterBanner} onPress={() => setPipelineFilter(null)}>
            <Text style={styles.pipelineFilterText}>{t('clients.pipeline_filter', { stage: t(`pipeline_stages.${pipelineFilter}`) })}</Text>
            <Text style={styles.pipelineFilterClear}>×</Text>
          </TouchableOpacity>
        )}

        {/* Search */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchEmoji}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('clients.search')}
            value={query}
            onChangeText={setQuery}
            placeholderTextColor={colors.textTertiary}
            clearButtonMode="while-editing"
          />
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={ROLE_FILTERS}
          keyExtractor={s => s}
          style={styles.filtersList}
          contentContainerStyle={styles.filtersContent}
          ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
          renderItem={({ item: s }) => {
            const active = roleFilter === s
            const cs = s === 'all' ? null : s === 'vip' ? statusColors.vip : getRoleColors(s, colors)
            const bg     = active
              ? (cs ? cs.bg    : colors.primary)
              : colors.card
            const txtClr = active
              ? (cs ? cs.text  : '#ffffff')
              : (cs ? cs.text  : colors.primary)
            const border = active
              ? (cs ? cs.text  : colors.primary)
              : (cs ? cs.bg    : colors.primaryLight)
            return (
              <TouchableOpacity
                style={[styles.chip, { backgroundColor: bg, borderColor: border }]}
                onPress={() => { setRoleFilter(s); setPipelineFilter(null) }}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, { color: txtClr, fontFamily: active ? fonts.bold : fonts.medium }]}>
                  {s === 'all' ? t('clients.filter_all') : s === 'vip' ? t('clients.vip_badge') : getRoleLabel(s)}
                </Text>
              </TouchableOpacity>
            )
          }}
        />

        {/* List */}
        {loading
          ? <ActivityIndicator style={styles.loader} color={colors.primaryAction} />
          : (
            <FlatList
              key={isWide ? '2-col' : '1-col'}
              numColumns={isWide ? 2 : 1}
              columnWrapperStyle={isWide ? styles.columnWrapper : undefined}
              data={displayed}
              keyExtractor={c => c.id}
              extraData={statusLabels}
              renderItem={({ item }) => (
                <View style={isWide ? styles.colCard : undefined}>
                  <ClientCard client={item} nextRdv={nextRdvMap[item.id]} lastRdv={lastRdvMap[item.id]} onMenuPress={setMenuClient} />
                </View>
              )}
              ListEmptyComponent={
                <EmptyState
                  message={t('clients.empty')}
                  icon="👥"
                  actionLabel={t('clients.add')}
                  actionVariant="gradient"
                  actionIcon="personPlus"
                  onAction={() => router.push('/(app)/clients/new')}
                />
              }
              contentContainerStyle={[styles.list, isWide && styles.listWide, displayed.length === 0 && styles.listEmpty]}
              onRefresh={refresh}
              refreshing={loading}
            />
          )
        }

        </View>

        {/* FAB (mobile uniquement — sur web la CTA est dans l'en-tête) */}
        {!isWide && (
          <TouchableOpacity
            style={styles.fab}
            onPress={() => router.push(quota?.reached ? '/(app)/settings-display' : '/(app)/clients/new')}
            activeOpacity={0.85}
          >
            <LineIcon name="plus" size={26} color={colors.textInverse} strokeWidth={2.5} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Context menu ──────────────────────────────────────────── */}
      <Modal
        visible={!!menuClient}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={closeMenu}>
          <View style={styles.menuSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.menuPill} />
            <Text style={styles.menuSheetName} numberOfLines={1}>{menuClient?.full_name}</Text>

            {!confirmDelete && !confirmArchive ? (
              <>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => { closeMenu(); router.push(`/(app)/clients/${menuClient?.id}` as any) }}>
                  <Text style={styles.menuItemIcon}>👁</Text>
                  <Text style={styles.menuItemText}>{t('clients.view')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => { closeMenu(); router.push(`/(app)/clients/${menuClient?.id}/edit` as any) }}>
                  <Text style={styles.menuItemIcon}>✏️</Text>
                  <Text style={styles.menuItemText}>{t('clients.menu_edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => { closeMenu(); router.push(`/(app)/clients/${menuClient?.id}/appointments` as any) }}>
                  <Text style={styles.menuItemIcon}>📅</Text>
                  <Text style={styles.menuItemText}>{t('clients.menu_new_rdv')}</Text>
                </TouchableOpacity>
                <View style={styles.menuDivider} />
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => setConfirmArchive(true)}>
                  <Text style={styles.menuItemIcon}>📦</Text>
                  <Text style={styles.menuItemText}>{t('clients.menu_archive')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => setConfirmDelete(true)}>
                  <Text style={styles.menuItemIcon}>🗑️</Text>
                  <Text style={[styles.menuItemText, { color: colors.danger }]}>{t('clients.menu_delete')}</Text>
                </TouchableOpacity>
              </>
            ) : confirmArchive ? (
              <>
                <Text style={styles.menuConfirmText}>{t('clients.archive_confirm', { name: menuClient?.full_name })}</Text>
                <TouchableOpacity style={[styles.menuDangerBtn, { backgroundColor: colors.primary }, deleting && { opacity: 0.6 }]} onPress={handleArchive} disabled={deleting}>
                  {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.menuDangerBtnText}>{t('clients.menu_archive')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => setConfirmArchive(false)}>
                  <Text style={[styles.menuItemText, { textAlign: 'center', color: colors.textSecondary }]}>{t('clients.menu_cancel')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.menuConfirmText}>
                  {t('clients.menu_delete')} « {menuClient?.full_name} » ?
                </Text>
                <TouchableOpacity
                  style={[styles.menuDangerBtn, deleting && { opacity: 0.6 }]}
                  activeOpacity={0.8}
                  onPress={handleDelete}
                  disabled={deleting}
                >
                  {deleting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.menuDangerBtnText}>{t('clients.menu_confirm_delete')}</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => setConfirmDelete(false)}>
                  <Text style={[styles.menuItemText, { textAlign: 'center', color: colors.textSecondary }]}>{t('clients.menu_cancel')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bgDim },
  inner:      { flex: 1, width: '100%' },
  innerWide:  { maxWidth: 1100, alignSelf: 'center' },

  // ── Page header ────────────────────────────────────────────────────────────
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 6 },
  pageTitle:  { fontSize: 28, fontFamily: fonts.display, color: colors.text },
  countPill:  { backgroundColor: colors.primaryLight, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 3 },
  countText:  { fontSize: 13, fontFamily: fonts.bold, color: colors.primaryAction },
  archiveLink: { marginLeft: 'auto', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
  archiveLinkText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
  newClientBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 12, color: hexToRgba('#3B82F6', 0.35) }],
    elevation: 3,
  },
  newClientBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: '#fff' },
  quotaBanner: { marginHorizontal: 16, marginBottom: 10, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quotaBannerReached: { borderColor: colors.warning, backgroundColor: colors.warningLight },
  quotaBannerText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  quotaBannerAction: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },
  pipelineFilterBanner: { marginHorizontal: 16, marginBottom: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.tertiaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pipelineFilterText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.tertiary },
  pipelineFilterClear: { fontSize: 18, color: colors.tertiary },

  // ── Search ─────────────────────────────────────────────────────────────────
  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  searchEmoji: { fontSize: 14, marginRight: 8, opacity: 0.6 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.body, color: colors.text, paddingVertical: 11 },

  // ── Filter chips ───────────────────────────────────────────────────────────
  filtersList:    { flexGrow: 0, flexShrink: 0 },
  filtersContent: { paddingHorizontal: 16, paddingBottom: 14, alignItems: 'center' },
  chip:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13 },

  // ── FlatList ───────────────────────────────────────────────────────────────
  list:          { padding: 16, gap: 14, paddingBottom: 100 },
  listWide:      { paddingHorizontal: 0 },
  listEmpty:     { flex: 1 },
  loader:        { marginTop: 48 },
  columnWrapper: { gap: 14, paddingHorizontal: 20 },
  colCard:       { flex: 1 },

  // ── Card ───────────────────────────────────────────────────────────────────
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 16, color: 'rgba(28, 26, 23, 0.06)' }],
    elevation: 2,
  },
  cardBody:  { gap: 10 },
  cardTop:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle: { flex: 1, gap: 5 },
  cardName:  { fontSize: 16, fontFamily: fonts.semibold, color: colors.text, lineHeight: 20 },
  pipelineMiniPill: { backgroundColor: colors.bgDim, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  pipelineMiniText: { fontSize: 10, fontFamily: fonts.medium, color: colors.textSecondary },

  // ── Avatar ─────────────────────────────────────────────────────────────────
  avatar:     { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 17, fontFamily: fonts.bold },
  avatarRing:    { width: 46, height: 46, borderRadius: 23, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  avatarRingImg: { width: 38, height: 38, borderRadius: 19 },

  // ── Status pill ────────────────────────────────────────────────────────────
  pill:     { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 9999 },
  pillText: { fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.3 },

  // ── Three-dot menu ─────────────────────────────────────────────────────────
  menuBtn:  { paddingTop: 2 },
  menuDots: { fontSize: 20, color: colors.textTertiary, lineHeight: 24 },

  // ── Info rows ──────────────────────────────────────────────────────────────
  infoRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoIcon: { fontSize: 13, width: 18, textAlign: 'center' },
  infoText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, flex: 1 },
  infoMuted: { color: colors.textTertiary, fontStyle: 'italic' },

  // ── Action buttons ─────────────────────────────────────────────────────────
  cardActions:    { flexDirection: 'row', gap: 10, marginTop: 2 },
  btnOutline:     {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.bgDim,
    alignItems: 'center', justifyContent: 'center',
  },
  btnOutlineText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  btnFill:        {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: 10,
    backgroundColor: colors.primaryAction, alignItems: 'center', justifyContent: 'center',
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 8, color: 'rgba(37, 99, 235, 0.3)' }],
    elevation: 2,
  },
  btnFillText:    { fontSize: 14, fontFamily: fonts.semibold, color: colors.textInverse },

  // ── Context menu modal ────────────────────────────────────────────────────
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
    gap: 2,
    boxShadow: [{ offsetX: 0, offsetY: -4, blurRadius: 16, color: 'rgba(0, 0, 0, 0.08)' }],
    elevation: 16,
  },
  menuPill: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  menuSheetName: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  menuItemIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  menuItemText: { fontSize: 15, fontFamily: fonts.medium, color: colors.text },
  menuDivider:  { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  menuConfirmText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
    paddingHorizontal: 4,
    paddingVertical: 12,
    lineHeight: 20,
  },
  menuDangerBtn: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 4,
  },
  menuDangerBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

  // ── FAB ────────────────────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryAction,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 14, color: hexToRgba(colors.primaryAction, 0.4) }],
    elevation: 8,
  },
  })
}
