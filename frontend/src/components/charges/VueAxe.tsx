import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { FiltresPage } from '../../api/rapports'
import type { Charges } from '../../api/types'
import { useLignesFigees } from '../../hooks/useLignesFigees'
import {
  NB, NOM_AXE, PREMIER_LIBELLE, type Noeud, abr, bas, chemin, ent, mt, noeud, num, partR, pcServeur, signeEnt,
} from '../../lib/charges'
import type { AxeVue } from '../../lib/charges'
import { libelleTexte } from '../../lib/periode'
import { CBud, CEff, CVar } from './Cellules'
import type { Libelles } from './Cartes'
import ListePersonnes from './ListePersonnes'
import { NotePartielle } from './Petits'

interface Props {
  d: Charges
  axe: Exclude<AxeVue, 'act'>
  filtres: FiltresPage
  lib: Libelles
  peutNominatif: boolean
}

function raisonDe(d: Charges, axe: Props['axe']) {
  return axe === 'eff' ? null : d.axes[axe].budget_raison
}

function amener(racine: HTMLElement | null, niveau: number, nom: string) {
  const r = Array.from(racine?.querySelectorAll<HTMLTableRowElement>('tr.ligne') ?? []).find(
    (x) => x.dataset.d === String(niveau) && x.dataset.k === nom,
  )
  if (!r) return
  const t = r.closest('table')
  r.style.scrollMarginTop = (r.dataset.top ? Number(r.dataset.top) : (t?.tHead?.offsetHeight ?? 0)) + 'px'
  const reduit = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof r.scrollIntoView === 'function') r.scrollIntoView({ block: 'start', behavior: reduit ? 'auto' : 'smooth' })
  r.querySelector<HTMLElement>('.depli-ligne')?.focus({ preventScroll: true })
}

interface LigneProps {
  x: Noeud
  niveau: number
  ouverte: boolean
  ouvrable: boolean
  eff: boolean
  onBascule: () => void
}

/** Une ligne de l'arbre : mêmes colonnes à tous les niveaux. */
function Ligne({ x, niveau, ouverte, ouvrable, eff, onBascule }: LigneProps) {
  const classes = ['ligne', niveau === 1 ? 'niv1' : niveau >= 2 ? 'niv2' : '', ouverte ? 'ouverte' : ''].filter(Boolean).join(' ')
  const part = <td className="num">{x.part == null ? '—' : partR(x.part)}</td>
  return (
    <tr className={classes} data-d={niveau} data-k={x.nom} onClick={ouvrable ? onBascule : undefined}>
      <th scope="row" title={x.primes ? 'Primes : comparées au même mois un an plus tôt' : undefined}>
        {ouvrable ? (
          <button type="button" className="depli-ligne" aria-expanded={ouverte}>
            <span className="chevron" aria-hidden="true">{ouverte ? '▾' : '▸'}</span> {x.nom}
          </button>
        ) : (
          x.nom
        )}
      </th>
      {eff ? (
        <>
          <td className="num">{x.eff1 == null ? '—' : ent(x.eff1)}</td>
          <td className="num">{ent(x.eff)}</td>
          <td className="num">{x.effVar == null ? '—' : signeEnt(x.effVar)}</td>
          {part}
          <td className="num">{x.entrees == null ? '—' : ent(x.entrees)}</td>
          <td className="num">{x.sorties == null ? '—' : ent(x.sorties)}</td>
        </>
      ) : (
        <>
          <td className="num">{x.n1 == null ? '—' : mt(x.n1)}</td>
          <td className="num">{mt(x.n)}</td>
          <CVar n1={x.n1} variation={x.variation} e={x.e} />
          {part}
          <CEff eff={x.eff} ecart={x.effVar} />
          <CBud bu={x.bu} ecart={x.ecartBu} real={x.real} />
        </>
      )}
    </tr>
  )
}

