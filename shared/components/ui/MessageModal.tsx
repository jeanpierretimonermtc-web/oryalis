import { useEffect, useState, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Modal, View, Text, TouchableOpacity, ScrollView,
  StyleSheet, Linking, Platform, TextInput,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import {
  BUILT_IN_TEMPLATES, CATEGORY_LABELS, CATEGORY_ICONS,
  renderTemplate,
} from '@/features/messages/templates'
import type { TemplateCategory, MessageTemplate } from '@/features/messages/templates'
import type { Client } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'
import { useEntitlements } from '@/features/subscriptions/useEntitlements'
import { useAuth } from '@/features/auth/AuthProvider'
import { createCustomTemplate, getCustomTemplates } from '@/features/messages/customTemplateService'

const CATEGORIES: TemplateCategory[] = ['prospection', 'lrp', 'recrutement', 'suivi']

// RÉCAP-4 — `email` additif, optionnel comme le reste de MessageClient : les consommateurs qui
// chargent déjà `client.email` (fiche contact) l'exposent automatiquement, ceux qui n'ont pas
// encore cette colonne (voir ClientInfo de la fiche RDV avant ce lot) continuent de fonctionner
// avec `email` simplement absent (bouton E-mail non affiché, aucune régression).
type MessageClient = Pick<Client, 'first_name' | 'full_name' | 'next_lrp_date' | 'phone' | 'email'>

interface Props {
  visible:     boolean
  onClose:     () => void
  client:      MessageClient | null
  advisorName: string
  lastProduct?: string
  // Quand fourni, la modale saute directement à l'étape "message prêt" avec ce
  // modèle (ex: récap de RDV) au lieu d'afficher la liste des modèles génériques.
  initialTemplate?: MessageTemplate | null
  // RÉCAP-2 — API additive, défaut = comportement historique inchangé pour tous les
  // appelants existants (message générique, résumé de profil, réseau) :
  //  - `title` : libellé de l'écran "message prêt" (sinon `messages.title_ready` par défaut).
  //  - `editable` : bascule le texte affiché d'un <Text> figé vers une zone modifiable qui
  //    devient la source de vérité pour Copier/WhatsApp/SMS. false par défaut.
  title?: string
  editable?: boolean
  // RÉCAP-3 — nœud neutre optionnel, affiché uniquement à l'étape "message prêt", juste
  // au-dessus du texte. MessageModal l'affiche tel quel sans connaître son contenu ni sa
  // logique (§16/17) : les règles métier (produits discutés, considered, prix snapshot RDV,
  // legacy products_discussed) restent entièrement dans l'appelant (fiche RDV +
  // features/appointments/recapProducts.ts). undefined par défaut pour tous les autres usages.
  beforeMessageContent?: ReactNode
  // RÉCAP-4 §6 — objet du mail préparé par l'appelant (dates/locale RDV inconnues de ce
  // composant générique). Sans valeur, retombe sur le nom du message sélectionné (`selected.name`,
  // déjà affiché tel quel dans l'écran) — jamais un texte français en dur ici.
  emailSubject?: string
  // RÉCAP-4.1 — canal E-mail strictement opt-in (défaut false, comme `editable`). RÉCAP-4 avait
  // affiché le bouton dès que `client.email` existait, ce qui l'a fait apparaître par effet de
  // bord sur les 3 autres usages de MessageModal (message générique, résumé profil, réseau) —
  // hors périmètre de ce lot-là. Seul l'appelant qui passe `enableEmail` obtient le canal.
  enableEmail?: boolean
  // RÉCAP-5C — callback neutre, optionnel : MessageModal signale qu'un partage externe a été
  // initié (WhatsApp/SMS/E-mail cliqué), avec le payload exact au moment du clic. Il ne
  // signifie jamais "envoyé"/"livré"/"reçu" — juste "l'utilisateur a initié ce partage" (voir
  // supabase/migrations/20260824_appointment_recap_shares.sql). MessageModal n'importe ni
  // recapShareService, ni AppointmentRecapShare/RecapShareChannel, ni Supabase, ni appointment :
  // la persistance appartient entièrement à l'appelant (fiche RDV). Jamais appelé pour Copier
  // (Copier ne prouve même pas qu'une appli de communication a été ouverte, voir RÉCAP-5A §9).
  onExternalShareInitiated?: (payload: ExternalShareInitiatedPayload) => void
}

export type ExternalShareChannel = 'whatsapp' | 'sms' | 'email'
export interface ExternalShareInitiatedPayload {
  channel: ExternalShareChannel
  // Texte exact déjà visible au moment du clic (= `rendered`), jamais reconstruit.
  message: string
  // Sujet réellement utilisé dans le mailto: (email uniquement) — undefined pour whatsapp/sms.
  subject?: string
}

export function MessageModal({ visible, onClose, client, advisorName, lastProduct, initialTemplate, title, editable = false, beforeMessageContent, emailSubject, enableEmail = false, onExternalShareInitiated }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { isAdvisor } = useEntitlements()
  const { session } = useAuth()
  const [customTemplates, setCustomTemplates] = useState<MessageTemplate[]>([])
  const [creating, setCreating] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customBody, setCustomBody] = useState('')

  useEffect(() => { if (visible && isAdvisor) getCustomTemplates().then(setCustomTemplates).catch(() => {}) }, [visible, isAdvisor])

  const [activeCategory, setActiveCategory] = useState<TemplateCategory>('prospection')
  const [selected, setSelected] = useState<MessageTemplate | null>(null)
  const [copied, setCopied] = useState(false)
  // RÉCAP-2 — message réellement modifié par l'utilisateur (source de vérité pour Copier/
  // WhatsApp/SMS quand `editable`). Distinct du texte généré par le template : ce dernier
  // reste recalculable à tout moment depuis `selected`+`vars`, jamais modifié en place.
  const [editedMessage, setEditedMessage] = useState('')
  // RÉCAP-3 (§14/15) — devient vrai dès la première frappe manuelle dans `editedMessage`.
  // Remplace l'ancien garde-fou "consommé une seule fois par ouverture" (RÉCAP-2) par un
  // garde-fou plus précis : tant que l'utilisateur n'a rien tapé, `initialTemplate` peut
  // continuer à régénérer le message (ex. case à cocher produit/toggle prix côté appelant) ;
  // dès la première frappe, plus aucune régénération silencieuse (§14 — point critique).
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  // Corps du template effectivement utilisé pour la dernière génération de `editedMessage` —
  // sert uniquement à détecter qu'un `initialTemplate` plus récent diffère (produits changés
  // pendant que le texte est déjà modifié) pour proposer une mise à jour explicite (§15),
  // jamais à décider quoi que ce soit côté domaine (MessageModal ne lit que la chaîne `body`).
  const appliedTemplateBodyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!visible) { dirtyRef.current = false; setDirty(false); appliedTemplateBodyRef.current = null; return }
    if (dirtyRef.current) return
    if (initialTemplate) setSelected(initialTemplate)
  }, [visible, initialTemplate])

  const canUpdateFromLatestTemplate = editable && dirty && !!initialTemplate && initialTemplate.body !== appliedTemplateBodyRef.current
  function applyLatestTemplate() {
    if (!initialTemplate) return
    setSelected(initialTemplate)
    dirtyRef.current = false
    setDirty(false)
  }

  const prénom = client?.first_name || client?.full_name?.split(' ')[0] || ''
  const date_lrp = client?.next_lrp_date
    ? formatDate(client.next_lrp_date, 'fr-FR')
    : ''
  const mon_prénom = advisorName.split(' ')[0] || advisorName

  const vars = { prénom, nom_complet: client?.full_name ?? '', date_lrp, produit: lastProduct ?? '', mon_prénom }

  // RÉCAP-2 — initialise (ou réinitialise) editedMessage uniquement quand `selected` change
  // de référence, jamais sur un changement de `vars` (client/advisorName/lastProduct) : couvre
  // à la fois l'arrivée du template initial (recap) et un choix explicite d'un autre modèle
  // (§6 — remplacement volontaire uniquement), jamais un rerender sans rapport.
  useEffect(() => {
    if (selected) {
      setEditedMessage(renderTemplate(selected.body, vars))
      appliedTemplateBodyRef.current = selected.body
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const allowedTemplates = isAdvisor ? [...BUILT_IN_TEMPLATES, ...customTemplates] : BUILT_IN_TEMPLATES.slice(0, 3)
  const templates = allowedTemplates.filter(t => t.category === activeCategory)
  // RÉCAP-2 — en mode éditable, la source de vérité affichée/copiée/envoyée est le message
  // modifié par l'utilisateur, jamais recalculé depuis le template au moment de l'action
  // (§7/§8/§9 du brief). En mode lecture seule (tous les autres appelants existants), le
  // comportement reste strictement identique à avant ce lot.
  const rendered = editable ? editedMessage : (selected ? renderTemplate(selected.body, vars) : '')

  async function handleCopy() {
    await Clipboard.setStringAsync(rendered)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleWhatsApp() {
    // RÉCAP-5C — capturé avant toute ouverture externe, jamais attendu (payload synchrone,
    // le fire-and-forget réel vit chez l'appelant) : ne doit jamais retarder ni bloquer
    // window.open/Linking.openURL ci-dessous (§10 — critique sur web, popup blockers).
    onExternalShareInitiated?.({ channel: 'whatsapp', message: rendered })
    const raw = client?.phone?.trim() ?? ''
    let phone = ''
    if (raw) {
      if (raw.startsWith('+')) {
        phone = raw.replace(/\D/g, '')
      } else {
        const digits = raw.replace(/\D/g, '')
        phone = digits.startsWith('0') && digits.length === 10
          ? '33' + digits.slice(1)
          : digits
      }
    }
    const text = encodeURIComponent(rendered)

    if (Platform.OS === 'web') {
      // api.whatsapp.com/send évite l'écran noir que wa.me provoque sur mobile web
      const url = phone
        ? `https://api.whatsapp.com/send?phone=${phone}&text=${text}&type=phone_number&app_absent=0`
        : `https://api.whatsapp.com/send?text=${text}`
      if (typeof window !== 'undefined') {
        // Nouvel onglet sur desktop (ne quitte pas Oryalis, laisse WhatsApp tenter
        // d'ouvrir l'appli desktop) ; même onglet sur mobile web pour le deep link app.
        if (window.innerWidth >= 768) window.open(url, '_blank', 'noopener,noreferrer')
        else window.location.href = url
      }
    } else {
      const url = phone
        ? `whatsapp://send?phone=${phone}&text=${text}`
        : `whatsapp://send?text=${text}`
      Linking.openURL(url).catch(() => {
        const fallback = phone
          ? `https://api.whatsapp.com/send?phone=${phone}&text=${text}&type=phone_number&app_absent=0`
          : `https://api.whatsapp.com/send?text=${text}`
        Linking.openURL(fallback)
      })
    }
  }

  function handleSMS() {
    // RÉCAP-5C — voir handleWhatsApp ci-dessus, même principe (synchrone, non bloquant).
    onExternalShareInitiated?.({ channel: 'sms', message: rendered })
    const phone = client?.phone?.replace(/\D/g, '') ?? ''
    const sep   = Platform.OS === 'ios' ? '&' : '?'
    const url   = phone
      ? `sms:${phone}${sep}body=${encodeURIComponent(rendered)}`
      : `sms:${sep}body=${encodeURIComponent(rendered)}`
    Linking.openURL(url)
  }

  // RÉCAP-4 §7/§8 — corps = `rendered` tel quel (déjà égal à `editedMessage` en mode `editable`,
  // jamais recalculé via renderTemplate() ici, comme WhatsApp/SMS ci-dessus). Sujet et corps
  // passent par encodeURIComponent (accents, apostrophes, &, ?, retours à ligne, URL internes au
  // message) ; seule l'adresse du destinataire n'est pas encodée (convention mailto: standard).
  // Aucune promesse d'envoi (§12) : Oryalis ouvre le client mail, rien de plus.
  function handleEmail() {
    if (!enableEmail) return
    const email = client?.email?.trim()
    if (!email) return
    const subject = emailSubject ?? selected?.name ?? ''
    // RÉCAP-5C — après les gardes ci-dessus (bouton réellement disponible, §9), avec le sujet
    // EXACT effectivement utilisé dans le mailto: ci-dessous (jamais recalculé séparément).
    onExternalShareInitiated?.({ channel: 'email', message: rendered, subject })
    const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(rendered)}`
    Linking.openURL(url)
  }

  // RÉCAP-2 / Test H — fermer puis rouvrir repart du message généré initial (jamais une édition
  // en attente conservée entre deux ouvertures) : comportement le plus simple et le plus
  // prévisible, cohérent avec `selected` déjà remis à null ici avant ce lot.
  function handleClose() {
    setSelected(null)
    setEditedMessage('')
    setCopied(false)
    dirtyRef.current = false
    setDirty(false)
    appliedTemplateBodyRef.current = null
    onClose()
  }

  async function startCreating() { setCreating(true); setCustomName(''); setCustomBody(''); if (!customTemplates.length) setCustomTemplates(await getCustomTemplates().catch(() => [])) }
  async function saveCustom() {
    if (!session || !customName.trim() || !customBody.trim()) return
    const created = await createCustomTemplate(session.user.id, { category: activeCategory, channel: 'all', name: customName.trim(), body: customBody.trim() })
    setCustomTemplates(prev => [...prev, created]); setCreating(false)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>

          {/* Handle + header */}
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>
              {selected ? (title ?? t('messages.title_ready')) : t('messages.title_for', { name: prénom || '…' })}
            </Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={8}>
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {!selected ? (
            <>
              {/* Category tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsRow}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catTab, activeCategory === cat && styles.catTabActive]}
                    onPress={() => setActiveCategory(cat)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.catIcon}>{CATEGORY_ICONS[cat]}</Text>
                    <Text style={[styles.catLabel, activeCategory === cat && styles.catLabelActive]}>
                      {CATEGORY_LABELS[cat]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Template list */}
              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                {isAdvisor && !creating ? <TouchableOpacity style={styles.newTemplateBtn} onPress={startCreating}><Text style={styles.newTemplateText}>{t('messages.new_template')}</Text></TouchableOpacity> : null}
                {creating ? <View style={styles.customForm}><TextInput style={styles.customInput} value={customName} onChangeText={setCustomName} placeholder={t('messages.template_name')} placeholderTextColor={colors.textTertiary} /><TextInput style={[styles.customInput, { minHeight: 110 }]} value={customBody} onChangeText={setCustomBody} placeholder={t('messages.template_body')} placeholderTextColor={colors.textTertiary} multiline /><TouchableOpacity style={styles.actionBtn} onPress={saveCustom}><Text style={styles.actionBtnText}>{t('common.save')}</Text></TouchableOpacity></View> : null}
                {templates.map(tpl => (
                  <TouchableOpacity
                    key={tpl.id}
                    style={styles.tplCard}
                    onPress={() => setSelected(tpl)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.tplTop}>
                      <Text style={styles.tplName}>{tpl.name}</Text>
                      <View style={[styles.channelBadge, { backgroundColor: tpl.channel === 'whatsapp' ? colors.successLight : tpl.channel === 'sms' ? colors.primaryLight : colors.bgDim }]}>
                        <Text style={[styles.channelText, { color: tpl.channel === 'whatsapp' ? colors.success : tpl.channel === 'sms' ? colors.primary : colors.textSecondary }]}>
                          {tpl.channel === 'whatsapp' ? 'WhatsApp' : tpl.channel === 'sms' ? 'SMS' : t('messages.all_channels', { defaultValue: 'Tous' })}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.tplPreview} numberOfLines={2}>
                      {renderTemplate(tpl.body, vars)}
                    </Text>
                  </TouchableOpacity>
                ))}
                <View style={{ height: 24 }} />
              </ScrollView>
            </>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {/* RÉCAP-3 — slot neutre fourni par l'appelant (ex. sélecteur "Produits abordés"
                  de la fiche RDV), rendu avant le message, jamais interprété par MessageModal. */}
              {beforeMessageContent}
              {/* Rendered message */}
              <View style={styles.renderedCard}>
                <Text style={styles.renderedName}>{selected.name}</Text>
                {/* RÉCAP-2 — zone réellement éditable uniquement quand `editable` est activé par
                    l'appelant (récap RDV) ; tous les autres usages de MessageModal conservent le
                    <Text> figé d'origine, aucun changement de comportement pour eux (§15). */}
                {editable ? (
                  <TextInput
                    style={[styles.renderedBody, styles.renderedBodyEditable]}
                    value={editedMessage}
                    onChangeText={(v) => { setEditedMessage(v); dirtyRef.current = true; setDirty(true) }}
                    multiline
                    textAlignVertical="top"
                  />
                ) : (
                  <Text style={styles.renderedBody}>{rendered}</Text>
                )}
              </View>

              {/* RÉCAP-3 §15 — dès que le texte a été modifié manuellement, plus aucune
                  régénération silencieuse : si les options du slot ci-dessus changent ensuite
                  (ex. produit coché/décoché), ce bouton explicite est le seul moyen de reprendre
                  le message généré, jamais automatique. */}
              {canUpdateFromLatestTemplate ? (
                <TouchableOpacity style={styles.updateMessageBtn} onPress={applyLatestTemplate} activeOpacity={0.75}>
                  <Text style={styles.updateMessageBtnText}>{t('messages.update_with_changes')}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Actions */}
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.success }]} onPress={handleCopy} activeOpacity={0.85}>
                <Text style={styles.actionBtnText}>{copied ? t('messages.copied') : t('messages.copy')}</Text>
              </TouchableOpacity>

              {/* RÉCAP-4 §10 / RÉCAP-4.1 §4 — WhatsApp/SMS et E-mail sont des canaux
                  indépendants, chacun affiché seulement si sa donnée de contact existe. Le canal
                  E-mail (bouton et message d'indisponibilité) n'existe que si l'appelant l'a
                  explicitement activé via `enableEmail` — sinon ce bloc entier est absent et le
                  comportement retombe exactement sur l'historique pré-RÉCAP-4. */}
              {client?.phone ? (
                <>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.success }]} onPress={handleWhatsApp} activeOpacity={0.85}>
                    <Text style={styles.actionBtnText}>{t('messages.open_whatsapp')}</Text>
                  </TouchableOpacity>
                  {Platform.OS !== 'web' && (
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={handleSMS} activeOpacity={0.85}>
                      <Text style={styles.actionBtnText}>{t('messages.open_sms')}</Text>
                    </TouchableOpacity>
                  )}
                </>
              ) : null}

              {enableEmail ? (
                client?.email ? (
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary }]} onPress={handleEmail} activeOpacity={0.85}>
                    <Text style={styles.actionBtnText}>{t('messages.open_email')}</Text>
                  </TouchableOpacity>
                ) : client?.phone ? (
                  <Text style={styles.channelUnavailableHint}>{t('messages.email_unavailable')}</Text>
                ) : null
              ) : null}

              {enableEmail ? (
                !client?.phone && !client?.email ? (
                  <View style={styles.noPhoneNote}>
                    <Text style={styles.noPhoneText}>{t('messages.no_contact_channel')}</Text>
                  </View>
                ) : null
              ) : (
                !client?.phone ? (
                  <View style={styles.noPhoneNote}>
                    <Text style={styles.noPhoneText}>{t('messages.no_phone')}</Text>
                  </View>
                ) : null
              )}

              {/* Back button */}
              <TouchableOpacity style={styles.backBtn} onPress={() => setSelected(null)} activeOpacity={0.7}>
                <Text style={styles.backBtnText}>{t('messages.change_template')}</Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 32,
  },
  handle:  { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  title:   { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
  closeBtn:  { padding: 4 },
  closeIcon: { fontSize: 16, color: colors.textTertiary },

  tabsScroll:  { flexGrow: 0 },
  tabsRow:     { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  catTab:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg },
  catTabActive:{ borderColor: colors.primary, backgroundColor: colors.primaryLight },
  catIcon:     { fontSize: 14 },
  catLabel:    { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  catLabelActive: { color: colors.primary, fontFamily: fonts.semibold },

  list: { paddingHorizontal: 16 },

  tplCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  tplTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tplName:     { fontSize: 14, fontFamily: fonts.semibold, color: colors.text, flex: 1 },
  channelBadge:{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  channelText: { fontSize: 10, fontFamily: fonts.bold },
  tplPreview:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  newTemplateBtn: { padding: 12, borderRadius: 10, backgroundColor: colors.primaryLight, alignItems: 'center', marginBottom: 10 },
  newTemplateText: { color: colors.primary, fontFamily: fonts.semibold },
  customForm: { gap: 10, marginBottom: 12 }, customInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.text, backgroundColor: colors.bg },

  renderedCard: {
    backgroundColor: colors.bg,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  renderedName: { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  renderedBody: { fontSize: 15, fontFamily: fonts.body, color: colors.text, lineHeight: 22 },
  // RÉCAP-2 — identifiable comme un vrai champ (bordure + fond distinct de la carte), assez
  // haut pour lire le message sans scroll excessif (§13), sans refonte du reste de la modale.
  renderedBodyEditable: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    backgroundColor: colors.bg, padding: 10, minHeight: 160,
  },

  actionBtn:     { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  actionBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

  updateMessageBtn: {
    borderRadius: 10, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primaryLight,
    paddingVertical: 10, alignItems: 'center', marginBottom: 12,
  },
  updateMessageBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },

  noPhoneNote: { backgroundColor: colors.bgDim, borderRadius: 10, padding: 12, marginBottom: 10 },
  noPhoneText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },
  // RÉCAP-4 §9/§10 — discret, pas un panneau : un canal manquant à côté d'actions disponibles.
  channelUnavailableHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', marginBottom: 10 },

  backBtn:     { alignItems: 'center', paddingVertical: 12 },
  backBtnText: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  })
}
