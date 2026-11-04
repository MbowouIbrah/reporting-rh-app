import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Fragment, type ReactNode, useState } from 'react'
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { getAnnuel } from '../api/rapports'
import type { SerieMois } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode, { libelleComparaison } from '../components/FiltresPeriode'
import { useAttente } from '../hooks/useAttente'
import { useFiltres } from '../hooks/useFiltres'
import { useSalaries } from '../hooks/useSalaries'
import { compact, decimal2, entier, fcfa, MOIS_COURTS } from '../lib/format'
import { libelleExercice } from '../lib/exercice'
import { TitreRapport } from '../components/ExportPdf'
import { useLocation } from 'react-router-dom'
import MenuGroupes from '../components/MenuGroupes'
import PersonnaliserGroupes from '../components/PersonnaliserGroupes'
import SnapSections from '../components/SnapSections'
import {
  CONFIG_ORIGINE, GRAPHES, type Groupe, groupesAffiches, lireConfig, retablirOrigine, VUE_TOUT, vueInitiale,
} from '../lib/groupesGraphes'
import { usePreference } from '../lib/preference'

// Couleurs issues des tokens (styles/tokens.css) : recharts les passe en attributs SVG, qui acceptent var().
// Une teinte par graphe pour qu'on les distingue d'un coup d'œil.
const C_MS = 'var(--data-1)'
const C_FRAIS = 'var(--data-4)'
const C_REMU = 'var(--data-5)'
const C_VENTES = 'var(--data-2)'
const C_CLIENTS = 'var(--data-3)'
const C_OR = 'var(--data-1)'
const C_CA = 'var(--data-1)'
const C_MARGE = 'var(--data-5)'
const C_COMMISSIONS = 'var(--data-3)'
const C_PRODUCTIVITE = 'var(--data-2)'
const C_FACTURES = 'var(--data-4)'
const C_ABSENCES = 'var(--data-6)'
const C_CHARGE = 'var(--data-1)'
const C_SALAIRE = 'var(--data-2)'
const C_PRIMES = 'var(--data-3)'
// Objectif : pointillés rouges, distincts des pointillés gris de l'année précédente
const C_OBJECTIF = 'var(--red)'
const OBJECTIF = { name: 'Objectif', stroke: C_OBJECTIF, strokeWidth: 2, strokeDasharray: '6 4', dot: false, connectNulls: false } as const
// Une couleur fixe par type de contrat, dans l'ordre du référentiel : un filtre ne la change pas.
const COULEURS_CONTRAT = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)']
// Année N-1 : série de comparaison, en retrait
const N1 = 'var(--muted-2)'
const GRILLE = 'var(--rule)'
const T = Object.fromEntries(GRAPHES.map((g) => [g.id, g.titre]))
const AXE ={ tickLine: false, axisLine: false, tick: { fill: 'var(--muted)', fontSize: 12 } }
const AXE_X = { dataKey: 'mois', interval: 'preserveStartEnd', minTickGap: 4, padding: { left: 12, right: 16 }, ...AXE } as const
// Axe en millions seulement (« 0,5 M », « 45 M ») : une seule unité ; l'info-bulle donne la valeur en K ou M.
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
const BULLE_FCFA = (v: unknown) => compact(Number(v))
// Transition courte d'une valeur à l'autre (1,5 s par défaut pour une courbe : trop lent au changement de filtre).
const ANIMATION = { animationDuration: 450, animationEasing: 'ease-out' } as const

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v))

function Carte({ titre, lecture, note, children }: { titre: string; lecture?: string; note?: string; children: ReactNode }) {
  return (
    <figure className="graphe">
      <figcaption>{titre}</figcaption>
      {lecture && <p className="graphe-lecture">{lecture}</p>}
      <div className="graphe-zone">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
      {note && <p className="graphe-lecture graphe-note">{note}</p>}
    </figure>
  )
}

type Unite = 'fcfa' | 'entier' | 'decimal'
const HAUT = [0, (max: number) => (max > 0 ? haut4(max * 1.15) : 4)] as [number, (max: number) => number]

/** Graphe mensuel type : barres (ou courbe) de l'année, année précédente en gris, objectif en pointillés rouges.
 *  Rien n'est affiché tant que la série n'a aucune valeur (droit marge absent, donnée non saisie). */
