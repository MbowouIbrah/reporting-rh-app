import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAudit, type EvenementAudit } from '../../api/admin'
import { Bouton, Carte, Champ } from '../../components/Kit'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'

const ENTITES = [
  'utilisateur',
  'perimetre',
  'periode',
  'rubrique',
  'rubrique_regle',
  'parametre',
  'ref_alias',
  'lot_import',
  'salarie',
]
const PAS = 100
const MAX = 500

const texte = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Champs qui diffèrent entre l'état avant et l'état après. */
function diff(e: EvenementAudit) {
  const avant = e.avant ?? {}
  const apres = e.apres ?? {}
  return [...new Set([...Object.keys(avant), ...Object.keys(apres)])]
    .filter((k) => JSON.stringify(avant[k]) !== JSON.stringify(apres[k]))
    .map((k) => ({ champ: k, avant: avant[k], apres: apres[k] }))
}

function Detail({ e }: { e: EvenementAudit }) {
  const lignes = diff(e)
  if (lignes.length === 0) return <p className="note">Aucun détail.</p>
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Champ</th>
          <th scope="col">Avant</th>
          <th scope="col">Après</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.champ}>
            <th scope="row">{l.champ}</th>
            <td>{l.avant === undefined ? '—' : texte(l.avant)}</td>
            <td>{l.apres === undefined ? '—' : texte(l.apres)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function Journal() {
  const [params, setParams] = useSearchParams()
  const entite = params.get('entite') ?? ''
  const entiteId = params.get('entite_id') ?? ''
  const [limit, setLimit] = useState(PAS)
  const [ouvert, setOuvert] = useState<number | null>(null)
  const q = useAudit({ entite, entite_id: entiteId, limit })

  const maj = (cle: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(cle, v)
    else next.delete(cle)
    setParams(next, { replace: true })
    setLimit(PAS)
  }

  return (
    <>
      <AdminNav />
      <h2>Journal d’audit</h2>
      <Carte titre="Filtres" >
        <Champ label="Entité">
          {(p) => (
            <select {...p} value={entite} onChange={(e) => maj('entite', e.target.value)}>
              <option value="">Toutes</option>
              {ENTITES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )}
        </Champ>
        <Champ label="Identifiant">
          {(p) => <input {...p} value={entiteId} onChange={(e) => maj('entite_id', e.target.value.trim())} />}
        </Champ>
      </Carte>
      {q.isLoading && <Etat type="chargement" />}
      {q.isError && <Etat type="erreur" onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <p className="note">Aucun événement.</p>}
      {q.data && q.data.length > 0 && (
        <div className="journal-defilant">
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Utilisateur</th>
              <th scope="col">Action</th>
              <th scope="col">Entité</th>
              <th scope="col">Détail</th>
            </tr>
          </thead>
          <tbody>
            {q.data.flatMap((e) => [
              <tr key={e.id}>
                <td>{new Date(e.ts).toLocaleString('fr-FR')}</td>
                <td>{e.utilisateur_id ?? '—'}</td>
                <td>{e.action}</td>
                <td>
                  {e.entite} {e.entite_id ?? ''}{' '}
                  {e.entite_id && (
                    <Bouton
                      variante="lien"
                      onClick={() => {
                        setParams({ entite: e.entite, entite_id: e.entite_id! }, { replace: true })
                        setLimit(PAS)
                      }}
                    >
                      Historique
                    </Bouton>
                  )}
                </td>
                <td>
                  <Bouton
                    variante="lien"
                    aria-expanded={ouvert === e.id}
                    onClick={() => setOuvert(ouvert === e.id ? null : e.id)}
                  >
                    {ouvert === e.id ? 'Masquer' : 'Voir'}
                  </Bouton>
                </td>
              </tr>,
              ouvert === e.id && (
                <tr key={`${e.id}-d`}>
                  <td colSpan={5}>
                    <Detail e={e} />
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
        </div>
      )}
      {q.data && q.data.length >= limit && limit < MAX && (
        <Bouton variante="secondaire" onClick={() => setLimit(limit + PAS)}>
          Afficher plus
        </Bouton>
      )}
    </>
  )
}
