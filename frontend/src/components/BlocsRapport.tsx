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

/** Part en petit badge (retours N2, points 4 et 6) : part de masse (bleu) sur la ligne de l'activité, part
 *  d'effectif (ambre) sur la ligne Staff, pour comparer les deux : une activité qui pèse plus en masse
 *  qu'en effectif coûte plus par personne. Rien si la part est inconnue. */
const Part = ({ v, de }: { v?: Val; de: 'masse' | 'effectif' }) =>
  v == null ? null : (
    <span className={`part-badge ${de === 'masse' ? 'masse' : 'effectif'}`}>
      <b>{pct(v)}</b>
      <i>{de}</i>
    </span>
  )

/** 3. Répartition par service et activité, présentée comme l'onglet Excel : service fusionné sur ses activités,
 *  une ligne Staff (effectif) sous chaque activité, budget fusionné par service, puis total et effectif global.
 *  Un clic sur le bloc d'un service le déplie par nature de contrat, comme les sites. */
export function ServicesActivites({ d, lib }: { d: Blocs; lib: Libelles }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
  const [ouvert, setOuvert] = useState<string | null>(null)
  return (
    <>
      <table className="dense aligne double services">
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Activité</th>
            <th scope="col">{lib.prec}</th>
            <th scope="col">{lib.cour}</th>
            <th scope="col">Variation</th>
            <th scope="col">Var. %</th>
            <th scope="col">Budget</th>
            <th scope="col">Écart</th>
            <th scope="col">% Budget</th>
          </tr>
        </thead>
        <tbody>
          {d.b_service_activite.map((b, n) => (
            <BlocRepartition
              key={b.service}
              nom={b.service}
              activites={b.activites}
              budget={b.total}
              msContrat={b.ms_contrat}
              effectifContrat={b.effectif_contrat}
              partGlobale={b.part_globale}
              partMasseGlobale={b.part_masse_globale}
              partsContrat={b.parts_contrat}
              bande={n % 2 === 1}
              ouvert={ouvert === b.service}
              basculer={() => setOuvert(ouvert === b.service ? null : b.service)}
            />
          ))}
        </tbody>
        <tbody className="pied">
          {total && (
            <tr className="total">
              <th scope="row" colSpan={2}>TOTAL GÉNÉRAL</th>
              <Valeurs c={total} />
              <Budgets b={total} />
            </tr>
          )}
        </tbody>
        <tbody>
          <tr className="total staff">
            <th scope="row" colSpan={2}>Effectif global</th>
            <Valeurs c={d.d_contrat.total} />
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
    </>
  )
}

/** Part du service ou du site dans la masse ou l'effectif global, en badge sous son nom. */
const PartGlobale = ({ v, de }: { v?: Val; de: 'masse' | 'effectif' }) =>
  v == null ? null : (
    <span className={`part-globale ${de}`}>
      <b>{pct(v)}</b> {de === 'masse' ? 'de la masse globale' : 'de l’effectif global'}
    </span>
  )

type PartsContrat = Record<string, { masse?: Val; effectif?: Val }>

/** Bloc d'un service ou d'un site, même présentation des deux côtés (retours N2, point 6) : nom fusionné sur
 *  ses activités, une ligne Staff sous chaque activité, budget fusionné sur le bloc ; parts
 *  globales (masse, effectif) sous le nom, parts de l'activité et de chaque contrat en badges.
 *  Le damier alterne par bloc (bande), pas par ligne : les cellules fusionnées suivent leur bloc. */
