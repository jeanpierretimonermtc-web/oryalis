import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/components/ui/Button'
import { Input } from '@/shared/components/ui/Input'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { formatDate } from '@/shared/lib/dateFormat'
import { deleteOwnerAccount, listOwnerDeletionRequests, type OwnerDeletionRequest } from './adminService'

const KNOWN_ERRORS = ['DELETION_NOT_DUE', 'DELETION_EMAIL_MISMATCH', 'DELETION_ACTIVE_SUBSCRIPTION', 'DELETION_TARGET_IS_OWNER']

// OWNER-DELETIONS-1 — l'effacement n'est proposé qu'après les 30 jours, avec l'e-mail à retaper.
export function OwnerDeletionsPanel() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const [requests, setRequests] = useState<OwnerDeletionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setFailed(false)
    try { setRequests(await listOwnerDeletionRequests()) }
    catch (e) { console.error('[owner.deletions]', e); setFailed(true) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function erase(request: OwnerDeletionRequest) {
    setBusy(true); setError(''); setNotice('')
    try {
      await deleteOwnerAccount(request.user_id, email)
      setOpenId(null); setEmail('')
      setNotice(t('owner.deletion_done'))
      await load()
    } catch (e) {
      console.error('[owner.deleteAccount]', e)
      const code = e instanceof Error ? KNOWN_ERRORS.find(k => e.message.includes(k)) : undefined
      setError(t(code ? `owner.error_${code}` : 'owner.action_error'))
    } finally { setBusy(false) }
  }

  if (loading && requests.length === 0) return <ActivityIndicator color={colors.primary} />
  if (failed) return <Text style={styles.error}>{t('owner.load_error')}</Text>

  return (
    <View style={styles.section}>
      <Text style={styles.intro}>{t('owner.deletions_intro')}</Text>
      {notice ? <Text style={styles.notice}>✓ {notice}</Text> : null}
      {requests.length === 0 ? <Text style={styles.empty}>✓ {t('owner.deletions_none')}</Text> : null}
      {requests.map(request => {
        const name = request.full_name || request.email
        const open = openId === request.user_id
        const blocked = request.paying
        return (
          <View key={request.user_id} style={[styles.card, { borderLeftColor: request.due ? colors.danger : colors.warning }]}>
            <View style={styles.top}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <Text style={styles.muted} numberOfLines={1} selectable>{request.email}</Text>
              </View>
              <Text style={[styles.status, { color: request.due ? colors.danger : colors.warning }]}>
                {t(request.due ? 'owner.deletion_due' : 'owner.deletion_waiting')}
              </Text>
            </View>
            <Text style={styles.muted}>
              {t('owner.deletion_dates', { requested: formatDate(request.requested_at, locale), scheduled: formatDate(request.scheduled_for, locale) })}
              {' · '}{t('owner.deletion_contacts', { count: request.contacts_count })}
            </Text>
            {request.reason ? <Text style={styles.reason}>{t('owner.alert_reason', { reason: request.reason })}</Text> : null}

            {blocked ? <Text style={styles.warning}>⚠️ {t('owner.error_DELETION_ACTIVE_SUBSCRIPTION')}</Text> : null}
            {!request.due ? <Text style={styles.muted}>{t('owner.deletion_can_cancel')}</Text> : null}

            {request.due && !blocked && !open ? (
              <View style={styles.actions}>
                <Button size="sm" variant="danger" label={t('owner.deletion_erase')} onPress={() => { setOpenId(request.user_id); setEmail(''); setError('') }} />
              </View>
            ) : null}

            {open ? (
              <View style={styles.confirm}>
                <Text style={styles.confirmText}>⚠️ {t('owner.deletion_confirm', { name, count: request.contacts_count })}</Text>
                <Input label={t('owner.deletion_type_email', { email: request.email })} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <View style={styles.actions}>
                  <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => { setOpenId(null); setError('') }} />
                  <Button
                    size="sm"
                    variant="danger"
                    label={t('owner.deletion_confirm_cta')}
                    loading={busy}
                    disabled={email.trim().toLowerCase() !== request.email.toLowerCase()}
                    onPress={() => erase(request)}
                  />
                </View>
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: { gap: 12 },
    intro: { fontSize: 13.5, lineHeight: 20, fontFamily: fonts.body, color: colors.textSecondary },
    card: { gap: 8, padding: 14, borderRadius: 14, borderLeftWidth: 4, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, ...SOFT_CARD_SHADOW },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    muted: { fontSize: 12.5, lineHeight: 18, fontFamily: fonts.body, color: colors.textSecondary },
    reason: { fontSize: 13, fontFamily: fonts.body, color: colors.text },
    status: { fontSize: 12.5, fontFamily: fonts.semibold },
    warning: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
    confirm: { gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerLight },
    confirmText: { fontSize: 13.5, lineHeight: 20, fontFamily: fonts.medium, color: colors.text },
    empty: { padding: 16, textAlign: 'center', fontSize: 14, fontFamily: fonts.medium, color: colors.success },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    notice: { fontSize: 13, fontFamily: fonts.medium, color: colors.success },
  })
}
