import { ApiError } from '../api/client'

export type TypeEtat = 'chargement' | '403' | '404' | 'vide' | 'erreur'

const TEXTE: Record<TypeEtat, string> = {
  chargement: 'Chargement…',
  '403': 'Accès refusé',
  '404': 'Aucune donnée pour cette période',
  vide: 'Aucune donnée',
  erreur: 'Une erreur est survenue. Réessayez.',
}

const AIDE: Partial<Record<TypeEtat, string>> = {
  '403': 'Votre rôle ne donne pas accès à ce contenu. Contactez la DRH si besoin.',
  '404': 'Choisissez une autre période, ou vérifiez que les données ont été importées.',
  vide: 'Aucune période n’est encore disponible.',
}

interface Props {
  type: TypeEtat
  /** Action proposée dans l'état d'erreur (ex. relancer la requête). */
  onRetry?: () => void
}

export default function Etat({ type, onRetry }: Props) {
  if (type === 'chargement') {
    return (
      <div className="etat" role="status" aria-live="polite">
        <div className="squelette" aria-hidden="true">
          <span /> <span /> <span />
        </div>
        <span className="sr-only">{TEXTE[type]}</span>
      </div>
    )
  }
  return (
    <div className={`etat etat-${type}`} role="alert">
      <strong>{TEXTE[type]}</strong>
      {AIDE[type] && <span className="note">{AIDE[type]}</span>}
      {type === 'erreur' && onRetry && (
        <button type="button" className="bouton bouton-secondaire" onClick={onRetry}>
          Réessayer
        </button>
      )}
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
