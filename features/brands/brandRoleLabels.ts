import type { Brand, BrandNetworkRole, ContactRole } from '@/shared/lib/types'
import { ROLE_PRESETS } from '@/shared/lib/types'

// BRAND-ROLES-1 — vocabulaire par marque ("Conseillère" chez doTERRA, "Partenaire" chez Zinzino).
// Rôles dont le libellé se personnalise par marque (Mes libellés).
export type BrandLabelRole = Exclude<BrandNetworkRole, 'prospect'>
export const BRAND_ROLES: BrandLabelRole[] = ['customer', 'partner', 'leader']
// Statuts proposés dans une marque (fiche, Modifier, Ses marques).
export const BRAND_STATUSES: BrandNetworkRole[] = ['prospect', 'customer', 'partner', 'leader']

// Leader > Partenaire > Client > Prospect (même échelle que brand_role_level en base).
export function brandRoleLevel(role: BrandNetworkRole): number {
  return role === 'leader' ? 4 : role === 'partner' ? 3 : role === 'customer' ? 2 : 1
}

export function isBrandPartnerRole(role: BrandNetworkRole): boolean {
  return role === 'partner' || role === 'leader'
}

// Rôle CRM équivalent : sert de libellé par défaut quand la marque n'a rien de personnalisé.
const GENERAL_ROLE: Record<BrandNetworkRole, ContactRole> = {
  prospect: 'prospect',
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

export const BRAND_ROLE_PRESETS: Record<'doterra' | 'zinzino', Record<BrandLabelRole, string>> = {
  doterra: { customer: 'Client', partner: ROLE_PRESETS.doterra!.distributor!, leader: ROLE_PRESETS.doterra!.leader! },
  zinzino: { customer: 'Client', partner: ROLE_PRESETS.zinzino!.distributor!, leader: ROLE_PRESETS.zinzino!.leader! },
}
