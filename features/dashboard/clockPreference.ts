import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

// WORLD-CLOCK-1 — style de l'horloge de l'accueil, propre à l'appareil (comme le thème).
export type ClockStyle = 'digital' | 'analog' | 'hidden'

const KEY = 'oryalis.clockStyle'
let current: ClockStyle = 'digital'
let loaded = false
const listeners = new Set<(style: ClockStyle) => void>()

function emit(style: ClockStyle) {
  current = style
  listeners.forEach(l => l(style))
}

export function setClockStyle(style: ClockStyle) {
  emit(style)
  AsyncStorage.setItem(KEY, style).catch(() => {})
}

export function useClockStyle(): ClockStyle {
  const [style, setStyle] = useState<ClockStyle>(current)
  useEffect(() => {
    listeners.add(setStyle)
    if (!loaded) {
      loaded = true
      AsyncStorage.getItem(KEY).then(v => {
        if (v === 'digital' || v === 'analog' || v === 'hidden') emit(v)
      }).catch(() => {})
    }
    return () => { listeners.delete(setStyle) }
  }, [])
  return style
}
