import { Fragment, type ReactNode, useState } from 'react'
import type { Budget, Cell, Mensuel } from '../api/types'
import { cls, entier, fcfa, pct } from '../lib/format'

/** Blocs communs aux onglets MENSUEL et ANNUEL de l'Excel : mêmes tableaux, libellés de période différents. */
export type Blocs = Pick<Mensuel, 'a_type_charge' | 'lignes_ca_marge' | 'b_service_activite' | 'c_site' | 'c_site_total' | 'd_contrat'>
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

function Tete({ premiere, lib, budget }: { premiere: string; lib: Libelles; budget?: boolean }) {
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
            <th scope="col">Budget</th>
            <th scope="col">Écart</th>
            <th scope="col">% Budget</th>
          </>
        )}
      </tr>
    </thead>
  )
}

function Ligne({ label, cell, budget, className }: { label: ReactNode; cell: Cell; budget?: Budget | true; className?: string }) {
  const b = budget === true ? undefined : budget
  return (
    <tr className={className}>
      <th scope="row">{label}</th>
      <td className="num">{fcfa(cell.m1)}</td>
      <td className="num">{fcfa(cell.m)}</td>
      <td className={cls(cell.var)}>{fcfa(cell.var)}</td>
      <td className={cls(cell.var_pct)}>{pct(cell.var_pct)}</td>
      {budget !== undefined && (
        <>
          <td className="num">{fcfa(b?.budget ?? null)}</td>
          <td className={cls(b?.ecart ?? null)}>{fcfa(b?.ecart ?? null)}</td>
          <td className={cls(b?.ecart_pct ?? null)}>{pct(b?.ecart_pct ?? null)}</td>
        </>
      )}
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

/** 1. Reporting global : types de charge, TOTAL GÉNÉRAL, puis CA et marge (hors total, sans budget). */
export function TypesCharge({ d, lib }: { d: Blocs; lib: Libelles }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
  const inclus = d.a_type_charge.filter((r) => r !== total && !r.exclu)
  return (
    <table className="dense tab-global aligne">
      <Tete premiere="Type de charge" lib={lib} budget />
      <tbody>
        {inclus.map((r) => (
          <Ligne key={r.rubrique} label={r.rubrique} cell={r} budget={r} />
        ))}
        {total && <Ligne label="TOTAL GÉNÉRAL" cell={total} budget={total} className="total" />}
        {d.lignes_ca_marge && (
          <>
            <tr className="hors-total-titre">
              <th scope="colgroup" colSpan={COLONNES + 1}>Pour information, hors total</th>
            </tr>
            <Ligne label="Chiffre d'affaires" cell={d.lignes_ca_marge.ca} budget className="hors-total" />
            <Ligne label="Marge" cell={d.lignes_ca_marge.marge} budget className="hors-total" />
          </>
        )}
      </tbody>
    </table>
  )
}

/** Premier chargement : cadre réel de la section 1 (bandeau, titre, en-têtes, TOTAL GÉNÉRAL) à sa taille ;
 *  seules les valeurs issues des données (types de charge, chiffres) sont en squelette. */
export function RapportSquelette({ lib, bandeau }: { lib: Libelles; bandeau: ReactNode }) {
  const chiffres = Array.from({ length: COLONNES }, (_, j) => <td key={j} className="num" />)
  return (
    <div aria-busy="true">
      <p className="bandeau ok">{bandeau}</p>
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

/** 1 bis. Charges exclues du total général : tableau distinct. */
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
    <td className={`${cls(b.ecart ?? null)} budget`} rowSpan={rowSpan}>{fcfa(b.ecart ?? null)}</td>
    <td className={`${cls(b.ecart_pct ?? null)} budget`} rowSpan={rowSpan}>{pct(b.ecart_pct ?? null)}</td>
  </>
)

/** 3. Répartition par service et activité, présentée comme l'onglet Excel : service fusionné sur ses activités,
 *  une ligne Staff (effectif) sous chaque activité, budget fusionné par service, puis total et effectif global.
 *  Un clic sur le bloc d'un service le déplie par nature de contrat, comme les sites. */
export function ServicesActivites({ d, lib }: { d: Blocs; lib: Libelles }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
  const [ouvert, setOuvert] = useState<string | null>(null)
  return (
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
          <ServiceBloc
            key={b.service}
            b={b}
            bande={n % 2 === 1}
            ouvert={ouvert === b.service}
            basculer={() => setOuvert(ouvert === b.service ? null : b.service)}
          />
        ))}
        {total && (
          <tr className="total">
            <th scope="row" colSpan={2}>TOTAL GÉNÉRAL</th>
            <Valeurs c={total} />
            <Budgets b={total} />
          </tr>
        )}
        <tr className="staff">
          <th scope="row" colSpan={2}>Effectif global</th>
          <Valeurs c={d.d_contrat.total} />
          <td colSpan={3} />
        </tr>
      </tbody>
    </table>
  )
}

