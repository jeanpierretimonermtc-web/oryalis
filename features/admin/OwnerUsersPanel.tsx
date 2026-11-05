import { useMemo, useState } from 'react'
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react-native'
import { useAuth } from '@/features/auth/AuthProvider'
import { AnchoredMenu } from '@/shared/components/ui/AnchoredMenu'
import { Button } from '@/shared/components/ui/Button'
import { Input } from '@/shared/components/ui/Input'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { formatDate } from '@/shared/lib/dateFormat'
import {
  extendManualAdvisorAccess, grantManualAdvisorAccess, removeAppRole, requestSupportAccess, revokeManualAdvisorAccess, setAppRole,
  type OwnerAccessFilter, type OwnerUserRow, type OwnerUserSort,
} from './adminService'
import { OWNER_USERS_PAGE_SIZE, useOwnerUsers } from './useOwnerUsers'

const ACCESS_FILTERS: OwnerAccessFilter[] = ['paying', 'offered', 'free', 'inactive']
const SORTS: OwnerUserSort[] = ['signup', 'activity', 'name']

type Translate = (key: string, options?: Record<string, unknown>) => string

function lastActivityLabel(iso: string | null, t: Translate) {
  if (!iso) return t('owner.activity_never')
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return t('clients.timeline_today')
  if (days === 1) return t('clients.history_yesterday')
  if (days < 31) return t('clients.history_days_ago', { count: days })
  return t('clients.history_months_ago', { count: Math.round(days / 30) })
}

