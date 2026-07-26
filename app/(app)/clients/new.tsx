import { useState, useMemo } from 'react'
import { ScrollView, View, Text, Switch, StyleSheet, useWindowDimensions, TouchableOpacity } from 'react-native'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { createClient } from '@/features/clients/clientService'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { PIPELINE_STAGES } from '@/shared/lib/types'
import type { ClientStatus, NetworkPotential, ContactRole, PipelineStage } from '@/shared/lib/types'
import { useContactQuota } from '@/features/clients/useContactQuota'
import { isContactQuotaError } from '@/features/clients/quotaService'

const STATUSES: ClientStatus[] = ['prospect', 'new_client', 'active', 'loyal', 'inactive', 'vip', 'advisor']
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

export default function NewClientScreen() {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const { getStatusLabel, isModuleActive } = useAppConfig()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { quota } = useContactQuota()
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  const [firstName, setFirstName]           = useState('')
  const [lastName, setLastName]             = useState('')
  const [email, setEmail]                   = useState('')
  const [phone, setPhone]                   = useState('')
  const [status, setStatus]                 = useState<ClientStatus>('prospect')
  const [inscriptionDate, setInscriptionDate] = useState(new Date().toISOString().split('T')[0])
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
  const [address, setAddress]               = useState('')
  const [contactRole, setContactRole]       = useState<ContactRole>('customer')
  const [pipelineStage, setPipelineStage]   = useState<PipelineStage>('new_lead')
  const [loading, setLoading]               = useState(false)
  const [errorMsg, setErrorMsg]             = useState<string | null>(null)

  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')

  async function handleSave() {
    setErrorMsg(null)
    if (!firstName.trim() && !lastName.trim()) { setErrorMsg(t('clients.error_name_required')); return }
    if (!session) { setErrorMsg(t('clients.error_session')); return }
    if (quota?.reached) { setErrorMsg(t('clients.quota_reached')); return }
    setLoading(true)
    try {
      const interestList = interests.split(',').map(s => s.trim()).filter(Boolean)
      await createClient(session.user.id, {
        first_name: firstName.trim() || null,
        full_name: displayName,
        email: email.trim() || null,
        phone: phone.trim() || null,
        status,
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
        address: address.trim() || null,
        language: 'fr',
        next_lrp_date: null,
        welcome_email_sent: false,
        first_contact_date: null,
        first_purchase_date: null,
        acquisition_source: null,
        journey_stage: null, // retiré du formulaire, remplacé par pipeline_stage
        next_action_date: null,
        next_action_type: null,
        referrals_count: 0,
        referral_count: 0,
        network_potential: networkPotential,
        contact_role: contactRole,
        pipeline_stage: pipelineStage,
        sponsor_id: null,
      })
      router.back()
    } catch (e: unknown) {
      setErrorMsg(isContactQuotaError(e) ? t('clients.quota_reached') : e instanceof Error ? e.message : t('common.error'))
      console.error('[createClient]', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t('clients.add'), headerBackTitle: '' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
        showsVerticalScrollIndicator={false}
      >
        {quota?.limit != null && (
          <View style={styles.quotaCard}>
            <Text style={styles.quotaText}>{t('clients.quota_count', { count: quota.activeCount, limit: quota.limit })}</Text>
          </View>
        )}
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
          <View style={styles.chipRow}>
            {STATUSES.map(s => {
              const active = status === s
              const cs = statusColors[s] ?? null
              const bg     = active ? (cs ? cs.bg   : colors.primaryAction) : colors.card
              const txtClr = active ? (cs ? cs.text : '#ffffff')            : colors.textSecondary
              const border = active ? (cs ? cs.text : colors.primaryAction) : colors.border
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusChip, { backgroundColor: bg, borderColor: border }]}
                  onPress={() => setStatus(s)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.statusChipText, { color: txtClr, fontFamily: active ? fonts.bold : fonts.medium }]}>
                    {getStatusLabel(s)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('clients.contact_role.label')}</Text>
            <View style={styles.chipRow}>
              {CONTACT_ROLES.map(role => {
                const active = contactRole === role
                return (
                  <TouchableOpacity
                    key={role}
                    style={[styles.smallChip, active && styles.smallChipActive]}
                    onPress={() => setContactRole(role)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.smallChipText, active && styles.smallChipTextActive]}>
                      {t(`clients.contact_role.${role}`)}
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
            <TextArea label={`${t('clients.fields.loyalty_notes')} (${t('common.optional')})`} value={loyaltyNotes} onChangeText={setLoyaltyNotes} />
          </SectionCard>
        )}

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
        <Button label={t('common.save')} onPress={handleSave} loading={loading} />
        <View style={{ height: 32 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.bgDim },
  content:     { padding: 16, gap: 18, paddingBottom: 40 },
  contentWide: { maxWidth: 720, alignSelf: 'center', width: '100%', paddingHorizontal: 24 },
  quotaCard: { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 12 },
  quotaText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
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

  // ── Status chips ─────────────────────────────────────────────────────────────
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusChip:   { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5 },
  statusChipText: { fontSize: 13 },

  // ── Field group + small chips ─────────────────────────────────────────────────
  fieldGroup:  { gap: 8 },
  fieldLabel:  { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  smallChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  smallChipActive:      { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  smallChipIcon:        { fontSize: 13 },
  smallChipText:        { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  smallChipTextActive:  { color: colors.primary, fontFamily: fonts.semibold },

  // ── Switch ────────────────────────────────────────────────────────────────────
  switchRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  switchLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },

  // ── Error ─────────────────────────────────────────────────────────────────────
  error: { fontSize: 14, color: colors.danger, textAlign: 'center', padding: 12, backgroundColor: colors.dangerLight, borderRadius: 10 },
  })
}
