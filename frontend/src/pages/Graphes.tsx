import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getAnnuel, getMensuel } from '../api/rapports'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import { useFiltres } from '../hooks/useFiltres'
import { fcfa, MOIS } from '../lib/format'

const COULEUR = '#1a1f3c'

function Carte({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <figure className="graphe">
      <figcaption>{titre}</figcaption>
      <div style={{ height: 260 }}>
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
    mois: MOIS[m.mois - 1].slice(0, 3),
    ms: m.ms === null ? null : Number(m.ms),
    effectif: m.effectif,
    absences: m.absences === null ? null : Number(m.absences),
  }))
  const contrats = men.data?.d_contrat.effectifs.map((c) => ({ contrat: c.contrat, effectif: Number(c.m) }))

  return (
    <section>
      <h2>Graphes</h2>
      {f.filtres && (
        <FiltresPeriode filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} onChange={f.set} />
      )}
      {f.vide && <Etat type="vide" />}
      {(ann.isLoading || men.isLoading) && <Etat type="chargement" />}
      {erreur && <Etat type={etatErreur(erreur)} />}
      <div className="graphes">
        {serie && (
          <>
            <Carte titre="Masse salariale mensuelle (FCFA)">
              <LineChart data={serie}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mois" />
                <YAxis domain={['dataMin * 0.98', 'dataMax * 1.02']} tickFormatter={(v) => fcfa(v)} width={90} />
                <Tooltip formatter={(v) => fcfa(Number(v))} />
                <Line dataKey="ms" name="Masse salariale" stroke={COULEUR} strokeWidth={2} connectNulls={false} />
              </LineChart>
            </Carte>
            <Carte titre="Effectif">
              <BarChart data={serie}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mois" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="effectif" name="Effectif" fill={COULEUR} />
              </BarChart>
            </Carte>
            <Carte titre="Absences (jours)">
              <BarChart data={serie}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mois" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="absences" name="Absences" fill={COULEUR} />
              </BarChart>
            </Carte>
          </>
        )}
        {contrats && (
          <Carte titre="Effectif par type de contrat">
            <BarChart data={contrats}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="contrat" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="effectif" name="Effectif" fill={COULEUR} />
            </BarChart>
          </Carte>
        )}
      </div>
    </section>
  )
}
