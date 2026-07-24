import { Platform } from 'react-native'
import type { CustomerInfo, PurchasesPackage } from 'react-native-purchases'

export const ADVISOR_ENTITLEMENT = 'advisor'

function getApiKey() {
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
  return null
}

async function purchases() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') throw new Error('Mobile purchases are only available on iOS and Android')
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('REVENUECAT_NOT_CONFIGURED')
  const { default: Purchases } = await import('react-native-purchases')
  if (await Purchases.isConfigured()) await Purchases.logIn(currentUserId!)
  else Purchases.configure({ apiKey, appUserID: currentUserId! })
  return Purchases
}

let currentUserId: string | null = null

export async function initializeMobilePurchases(userId: string) {
  currentUserId = userId
  await purchases()
}

function hasAdvisor(info: CustomerInfo) {
  return Boolean(info.entitlements.active[ADVISOR_ENTITLEMENT])
}

export async function purchaseAdvisor(interval: 'month' | 'year') {
  const Purchases = await purchases()
  const offerings = await Purchases.getOfferings()
  const offering = offerings.current
  if (!offering) throw new Error('REVENUECAT_OFFERING_MISSING')
  const selected: PurchasesPackage | null = interval === 'year' ? offering.annual : offering.monthly
  if (!selected) throw new Error('REVENUECAT_PACKAGE_MISSING')
  const { customerInfo } = await Purchases.purchasePackage(selected)
  return hasAdvisor(customerInfo)
}

export async function restoreMobilePurchases() {
  const Purchases = await purchases()
  const info = await Purchases.restorePurchases()
  return hasAdvisor(info)
}

export async function getMobileManagementUrl() {
  const Purchases = await purchases()
  const info = await Purchases.getCustomerInfo()
  return info.managementURL
}
