import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getAnnuel } from '../api/rapports'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import { useFiltres } from '../hooks/useFiltres'
import { fcfa, MOIS_COURTS } from '../lib/format'

// Couleurs issues des tokens (styles/tokens.css) : recharts les passe en attributs SVG, qui acceptent var().
const C1 = 'var(--data-1)'
const C2 = 'var(--data-2)'
const C3 = 'var(--data-3)'
const GRILLE = 'var(--rule)'
const TITRES = ['Masse salariale mensuelle (FCFA)', 'Effectif', 'Absences (jours)', 'Effectif moyen par type de contrat']
const AXE ={ tickLine: false, axisLine: false, tick: { fill: 'var(--muted)', fontSize: 12 } }
// Transition courte d'une valeur à l'autre (1,5 s par défaut pour une courbe : trop lent au changement de filtre).
const ANIM = { animationDuration: 450, animationEasing: 'ease-out' } as const

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
  // Tout vient du rapport annuel : un mois sans données dans le périmètre n'efface pas les graphes
  const f = useFiltres({ avecMois: false })
  const ann = useQuery({
    queryKey: ['annuel', f.filtres],
    queryFn: () => getAnnuel(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const erreur = ann.error

  const serie = ann.data?.serie_n.map((m) => ({
    mois: MOIS_COURTS[m.mois - 1],
    ms: m.ms === null ? null : Number(m.ms),
    effectif: m.effectif,
    absences: m.absences === null ? null : Number(m.absences),
  }))
  // Effectif moyen mensuel sur les mois saisis, par nature de contrat (le dernier mois seul peut
  // être incomplet : une saisie en cours fausserait l'image de l'année)
  const contrats = ann.data?.d_contrat.effectifs
    .map((c) => ({ contrat: c.contrat, effectif: c.m === null ? 0 : Math.round(Number(c.m) * 10) / 10 }))
    .filter((c) => c.effectif > 0)

  return (
    // Squelette au premier chargement seulement ; à un changement de filtre, les graphes restent affichés
    // et glissent vers les nouvelles valeurs à leur arrivée.
    <section className="page-ecran page-etroite rapport-excel graphes-excel">
      <h2 className="bandeau-titre">GRAPHES D’ÉVOLUTION</h2>
      {f.filtres && (
        <FiltresPeriode avecMois={false} filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} partage={f.partage} onChange={f.set} />
      )}
      {f.vide && <Etat type="vide" />}
      {erreur && <Etat type={etatErreur(erreur)} />}
      {/* Un seul conteneur : au premier chargement les quatre cartes ont déjà leur taille définitive. */}
      <div className="graphes" aria-busy={ann.isLoading || undefined}>
        {ann.isLoading &&
          TITRES.map((t) => (
            <figure key={t} className="graphe">
              <figcaption>{t}</figcaption>
              <div className="graphe-zone" />
            </figure>
          ))}
        {serie && (
          <>
            <Carte titre={TITRES[0]}>
              <LineChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis dataKey="mois" interval={0} padding={{ left: 12, right: 16 }} {...AXE} />
                <YAxis domain={['auto', 'auto']} tickFormatter={(v) => fcfa(v)} width={90} {...AXE} />
                <Tooltip formatter={(v) => fcfa(Number(v))} />
                <Line dataKey="ms" name="Masse salariale" stroke={C1} strokeWidth={2} connectNulls={false} {...ANIM} />
              </LineChart>
            </Carte>
            <Carte titre={TITRES[1]}>
              <BarChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis dataKey="mois" interval={0} padding={{ left: 12, right: 16 }} {...AXE} />
                <YAxis allowDecimals={false} {...AXE} />
                <Tooltip />
                <Bar dataKey="effectif" name="Effectif" fill={C2} radius={[3, 3, 0, 0]} {...ANIM} />
              </BarChart>
            </Carte>
            <Carte titre={TITRES[2]}>
              <BarChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis dataKey="mois" interval={0} padding={{ left: 12, right: 16 }} {...AXE} />
                <YAxis {...AXE} />
                <Tooltip />
                <Bar dataKey="absences" name="Absences" fill={C3} radius={[3, 3, 0, 0]} {...ANIM} />
              </BarChart>
            </Carte>
          </>
        )}
        {contrats && contrats.length > 0 && (
          <Carte titre={TITRES[3]}>
            <BarChart data={contrats}>
              <CartesianGrid stroke={GRILLE} vertical={false} />
              <XAxis dataKey="contrat" {...AXE} />
              <YAxis {...AXE} />
              <Tooltip />
              <Bar dataKey="effectif" name="Effectif moyen" fill={C1} radius={[3, 3, 0, 0]} {...ANIM} />
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
