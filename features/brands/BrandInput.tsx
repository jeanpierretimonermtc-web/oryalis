import { useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Brand } from '@/shared/lib/types'
import { suggestBrands, matchBrand } from './brandMatching'
import type { BrandCandidate } from './brandMatching'
import { createBrand, fetchBrands, BrandExistsError } from './brandService'
import { normalizeBrandName } from './brandMatching'

interface Props {
  userId: string
  brands: Brand[]
  // Marque retenue : existante, ou créée à l'instant (référence ou saisie libre vérifiée).
  onSelect: (brand: Brand) => void | Promise<void>
  placeholder?: string
  // Marques à ne pas proposer (ex. déjà liées au contact).
  excludeIds?: string[]
}

// BRANDS-1 — saisie libre sans faute : suggestions pendant la frappe, et avant toute création,
// "Vouliez-vous dire … ?" si une marque identique ou très proche existe déjà.
export function BrandInput({ userId, brands, onSelect, placeholder, excludeIds = [] }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [text, setText] = useState('')
  const [proposal, setProposal] = useState<BrandCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const available = useMemo(() => brands.filter(b => !excludeIds.includes(b.id)), [brands, excludeIds])
  const suggestions = useMemo(() => (proposal ? [] : suggestBrands(text, available)), [text, available, proposal])

  async function resolve(candidate: BrandCandidate | { kind: 'new'; name: string }) {
    setBusy(true)
    setErrorMsg('')
    try {
      let brand: Brand
      if (candidate.kind === 'mine') {
        brand = candidate.brand
      } else {
        try {
          brand = await createBrand(userId, candidate.name)
        } catch (e) {
          if (!(e instanceof BrandExistsError)) throw e
          // Déjà en base sous ce nom normalisé (liste locale pas à jour) : on la réutilise.
          const fresh = await fetchBrands()
          const found = fresh.find(b => b.normalized_name === normalizeBrandName(candidate.name))
          if (!found) throw e
          brand = found
        }
      }
      await onSelect(brand)
      setText('')
      setProposal(null)
    } catch (e) {
      console.error('[brands.input]', e)
      setErrorMsg(t('brands.error'))
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    const name = text.trim()
    if (!name) return
    const match = matchBrand(name, brands)
    if (match.kind === 'exact') { resolve(match.candidate); return }
    if (match.kind === 'near') { setProposal(match.candidate); return }
    resolve({ kind: 'new', name })
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={v => { setText(v); setProposal(null); setErrorMsg('') }}
          onSubmitEditing={submit}
          placeholder={placeholder ?? t('brands.add_placeholder')}
          placeholderTextColor={colors.textTertiary}
          maxLength={80}
          accessibilityLabel={t('brands.add_label')}
        />
        <TouchableOpacity style={[styles.addBtn, (!text.trim() || busy) && { opacity: 0.5 }]} onPress={submit} disabled={!text.trim() || busy} activeOpacity={0.85}>
          {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.addBtnText}>{t('brands.add_cta')}</Text>}
        </TouchableOpacity>
      </View>

      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map(s => (
            <TouchableOpacity key={`${s.kind}-${s.name}`} style={[styles.chip, s.kind === 'mine' && styles.chipMine]} onPress={() => resolve(s)} disabled={busy} activeOpacity={0.8}>
              <Text style={[styles.chipText, s.kind === 'mine' && styles.chipTextMine]}>
                {s.name} · {s.kind === 'mine' ? t('brands.suggestion_mine') : t('brands.suggestion_reference')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {proposal ? (
        <View style={styles.proposal}>
          <Text style={styles.proposalText}>💡 {t('brands.did_you_mean', { name: proposal.name })}</Text>
          <View style={styles.proposalBtns}>
            <TouchableOpacity style={styles.yesBtn} onPress={() => resolve(proposal)} disabled={busy} activeOpacity={0.85}>
              <Text style={styles.yesBtnText}>{t('brands.did_you_mean_yes', { name: proposal.name })}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.noBtn} onPress={() => resolve({ kind: 'new', name: text.trim() })} disabled={busy} activeOpacity={0.8}>
              <Text style={styles.noBtnText}>{t('brands.did_you_mean_no')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    inputRow: { flexDirection: 'row', gap: 8 },
    input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.card },
    addBtn: { paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.primaryAction, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
    addBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary },
    suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipMine: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    chipText: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.textSecondary },
    chipTextMine: { color: colors.primary, fontFamily: fonts.semibold },
    proposal: { backgroundColor: colors.warningLight, borderRadius: 12, padding: 12, gap: 8 },
    proposalText: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.text },
    proposalBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    yesBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.primaryAction },
    yesBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary },
    noBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    noBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    errorText: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.danger },
  })
}
