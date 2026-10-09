import { Fragment, type ReactNode } from 'react'
import type { Budget, Cell, Mensuel, Val } from '../api/types'
import { cls, entier, fcfa, pct } from '../lib/format'

/** Blocs communs aux onglets MENSUEL et ANNUEL de l'Excel : mêmes tableaux, libellés de période différents. */
export type Blocs = Pick<Mensuel, 'a_type_charge' | 'b_service_activite' | 'c_site' | 'd_contrat'>
export interface Libelles {
  prec: string
  cour: string
}

const nonNul = (v: string | null) => v !== null && Number(v) !== 0

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

const num = (v: number | string | null | undefined) => (v == null ? '—' : fcfa(v))

// Grille commune des tableaux : un libellé puis sept colonnes de chiffres ; un tableau plus court
// complète sa ligne par une cellule vide pour garder ses colonnes alignées sur les autres.
const COLONNES = 7
function Bourrage({ n, tete }: { n: number; tete?: boolean }) {
  if (n <= 0) return null
  return tete ? <th className="bourrage" colSpan={n} aria-hidden="true" /> : <td className="bourrage" colSpan={n} aria-hidden="true" />
}

/** 1. Reporting global : types de charge, TOTAL GÉNÉRAL en dernière ligne. */
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
 *  une ligne Staff (effectif) sous chaque activité, budget fusionné par service, puis total et effectif global. */
export function ServicesActivites({ d, lib }: { d: Blocs; lib: Libelles }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
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
        {d.b_service_activite
          .filter((b) => nonNul(b.total.m) || nonNul(b.total.m1))
          .map((b, n) => (
            <ServiceBloc key={b.service} b={b} bande={n % 2 === 1} />
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
function ServiceBloc({ b, bande }: { b: Blocs['b_service_activite'][number]; bande: boolean }) {
  const activites = b.activites.filter((a) => nonNul(a.m) || nonNul(a.m1))
  const fond = bande ? 'bande' : ''
  return activites.map((a, i) => (
    <Fragment key={a.activite}>
      <tr className={`${i === 0 ? 'debut-service ' : ''}${fond}`.trim() || undefined}>
        {i === 0 && (
          <th scope="rowgroup" rowSpan={activites.length * 2} className="service">
            {b.service}
          </th>
        )}
        <td>{a.activite}</td>
        <Valeurs c={a} />
        {i === 0 && <Budgets b={b.total} rowSpan={activites.length * 2} />}
      </tr>
      <tr className={`staff ${fond}`.trim()}>
        <td>Staff</td>
        <Valeurs c={a.effectif} />
      </tr>
    </Fragment>
  ))
}

/** 2. Répartition par site : une ligne MS et une ligne Eff par site. */
export function Sites({ d, lib }: { d: Blocs; lib: Libelles }) {
  return (
    <table className="dense aligne double">
      <thead>
        <tr>
          <th scope="col">Site</th>
          <th scope="col">Rubrique</th>
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
        {d.c_site.map((r) => (
          <SiteLignes key={r.site} r={r} />
        ))}
      </tbody>
    </table>
  )
}

function SiteLignes({ r }: { r: Blocs['c_site'][number] }) {
  return (
    <>
      <tr className="groupe">
        <th scope="row">{r.site}</th>
        <td>MS</td>
        <td className="num">{fcfa(r.ms.m1)}</td>
        <td className="num">{fcfa(r.ms.m)}</td>
        <td className={cls(r.ms.var)}>{fcfa(r.ms.var)}</td>
        <td className={cls(r.ms.var_pct)}>{pct(r.ms.var_pct)}</td>
        <td className="num">{fcfa(r.ms.budget ?? null)}</td>
        <td className={cls(r.ms.ecart ?? null)}>{fcfa(r.ms.ecart ?? null)}</td>
        <td className={cls(r.ms.ecart_pct ?? null)}>{pct(r.ms.ecart_pct ?? null)}</td>
      </tr>
      <tr className="sous">
        <th scope="row" />
        <td>Eff</td>
        <td className="num">{num(r.effectif.m1)}</td>
        <td className="num">{num(r.effectif.m)}</td>
        <td colSpan={5} />
      </tr>
    </>
  )
}

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
        {ligne('Effectif début', (i) => entier(i.debut))}
        {ligne('Recrutements', (i) => entier(i.recrutements))}
        {ligne('Départs', (i) => entier(i.departs))}
        {ligne('Effectif fin', (i) => entier(i.fin), 'total')}
        {ligne('Taux de rotation', (i) => pct(i.taux_rotation))}
        {ligne('Absences (jours)', (i) => fcfa(i.absences))}
        {ligne('Taux d’absentéisme', (i) => pct(i.taux_absenteisme))}
      </tbody>
    </table>
  )
}

/** 4. Nature de contrat × activité : masse salariale et effectifs. */
export function Contrats({ d, lib }: { d: Blocs; lib: Libelles }) {
  const total = d.a_type_charge.find((r) => r.rubrique === 'TOTAL CHARGES')
  const lignes = d.d_contrat.ventilation.filter(
    (v) => nonNul(v.ms.m) || nonNul(v.ms.m1) || nonNul(v.effectif.m) || nonNul(v.effectif.m1),
  )
  return (
    <table className="dense aligne double">
      <thead>
        <tr>
          <th scope="col">Contrat · activité</th>
          <th scope="col" className="libelle">Indicateur</th>
          <Bourrage n={3} tete />
          <th scope="col">{lib.prec}</th>
          <th scope="col">{lib.cour}</th>
          <th scope="col">Variation</th>
          <th scope="col">Var. %</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((v) => (
          <ContratLignes key={`${v.contrat}-${v.activite}`} titre={`${v.contrat} · ${v.activite}`} ms={v.ms} eff={v.effectif} />
        ))}
        {total && <ContratLignes titre="TOTAL GÉNÉRAL" ms={total} eff={d.d_contrat.total} total />}
      </tbody>
    </table>
  )
}

function ContratLignes({ titre, ms, eff, total }: { titre: string; ms: Cell; eff: Cell; total?: boolean }) {
  const l = (indic: string, c: Cell, premiere: boolean) => (
    <tr className={total ? 'total' : premiere ? 'groupe' : 'sous'}>
      <th scope="row">{premiere ? titre : ''}</th>
      <td>{indic}</td>
      <Bourrage n={3} />
      <td className="num">{fcfa(c.m1)}</td>
      <td className="num">{fcfa(c.m)}</td>
      <td className={cls(c.var)}>{fcfa(c.var)}</td>
      <td className={cls(c.var_pct)}>{pct(c.var_pct as Val)}</td>
    </tr>
  )
  return (
    <>
      {l('Masse salariale', ms, true)}
      {l('Effectifs', eff, false)}
    </>
  )
}
