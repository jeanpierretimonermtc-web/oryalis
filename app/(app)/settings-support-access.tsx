import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SvgXml } from 'react-native-svg'
import { respondToSupportAccessRequest, revokeMySupportAccess } from '@/features/admin/adminService'
import { enrollTotp, unenrollTotp, verifyTotp } from '@/features/admin/mfaService'
import { qrXml } from '@/features/admin/MfaGate'
import {
  cancelAccountDeletion, changePassword, describeUserAgent, requestAccountDeletion, signOutOtherDevices,
} from '@/features/security/accountService'
import { useAccountSecurity } from '@/features/security/useAccountSecurity'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'

type Enrollment = Awaited<ReturnType<typeof enrollTotp>>

// PRIVACY-1 — Confidentialité & assistance : sécurité du compte, accès du support, mes données.
export default function PrivacySettingsScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const fmt = (v?: string | null, withTime = true) => v
    ? new Date(v).toLocaleString(locale, withTime ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'long', year: 'numeric' })
    : '—'

  const { devices, mfaFactorId, mfaLoaded, supportRequests, deletion, deletionAvailable, loading, reload } = useAccountSecurity()
  useFocusEffect(useCallback(() => { void reload() }, [reload]))

  const [notice, setNotice] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  async function run(key: string, action: () => Promise<unknown>, success?: string) {
    setBusy(key); setErrorMsg(''); setNotice('')
    try { await action(); if (success) setNotice(success); await reload() }
    catch (e) { console.error(`[privacy.${key}]`, e); setErrorMsg(e instanceof Error ? e.message : t('common.error')) }
    finally { setBusy(null) }
  }

  // Mot de passe
  const [pwdOpen, setPwdOpen] = useState(false)
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const pwdError = pwd && pwd.length < 8 ? t('privacy.password_too_short') : pwd2 && pwd !== pwd2 ? t('privacy.password_mismatch') : ''
  const savePassword = () => run('password', async () => {
    await changePassword(pwd)
    setPwd(''); setPwd2(''); setPwdOpen(false)
  }, t('privacy.password_changed'))

  // Double authentification
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const startMfa = () => run('mfa', async () => { setEnrollment(await enrollTotp('Oryalis')) })
  const confirmMfa = () => run('mfa', async () => {
    if (!enrollment) return
    await verifyTotp(enrollment.id, code)
    setEnrollment(null); setCode('')
  }, t('privacy.mfa_enabled_notice'))
  const [mfaDisableConfirm, setMfaDisableConfirm] = useState(false)
  const disableMfa = () => run('mfa', async () => {
    if (mfaFactorId) await unenrollTotp(mfaFactorId)
    setMfaDisableConfirm(false)
  }, t('privacy.mfa_disabled_notice'))

  // Suppression du compte
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteWord, setDeleteWord] = useState('')
  const confirmWord = t('privacy.delete_confirm_word')
  const pendingDeletion = deletion && !deletion.cancelled_at && !deletion.completed_at ? deletion : null

  const qr = qrXml(enrollment?.totp.qr_code)

  return (
    <>
      <Stack.Screen options={{ title: t('settings.support_access_title') }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('settings.support_access_title')}</Text>
        <Text style={styles.intro}>{t('privacy.intro')}</Text>
        {notice ? <Text style={styles.notice}>✓ {notice}</Text> : null}
        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

        {/* ── Sécurité du compte ─────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon="🔐" title={t('privacy.security_title')} styles={styles} />

          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('privacy.password_title')}</Text>
              <Text style={styles.rowDesc}>{t('privacy.password_desc')}</Text>
            </View>
            {!pwdOpen ? <Button size="sm" variant="secondary" label={t('privacy.password_change')} onPress={() => setPwdOpen(true)} /> : null}
          </View>
          {pwdOpen ? (
            <View style={styles.subBox}>
              <TextInput style={styles.input} value={pwd} onChangeText={setPwd} secureTextEntry placeholder={t('privacy.password_new')} placeholderTextColor={colors.textTertiary} autoComplete="new-password" />
              <TextInput style={styles.input} value={pwd2} onChangeText={setPwd2} secureTextEntry placeholder={t('privacy.password_repeat')} placeholderTextColor={colors.textTertiary} autoComplete="new-password" />
              {pwdError ? <Text style={styles.fieldError}>{pwdError}</Text> : null}
              <View style={styles.actions}>
                <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => { setPwdOpen(false); setPwd(''); setPwd2('') }} />
                <Button size="sm" label={t('privacy.password_save')} onPress={savePassword} loading={busy === 'password'} disabled={!pwd || !!pwdError || pwd !== pwd2} />
              </View>
            </View>
          ) : null}

          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {t('privacy.mfa_title')}{'  '}
                {mfaLoaded ? (
                  <Text style={[styles.badge, mfaFactorId ? styles.badgeOn : styles.badgeOff]}>
                    {mfaFactorId ? t('privacy.mfa_on') : t('privacy.mfa_off')}
                  </Text>
                ) : null}
              </Text>
              <Text style={styles.rowDesc}>{t('privacy.mfa_desc')}</Text>
            </View>
            {mfaLoaded && !mfaFactorId && !enrollment ? <Button size="sm" variant="secondary" label={t('privacy.mfa_enable')} onPress={startMfa} loading={busy === 'mfa'} /> : null}
            {mfaFactorId && !mfaDisableConfirm ? <Button size="sm" variant="ghost" label={t('privacy.mfa_disable')} onPress={() => setMfaDisableConfirm(true)} /> : null}
          </View>
          {enrollment ? (
            <View style={styles.subBox}>
              <Text style={styles.rowDesc}>{t('privacy.mfa_scan_in_app')}</Text>
              {qr ? <View style={styles.qr}><SvgXml xml={qr} width={280} height={280} /></View> : null}
              <Text selectable style={styles.secret}>{t('privacy.mfa_key')} {enrollment.totp.secret}</Text>
              <TextInput style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder={t('privacy.mfa_code')} placeholderTextColor={colors.textTertiary} autoComplete="one-time-code" />
              <View style={styles.actions}>
                <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => { setEnrollment(null); setCode('') }} />
                <Button size="sm" label={t('privacy.mfa_confirm')} onPress={confirmMfa} loading={busy === 'mfa'} disabled={code.trim().length !== 6} />
              </View>
            </View>
          ) : null}
          {mfaDisableConfirm ? (
            <View style={[styles.subBox, styles.warnBox]}>
              <Text style={styles.warnText}>⚠️ {t('privacy.mfa_disable_confirm')}</Text>
              <View style={styles.actions}>
                <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => setMfaDisableConfirm(false)} />
                <Button size="sm" variant="danger" label={t('privacy.mfa_disable')} onPress={disableMfa} loading={busy === 'mfa'} />
              </View>
            </View>
          ) : null}

          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('privacy.devices_title')}</Text>
              <Text style={styles.rowDesc}>{t('privacy.devices_desc')}</Text>
            </View>
            <Button size="sm" variant="secondary" label={t('privacy.devices_signout_others')} onPress={() => run('signout', signOutOtherDevices, t('privacy.devices_signed_out'))} loading={busy === 'signout'} />
          </View>
          {loading && devices === null ? <ActivityIndicator color={colors.primary} /> : null}
          {!loading && devices === null ? <Text style={styles.muted}>{t('privacy.devices_unavailable')}</Text> : null}
          {devices?.slice(0, 6).map(d => {
            const ua = describeUserAgent(d.user_agent)
            const icon = ua.device === 'iPhone' || ua.device === 'Android' ? '📱' : ua.device === 'iPad' ? '📲' : '💻'
            return (
              <View key={d.id} style={styles.deviceRow}>
                <Text style={styles.deviceIcon}>{icon}</Text>
                <View style={styles.rowText}>
                  <Text style={styles.deviceName}>{ua.device}{ua.browser ? ` · ${ua.browser}` : ''}</Text>
                  <Text style={styles.rowDesc}>{t('privacy.devices_last_seen', { date: fmt(d.last_seen_at), count: d.sign_in_count })}</Text>
                </View>
              </View>
            )
          })}
        </View>

        {/* ── Accès du support ───────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon="🛟" title={t('privacy.support_title')} styles={styles} />
          <Text style={styles.rowDesc}>{t('privacy.support_desc')}</Text>
          {supportRequests !== null && supportRequests.length === 0 ? <Text style={styles.muted}>{t('privacy.support_none')}</Text> : null}
          {supportRequests?.map(r => (
            <View key={r.id} style={styles.subBox}>
              <View style={styles.row}>
                <Text style={styles.rowTitle}>{r.requester_email ?? t('privacy.support_team')}</Text>
                <Text style={[styles.badge, r.effective_status === 'approved' ? styles.badgeOn : styles.badgeOff]}>{t(`privacy.support_status_${r.effective_status}`)}</Text>
              </View>
              <Text style={styles.rowDesc}>{r.reason}</Text>
              <Text style={styles.muted}>
                {t(r.scope === 'crm_read' ? 'privacy.support_scope_crm' : 'privacy.support_scope_diag')} · {t('privacy.support_duration', { minutes: r.requested_duration_minutes })} · {fmt(r.requested_at)}
              </Text>
              {r.expires_at ? <Text style={styles.muted}>{t('privacy.support_expires', { date: fmt(r.expires_at) })}</Text> : null}
              {r.effective_status === 'pending' ? (
                <View style={styles.actions}>
                  <Button size="sm" variant="ghost" label={t('privacy.support_refuse')} onPress={() => run('support', () => respondToSupportAccessRequest(r.id, false))} />
                  <Button size="sm" label={t('privacy.support_allow')} onPress={() => run('support', () => respondToSupportAccessRequest(r.id, true))} />
                </View>
              ) : null}
              {r.effective_status === 'approved' ? (
                <View style={styles.actions}>
                  <Button size="sm" variant="danger" label={t('privacy.support_revoke')} onPress={() => run('support', () => revokeMySupportAccess(r.id))} />
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* ── Mes données ────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon="📦" title={t('privacy.data_title')} styles={styles} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('privacy.export_title')}</Text>
              <Text style={styles.rowDesc}>{t('privacy.export_desc')}</Text>
            </View>
            <Button size="sm" variant="secondary" label={t('privacy.export_action')} onPress={() => router.push('/(app)/export' as any)} />
          </View>

          <View style={styles.divider} />
          {pendingDeletion ? (
            <View style={[styles.subBox, styles.dangerBox]}>
              <Text style={styles.rowTitle}>{t('privacy.delete_pending_title')}</Text>
              <Text style={styles.rowDesc}>{t('privacy.delete_pending_desc', { date: fmt(pendingDeletion.scheduled_for, false) })}</Text>
              <View style={styles.actions}>
                <Button size="sm" label={t('privacy.delete_cancel')} onPress={() => run('deletion', cancelAccountDeletion, t('privacy.delete_cancelled'))} loading={busy === 'deletion'} />
              </View>
            </View>
          ) : (
            <>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.danger }]}>{t('privacy.delete_title')}</Text>
                  <Text style={styles.rowDesc}>{t('privacy.delete_desc')}</Text>
                </View>
                {!deleteOpen ? <Button size="sm" variant="ghost" label={t('privacy.delete_action')} onPress={() => setDeleteOpen(true)} disabled={!deletionAvailable} /> : null}
              </View>
              {!deletionAvailable ? <Text style={styles.muted}>{t('privacy.delete_unavailable')}</Text> : null}
              {deleteOpen ? (
                <View style={[styles.subBox, styles.dangerBox]}>
                  <Text style={styles.warnText}>⚠️ {t('privacy.delete_warning')}</Text>
                  <TextInput style={[styles.input, styles.inputMultiline]} value={deleteReason} onChangeText={setDeleteReason} multiline maxLength={500} placeholder={t('privacy.delete_reason')} placeholderTextColor={colors.textTertiary} />
                  <Text style={styles.rowDesc}>{t('privacy.delete_type_word', { word: confirmWord })}</Text>
                  <TextInput style={styles.input} value={deleteWord} onChangeText={setDeleteWord} autoCapitalize="characters" placeholder={confirmWord} placeholderTextColor={colors.textTertiary} />
                  <View style={styles.actions}>
                    <Button size="sm" variant="ghost" label={t('common.cancel')} onPress={() => { setDeleteOpen(false); setDeleteWord(''); setDeleteReason('') }} />
                    <Button
                      size="sm"
                      variant="danger"
                      label={t('privacy.delete_confirm')}
                      loading={busy === 'deletion'}
                      disabled={deleteWord.trim().toUpperCase() !== confirmWord.toUpperCase()}
                      onPress={() => run('deletion', async () => {
                        await requestAccountDeletion(deleteReason)
                        setDeleteOpen(false); setDeleteWord(''); setDeleteReason('')
                      }, t('privacy.delete_requested'))}
                    />
                  </View>
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </>
  )
}

function SectionHeader({ icon, title, styles }: { icon: string; title: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionIcon}><Text style={styles.sectionEmoji}>{icon}</Text></View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { padding: 20, gap: 16, maxWidth: 760, width: '100%', alignSelf: 'center' },
    title: { fontSize: 25, fontFamily: fonts.bold, color: colors.text },
    intro: { fontSize: 14, lineHeight: 21, fontFamily: fonts.body, color: colors.textSecondary },
    notice: { fontSize: 13.5, fontFamily: fonts.medium, color: colors.success },
    error: { fontSize: 13.5, fontFamily: fonts.medium, color: colors.danger },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, padding: 16, gap: 12, ...SOFT_CARD_SHADOW },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    sectionIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
    sectionEmoji: { fontSize: 15 },
    sectionTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
    rowText: { flex: 1, minWidth: 180, gap: 2 },
    rowTitle: { fontSize: 14.5, fontFamily: fonts.semibold, color: colors.text },
    rowDesc: { fontSize: 13, lineHeight: 19, fontFamily: fonts.body, color: colors.textSecondary },
    muted: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textTertiary },
    divider: { height: 1, backgroundColor: colors.border },
    subBox: { gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    warnBox: { borderColor: colors.warning, backgroundColor: colors.warningLight },
    dangerBox: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
    warnText: { fontSize: 13.5, lineHeight: 20, fontFamily: fonts.medium, color: colors.text },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
    input: { width: '100%', minHeight: 44, fontSize: 14, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
    fieldError: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.danger },
    badge: { fontSize: 11, fontFamily: fonts.bold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
    badgeOn: { color: colors.success, backgroundColor: colors.successLight },
    badgeOff: { color: colors.textSecondary, backgroundColor: colors.bgDim },
    qr: { alignSelf: 'center', padding: 20, borderRadius: 12, backgroundColor: '#fff' },
    secret: { fontSize: 12, fontFamily: fonts.medium, color: colors.text, textAlign: 'center' },
    deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
    deviceIcon: { fontSize: 20 },
    deviceName: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
  })
}