function GrapheMois({ serie, titre, lecture, cle, objectif, couleur, unite = 'fcfa', suffixe = '', courbe, anim, serieN, serieN1 }: {
  serie: Record<string, unknown>[]; titre: string; lecture: string; cle: string; objectif?: string; couleur: string
  unite?: Unite; suffixe?: string; courbe?: boolean; anim: object; serieN: string; serieN1: string
}) {
  const a = (k: string) => serie.some((m) => m[k] != null)
  if (!a(cle)) return null
  const avecN1 = a(`${cle}1`)
  const avecObj = !!objectif && a(objectif)
  const note = `${lecture}${avecN1 ? ` ; en gris, ${serieN1} pour comparer` : ''}${avecObj ? ' ; en pointillés rouges, l’objectif' : ''}.`
  const axe = unite === 'fcfa' ? <YAxis {...AXE_FCFA} />
    : unite === 'entier' ? <YAxis allowDecimals={false} width={36} tickCount={5} domain={HAUT} {...AXE} />
    : <YAxis width={44} tickCount={5} tickFormatter={(v) => decimal2(String(v))} domain={HAUT} {...AXE} />
  const bulle = (v: unknown) => (unite === 'fcfa' ? BULLE_FCFA(v) : `${unite === 'entier' ? entier(Number(v)) : decimal2(String(v))}${suffixe}`)
  return (
    <Carte titre={titre} lecture={note}>
      <ComposedChart data={serie}>
        <CartesianGrid stroke={GRILLE} vertical={false} />
        <XAxis {...AXE_X} />
        {axe}
        <Tooltip formatter={bulle} />
        <Legend {...LEGENDE} />
        {courbe
          ? <Line dataKey={cle} name={serieN} stroke={couleur} strokeWidth={2.5} dot={{ r: 3.5, fill: couleur }} connectNulls={false} {...anim} />
          : <Bar dataKey={cle} name={serieN} fill={couleur} radius={[3, 3, 0, 0]} {...anim} />}
        {avecN1 && <Line dataKey={`${cle}1`} name={serieN1} stroke={N1} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} {...anim} />}
        {avecObj && <Line dataKey={objectif} {...OBJECTIF} {...anim} />}
      </ComposedChart>
    </Carte>
  )
}

