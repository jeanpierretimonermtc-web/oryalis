import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal } from 'react-native'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useUpline } from '@/features/network/useUpline'
import { Input } from '@/shared/components/ui/Input'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { UplineNode } from '@/shared/lib/types'

export default function UplineScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { nodes, loading, add, update, remove } = useUpline()

  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing]           = useState<UplineNode | null>(null)
  const [name, setName]                 = useState('')
  const [memberId, setMemberId]         = useState('')
  const [saving, setSaving]             = useState(false)
  const [errorMsg, setErrorMsg]         = useState<string | null>(null)

  function openAdd() {
    setEditing(null)
    setName('')
    setMemberId('')
    setErrorMsg(null)
    setModalVisible(true)
  }

  function openEdit(node: UplineNode) {
    setEditing(node)
    setName(node.name)
    setMemberId(node.member_id ?? '')
    setErrorMsg(null)
    setModalVisible(true)
  }

  function closeModal() {
    setModalVisible(false)
    setEditing(null)
  }

  async function handleSave() {
    if (!name.trim()) { setErrorMsg(t('network.upline_name')); return }
    setSaving(true)
    try {
      if (editing) {
        await update(editing.id, name.trim(), memberId.trim() || null)
      } else {
        await add(name.trim(), memberId.trim() || null)
      }
      closeModal()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await remove(id)
  }

  // Trier du plus haut (position max) au plus bas (direct sponsor, position 0)
  const sorted = [...nodes].sort((a, b) => b.position - a.position)

  return (
    <>
      <Stack.Screen options={{ title: t('network.upline_title'), headerBackTitle: '' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>

        {/* Explication */}
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            {t('network.upline_empty_sub', { defaultValue: 'Renseignez vos sponsors, du plus proche (sponsor direct) au plus éloigné. Ils s\'afficheront au-dessus de vous dans l\'arbre réseau.' })}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : sorted.length === 0 ? (
          <Text style={styles.empty}>{t('network.upline_empty')}</Text>
        ) : (
          <View style={styles.list}>
            {sorted.map((node, index) => {
              const isDirectSponsor = node.position === 0
              const levelLabel = isDirectSponsor
                ? t('network.upline_direct')
                : t('network.upline_level', { n: node.position + 1 })
              return (
                <View key={node.id} style={styles.nodeRow}>
                  {/* Ligne de connexion sauf pour le premier */}
                  {index < sorted.length - 1 && <View style={styles.lineUp} />}

                  <View style={styles.nodeLeft}>
                    <View style={styles.nodeDot} />
                    <View style={styles.nodeInfo}>
                      <Text style={styles.nodeName}>{node.name}</Text>
                      <View style={styles.nodeMeta}>
                        <Text style={styles.nodeLevel}>{levelLabel}</Text>
                        {node.member_id ? (
                          <Text style={styles.nodeMemberId}>#{node.member_id}</Text>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <View style={styles.nodeActions}>
                    <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(node)} hitSlop={8}>
                      <Text style={styles.editIcon}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(node.id)} hitSlop={8}>
                      <Text style={styles.deleteIcon}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            })}

            {/* Nœud "Moi" en bas */}
            <View style={styles.youRow}>
              <View style={[styles.nodeDot, { backgroundColor: colors.primary }]} />
              <Text style={[styles.nodeName, { color: colors.primary }]}>{t('network.you')}</Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.8}>
          <Text style={styles.addBtnText}>+ {t('network.upline_add')}</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* Modal ajout / édition */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {editing ? t('network.upline_edit') : t('network.upline_add')}
            </Text>

            <Input
              label={t('network.upline_name')}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              placeholder="Marie Dupont"
            />
            <Input
              label={t('network.upline_member_id')}
              value={memberId}
              onChangeText={setMemberId}
              placeholder="123456"
              keyboardType="default"
            />

            {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

            <Button label={t('network.upline_save')} onPress={handleSave} loading={saving} />
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal} activeOpacity={0.7}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bgDim },
    content:   { padding: 16, gap: 12, paddingBottom: 60 },

    infoCard: { backgroundColor: colors.primaryLight, borderRadius: 12, padding: 14 },
    infoText: { fontSize: 13, fontFamily: fonts.body, color: colors.primary, lineHeight: 20 },

    empty: { textAlign: 'center', color: colors.textTertiary, fontFamily: fonts.body, fontSize: 14, marginTop: 32 },

    list: { gap: 0 },

    nodeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 4,
      position: 'relative',
    },
    lineUp: {
      position: 'absolute',
      left: 11,
      top: 0,
      bottom: '50%',
      width: 2,
      backgroundColor: colors.border,
    },
    nodeLeft:   { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    nodeDot:    { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textSecondary, flexShrink: 0 },
    nodeInfo:   { flex: 1, gap: 2 },
    nodeName:   { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    nodeMeta:   { flexDirection: 'row', gap: 8, alignItems: 'center' },
    nodeLevel:  { fontSize: 12, fontFamily: fonts.medium, color: colors.primary },
    nodeMemberId: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },

    nodeActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    editBtn:   { padding: 4 },
    editIcon:  { fontSize: 14 },
    deleteBtn: { padding: 4 },
    deleteIcon:{ fontSize: 14, color: colors.danger },

    youRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderTopWidth: 2,
      borderTopColor: colors.border,
      marginTop: 4,
    },

    addBtn: {
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.primary,
      paddingVertical: 13,
      alignItems: 'center',
      marginTop: 8,
    },
    addBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet:   { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14, paddingBottom: 36 },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 8 },
    sheetTitle:  { fontSize: 18, fontFamily: fonts.bold, color: colors.text, marginBottom: 4 },

    error:     { fontSize: 13, fontFamily: fonts.body, color: colors.danger },
    cancelBtn: { alignItems: 'center', paddingVertical: 10 },
    cancelText:{ fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  })
}
