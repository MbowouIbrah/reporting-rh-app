import { Fragment, type ReactNode, useState } from 'react'
import type { Budget, Cell, CellPartiel, FrontBack, LigneActivite, Mensuel, Val } from '../api/types'
import { cls, clsCharge, clsResultat, decimal2, entier, fcfa, pct } from '../lib/format'

/** Blocs communs aux onglets MENSUEL et ANNUEL de l'Excel : mêmes tableaux, libellés de période différents. */
export type Blocs = Pick<Mensuel, 'a_type_charge' | 'lignes_ca_marge' | 'frais_mission' | 'b_service_activite' | 'c_site' | 'c_site_total' | 'd_contrat'>
type Activites = Blocs['b_service_activite'][number]['activites']

export interface Libelles {
  prec: string
  cour: string
}


export function Panneau({ titre, className, id, sansTitre, children }: { titre: string; className?: string; id?: string; sansTitre?: boolean; children: ReactNode }) {
  return (
    <section id={id} className={`panneau ${className ?? ''}`} aria-label={titre}>
      {!sansTitre && <h3>{titre}</h3>}
      <div className="panneau-corps">{children}</div>
    </section>
  )
}

/** Bulle d'aide de la colonne : écart rapporté au budget, signé. */
const LIB_BUDGET = ['Budget', 'Écart', '% Budget']
const LIB_OBJECTIF = ['Objectif', 'Écart', 'Écart %']

function Tete({ premiere, lib, budget, libBudget = LIB_BUDGET, bourrage = 0 }: {
  premiere: string; lib: Libelles; budget?: boolean; libBudget?: string[]; bourrage?: number
}) {
  return (
    <thead>
      <tr>
        <th scope="col">{premiere}</th>
        <th scope="col">{lib.prec}</th>
        <th scope="col">{lib.cour}</th>
        <th scope="col">Variation</th>
        <th scope="col">Var. %</th>
        {budget && (
          <>
            {libBudget.map((t) => (
              <th scope="col" key={t}>{t}</th>
            ))}
          </>
        )}
        <Bourrage n={bourrage} tete />
      </tr>
    </thead>
  )
}

/** Mention discrète d'un total auquel il manque une case attendue. */
const Partiel = () => <span className="partiel-mention" title="Total incomplet : une case attendue n’est pas renseignée">partiel</span>

/** Sens de l'écart : une charge qui dépasse son budget est mauvaise ; un résultat (CA, marge, ventes...) qui dépasse son objectif est bon. */
type Sens = 'charge' | 'resultat'

function Ligne({ label, cell, budget, className, format = fcfa, sens = 'charge', bourrage = 0 }: {
  label: ReactNode
  cell: CellPartiel
  budget?: (Budget & { budget_partiel?: true }) | true
  className?: string
  format?: (v: CellPartiel['m']) => string
  sens?: Sens
  bourrage?: number
}) {
  const b = budget === true ? undefined : budget
  const cE = sens === 'resultat' ? clsResultat : clsCharge
  return (
    <tr className={className}>
      <th scope="row">{label}{cell.partiel && <Partiel />}</th>
      <td className="num">{format(cell.m1)}</td>
      <td className="num">{format(cell.m)}</td>
      <td className={cls(cell.var)}>{format(cell.var)}</td>
      <td className={cls(cell.var_pct)}>{pct(cell.var_pct)}</td>
      {budget !== undefined && (
        <>
          <td className="num">{format(b?.budget ?? null)}{b?.budget_partiel && <Partiel />}</td>
          <td className={cE(b?.ecart ?? null)}>{format(b?.ecart ?? null)}</td>
          <td className={cE(b?.ecart_pct ?? null)}>{pct(b?.ecart_pct ?? null)}</td>
        </>
      )}
      <Bourrage n={bourrage} />
    </tr>
  )
}


// Grille commune des tableaux : un libellé puis sept colonnes de chiffres ; un tableau plus court
// complète sa ligne par une cellule vide pour garder ses colonnes alignées sur les autres.
const COLONNES = 7
function Bourrage({ n, tete }: { n: number; tete?: boolean }) {
  if (n <= 0) return null
  return tete ? <th className="bourrage" colSpan={n} aria-hidden="true" /> : <td className="bourrage" colSpan={n} aria-hidden="true" />
}

