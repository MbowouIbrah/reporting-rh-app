/** Parties du rapport exportables en PDF, dans l'ordre des onglets. */
export const SECTIONS_RAPPORT = [
  { id: 'resume', libelle: 'Résumé', route: '/resume' },
  { id: 'graphes', libelle: 'Graphes', route: '/graphes' },
  { id: 'annuel', libelle: 'Annuel', route: '/annuel' },
  { id: 'mensuel', libelle: 'Mensuel', route: '/mensuel' },
  { id: 'individuel', libelle: 'Individuel', route: '/individuel', perm: 'nominatif:read' },
] as const

export type IdSection = (typeof SECTIONS_RAPPORT)[number]['id']

/** Parties accessibles avec les droits donnés. */
export const sectionsPermises = (can: (p: string) => boolean) =>
  SECTIONS_RAPPORT.filter((s) => !('perm' in s) || can(s.perm))
