/** Parties du rapport exportables en PDF, dans l'ordre des onglets. */
export const SECTIONS_RAPPORT = [
  { id: 'resume', libelle: 'Budget réalisé', route: '/resume' },
  { id: 'graphes', libelle: 'Graphes', route: '/graphes' },
  { id: 'charges', libelle: 'Répartition des charges', route: '/charges' },
  { id: 'individuel', libelle: 'Individuel', route: '/individuel', perm: 'nominatif:read' },
] as const

export type IdSection = (typeof SECTIONS_RAPPORT)[number]['id']

/** Parties accessibles avec les droits donnés. */
export const sectionsPermises = (can: (p: string) => boolean) =>
  SECTIONS_RAPPORT.filter((s) => !('perm' in s) || can(s.perm))

/** Anciennes parties du rapport (liens déjà enregistrés) : Annuel et Mensuel sont devenues la répartition des charges. */
const ANCIENNES_PARTIES: Record<string, IdSection> = { annuel: 'charges', mensuel: 'charges' }

/** Identifiants de parties lus dans l'adresse (« resume,annuel,mensuel »), anciens noms repris. */
export const idsSections = (texte: string | null) =>
  (texte ?? '').split(',').map((id) => ANCIENNES_PARTIES[id] ?? id)
