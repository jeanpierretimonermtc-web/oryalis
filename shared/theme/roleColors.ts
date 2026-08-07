import type { ContactRole } from '@/shared/lib/types'
import type { ThemeColors } from './colors'

export function getRoleColors(role: ContactRole, colors: ThemeColors) {
  switch (role) {
    case 'distributor': return { bg: colors.secondaryLight, text: colors.secondary }
    case 'leader':      return { bg: colors.tertiaryLight,  text: colors.tertiary  }
    case 'customer':    return { bg: colors.successLight,   text: colors.success   }
    case 'team_member': return { bg: colors.bgDim,          text: colors.textSecondary }
    case 'inactive':    return { bg: colors.warningLight,   text: colors.warning   }
    default:            return { bg: colors.primaryLight,   text: colors.primary   }
  }
}

// Un client peut cumuler plusieurs rôles (contact_role est un tableau) — utilisé pour
// teinter un avatar/badge unique dans les listes denses (Réseau, Équipe) où afficher un
// pill par rôle prendrait trop de place.
const ROLE_PRIORITY: ContactRole[] = ['leader', 'distributor', 'team_member', 'prospect', 'inactive', 'customer']

export function getPrimaryRole(roles: ContactRole[]): ContactRole {
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r
  }
  return 'customer'
}
