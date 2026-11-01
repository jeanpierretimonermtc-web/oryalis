import type { Brand, BrandNetworkRole, ContactRole } from '@/shared/lib/types'
import { ROLE_PRESETS } from '@/shared/lib/types'

// BRAND-ROLES-1 — vocabulaire par marque ("Conseillère" chez doTERRA, "Partenaire" chez Zinzino).
export const BRAND_ROLES: BrandNetworkRole[] = ['customer', 'partner', 'leader']

export function isBrandPartnerRole(role: BrandNetworkRole): boolean {
  return role === 'partner' || role === 'leader'
}

// Rôle CRM équivalent : sert de libellé par défaut quand la marque n'a rien de personnalisé.
const GENERAL_ROLE: Record<BrandNetworkRole, ContactRole> = {
  customer: 'customer',
  partner: 'distributor',
  leader: 'leader',
}

export function brandRoleLabel(
  brand: Pick<Brand, 'role_labels'> | null | undefined,
  role: BrandNetworkRole,
  getRoleLabel: (key: ContactRole) => string,
): string {
  return brand?.role_labels?.[role]?.trim() || getRoleLabel(GENERAL_ROLE[role])
}

export const BRAND_ROLE_PRESETS: Record<'doterra' | 'zinzino', Record<BrandNetworkRole, string>> = {
  doterra: { customer: 'Client', partner: ROLE_PRESETS.doterra!.distributor!, leader: ROLE_PRESETS.doterra!.leader! },
  zinzino: { customer: 'Client', partner: ROLE_PRESETS.zinzino!.distributor!, leader: ROLE_PRESETS.zinzino!.leader! },
}
