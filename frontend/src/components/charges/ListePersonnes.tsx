import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type FiltresPage, getChargesPersonnes } from '../../api/rapports'
import type { AxeCharge, ChargesPersonne } from '../../api/types'
import { contextePersonne, csvPersonnes, ent, mt, num, partR, pcServeur, sansAccent, signeEnt } from '../../lib/charges'
import { matriculeAffiche } from '../../lib/format'
import { CVar } from './Cellules'

interface Props {
  /** Ligne parente : libellé (la part de chaque personne est donnée par le serveur). */
  nom: string
  /** Nombre de colonnes du tableau. */
  nc: number
  /** Axe Effectifs : colonnes d'effectif au lieu des montants. */
  eff: boolean
  axe: AxeCharge
  valeur: string
  ligneActivite?: string
  filtres: FiltresPage
}

const PAR_PAGE = [10, 25, 50, 100]

const Loupe = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

function telecharger(lignes: ChargesPersonne[], nom: string) {
  if (typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(new Blob([csvPersonnes(lignes)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${nom.replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Personnes d'une ligne, sous cette ligne : barre de recherche, une ligne par personne, pagination. */
export default function ListePersonnes({ nom, nc, eff, axe, valeur, ligneActivite, filtres }: Props) {
  const [cherche, setCherche] = useState('')
  const [page, setPage] = useState(0)
  const [parPage, setParPage] = useState(25)
  const q = useQuery({
    queryKey: ['charges-personnes', filtres, axe, valeur, ligneActivite ?? null],
    queryFn: () => getChargesPersonnes(filtres, axe, valeur, ligneActivite),
  })

  if (q.isLoading) {
    return (
      <tr className="pers" aria-busy="true">
        <td className="pers-vide" colSpan={nc}>Chargement…</td>
      </tr>
    )
  }
  if (q.error || !q.data) {
    return (
      <tr className="pers">
        <td className="pers-vide" colSpan={nc}>
          Les personnes n'ont pas pu être chargées.{' '}
          <button type="button" className="bouton bouton-secondaire petit" onClick={() => q.refetch()}>Réessayer</button>
        </td>
      </tr>
    )
  }

  const toutes = q.data
  const rech = sansAccent(cherche.trim())
  const ps = rech ? toutes.filter((p) => sansAccent(`${p.nom} ${p.matricule}`).includes(rech)) : toutes
  const pages = Math.max(1, Math.ceil(ps.length / parPage))
  const pg = Math.min(page, pages - 1)
  const a = pg * parPage
  const vus = ps.slice(a, a + parPage)
  const max = Math.max(...toutes.map((p) => num(p.m) ?? 0), 1)
  const part = (p: ChargesPersonne) => {
    const v = num(p.part)
    return v == null ? '—' : partR(v)
  }
  const rang = ps.length ? `${a + 1}–${a + vus.length} sur ${ent(ps.length)}` : `0 sur ${ent(toutes.length)}`
  const annonce = rech ? `${ent(ps.length)} personne${ps.length > 1 ? 's' : ''} trouvée${ps.length > 1 ? 's' : ''}` : rang

  return (
    <>
      <tr className="pers-barre">
        <td colSpan={nc}>
          <div className="barre-liste">
            <span className="liste-titre">
              <strong>{ent(toutes.length)} personne{toutes.length > 1 ? 's' : ''}</strong> · {nom}
            </span>
            {toutes.length >= 10 && (
              <span className="champ-loupe">
                <Loupe />
                <input
                  type="search"
                  id="cherche"
                  aria-label="Chercher une personne (nom ou matricule)"
                  placeholder="Chercher un nom ou un matricule"
                  autoComplete="off"
                  value={cherche}
                  onChange={(e) => { setCherche(e.target.value); setPage(0) }}
                />
              </span>
            )}
            {!eff && (
              <span className="legende-poids">
                <span className="poids" aria-hidden="true"><span style={{ width: '60%' }} /></span>
                Poids dans {nom}
              </span>
            )}
            <button type="button" className="bouton bouton-secondaire petit" id="exportListe" onClick={() => telecharger(toutes, nom)}>
              Exporter (Excel)
            </button>
          </div>
        </td>
      </tr>
      {vus.length ? (
        vus.map((p) => {
          const m = num(p.m) ?? 0
          const m1 = num(p.m1) ?? 0
          return (
            <tr className="pers" key={p.matricule}>
              <th scope="row" title={contextePersonne(p)}>
                <span className="pers-nom">{p.nom}</span>
                <span className="pers-mat">{matriculeAffiche(p.matricule)}</span>
              </th>
              {eff ? (
                <>
                  <td className="num">{m1 > 0 ? '1' : '—'}</td>
                  <td className="num">{m > 0 ? '1' : '—'}</td>
                  <td className="num">{signeEnt(p.entree ? 1 : p.sortie ? -1 : 0)}</td>
                  <td className="num">—</td>
                  <td className="num">{p.entree && <span className="etiq entree">Entrée</span>}</td>
                  <td className="num">{p.sortie && <span className="etiq sortie">Sortie</span>}</td>
                </>
              ) : (
                <>
                  <td className="num">{m1 ? mt(m1) : '—'}</td>
                  <td className="num">{mt(m)}</td>
                  <CVar n1={m1 || null} variation={num(p.var)} e={pcServeur(p.var_pct)} muet />
                  <td className="num">{part(p)}</td>
                  <td className="cel-poids" colSpan={2}>
                    <span className="poids" title={`Poids dans ${nom} : ${part(p)}`} aria-hidden="true">
                      <span style={{ width: `${((m / max) * 100).toFixed(1)}%` }} />
                    </span>
                    {p.entree ? <span className="etiq entree">Entrée</span> : p.sortie ? <span className="etiq sortie">Sortie</span> : null}
                  </td>
                </>
              )}
            </tr>
          )
        })
      ) : (
        <tr className="pers">
          <td className="pers-vide" colSpan={nc}>Aucune personne ne correspond à « {cherche} ».</td>
        </tr>
      )}
      <tr className="pers-pied">
        <td colSpan={nc}>
          <div className="pied-liste">
            <span>Consultation enregistrée (données nominatives).</span>
            {(pages > 1 || ps.length > 10) && (
              <div className="pagine">
                <span className="rang" aria-live="polite">{rang}</span>
                <button type="button" aria-label="Page précédente" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹</button>
                <button type="button" aria-label="Page suivante" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>›</button>
                <label htmlFor="parPage">
                  Par page{' '}
                  <select id="parPage" value={parPage} onChange={(e) => { setParPage(Number(e.target.value)); setPage(0) }}>
                    {PAR_PAGE.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
            )}
            <span className="sr-only" role="status">{annonce}</span>
          </div>
        </td>
      </tr>
    </>
  )
}
