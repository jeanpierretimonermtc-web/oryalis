import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Switch, Linking } from 'react-native'
import { Stack, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { useBrands } from '@/features/brands/useBrands'
import { BrandAvatar } from '@/features/brands/BrandPill'
import { useLeadForm } from '@/features/leads/useLeadForm'
import { LEAD_SLUG_PATTERN, LeadSlugTakenError, slugify, leadPublicUrl } from '@/features/leads/leadService'

const GENERAL = 'general'

// "Ma marque" (Paramètres) : une marque unique → ses prospects y sont rattachés côté base.
const SINGLE_BRAND_NAME: Record<string, string> = { doterra: 'doTERRA', zinzino: 'Zinzino', herbalife: 'Herbalife' }

// LEAD-PAGE-1/2 — pages publiques de prospect : une seule page (marque unique ou générique),
// ou une page générale + une page par marque en mode Multi-marques ("Ma marque").
export default function LeadPageSettingsScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { session } = useAuth()
  const { profile } = useAppConfig()
  const { brands } = useBrands()
  const { forms, submissions, loading, save, createContact, remove, removeForm } = useLeadForm()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isMulti = profile.activity_type === 'multi'
  const singleBrandName = profile.activity_type === 'custom'
    ? profile.custom_brand_name?.trim() || null
    : SINGLE_BRAND_NAME[profile.activity_type] ?? null
  const [tab, setTab] = useState<string>(GENERAL)
  const brand = isMulti ? brands.find(b => b.id === tab) ?? null : null
  const brandId = brand?.id ?? null
  const form = forms.find(f => (f.brand_id ?? null) === brandId) ?? null

  const baseSlug = slugify(session?.user?.user_metadata?.full_name ?? session?.user?.email?.split('@')[0] ?? '')
  const defaultSlug = brand ? slugify(`${baseSlug}-${brand.name}`) : baseSlug
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [intro, setIntro] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    setSlug(form?.slug ?? defaultSlug)
    setTitle(form?.title ?? (brand ? t('lead_page.default_title_brand', { brand: brand.name }) : t('lead_page.default_title')))
    setIntro(form?.intro ?? t('lead_page.default_intro'))
    setActive(form?.active ?? true)
    setMessage(null)
    setConfirmDelete(false)
  }, [form, loading, defaultSlug, brand, t])

  // Réinitialiser : textes et adresse proposés par défaut (rien n'est enregistré avant
  // "Enregistrer").
  function resetFields() {
    setSlug(defaultSlug)
    setTitle(brand ? t('lead_page.default_title_brand', { brand: brand.name }) : t('lead_page.default_title'))
    setIntro(t('lead_page.default_intro'))
    setMessage({ kind: 'ok', text: t('lead_page.reset_done') })
  }

  async function handleDeleteForm() {
    if (!form) return
    setDeleting(true)
    try {
      await removeForm(form.id)
      setMessage({ kind: 'ok', text: t('lead_page.deleted') })
    } catch (e) {
      console.error('[leadPage.delete]', e)
      setMessage({ kind: 'error', text: t('lead_page.error') })
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const formSubmissions = form ? submissions.filter(s => s.form_id === form.id) : []
  const formPending = formSubmissions.filter(s => s.status === 'pending').length

  const slugValid = LEAD_SLUG_PATTERN.test(slug)
  const brandName = (id: string | null | undefined) => (id ? brands.find(b => b.id === id)?.name : null) ?? null
  const pending = submissions.filter(s => s.status === 'pending')

  async function handleSave() {
    if (!slugValid) { setMessage({ kind: 'error', text: t('lead_page.slug_invalid') }); return }
    if (title.trim().length < 2) { setMessage({ kind: 'error', text: t('lead_page.title_required') }); return }
    setSaving(true)
    setMessage(null)
    try {
      await save(form?.id ?? null, { brand_id: brandId, slug, title, intro, active })
      setMessage({ kind: 'ok', text: t('lead_page.saved') })
    } catch (e) {
      console.error('[leadPage.save]', e)
      setMessage({ kind: 'error', text: t(e instanceof LeadSlugTakenError ? 'lead_page.slug_taken' : 'lead_page.error') })
    } finally {
      setSaving(false)
    }
  }

  async function copyLink() {
    if (!form) return
    await Clipboard.setStringAsync(leadPublicUrl(form.slug))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('lead_page.title'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('lead_page.explain')}</Text>

        {/* Multi-marques : une page générale + une page par marque. */}
        {isMulti && brands.length > 0 ? (
          <View style={styles.tabs}>
            {[{ id: GENERAL, label: t('lead_page.tab_general'), b: null }, ...brands.map(b => ({ id: b.id, label: b.name, b }))].map(item => {
              const activeTab = tab === item.id
              const hasPage = forms.some(f => (f.brand_id ?? GENERAL) === item.id)
              return (
                <TouchableOpacity key={item.id} style={[styles.tab, activeTab && styles.tabActive]} onPress={() => setTab(item.id)} activeOpacity={0.75}>
                  {item.b ? <BrandAvatar brand={item.b} size={18} /> : <Text>🌐</Text>}
                  <Text style={[styles.tabText, activeTab && styles.tabTextActive]}>{item.label}</Text>
                  {hasPage ? <View style={styles.tabDot} /> : null}
                </TouchableOpacity>
              )
            })}
          </View>
        ) : null}

        {/* Rattachement des prospects selon "Ma marque". */}
        <Text style={styles.brandNote}>
          {brand
            ? t('lead_page.brand_note_brand', { brand: brand.name })
            : isMulti
              ? t('lead_page.brand_note_general_multi')
              : singleBrandName
                ? t('lead_page.brand_note_single', { brand: singleBrandName })
                : t('lead_page.brand_note_none')}
        </Text>

        {loading ? <ActivityIndicator color={colors.primary} /> : (
          <>
            {form ? (
              <View style={[styles.card, styles.linkCard]}>
                <Text style={styles.label}>{t('lead_page.your_link')}</Text>
                <Text style={styles.link} selectable>{leadPublicUrl(form.slug)}</Text>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={copyLink} activeOpacity={0.85}>
                    <Text style={styles.primaryBtnText}>{copied ? `✓ ${t('lead_page.copied')}` : `🔗 ${t('lead_page.copy')}`}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => Linking.openURL(leadPublicUrl(form.slug))} activeOpacity={0.8}>
                    <Text style={styles.secondaryBtnText}>👁 {t('lead_page.open')}</Text>
                  </TouchableOpacity>
                </View>
                {!form.active ? <Text style={styles.warn}>{t('lead_page.inactive_hint')}</Text> : null}
              </View>
            ) : (
              <Text style={styles.hint}>{t('lead_page.not_created_yet')}</Text>
            )}

            <View style={styles.card}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('lead_page.active')}</Text>
                <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.card} />
              </View>

              <Text style={styles.label}>{t('lead_page.slug_label')}</Text>
              <View style={styles.slugRow}>
                <Text style={styles.slugPrefix}>…/p/</Text>
                <TextInput
                  style={[styles.input, { flex: 1 }, !slugValid && slug.length > 0 && { borderColor: colors.danger }]}
                  value={slug}
                  onChangeText={v => setSlug(slugify(v))}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Text style={styles.hint}>{t('lead_page.slug_hint')}</Text>
              {form && slug !== form.slug ? <Text style={styles.warn}>{t('lead_page.slug_change_warning')}</Text> : null}

              <Text style={styles.label}>{t('lead_page.title_label')}</Text>
              <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={120} />

              <Text style={styles.label}>{t('lead_page.intro_label')}</Text>
              <TextInput style={[styles.input, styles.multiline]} value={intro} onChangeText={setIntro} multiline maxLength={600} />

              {message ? <Text style={message.kind === 'ok' ? styles.ok : styles.error}>{message.text}</Text> : null}
              <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>{form ? t('common.save') : t('lead_page.create_page')}</Text>}
              </TouchableOpacity>

              <View style={styles.footerLinks}>
                <TouchableOpacity onPress={resetFields} activeOpacity={0.7}>
                  <Text style={styles.linkText}>↺ {t('lead_page.reset')}</Text>
                </TouchableOpacity>
                {form ? (
                  <TouchableOpacity onPress={() => setConfirmDelete(true)} activeOpacity={0.7}>
                    <Text style={styles.removeText}>🗑 {t('lead_page.delete_page')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {confirmDelete && form ? (
                <View style={styles.deleteBox}>
                  <Text style={styles.deleteTitle}>{t('lead_page.delete_confirm', { url: leadPublicUrl(form.slug) })}</Text>
                  <Text style={styles.hint}>{t('lead_page.delete_hint')}</Text>
                  {formSubmissions.length > 0 ? (
                    <Text style={styles.warn}>
                      {t('lead_page.delete_submissions', { count: formSubmissions.length })}
                      {formPending > 0 ? ` ${t('lead_page.delete_pending', { count: formPending })}` : ''}
                    </Text>
                  ) : null}
                  <View style={styles.row}>
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setConfirmDelete(false)} disabled={deleting} activeOpacity={0.8}>
                      <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.dangerBtn} onPress={handleDeleteForm} disabled={deleting} activeOpacity={0.85}>
                      {deleting ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>{t('lead_page.delete_confirm_btn')}</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('lead_page.received_title')} · {submissions.length}</Text>
              {submissions.length === 0 ? <Text style={styles.hint}>{t('lead_page.received_empty')}</Text> : null}
              {pending.length > 0 ? <Text style={styles.warn}>{t('lead_page.pending_hint', { count: pending.length })}</Text> : null}
              {submissions.map(s => {
                const subBrand = brandName(s.form?.brand_id)
                return (
                  <View key={s.id} style={styles.subRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.subName}>{s.full_name}</Text>
                      <Text style={styles.subMeta} numberOfLines={1}>
                        {[formatDate(s.created_at, locale), subBrand ? `🏷 ${subBrand}` : null, s.email, s.phone].filter(Boolean).join(' · ')}
                      </Text>
                      {s.message ? <Text style={styles.subMessage} numberOfLines={2}>« {s.message} »</Text> : null}
                    </View>
                    {s.status === 'created' && s.client_id ? (
                      <TouchableOpacity onPress={() => router.push(`/(app)/clients/${s.client_id}` as any)} activeOpacity={0.7}>
                        <Text style={styles.linkText}>{t('lead_page.open_contact')} ›</Text>
                      </TouchableOpacity>
                    ) : s.status === 'pending' ? (
                      <View style={{ gap: 6, alignItems: 'flex-end' }}>
                        <TouchableOpacity
                          style={styles.smallBtn}
                          disabled={busyId === s.id}
                          onPress={async () => {
                            setBusyId(s.id)
                            try { await createContact(s) } catch (e) { console.error('[leadPage.createContact]', e); setMessage({ kind: 'error', text: t('lead_page.create_error') }) }
                            finally { setBusyId(null) }
                          }}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.smallBtnText}>{busyId === s.id ? '…' : `+ ${t('lead_page.create_contact')}`}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => remove(s.id)} activeOpacity={0.7}>
                          <Text style={styles.removeText}>{t('common.delete')}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                )
              })}
            </View>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%' },
    intro: { fontSize: 14, lineHeight: 20, fontFamily: fonts.body, color: colors.textSecondary },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    tabActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    tabText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
    tabTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    tabDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
    brandNote: { fontSize: 13, lineHeight: 18, fontFamily: fonts.medium, color: colors.text, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
    linkCard: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    cardTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    label: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.textSecondary },
    link: { fontSize: 15, fontFamily: fonts.semibold, color: colors.primary },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    primaryBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.primaryAction, alignItems: 'center' },
    primaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onPrimary },
    secondaryBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    secondaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    switchLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    slugRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    slugPrefix: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.bg },
    multiline: { minHeight: 90, textAlignVertical: 'top' },
    hint: { fontSize: 12.5, lineHeight: 18, fontFamily: fonts.body, color: colors.textSecondary },
    warn: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.warning },
    ok: { fontSize: 13, fontFamily: fonts.medium, color: colors.success },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    subName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    subMeta: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    subMessage: { fontSize: 12.5, fontFamily: fonts.body, color: colors.text },
    linkText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    smallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primaryLight },
    smallBtnText: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.primary },
    removeText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.danger },
    footerLinks: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 2 },
    deleteBox: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerLight },
    deleteTitle: { fontSize: 13.5, fontFamily: fonts.semibold, color: colors.text },
    dangerBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center' },
  })
}
