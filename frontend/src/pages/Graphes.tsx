import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { getAnnuel } from '../api/rapports'
import type { SerieMois } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import { useFiltres } from '../hooks/useFiltres'
import { useSalaries } from '../hooks/useSalaries'
import { entier, fcfa, MOIS_COURTS } from '../lib/format'
import { TitreRapport } from '../components/ExportPdf'
import { useLocation } from 'react-router-dom'

// Couleurs issues des tokens (styles/tokens.css) : recharts les passe en attributs SVG, qui acceptent var().
// Une teinte par graphe pour qu'on les distingue d'un coup d'œil.
const C_MS = 'var(--data-1)'
const C_FRAIS = 'var(--data-4)'
const C_REMU = 'var(--data-5)'
// Une couleur fixe par type de contrat, dans l'ordre du référentiel : un filtre ne la change pas.
const COULEURS_CONTRAT = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)']
// Année N-1 : série de comparaison, en retrait
const N1 = 'var(--muted-2)'
const GRILLE = 'var(--rule)'
// Ordre et titres d'origine ; seuls les deux derniers graphes changent de sujet.
const TITRES = ['Masse salariale mensuelle (FCFA)', 'Effectif', 'Frais de mission (FCFA)', 'Rémunération globale (FCFA)']
const AXE ={ tickLine: false, axisLine: false, tick: { fill: 'var(--muted)', fontSize: 12 } }
const AXE_X = { dataKey: 'mois', interval: 'preserveStartEnd', minTickGap: 4, padding: { left: 12, right: 16 }, ...AXE } as const
// Axe en millions (« 45 M ») : lisible d'un coup d'œil ; la valeur exacte est dans l'info-bulle.
const millions = (v: number) => `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M`
// Haut d'axe arrondi à 4 pas réguliers (1, 2, 2,5 ou 5 × 10^n) : graduations rondes même avec un domaine calculé.
const haut4 = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(v / 4))
  return 4 * [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => 4 * k >= v)!
}
const AXE_FCFA = {
  tickFormatter: millions, width: 52, tickCount: 5, domain: [0, (max: number) => (max > 0 ? haut4(max) : 1)], ...AXE,
} as const
// Ordre des séries conservé (pas de tri alphabétique) ; texte en encre neutre, la pastille porte la couleur.
const LEGENDE = {
  iconSize: 12,
  itemSorter: null,
  wrapperStyle: { fontSize: 12 },
  formatter: (v: string) => <span style={{ color: 'var(--muted)' }}>{v}</span>,
} as const
const BULLE_FCFA = (v: unknown) => fcfa(Number(v))
// Transition courte d'une valeur à l'autre (1,5 s par défaut pour une courbe : trop lent au changement de filtre).
const ANIMATION = { animationDuration: 450, animationEasing: 'ease-out' } as const

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v))

