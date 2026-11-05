import { useSyncExternalStore } from 'react'
import { ApiError, ErreurReseau } from '../api/client'
import { abonnerConnexion, connexionPerdue } from '../lib/etatConnexion'

export type TypeEtat = 'chargement' | '403' | '404' | 'vide' | 'erreur' | 'reseau' | 'serveur'

const TEXTE: Record<TypeEtat, string> = {
  chargement: 'Chargement…',
  '403': 'Accès refusé',
  '404': 'Aucune donnée pour cette période',
  vide: 'Aucune donnée',
  erreur: 'Une erreur est survenue. Réessayez.',
  reseau: 'Connexion au serveur impossible',
  serveur: 'Le serveur a rencontré une erreur',
}

const AIDE: Partial<Record<TypeEtat, string>> = {
  '403': 'Votre rôle ne donne pas accès à ce contenu. Contactez la DRH si besoin.',
  '404': 'Choisissez une autre période, ou vérifiez que ses données ont été saisies ou importées.',
  vide: 'Aucune période n’est encore disponible.',
  // Relance automatique seulement quand la sonde a constaté la panne (voir BandeauConnexion).
  reseau: 'Vérifiez le réseau, puis réessayez.',
  serveur: 'Réessayez dans un instant. Si cela continue, contactez la DRH.',
}

interface Props {
  type: TypeEtat
  /** Action proposée dans l'état d'erreur (ex. relancer la requête). */
  onRetry?: () => void
  /** Texte propre à la page, à la place du texte générique de l'état. */
  titre?: string
  aide?: string
  /** Chargement : en-têtes connus d'avance (texte statique), sinon une rangée d'en-tête vide. */
  colonnes?: string[]
  lignes?: number
}

/** Premier chargement : la structure du tableau est déjà là, seules les cellules sont en squelette. */
export function TableauSquelette({ colonnes, lignes = 8 }: { colonnes: (string | number)[]; lignes?: number }) {
  return (
    <div className="panneau" aria-busy="true">
      <div className="panneau-corps">
        <table className="dense tableau-squelette">
          <thead>
            <tr>{colonnes.map((c, i) => <th key={i} scope="col" className={i ? 'num' : undefined}>{typeof c === 'string' ? c : ''}</th>)}</tr>
          </thead>
          <tbody aria-hidden="true">
            {Array.from({ length: lignes }, (_, l) => (
              <tr key={l}>{colonnes.map((_, i) => <td key={i} className={i ? 'num' : 'var'} />)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const AIDE_PANNE = 'La page se chargera dès le retour du réseau.'

export default function Etat({ type, onRetry, titre, aide, colonnes, lignes }: Props) {
  const perdue = useSyncExternalStore(abonnerConnexion, connexionPerdue)
  if (type === 'chargement') {
    return (
      // L'annonce « Chargement… » est faite une seule fois par Layout (requête en cours).
      <div className="etat-chargement">
        <TableauSquelette colonnes={colonnes ?? [0, 1, 2, 3, 4, 5]} lignes={lignes} />
      </div>
    )
  }
  return (
    <div className={`etat etat-${type}`} role="alert">
      <strong>{titre ?? TEXTE[type]}</strong>
      {(aide ?? AIDE[type]) && <span className="note">{aide ?? (type === 'reseau' && perdue ? AIDE_PANNE : AIDE[type])}</span>}
      {(type === 'erreur' || type === 'reseau' || type === 'serveur') && onRetry && (
        <button type="button" className="bouton bouton-secondaire" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  )
}

/** Choisit l'état à afficher pour une requête en échec. */
export function etatErreur(e: unknown): TypeEtat {
  if (e instanceof ErreurReseau) return 'reseau'
  if (e instanceof ApiError) {
    if (e.status >= 500) return 'serveur'
    if (e.status === 403) return '403'
    if (e.status === 404) return '404'
  }
  return 'erreur'
}
