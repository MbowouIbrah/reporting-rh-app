import { NB, abr, ent, fp, mt, sensPc, signeEnt } from '../../lib/charges'

/** Variation en valeur puis en pourcentage, toutes deux données par le serveur ; « — » sans période comparée. */
export function CVar({ n1, variation, e, muet }: { n1: number | null; variation: number | null; e: number | null; muet?: boolean }) {
  if (!n1 || variation == null) return <td className={`num cel-var${muet ? ' muet' : ''}`}>—</td>
  return (
    <td className="num cel-var" title={`Variation : ${mt(variation)} FCFA`}>
      {(variation >= 0 ? '+' : '') + abr(variation)}
      <span className={`pc ${sensPc(e)}`}>{fp(e)}</span>
    </td>
  )
}

/** Budget de la période et taux de consommation (serveur) ; « — » sans budget. */
export function CBud({ bu, ecart, real }: { bu: number | null; ecart: number | null; real: number | null }) {
  if (!bu) return <td className="num cel-bud">—</td>
  return (
    <td className="num cel-bud" title={ecart == null ? undefined : `Écart budget : ${mt(ecart)} FCFA`}>
      {abr(bu)}
      {real != null && <span className={`pc${real > 100 ? ' hausse' : ''}`}>{Math.round(real)}{NB}%</span>}
    </td>
  )
}

/** Effectif payé et écart avec la période comparée (donné par le serveur). */
export function CEff({ eff, ecart }: { eff: number; ecart: number | null }) {
  return (
    <td className="num">
      {ent(eff)}
      {ecart != null && <span className="var-eff" title="Écart avec la période comparée">{signeEnt(ecart)}</span>}
    </td>
  )
}
