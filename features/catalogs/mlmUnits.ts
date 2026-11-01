// MLM-UNIT-1 — type d'une valeur MLM personnelle, stocké dans mlm_metric_definitions.unit (texte
// libre, nullable, déjà présent en base). NULL = ancien comportement "nombre", sans suffixe.
export type MlmUnit = 'points' | 'percent' | 'currency' | 'number'

export const MLM_UNITS: MlmUnit[] = ['points', 'percent', 'currency', 'number']

const UNIT_SUFFIX: Record<MlmUnit, string> = {
  points: 'pts',
  percent: '%',
  currency: '€',
  number: '',
}

export function toMlmUnit(unit: string | null | undefined): MlmUnit {
  return (MLM_UNITS as string[]).includes(unit ?? '') ? (unit as MlmUnit) : 'number'
}

export function mlmUnitSuffix(unit: string | null | undefined): string {
  return UNIT_SUFFIX[toMlmUnit(unit)]
}
