import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import type { ExternalShareChannel } from '@/shared/components/ui/MessageModal'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { MessageTemplate } from '@/features/messages/templates'
import { callContact } from '@/features/clients/nextActionService'
import type { Client, Followup } from '@/shared/lib/types'
import { FollowupCompletionModal } from './FollowupCompletionModal'
import { FollowupReplyModal } from './FollowupReplyModal'
import { markFollowupSent } from './followupService'

type FlowClient = Pick<Client, 'first_name' | 'full_name' | 'next_lrp_date' | 'phone' | 'email'> & Partial<Pick<Client, 'timezone'>>

const MESSAGE_CHANNELS: ExternalShareChannel[] = ['whatsapp', 'sms', 'email']
const ACTION_ICONS = { whatsapp: '💬', sms: '📱', email: '✉️', call: '📞' }

// Les étapes d'accompagnement gardent leur parcours, et une relance "RDV" se traite dans l'agenda.
export function followupActionKind(followup: Followup): 'reply' | 'message' | 'call' | null {
  if (followup.done || followup.cancelled_at || followup.care_journey_id) return null
  if (followup.awaiting_reply_since) return 'reply'
  if (followup.action_type === 'rdv') return null
  return followup.action_type === 'call' ? 'call' : 'message'
}

export function followupActionLabel(followup: Followup, t: TFunction): string {
  const kind = followupActionKind(followup)
  if (kind === 'reply') return `✓ ${t('followups.note_reply')}`
  if (kind === 'call') return `${ACTION_ICONS.call} ${t('followups.call_now')}`
  const type = followup.action_type
  if (type === 'whatsapp' || type === 'sms' || type === 'email') return `${ACTION_ICONS[type]} ${t(`followups.send_${type}`)}`
  return `${ACTION_ICONS.whatsapp} ${t('followups.send_message')}`
}

function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function awaitingReplyLabel(followup: Followup, name: string, t: TFunction): string | null {
  if (!followup.awaiting_reply_since) return null
  const days = Math.floor((Date.now() - new Date(followup.awaiting_reply_since).getTime()) / 86400000)
  if (followup.due_date <= localToday()) return t('followups.no_reply_days', { name, days })
  if (days === 0) return t('followups.awaiting_reply_today', { name })
  return t('followups.awaiting_reply_days', { name, days })
}

export function FollowupActionRow({ followup, name, onPress }: {
  followup: Followup
  name: string
  onPress: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  if (!followupActionKind(followup)) return null
  const awaiting = awaitingReplyLabel(followup, name, t)
  return (
    <View style={styles.row}>
      {awaiting ? <Text style={styles.awaitingText}>{awaiting}</Text> : <View style={styles.spacer} />}
      <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.85} accessibilityRole="button">
        <Text style={styles.actionBtnText}>{followupActionLabel(followup, t)}</Text>
      </TouchableOpacity>
    </View>
  )
}

export function FollowupActionFlow({ followup, client, userId, advisorName, onClose, onSaved }: {
  followup: Followup
  client: FlowClient | null
  userId: string
  advisorName: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const kind = followupActionKind(followup)
  const plannedChannel = MESSAGE_CHANNELS.find(c => c === followup.action_type)
  const preferredChannel = plannedChannel ?? (client?.phone ? 'whatsapp' : 'email')
  const channelRef = useRef<ExternalShareChannel>(preferredChannel)
  const messageRef = useRef<string | null>(null)
  const confirmingRef = useRef(false)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const template = useMemo<MessageTemplate>(() => {
    const subject = followup.title ?? followup.content ?? ''
    return {
      id: `followup-${followup.id}`,
      category: 'suivi',
      channel: 'all',
      name: followup.title ?? t('followups.send_message'),
      body: followup.message_body ?? t('followups.draft_message', { subject }),
    }
  }, [followup, t])

  const phone = kind === 'call' ? client?.phone : null
  useEffect(() => {
    if (phone) callContact(phone).catch(e => console.error('[followupCall]', e))
  }, [phone])

  async function confirmSent() {
    setSaving(true)
    setFailed(false)
    try {
      await markFollowupSent(followup, userId, channelRef.current, messageRef.current)
      onSaved()
    } catch (e) {
      console.error('[markFollowupSent]', e)
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  if (kind === 'reply') {
    return <FollowupReplyModal followup={followup} name={client?.first_name ?? client?.full_name ?? ''} userId={userId} onClose={onClose} onSaved={onSaved} />
  }
  if (kind === 'call') {
    return <FollowupCompletionModal followup={followup} userId={userId} initialChoice="record" onClose={onClose} onSaved={onSaved} />
  }
  if (failed || saving) {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetText}>{failed ? t('common.error') : t('followups.saving_sent')}</Text>
            {failed ? (
              <View style={styles.sheetButtons}>
                <Button label={t('common.cancel')} variant="secondary" onPress={onClose} />
                <Button label={t('followups.retry')} onPress={confirmSent} />
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    )
  }

  return (
    <MessageModal
      visible
      onClose={() => { if (!confirmingRef.current) onClose() }}
      client={client}
      advisorName={advisorName}
      initialTemplate={template}
      title={followup.title ?? undefined}
      editable
      enableEmail
      preferredChannel={preferredChannel}
      onExternalShareInitiated={payload => {
        channelRef.current = payload.channel
        messageRef.current = payload.message
      }}
      doneAction={{
        label: t('followups.message_sent'),
        onPress: () => { confirmingRef.current = true; confirmSent() },
      }}
    />
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 },
    spacer: { flex: 1 },
    awaitingText: { flex: 1, minWidth: 160, fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    actionBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
    actionBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onPrimary },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    sheet: { width: '100%', maxWidth: 380, backgroundColor: colors.card, borderRadius: 18, padding: 20, gap: 14 },
    sheetText: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    sheetButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  })
}
