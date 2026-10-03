import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getAnnuel, getMensuel } from '../api/rapports'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import { useFiltres } from '../hooks/useFiltres'
import { fcfa, MOIS_COURTS } from '../lib/format'

const C1 = '#3b5bdb'
const C2 = '#0c8599'
const C3 = '#e8590c'
const GRILLE = '#e7e7ea'
const AXE = { tickLine: false, axisLine: false, tick: { fill: '#6b6f82', fontSize: 12 } }

function Carte({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <figure className="graphe">
      <figcaption>{titre}</figcaption>
      <div className="graphe-zone">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

export default function Graphes() {
  const f = useFiltres()
  const ann = useQuery({ queryKey: ['annuel', f.filtres], queryFn: () => getAnnuel(f.filtres!), enabled: !!f.filtres })
  const men = useQuery({ queryKey: ['mensuel', f.filtres], queryFn: () => getMensuel(f.filtres!), enabled: !!f.filtres })
  const erreur = ann.error ?? men.error

  const serie = ann.data?.serie_n.map((m) => ({
    mois: MOIS_COURTS[m.mois - 1],
    ms: m.ms === null ? null : Number(m.ms),
    effectif: m.effectif,
    absences: m.absences === null ? null : Number(m.absences),
  }))
  const contrats = men.data?.d_contrat.effectifs.map((c) => ({ contrat: c.contrat, effectif: Number(c.m) }))

  return (
    <section className="page-ecran page-etroite rapport-excel graphes-excel">
      <h2 className="bandeau-titre">GRAPHES — Évolution sur l’année</h2>
      {f.filtres && (
        <FiltresPeriode avecMois={false} filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} onChange={f.set} />
      )}
      {f.vide && <Etat type="vide" />}
      {(ann.isLoading || men.isLoading) && <Etat type="chargement" />}
      {erreur && <Etat type={etatErreur(erreur)} />}
      <div className="graphes">
        {serie && (
          <>
            <Carte titre="Masse salariale mensuelle (FCFA)">
              <LineChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis dataKey="mois" interval={0} padding={{ left: 12, right: 16 }} {...AXE} />
                <YAxis domain={[0, 'auto']} tickFormatter={(v) => fcfa(v)} width={90} {...AXE} />
                <Tooltip formatter={(v) => fcfa(Number(v))} />
                <Line dataKey="ms" name="Masse salariale" stroke={C1} strokeWidth={2} connectNulls={false} />
              </LineChart>
            </Carte>
            <Carte titre="Effectif">
              <BarChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis dataKey="mois" interval={0} padding={{ left: 12, right: 16 }} {...AXE} />
                <YAxis allowDecimals={false} {...AXE} />
                <Tooltip />
                <Bar dataKey="effectif" name="Effectif" fill={C2} radius={[3, 3, 0, 0]} />
              </BarChart>
            </Carte>
            <Carte titre="Absences (jours)">
              <BarChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis dataKey="mois" interval={0} padding={{ left: 12, right: 16 }} {...AXE} />
                <YAxis {...AXE} />
                <Tooltip />
                <Bar dataKey="absences" name="Absences" fill={C3} radius={[3, 3, 0, 0]} />
              </BarChart>
            </Carte>
          </>
        )}
        {contrats && (
          <Carte titre="Effectif par type de contrat">
            <BarChart data={contrats}>
              <CartesianGrid stroke={GRILLE} vertical={false} />
              <XAxis dataKey="contrat" {...AXE} />
              <YAxis allowDecimals={false} {...AXE} />
              <Tooltip />
              <Bar dataKey="effectif" name="Effectif" fill={C1} radius={[3, 3, 0, 0]} />
            </BarChart>
          </Carte>
        )}
      </div>
      {serie && (
        <details className="section details-donnees">
          <summary>
            <span className="section-titre">Voir les données en tableau</span>
          </summary>
          <div className="section-corps">
            <div className="table-scroll">
              <table className="dense">
                <thead>
                  <tr>
                    <th scope="col">Mois</th>
                    <th scope="col">Masse salariale</th>
                    <th scope="col">Effectif</th>
                    <th scope="col">Absences (jours)</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.map((m) => (
                    <tr key={m.mois}>
                      <th scope="row">{m.mois}</th>
                      <td className="num">{fcfa(m.ms)}</td>
                      <td className="num">{m.effectif ?? '—'}</td>
                      <td className="num">{fcfa(m.absences)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}
    </section>
  )
}