// OWNER-USERS-1 — une ligne par compte ; les actions vivent dans le panneau du compte.
export function OwnerUsersPanel() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { width } = useWindowDimensions()
  const isWide = width >= 768
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const users = useOwnerUsers()
  const [selected, setSelected] = useState<OwnerUserRow | null>(null)
  const [sortPos, setSortPos] = useState<{ x: number; y: number } | null>(null)

  const from = users.total === 0 ? 0 : users.page * OWNER_USERS_PAGE_SIZE + 1
  const to = Math.min((users.page + 1) * OWNER_USERS_PAGE_SIZE, users.total)
  const accessColor = (access: OwnerUserRow['access']) => access === 'paying' ? colors.success : access === 'offered' ? colors.primary : colors.textSecondary

  return (
    <View style={styles.section}>
      <Input label="" placeholder={t('owner.search_placeholder')} value={users.query} onChangeText={users.setQuery} autoCapitalize="none" />

      <View style={styles.toolbar}>
        <View style={styles.chips}>
          <TouchableOpacity style={[styles.chip, !users.access && styles.chipActive]} onPress={() => users.setAccess(null)} activeOpacity={0.75}>
            <Text style={[styles.chipText, !users.access && styles.chipTextActive]}>{t('owner.filter_all')}</Text>
          </TouchableOpacity>
          {ACCESS_FILTERS.map(filter => {
            const active = users.access === filter
            return (
              <TouchableOpacity key={filter} style={[styles.chip, active && styles.chipActive]} onPress={() => users.setAccess(active ? null : filter)} activeOpacity={0.75}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(`owner.filter_${filter}`)}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
        <TouchableOpacity style={styles.sortBtn} onPress={(e) => setSortPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} activeOpacity={0.75}>
          <Text style={styles.sortText}>{t('catalog.sort_label')} {t(`owner.sort_${users.sort}`)} ▾</Text>
        </TouchableOpacity>
      </View>

      {users.failed ? <Text style={styles.error}>{t('owner.load_error')}</Text> : null}

      <View style={styles.table}>
        {isWide ? (
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.headerText, styles.colName]}>{t('owner.col_name')}</Text>
            <Text style={[styles.headerText, styles.colEmail]}>{t('owner.col_email')}</Text>
            <Text style={[styles.headerText, styles.colAccess]}>{t('owner.col_access')}</Text>
            <Text style={[styles.headerText, styles.colDate]}>{t('owner.col_signup')}</Text>
            <Text style={[styles.headerText, styles.colDate]}>{t('owner.col_activity')}</Text>
          </View>
        ) : null}
        {users.loading && users.rows.length === 0 ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : null}
        {!users.loading && users.rows.length === 0 ? <Text style={styles.empty}>{t('owner.users_empty')}</Text> : null}
        {users.rows.map((user, index) => (
          <TouchableOpacity key={user.user_id} style={[styles.row, index > 0 && styles.rowBorder, !isWide && styles.rowMobile]} onPress={() => setSelected(user)} activeOpacity={0.7}>
            {isWide ? (
              <>
                <Text style={[styles.name, styles.colName]} numberOfLines={1}>{user.full_name || '—'}</Text>
                <Text style={[styles.cell, styles.colEmail]} numberOfLines={1}>{user.email}</Text>
                <Text style={[styles.access, styles.colAccess, { color: accessColor(user.access) }]}>{t(`owner.access_${user.access}`)}</Text>
                <Text style={[styles.cell, styles.colDate]}>{formatDate(user.created_at, locale)}</Text>
                <Text style={[styles.cell, styles.colDate]}>{lastActivityLabel(user.last_active_at, t)}</Text>
              </>
            ) : (
              <>
                <View style={styles.mobileTop}>
                  <Text style={styles.name} numberOfLines={1}>{user.full_name || user.email}</Text>
                  <Text style={[styles.access, { color: accessColor(user.access) }]}>{t(`owner.access_${user.access}`)}</Text>
                </View>
                <Text style={styles.cell} numberOfLines={1}>{user.email} · {lastActivityLabel(user.last_active_at, t)}</Text>
              </>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.pagination}>
        <Text style={styles.cell}>{t('owner.page_range', { from, to, total: users.total })}</Text>
        <View style={styles.pageBtns}>
          <Button size="sm" variant="secondary" label={t('owner.page_prev')} disabled={users.page === 0} onPress={() => users.setPage(users.page - 1)} />
          <Button size="sm" variant="secondary" label={t('owner.page_next')} disabled={to >= users.total} onPress={() => users.setPage(users.page + 1)} />
        </View>
      </View>

      <AnchoredMenu
        visible={!!sortPos}
        onClose={() => setSortPos(null)}
        anchor={sortPos}
        width={220}
        items={SORTS.map(key => ({ key, label: `${key === users.sort ? '✓ ' : ''}${t(`owner.sort_${key}`)}`, onPress: () => users.setSort(key) }))}
      />

      {selected ? (
        <OwnerUserSheet
          user={selected}
          isWide={isWide}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            const rows = await users.refresh()
            setSelected(current => rows.find(r => r.user_id === current?.user_id) ?? current)
          }}
        />
      ) : null}
    </View>
  )
}

// Ne passe à l'action qu'avec un motif ; les actions lourdes demandent une confirmation.
function OwnerUserSheet({ user, isWide, onClose, onChanged }: {
  user: OwnerUserRow; isWide: boolean; onClose: () => void; onChanged: () => Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const isSelf = session?.user.id === user.user_id
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState<{ message: string; action: () => Promise<unknown>; done: string } | null>(null)

  const lifetime = user.access === 'offered' && !user.current_period_end
  const name = user.full_name || user.email
  const summary = [
    t(`owner.access_${user.access}`),
    t('owner.signup_on', { date: formatDate(user.created_at, locale) }),
    t('owner.activity_label', { value: lastActivityLabel(user.last_active_at, t) }),
    user.current_period_end ? t('owner.access_until', { date: formatDate(user.current_period_end, locale) }) : null,
    user.app_role ? t(`owner.role_name_${user.app_role}`) : null,
  ].filter(Boolean).join(' · ')

  async function run(action: () => Promise<unknown>, done: string) {
    setPending(null)
    if (!reason.trim()) { setError(t('owner.reason_required')); return }
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(done); await onChanged() }
    catch (e) { console.error('[owner.action]', e); setError(e instanceof Error ? e.message : t('owner.action_error')) }
    finally { setBusy(false) }
  }

  function ask(message: string, action: () => Promise<unknown>, done: string) {
    if (!reason.trim()) { setError(t('owner.reason_required')); return }
    setError(''); setPending({ message, action, done })
  }

  return (
    <Modal visible transparent animationType={isWide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.overlay, isWide && styles.overlayWide]}>
        <View style={[styles.sheet, isWide && styles.sheetWide]}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle} numberOfLines={1}>{name}</Text>
              <Text style={styles.cell} numberOfLines={1} selectable>{user.email}</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('common.close')}>
              <X size={16} color={colors.textSecondary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetBodyContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.cell}>{summary}</Text>
            <Input label={t('owner.reason_label')} value={reason} onChangeText={(v) => { setReason(v); if (error) setError('') }} placeholder={t('owner.reason_placeholder')} />

            <Text style={styles.groupLabel}>{t('owner.group_access')}</Text>
            <View style={styles.actions}>
              {user.access === 'free' ? <Button size="sm" label={t('owner.grant_1_month')} disabled={busy} onPress={() => run(() => grantManualAdvisorAccess(user.user_id, { lifetime: false, durationMonths: 1, reason }), t('owner.notice_access_granted'))} /> : null}
              {user.access === 'offered' && !lifetime ? <Button size="sm" variant="secondary" label={t('owner.extend_1_month')} disabled={busy} onPress={() => run(() => extendManualAdvisorAccess(user.user_id, 1, reason), t('owner.notice_access_extended'))} /> : null}
              {user.access !== 'paying' && !lifetime ? <Button size="sm" variant="secondary" label={t('owner.grant_lifetime')} disabled={busy} onPress={() => ask(t('owner.confirm_lifetime', { name }), () => grantManualAdvisorAccess(user.user_id, { lifetime: true, reason }), t('owner.notice_lifetime_granted'))} /> : null}
              {user.access === 'offered' ? <Button size="sm" variant="danger" label={t('owner.revoke_access')} disabled={busy} onPress={() => ask(t('owner.confirm_revoke', { name }), () => revokeManualAdvisorAccess(user.user_id, reason), t('owner.notice_access_revoked'))} /> : null}
              {user.access === 'paying' ? <Text style={styles.cell}>{t('owner.paying_hint')}</Text> : null}
            </View>

            <Text style={styles.groupLabel}>{t('owner.group_support')}</Text>
            <View style={styles.actions}>
              <Button size="sm" variant="secondary" label={t('owner.request_diagnostics')} disabled={busy} onPress={() => run(() => requestSupportAccess(user.user_id, 'account_diagnostics', reason, 30), t('owner.notice_request_sent'))} />
              <Button size="sm" variant="secondary" label={t('owner.request_crm_read')} disabled={busy} onPress={() => run(() => requestSupportAccess(user.user_id, 'crm_read', reason, 30), t('owner.notice_request_sent'))} />
            </View>

            {!isSelf ? (
              <>
                <Text style={styles.groupLabel}>{t('owner.group_role')}</Text>
                <View style={styles.actions}>
                  {user.app_role !== 'support' ? <Button size="sm" variant="secondary" label={t('owner.role_support')} disabled={busy} onPress={() => ask(t('owner.confirm_support', { name }), () => setAppRole(user.user_id, 'support', reason), t('owner.notice_role_support_granted'))} /> : null}
                  {user.app_role !== 'owner' ? <Button size="sm" variant="secondary" label={t('owner.role_owner')} disabled={busy} onPress={() => ask(t('owner.confirm_owner', { name }), () => setAppRole(user.user_id, 'owner', reason), t('owner.notice_role_owner_granted'))} /> : null}
                  {user.app_role ? <Button size="sm" variant="danger" label={t('owner.remove_role')} disabled={busy} onPress={() => ask(t('owner.confirm_remove_role', { name }), () => removeAppRole(user.user_id, reason), t('owner.notice_role_removed'))} /> : null}
                </View>
              </>
            ) : null}
          </ScrollView>

          {pending ? (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>⚠️ {pending.message}</Text>
              <View style={styles.confirmBtns}>
                <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => setPending(null)} />
                <Button size="sm" variant="danger" label={t('common.confirm')} onPress={() => run(pending.action, pending.done)} />
              </View>
            </View>
          ) : null}
          {notice ? <Text style={styles.notice}>✓ {notice}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: { gap: 12 },
    toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flexShrink: 1 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
    chipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    sortBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    sortText: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    table: { borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden', ...SOFT_CARD_SHADOW },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
    rowMobile: { flexDirection: 'column', alignItems: 'stretch', gap: 2 },
    rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    headerRow: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9 },
    headerText: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
    colName: { flex: 2 }, colEmail: { flex: 3 }, colAccess: { width: 80 }, colDate: { width: 110 },
    mobileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    name: { flexShrink: 1, fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    cell: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
    access: { fontSize: 13, fontFamily: fonts.semibold },
    loader: { padding: 24 },
    empty: { padding: 24, textAlign: 'center', fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary },
    pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
    pageBtns: { flexDirection: 'row', gap: 8 },
    overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
    overlayWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 12, maxHeight: '92%' },
    sheetWide: { width: '100%', maxWidth: 620, maxHeight: '90%', borderRadius: 20 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    sheetTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.text },
    closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
    sheetBody: { flexGrow: 0, flexShrink: 1 },
    sheetBodyContent: { gap: 10 },
    groupLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, marginTop: 6 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    confirmBox: { gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningLight },
    confirmText: { fontSize: 13.5, fontFamily: fonts.medium, color: colors.text },
    confirmBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    notice: { fontSize: 13, fontFamily: fonts.medium, color: colors.success },
  })
}