/** 1 bis. Charges exclues du total général : tableau distinct, rubriques non comptées dans le reporting global. */
export function TypesExclus({ d, lib }: { d: Blocs; lib: Libelles }) {
  const exclus = d.a_type_charge.filter((r) => r.rubrique !== 'TOTAL CHARGES' && r.exclu)
  if (exclus.length === 0) return null
  return (
    <table className="dense tab-global aligne">
      <Tete premiere="Charge exclue" lib={lib} budget />
      <tbody>
        {exclus.map((r) => (
          <Ligne key={r.rubrique} label={r.rubrique} cell={r} budget={r} className="exclu" />
        ))}
      </tbody>
    </table>
  )
}

/** 1. Reporting global : rubriques comptées (les hors total sont dans `TypesExclus`), TOTAL GÉNÉRAL,
 *  puis CA et marge (hors total, avec objectif). */
export function TypesCharge({ d, lib }: { d: Blocs; lib: Libelles }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
  const rubriques = d.a_type_charge.filter((r) => r !== total)
  return (
    <table className="dense tab-global aligne">
      <Tete premiere="Type de charge" lib={lib} budget />
      <tbody>
        {rubriques.filter((r) => !r.exclu).map((r) => (
          <Ligne key={r.rubrique} label={r.rubrique} cell={r} budget={r} />
        ))}
      </tbody>
      <tbody className="pied">
        {total && <Ligne label="TOTAL GÉNÉRAL" cell={total} budget={total} className="total" />}
      </tbody>
      <tbody>
        {d.lignes_ca_marge && (
          <>
            <Ligne label="Chiffre d'affaires" cell={d.lignes_ca_marge.ca} budget={d.lignes_ca_marge.ca} sens="resultat" className="hors-total" />
            <Ligne label="Marge" cell={d.lignes_ca_marge.marge} budget={d.lignes_ca_marge.marge} sens="resultat" className="hors-total" />
          </>
        )}
      </tbody>
    </table>
  )
}

// Indices et ratios : les décimales comptent (0,85 ne doit pas s'afficher « 1 »).
const RATIOS = new Set(['productivite', 'productifs', 'or_par_productif', 'factures_par_productif'])

// Lignes d'activité qui portent un objectif ; ce sont des résultats (le dépasser est bon).
const AVEC_OBJECTIF = new Set(['ventes', 'clients', 'productivite', 'factures'])

/** 6. Activité : ventes, clients, productivité, OR, devis, factures ; masqué par l'appelant quand `activite` est null.
 *  Les colonnes Objectif / Écart / Écart % occupent les trois dernières colonnes de la grille (plus de bourrage) dès que le serveur les envoie. */
export function Activite({ lignes, lib }: { lignes: LigneActivite[]; lib: Libelles }) {
  const objectif = lignes.some((l) => 'budget' in l)
  const bourrage = objectif ? 0 : COLONNES - 4
  return (
    <table className="dense tab-global aligne">
      <Tete premiere="Indicateur" lib={lib} budget={objectif} libBudget={LIB_OBJECTIF} bourrage={bourrage} />
      <tbody>
        {lignes.map((l) => (
          <Ligne
            key={l.cle}
            label={l.libelle}
            cell={l}
            budget={objectif ? (AVEC_OBJECTIF.has(l.cle) ? l : true) : undefined}
            sens="resultat"
            format={RATIOS.has(l.cle) ? decimal2 : fcfa}
            bourrage={bourrage}
          />
        ))}
      </tbody>
    </table>
  )
}

/** Premier chargement : cadre réel de la section 1 (titre, en-têtes, TOTAL GÉNÉRAL) à sa taille ;
 *  seules les valeurs issues des données (types de charge, chiffres) sont en squelette. */
