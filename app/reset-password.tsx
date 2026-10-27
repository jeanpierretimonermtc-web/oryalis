import { useMemo, useState, useEffect } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  View,
} from 'react-native'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { fonts } from '@/shared/theme/fonts'
import type { ThemeColors } from '@/shared/theme/colors'

type PageState = 'loading' | 'form' | 'success' | 'invalid'

export default function ResetPasswordScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [pageState,       setPageState]       = useState<PageState>('loading')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving,          setSaving]          = useState(false)
  const [errorMsg,        setErrorMsg]        = useState<string | null>(null)

  // Parse the URL hash Supabase appends: #access_token=...&refresh_token=...&type=recovery
  useEffect(() => {
    async function init() {
      if (Platform.OS !== 'web' || typeof window === 'undefined') {
        setPageState('invalid')
        return
      }

      const hash   = window.location.hash.substring(1)
      const params = new URLSearchParams(hash)
      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const type         = params.get('type')

      if (!accessToken || !refreshToken || type !== 'recovery') {
        setPageState('invalid')
        return
      }

      const { error } = await supabase.auth.setSession({
        access_token:  accessToken,
        refresh_token: refreshToken,
      })

      setPageState(error ? 'invalid' : 'form')
    }

    init()
  }, [])

  async function handleReset() {
    if (!newPassword.trim()) {
      setErrorMsg(t('auth.error_password_required'))
      return
    }
    if (newPassword.length < 8) {
      setErrorMsg(t('auth.error_password_too_short'))
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg(t('auth.error_passwords_dont_match'))
      return
    }

    setErrorMsg(null)
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      await supabase.auth.signOut()
      setPageState('success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common.error')
      setErrorMsg(msg)
      console.error('[resetPassword.update]', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      {pageState === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {pageState === 'invalid' && (
        <View style={[styles.centered, styles.container]}>
          <Text style={styles.bigIcon}>🔗</Text>
          <Text style={styles.title}>{t('auth.reset_link_invalid_title')}</Text>
          <Text style={styles.hint}>{t('auth.reset_link_invalid_body')}</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.buttonText}>{t('auth.back_to_login')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {pageState === 'success' && (
        <View style={[styles.centered, styles.container]}>
          <Text style={styles.bigIcon}>✅</Text>
          <Text style={styles.title}>{t('auth.password_updated_title')}</Text>
          <Text style={styles.hint}>{t('auth.password_updated_body')}</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.buttonText}>{t('auth.back_to_login')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {pageState === 'form' && (
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Text style={styles.bigIcon}>🔑</Text>
          <Text style={styles.title}>{t('auth.reset_password')}</Text>
          <Text style={styles.hint}>{t('auth.reset_password_hint')}</Text>

          <TextInput
            style={styles.input}
            placeholder={t('auth.new_password')}
            placeholderTextColor={colors.textTertiary}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoComplete="new-password"
          />
          <TextInput
            style={styles.input}
            placeholder={t('auth.confirm_password')}
            placeholderTextColor={colors.textTertiary}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
          />

          {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

          <TouchableOpacity
            style={[styles.button, saving && styles.buttonDisabled]}
            onPress={handleReset}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.buttonText}>{t('auth.reset_password_confirm')}</Text>
            }
          </TouchableOpacity>
        </KeyboardAvoidingView>
      )}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
      gap: 14,
      backgroundColor: colors.bg,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      padding: 24,
      backgroundColor: colors.bg,
    },
    bigIcon: {
      fontSize: 52,
      textAlign: 'center',
    },
    title: {
      fontSize: 24,
      fontFamily: fonts.bold,
      color: colors.text,
      textAlign: 'center',
    },
    hint: {
      fontSize: 14,
      fontFamily: fonts.body,
      color: colors.textSecondary,
      lineHeight: 20,
      textAlign: 'center',
      marginBottom: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 14,
      fontSize: 16,
      fontFamily: fonts.body,
      color: colors.text,
      backgroundColor: colors.bgDim,
    },
    error: {
      color: colors.danger,
      fontSize: 14,
      fontFamily: fonts.body,
      textAlign: 'center',
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      padding: 16,
      alignItems: 'center',
      marginTop: 4,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: fonts.semibold,
    },
  })
}
