import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import type { Client } from '@/shared/lib/types'
import { CLIENT_EXPECTATION_FIELDS, updateClientExpectations } from './clientService'
import type { ClientExpectationField, ClientExpectations } from './clientService'

const FIELD_META: Record<ClientExpectationField, { icon: string; multiline: boolean }> = {
  expectation_goals:       { icon: '🎯', multiline: true },
  expectation_habits:      { icon: '⏱', multiline: true },
  expectation_motivation:  { icon: '✨', multiline: true },
  contact_preference:      { icon: '📞', multiline: false },
  next_exchange_questions: { icon: '❓', multiline: true },
}

interface Props {
  client: Client
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onSaved: () => void
}

function draftFrom(client: Client): Record<ClientExpectationField, string> {
  return Object.fromEntries(CLIENT_EXPECTATION_FIELDS.map(f => [f, client[f] ?? ''])) as Record<ClientExpectationField, string>
}

export function ContactExpectationsCard({ client, editing, onEditingChange, onSaved }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [draft, setDraft] = useState(() => draftFrom(client))
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => { if (editing) { setDraft(draftFrom(client)); setErrorMsg('') } }, [editing, client])

  async function handleSave() {
    setSaving(true)
    setErrorMsg('')
    try {
      const input = Object.fromEntries(
        CLIENT_EXPECTATION_FIELDS.map(f => [f, draft[f].trim() || null]),
      ) as ClientExpectations
      await updateClientExpectations(client.id, input)
      onEditingChange(false)
      onSaved()
    } catch (e) {
      console.error('[expectations.save]', e)
      setErrorMsg(t('clients.expectations_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>🎯 {t('clients.expectations_title')}</Text>
          <Text style={styles.subtitle}>{t('clients.expectations_subtitle')}</Text>
        </View>
        {!editing ? (
          <TouchableOpacity onPress={() => onEditingChange(true)} activeOpacity={0.7}>
            <Text style={styles.linkText}>{t('common.edit')} ›</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {CLIENT_EXPECTATION_FIELDS.map(field => {
        const meta = FIELD_META[field]
        const label = t(`clients.expectations_fields.${field}.label`)
        if (editing) {
          return (
            <View key={field} style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>{meta.icon} {label}</Text>
              <TextInput
                style={[styles.input, meta.multiline && styles.inputMultiline]}
                value={draft[field]}
                onChangeText={text => setDraft(prev => ({ ...prev, [field]: text }))}
                placeholder={t(`clients.expectations_fields.${field}.placeholder`)}
                placeholderTextColor={colors.textTertiary}
                multiline={meta.multiline}
                accessibilityLabel={label}
              />
            </View>
          )
        }
        const value = client[field]
        return (
          <TouchableOpacity key={field} style={styles.fieldBlock} onPress={() => onEditingChange(true)} activeOpacity={0.75}>
            <Text style={styles.fieldLabel}>{meta.icon} {label}</Text>
            {value
              ? <Text style={styles.fieldValue}>{value}</Text>
              : <Text style={styles.addText}>+ {t('clients.expectations_add_field')}</Text>}
          </TouchableOpacity>
        )
      })}

      {editing ? (
        <>
          <Text style={styles.hint}>{t('clients.expectations_privacy_hint')}</Text>
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => onEditingChange(false)} disabled={saving} activeOpacity={0.8}>
              <Text style={styles.outlineBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>{t('common.save')}</Text>}
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, gap: 14, ...SOFT_CARD_SHADOW },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
    subtitle: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    fieldBlock: { gap: 4 },
    fieldLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
    fieldValue: { fontSize: 14, lineHeight: 20, fontFamily: fonts.body, color: colors.text },
    addText: { fontSize: 13, fontFamily: fonts.medium, color: colors.primary },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.card },
    inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
    hint: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    errorText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    linkText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    outlineBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    outlineBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    primaryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.primaryAction, minWidth: 110, alignItems: 'center' },
    primaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onPrimary },
  })
}
