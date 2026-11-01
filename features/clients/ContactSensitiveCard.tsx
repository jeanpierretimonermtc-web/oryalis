import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Switch } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import type { Client } from '@/shared/lib/types'
import { updateClientSensitive } from './clientService'

interface Props {
  client: Client
  onSaved: () => void
}

// Zone sensible — jamais affichée par défaut : lecture et modification passent par un clic explicite.
export function ContactSensitiveCard({ client, onSaved }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [revealed, setRevealed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [treatment, setTreatment] = useState(false)
  const [medicalNotes, setMedicalNotes] = useState('')
  const [particularities, setParticularities] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!editing) return
    setTreatment(client.medical_treatment ?? false)
    setMedicalNotes(client.medical_notes ?? '')
    setParticularities(client.particularities ?? '')
    setErrorMsg('')
  }, [editing, client])

  const particularityItems = (client.particularities ?? '').split('\n').map(s => s.trim()).filter(Boolean)
  const isEmpty = !client.medical_notes && particularityItems.length === 0 && !client.medical_treatment

  async function handleSave() {
    setSaving(true)
    setErrorMsg('')
    try {
      await updateClientSensitive(client.id, {
        medical_treatment: treatment,
        medical_notes: treatment ? medicalNotes.trim() || null : null,
        particularities: particularities.trim() || null,
      })
      setEditing(false)
      setRevealed(true)
      onSaved()
    } catch (e) {
      console.error('[sensitive.save]', e)
      setErrorMsg(t('clients.sensitive_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <Lock size={14} color={colors.danger} strokeWidth={2} />
        </View>
        <Text style={styles.title}>{t('clients.section_sensitive')}</Text>
        {!editing && (revealed || isEmpty) ? (
          <TouchableOpacity onPress={() => setEditing(true)} activeOpacity={0.7}>
            <Text style={styles.linkText}>{isEmpty ? `+ ${t('clients.sensitive_add')}` : `${t('common.edit')} ›`}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {editing ? (
        <>
          <Text style={styles.hint}>{t('clients.medical_disclaimer')}</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>{t('clients.fields.medical_treatment')}</Text>
            <Switch value={treatment} onValueChange={setTreatment} trackColor={{ true: colors.primary }} />
          </View>
          {treatment ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{t('clients.fields.medical_notes')}</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={medicalNotes}
                onChangeText={setMedicalNotes}
                multiline
                accessibilityLabel={t('clients.fields.medical_notes')}
              />
            </View>
          ) : null}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{t('clients.fields.particularities')}</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={particularities}
              onChangeText={setParticularities}
              placeholder={t('clients.sensitive_particularities_placeholder')}
              placeholderTextColor={colors.textTertiary}
              multiline
              accessibilityLabel={t('clients.fields.particularities')}
            />
          </View>
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => setEditing(false)} disabled={saving} activeOpacity={0.8}>
              <Text style={styles.outlineBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : isEmpty ? (
        <Text style={styles.hint}>{t('clients.sensitive_empty')}</Text>
      ) : revealed ? (
        <>
          {client.medical_treatment ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{t('clients.section_medical').toUpperCase()}</Text>
              <Text style={styles.bodyText}>{client.medical_notes || t('clients.fields.medical_treatment')}</Text>
            </View>
          ) : null}
          {particularityItems.length > 0 ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{t('clients.section_particularities').toUpperCase()}</Text>
              {particularityItems.map((item, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.bodyText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <TouchableOpacity onPress={() => setRevealed(false)} activeOpacity={0.7}>
            <Text style={styles.toggleText}>{t('clients.sensitive_hide')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity style={styles.revealBtn} onPress={() => setRevealed(true)} activeOpacity={0.75}>
          <Lock size={14} color={colors.danger} strokeWidth={2} />
          <Text style={styles.revealText}>{t('clients.sensitive_reveal')}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { width: '100%', backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, gap: 14, ...SOFT_CARD_SHADOW },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    iconBox: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerLight },
    title: { flex: 1, fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
    linkText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    fieldBlock: { gap: 4 },
    fieldLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
    bodyText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.body, color: colors.text },
    bulletRow: { flexDirection: 'row', gap: 8 },
    bullet: { fontSize: 14, lineHeight: 20, color: colors.textTertiary },
    hint: { fontSize: 12.5, lineHeight: 18, fontFamily: fonts.body, color: colors.textSecondary },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    switchLabel: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.card },
    inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
    errorText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    outlineBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    outlineBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    primaryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primaryAction, minWidth: 110, alignItems: 'center' },
    primaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onPrimary },
    revealBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.danger },
    revealText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.danger },
    toggleText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: 'center' },
  })
}
