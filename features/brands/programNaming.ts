import type { Brand } from '@/shared/lib/types'
import { formatProgramTitle } from '@/features/clients/lrpProgramService'

// PROGRAM-BRAND-1 — nom affiché d'un programme : nom propre à la marque ("LRP", "Abonnement")
// sinon le nom global du compte, suivi de la marque ("LRP doTERRA"), puis du libellé éventuel.
export function programTitleForBrand(
  brand: Pick<Brand, 'name' | 'program_name'> | null | undefined,
  globalProgramName: string,
  label: string | null | undefined,
): string {
  const base = brand
    ? `${brand.program_name?.trim() || globalProgramName} ${brand.name}`
    : globalProgramName
  return formatProgramTitle(base, label)
}
