import { useMemo, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native'
import { Link } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { fonts } from '@/shared/theme/fonts'
import type { ThemeColors } from '@/shared/theme/colors'

export default function RegisterScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [confirmEmailSent, setConfirmEmailSent] = useState(false)

  async function handleRegister() {
    setErrorMsg(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) {
        setErrorMsg(error.message)
        return
      }
      // session === null → confirmation email required
      if (!data.session) {
        setConfirmEmailSent(true)
      }
      // session exists → (auth)/_layout.tsx redirects automatically
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common.error')
      setErrorMsg(msg)
      console.error('[register]', e)
    } finally {
      setLoading(false)
    }
  }

  if (confirmEmailSent) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.title}>{t('auth.confirm_email_title')}</Text>
        <Text style={styles.confirmBody}>{t('auth.confirm_email_body', { email })}</Text>
        <Link href="/(auth)/login" style={styles.link}>
          <Text style={styles.linkText}>{t('auth.login')}</Text>
        </Link>
      </KeyboardAvoidingView>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>{t('auth.register')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('auth.full_name')}
        placeholderTextColor={colors.textTertiary}
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.email')}
        placeholderTextColor={colors.textTertiary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextInput
        style={styles.input}
        placeholder={t('auth.password')}
        placeholderTextColor={colors.textTertiary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        <Text style={styles.buttonText}>
          {loading ? t('common.loading') : t('auth.register')}
        </Text>
      </TouchableOpacity>
      <Link href="/(auth)/login" style={styles.link}>
        <Text style={styles.linkText}>{t('auth.login')}</Text>
      </Link>
    </KeyboardAvoidingView>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
      gap: 12,
      backgroundColor: colors.bg,
    },
    title: {
      fontSize: 28,
      fontFamily: fonts.bold,
      marginBottom: 8,
      color: colors.text,
    },
    confirmBody: {
      fontSize: 15,
      fontFamily: fonts.body,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: 8,
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
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: fonts.semibold,
    },
    link: {
      alignItems: 'center',
      marginTop: 8,
    },
    linkText: {
      color: colors.primary,
      fontSize: 14,
      fontFamily: fonts.medium,
      textAlign: 'center',
    },
  })
}
