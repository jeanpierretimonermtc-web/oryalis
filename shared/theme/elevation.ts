// DESIGN-A — ombre douce des cartes (fond crème, cartes blanches sans contour en clair ; le
// contour colors.cardBorder prend le relais en sombre, où une ombre ne se voit pas).
export const SOFT_CARD_SHADOW = {
  boxShadow: [
    { offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(27, 36, 51, 0.05)' },
    { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(27, 36, 51, 0.06)' },
  ],
  elevation: 2,
}
