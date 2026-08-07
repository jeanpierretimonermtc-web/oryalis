import { useMemo, useState } from 'react'
import { ScrollView, View, Text, StyleSheet, useWindowDimensions } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { createClient } from '@/features/clients/clientService'
import { updateAppointment } from '@/features/appointments/appointmentService'
import { Input } from '@/shared/components/ui/Input'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useContactQuota } from '@/features/clients/useContactQuota'
import { isContactQuotaError } from '@/features/clients/quotaService'

export default function NewClientScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { quota } = useContactQuota()
  const { width } = useWindowDimensions()
  const isWide = width >= 768
  // Lot 1.1 — arrivée depuis la clôture d'un RDV créé sans contact : une fois le contact
  // créé, on le rattache à ce RDV plutôt que d'aller vers la fiche du nouveau contact.
  const { returnToAppointmentId } = useLocalSearchParams<{ returnToAppointmentId?: string }>()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [email, setEmail]         = useState('')
  const [phone, setPhone]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [errorMsg, setErrorMsg]   = useState<string | null>(null)

  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')

  async function handleSave() {
    setErrorMsg(null)
    if (!firstName.trim() && !lastName.trim()) { setErrorMsg(t('clients.error_name_required')); return }
    if (!session) { setErrorMsg(t('clients.error_session')); return }
    if (quota?.reached) { setErrorMsg(t('clients.quota_reached')); return }
    setLoading(true)
    try {
      // Création minimale — le reste des champs (statut, profil, santé, parcours, doTERRA...)
      // se complète ensuite depuis la fiche contact ("Modifier"), pas besoin de tout demander ici.
      const client = await createClient(session.user.id, {
        first_name: firstName.trim() || null,
        full_name: displayName,
        avatar_url: null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        is_vip: false,
        manually_inactive: false,
        inscription_date: new Date().toISOString().split('T')[0],
        birth_date: null,
        profession: null,
        children: null,
        source: null,
        country: null,
        client_type: null,
        interests: [],
        particularities: null,
        medical_treatment: false,
        medical_notes: null,
        doterra_id: null,
        loyalty_notes: null,
        address: null,
        language: 'fr',
        next_lrp_date: null,
        lrp_status: 'not_enrolled',
        lrp_loyalty_percent: null,
        lrp_start_date: null,
        tracking_consent_at: null,
        welcome_email_sent: false,
        first_contact_date: null,
        first_purchase_date: null,
        acquisition_source: null,
        journey_stage: null,
        next_action_date: null,
        next_action_type: null,
        referrals_count: 0,
        referral_count: 0,
        network_potential: null,
        // Un contact tout juste ajouté est un prospect, pas déjà un client — cohérent avec
        // pipeline_stage='new_lead' (le rôle se précise ensuite depuis "Modifier").
        contact_role: ['prospect'],
        pipeline_stage: 'new_lead',
        sponsor_id: null,
      })
      if (returnToAppointmentId) {
        try {
          await updateAppointment(returnToAppointmentId, { client_id: client.id })
          router.replace(`/(app)/appointments/${returnToAppointmentId}` as any)
          return
        } catch (linkError) {
          // Le contact existe déjà à ce stade — on ne le perd pas, mais le rattachement
          // automatique a échoué : on retombe sur la fiche contact plutôt que de bloquer.
          console.error('[clients.new.linkAppointment]', linkError)
        }
      }
      router.replace(`/(app)/clients/${client.id}` as any)
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

        <View style={styles.card}>
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
              <Input label={`${t('clients.fields.phone')} (${t('common.optional')})`} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </View>
            <View style={isWide ? styles.fieldHalf : undefined}>
              <Input label={`${t('clients.fields.email')} (${t('common.optional')})`} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            </View>
          </View>
        </View>

        <Text style={styles.laterHint}>{t('clients.add_details_later')}</Text>

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

  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(0, 0, 0, 0.08)' }],
    elevation: 3,
  },

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

  laterHint: { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: 8 },

  error: { fontSize: 14, color: colors.danger, textAlign: 'center', padding: 12, backgroundColor: colors.dangerLight, borderRadius: 10 },
  })
}
