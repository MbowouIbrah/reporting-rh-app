import { ApiError } from '../api/client'

export type TypeEtat = 'chargement' | '403' | '404' | 'vide' | 'erreur'

const TEXTE: Record<TypeEtat, string> = {
  chargement: 'Chargement…',
  '403': 'Accès refusé',
  '404': 'Aucune donnée pour cette période',
  vide: 'Aucune donnée',
  erreur: 'Une erreur est survenue. Réessayez.',
}

export default function Etat({ type }: { type: TypeEtat }) {
  return (
    <div className="etat" role={type === 'chargement' ? 'status' : 'alert'}>
      {TEXTE[type]}
    </div>
  )
}

/** Choisit l'état à afficher pour une requête en échec. */
export function etatErreur(e: unknown): TypeEtat {
  if (e instanceof ApiError) {
    if (e.status === 403) return '403'
    if (e.status === 404) return '404'
  }
  return 'erreur'
}
