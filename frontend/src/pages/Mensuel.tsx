import { useQuery } from '@tanstack/react-query'
import { getMensuel } from '../api/rapports'
import type { Indicateurs, Mensuel as MensuelData } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import LienExport from '../components/LienExport'
import { Section } from '../components/Kit'
import Tuile from '../components/Tuile'
import { EnTete, LigneCell } from '../components/Lignes'
import { useFiltres } from '../hooks/useFiltres'
import { cls, entier, fcfa, MOIS, pct } from '../lib/format'

const nonNul = (v: string | null) => v !== null && Number(v) !== 0

export default function Mensuel() {
  const f = useFiltres()
  const q = useQuery({
    queryKey: ['mensuel', f.filtres],
    queryFn: () => getMensuel(f.filtres!),
    enabled: !!f.filtres,
  })

  return (
    <section>
      <h2>Reporting mensuel</h2>
      {f.filtres && (
        <FiltresPeriode filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} onChange={f.set} />
      )}
      {q.data && f.filtres && <LienExport rapport="mensuel" filtres={f.filtres} />}
      {f.vide && <Etat type="vide" />}
      {q.isLoading && <Etat type="chargement" />}
      {q.error && <Etat type={etatErreur(q.error)} />}
      {q.data && f.filtres && <Contenu d={q.data} titre={`${MOIS[f.filtres.mois - 1]} ${f.filtres.annee}`} />}
    </section>
  )
}

