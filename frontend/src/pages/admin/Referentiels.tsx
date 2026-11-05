import { useEffect, useId, useState, type FormEvent } from 'react'
import {
  apercuRenommage,
  TYPES_SITE,
  useCreerRef,
  useModifierRef,
  useReferentiel,
  type DimensionRef,
  type ValeurRef,
} from '../../api/admin'
import AdminNav from '../../components/AdminNav'
import { Panneau } from '../../components/BlocsRapport'
import Etat, { etatErreur } from '../../components/Etat'
import { LIBELLE_TYPE_SITE } from '../../components/FiltresPeriode'
import { Bouton, Champ } from '../../components/Kit'
import Colonnes from './Colonnes'

interface Renommage {
  id: number
  ancien: string
  libelle: string
}
// « 2 périmètres et 1 compte mis à jour. » : les comptes qui voient ce service ou ce site suivent le renommage.
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`
const majs = (perimetres: number, comptes: number) =>
  `${[perimetres || !comptes ? pluriel(perimetres, 'périmètre') : '', comptes ? pluriel(comptes, 'compte') : ''].filter(Boolean).join(' et ')} mis à jour.`

interface Apercu {
  pour: string
  nb: number | null
  comptes: number
  erreur: string | null
}

function Bloc({ dim, titre, singulier }: { dim: DimensionRef; titre: string; singulier: string }) {
  const sites = dim === 'site'
  const q = useReferentiel(dim)
  const modifier = useModifierRef()
  const creer = useCreerRef()
  const [renommage, setRenommage] = useState<Renommage | null>(null)
  const [apercu, setApercu] = useState<Apercu | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [libelle, setLibelle] = useState('')
  const [typeSite, setTypeSite] = useState('principal')
  const [erreurLibelle, setErreurLibelle] = useState<string | null>(null)
  const [erreurAjout, setErreurAjout] = useState<string | null>(null)
  const idNote = useId()

  // Aperçu du renommage (périmètres touchés, conflits) avant toute écriture ; le résultat d'un ancien libellé est ignoré.
  const saisi = renommage?.libelle.trim() ?? ''
  const aApercevoir = !!renommage && !!saisi && saisi !== renommage.ancien
  const idRenommage = renommage?.id
  useEffect(() => {
    if (idRenommage === undefined || !aApercevoir) return
    let perime = false
    const delai = setTimeout(() => {
      apercuRenommage(dim, idRenommage, saisi).then(
        (r) => !perime && setApercu({ pour: saisi, nb: r.perimetres_maj, comptes: r.comptes_maj, erreur: null }),
        (e: Error) => !perime && setApercu({ pour: saisi, nb: null, comptes: 0, erreur: e.message }),
      )
    }, 250)
    return () => {
      perime = true
      clearTimeout(delai)
    }
  }, [dim, idRenommage, aApercevoir, saisi])
  const courant = aApercevoir && apercu?.pour === saisi ? apercu : null

  const surErreur = (e: Error) => setErreur(e.message)
  const valider = (e: FormEvent) => {
    e.preventDefault()
    if (!renommage || !courant || courant.erreur) return
    setErreur(null)
    modifier.mutate({ dim, id: renommage.id, libelle: saisi }, { onSuccess: () => setRenommage(null), onError: surErreur })
  }
  const ajouter = (e: FormEvent) => {
    e.preventDefault()
    setErreurAjout(null)
    if (!libelle.trim()) return setErreurLibelle('Libellé obligatoire')
    setErreurLibelle(null)
    creer.mutate(
      { dim, libelle: libelle.trim(), ...(sites ? { type_site: typeSite } : {}) },
      { onSuccess: () => setLibelle(''), onError: (x) => setErreurAjout(x.message) },
    )
  }
  const changer = (v: ValeurRef, b: { actif?: boolean; type_site?: string; productif?: boolean }) => {
    setErreur(null)
    modifier.mutate({ dim, id: v.id, ...b }, { onError: surErreur })
  }

  const colonnes = sites ? ['Libellé', 'Type de site', 'Statut', 'Actions'] : ['Libellé', 'Productif', 'Statut', 'Actions']
  if (q.isLoading) return <Etat type="chargement" colonnes={colonnes} lignes={4} />
  if (q.isError) return <Etat type={etatErreur(q.error)} onRetry={() => q.refetch()} />
  const valeurs = q.data?.valeurs ?? []

  return (
    <Panneau titre={titre}>
      <form className="admin-form" aria-label={`Ajouter un ${singulier}`} onSubmit={ajouter} noValidate>
        <Champ label={`Nouveau ${singulier}`} erreur={erreurLibelle}>
          {(p) => <input {...p} value={libelle} onChange={(e) => setLibelle(e.target.value)} />}
        </Champ>
        {sites && (
          <Champ label="Type de site">
            {(p) => (
              <select {...p} value={typeSite} onChange={(e) => setTypeSite(e.target.value)}>
                {TYPES_SITE.map((t) => <option key={t} value={t}>{LIBELLE_TYPE_SITE[t]}</option>)}
              </select>
            )}
          </Champ>
        )}
        <div className="admin-actions en-ligne">
          <button type="submit" className="bouton bouton-primaire" disabled={creer.isPending}>Ajouter</button>
        </div>
        {erreurAjout && <p className="champ-erreur admin-erreur" role="alert">{erreurAjout}</p>}
      </form>
      {erreur && <p className="champ-erreur admin-erreur admin-erreur-bloc" role="alert">{erreur}</p>}
      {valeurs.length === 0 ? (
        <Etat type="vide" titre={`Aucun ${singulier}`} aide="" />
      ) : (
        <table className="dense">
          <thead>
            <tr>{colonnes.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
          </thead>
          <tbody>
            {valeurs.map((v) => (
              <tr key={v.id}>
                <th scope="row">
                  {renommage?.id === v.id ? (
                    <form className="renommer" onSubmit={valider} noValidate>
                      <input
                        aria-label={`Nouveau libellé de ${v.libelle}`}
                        aria-invalid={!!courant?.erreur}
                        aria-describedby={idNote}
                        value={renommage.libelle}
                        onChange={(e) => setRenommage({ ...renommage, libelle: e.target.value })}
                      />
                      <button type="submit" className="bouton bouton-primaire" disabled={!courant || !!courant.erreur || modifier.isPending}>Renommer</button>
                      <Bouton variante="secondaire" disabled={modifier.isPending} onClick={() => setRenommage(null)}>Annuler</Bouton>
                      <p id={idNote} className={courant?.erreur ? 'champ-erreur' : 'note'} role={courant?.erreur ? 'alert' : 'status'}>
                        {courant?.erreur ??
                          (courant && courant.nb !== null
                            ? `${majs(courant.nb, courant.comptes)} L’ancien libellé « ${renommage.ancien} » reste reconnu à l’import.`
                            : '')}
                      </p>
                    </form>
                  ) : (
                    v.libelle
                  )}
                </th>
                {sites && (
                  <td>
                    <select
                      aria-label={`Type de site de ${v.libelle}`}
                      value={v.type_site ?? 'principal'}
                      disabled={modifier.isPending}
                      onChange={(e) => changer(v, { type_site: e.target.value })}
                    >
                      {TYPES_SITE.map((t) => <option key={t} value={t}>{LIBELLE_TYPE_SITE[t]}</option>)}
                    </select>
                  </td>
                )}
                {!sites && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Productif : ${v.libelle}`}
                      checked={!!v.productif}
                      disabled={modifier.isPending}
                      onChange={(e) => changer(v, { productif: e.target.checked })}
                    />
                  </td>
                )}
                <td><span className={v.actif ? 'statut statut-ok' : 'statut'}>{v.actif ? 'Actif' : 'Inactif'}</span></td>
                <td className="actions">
                  <Bouton
                    variante="lien"
                    aria-label={`Renommer ${v.libelle}`}
                    onClick={() => {
                      setErreur(null)
                      setRenommage({ id: v.id, ancien: v.libelle, libelle: v.libelle })
                    }}
                  >
                    Renommer
                  </Bouton>
                  <Bouton variante="lien" aria-label={`${v.actif ? 'Désactiver' : 'Réactiver'} ${v.libelle}`} disabled={modifier.isPending} onClick={() => changer(v, { actif: !v.actif })}>
                    {v.actif ? 'Désactiver' : 'Réactiver'}
                  </Bouton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panneau>
  )
}

// Liste fixe : les types de contrat ne se créent pas dans l'application (référentiel initial).
const CONTRATS: [string, string][] = [
  ['CDI', 'Contrat à durée indéterminée'],
  ['CDD', 'Contrat à durée déterminée'],
  ['MAD', 'Mise à disposition'],
  ['Stage', 'Convention de stage'],
]

function TypesContrat() {
  return (
    <Panneau titre="Types de contrat" className="ref-contrats">
      <p className="note">Liste fixe, non modifiable.</p>
      <table className="dense">
        <thead>
          <tr><th scope="col">Code</th><th scope="col">Libellé</th></tr>
        </thead>
        <tbody>
          {CONTRATS.map(([code, libelle]) => (
            <tr key={code}><th scope="row">{code}</th><td>{libelle}</td></tr>
          ))}
        </tbody>
      </table>
    </Panneau>
  )
}

export default function Referentiels() {
  return (
    <section className="page-ecran rapport-excel admin-excel">
      <AdminNav />
      <div className="admin-duo admin-trio">
        <Bloc dim="site" titre="Sites" singulier="site" />
        <Bloc dim="service" titre="Services" singulier="service" />
        <TypesContrat />
      </div>
      <Colonnes />
    </section>
  )
}
