import { Link, useNavigate, useNavigationType } from 'react-router-dom'
import type { Libelles } from './Cartes'

/** Fil d'Ariane de la vue d'un axe, avec retour à la vue d'ensemble. */
export default function FilAriane({ nom, lib, search }: { nom: string; lib: Libelles; search: string }) {
  const navigate = useNavigate()
  const type = useNavigationType()
  const retour = () => (type === 'PUSH' ? navigate(-1) : navigate({ search, hash: '' }))
  return (
    <div className="fil-nav">
      <button type="button" className="bouton bouton-secondaire petit" id="retour" onClick={retour}>← Retour</button>
      <span className="fil-sep" aria-hidden="true" />
      <nav aria-label="Fil d'Ariane">
        <ol>
          <li><Link to={{ search, hash: '' }}>Répartition des charges</Link></li>
          <li aria-current="page">{nom}</li>
        </ol>
      </nav>
      <p className="fil-ctx">{lib.cour}<span className="sep-ctx">comparé à</span>{lib.prec}</p>
    </div>
  )
}