/** Tableau d'un axe, dépliable sur place : ligne, puis activité (service pour un site), puis personnes. */
export default function VueAxe({ d, axe, filtres, lib, peutNominatif }: Props) {
  const eff = axe === 'eff'
  const nom = NOM_AXE[axe]
  const racine = useRef<HTMLElement>(null)
  const [ouv, setOuv] = useState<string[]>([])
  const [fermeAuto, setFermeAuto] = useState(false)
  const [annonce, setAnnonce] = useState('')
  const cible = useRef<{ niveau: number; nom: string } | null>(null)

  const racines = useMemo(() => {
    const lignes = (eff ? d.axes.service : d.axes[axe]).lignes.map(noeud)
    return eff
      ? lignes.filter((x) => x.eff > 0 || (x.eff1 ?? 0) > 0).sort((a, b) => b.eff - a.eff)
      : lignes
  }, [d, axe, eff])
  const ouvert = chemin(racines, ouv, fermeAuto)
  useLignesFigees(racine, ouvert.join('|'))

  useEffect(() => {
    if (!cible.current) return
    amener(racine.current, cible.current.niveau, cible.current.nom)
    cible.current = null
  })

  const bascule = (niveau: number, k: string) => {
    const ferme = ouvert[niveau] === k
    setOuv(ferme ? ouvert.slice(0, niveau) : [...ouvert.slice(0, niveau), k])
    if (ferme) setFermeAuto(true)
    cible.current = { niveau, nom: k }
    setAnnonce(`${k} : détail ${ferme ? 'replié' : 'affiché'}`)
  }
  const echap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || !ouvert.length) return
    const niveau = ouvert.length - 1
    setOuv(ouvert.slice(0, niveau))
    setFermeAuto(true)
    cible.current = { niveau, nom: ouvert[niveau] }
    setAnnonce(`${ouvert[niveau]} : détail replié`)
  }

  const nc = 7
  const lignes: ReactNode[] = []
  const rendre = (items: Noeud[], niveau: number) => {
    for (const x of items) {
      const ouverte = ouvert[niveau] === x.nom
      const aEnfants = (x.enfants?.length ?? 0) > 1
      lignes.push(
        <Ligne key={`${niveau}|${x.nom}`} x={x} niveau={niveau} ouverte={ouverte} ouvrable={aEnfants || peutNominatif} eff={eff} onBascule={() => bascule(niveau, x.nom)} />,
      )
      if (!ouverte) continue
      if (aEnfants) rendre(x.enfants as Noeud[], niveau + 1)
      else if (peutNominatif) {
        lignes.push(
          <ListePersonnes
            key={`p|${ouvert.join('|')}`}
            nom={x.nom}
            nc={nc}
            eff={eff}
            axe={eff ? 'service' : axe}
            valeur={ouvert[0]}
            ligneActivite={niveau >= 1 ? ouvert[1] : undefined}
            filtres={filtres}
          />,
        )
      }
    }
  }
  rendre(racines, 0)

  if (!racines.length) {
    return (
      <>
        <h2 className="sr-only" id="axe-titre" tabIndex={-1}>{nom}</h2>
        <p className="vide-bloc">Aucune donnée pour cette sélection.</p>
      </>
    )
  }

  const raison = raisonDe(d, axe)
  const hors = num(d.hors_total.montant) ?? 0
  const notes = [
    eff ? 'Effectif : personnes payées sur la période. Entrée = absente de la période comparée ; sortie = absente de la période choisie.' : '',
    !eff && raison ? raison : '',
    axe === 'type' && d.hors_total.nb_rubriques
      ? `+ ${abr(hors)} FCFA non compris dans le total (${d.hors_total.nb_rubriques} rubriques).`
      : '',
    axe === 'type' && d.cmp_primes_du
      ? `Primes : comparées à ${bas(libelleTexte(d.cmp_primes_du, d.cmp_primes_au ?? undefined))}, le même mois un an plus tôt.`
      : '',
  ].filter(Boolean)

  const total = { n: num(d.total.m) ?? 0, n1: num(d.total.m1) }
  const bt = eff || raison ? null : d.axes[axe].budget_total
  const buT = bt ? num(bt.budget) : null
  const premier = PREMIER_LIBELLE[axe]
  const entetes = eff
    ? [premier, `Effectif ${lib.prec}`, `Effectif ${lib.cour}`, 'Variation', 'Part', 'Entrées', 'Sorties']
    : [premier, lib.prec, lib.cour, 'Variation', 'Part', 'Effectif', 'Budget']
  const e1 = d.effectif.n1
  const eVar = d.effectif.var

  return (
    <>
      <h2 className="sr-only" id="axe-titre" tabIndex={-1}>{nom}</h2>
      <div className="charges-corps">
        <section className="panneau" aria-label={nom} ref={racine}>
          <div className="panneau-corps">
            <table className="dense aligne large arbre" onKeyDown={echap}>
              <colgroup>
                <col className="c-lib" />
                {Array.from({ length: nc - 1 }, (_, i) => <col key={i} />)}
              </colgroup>
              <thead>
                <tr>{entetes.map((h, i) => <th key={i} scope="col" className={i ? 'num' : undefined}>{h}</th>)}</tr>
              </thead>
              <tbody>{lignes}</tbody>
              <tbody className="pied">
                <tr className="total">
                  <th scope="row">TOTAL</th>
                  {eff ? (
                    <>
                      <td className="num">{e1 == null ? '—' : ent(e1)}</td>
                      <td className="num">{ent(d.effectif.n)}</td>
                      <td className="num">{eVar == null ? '—' : signeEnt(eVar)}</td>
                      <td className="num">100{NB}%</td>
                      <td className="num">{d.entrees == null ? '—' : ent(d.entrees)}</td>
                      <td className="num">{d.sorties == null ? '—' : ent(d.sorties)}</td>
                    </>
                  ) : (
                    <>
                      <td className="num">{total.n1 == null ? '—' : mt(total.n1)}</td>
                      <td className="num">{mt(total.n)}</td>
                      <CVar n1={total.n1} variation={num(d.total.var)} e={pcServeur(d.total.var_pct)} />
                      <td className="num">100{NB}%</td>
                      <CEff eff={d.effectif.n} ecart={eVar} />
                      <CBud bu={buT} ecart={bt ? num(bt.ecart_budget) : null} real={bt ? pcServeur(bt.realisation) : null} />
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {d.partiel && <div className="charges-note"><NotePartielle /></div>}
      {notes.length > 0 && <p className="axe-pied">{notes.join(' ')}</p>}
      <p className="sr-only" role="status">{annonce}</p>
    </>
  )
}
