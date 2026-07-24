import { useMemo, useState } from 'react'
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useNotes } from '@/features/notes/useNotes'
import { createNote, deleteNote } from '@/features/notes/noteService'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Note } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'

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

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

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
        {loading
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              data={notes}
              keyExtractor={n => n.id}
              renderItem={({ item }) => (
                <NoteRow
                  note={item}
                  locale={locale}
                  isConfirming={confirmId === item.id}
                  onDeleteRequest={() => setConfirmId(item.id)}
                  onDeleteCancel={() => setConfirmId(null)}
                  onDeleteConfirm={() => handleDelete(item.id)}
                />
              )}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              contentContainerStyle={notes.length === 0 ? styles.empty : styles.list}
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

function NoteRow({ note, locale, isConfirming, onDeleteRequest, onDeleteCancel, onDeleteConfirm }: {
  note: Note
  locale: string
  isConfirming: boolean
  onDeleteRequest: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const date = locale.startsWith('fr')
    ? `${formatDate(note.created_at, locale)} ${new Date(note.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`
    : new Date(note.created_at).toLocaleDateString(locale, {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      })
  return (
    <View style={styles.noteRow}>
      <View style={styles.noteMain}>
        <Text style={styles.noteContent}>{note.content}</Text>
        <Text style={styles.noteDate}>{date}</Text>
      </View>
      {isConfirming ? (
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
      )}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:         { flex: 1, backgroundColor: colors.bg },
  list:              { padding: 12 },
  empty:             { flex: 1 },
  loader:            { marginTop: 40 },
  sep:               { height: 1, backgroundColor: colors.border, marginHorizontal: 12 },

  noteRow:           { flexDirection: 'row', alignItems: 'flex-start', padding: 14, backgroundColor: colors.card, gap: 10 },
  noteMain:          { flex: 1, gap: 4 },
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
