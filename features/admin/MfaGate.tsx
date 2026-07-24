import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Input } from '@/shared/components/ui/Input'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { enrollTotp, getMfaState, verifyTotp } from './mfaService'

type Enrollment = Awaited<ReturnType<typeof enrollTotp>>

function qrXml(value?: string) {
  if (!value) return null
  if (value.startsWith('<svg')) return value
  const marker = 'data:image/svg+xml;utf-8,'
  if (value.startsWith(marker)) return decodeURIComponent(value.slice(marker.length))
  return null
}

export function MfaGate({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [loading, setLoading] = useState(true)
  const [verified, setVerified] = useState(false)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      const state = await getMfaState()
      setVerified(state.currentLevel === 'aal2')
      setFactorId(state.verifiedTotp?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de vérifier la MFA.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const startEnrollment = async () => {
    setError('')
    try {
      const data = await enrollTotp()
      setEnrollment(data)
      setFactorId(data.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation impossible.')
    }
  }

  const confirm = async () => {
    if (!factorId || code.trim().length < 6) return
    setLoading(true)
    setError('')
    try {
      await verifyTotp(factorId, code)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Code incorrect ou expiré.')
      setLoading(false)
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
  if (verified) return <>{children}</>

  const xml = qrXml(enrollment?.totp.qr_code)
  return (
    <View style={styles.center}>
      <Card style={styles.card}>
        <Text style={styles.title}>Authentification renforcée requise</Text>
        <Text style={styles.body}>
          Toute opération owner exige un code à usage unique. Configurez une application TOTP (Google Authenticator, 1Password…) ou saisissez votre code actuel.
        </Text>
        {!factorId ? <Button label="Configurer la MFA" onPress={startEnrollment} /> : null}
        {enrollment ? (
          <View style={styles.enrollment}>
            {xml ? <View style={styles.qr}><SvgXml xml={xml} width={180} height={180} /></View> : null}
            <Text selectable style={styles.secret}>Clé : {enrollment.totp.secret}</Text>
          </View>
        ) : null}
        {factorId ? (
          <>
            <Input label="Code à 6 chiffres" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" />
            <Button label="Vérifier et ouvrir la console" onPress={confirm} disabled={code.trim().length !== 6} />
          </>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, minHeight: 420, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: colors.surface },
    card: { width: '100%', maxWidth: 520, gap: 16 },
    title: { fontSize: 22, fontFamily: fonts.bold, color: colors.text },
    body: { fontSize: 14, lineHeight: 21, fontFamily: fonts.body, color: colors.textSecondary },
    enrollment: { alignItems: 'center', gap: 10 },
    qr: { padding: 10, borderRadius: 12, backgroundColor: '#fff' },
    secret: { fontSize: 12, fontFamily: fonts.medium, color: colors.text, textAlign: 'center' },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
