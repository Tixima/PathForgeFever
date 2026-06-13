export const BRAND = {
  publisher: 'TiximaGaming',
  productName: 'PathForgeFever',
  productSlug: 'pathforgefever',
  game: 'Transport Fever 2',
  tagline: 'Forge your route through the network',
  subtitle:
    'Pathfinding, Gleislogik, Erreichbarkeit und Netzanalyse für dein TF2-Netz.',
  exportHint: 'Tixima TF2 Line Exporter',
  copyRoutePrefix: 'PathForgeFever',
  pageTitle: 'PathForgeFever · TiximaGaming',
  pageDescription:
    'PathForgeFever by TiximaGaming — Routenplanung, Gleisintelligenz, Erreichbarkeit und Netzwerk-Tools für Transport Fever 2.',
} as const

export function brandFooter(): string {
  return `© ${new Date().getFullYear()} ${BRAND.publisher}`
}
