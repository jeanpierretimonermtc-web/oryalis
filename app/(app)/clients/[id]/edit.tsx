import { useState, useEffect, useMemo } from 'react'
import { ScrollView, View, Text, Switch, StyleSheet, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { updateClient, deleteClient } from '@/features/clients/clientService'
import { useClient } from '@/features/clients/useClient'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { PIPELINE_STAGES } from '@/shared/lib/types'
import type { Client, ClientStatus, NetworkPotential, ContactRole, PipelineStage } from '@/shared/lib/types'

const STATUSES: ClientStatus[] = ['prospect', 'new_client', 'active', 'loyal', 'inactive', 'vip', 'advisor']
const CONTACT_ROLES: ContactRole[] = ['prospect', 'customer', 'distributor', 'leader', 'team_member', 'inactive']
const NETWORK_POTENTIALS: NetworkPotential[] = ['low', 'medium', 'high']

function SectionCard({ icon, titleKey, children }: { icon: string; titleKey: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle}>{t(titleKey)}</Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  )
}

export default function EditClientScreen() {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const { getStatusLabel, isModuleActive } = useAppConfig()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { id } = useLocalSearchParams<{ id: string }>()
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  const { client, loading: clientLoading } = useClient(id)

  const [firstName, setFirstName]           = useState('')
  const [lastName, setLastName]             = useState('')
  const [email, setEmail]                   = useState('')
  const [phone, setPhone]                   = useState('')
  const [status, setStatus]                 = useState<ClientStatus>('prospect')
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
  const [address, setAddress]               = useState('')
  const [contactRole, setContactRole]       = useState<ContactRole>('customer')
  const [pipelineStage, setPipelineStage]   = useState<PipelineStage>('new_lead')

  const [saving, setSaving]         = useState(false)
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    if (!client) return
    const fn   = (client.first_name ?? '').trim()
    const full = (client.full_name ?? '').trim()
    const ln   = fn && full.startsWith(fn) ? full.slice(fn.length).trim() : full
    setFirstName(fn)
    setLastName(ln)
    setEmail(client.email ?? '')
    setPhone(client.phone ?? '')
    setStatus(client.status)
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
    setAddress(client.address ?? '')
    setNetworkPotential(client.network_potential ?? null)
    setContactRole(client.contact_role ?? 'customer')
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
      await updateClient(id, {
        first_name: fn || null,
        full_name: [fn, ln].filter(Boolean).join(' '),
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
        journey_stage: client?.journey_stage ?? null, // retiré du formulaire, remplacé par pipeline_stage — valeur existante préservée
        network_potential: networkPotential,
        contact_role: contactRole,
        pipeline_stage: pipelineStage,
      })
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
  loader:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  container:   { flex: 1, backgroundColor: colors.bg },
  content:     { padding: 16, gap: 14, paddingBottom: 40 },
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
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.05)' }],
    elevation: 2,
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
  cardIcon:  { fontSize: 14 },
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