export function RapportSquelette({ lib }: { lib: Libelles }) {
  const chiffres = Array.from({ length: COLONNES }, (_, j) => <td key={j} className="num" />)
  return (
    <div aria-busy="true">
      <Panneau titre="1. Reporting global">
        <table className="dense tab-global aligne">
          <Tete premiere="Type de charge" lib={lib} budget />
          <tbody aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <tr key={i}>
                <th scope="row" className="var" />
                {chiffres}
              </tr>
            ))}
            <tr className="total">
              <th scope="row">TOTAL GÉNÉRAL</th>
              {chiffres}
            </tr>
          </tbody>
        </table>
      </Panneau>
    </div>
  )
}

const Valeurs = ({ c }: { c: Cell }) => (
  <>
    <td className="num">{fcfa(c.m1)}</td>
    <td className="num">{fcfa(c.m)}</td>
    <td className={cls(c.var)}>{fcfa(c.var)}</td>
    <td className={cls(c.var_pct)}>{pct(c.var_pct)}</td>
  </>
)

const Budgets = ({ b, rowSpan }: { b: Budget; rowSpan?: number }) => (
  <>
    <td className="num budget" rowSpan={rowSpan}>{fcfa(b.budget ?? null)}</td>
    <td className={`${clsCharge(b.ecart ?? null)} budget`} rowSpan={rowSpan}>{fcfa(b.ecart ?? null)}</td>
    <td className={`${clsCharge(b.ecart_pct ?? null)} budget`} rowSpan={rowSpan}>{pct(b.ecart_pct ?? null)}</td>
  </>
)

/** Écart nul en gris, baisse en rouge, hausse sans couleur (maquette D1 sobre). */
const clsEcart = (v?: Val) => `${cls(v)}${v != null && v !== 'n/a' && Number(v) === 0 ? ' nul' : ''}`
const nul = (v?: Val) => v == null || v === 'n/a' || Number(v) === 0
const vide = (c: Cell) => nul(c.m) && nul(c.m1)

/** Part dans l'activité, le site ou le service, en badge neutre. */
const Part = ({ v }: { v?: Val }) => (v == null ? null : <span className="part-badge">{pct(v)}</span>)

/** Part du site ou du service dans la masse ou l'effectif global, sous son nom. */
const PartGlobale = ({ v, libelle }: { v?: Val; libelle: string }) =>
  v == null ? null : (
    <span className="part-globale">
      <span>{libelle}</span> <b>{pct(v)}</b>
    </span>
  )

interface LigneRep {
  ms: Cell
  effectif: Cell
  part_masse?: Val
  part?: Val
}

/** Chiffres d'une ligne : masse (N-1, N, écart, écart %, part), gouttière, effectif (N-1, N, écart, part),
 *  puis le budget du bloc s'il existe (undefined : pas de groupe budget ; null : cellules vides). */
const Chiffres = ({ l, budget }: { l: LigneRep; budget?: Budget | null }) => (
  <>
    <td className="num masse">{fcfa(l.ms.m1)}</td>
    <td className="num masse">{fcfa(l.ms.m)}</td>
    <td className={`${clsEcart(l.ms.var)} masse`}>{fcfa(l.ms.var)}</td>
    <td className={`${clsEcart(l.ms.var_pct)} masse`}>{pct(l.ms.var_pct)}</td>
    <td className="num masse">
      <Part v={l.part_masse} />
    </td>
    <td className="gouttiere" aria-hidden="true" />
    <td className="num">{fcfa(l.effectif.m1)}</td>
    <td className="num">{fcfa(l.effectif.m)}</td>
    <td className={clsEcart(l.effectif.var)}>{fcfa(l.effectif.var)}</td>
    <td className="num">
      <Part v={l.part} />
    </td>
    {budget !== undefined && (
      <>
        <td className="gouttiere" aria-hidden="true" />
        {budget ? <Budgets b={budget} /> : <td colSpan={3} className="budget" />}
      </>
    )}
  </>
)

interface BlocRep {
  nom: string
  activites: Activites
  total: LigneRep
  budget: Budget
  partMasse?: Val
  partEffectif?: Val
}

