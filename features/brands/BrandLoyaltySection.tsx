import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { formatDate } from '@/shared/lib/dateFormat'
import type { Client, RecurringProgram } from '@/shared/lib/types'
import { getLrpFrequencyLabel } from '@/features/clients/lrpProgramService'
import { updateProgram } from '@/features/clients/recurringProgramService'
import { updateClient } from '@/features/clients/clientService'
import { BrandPill } from './BrandPill'
import { updateClientBrandMemberNumber } from './brandService'
import type { ClientBrandWithBrand } from './brandService'
import { programTitleForBrand } from './programNaming'

interface Props {
  client: Client
  links: ClientBrandWithBrand[]
  programs: RecurringProgram[]
  globalProgramName: string
  onChanged: () => void
}

// PROGRAM-BRAND-1 — "Programme fidélité" de la fiche : un bloc par marque du contact (numéro de
// membre + ses programmes avec % et notes), puis les programmes sans marque à rattacher, et
// l'ancien numéro identifiant unique à attribuer à une marque.
export function BrandLoyaltySection({ client, links, programs, globalProgramName, onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const linkedBrandIds = new Set(links.map(l => l.brand_id))
  const unassigned = programs.filter(p => !p.brand_id || !linkedBrandIds.has(p.brand_id))
  const legacyNumber = client.doterra_id?.trim() || null
  const legacyPending = !!legacyNumber && !links.some(l => l.member_number?.trim() === legacyNumber)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setErrorMsg('')
    try {
      await action()
      onChanged()
    } catch (e) {
      console.error('[loyalty.section]', e)
      setErrorMsg(t('brands.error'))
    } finally {
      setBusy(false)
    }
  }

  // L'ancien numéro devient le N° membre de la marque choisie, puis l'ancien champ est vidé.
  function assignLegacyNumber(link: ClientBrandWithBrand) {
    if (!legacyNumber) return
    run(async () => {
      await updateClientBrandMemberNumber(link.id, legacyNumber)
      await updateClient(client.id, { doterra_id: null })
    })
  }

  const renderProgram = (program: RecurringProgram, brand: ClientBrandWithBrand['brand'] | null) => (
    <TouchableOpacity
      key={program.id}
      style={styles.programRow}
      onPress={() => router.push(`/(app)/recurring-programs/${program.id}` as any)}
      activeOpacity={0.75}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.programTitle}>🔁 {programTitleForBrand(brand, globalProgramName, program.label)}</Text>
        <Text style={styles.muted}>
          {getLrpFrequencyLabel(program.frequency_value, program.frequency_unit, t)}
          {program.status === 'active' && program.next_occurrence_date
            ? ` · ${t('lrp.next_order_label')} ${formatDate(program.next_occurrence_date, locale)}`
            : ` · ${t(`lrp_statuses.${program.status}`)}`}
        </Text>
        {program.loyalty_percent != null || program.notes ? (
          <Text style={styles.muted} numberOfLines={2}>
            {program.loyalty_percent != null ? `${t('clients.fields.lrp_loyalty_percent')} : ${program.loyalty_percent} %` : ''}
            {program.loyalty_percent != null && program.notes ? ' · ' : ''}
            {program.notes ?? ''}
          </Text>
        ) : null}
      </View>
      <Text style={styles.link}>{t('recurring_program.view_link')}</Text>
    </TouchableOpacity>
  )

  return (
    <View style={styles.card}>
      <Text style={styles.title}>⭐ {t('clients.sections.doterra')}</Text>

      {legacyPending ? (
        <View style={styles.legacyBox}>
          <Text style={styles.legacyText}>{t('brands.legacy_number', { number: legacyNumber })}</Text>
          {links.length > 0 ? (
            <View style={styles.chips}>
              {links.map(link => (
                <TouchableOpacity key={link.id} onPress={() => assignLegacyNumber(link)} disabled={busy} activeOpacity={0.8}>
                  <BrandPill brand={link.brand} />
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>{t('brands.legacy_number_no_brand')}</Text>
          )}
        </View>
      ) : null}

      {links.map(link => {
        const brandPrograms = programs.filter(p => p.brand_id === link.brand_id)
        return (
          <View key={link.id} style={styles.brandBlock}>
            <View style={styles.brandHeader}>
              <BrandPill brand={link.brand} />
              <Text style={styles.memberText}>
                {link.member_number ? t('brands.member_number_value', { number: link.member_number }) : t('brands.member_number_missing')}
              </Text>
            </View>
            {brandPrograms.length > 0
              ? brandPrograms.map(p => renderProgram(p, link.brand))
              : <Text style={styles.muted}>{t('brands.no_program', { name: link.brand.program_name?.trim() || globalProgramName })}</Text>}
          </View>
        )
      })}

      {unassigned.length > 0 ? (
        <View style={styles.brandBlock}>
          <Text style={styles.groupTitle}>{t('brands.unassigned_programs')}</Text>
          {unassigned.map(program => (
            <View key={program.id} style={{ gap: 6 }}>
              {renderProgram(program, null)}
              {links.length > 0 ? (
                <View style={styles.chips}>
                  <Text style={styles.muted}>{t('brands.attach_to')}</Text>
                  {links.map(link => (
                    <TouchableOpacity key={link.id} onPress={() => run(() => updateProgram(program.id, { brand_id: link.brand_id }))} disabled={busy} activeOpacity={0.8}>
                      <BrandPill brand={link.brand} size="sm" />
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {links.length === 0 && programs.length === 0 && !legacyPending ? (
        <Text style={styles.muted}>{t('brands.loyalty_empty')}</Text>
      ) : null}
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, gap: 12, ...SOFT_CARD_SHADOW },
    title: { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
    brandBlock: { gap: 8, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    brandHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    memberText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
    groupTitle: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
    programRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
    programTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    muted: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    link: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    chips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    legacyBox: { gap: 8, backgroundColor: colors.warningLight, borderRadius: 12, padding: 12 },
    legacyText: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    errorText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.danger },
  })
}
