import { useQuery } from '@tanstack/react-query'
import { getAnnuel } from '../api/rapports'
import type { Annuel as AnnuelData, Cell } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import LienExport from '../components/LienExport'
import { useFiltres } from '../hooks/useFiltres'
import { cls, entier, fcfa, MOIS, pct } from '../lib/format'

function Ligne({ label, c, note }: { label: string; c: Cell; note?: string }) {
  return (
    <tr>
      <th scope="row">
        {label}
        {note && <span className="note"> {note}</span>}
      </th>
      <td className="num">{fcfa(c.m1)}</td>
      <td className="num">{fcfa(c.m)}</td>
      <td className={cls(c.var)}>{fcfa(c.var)}</td>
      <td className={cls(c.var_pct)}>{pct(c.var_pct)}</td>
    </tr>
  )
}

function Contenu({ d, annee, mois }: { d: AnnuelData; annee: number; mois: number }) {
  return (
    <>
      <div className="table-scroll"><table className="dense">
        <thead>
          <tr>
            <th scope="col">Indicateur</th>
            <th scope="col">{annee - 1}</th>
            <th scope="col">{annee}</th>
            <th scope="col">Écart</th>
            <th scope="col">Écart %</th>
          </tr>
        </thead>
        <tbody>
          <Ligne label={`Cumul de janvier à ${MOIS[mois - 1].toLowerCase()}`} c={d.cumul_ytd} />
          <Ligne label="Moyenne mensuelle" c={d.moyenne_mensuelle} />
          <tr>
            <th scope="row">Cumul année complète</th>
            <td className="num">{fcfa(d.cumul_annee_n1)}</td>
            <td className="num">(en cours)</td>
            <td />
            <td />
          </tr>
          <tr>
            <th scope="row">Nb de mois saisis</th>
            <td className="num">{entier(d.cumul_ytd.nb_mois_n1)}</td>
            <td className="num">{entier(d.cumul_ytd.nb_mois)}</td>
            <td />
            <td />
          </tr>
          {d.marge_ytd !== undefined && (
            <tr>
              <th scope="row">
                Marge cumulée <span className="note">({entier(d.nb_mois_marge)} mois avec CA)</span>
              </th>
              <td />
              <td className={cls(d.marge_ytd)}>{fcfa(d.marge_ytd)}</td>
              <td />
              <td />
            </tr>
          )}
        </tbody>
      </table></div>

      <h3>Par service</h3>
      <div className="table-scroll"><table className="dense">
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Cumul {annee - 1}</th>
            <th scope="col">Cumul {annee}</th>
            <th scope="col">Moy./mois {annee - 1}</th>
            <th scope="col">Moy./mois {annee}</th>
            <th scope="col">Écart moy. %</th>
          </tr>
        </thead>
        <tbody>
          {d.par_service
            .filter((s) => Number(s.m ?? 0) !== 0 || Number(s.m1 ?? 0) !== 0)
            .map((s) => (
              <tr key={s.service}>
                <th scope="row">{s.service}</th>
                <td className="num">
                  {fcfa(s.m1)} <span className="note">({s.nb_mois_n1} m)</span>
                </td>
                <td className="num">
                  {fcfa(s.m)} <span className="note">({s.nb_mois} m)</span>
                </td>
                <td className="num">{fcfa(s.moy_m1)}</td>
                <td className="num">{fcfa(s.moy_m)}</td>
                <td className={cls(s.ecart_moy_pct)}>{pct(s.ecart_moy_pct)}</td>
              </tr>
            ))}
        </tbody>
      </table></div>
    </>
  )
}

export default function Annuel() {
  const f = useFiltres()
  const q = useQuery({
    queryKey: ['annuel', f.filtres],
    queryFn: () => getAnnuel(f.filtres!),
    enabled: !!f.filtres,
  })
  return (
    <section>
      <h2>Comparatif annuel</h2>
      {f.filtres && (
        <FiltresPeriode filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} onChange={f.set} />
      )}
      {q.data && f.filtres && <LienExport rapport="annuel" filtres={f.filtres} />}
      {f.vide && <Etat type="vide" />}
      {q.isLoading && <Etat type="chargement" />}
      {q.error && <Etat type={etatErreur(q.error)} />}
      {q.data && f.filtres && <Contenu d={q.data} annee={f.filtres.annee} mois={f.filtres.mois} />}
    </section>
  )
}
