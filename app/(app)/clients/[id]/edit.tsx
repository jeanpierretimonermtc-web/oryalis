import { useState, useEffect, useMemo } from 'react'
import { ScrollView, View, Text, Switch, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { updateClient, deleteClient } from '@/features/clients/clientService'
import { logClientEvent } from '@/features/clients/clientEventService'
import { useClient } from '@/features/clients/useClient'
import { useAuth } from '@/features/auth/AuthProvider'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { PIPELINE_STAGES, LRP_STATUSES } from '@/shared/lib/types'
import type { NetworkPotential, ContactRole, PipelineStage, LrpStatus } from '@/shared/lib/types'
import { computeRelationshipHealth } from '@/features/clients/relationshipHealth'
import { deriveLastName } from '@/shared/lib/clientName'
import { formatDate } from '@/shared/lib/dateFormat'

const CONTACT_ROLES: ContactRole[] = ['prospect', 'customer', 'distributor', 'leader', 'team_member', 'inactive']
const NETWORK_POTENTIALS: NetworkPotential[] = ['low', 'medium', 'high']

const SECTION_ACCENTS: Record<string, (colors: ThemeColors) => { fg: string; bg: string }> = {
  'clients.sections.personal': c => ({ fg: c.primary,   bg: c.primaryLight }),
  'clients.sections.status':   c => ({ fg: c.tertiary,  bg: c.tertiaryLight }),
  'clients.sections.profile':  c => ({ fg: c.secondary, bg: c.secondaryLight }),
  'clients.sections.medical':  c => ({ fg: c.danger,    bg: c.dangerLight }),
  'clients.sections.journey':  c => ({ fg: c.warning,   bg: c.warningLight }),
  'clients.sections.doterra':  c => ({ fg: c.success,   bg: c.successLight }),
}

function SectionCard({ icon, titleKey, children }: { icon: string; titleKey: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const accent = (SECTION_ACCENTS[titleKey] ?? (() => ({ fg: colors.primary, bg: colors.primaryLight })))(colors)
  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: accent.fg }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIconBadge, { backgroundColor: accent.bg }]}>
          <Text style={styles.cardIcon}>{icon}</Text>
        </View>
        <Text style={styles.cardTitle}>{t(titleKey)}</Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  )
}

