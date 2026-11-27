import type { ReactNode } from 'react'
import { EnteteCol } from './VueAxe'
import type { Charges } from '../../api/types'
import { NB, bas, coutParVente, ent, fp, mt, num, pcServeur, sa, sensVar, signeEnt } from '../../lib/charges'
import type { Libelles } from './Cartes'
import { Fl, NotePartielle } from './Petits'

interface Indic {
  nom: string
  v: number
  v1: number | null
  /** Écart et pourcentage d'écart avec la période comparée, donnés par le serveur. */
  var: number | null
  e: number | null
  o: number | null
  /** Réalisé en % de l'objectif, donné par le serveur. */
  real: number | null
  fmt: (n: number) => string
  /** Une hausse est en rouge (coût). */
  couleur: boolean
}

function Ecart({ v1, variation, e, couleur }: { v1: number | null; variation: number | null; e: number | null; couleur: boolean }) {
  if (v1 == null || variation == null) return <td><i>pas de données</i></td>
  const s = sensVar(variation, e)
  const txt = Math.abs(variation) >= 1e4 ? sa(variation) : signeEnt(variation)
  return (
    <td>
      <Fl s={s} couleur={couleur} /> <span className={couleur && s ? s : undefined}>{txt}</span> ({fp(e)})
    </td>
  )
}

/** Axe Activité : les indicateurs d'activité de la période, avec objectif et réalisé. */
export default function TableauActivite({ d, lib, periode }: { d: Charges; lib: Libelles; periode: string }) {
  const trouve = (cle: string) => d.activite?.find((x) => x.cle === cle)
  const indic: Indic[] = []
  for (const [cle, nom] of [['ventes', 'Ventes'], ['clients', 'Clients'], ['factures', 'Factures atelier']] as const) {
    const l = trouve(cle)
    const v = l ? num(l.m) : null
    if (!l || v == null) continue
    indic.push({ nom, v, v1: num(l.m1), var: num(l.var), e: pcServeur(l.var_pct), o: num(l.budget), real: pcServeur(l.realisation), fmt: ent, couleur: false })
  }
  const { v: cv, v1: cv1, var: cvVar, e: cvE } = coutParVente(d)
  if (cv != null) indic.push({ nom: 'Coût par vente (FCFA)', v: cv, v1: cv1, var: cvVar, e: cvE, o: null, real: null, fmt: mt, couleur: true })
  const cm = d.lignes_ca_marge
  if (cm) {
    const ca = num(cm.ca.m)
    const ma = num(cm.marge.m)
    if (ca != null) indic.push({ nom: "Chiffre d'affaires (FCFA)", v: ca, v1: num(cm.ca.m1), var: num(cm.ca.var), e: pcServeur(cm.ca.var_pct), o: null, real: null, fmt: mt, couleur: false })
    if (ma != null) indic.push({ nom: 'Marge (FCFA)', v: ma, v1: num(cm.marge.m1), var: num(cm.marge.var), e: pcServeur(cm.marge.var_pct), o: null, real: null, fmt: mt, couleur: false })
  }

  const note = cm
    ? "Coût : une hausse est en rouge. CA et marge saisis pour toute l'entreprise."
    : "CA et marge saisis pour toute l'entreprise : masqués avec un filtre ou un compte à périmètre."

  let corps: ReactNode
  if (!indic.length) {
    corps = <tr><td colSpan={6}>Aucune donnée d'activité pour cette sélection.</td></tr>
  } else {
    corps = indic.map((x) => (
      <tr key={x.nom}>
        <th scope="row">{x.nom}</th>
        <td>{x.fmt(x.v)}</td>
        <td>{x.v1 == null ? '—' : x.fmt(x.v1)}</td>
        <Ecart v1={x.v1} variation={x.var} e={x.e} couleur={x.couleur} />
        <td>{x.o ? ent(x.o) : '—'}</td>
        <td>
          {x.o && x.real != null ? <span className={x.real < 100 ? 'hausse' : undefined}>{Math.round(x.real)}{NB}%</span> : '—'}
        </td>
      </tr>
    ))
  }

  return (
    <>
      <h2 className="axe-titre" id="axe-titre" tabIndex={-1}>Activité · {periode}</h2>
      <p className="periode-titre">Chiffres de <strong>{periode}</strong>, évolution par rapport à <strong>{lib.prec}</strong></p>
      <div className="table-scroll">
        <table className="dense axe-table">
          <thead>
            <tr>
              {[
                { h: 'Indicateur' },
                { h: 'Période sélectionnée', sous: periode, aide: `Valeur sur la période sélectionnée : ${periode}` },
                { h: 'Période comparée', sous: bas(lib.prec), aide: `Valeur sur la période à comparer : ${bas(lib.prec)}` },
                { h: 'Écart', aide: 'Écart entre la période sélectionnée et la période comparée' },
                { h: 'Objectif' },
                { h: 'Réalisé', aide: 'Part de l’objectif atteinte sur la période sélectionnée' },
              ].map((e) => <EnteteCol key={e.h} e={e} num={false} />)}
            </tr>
          </thead>
          <tbody>{corps}</tbody>
        </table>
      </div>
      {d.partiel && <div className="charges-note"><NotePartielle /></div>}
      <p className="axe-pied">{note}</p>
    </>
  )
}
