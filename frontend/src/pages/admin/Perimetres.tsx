import { useState } from 'react'
import {
  useCreerPerimetre,
  useModifierPerimetre,
  usePerimetresAdmin,
  useReferentiel,
  useSupprimerPerimetre,
  type PerimetreAdmin,
  type Regle,
} from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import Etat from '../../components/Etat'
import { Bouton, Carte, Champ, Confirmer } from '../../components/Kit'

const cle = (r: Regle) => `${r.dimension}:${r.valeur}`

function Edition({ initial, onFini }: { initial?: PerimetreAdmin; onFini: () => void }) {
  const services = useReferentiel('service')
  const sites = useReferentiel('site')
  const creer = useCreerPerimetre()
  const modifier = useModifierPerimetre()
  const [code, setCode] = useState(initial?.code ?? '')
  const [libelle, setLibelle] = useState(initial?.libelle ?? '')
  const [regles, setRegles] = useState<Regle[]>(initial?.regles ?? [])
  const [err, setErr] = useState<string | null>(null)

  const bascule = (r: Regle) =>
    setRegles((cur) => (cur.some((x) => cle(x) === cle(r)) ? cur.filter((x) => cle(x) !== cle(r)) : [...cur, r]))
  const envoie = () => {
    const opts = { onSuccess: onFini, onError: (e: Error) => setErr(e.message) }
    if (initial) modifier.mutate({ id: initial.id, code, libelle, regles }, opts)
    else creer.mutate({ code, libelle, regles }, opts)
  }
  const liste = (dim: 'service' | 'site', vals?: { libelle: string }[]) => (
    <fieldset>
      <legend>{dim === 'service' ? 'Services' : 'Sites'}</legend>
      {vals?.map((v) => {
        const r: Regle = { dimension: dim, valeur: v.libelle }
        return (
          <label key={v.libelle} style={{ display: 'block' }}>
            <input type="checkbox" checked={regles.some((x) => cle(x) === cle(r))} onChange={() => bascule(r)} />{' '}
            {v.libelle}
          </label>
        )
      })}
    </fieldset>
  )

  return (
    <Carte titre={initial ? `Modifier ${initial.libelle}` : 'Nouveau périmètre'}>
      <Champ label="Code">{(p) => <input {...p} value={code} onChange={(e) => setCode(e.target.value)} />}</Champ>
      <Champ label="Libellé">
        {(p) => <input {...p} value={libelle} onChange={(e) => setLibelle(e.target.value)} />}
      </Champ>
      {liste('service', services.data?.valeurs)}
      {liste('site', sites.data?.valeurs)}
      {err && (
        <p className="champ-erreur" role="alert">
          {err}
        </p>
      )}
      <Bouton onClick={envoie} disabled={!code.trim() || !libelle.trim()}>
        Enregistrer
      </Bouton>
      {initial && (
        <Bouton variante="secondaire" onClick={onFini}>
          Annuler
        </Bouton>
      )}
    </Carte>
  )
}

export default function Perimetres() {
  const q = usePerimetresAdmin()
  const supprimer = useSupprimerPerimetre()
  const [edit, setEdit] = useState<PerimetreAdmin | null>(null)
  const [cible, setCible] = useState<PerimetreAdmin | null>(null)
  const [err, setErr] = useState<string | null>(null)

  if (q.isLoading) return <Etat type="chargement" />
  if (q.isError) return <Etat type="erreur" onRetry={() => q.refetch()} />

  return (
    <>
      <AdminNav />
      <h2>Périmètres</h2>
      {err && (
        <p className="champ-erreur" role="alert">
          {err}
        </p>
      )}
      <Carte>
        <table className="dense">
          <thead>
            <tr>
              <th>Code</th>
              <th>Libellé</th>
              <th>Règles</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.libelle}</td>
                <td>{p.regles.map((r) => r.valeur).join(', ') || '—'}</td>
                <td>
                  <Bouton variante="lien" onClick={() => setEdit(p)}>
                    Modifier
                  </Bouton>
                  <Bouton variante="lien" onClick={() => setCible(p)}>
                    Supprimer
                  </Bouton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Carte>
      <Edition key={edit?.id ?? 'new'} initial={edit ?? undefined} onFini={() => setEdit(null)} />
      <Confirmer
        ouvert={!!cible}
        titre="Supprimer le périmètre"
        confirmer="Supprimer"
        onAnnuler={() => setCible(null)}
        onConfirmer={() =>
          cible &&
          supprimer.mutate(cible.id, {
            onSuccess: () => {
              setCible(null)
              setErr(null)
            },
            onError: (e) => {
              setCible(null)
              setErr(e.message)
            },
          })
        }
      >
        <p>{cible?.libelle} sera supprimé.</p>
      </Confirmer>
    </>
  )
}