export default function EditClientScreen() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('fr') ? 'fr-FR' : 'en-US'
  const { colors, statusColors } = useTheme()
  const { isModuleActive, getRoleLabel, getLrpName } = useAppConfig()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { id } = useLocalSearchParams<{ id: string }>()
  const { width } = useWindowDimensions()
  const isWide = width >= 768
  const { session } = useAuth()

  const { client, loading: clientLoading } = useClient(id)

  const [firstName, setFirstName]           = useState('')
  const [lastName, setLastName]             = useState('')
  const [email, setEmail]                   = useState('')
  const [phone, setPhone]                   = useState('')
  const [isVip, setIsVip]                   = useState(false)
  const [manuallyInactive, setManuallyInactive] = useState(false)
  const [inscriptionDate, setInscriptionDate] = useState('')
  const [birthDate, setBirthDate]           = useState('')
  const [profession, setProfession]         = useState('')
  const [children, setChildren]             = useState('')
  const [source, setSource]                 = useState('')
  const [country, setCountry]               = useState('')
  const [clientType, setClientType]         = useState('')
  const [interests, setInterests]           = useState('')
  const [particularities, setParticularities] = useState('')
  const [medicalTreatment, setMedicalTreatment] = useState(false)
  const [medicalNotes, setMedicalNotes]     = useState('')
  const [networkPotential, setNetworkPotential] = useState<NetworkPotential | null>(null)
  const [doterraId, setDoterraId]           = useState('')
  const [loyaltyNotes, setLoyaltyNotes]     = useState('')
  const [trackingConsentAt, setTrackingConsentAt] = useState<string | null>(null)
  const [lrpStatus, setLrpStatus]           = useState<LrpStatus>('not_enrolled')
  const [nextLrpDate, setNextLrpDate]       = useState('')
  const [lrpLoyaltyPercent, setLrpLoyaltyPercent] = useState('')
  const [lrpStartDate, setLrpStartDate]     = useState('')
  const [address, setAddress]               = useState('')
  const [contactRole, setContactRole]       = useState<ContactRole[]>(['prospect'])
  const [pipelineStage, setPipelineStage]   = useState<PipelineStage>('new_lead')

  const [saving, setSaving]         = useState(false)
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    if (!client) return
    const fn   = (client.first_name ?? '').trim()
    const ln   = deriveLastName(client.full_name, client.first_name)
    setFirstName(fn)
    setLastName(ln)
    setEmail(client.email ?? '')
    setPhone(client.phone ?? '')
    setIsVip(client.is_vip ?? false)
    setManuallyInactive(client.manually_inactive ?? false)
    setInscriptionDate(client.inscription_date ?? '')
    setBirthDate(client.birth_date ?? '')
    setProfession(client.profession ?? '')
    setChildren(client.children ?? '')
    setSource(client.source ?? '')
    setCountry(client.country ?? '')
    setClientType(client.client_type ?? '')
    setInterests((client.interests ?? []).join(', '))
    setParticularities(client.particularities ?? '')
    setMedicalTreatment(client.medical_treatment ?? false)
    setMedicalNotes(client.medical_notes ?? '')
    setDoterraId(client.doterra_id ?? '')
    setLoyaltyNotes(client.loyalty_notes ?? '')
    setTrackingConsentAt(client.tracking_consent_at ?? null)
    setLrpStatus(client.lrp_status ?? 'not_enrolled')
    setNextLrpDate(client.next_lrp_date ?? '')
    setLrpLoyaltyPercent(client.lrp_loyalty_percent != null ? String(client.lrp_loyalty_percent) : '')
    setLrpStartDate(client.lrp_start_date ?? '')
    setAddress(client.address ?? '')
    setNetworkPotential(client.network_potential ?? null)
    setContactRole(client.contact_role?.length ? client.contact_role : ['prospect'])
    setPipelineStage(client.pipeline_stage ?? 'new_lead')
  }, [client])

  async function handleSave() {
    setErrorMsg(null)
    const fn = firstName.trim()
    const ln = lastName.trim()
    if (!fn && !ln) { setErrorMsg(t('clients.error_name_required')); return }
    const interestList = interests.split(',').map(s => s.trim()).filter(Boolean)
    setSaving(true)
    try {
      const oldPipelineStage = client?.pipeline_stage ?? null
      const oldContactRoles  = [...(client?.contact_role ?? [])].sort().join(',')
      const newContactRoles  = [...contactRole].sort().join(',')

      await updateClient(id, {
        first_name: fn || null,
        full_name: [fn, ln].filter(Boolean).join(' '),
        email: email.trim() || null,
        phone: phone.trim() || null,
        is_vip: isVip,
        manually_inactive: manuallyInactive,
        inscription_date: inscriptionDate || null,
        birth_date: birthDate || null,
        profession: profession.trim() || null,
        children: children.trim() || null,
        source: source.trim() || null,
        country: country.trim() || null,
        client_type: clientType.trim() || null,
        interests: interestList,
        particularities: particularities.trim() || null,
        medical_treatment: medicalTreatment,
        medical_notes: medicalNotes.trim() || null,
        doterra_id: doterraId.trim() || null,
        loyalty_notes: loyaltyNotes.trim() || null,
        tracking_consent_at: trackingConsentAt,
        lrp_status: lrpStatus,
        next_lrp_date: nextLrpDate || null,
        lrp_loyalty_percent: lrpLoyaltyPercent.trim() ? Math.max(0, Math.min(100, parseInt(lrpLoyaltyPercent, 10) || 0)) : null,
        lrp_start_date: lrpStartDate || null,
        address: address.trim() || null,
        journey_stage: client?.journey_stage ?? null, // retiré du formulaire, remplacé par pipeline_stage — valeur existante préservée
        network_potential: networkPotential,
        contact_role: contactRole,
        pipeline_stage: pipelineStage,
      })

      // Traçabilité (refonte) — ne doit jamais faire échouer l'enregistrement principal.
      if (session && client) {
        try {
          if (oldPipelineStage !== pipelineStage) {
            await logClientEvent(session.user.id, id, 'pipeline_change', { old_value: oldPipelineStage, new_value: pipelineStage })
          }
          if (oldContactRoles !== newContactRoles) {
            await logClientEvent(session.user.id, id, 'role_change', { old_value: oldContactRoles, new_value: newContactRoles })
          }
        } catch (logError) {
          console.error('[logClientEvent]', logError)
        }
      }

      router.back()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('common.error'))
      console.error('[updateClient]', e)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDel) { setConfirmDel(true); return }
    setSaving(true)
    try {
      await deleteClient(id)
      router.push('/(app)/clients')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('common.error'))
      console.error('[deleteClient]', e)
    } finally {
      setSaving(false)
    }
  }

  if (clientLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={colors.primaryAction} size="large" />
      </View>
    )
  }

  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')

  return (
    <>
      <Stack.Screen options={{ title: client?.full_name ?? t('common.edit'), headerBackTitle: '' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Identité ───────────────────────────────────────────── */}
        <SectionCard icon="👤" titleKey="clients.sections.personal">
          <View style={isWide ? styles.fieldRow : undefined}>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={t('clients.fields.first_name')} value={firstName} onChangeText={setFirstName} autoCapitalize="words" placeholder="Marie" />
            </View>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={t('clients.fields.last_name')} value={lastName} onChangeText={setLastName} autoCapitalize="words" placeholder="Dupont" />
            </View>
          </View>
          {displayName ? (
            <View style={styles.namePreviewCard}>
              <Text style={styles.namePreviewLabel}>{t('clients.name_preview')}</Text>
              <Text style={styles.namePreviewValue}>{displayName}</Text>
            </View>
          ) : null}
          <View style={isWide ? styles.fieldRow : undefined}>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={t('clients.fields.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </View>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={t('clients.fields.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            </View>
          </View>
          <Input
            label={`${t('clients.fields.address')} (${t('common.optional')})`}
            value={address}
            onChangeText={setAddress}
            placeholder="12 rue des Lilas, 75001 Paris"
          />
          <View style={isWide ? styles.fieldRow : undefined}>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <DateInput label={t('clients.fields.inscription_date')} value={inscriptionDate} onChangeValue={setInscriptionDate} />
            </View>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <DateInput label={`${t('clients.fields.birth_date')} (${t('common.optional')})`} value={birthDate} onChangeValue={setBirthDate} />
            </View>
          </View>
        </SectionCard>

        {/* ── Statut ─────────────────────────────────────────────── */}
        <SectionCard icon="🏷" titleKey="clients.sections.status">
          {client ? (() => {
            const health = computeRelationshipHealth({
              next_action_at: client.next_action_at,
              last_interaction_at: client.last_interaction_at,
              manually_inactive: manuallyInactive,
              created_at: client.created_at,
            })
            const hc = statusColors[health.tier] ?? { bg: colors.surfaceContainerHigh, text: colors.textSecondary }
            return (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('clients.computed_health_label')}</Text>
                <View style={[styles.healthPill, { backgroundColor: hc.bg }]}>
                  <Text style={[styles.healthPillText, { color: hc.text }]}>{t(`relationship_health.${health.tier}`)}</Text>
                </View>
              </View>
            )
          })() : null}
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('clients.fields.is_vip')}</Text>
            <Switch value={isVip} onValueChange={setIsVip} trackColor={{ true: colors.primary }} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('clients.fields.manually_inactive')}</Text>
            <Switch value={manuallyInactive} onValueChange={setManuallyInactive} trackColor={{ true: colors.primary }} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('clients.fields.tracking_consent')}</Text>
            <Switch
              value={!!trackingConsentAt}
              onValueChange={(v) => setTrackingConsentAt(v ? new Date().toISOString() : null)}
              trackColor={{ true: colors.primary }}
            />
          </View>
          {trackingConsentAt ? (
            <Text style={styles.consentDate}>
              {t('clients.tracking_consent_recorded_at', { date: formatDate(trackingConsentAt, locale) })}
            </Text>
          ) : null}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('clients.contact_role.label')}</Text>
            <View style={styles.chipRow}>
              {CONTACT_ROLES.map(role => {
                const active = contactRole.includes(role)
                return (
                  <TouchableOpacity
                    key={role}
                    style={[styles.smallChip, active && styles.smallChipActive]}
                    onPress={() => setContactRole(prev =>
                      prev.includes(role)
                        ? (prev.length > 1 ? prev.filter(r => r !== role) : prev)
                        : [...prev, role]
                    )}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.smallChipText, active && styles.smallChipTextActive]}>
                      {getRoleLabel(role)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </SectionCard>

        {/* ── Profil ─────────────────────────────────────────────── */}
        <SectionCard icon="📋" titleKey="clients.sections.profile">
          <View style={isWide ? styles.fieldRow : undefined}>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={`${t('clients.fields.profession')} (${t('common.optional')})`} value={profession} onChangeText={setProfession} />
            </View>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={`${t('clients.fields.children')} (${t('common.optional')})`} value={children} onChangeText={setChildren} />
            </View>
          </View>
          <View style={isWide ? styles.fieldRow : undefined}>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={`${t('clients.fields.country')} (${t('common.optional')})`} value={country} onChangeText={setCountry} />
            </View>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={`${t('clients.fields.source')} (${t('common.optional')})`} value={source} onChangeText={setSource} />
            </View>
          </View>
          <Input label={`${t('clients.fields.client_type')} (${t('common.optional')})`} value={clientType} onChangeText={setClientType} />
          <Input label={`${t('clients.fields.interests')} (${t('common.optional')})`} value={interests} onChangeText={setInterests} placeholder="Nutrition, Sommeil, Stress" />
        </SectionCard>

        {/* ── Santé ──────────────────────────────────────────────── */}
        <SectionCard icon="🩺" titleKey="clients.sections.medical">
          <Text style={styles.medicalDisclaimer}>{t('clients.medical_disclaimer')}</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('clients.fields.medical_treatment')}</Text>
            <Switch value={medicalTreatment} onValueChange={setMedicalTreatment} trackColor={{ true: colors.primary }} />
          </View>
          {medicalTreatment ? (
            <TextArea label={t('clients.fields.medical_notes')} value={medicalNotes} onChangeText={setMedicalNotes} />
          ) : null}
          <TextArea label={`${t('clients.fields.particularities')} (${t('common.optional')})`} value={particularities} onChangeText={setParticularities} />
        </SectionCard>

        {/* ── Parcours ───────────────────────────────────────────── */}
        <SectionCard icon="🗺" titleKey="clients.sections.journey">
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('clients.fields.pipeline_stage')}</Text>
            <View style={styles.chipRow}>
              {PIPELINE_STAGES.map(stage => {
                const active = pipelineStage === stage
                return (
                  <TouchableOpacity key={stage} style={[styles.smallChip, active && styles.smallChipActive]} onPress={() => setPipelineStage(stage)} activeOpacity={0.7}>
                    <Text style={[styles.smallChipText, active && styles.smallChipTextActive]}>{t(`pipeline_stages.${stage}`)}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('clients.fields.network_potential')}</Text>
            <View style={styles.chipRow}>
              {NETWORK_POTENTIALS.map(np => {
                const active = networkPotential === np
                return (
                  <TouchableOpacity
                    key={np}
                    style={[styles.smallChip, active && styles.smallChipActive]}
                    onPress={() => setNetworkPotential(networkPotential === np ? null : np)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.smallChipText, active && styles.smallChipTextActive]}>
                      {t(`network_potentials.${np}`)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </SectionCard>

        {/* ── doTERRA (module renewals_lrp) ──────────────────────── */}
        {isModuleActive('renewals_lrp') && (
          <SectionCard icon="⭐" titleKey="clients.sections.doterra">
            <Input label={`${t('clients.fields.doterra_id')} (${t('common.optional')})`} value={doterraId} onChangeText={setDoterraId} />

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('clients.fields.lrp_status', { name: getLrpName() })}</Text>
              <View style={styles.chipRow}>
                {LRP_STATUSES.map(status => {
                  const active = lrpStatus === status
                  return (
                    <TouchableOpacity key={status} style={[styles.smallChip, active && styles.smallChipActive]} onPress={() => setLrpStatus(status)} activeOpacity={0.7}>
                      <Text style={[styles.smallChipText, active && styles.smallChipTextActive]}>{t(`lrp_statuses.${status}`)}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            {lrpStatus !== 'not_enrolled' && (
              <>
                <DateInput label={t('clients.fields.next_lrp_date', { name: getLrpName() })} value={nextLrpDate} onChangeValue={setNextLrpDate} />
                <DateInput label={`${t('clients.fields.lrp_start_date')} (${t('common.optional')})`} value={lrpStartDate} onChangeValue={setLrpStartDate} />
                <Input
                  label={`${t('clients.fields.lrp_loyalty_percent')} (${t('common.optional')})`}
                  value={lrpLoyaltyPercent}
                  onChangeText={v => setLrpLoyaltyPercent(v.replace(/\D/g, '').slice(0, 3))}
                  placeholder="0-100"
                  keyboardType="number-pad"
                />
              </>
            )}

            <TextArea label={`${t('clients.fields.loyalty_notes')} (${t('common.optional')})`} value={loyaltyNotes} onChangeText={setLoyaltyNotes} />
          </SectionCard>
        )}

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
        <Button label={t('common.save')} onPress={handleSave} loading={saving} />

        {/* ── Zone de danger ────────────────────────────────────── */}
        <View style={styles.dangerZone}>
          {confirmDel ? (
            <View style={styles.confirmRow}>
              <Text style={styles.confirmText}>{t('common.confirm_delete')}</Text>
              <View style={styles.confirmBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setConfirmDel(false)}>
                  <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} disabled={saving}>
                  <Text style={styles.deleteBtnText}>{t('common.delete')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.deleteTrigger} onPress={() => setConfirmDel(true)}>
              <Text style={styles.deleteTriggerText}>🗑 {t('common.delete')} {client?.full_name}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDim },
  container:   { flex: 1, backgroundColor: colors.bgDim },
  content:     { padding: 16, gap: 18, paddingBottom: 40 },
  contentWide: { maxWidth: 720, alignSelf: 'center', width: '100%', paddingHorizontal: 24 },
  fieldRow:    { flexDirection: 'row', gap: 12 },
  fieldHalf:   { flex: 1 },

  // ── Section card ────────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(0, 0, 0, 0.08)' }],
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cardIconBadge: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardIcon:  { fontSize: 13 },
  cardTitle: { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  cardBody:  { padding: 16, gap: 12 },

  // ── Name preview ─────────────────────────────────────────────────────────────
  namePreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  namePreviewLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.primary, opacity: 0.75 },
  namePreviewValue: { fontSize: 16, fontFamily: fonts.bold, color: colors.primary },

  // ── Chips ────────────────────────────────────────────────────────────────────
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  healthPill:      { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 },
  healthPillText:  { fontSize: 12, fontFamily: fonts.semibold },

  // ── Field group + small chips ─────────────────────────────────────────────────
  fieldGroup:  { gap: 8 },
  fieldLabel:  { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  smallChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  smallChipActive:      { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  smallChipIcon:        { fontSize: 13 },
  smallChipText:        { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  smallChipTextActive:  { color: colors.primary, fontFamily: fonts.semibold },

  // ── Switch ────────────────────────────────────────────────────────────────────
  switchRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  switchLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },
  medicalDisclaimer: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 17, marginBottom: 10 },
  consentDate: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: -2, marginBottom: 4 },

  // ── Error ─────────────────────────────────────────────────────────────────────
  error: { fontSize: 14, color: colors.danger, textAlign: 'center', padding: 12, backgroundColor: colors.dangerLight, borderRadius: 10 },

  // ── Danger zone ───────────────────────────────────────────────────────────────
  dangerZone:        { marginTop: 8, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.border },
  deleteTrigger:     { alignItems: 'center', padding: 14 },
  deleteTriggerText: { fontSize: 14, fontFamily: fonts.medium, color: colors.danger },
  confirmRow:        { gap: 12 },
  confirmText:       { fontSize: 14, fontFamily: fonts.body, color: colors.text, textAlign: 'center' },
  confirmBtns:       { flexDirection: 'row', gap: 10 },
  cancelBtn:         { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelBtnText:     { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  deleteBtn:         { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: colors.danger, alignItems: 'center' },
  deleteBtnText:     { fontSize: 14, fontFamily: fonts.semibold, color: '#ffffff' },
  })
}