/** Le damier alterne par service (bande), pas par ligne : les cellules fusionnées suivent leur bloc. */
function ServiceBloc({ b, bande, ouvert, basculer }: {
  b: Blocs['b_service_activite'][number]; bande: boolean; ouvert: boolean; basculer: () => void
}) {
  const activites = b.activites
  const contrats = Object.keys(b.effectif_contrat ?? {})
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
                  <button type="button" className="deplier" aria-expanded={ouvert} aria-label={`Détail par contrat de ${b.service}`}>
                    <span aria-hidden="true">{ouvert ? '▾' : '▸'}</span> {b.service}
                  </button>
                ) : (
                  b.service
                )}
              </th>
            )}
            <td>{a.activite}</td>
            <Valeurs c={a} />
            {i === 0 && <Budgets b={b.total} rowSpan={hauteur} />}
          </tr>
          <tr className={classe('staff')} onClick={clic}>
            <td>Staff</td>
            <Valeurs c={a.effectif} />
          </tr>
        </Fragment>
      ))}
      {ouvert &&
        contrats.map((contrat, i) => (
          <Fragment key={contrat}>
            <tr className={classe('detail-contrat')} onClick={clic}>
              {i === 0 && <EnteteDetail libelle="Détail par type de contrat" lignes={2 * contrats.length} />}
              <td className="retrait">{contrat}</td>
              <Valeurs c={b.ms_contrat?.[contrat] ?? VIDE} />
            </tr>
            <tr className={classe('staff detail-contrat')} onClick={clic}>
              <td className="retrait">Staff {contrat}</td>
              <Valeurs c={b.effectif_contrat![contrat]} />
            </tr>
          </Fragment>
        ))}
    </>
  )
}

/** 2. Répartition par site, présentée comme la répartition par service : site fusionné sur ses lignes,
 *  masse salariale puis Staff (effectif) ; un clic sur le bloc d'un site le déplie par nature de contrat
 *  (masse salariale et Staff). Un seul site déplié à la fois. */
export function Sites({ d, lib }: { d: Blocs; lib: Libelles }) {
  const [ouvert, setOuvert] = useState<string | null>(null)
  return (
    <table className="dense aligne double services">
      <thead>
        <tr>
          <th scope="col">Site</th>
          <th scope="col">Indicateur</th>
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
          <SiteBloc
            key={r.site}
            r={r}
            bande={n % 2 === 1}
            ouvert={ouvert === r.site}
            basculer={() => setOuvert(ouvert === r.site ? null : r.site)}
          />
        ))}
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
  )
}

function SiteBloc({ r, bande, ouvert, basculer }: {
  r: Blocs['c_site'][number]; bande: boolean; ouvert: boolean; basculer: () => void
}) {
  const contrats = Object.keys(r.effectif_contrat ?? {})
  const fond = bande ? 'bande' : ''
  const hauteur = 2 + (ouvert ? 2 * contrats.length : 0)
  const depliable = contrats.length > 0
  // Tout le bloc du site est cliquable : un clic sur n'importe laquelle de ses lignes le déplie ou le replie.
  const clic = depliable ? basculer : undefined
  const classe = (base: string) => `${base} ${depliable ? 'depliable' : ''} ${fond}`.replace(/\s+/g, ' ').trim()
  return (
    <>
      <tr className={classe('debut-service')} onClick={clic}>
        <th scope="rowgroup" rowSpan={2} className={ouvert ? 'service ouvert' : 'service'}>
          {depliable ? (
            <button type="button" className="deplier" aria-expanded={ouvert} aria-label={`Détail par contrat de ${r.site}`}>
              <span aria-hidden="true">{ouvert ? '▾' : '▸'}</span> {r.site}
            </button>
          ) : (
            r.site
          )}
        </th>
        <td>Masse salariale</td>
        <Valeurs c={r.ms} />
        <Budgets b={r.ms} rowSpan={hauteur} />
      </tr>
      <tr className={classe('staff')} onClick={clic}>
        <td>Staff</td>
        <Valeurs c={r.effectif} />
      </tr>
      {ouvert &&
        contrats.map((contrat, i) => (
          <Fragment key={contrat}>
            <tr className={classe('detail-contrat')} onClick={clic}>
              {i === 0 && <EnteteDetail libelle="Détail par type de contrat" lignes={2 * contrats.length} />}
              <td className="retrait">{contrat}</td>
              <Valeurs c={r.ms_contrat?.[contrat] ?? VIDE} />
            </tr>
            <tr className={classe('staff detail-contrat')} onClick={clic}>
              <td className="retrait">Staff {contrat}</td>
              <Valeurs c={r.effectif_contrat![contrat]} />
            </tr>
          </Fragment>
        ))}
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

/** 5. Analyse des effectifs : total puis par nature de contrat. */
export function AnalyseEffectifs({ d }: { d: Blocs }) {
  const cols = [d.d_contrat.indicateurs[d.d_contrat.indicateurs.length - 1], ...d.d_contrat.indicateurs.slice(0, -1)]
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
        {ligne('Effectif fin de période', (i) => entier(i.fin), 'total')}
        {ligne('Taux de rotation', (i) => pct(i.taux_rotation))}
        {ligne('Nombre d’absences (jours)', (i) => fcfa(i.absences))}
        {ligne('Taux d’absentéisme', (i) => pct(i.taux_absenteisme))}
      </tbody>
    </table>
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
        {total && (
          <tr className="total">
            <th scope="row" colSpan={2}>TOTAL GÉNÉRAL</th>
            <Valeurs c={total} />
          </tr>
        )}
        <tr className="staff">
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