function BlocRepartition({ nom, activites, budget, msContrat, effectifContrat, partGlobale, partMasseGlobale, partsContrat, bande, ouvert, basculer }: {
  nom: string
  activites: Activites
  budget: Cell & Budget
  msContrat?: Record<string, Cell>
  effectifContrat?: Record<string, Cell>
  partGlobale?: Val
  partMasseGlobale?: Val
  partsContrat?: PartsContrat
  bande: boolean
  ouvert: boolean
  basculer: () => void
}) {
  const contrats = Object.keys(effectifContrat ?? {})
  const depliable = contrats.length > 0
  const hauteur = activites.length * 2 + (ouvert ? 2 * contrats.length : 0)
  const clic = depliable ? basculer : undefined
  const classe = (base: string) => `${base} ${depliable ? 'depliable' : ''} ${bande ? 'bande' : ''}`.replace(/\s+/g, ' ').trim() || undefined
  return (
    <>
      {activites.map((a, i) => (
        <Fragment key={a.activite}>
          <tr className={classe(i === 0 ? 'debut-service' : '')} onClick={clic}>
            {i === 0 && (
              <th scope="rowgroup" rowSpan={activites.length * 2} className={ouvert ? 'service ouvert' : 'service'}>
                {depliable ? (
                  <button type="button" className="deplier" aria-expanded={ouvert} aria-label={`Détail par contrat de ${nom}`}>
                    <span aria-hidden="true">{ouvert ? '▾' : '▸'}</span> {nom}
                  </button>
                ) : (
                  nom
                )}
                <PartGlobale v={partMasseGlobale} de="masse" />
                <PartGlobale v={partGlobale} de="effectif" />
              </th>
            )}
            <td className="libelle-part">
              {a.activite}
              <Part v={a.part_masse} de="masse" />
            </td>
            <Valeurs c={a} />
            {i === 0 && <Budgets b={budget} rowSpan={hauteur} />}
          </tr>
          <tr className={classe('staff')} onClick={clic}>
            <td className="libelle-part">
              Staff
              <Part v={a.part} de="effectif" />
            </td>
            <Valeurs c={a.effectif} />
          </tr>
        </Fragment>
      ))}
      {ouvert &&
        contrats.map((contrat, i) => (
          <Fragment key={contrat}>
            <tr className={classe('detail-contrat')} onClick={clic}>
              {i === 0 && <EnteteDetail libelle="Détail par type de contrat" lignes={2 * contrats.length} />}
              <td className="retrait libelle-part">
                {contrat}
                <Part v={partsContrat?.[contrat]?.masse} de="masse" />
              </td>
              <Valeurs c={msContrat?.[contrat] ?? VIDE} />
            </tr>
            <tr className={classe('staff detail-contrat')} onClick={clic}>
              <td className="retrait libelle-part">
                Staff {contrat}
                <Part v={partsContrat?.[contrat]?.effectif} de="effectif" />
              </td>
              <Valeurs c={effectifContrat![contrat]} />
            </tr>
          </Fragment>
        ))}
    </>
  )
}

/** 2. Répartition par site, présentée comme la répartition par service (retours N2, point 6) : site fusionné
 *  sur ses activités, une ligne Staff sous chaque activité ; un clic sur le bloc d'un site le déplie par
 *  nature de contrat (masse salariale et Staff). Un seul site déplié à la fois. */
export function Sites({ d, lib }: { d: Blocs; lib: Libelles }) {
  const [ouvert, setOuvert] = useState<string | null>(null)
  // Données sans ventilation par activité (anciens rapports) : une seule ligne « Masse salariale ».
  const parActivite = d.c_site.some((r) => r.activites)
  return (
    <>
      <table className="dense aligne double services">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">{parActivite ? 'Activité' : 'Indicateur'}</th>
            <th scope="col">{lib.prec}</th>
            <th scope="col">{lib.cour}</th>
            <th scope="col">Variation</th>
            <th scope="col">Var. %</th>
            <th scope="col">Budget</th>
            <th scope="col">Écart</th>
            <th scope="col">% Budget</th>
          </tr>
        </thead>
        <tbody>
          {d.c_site.map((r, n) => (
            <BlocRepartition
              key={r.site}
              nom={r.site}
              activites={r.activites ?? [{ activite: 'Masse salariale', ...r.ms, effectif: r.effectif }]}
              budget={r.ms}
              msContrat={r.ms_contrat}
              effectifContrat={r.effectif_contrat}
              partGlobale={r.part_globale}
              partMasseGlobale={r.part_masse_globale}
              partsContrat={r.parts_contrat}
              bande={n % 2 === 1}
              ouvert={ouvert === r.site}
              basculer={() => setOuvert(ouvert === r.site ? null : r.site)}
            />
          ))}
        </tbody>
        <tbody className="pied">
          {d.c_site_total && (
            <>
              <tr className="total">
                <th scope="row" rowSpan={2}>TOTAL GÉNÉRAL</th>
                <td>Masse salariale</td>
                <Valeurs c={d.c_site_total.ms} />
                <Budgets b={d.c_site_total.ms} rowSpan={2} />
              </tr>
              <tr className="total staff">
                <td>Staff</td>
                <Valeurs c={d.c_site_total.effectif} />
              </tr>
            </>
          )}
        </tbody>
      </table>
    </>
  )
}

/** Cellule de la première colonne qui couvre le détail par contrat d'un site ou d'un service déplié. */
const EnteteDetail = ({ libelle, lignes }: { libelle: string; lignes: number }) => (
  <th scope="rowgroup" rowSpan={lignes} className="service detail">
    <span className="detail-libelle">{libelle}</span>
  </th>
)

const VIDE: Cell = { m: null, m1: null, var: null, var_pct: null }

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
