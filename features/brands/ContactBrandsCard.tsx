import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { formatDate } from '@/shared/lib/dateFormat'
import { BrandAvatar } from './BrandPill'
import { BrandInput } from './BrandInput'
import { useBrands } from './useBrands'
import {
  addClientBrand, removeClientBrand, updateClientBrandMemberNumber,
  updateClientBrandNetwork, fetchBrandMembers, brandDownlineIds, BrandSponsorError,
} from './brandService'
import type { ClientBrandWithBrand, BrandMember } from './brandService'
import { ContactPickerModal } from '@/features/network/ContactPickerModal'
import type { BrandNetworkRole } from '@/shared/lib/types'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { BRAND_STATUSES, brandRoleLabel, isBrandPartnerRole } from './brandRoleLabels'

const BRAND_ROLE_ICON: Record<BrandNetworkRole, string> = { prospect: '🌱', customer: '👤', partner: '🤝', leader: '⭐' }

const SOURCE_ICON: Record<string, string> = { manual: '✋', order: '🛒', recommendation: '🌿', appointment: '📅' }

interface Props {
  clientId: string
  userId: string
  links: ClientBrandWithBrand[]
  onChanged: () => void
}

// BRANDS-1 — "Ses marques" (Profil) : origine de chaque lien, numéro de membre par marque,
// ajout manuel (saisie assistée) et retrait.
export function ContactBrandsCard({ clientId, userId, links, onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { brands, refresh: refreshBrands } = useBrands()
  const { getRoleLabel } = useAppConfig()
  const [adding, setAdding] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState('')
  // BRAND-NETWORK-1 — membres de chaque marque du contact (nom du parrain + choix du parrain).
  const [members, setMembers] = useState<Record<string, BrandMember[]>>({})
  const [sponsorFor, setSponsorFor] = useState<ClientBrandWithBrand | null>(null)
  const [sponsorError, setSponsorError] = useState<string | null>(null)
  const brandIdsKey = links.map(l => l.brand_id).sort().join(',')

  const loadMembers = useCallback(async () => {
    const ids = brandIdsKey ? brandIdsKey.split(',') : []
    try {
      const lists = await Promise.all(ids.map(fetchBrandMembers))
      setMembers(Object.fromEntries(ids.map((id, i) => [id, lists[i]])))
    } catch (e) {
      console.error('[clientBrands.members]', e)
    }
  }, [brandIdsKey])

  useEffect(() => { loadMembers() }, [loadMembers, links])

  async function setNetworkRole(link: ClientBrandWithBrand, role: BrandNetworkRole) {
    if (link.network_role === role) return
    setErrorMsg('')
    try {
      await updateClientBrandNetwork(link.id, { network_role: role })
      onChanged()
    } catch (e) {
      console.error('[clientBrands.role]', e)
      setErrorMsg(t('brands.error'))
    }
  }

  async function pickSponsor(sponsorId: string | null) {
    if (!sponsorFor) return
    setSponsorError(null)
    try {
      await updateClientBrandNetwork(sponsorFor.id, { sponsor_client_id: sponsorId })
      setSponsorFor(null)
      onChanged()
    } catch (e) {
      console.error('[clientBrands.sponsor]', e)
      setSponsorError(t(e instanceof BrandSponsorError ? 'network.cycle_error' : 'network.attach_error'))
    }
  }

  const sponsorOptions = useMemo(() => {
    if (!sponsorFor) return []
    const list = members[sponsorFor.brand_id] ?? []
    const excluded = brandDownlineIds(clientId, list)
    const sponsors = new Set(list.map(m => m.sponsor_client_id).filter(Boolean))
    return list
      .filter(m => !excluded.has(m.client_id) && (isBrandPartnerRole(m.network_role) || sponsors.has(m.client_id)))
      .map(m => ({ id: m.client_id, label: m.full_name }))
  }, [sponsorFor, members, clientId])

  const sponsorName = (link: ClientBrandWithBrand) =>
    link.sponsor_client_id ? members[link.brand_id]?.find(m => m.client_id === link.sponsor_client_id)?.full_name ?? '…' : null

  async function handleAdd(brandId: string) {
    await addClientBrand(userId, clientId, brandId)
    setAdding(false)
    refreshBrands()
    onChanged()
  }

  async function handleRemove(id: string) {
    setErrorMsg('')
    try {
      await removeClientBrand(id)
      onChanged()
    } catch (e) {
      console.error('[clientBrands.remove]', e)
      setErrorMsg(t('brands.error'))
    }
  }

  async function saveMemberNumber(link: ClientBrandWithBrand) {
    const value = drafts[link.id]
    if (value === undefined || value === (link.member_number ?? '')) return
    setErrorMsg('')
    try {
      await updateClientBrandMemberNumber(link.id, value)
      onChanged()
    } catch (e) {
      console.error('[clientBrands.memberNumber]', e)
      setErrorMsg(t('brands.error'))
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>🏷️ {t('brands.contact_title')}</Text>
        {!adding ? (
          <TouchableOpacity onPress={() => setAdding(true)} activeOpacity={0.7}>
            <Text style={styles.link}>+ {t('brands.add_cta_long')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {links.length === 0 && !adding ? <Text style={styles.muted}>{t('brands.contact_empty')}</Text> : null}

      {links.map(link => (
        <View key={link.id} style={styles.row}>
          <BrandAvatar brand={link.brand} />
          <View style={styles.rowMain}>
            <Text style={styles.brandName}>{link.brand.name}</Text>
            <Text style={styles.muted}>
              {SOURCE_ICON[link.source] ?? '•'} {t(`brands.source_${link.source}`)}
              {link.source_at ? ` · ${formatDate(link.source_at, locale)}` : ''}
            </Text>
          </View>
          <View style={styles.memberField}>
            <Text style={styles.memberLabel}>{t('brands.member_number_label', { brand: link.brand.name })}</Text>
            <TextInput
              style={styles.memberInput}
              value={drafts[link.id] ?? link.member_number ?? ''}
              onChangeText={v => setDrafts(prev => ({ ...prev, [link.id]: v }))}
              onBlur={() => saveMemberNumber(link)}
              placeholder={t('brands.member_number_placeholder', { brand: link.brand.name })}
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel={t('brands.member_number_label', { brand: link.brand.name })}
            />
          </View>
          <TouchableOpacity onPress={() => handleRemove(link.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
            <Text style={styles.removeText}>{t('brands.remove')}</Text>
          </TouchableOpacity>
          {/* BRAND-NETWORK-1 — place dans le réseau de cette marque. */}
          {/* Deux lignes alignées (rôle, puis parrain) : un nom long ne fait jamais sauter la mise en page. */}
          <View style={styles.networkBlock}>
          <View style={styles.networkRow}>
            <Text style={styles.networkLabel}>{t('brands.network_role')}</Text>
            <View style={styles.roleChips}>
              {BRAND_STATUSES.map(role => {
                const active = link.network_role === role
                return (
                  <TouchableOpacity
                    key={role}
                    style={[styles.roleChip, active && styles.roleChipActive]}
                    onPress={() => setNetworkRole(link, role)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                      {`${BRAND_ROLE_ICON[role]} ${brandRoleLabel(link.brand, role, getRoleLabel)}`}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
          <View style={styles.networkRow}>
            <Text style={styles.networkLabel}>{t('network.sponsor_label')}</Text>
            <TouchableOpacity
              style={styles.sponsorBtn}
              onPress={() => { setSponsorError(null); setSponsorFor(link) }}
              activeOpacity={0.75}
            >
              <Text style={styles.sponsorIcon}>{link.sponsor_client_id ? '🤝' : '🙋'}</Text>
              <Text style={styles.sponsorText} numberOfLines={1}>{sponsorName(link) ?? t('network.sponsor_me')}</Text>
              <Text style={styles.sponsorChevron}>›</Text>
            </TouchableOpacity>
          </View>
          </View>
        </View>
      ))}

      <ContactPickerModal
        visible={!!sponsorFor}
        title={sponsorFor ? t('brands.sponsor_pick_title', { brand: sponsorFor.brand.name }) : ''}
        options={sponsorOptions}
        selectedId={sponsorFor?.sponsor_client_id ?? null}
        meLabel={t('network.sponsor_me')}
        errorMsg={sponsorError}
        onPick={pickSponsor}
        onClose={() => setSponsorFor(null)}
      />

      {adding ? (
        <View style={styles.addBox}>
          <BrandInput
            userId={userId}
            brands={brands}
            excludeIds={links.map(l => l.brand_id)}
            onSelect={brand => handleAdd(brand.id)}
          />
          <TouchableOpacity onPress={() => setAdding(false)} activeOpacity={0.7}>
            <Text style={styles.muted}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {links.some(l => l.source !== 'manual') ? <Text style={styles.hint}>{t('brands.auto_hint')}</Text> : null}
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, gap: 12, ...SOFT_CARD_SHADOW },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    title: { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
    link: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowMain: { flex: 1, minWidth: 140, gap: 2 },
    brandName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    muted: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    memberField: { width: 170, gap: 3 },
    memberLabel: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary },
    memberInput: { width: 170, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 7, fontFamily: fonts.body, fontSize: 13, color: colors.text, backgroundColor: colors.card },
    networkBlock: { width: '100%', gap: 8, paddingLeft: 46 },
    networkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    networkLabel: { width: 96, flexShrink: 0, fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary },
    roleChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    sponsorIcon: { fontSize: 12 },
    roleChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    roleChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    roleChipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    roleChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    sponsorBtn: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 320, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    sponsorText: { flexShrink: 1, fontSize: 12.5, fontFamily: fonts.medium, color: colors.text },
    sponsorChevron: { fontSize: 14, color: colors.textTertiary },
    removeText: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.danger },
    addBox: { gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
    hint: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    errorText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.danger },
  })
}