function Contenu({ d, titre }: { d: MensuelData; titre: string }) {
  const s = d.synthese
  const bloquants = d.controles.filter((c) => c.bloquant)
  return (
    <>
      <p className="micro">{titre}</p>
      <div className={bloquants.length ? 'controles ko' : 'controles ok'} role="status">
        {bloquants.length
          ? `Contrôles en écart : ${bloquants.map((c) => c.controle).join(' ; ')}`
          : 'Contrôles de cohérence : OK'}
      </div>

      <div className="tuiles">
        <Tuile titre="Masse salariale" valeur={fcfa(s.ms.m)} cell={s.ms} hero />
        <Tuile titre="Commissions" valeur={fcfa(s.commissions.m)} cell={s.commissions} />
        <Tuile titre="Effectif fin de mois" valeur={entier(s.effectif.fin)} />
        <Tuile titre="Absentéisme" valeur={pct(s.taux_absenteisme)} />
      </div>

      <Section titre="Synthèse">
      <div className="table-scroll"><table className="dense">
        <EnTete premiere="Indicateur" budget />
        <tbody>
          <LigneCell label="Masse salariale" cell={s.ms} budget={s.ms} className="total" />
          <LigneCell label="Commissions" cell={s.commissions} />
          <LigneCell label="Primes (ventes, résultats, productivité)" cell={s.primes_total} />
          <LigneCell label="Absences (jours)" cell={s.absences} />
          <tr>
            <th scope="row">Effectif (début → fin)</th>
            <td className="num">{entier(s.effectif.debut)}</td>
            <td className="num">{entier(s.effectif.fin)}</td>
            <td className={cls(s.effectif.variation)}>{fcfa(s.effectif.variation)}</td>
            <td />
          </tr>
          <tr>
            <th scope="row">Taux de rotation</th>
            <td />
            <td className="num">{pct(s.taux_rotation)}</td>
            <td colSpan={2} />
          </tr>
          <tr>
            <th scope="row">Taux d’absentéisme</th>
            <td />
            <td className="num">{pct(s.taux_absenteisme)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table></div>
      </Section>

      <Section titre="A. Par type de charge" ouverte={true}>
      <div className="table-scroll"><table className="dense">
        <EnTete premiere="Type de charge" budget />
        <tbody>
          {d.a_type_charge.map((r) => (
            <LigneCell
              key={r.rubrique}
              label={r.exclu ? <em>{r.rubrique} (exclu)</em> : r.rubrique}
              cell={r}
              budget={r}
              className={r.rubrique === 'TOTAL CHARGES' ? 'total' : r.exclu ? 'exclu' : undefined}
            />
          ))}
        </tbody>
      </table></div>
      </Section>

      <Section titre="B. Par service et activité" ouverte={false}>
      <div className="table-scroll"><table className="dense">
        <EnTete premiere="Service / activité" budget />
        <tbody>
          {d.b_service_activite
            .filter((b) => nonNul(b.total.m) || nonNul(b.total.m1))
            .map((b) => (
              <ServiceBloc key={b.service} b={b} />
            ))}
        </tbody>
      </table></div>
      </Section>

      <Section titre="C. Par site" ouverte={false}>
      <div className="table-scroll"><table className="dense">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">MS M-1</th>
            <th scope="col">MS M</th>
            <th scope="col">Variation</th>
            <th scope="col">Var. %</th>
            <th scope="col">Eff. M-1</th>
            <th scope="col">Eff. M</th>
            <th scope="col">Budget</th>
            <th scope="col">Écart</th>
            <th scope="col">% Budget</th>
          </tr>
        </thead>
        <tbody>
          {d.c_site.map((r) => (
            <tr key={r.site}>
              <th scope="row">{r.site}</th>
              <td className="num">{fcfa(r.ms.m1)}</td>
              <td className="num">{fcfa(r.ms.m)}</td>
              <td className={cls(r.ms.var)}>{fcfa(r.ms.var)}</td>
              <td className={cls(r.ms.var_pct)}>{pct(r.ms.var_pct)}</td>
              <td className="num">{entier(r.effectif.m1)}</td>
              <td className="num">{entier(r.effectif.m)}</td>
              <td className="num">{fcfa(r.ms.budget ?? null)}</td>
              <td className={cls(r.ms.ecart ?? null)}>{fcfa(r.ms.ecart ?? null)}</td>
              <td className={cls(r.ms.ecart_pct ?? null)}>{pct(r.ms.ecart_pct ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      </Section>

      <Section titre="D. Par type de contrat" ouverte={false}>
      <div className="table-scroll"><table className="dense">
        <thead>
          <tr>
            <th scope="col">Indicateur</th>
            {d.d_contrat.indicateurs.map((i) => (
              <th scope="col" key={i.contrat}>
                {i.contrat}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Ligne label="Effectif début" f={(i) => entier(i.debut)} d={d} />
          <Ligne label="Recrutements" f={(i) => entier(i.recrutements)} d={d} />
          <Ligne label="Départs" f={(i) => entier(i.departs)} d={d} />
          <Ligne label="Effectif fin" f={(i) => entier(i.fin)} d={d} />
          <Ligne label="Taux de rotation" f={(i) => pct(i.taux_rotation)} d={d} />
          <Ligne label="Absences (jours)" f={(i) => fcfa(i.absences)} d={d} />
          <Ligne label="Taux d’absentéisme" f={(i) => pct(i.taux_absenteisme)} d={d} />
        </tbody>
      </table></div>
      <div className="table-scroll"><table className="dense">
        <EnTete premiere="Contrat × activité (masse salariale)" />
        <tbody>
          {d.d_contrat.ventilation
            .filter((v) => nonNul(v.ms.m) || nonNul(v.ms.m1))
            .map((v) => (
              <LigneCell key={`${v.contrat}-${v.activite}`} label={`${v.contrat} · ${v.activite}`} cell={v.ms} />
            ))}
        </tbody>
      </table></div>
      </Section>
      <p className="note">
        L’Excel d’origine présente un écart d’arrondi de 11 FCFA sur certains totaux ; l’application est exacte.
      </p>
    </>
  )
}

function Ligne({
  label,
  f,
  d,
}: {
  label: string
  f: (i: Indicateurs) => string
  d: MensuelData
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {d.d_contrat.indicateurs.map((i) => (
        <td className="num" key={i.contrat}>
          {f(i)}
        </td>
      ))}
    </tr>
  )
}

function ServiceBloc({ b }: { b: MensuelData['b_service_activite'][number] }) {
  return (
    <>
      <LigneCell label={`${b.service} (effectif ${entier(Number(b.effectif.m))})`} cell={b.total} budget={b.total} className="groupe" />
      {b.activites
        .filter((a) => nonNul(a.m) || nonNul(a.m1))
        .map((a) => (
          <LigneCell key={a.activite} label={`${a.activite} (effectif ${entier(Number(a.effectif.m))})`} cell={a} className="sous" />
        ))}
    </>
  )
}