/** 2 et 3. Répartition par site ou par service (remarque 3, maquette D1 sobre) : une ligne par activité,
 *  masse et effectif côte à côte ; chaque activité se déplie par contrat, le nom du bloc déplie toutes ses activités ;
 *  un seul bloc ouvert à la fois (ouvrir un autre bloc replie le précédent) ;
 *  chaque bloc finit par son total, qui porte le budget. Activités et contrats à zéro masqués. */
function Repartition({ axe, blocs, general, lib, titre }: {
  axe: 'site' | 'service'
  titre?: string
  blocs: BlocRep[]
  general?: { ms: Cell & Budget; effectif: Cell }
  lib: Libelles
}) {
  // Un seul site (ou service) déplié à la fois ; dans ce bloc, plusieurs activités peuvent être ouvertes.
  const [ouvert, setOuvert] = useState<{ bloc: string; activites: string[] } | null>(null)
  const avecBudget = blocs.some((b) => b.budget.budget != null)
  const sansBudget = avecBudget ? null : undefined
  const plein = (x: { ms: Cell; effectif: Cell }) => !(vide(x.ms) && vide(x.effectif))
  const contratsDe = (a: Activites[number]) => Object.entries(a.contrats ?? {}).filter(([, x]) => plein(x))
  // Rang courant des lignes, pour un zèbre continu sur tout le tableau (comme les autres tableaux).
  let rang = 0
  return (
    <table className={`dense repartition${ouvert ? '' : ' replie'}`}>
      <thead>
        {titre && (
          // Bandeau du panneau : titre et groupes de colonnes sur la même ligne bleue.
          <tr className="groupes">
            <th colSpan={2} className="groupes-titre">{titre}</th>
            <th colSpan={5}>Masse salariale (FCFA)</th>
            <th className="gouttiere" />
            <th colSpan={4}>Effectif</th>
            {avecBudget && (
              <>
                <th className="gouttiere" />
                <th colSpan={3}>Budget</th>
              </>
            )}
          </tr>
        )}
        <tr>
          <th scope="col" className="libelle">{axe === 'site' ? 'Site' : 'Service'}</th>
          <th scope="col" className="libelle">Activité</th>
          <th scope="col" className="masse" title="Masse salariale en FCFA">Masse {lib.prec}</th>
          <th scope="col" className="masse" title="Masse salariale en FCFA">Masse {lib.cour}</th>
          <th scope="col" className="masse">Écart</th>
          <th scope="col" className="masse">Écart %</th>
          <th scope="col" className="masse">Part</th>
          <th className="gouttiere" />
          <th scope="col" title="Effectif en personnes">Effectif {lib.prec}</th>
          <th scope="col" title="Effectif en personnes">Effectif {lib.cour}</th>
          <th scope="col">Écart</th>
          <th scope="col">Part</th>
          {avecBudget && (
            <>
              <th className="gouttiere" />
              <th scope="col" title="Budget de masse salariale">Budget</th>
              <th scope="col">Écart</th>
              <th scope="col">% Budget</th>
            </>
          )}
        </tr>
      </thead>
      {blocs.map((b) => {
        const acts = b.activites.filter((a) => plein({ ms: a, effectif: a.effectif }))
        const ouvertes = ouvert?.bloc === b.nom ? ouvert.activites : []
        const estOuverte = (a: Activites[number]) => ouvertes.includes(a.activite)
        const depliables = acts.filter((a) => contratsDe(a).length > 0).map((a) => a.activite)
        const toutOuvert = depliables.length > 0 && depliables.every((x) => ouvertes.includes(x))
        const basculer = (x: string) => {
          const suite = ouvertes.includes(x) ? ouvertes.filter((y) => y !== x) : [...ouvertes, x]
          setOuvert(suite.length ? { bloc: b.nom, activites: suite } : null)
        }
        const hauteur = acts.length + 1 + acts.reduce((n, a) => n + (estOuverte(a) ? contratsDe(a).length : 0), 0)
        const parts = (
          <>
            <PartGlobale v={b.partMasse} libelle="Masse globale" />
            <PartGlobale v={b.partEffectif} libelle="Effectif global" />
          </>
        )
        const nom = (
          <th scope="rowgroup" rowSpan={hauteur} className={`nom${ouvertes.length ? ' ouvert' : ''}`}>
            {depliables.length > 0 ? (
              <button
                type="button"
                className="deplier deplier-bloc"
                aria-expanded={toutOuvert}
                aria-label={`Détail par contrat de toutes les activités (${b.nom})`}
                onClick={() => setOuvert(toutOuvert ? null : { bloc: b.nom, activites: depliables })}
              >
                <span className="nom-ligne">
                  <span aria-hidden="true">{toutOuvert ? '▾' : '▸'}</span> {b.nom}
                </span>
                {parts}
              </button>
            ) : (
              <>
                {b.nom}
                {parts}
              </>
            )}
          </th>
        )
        return (
          <tbody key={b.nom} className={`bloc${ouvertes.length ? ' ouvert' : ''}`}>
            {acts.map((a, i) => {
              const det = contratsDe(a)
              const o = estOuverte(a)
              return (
                <Fragment key={a.activite}>
                  <tr className={`activite${rang++ % 2 ? ' pair' : ''}`}>
                    {i === 0 && nom}
                    <th scope="row" className="libelle">
                      {det.length > 0 ? (
                        <button
                          type="button"
                          className="deplier"
                          aria-expanded={o}
                          aria-label={`Détail par contrat de ${a.activite} (${b.nom})`}
                          onClick={() => basculer(a.activite)}
                        >
                          <span aria-hidden="true">{o ? '▾' : '▸'}</span> {a.activite}
                        </button>
                      ) : (
                        a.activite
                      )}
                    </th>
                    <Chiffres l={{ ms: a, effectif: a.effectif, part_masse: a.part_masse, part: a.part }} budget={sansBudget} />
                  </tr>
                  {o &&
                    det.map(([c, x]) => (
                      <tr key={c} className="contrat">
                        <th scope="row" className="libelle">{c}</th>
                        <Chiffres l={x} budget={sansBudget} />
                      </tr>
                    ))}
                </Fragment>
              )
            })}
            <tr className={`total-bloc${rang++ % 2 ? ' pair' : ''}`}>
              {acts.length === 0 && nom}
              <th scope="row" className="libelle">Total {axe}</th>
              <Chiffres l={b.total} budget={avecBudget ? b.budget : undefined} />
            </tr>
          </tbody>
        )
      })}
      {general && (
        <tbody className="general">
          <tr>
            <th scope="row" colSpan={2}>TOTAL GÉNÉRAL</th>
            <Chiffres l={{ ms: general.ms, effectif: general.effectif }} budget={avecBudget ? general.ms : undefined} />
          </tr>
        </tbody>
      )}
    </table>
  )
}

