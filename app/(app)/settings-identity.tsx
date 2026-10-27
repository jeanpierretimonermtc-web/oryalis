import { useState, useMemo } from 'react'
import { View, Text, Image, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal, Platform } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import { Input } from '@/shared/components/ui/Input'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useProfileData } from '@/features/settings/useProfileData'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { AnchoredMenu } from '@/shared/components/ui/AnchoredMenu'

function initials(n: string) {
  const p = (n ?? '').trim().split(' ').filter(Boolean)
  if (!p.length) return '?'
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length-1][0]).toUpperCase()
}

export default function IdentitySettingsScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { data, update, save, loading, saving, saved } = useProfileData()
  const [showPhoto, setShowPhoto] = useState(false)
  const [photoPos,  setPhotoPos]  = useState({ x: 0, y: 0 })
  const [showUrl,   setShowUrl]   = useState(false)
  const [urlDraft,  setUrlDraft]  = useState('')
  const [uploading, setUploading] = useState(false)
  const [errorMsg,  setErrorMsg]  = useState<string | null>(null)

  async function uploadImage(uri: string) {
    if (!session?.user.id) return
    setUploading(true)
    setErrorMsg(null)
    try {
      const blob = await (await fetch(uri)).blob()
      const { error } = await supabase.storage.from('avatars').upload(`${session.user.id}.jpg`, blob, { upsert: true, contentType: 'image/jpeg' })
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${session.user.id}.jpg`)
      await save({ avatar_url: publicUrl })
    } catch (e) { console.error(e); setErrorMsg(t('settings.avatar_upload_error')) }
    finally { setUploading(false) }
  }

  async function pickCamera() {
    setShowPhoto(false)
    if (Platform.OS !== 'web') { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return }
    const r = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1,1], quality: 0.8 })
    if (!r.canceled && r.assets[0]) await uploadImage(r.assets[0].uri)
  }

  async function pickLibrary() {
    setShowPhoto(false)
    if (Platform.OS !== 'web') { const p = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!p.granted) return }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1,1], quality: 0.8 })
    if (!r.canceled && r.assets[0]) await uploadImage(r.assets[0].uri)
  }

  if (loading) return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.section_identity'))} />
      <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
    </>
  )

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.section_identity'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={(e) => { setPhotoPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); setShowPhoto(true) }}
            activeOpacity={0.85}
            style={styles.avatarWrap}
            accessibilityLabel={t('settings.change_photo')}
          >
            {uploading ? <View style={styles.avatarBox}><ActivityIndicator color="#fff" /></View>
              : data.avatar_url ? <Image source={{ uri: data.avatar_url }} style={styles.avatarImg} />
              : <View style={styles.avatarBox}><Text style={styles.avatarText}>{initials(data.full_name)}</Text></View>}
            <View style={styles.avatarEdit}><Text style={{ fontSize: 14 }}>📷</Text></View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>{t('settings.change_photo')}</Text>
        </View>

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <Input label={t('settings.full_name')} value={data.full_name ?? ''} onChangeText={v => update({ full_name: v })} placeholder="Jean Dupont" />
        <Input label={t('settings.specialty')} value={data.specialty ?? ''} onChangeText={v => update({ specialty: v })} placeholder={t('settings.specialty_placeholder')} />

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{t('settings.bio')}</Text>
          <TextInput style={styles.textArea} value={data.bio ?? ''} onChangeText={v => update({ bio: v })} placeholder={t('settings.bio_placeholder')} placeholderTextColor={colors.textTertiary} multiline numberOfLines={3} />
        </View>

        <Button label={saved ? `✓  ${t('settings.saved')}` : t('settings.save')} onPress={() => save({ full_name: data.full_name, specialty: data.specialty, bio: data.bio })} loading={saving} />
        <View style={{ height: 40 }} />
      </ScrollView>

      <AnchoredMenu
        visible={showPhoto}
        onClose={() => setShowPhoto(false)}
        anchor={photoPos}
        title={t('settings.change_photo')}
        items={[
          ...(Platform.OS !== 'web' ? [{
            key: 'camera', label: t('settings.photo_camera'),
            icon: <Text style={styles.sheetIcon}>📷</Text>,
            onPress: pickCamera,
          }] : []),
          {
            key: 'library', label: t('settings.photo_library'),
            icon: <Text style={styles.sheetIcon}>🖼️</Text>,
            onPress: pickLibrary,
          },
          {
            key: 'url', label: t('settings.photo_url'),
            icon: <Text style={styles.sheetIcon}>🔗</Text>,
            onPress: () => setShowUrl(true),
          },
        ]}
      />

      <Modal visible={showUrl} transparent animationType="slide" onRequestClose={() => setShowUrl(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowUrl(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('settings.photo_url')}</Text>
            <TextInput style={styles.urlInput} value={urlDraft} onChangeText={setUrlDraft} placeholder={t('settings.photo_url_placeholder')} placeholderTextColor={colors.textTertiary} autoCapitalize="none" keyboardType="url" autoFocus />
            <TouchableOpacity style={styles.saveBtn} onPress={async () => { if (!urlDraft.trim()) return; await save({ avatar_url: urlDraft.trim() }); setShowUrl(false); setUrlDraft('') }} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>{t('common.save')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, maxWidth: 720, alignSelf: 'center', width: '100%', paddingBottom: 40 },
  avatarSection: { alignItems: 'center', paddingVertical: 16, gap: 8 },
  avatarWrap: { position: 'relative' },
  avatarImg:  { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: colors.primaryLight },
  avatarBox:  { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontFamily: fonts.bold, color: '#fff' },
  avatarEdit: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avatarHint: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary },
  errorText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger, textAlign: 'center' },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  textArea: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: fonts.body, color: colors.text, minHeight: 80, textAlignVertical: 'top' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 44, gap: 4 },
  sheetTitle: { fontSize: 17, fontFamily: fonts.semibold, color: colors.text, marginBottom: 8, textAlign: 'center' },
  sheetIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  urlInput: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: fonts.body, color: colors.text, marginBottom: 8 },
  saveBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },
  })
}
