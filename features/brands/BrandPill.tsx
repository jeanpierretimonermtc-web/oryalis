import { useMemo } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'
import { fonts } from '@/shared/theme/fonts'
import type { Brand } from '@/shared/lib/types'
import { brandPalette } from './brandColors'

// Pastille de marque : logo importé (s'il existe) + nom, sur la couleur de la marque.
export function BrandPill({ brand, size = 'md' }: { brand: Pick<Brand, 'name' | 'color' | 'normalized_name' | 'logo_url'>; size?: 'sm' | 'md' }) {
  const palette = brandPalette(brand)
  const styles = useMemo(() => makeStyles(size), [size])
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }, brand.logo_url ? styles.pillWithLogo : null]}>
      {brand.logo_url ? <Image source={{ uri: brand.logo_url }} style={styles.logo} accessibilityIgnoresInvertColors /> : null}
      <Text style={[styles.text, { color: palette.text }]} numberOfLines={1}>{brand.name.toUpperCase()}</Text>
    </View>
  )
}

// Vignette carrée (listes de marques) : logo, sinon initiale sur la couleur de la marque.
export function BrandAvatar({ brand, size = 36 }: { brand: Pick<Brand, 'name' | 'color' | 'normalized_name' | 'logo_url'>; size?: number }) {
  const palette = brandPalette(brand)
  return brand.logo_url ? (
    // Logo entier (jamais rogné), même s'il n'est pas carré.
    <Image source={{ uri: brand.logo_url }} style={{ width: size, height: size, borderRadius: Math.min(10, size / 2) }} resizeMode="contain" accessibilityIgnoresInvertColors />
  ) : (
    <View style={{ width: size, height: size, borderRadius: Math.min(10, size / 2), backgroundColor: palette.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.44, fontFamily: fonts.bold, color: palette.text }}>{brand.name.charAt(0).toUpperCase()}</Text>
    </View>
  )
}

function makeStyles(size: 'sm' | 'md') {
  const sm = size === 'sm'
  return StyleSheet.create({
    pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: sm ? 7 : 9, paddingVertical: sm ? 2 : 3, borderRadius: 9999, maxWidth: 170 },
    pillWithLogo: { paddingLeft: 3 },
    logo: { width: sm ? 13 : 16, height: sm ? 13 : 16, borderRadius: 8 },
    text: { fontSize: sm ? 9.5 : 10, fontFamily: fonts.bold, letterSpacing: 0.4, flexShrink: 1 },
  })
}