export default function Graphes() {
  // Rapport PDF : sans animation, sinon l'impression relance le tracé et fige des courbes à moitié dessinées
  const rapport = useLocation().pathname.startsWith('/rapport')
  const ANIM = rapport ? { isAnimationActive: false } : ANIMATION
  const [config, setConfig] = usePreference('groupes.evolution', lireConfig, CONFIG_ORIGINE)
  const [vue, setVue] = useState<string | null>(null)
  const [personnalise, setPersonnalise] = useState(false)
  // Tout vient du rapport annuel : un mois sans données dans le périmètre n'efface pas les graphes
  const f = useFiltres({ avecMois: false, comparaison: 'annee', avecCalendrier: true })
  const salaries = useSalaries(f.filtres?.annee, f.filtres?.calendrier)
  const ann = useQuery({
    queryKey: ['annuel', f.filtres],
    queryFn: () => getAnnuel(f.filtres!),
    enabled: !!f.filtres,
    placeholderData: keepPreviousData,
  })
  const [premier, relais] = useAttente(ann.isLoading)
  const erreur = premier ? null : ann.error

  const annee = f.filtres?.annee
  const contrats = ann.data?.d_contrat.effectifs.map((c) => c.contrat) ?? []
  const n1 = ann.data?.serie_n1
  const serie = premier ? undefined : ann.data?.serie_n.map((m: SerieMois, i) => ({
    mois: MOIS_COURTS[m.mois - 1],
    ms: num(m.ms),
    ms1: num(n1?.[i]?.ms),
    effectif: m.effectif,
    frais: num(m.frais_mission),
    frais1: num(n1?.[i]?.frais_mission),
    remu: num(m.remuneration),
    remu1: num(n1?.[i]?.remuneration),
    sal: num(m.salaire),
    sal1: num(n1?.[i]?.salaire),
    prim: num(m.primes_toutes),
    prim1: num(n1?.[i]?.primes_toutes),
    objMs: num(m.objectifs?.ms),
    objFrais: num(m.objectifs?.frais_mission),
    objRemu: num(m.objectifs?.remuneration),
    objVentes: num(m.objectifs?.ventes),
    objClients: num(m.objectifs?.clients),
    ca: num(m.ca),
    ca1: num(n1?.[i]?.ca),
    objCa: num(m.objectifs?.ca),
    marge: num(m.marge),
    marge1: num(n1?.[i]?.marge),
    objMarge: num(m.objectifs?.marge),
    comm: num(m.commissions),
    comm1: num(n1?.[i]?.commissions),
    objComm: num(m.objectifs?.commissions),
    prod: num(m.activite?.productivite),
    prod1: num(n1?.[i]?.activite?.productivite),
    objProd: num(m.objectifs?.productivite),
    fact: num(m.activite?.factures),
    fact1: num(n1?.[i]?.activite?.factures),
    objFact: num(m.objectifs?.factures),
    absences: num(m.absences),
    absences1: num(n1?.[i]?.absences),
    assurance: num(m.assurance),
    assurance1: num(n1?.[i]?.assurance),
    formation: num(m.formation),
    formation1: num(n1?.[i]?.formation),
    logement: num(m.logement),
    logement1: num(n1?.[i]?.logement),
    credit: num(m.credit_telephonique),
    credit1: num(n1?.[i]?.credit_telephonique),
    carburant: num(m.carburant),
    carburant1: num(n1?.[i]?.carburant),
    ventes: num(m.activite?.ventes),
    ventes1: num(n1?.[i]?.activite?.ventes),
    clients: num(m.activite?.clients),
    clients1: num(n1?.[i]?.activite?.clients),
    orProd: num(m.activite?.or_par_productif),
    orProd1: num(n1?.[i]?.activite?.or_par_productif),
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
  const aVentes = !!serie?.some((m) => m.ventes != null)
  const aClients = !!serie?.some((m) => m.clients != null)
  const aOr = !!serie?.some((m) => m.orProd != null)
  const ventesN1 = !!serie?.some((m) => m.ventes1 != null)
  const clientsN1 = !!serie?.some((m) => m.clients1 != null)
  const orN1 = !!serie?.some((m) => m.orProd1 != null)
  // Objectif tracé seulement s'il est défini sur au moins un mois
  const aObj = (k: 'objMs' | 'objFrais' | 'objRemu' | 'objVentes' | 'objClients') => !!serie?.some((m) => m[k] != null)
  const lectObj = (k: 'objMs' | 'objFrais' | 'objRemu' | 'objVentes' | 'objClients') => (aObj(k) ? ' ; en pointillés rouges, l’objectif' : '')
  const serieN = annee === undefined ? '' : libelleExercice(annee, f.filtres?.calendrier)
  const serieN1 = f.filtres ? libelleComparaison(f.filtres, 'annee') : ''
  const comparaison = avecN1 ? ` ; en gris, ${serieN1} pour comparer` : ''
  const commun = { serie: (serie ?? []) as Record<string, unknown>[], anim: ANIM, serieN, serieN1 }
  // Graphiques qui ont des données (les trois d'activité et ceux à clé : seulement si la série a une valeur)
  const dispo = new Set(GRAPHES.filter((g) => !g.cle || commun.serie.some((m) => m[g.cle!] != null)).map((g) => g.id))
  const affiches = groupesAffiches(config, dispo)
  // Vue choisie par l'utilisateur ; sans choix (ou si le groupe n'est plus affiché), celle du réglage d'ouverture
  const vueActive = vue !== null && (vue === VUE_TOUT || affiches.some((g) => g.id === vue)) ? vue : vueInitiale(config, affiches)
  const groupeActif = affiches.find((g) => g.id === vueActive)
  // Squelette : les quatre cartes du groupe d'ouverture, avant même de savoir quelles données existent
  const tousLesIds = new Set(GRAPHES.map((g) => g.id))
  const groupesSquelette = groupesAffiches(config, tousLesIds)
  const vueSquelette = vueInitiale(config, groupesSquelette)
  const titresSquelette = (groupesSquelette.find((g) => g.id === vueSquelette) ?? groupesSquelette[0])?.graphes.map((id) => T[id]) ?? []

  // Retour du 16/10 : même présentation que la rémunération globale (aire N, pointillés N-1) ;
  // l'effectif a son propre graphe.
  const rendu: Record<string, () => ReactNode> = {
    ms: () => <Carte titre={T.ms} lecture={`Masse salariale de chaque mois en ${serieN}${comparaison}${lectObj('objMs')}.`}>
      <AreaChart data={serie}>
        <CartesianGrid stroke={GRILLE} vertical={false} />
        <XAxis {...AXE_X} />
        <YAxis {...AXE_FCFA} />
        <Tooltip formatter={BULLE_FCFA} />
        <Legend {...LEGENDE} />
        <Area dataKey="ms" name={serieN} stroke={C_MS} strokeWidth={2.5} fill={C_MS} fillOpacity={0.15} dot={{ r: 3, fill: C_MS }} connectNulls={false} {...ANIM} />
        {avecN1 && <Area dataKey="ms1" name={serieN1} stroke={N1} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} connectNulls={false} {...ANIM} />}
        {aObj('objMs') && <Area dataKey="objMs" fill="none" {...OBJECTIF} {...ANIM} />}
      </AreaChart>
    </Carte>,
    // Une courbe par type de contrat, valeur inscrite sur chaque point. 
    effectif: () => <Carte titre={T.effectif} lecture="Nombre de salariés par mois, une courbe par type de contrat.">
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
    </Carte>,
    frais: () => <Carte titre={T.frais} lecture={`Frais de mission payés chaque mois en ${serieN}${comparaison}${lectObj('objFrais')}.`}>
      <ComposedChart data={serie}>
        <CartesianGrid stroke={GRILLE} vertical={false} />
        <XAxis {...AXE_X} />
        <YAxis {...AXE_FCFA} />
        <Tooltip formatter={BULLE_FCFA} />
        <Legend {...LEGENDE} />
        <Bar dataKey="frais" name={serieN} fill={C_FRAIS} radius={[3, 3, 0, 0]} {...ANIM} />
        {avecN1 && <Line dataKey="frais1" name={serieN1} stroke={N1} strokeWidth={2} dot={{ r: 3, fill: N1 }} connectNulls={false} {...ANIM} />}
        {aObj('objFrais') && <Line dataKey="objFrais" {...OBJECTIF} {...ANIM} />}
      </ComposedChart>
    </Carte>,
    remu: () => <Carte titre={T.remu} lecture={`Salaire, prime, rémunération et charges : total de chaque mois en ${serieN}${comparaison}${lectObj('objRemu')}.`} note="L’objectif de rémunération globale n’apparaît pas quand un filtre (service, site, poste…) est appliqué.">
      <AreaChart data={serie}>
        <CartesianGrid stroke={GRILLE} vertical={false} />
        <XAxis {...AXE_X} />
        <YAxis {...AXE_FCFA} />
        <Tooltip formatter={BULLE_FCFA} />
        <Legend {...LEGENDE} />
        <Area dataKey="remu" name={serieN} stroke={C_REMU} strokeWidth={2.5} fill={C_REMU} fillOpacity={0.15} dot={{ r: 3, fill: C_REMU }} connectNulls={false} {...ANIM} />
        {avecN1 && <Area dataKey="remu1" name={serieN1} stroke={N1} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} connectNulls={false} {...ANIM} />}
        {aObj('objRemu') && <Area dataKey="objRemu" fill="none" {...OBJECTIF} {...ANIM} />}
      </AreaChart>
    </Carte>,
    salaire: () => <GrapheMois {...commun} titre={T.salaire} lecture={`Salaire brut garantie de chaque mois en ${serieN}`} cle="sal" couleur={C_SALAIRE} />,
    primes: () => <GrapheMois {...commun} titre={T.primes} lecture={`Bonus, primes exceptionnelles, primes sur ventes, sur résultats, productivité ateliers et commissions de chaque mois en ${serieN}, y compris celles hors total`} cle="prim" couleur={C_PRIMES} />,
    ventes: () => (
      <Carte titre={T.ventes} lecture={`Nombre de ventes de chaque mois en ${serieN}${ventesN1 ? ` ; en gris, ${serieN1} pour comparer` : ''}${lectObj('objVentes')}.`}>
        <ComposedChart data={serie}>
          <CartesianGrid stroke={GRILLE} vertical={false} />
          <XAxis {...AXE_X} />
          <YAxis allowDecimals={false} width={36} tickCount={5} domain={[0, (max: number) => (max > 0 ? haut4(max * 1.15) : 4)]} {...AXE} />
          <Tooltip formatter={(v) => `${entier(Number(v))} ventes`} />
          <Legend {...LEGENDE} />
          <Bar dataKey="ventes" name={serieN} fill={C_VENTES} radius={[3, 3, 0, 0]} {...ANIM} />
          {ventesN1 && <Line dataKey="ventes1" name={serieN1} stroke={N1} strokeWidth={2} dot={{ r: 3, fill: N1 }} connectNulls={false} {...ANIM} />}
          {aObj('objVentes') && <Line dataKey="objVentes" {...OBJECTIF} {...ANIM} />}
        </ComposedChart>
      </Carte>
    ),
    clients: () => (
      <Carte titre={T.clients} lecture={`Nombre de clients de chaque mois en ${serieN}${clientsN1 ? ` ; en gris, ${serieN1} pour comparer` : ''}${lectObj('objClients')}.`}>
        <LineChart data={serie}>
          <CartesianGrid stroke={GRILLE} vertical={false} />
          <XAxis {...AXE_X} />
          <YAxis allowDecimals={false} width={36} tickCount={5} domain={[0, (max: number) => (max > 0 ? haut4(max * 1.15) : 4)]} {...AXE} />
          <Tooltip formatter={(v) => `${entier(Number(v))} clients`} />
          <Legend {...LEGENDE} />
          <Line dataKey="clients" name={serieN} stroke={C_CLIENTS} strokeWidth={2.5} dot={{ r: 3.5, fill: C_CLIENTS }} connectNulls={false} {...ANIM} />
          {clientsN1 && <Line dataKey="clients1" name={serieN1} stroke={N1} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} {...ANIM} />}
          {aObj('objClients') && <Line dataKey="objClients" {...OBJECTIF} {...ANIM} />}
        </LineChart>
      </Carte>
    ),
    or: () => (
      <Carte titre={T.or} lecture={`OR de chaque mois divisé par le nombre de productifs en ${serieN}${orN1 ? ` ; en gris, ${serieN1} pour comparer` : ''}.`}>
        <AreaChart data={serie}>
          <CartesianGrid stroke={GRILLE} vertical={false} />
          <XAxis {...AXE_X} />
          <YAxis width={44} tickCount={5} tickFormatter={(v) => decimal2(String(v))} domain={[0, (max: number) => (max > 0 ? haut4(max * 1.15) : 4)]} {...AXE} />
          <Tooltip formatter={(v) => decimal2(String(v))} />
          <Legend {...LEGENDE} />
          <Area dataKey="orProd" name={serieN} stroke={C_OR} strokeWidth={2.5} fill={C_OR} fillOpacity={0.15} dot={{ r: 3, fill: C_OR }} connectNulls={false} {...ANIM} />
          {orN1 && <Area dataKey="orProd1" name={serieN1} stroke={N1} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} connectNulls={false} {...ANIM} />}
        </AreaChart>
      </Carte>
    ),
    // CA et marge : présents dans la série seulement avec le droit marge ; sinon aucun graphe. 
    ca: () => <GrapheMois {...commun} titre={T.ca} lecture={`Chiffre d’affaires de chaque mois en ${serieN}`} cle="ca" objectif="objCa" couleur={C_CA} />,
    marge: () => <GrapheMois {...commun} titre={T.marge} lecture={`Marge de chaque mois en ${serieN}`} cle="marge" objectif="objMarge" couleur={C_MARGE} />,
    commissions: () => <GrapheMois {...commun} titre={T.commissions} lecture={`Commissions de chaque mois en ${serieN}`} cle="comm" objectif="objComm" couleur={C_COMMISSIONS} />,
    productivite: () => <GrapheMois {...commun} titre={T.productivite} lecture={`Indice de productivité de chaque mois en ${serieN}`} cle="prod" objectif="objProd" couleur={C_PRODUCTIVITE} unite="decimal" courbe />,
    factures: () => <GrapheMois {...commun} titre={T.factures} lecture={`Nombre de factures de chaque mois en ${serieN}`} cle="fact" objectif="objFact" couleur={C_FACTURES} unite="entier" suffixe=" factures" />,
    absences: () => <GrapheMois {...commun} titre={T.absences} lecture={`Jours d’absence de chaque mois en ${serieN}`} cle="absences" couleur={C_ABSENCES} unite="decimal" suffixe=" j" />,
    assurance: () => <GrapheMois {...commun} titre={T.assurance} lecture={`Assurance payée chaque mois en ${serieN}`} cle="assurance" couleur={C_CHARGE} />,
    formation: () => <GrapheMois {...commun} titre={T.formation} lecture={`Formation payée chaque mois en ${serieN}`} cle="formation" couleur={C_CHARGE} />,
    logement: () => <GrapheMois {...commun} titre={T.logement} lecture={`Logement des sites déportés payé chaque mois en ${serieN}`} cle="logement" couleur={C_CHARGE} />,
    credit: () => <GrapheMois {...commun} titre={T.credit} lecture={`Crédit téléphonique payé chaque mois en ${serieN}`} cle="credit" couleur={C_CHARGE} />,
    carburant: () => <GrapheMois {...commun} titre={T.carburant} lecture={`Carburant payé chaque mois en ${serieN}`} cle="carburant" couleur={C_CHARGE} />,
  }
  const grille = (g: Groupe) => (
    <div className={`graphes n${g.graphes.length}`}>
      {g.graphes.map((id) => <Fragment key={id}>{rendu[id]?.()}</Fragment>)}
    </div>
  )
  const retablir = () => {
    setConfig(retablirOrigine(config))
    setVue(null)
  }

  return (
    // Squelette au premier chargement seulement ; à un changement de filtre, les graphes restent affichés
    // et glissent vers les nouvelles valeurs à leur arrivée.
    <section className={`page-ecran page-etroite rapport-excel graphes-excel${relais ? ' relais' : ''}`}>
      <TitreRapport titre="GRAPHES D’ÉVOLUTION" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} comparaison="annee" avecCalendrier filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} typesSite={f.typesSite} postes={f.postes} activites={f.activites} typesContrat={f.typesContrat} salaries={salaries} partage={f.partage} onChange={f.set} />
      )}
      {serie && !rapport && affiches.length > 0 && (
        <MenuGroupes
          groupes={affiches}
          vue={vueActive}
          defaut={config.defaut}
          onVue={setVue}
          onPersonnaliser={() => setPersonnalise(true)}
        />
      )}
      {f.vide && <Etat type="vide" />}
      {serie && affiches.length === 0 && (
        <p className="graphes-aucun">
          Aucun groupe à afficher.
          {!rapport && <> <button type="button" className="bouton bouton-lien" onClick={retablir}>Rétablir les groupes d’origine</button> <button type="button" className="bouton bouton-lien" onClick={() => setPersonnalise(true)}>Personnaliser…</button></>}
        </p>
      )}
      {erreur && <Etat type={etatErreur(erreur)} />}
      {/* Au premier chargement les quatre cartes ont déjà leur taille définitive. */}
      {premier && (
        <div className={`graphes n${Math.max(1, titresSquelette.length)}`} aria-busy="true">
          {titresSquelette.map((t) => (
            <figure key={t} className="graphe">
              <figcaption>{t}</figcaption>
              <div className="graphe-zone" />
            </figure>
          ))}
        </div>
      )}
      {serie && affiches.length > 0 && (rapport || vueActive === VUE_TOUT || !groupeActif ? (
        // Tous les groupes (et toujours le rapport PDF) : un écran par groupe
        <SnapSections
          libelle="Groupes de graphiques"
          sections={affiches.map((g) => ({
            id: `groupe-${g.id}`,
            titre: g.nom,
            contenu: (
              <div className="graphes-groupe">
                <h2 className="graphes-groupe-titre">{g.nom}</h2>
                {grille(g)}
              </div>
            ),
          }))}
        />
      ) : (
        grille(groupeActif)
      ))}
      {personnalise && !rapport && (
        <PersonnaliserGroupes
          config={config}
          dispo={dispo}
          onEnregistrer={(c) => {
            setConfig(c)
            setPersonnalise(false)
          }}
          onAnnuler={() => setPersonnalise(false)}
        />
      )}
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
                    {aVentes && <th scope="col">Ventes</th>}
                    {aClients && <th scope="col">Clients</th>}
                    {aOr && <th scope="col">OR par productif</th>}
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
                      {aVentes && <td className="num">{entier(m.ventes)}</td>}
                      {aClients && <td className="num">{entier(m.clients)}</td>}
                      {aOr && <td className="num">{decimal2(m.orProd == null ? null : String(m.orProd))}</td>}
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
