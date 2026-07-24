import { useMemo, useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Link } from 'expo-router'
import { Eye, EyeOff } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { fonts } from '@/shared/theme/fonts'
import type { ThemeColors } from '@/shared/theme/colors'

const APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://oryalis.vercel.app').replace(/\/+$/, '')
const RESET_REDIRECT = `${APP_URL}/reset-password`

type Mode = 'login' | 'forgot'

export default function LoginScreen() {
  const { t } = useTranslation()
  const { colors, mode } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [screen, setScreen] = useState<Mode>('login')

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [resetEmail,   setResetEmail]   = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSent,    setResetSent]    = useState(false)
  const [resetError,   setResetError]   = useState<string | null>(null)

  async function handleLogin() {
    setErrorMsg(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setErrorMsg(error.message)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common.error')
      setErrorMsg(msg)
      console.error('[login]', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotPassword() {
    if (!resetEmail.trim()) {
      setResetError(t('auth.error_email_required'))
      return
    }
    setResetError(null)
    setResetLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: RESET_REDIRECT,
      })
      if (error) throw error
      setResetSent(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common.error')
      setResetError(msg)
      console.error('[resetPassword]', e)
    } finally {
      setResetLoading(false)
    }
  }

  function goToForgot() {
    setResetEmail(email)
    setResetSent(false)
    setResetError(null)
    setScreen('forgot')
  }

  function goToLogin() {
    setScreen('login')
    setErrorMsg(null)
  }

  const wordmark = mode === 'dark'
    ? require('@/assets/wordmark-dark.png')
    : require('@/assets/wordmark-day.png')

  // ── Brand block (shared) ────────────────────────────────────────────────────

  const BrandBlock = (
    <View style={styles.brand}>
      <View style={styles.brandLogoRow}>
        <Image source={require('@/assets/logo-icon.png')} style={styles.brandIcon} resizeMode="contain" />
        <Image source={wordmark} style={styles.brandWordmark} resizeMode="contain" />
      </View>
      <Text style={styles.appName}>{t('auth.app_name')}</Text>
      <Text style={styles.tagline}>{t('auth.tagline')}</Text>
    </View>
  )

  // ── Forgot password ─────────────────────────────────────────────────────────

  if (screen === 'forgot') {
    return (
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inner}>
          <View style={styles.card}>
            {BrandBlock}
            <View style={styles.divider} />

            <TouchableOpacity onPress={goToLogin} style={styles.backRow}>
              <Text style={styles.backArrow}>←</Text>
              <Text style={styles.backText}>{t('auth.back_to_login')}</Text>
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>{t('auth.forgot_password')}</Text>

            {resetSent ? (
              <View style={styles.successBox}>
                <View style={styles.successIconWrap}>
                  <Text style={styles.successIconText}>✉</Text>
                </View>
                <Text style={styles.successTitle}>{t('auth.reset_email_sent_title')}</Text>
                <Text style={styles.successBody}>
                  {t('auth.reset_email_sent_body', { email: resetEmail })}
                </Text>
                <TouchableOpacity style={styles.btn} onPress={goToLogin}>
                  <Text style={styles.btnText}>{t('auth.back_to_login')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.hint}>{t('auth.forgot_password_hint')}</Text>
                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>{t('auth.email')}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.textTertiary}
                    value={resetEmail}
                    onChangeText={setResetEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                  />
                </View>
                {resetError ? <Text style={styles.errorText}>{resetError}</Text> : null}
                <TouchableOpacity
                  style={[styles.btn, resetLoading && styles.btnDisabled]}
                  onPress={handleForgotPassword}
                  disabled={resetLoading}
                >
                  <Text style={styles.btnText}>
                    {resetLoading ? t('common.loading') : t('auth.send_reset_link')}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </ScrollView>
    )
  }

  // ── Login ───────────────────────────────────────────────────────────────────

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inner}>
        <View style={styles.card}>

          {BrandBlock}
          <View style={styles.divider} />

          {/* Email */}
          <View style={styles.fieldWrap}>
            <Text style={styles.fieldLabel}>{t('auth.email')}</Text>
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          {/* Password */}
          <View style={styles.fieldWrap}>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{t('auth.password')}</Text>
              <TouchableOpacity onPress={goToForgot}>
                <Text style={styles.forgotLink}>{t('auth.forgot_password')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.passwordInputWrap}>
              <TextInput
                style={styles.passwordInput}
                placeholder="••••••••"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!passwordVisible}
                autoComplete="password"
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setPasswordVisible(visible => !visible)}
                accessibilityRole="button"
                accessibilityLabel={t(passwordVisible ? 'auth.hide_password' : 'auth.show_password')}
                hitSlop={4}
              >
                {passwordVisible
                  ? <EyeOff size={20} color={colors.textSecondary} strokeWidth={2} />
                  : <Eye size={20} color={colors.textSecondary} strokeWidth={2} />
                }
              </TouchableOpacity>
            </View>
          </View>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {/* Sign in */}
          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>
              {loading ? t('common.loading') : t('auth.login')}
            </Text>
          </TouchableOpacity>

          {/* Register */}
          <View style={styles.footerRow}>
            <Text style={styles.footerHint}>No account? </Text>
            <Link href="/(auth)/register">
              <Text style={styles.footerLink}>{t('auth.register')}</Text>
            </Link>
          </View>

        </View>
      </KeyboardAvoidingView>
    </ScrollView>
  )
}