export function ServicesActivites({ d, lib, titre }: { d: Blocs; lib: Libelles; titre?: string }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
  return (
    <Repartition
      axe="service"
      titre={titre}
      lib={lib}
      general={total && { ms: total, effectif: d.d_contrat.total }}
      blocs={d.b_service_activite.map((b) => ({
        nom: b.service,
        activites: b.activites ?? [],
        total: { ms: b.total, effectif: b.effectif },
        budget: b.total,
        partMasse: b.part_masse_globale,
        partEffectif: b.part_globale,
      }))}
    />
  )
}

export function Sites({ d, lib, titre }: { d: Blocs; lib: Libelles; titre?: string }) {
  return (
    <Repartition
      axe="site"
      titre={titre}
      lib={lib}
      general={d.c_site_total}
      blocs={d.c_site.map((r) => ({
        nom: r.site,
        // Anciens rapports sans ventilation par activité : le bloc se réduit à son total.
        activites: r.activites ?? [],
        total: { ms: r.ms, effectif: r.effectif },
        budget: r.ms,
        partMasse: r.part_masse_globale,
        partEffectif: r.part_globale,
      }))}
    />
  )
}

/** 5. Analyse des effectifs : total puis par nature de contrat ; l'effectif de fin, ligne de total, ferme le tableau. */
export function AnalyseEffectifs({ d, fb }: { d: Blocs; fb?: FrontBack | null }) {
  // Dernière colonne (ensemble) en tête ; aucune colonne sans indicateur
  const ind = d.d_contrat.indicateurs
  const cols = ind.length > 0 ? [ind[ind.length - 1], ...ind.slice(0, -1)] : []
  const ligne = (label: string, f: (i: (typeof cols)[number]) => string, className?: string) => (
    <tr className={className}>
      <th scope="row">{label}</th>
      <Bourrage n={COLONNES - cols.length} />
      {cols.map((i) => (
        <td className="num" key={i.contrat}>
          {f(i)}
        </td>
      ))}
    </tr>
  )
  return (
    <>
    <table className="dense aligne">
      <thead>
        <tr>
          <th scope="col">Indicateur</th>
          <Bourrage n={COLONNES - cols.length} tete />
          {cols.map((i) => (
            <th scope="col" key={i.contrat}>
              {i.contrat}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ligne('Effectif début de période', (i) => entier(i.debut))}
        {ligne('Recrutements', (i) => entier(i.recrutements))}
        {ligne('Départs', (i) => entier(i.departs))}
        {ligne('Taux de rotation', (i) => pct(i.taux_rotation))}
        {ligne('Nombre d’absences (jours)', (i) => fcfa(i.absences))}
        {ligne('Taux d’absentéisme', (i) => pct(i.taux_absenteisme))}
        {ligne('Effectif fin de période', (i) => entier(i.fin), 'total')}
      </tbody>
    </table>
    {fb && fb.total > 0 && <FrontBackLigne fb={fb} />}
    </>
  )
}

/** Ratio front / back office sur l'effectif de fin (une ligne sans activité ne compte dans aucune des deux parts). */
export function FrontBackLigne({ fb }: { fb: FrontBack }) {
  return (
    <p className="front-back">
      <strong>Front / Back office</strong> : {pct(fb.front_pct)} / {pct(fb.back_pct)}
      <span className="note"> ({entier(fb.front)} front, {entier(fb.back)} back sur {entier(fb.total)} en fin de période)</span>
    </p>
  )
}

/** 4. Nature de contrat × activité, présentée comme la répartition par service : contrat fusionné sur ses
 *  activités, une ligne Staff (effectif) sous chaque activité, puis total et effectif global. */
export function Contrats({ d, lib }: { d: Blocs; lib: Libelles }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
  const contrats = [...new Set(d.d_contrat.ventilation.map((v) => v.contrat))]
  return (
    <table className="dense aligne double services">
      <thead>
        <tr>
          <th scope="col">Contrat</th>
          <th scope="col">Activité</th>
          <th scope="col">{lib.prec}</th>
          <th scope="col">{lib.cour}</th>
          <th scope="col">Variation</th>
          <th scope="col">Var. %</th>
        </tr>
      </thead>
      <tbody>
        {contrats.map((c, n) => (
          <ContratBloc key={c} contrat={c} lignes={d.d_contrat.ventilation.filter((v) => v.contrat === c)} bande={n % 2 === 1} />
        ))}
      </tbody>
      <tbody className="pied">
        {total && (
          <tr className="total">
            <th scope="row" colSpan={2}>TOTAL GÉNÉRAL</th>
            <Valeurs c={total} />
          </tr>
        )}
      </tbody>
      <tbody>
        <tr className="total staff">
          <th scope="row" colSpan={2}>Effectif global</th>
          <Valeurs c={d.d_contrat.total} />
        </tr>
      </tbody>
    </table>
  )
}

function ContratBloc({ contrat, lignes, bande }: { contrat: string; lignes: Blocs['d_contrat']['ventilation']; bande: boolean }) {
  const fond = bande ? 'bande' : ''
  return lignes.map((v, i) => (
    <Fragment key={v.activite}>
      <tr className={`${i === 0 ? 'debut-service ' : ''}${fond}`.trim() || undefined}>
        {i === 0 && (
          <th scope="rowgroup" rowSpan={lignes.length * 2} className="service">
            {contrat}
          </th>
        )}
        <td>{v.activite}</td>
        <Valeurs c={v.ms} />
      </tr>
      <tr className={`staff ${fond}`.trim()}>
        <td>Staff</td>
        <Valeurs c={v.effectif} />
      </tr>
    </Fragment>
  ))
}
