import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { getAnnuel, getMensuel } from '../api/rapports'
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

export default function Resume() {
  const f = useFiltres()
  // Résumé : périmètre global du mois ; service/site ne s'appliquent pas (CA global).
  const base = f.filtres && { annee: f.filtres.annee, mois: f.filtres.mois }
  const men = useQuery({ queryKey: ['mensuel', base], queryFn: () => getMensuel(base!), enabled: !!base })
  const ann = useQuery({ queryKey: ['annuel', base], queryFn: () => getAnnuel(base!), enabled: !!base })
  const erreur = men.error ?? ann.error
  const s = men.data?.synthese
  const aCa = s !== undefined && 'ca' in s
  const montrer = (v: Val | undefined) => (v === undefined || v === null ? '—' : fcfa(v))
  const m = f.filtres?.mois ?? 1
  const precedent = f.filtres ? `${MOIS[(m + 10) % 12]} ${m === 1 ? f.filtres.annee - 1 : f.filtres.annee}` : ''

  return (
    <section className="page-ecran page-etroite resume-excel">
      <h2 className="bandeau-titre">RÉSUMÉ — Indicateurs de pilotage</h2>
      {f.filtres && (
        <div className="periode" role="group" aria-label="Filtres">
          <span className="periode-label">PÉRIODE</span>
          <select aria-label="Mois" value={f.filtres.mois} onChange={(e) => f.set({ mois: e.target.value })}>
            {MOIS.map((nom, i) => (
              <option key={nom} value={i + 1}>
                {nom}
              </option>
            ))}
          </select>
          <select aria-label="Année" value={f.filtres.annee} onChange={(e) => f.set({ annee: e.target.value, mois: undefined })}>
            {f.annees.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <em className="comparaison">Comparaison : {precedent}</em>
        </div>
      )}
      {f.vide && <Etat type="vide" />}
      {(men.isLoading || ann.isLoading) && <Etat type="chargement" />}
      {erreur && <Etat type={etatErreur(erreur)} />}
      {s && f.filtres && (
        <>
          {aCa && (
            <div className="cases">
              <Case titre="CHIFFRE D’AFFAIRES" valeur={montrer(s.ca)} note="à saisir dans le suivi mensuel" />
              <Case titre="MARGE" valeur={montrer(s.marge)} note="à saisir dans le suivi mensuel" />
              <Case titre="TAUX DE MARGE" valeur={s.taux_marge == null ? '—' : pct(s.taux_marge)} note="calculé : marge / CA" />
              <Case titre="RÉMUNÉRATION GLOBALE" valeur={montrer(s.remuneration_globale)} note="charges + postes exclus" />
            </div>
          )}
          <div className="cases">
            <Case titre="MASSE SALARIALE" valeur={fcfa(s.ms.m)}>
              <Variation v={s.ms.var_pct} />
            </Case>
            <Case titre="COMMISSIONS" valeur={fcfa(s.commissions.m)}>
              <Variation v={s.commissions.var_pct} />
            </Case>
            <Case titre="PRIMES PRODUCTIVITÉ" valeur={fcfa(s.primes_total.m)} note="3 colonnes à alimenter" />
            <Case titre="EXCLUS DU TOTAL" valeur={montrer(s.exclus)} note="brut garanti, primes" />
          </div>
          {aCa && (
            <p className="regle">
              Règle : CA et Marge sont saisis manuellement dans le tableau ci-dessous. Tant qu’ils ne le sont pas, les
              tuiles restent vides.
            </p>
          )}
        </>
      )}
      {ann.data && (
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
                {ann.data.serie_n.map((l) => (
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