function Carte({ titre, lecture, children }: { titre: string; lecture?: string; children: ReactNode }) {
  return (
    <figure className="graphe">
      <figcaption>{titre}</figcaption>
      {lecture && <p className="graphe-lecture">{lecture}</p>}
      <div className="graphe-zone">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

export default function Graphes() {
  // Rapport PDF : sans animation, sinon l'impression relance le tracé et fige des courbes à moitié dessinées
  const ANIM = useLocation().pathname.startsWith('/rapport') ? { isAnimationActive: false } : ANIMATION
  // Tout vient du rapport annuel : un mois sans données dans le périmètre n'efface pas les graphes
  const f = useFiltres({ avecMois: false })
  const salaries = useSalaries(f.filtres?.annee)
  const ann = useQuery({
    queryKey: ['annuel', f.filtres],
    queryFn: () => getAnnuel(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const erreur = ann.error

  const annee = f.filtres?.annee
  const contrats = ann.data?.d_contrat.effectifs.map((c) => c.contrat) ?? []
  const n1 = ann.data?.serie_n1
  const serie = ann.data?.serie_n.map((m: SerieMois, i) => ({
    mois: MOIS_COURTS[m.mois - 1],
    ms: num(m.ms),
    ms1: num(n1?.[i]?.ms),
    effectif: m.effectif,
    frais: num(m.frais_mission),
    frais1: num(n1?.[i]?.frais_mission),
    remu: num(m.remuneration),
    remu1: num(n1?.[i]?.remuneration),
    ...Object.fromEntries(contrats.map((c) => [c, m.effectif_contrat?.[c] ?? null])),
  }))
  // Valeur sur chaque point : la courbe la plus basse du mois écrit la sienne dessous, les autres dessus,
  // pour que deux courbes proches ne se masquent pas ; un mois à zéro n'écrit rien.
  const etiquette = (c: string) => ({ x, y, value, index }: { x?: number | string; y?: number | string; value?: unknown; index?: number }) => {
    const v = Number(value)
    if (!v || index == null || !serie) return null
    const valeurs = contrats.map((k) => Number(serie[index][k as keyof (typeof serie)[number]] ?? NaN))
    const positifs = valeurs.filter((u) => u > 0)
    // Dessous seulement s'il y a une courbe au-dessus : seule valeur du mois, elle reste au-dessus de l'axe.
    const bas = positifs.some((u) => u > v) && valeurs.findIndex((w) => w === Math.min(...positifs)) === contrats.indexOf(c)
    return (
      <text x={Number(x)} y={Number(y)} dy={bas ? 16 : -8} textAnchor="middle" fill="var(--ink)" fontSize={11}>
        {v}
      </text>
    )
  }
  // Pas de série N-1 (ni d'entrée de légende) quand l'année précédente n'a aucune paie
  const avecN1 = !!n1?.some((m) => m.remuneration != null)
  const serieN = `${annee ?? 'N'}`
  const serieN1 = `${annee ? annee - 1 : 'N-1'}`
  const comparaison = avecN1 ? ` ; en gris, ${serieN1} pour comparer` : ''

  return (
    // Squelette au premier chargement seulement ; à un changement de filtre, les graphes restent affichés
    // et glissent vers les nouvelles valeurs à leur arrivée.
    <section className="page-ecran page-etroite rapport-excel graphes-excel">
      <TitreRapport titre="GRAPHES D’ÉVOLUTION" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} typesSite={f.typesSite} postes={f.postes} activites={f.activites} salaries={salaries} partage={f.partage} onChange={f.set} />
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
            {/* Retour du 16/10 : même présentation que la rémunération globale (aire N, pointillés N-1) ;
                l'effectif a son propre graphe. */}
            <Carte titre={TITRES[0]} lecture={`Masse salariale de chaque mois en ${serieN}${comparaison}.`}>
              <AreaChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis {...AXE_X} />
                <YAxis {...AXE_FCFA} />
                <Tooltip formatter={BULLE_FCFA} />
                <Legend {...LEGENDE} />
                <Area dataKey="ms" name={serieN} stroke={C_MS} strokeWidth={2.5} fill={C_MS} fillOpacity={0.15} dot={{ r: 3, fill: C_MS }} connectNulls={false} {...ANIM} />
                {avecN1 && <Area dataKey="ms1" name={serieN1} stroke={N1} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} connectNulls={false} {...ANIM} />}
              </AreaChart>
            </Carte>
            {/* Une courbe par type de contrat, valeur inscrite sur chaque point. */}
            <Carte titre={TITRES[1]} lecture="Nombre de salariés par mois, une courbe par type de contrat.">
              <LineChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis {...AXE_X} />
                <YAxis allowDecimals={false} width={36} tickCount={5} domain={[0, (max: number) => (max > 0 ? haut4(max * 1.15) : 4)]} {...AXE} />
                <Tooltip formatter={(v) => `${entier(Number(v))} salariés`} />
                <Legend {...LEGENDE} />
                {contrats.map((c, i) => {
                  const coul = COULEURS_CONTRAT[i % COULEURS_CONTRAT.length]
                  return (
                    <Line key={c} dataKey={c} name={c} stroke={coul} strokeWidth={2.5} dot={{ r: 3.5, fill: coul }} connectNulls={false} {...ANIM}>
                      <LabelList dataKey={c} content={etiquette(c)} />
                    </Line>
                  )
                })}
              </LineChart>
            </Carte>
            <Carte titre={TITRES[2]} lecture={`Frais de mission payés chaque mois en ${serieN}${comparaison}.`}>
              <ComposedChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis {...AXE_X} />
                <YAxis {...AXE_FCFA} />
                <Tooltip formatter={BULLE_FCFA} />
                <Legend {...LEGENDE} />
                <Bar dataKey="frais" name={serieN} fill={C_FRAIS} radius={[3, 3, 0, 0]} {...ANIM} />
                {avecN1 && <Line dataKey="frais1" name={serieN1} stroke={N1} strokeWidth={2} dot={{ r: 3, fill: N1 }} connectNulls={false} {...ANIM} />}
              </ComposedChart>
            </Carte>
            <Carte titre={TITRES[3]} lecture={`Total versé chaque mois : salaires et charges, plus les primes hors total${comparaison}.`}>
              <AreaChart data={serie}>
                <CartesianGrid stroke={GRILLE} vertical={false} />
                <XAxis {...AXE_X} />
                <YAxis {...AXE_FCFA} />
                <Tooltip formatter={BULLE_FCFA} />
                <Legend {...LEGENDE} />
                <Area dataKey="remu" name={serieN} stroke={C_REMU} strokeWidth={2.5} fill={C_REMU} fillOpacity={0.15} dot={{ r: 3, fill: C_REMU }} connectNulls={false} {...ANIM} />
                {avecN1 && <Area dataKey="remu1" name={serieN1} stroke={N1} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} connectNulls={false} {...ANIM} />}
              </AreaChart>
            </Carte>
          </>
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
                    {contrats.map((c) => (
                      <th key={c} scope="col">{c}</th>
                    ))}
                    <th scope="col">Frais de mission</th>
                    <th scope="col">Rémunération globale</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.map((m) => (
                    <tr key={m.mois}>
                      <th scope="row">{m.mois}</th>
                      <td className="num">{fcfa(m.ms)}</td>
                      <td className="num">{entier(m.effectif)}</td>
                      {contrats.map((c) => (
                        <td key={c} className="num">{entier((m as Record<string, unknown>)[c] as number | null)}</td>
                      ))}
                      <td className="num">{fcfa(m.frais)}</td>
                      <td className="num">{fcfa(m.remu)}</td>
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
