import { useState } from 'react'
import {
  apercuRenommage,
  useModifierRef,
  useReferentielDim,
  type Dimension,
} from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Badge, Bouton, Carte, Champ, Confirmer } from '../../components/Kit'

const DIMS: { dim: Dimension; label: string }[] = [
  { dim: 'service', label: 'Services' },
  { dim: 'site', label: 'Sites' },
  { dim: 'activite', label: 'Activités' },
  { dim: 'type_contrat', label: 'Types de contrat' },
]

export default function Referentiels() {
  const [dim, setDim] = useState<Dimension>('service')
  const q = useReferentielDim(dim)
  const modifier = useModifierRef()
  const [cible, setCible] = useState<{ id: number; ancien: string } | null>(null)
  const [libelle, setLibelle] = useState('')
  const [nb, setNb] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const fermer = () => {
    setCible(null)
    setLibelle('')
    setNb(null)
    setErr(null)
  }
  const ouvrir = (id: number, ancien: string) => {
    fermer()
    setCible({ id, ancien })
    setLibelle(ancien)
  }
  const verifier = (v: string) => {
    setLibelle(v)
    setErr(null)
    setNb(null)
    const t = v.trim()
    if (cible && t && t !== cible.ancien)
      apercuRenommage({ dim, id: cible.id, libelle: t }).then((r) => setNb(r.perimetres_maj), (e: Error) => setErr(e.message))
  }
  const valider = () =>
    cible &&
    modifier.mutate({ dim, id: cible.id, libelle: libelle.trim() }, { onSuccess: fermer, onError: (e) => setErr(e.message) })

  return (
    <>
      <AdminNav />
      <h2>Référentiels</h2>
      <nav aria-label="Dimension" className="sous-nav">
        {DIMS.map((d) => (
          <button
            key={d.dim}
            type="button"
            className={`bouton ${dim === d.dim ? 'bouton-primaire' : 'bouton-secondaire'}`}
            aria-pressed={dim === d.dim}
            onClick={() => {
              setDim(d.dim)
              fermer()
            }}
          >
            {d.label}
          </button>
        ))}
      </nav>
      {q.isLoading && <Etat type="chargement" />}
      {q.isError && <Etat type="erreur" onRetry={() => q.refetch()} />}
      {q.data && (
        <Carte>
          <table className="dense">
            <thead>
              <tr>
                <th>Libellé</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {q.data.valeurs.map((v) => (
                <tr key={v.id}>
                  <td>{v.libelle}</td>
                  <td>
                    <Badge ton={v.actif ? 'succes' : 'neutre'}>{v.actif ? 'Actif' : 'Inactif'}</Badge>
                  </td>
                  <td>
                    <Bouton variante="lien" onClick={() => ouvrir(v.id, v.libelle)}>
                      Renommer
                    </Bouton>
                    <Bouton variante="lien" onClick={() => modifier.mutate({ dim, id: v.id, actif: !v.actif })}>
                      {v.actif ? 'Désactiver' : 'Réactiver'}
                    </Bouton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Carte>
      )}
      <Confirmer
        ouvert={!!cible}
        titre="Renommer la valeur"
        confirmer="Renommer"
        desactive={!libelle.trim() || libelle.trim() === cible?.ancien || !!err || modifier.isPending}
        onConfirmer={valider}
        onAnnuler={fermer}
      >
        <Champ label="Nouveau libellé" erreur={err}>
          {(p) => <input {...p} value={libelle} onChange={(e) => verifier(e.target.value)} />}
        </Champ>
        {nb !== null && (
          <p className="note">
            {nb} périmètre{nb > 1 ? 's' : ''} mis à jour. L’ancien libellé « {cible?.ancien} » reste reconnu à l’import.
          </p>
        )}
      </Confirmer>
    </>
  )
}