function makeStyles(colors: ThemeColors) {
  const isWeb = Platform.OS === 'web'

  return StyleSheet.create({
    scroll: {
      flexGrow: 1,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 48,
      paddingHorizontal: isWeb ? 24 : 0,
    },
    inner: {
      width: '100%',
      maxWidth: isWeb ? 460 : undefined,
      alignItems: 'center',
    },

    // ── Card ────────────────────────────────────────────────────────────────────
    card: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: isWeb ? 16 : 0,
      borderWidth: isWeb ? 1 : 0,
      borderColor: colors.border,
      padding: isWeb ? 40 : 28,
      paddingHorizontal: isWeb ? 40 : 24,
      gap: 20,
      ...(isWeb && {
        boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 24, color: 'rgba(0, 0, 0, 0.06)' }],
      }),
    },

    // ── Brand section ────────────────────────────────────────────────────────────
    brand: {
      gap: 8,
    },
    brandLogoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 4,
    },
    brandIcon: {
      width: 36,
      height: 36,
    },
    brandWordmark: {
      height: 20,
      width: 108,
    },
    appName: {
      fontFamily: fonts.display,
      fontSize: 32,
      color: colors.text,
      letterSpacing: 2,
      lineHeight: 38,
    },
    tagline: {
      fontFamily: fonts.body,
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
    },

    // ── Divider ─────────────────────────────────────────────────────────────────
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },

    // ── Fields ──────────────────────────────────────────────────────────────────
    fieldWrap: {
      gap: 7,
    },
    fieldRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    fieldLabel: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSecondary,
    },
    forgotLink: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.primary,
    },
    input: {
      backgroundColor: colors.bgDim,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
      fontSize: 15,
      fontFamily: fonts.body,
      color: colors.text,
    },
    passwordInputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgDim,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
    },
    passwordInput: {
      flex: 1,
      paddingLeft: 14,
      paddingVertical: 13,
      fontSize: 15,
      fontFamily: fonts.body,
      color: colors.text,
    },
    passwordToggle: {
      width: 44,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ── Error ────────────────────────────────────────────────────────────────────
    errorText: {
      fontFamily: fonts.body,
      fontSize: 13,
      color: colors.danger,
      textAlign: 'center',
    },

    // ── Hint ─────────────────────────────────────────────────────────────────────
    hint: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 21,
    },

    // ── Button ───────────────────────────────────────────────────────────────────
    btn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 15,
      alignItems: 'center',
    },
    btnDisabled: {
      opacity: 0.55,
    },
    btnText: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: '#FFFFFF',
      letterSpacing: 0.2,
    },

    // ── Footer row ────────────────────────────────────────────────────────────────
    footerRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: 4,
    },
    footerHint: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.textSecondary,
    },
    footerLink: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.primary,
    },

    // ── Forgot / Back ─────────────────────────────────────────────────────────────
    backRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
    },
    backArrow: {
      fontSize: 16,
      color: colors.primary,
    },
    backText: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.primary,
    },
    sectionTitle: {
      fontFamily: fonts.semibold,
      fontSize: 20,
      color: colors.text,
      lineHeight: 26,
    },

    // ── Success ──────────────────────────────────────────────────────────────────
    successBox: {
      alignItems: 'center',
      gap: 16,
      paddingVertical: 8,
    },
    successIconWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    successIconText: {
      fontSize: 24,
      color: colors.primary,
    },
    successTitle: {
      fontFamily: fonts.semibold,
      fontSize: 18,
      color: colors.text,
      textAlign: 'center',
    },
    successBody: {
      fontFamily: fonts.body,
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 21,
    },
  })
}
