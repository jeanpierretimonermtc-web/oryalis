import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { supabase } from '@/shared/lib/supabase'

const INSTALLATION_KEY = 'oryalis-security-installation-id'

async function installationId() {
  const existing = await AsyncStorage.getItem(INSTALLATION_KEY)
  if (existing) return existing
  const created = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  await AsyncStorage.setItem(INSTALLATION_KEY, created)
  return created
}

export async function recordSecurityLogin() {
  const id = await installationId()
  const { data, error } = await supabase.functions.invoke('record-security-login', {
    body: { installationId: id, platform: Platform.OS },
  })
  if (error) throw error
  return Boolean(data?.unusual)
}
