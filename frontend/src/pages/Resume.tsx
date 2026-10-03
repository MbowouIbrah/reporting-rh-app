import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getAnnuel } from '../api/rapports'
import type { Val } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import { Variation } from '../components/Tuile'
import { useFiltres } from '../hooks/useFiltres'
import { cls, fcfa, MOIS, pct } from '../lib/format'

function Case({ titre, valeur, note, children }: { titre: string; valeur: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="tuile case">
      <span className="micro">{titre}</span>
      <strong>
        {valeur}
        {valeur !== '—' && <span className="devise"> FCFA</span>}
      </strong>
      {children}
      {note && <span className="note">{note}</span>}
    </div>
  )
}

/** Somme de montants décimaux (3 décimales) en entiers, sans flottant. null si aucune valeur. */
function somme(valeurs: Val[]): string | null {
  let total = 0n
  let n = 0
  for (const v of valeurs) {
    if (v === null || v === 'n/a') continue
    const [e, d = ''] = v.split('.')
    const neg = e.startsWith('-')
    const milli = BigInt(e.replace('-', '') || '0') * 1000n + BigInt(d.padEnd(3, '0').slice(0, 3))
    total += neg ? -milli : milli
    n += 1
  }
  if (n === 0) return null
  const abs = total < 0n ? -total : total
  return `${total < 0n ? '-' : ''}${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`
}

export default function Resume() {
  const f = useFiltres()
  // Résumé annuel : cumul de l'année jusqu'au dernier mois saisi ; service/site ne s'appliquent pas (CA global).
  const base = f.filtres && { annee: f.filtres.annee, mois: f.filtres.mois }
  const ann = useQuery({ queryKey: ['annuel', base], queryFn: () => getAnnuel(base!), enabled: !!base })
  const erreur = ann.error
  const a = ann.data
  const aCa = a !== undefined && a.serie_n.length > 0 && 'ca' in a.serie_n[0]
  const montrer = (v: Val | undefined) => (v === undefined || v === null ? '—' : fcfa(v))
  const ca = a && somme(a.serie_n.map((l) => l.ca ?? null))
  const tauxMarge = ca && a?.marge_ytd != null && a.marge_ytd !== 'n/a' && Number(ca) !== 0 ? Number(a.marge_ytd) / Number(ca) : null

  return (
    <section className="page-ecran page-etroite resume-excel">
      <h2 className="bandeau-titre">RÉSUMÉ — Indicateurs de pilotage</h2>
      {f.filtres && (
        <div className="filtre-annee">
          <label className="selecteur-annee">
            <span className="filtre-annee-label">Année</span>
            <select value={f.filtres.annee} onChange={(e) => f.set({ annee: e.target.value, mois: undefined })}>
              {f.annees.map((an) => (
                <option key={an}>{an}</option>
              ))}
            </select>
          </label>
          <em className="comparaison">Comparé à la même période de {f.filtres.annee - 1}</em>
        </div>
      )}
      {f.vide && <Etat type="vide" />}
      {ann.isLoading && <Etat type="chargement" />}
      {erreur && <Etat type={etatErreur(erreur)} />}
      {a && (
        <>
          {aCa && (
            <div className="cases">
              <Case titre="CHIFFRE D’AFFAIRES" valeur={montrer(ca)} note="à saisir dans le suivi mensuel" />
              <Case titre="MARGE" valeur={montrer(a.marge_ytd)} note="à saisir dans le suivi mensuel" />
              <Case titre="TAUX DE MARGE" valeur={tauxMarge === null ? '—' : pct(String(tauxMarge))} note="calculé : marge / CA" />
              <Case titre="MOYENNE MENSUELLE" valeur={montrer(a.moyenne_mensuelle.m)} note="masse salariale" />
            </div>
          )}
          <div className="cases">
            <Case titre="MASSE SALARIALE" valeur={fcfa(a.cumul_ytd.m)}>
              <Variation v={a.cumul_ytd.var_pct} vs="vs N-1" />
            </Case>
            <Case titre="COMMISSIONS" valeur={montrer(somme(a.serie_n.map((l) => l.commissions)))} note="cumul de l’année" />
            <Case titre="PRIMES PRODUCTIVITÉ" valeur={montrer(somme(a.serie_n.map((l) => l.primes)))} note="cumul de l’année" />
            <Case titre="MASSE SALARIALE N-1" valeur={montrer(a.cumul_ytd.m1)} note="même période" />
          </div>
          {aCa && (
            <p className="regle">
              Règle : CA et Marge sont saisis manuellement dans le tableau ci-dessous. Tant qu’ils ne le sont pas, les
              tuiles restent vides.
            </p>
          )}
        </>
      )}
      {a && (
        <>
          <h3 className="bandeau-titre">SUIVI MENSUEL</h3>
          <div className="table-scroll">
            <table className="dense suivi">
              <thead>
                <tr>
                  <th scope="col">MOIS</th>
                  {aCa && <th scope="col">CA</th>}
                  <th scope="col">MASSE SALARIALE</th>
                  {aCa && <th scope="col">MARGE</th>}
                  {aCa && <th scope="col">% MARGE</th>}
                  <th scope="col">COMMISSIONS</th>
                  <th scope="col">PRIMES PROD.</th>
                </tr>
              </thead>
              <tbody>
                {a.serie_n.map((l) => (
                  <tr key={l.mois}>
                    <th scope="row">{MOIS[l.mois - 1]}</th>
                    {aCa && <td className="num saisi">{montrer(l.ca)}</td>}
                    <td className="num">{fcfa(l.ms)}</td>
                    {aCa && <td className={`${cls(l.marge)} saisi`}>{montrer(l.marge)}</td>}
                    {aCa && <td className={cls(l.taux_marge)}>{l.taux_marge == null ? '—' : pct(l.taux_marge)}</td>}
                    <td className="num">{fcfa(l.commissions)}</td>
                    <td className="num">{fcfa(l.primes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
