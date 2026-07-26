import { useMemo, useState, useCallback } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Stack, router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useNotes } from '@/features/notes/useNotes'
import { createNote, deleteNote } from '@/features/notes/noteService'
import { supabase } from '@/shared/lib/supabase'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'

type MergedEntry = {
  id: string
  date: string
  content: string
  source: 'note' | 'appointment'
  apptId?: string
  apptTitle?: string
}

export default function ClientNotesScreen() {
  const { t, i18n } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { notes, loading, refresh } = useNotes(id)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [apptEntries, setApptEntries] = useState<MergedEntry[]>([])
  const [apptLoading, setApptLoading] = useState(true)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const loadApptNotes = useCallback(async () => {
    if (!id) return
    setApptLoading(true)
    const { data: appts } = await supabase
      .from('appointments')
      .select('id, title, start_at')
      .eq('client_id', id)
    const apptIds = (appts ?? []).map(a => a.id)
    if (apptIds.length === 0) { setApptEntries([]); setApptLoading(false); return }

    const { data: noteRows } = await supabase
      .from('appointment_notes')
      .select('appointment_id, client_notes, internal_notes, objections, needs_identified, products_discussed')
      .in('appointment_id', apptIds)
    const byAppt = new Map((noteRows ?? []).map(n => [n.appointment_id, n]))

    const entries: MergedEntry[] = []
    for (const appt of appts ?? []) {
      const n = byAppt.get(appt.id)
      if (!n) continue
      const parts: string[] = []
      if (n.client_notes)       parts.push(n.client_notes)
      if (n.products_discussed) parts.push(`${t('appointments.field_products')} : ${n.products_discussed}`)
      if (n.needs_identified)   parts.push(`${t('appointments.field_needs')} : ${n.needs_identified}`)
      if (n.objections)         parts.push(`${t('appointments.field_objections')} : ${n.objections}`)
      if (n.internal_notes)     parts.push(`${t('appointments.field_internal_notes')} : ${n.internal_notes}`)
      if (parts.length === 0) continue
      entries.push({
        id: `appt-${appt.id}`,
        date: appt.start_at,
        content: parts.join('\n'),
        source: 'appointment',
        apptId: appt.id,
        apptTitle: appt.title,
      })
    }
    setApptEntries(entries)
    setApptLoading(false)
  }, [id, t])

  useFocusEffect(useCallback(() => { loadApptNotes() }, [loadApptNotes]))

  const mergedEntries: MergedEntry[] = useMemo(() => {
    const noteEntries: MergedEntry[] = notes.map(n => ({
      id: n.id, date: n.created_at, content: n.content, source: 'note',
    }))
    return [...noteEntries, ...apptEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [notes, apptEntries])

  async function handleAdd() {
    if (!text.trim() || !session) return
    setSaving(true)
    try {
      await createNote(session.user.id, id, text.trim())
      setText('')
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(noteId: string) {
    await deleteNote(noteId)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <Stack.Screen options={{ title: t('notes.title') }} />
      <View style={styles.container}>
        {(loading || apptLoading)
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              data={mergedEntries}
              keyExtractor={n => n.id}
              renderItem={({ item }) => (
                <NoteRow
                  entry={item}
                  locale={locale}
                  isConfirming={confirmId === item.id}
                  onPress={item.source === 'appointment' ? () => router.push(`/(app)/appointments/${item.apptId}` as any) : undefined}
                  onDeleteRequest={() => setConfirmId(item.id)}
                  onDeleteCancel={() => setConfirmId(null)}
                  onDeleteConfirm={() => handleDelete(item.id)}
                />
              )}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              contentContainerStyle={mergedEntries.length === 0 ? styles.empty : styles.list}
              ListEmptyComponent={<EmptyState message={t('notes.empty')} icon="📝" />}
            />
        }
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder={t('notes.add')}
            value={text}
            onChangeText={setText}
            multiline
            placeholderTextColor={colors.textTertiary}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleAdd}
            disabled={saving || !text.trim()}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  )
}

function NoteRow({ entry, locale, isConfirming, onPress, onDeleteRequest, onDeleteCancel, onDeleteConfirm }: {
  entry: MergedEntry
  locale: string
  isConfirming: boolean
  onPress?: () => void
  onDeleteRequest: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const date = locale.startsWith('fr')
    ? `${formatDate(entry.date, locale)} ${new Date(entry.date).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
    : new Date(entry.date).toLocaleDateString(locale, {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      })

  const body = (
    <View style={styles.noteMain}>
      <View style={styles.noteTagRow}>
        <View style={[styles.noteTag, entry.source === 'appointment' && styles.noteTagAppt]}>
          <Text style={[styles.noteTagText, entry.source === 'appointment' && styles.noteTagApptText]}>
            {entry.source === 'appointment' ? t('notes.source_appointment') : t('notes.source_free')}
          </Text>
        </View>
        {entry.apptTitle ? <Text style={styles.noteApptTitle} numberOfLines={1}>{entry.apptTitle}</Text> : null}
      </View>
      <Text style={styles.noteContent}>{entry.content}</Text>
      <Text style={styles.noteDate}>{date}</Text>
    </View>
  )

  return (
    <View style={styles.noteRow}>
      {onPress ? (
        <TouchableOpacity style={{ flex: 1 }} onPress={onPress} activeOpacity={0.75}>{body}</TouchableOpacity>
      ) : (
        <View style={{ flex: 1 }}>{body}</View>
      )}
      {entry.source === 'note' ? (
        isConfirming ? (
          <View style={styles.noteConfirm}>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={onDeleteCancel}>
              <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmDeleteBtn} onPress={onDeleteConfirm}>
              <Text style={styles.confirmDeleteText}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.noteDeleteBtn}
            onPress={onDeleteRequest}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.noteDeleteIcon}>🗑</Text>
          </TouchableOpacity>
        )
      ) : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:         { flex: 1, backgroundColor: colors.bgDim },
  list:              { padding: 12 },
  empty:             { flex: 1 },
  loader:            { marginTop: 40 },
  sep:               { height: 1, backgroundColor: colors.border, marginHorizontal: 12 },

  noteRow:           { flexDirection: 'row', alignItems: 'flex-start', padding: 14, backgroundColor: colors.card, gap: 10 },
  noteMain:          { flex: 1, gap: 4 },
  noteTagRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  noteTag:           { backgroundColor: colors.bgDim, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  noteTagAppt:       { backgroundColor: colors.primaryLight },
  noteTagText:       { fontSize: 10, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  noteTagApptText:   { color: colors.primary },
  noteApptTitle:     { flex: 1, fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  noteContent:       { fontSize: 15, fontFamily: fonts.body, color: colors.text, lineHeight: 22 },
  noteDate:          { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  noteDeleteBtn:     { paddingTop: 2 },
  noteDeleteIcon:    { fontSize: 16 },

  noteConfirm:       { flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 },
  confirmCancelBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  confirmCancelText: { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  confirmDeleteBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.danger },
  confirmDeleteText: { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

  inputBar:          { flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, gap: 8 },
  input:             { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, fontFamily: fonts.body, color: colors.text, maxHeight: 100 },
  sendBtn:           { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:   { backgroundColor: colors.textTertiary },
  sendBtnText:       { color: '#fff', fontSize: 20, fontFamily: fonts.bold },
  })
}
