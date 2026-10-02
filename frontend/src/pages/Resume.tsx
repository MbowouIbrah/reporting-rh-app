import { useQuery } from '@tanstack/react-query'
import { getAnnuel, getMensuel } from '../api/rapports'
import type { Cell, Val } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import { useFiltres } from '../hooks/useFiltres'
import { cls, fcfa, isNeg, MOIS, pct } from '../lib/format'

function Tuile({ titre, valeur, cell }: { titre: string; valeur: string; cell?: Cell }) {
  const v = cell?.var_pct
  const fleche = v == null || v === 'n/a' ? '' : isNeg(v) ? '▼' : '▲'
  return (
    <div className="tuile">
      <span className="micro">{titre}</span>
      <strong>{valeur}</strong>
      {cell && (
        <span className={cls(v)}>
          {fleche} {pct(v)} vs M-1
        </span>
      )}
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

  return (
    <section>
      <h2>Résumé</h2>
      {f.filtres && <FiltresPeriode filtres={f.filtres} annees={f.annees} onChange={f.set} />}
      {f.vide && <Etat type="vide" />}
      {(men.isLoading || ann.isLoading) && <Etat type="chargement" />}
      {erreur && <Etat type={etatErreur(erreur)} />}
      {s && f.filtres && (
        <>
          <p className="micro">
            {MOIS[f.filtres.mois - 1]} {f.filtres.annee}
          </p>
          <div className="tuiles">
            {aCa && <Tuile titre="Chiffre d’affaires" valeur={montrer(s.ca)} />}
            {aCa && <Tuile titre="Marge" valeur={montrer(s.marge)} />}
            {aCa && <Tuile titre="Taux de marge" valeur={s.taux_marge == null ? '—' : pct(s.taux_marge)} />}
            <Tuile titre="Masse salariale" valeur={fcfa(s.ms.m)} cell={s.ms} />
            <Tuile titre="Commissions" valeur={fcfa(s.commissions.m)} cell={s.commissions} />
            <Tuile titre="Primes productivité" valeur={fcfa(s.primes_total.m)} cell={s.primes_total} />
          </div>
        </>
      )}
      {ann.data && (
        <table className="dense">
          <thead>
            <tr>
              <th scope="col">Mois</th>
              {aCa && <th scope="col">CA</th>}
              <th scope="col">Masse salariale</th>
              {aCa && <th scope="col">Marge</th>}
              {aCa && <th scope="col">% Marge</th>}
              <th scope="col">Commissions</th>
              <th scope="col">Primes prod.</th>
            </tr>
          </thead>
          <tbody>
            {ann.data.serie_n.map((m) => (
              <tr key={m.mois}>
                <th scope="row">{MOIS[m.mois - 1]}</th>
                {aCa && <td className="num">{montrer(m.ca)}</td>}
                <td className="num">{fcfa(m.ms)}</td>
                {aCa && <td className={cls(m.marge)}>{montrer(m.marge)}</td>}
                {aCa && <td className={cls(m.taux_marge)}>{m.taux_marge == null ? '—' : pct(m.taux_marge)}</td>}
                <td className="num">{fcfa(m.commissions)}</td>
                <td className="num">{fcfa(m.primes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
