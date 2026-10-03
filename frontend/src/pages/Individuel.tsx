import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { getIndividuelTous, getSalaries } from '../api/rapports'
import type { Val } from '../api/types'
import { Panneau } from '../components/BlocsRapport'
import Etat, { etatErreur } from '../components/Etat'
import { useFiltres } from '../hooks/useFiltres'
import { cls, fcfa, MOIS, somme } from '../lib/format'

/** Les 12 postes de l'onglet Excel, dans l'ordre du fichier. */
const COLONNES = [
  'Crédit téléphonique',
  'Brut Réel',
  'Commission',
  'Charges Patronales',
  'Frais de mission',
  'Salaire brut garantie',
  'Primes exceptionnelles',
  'Logement site déporté',
  'Carburant véhicule service',
  'Assurance Maladie',
  'TVA & Marge MAD',
  'Formation',
]

/** Reporting individuel, calqué sur l'onglet REPORTING_RH_INDIVIDUEL : tous les employés par défaut. */
export default function Individuel() {
  const f = useFiltres()
  const [matricule, setMatricule] = useState('')
  const annee = f.filtres?.annee
  const service = f.filtres?.service
  const site = f.filtres?.site
  const salaries = useQuery({
    queryKey: ['salaries', annee],
    queryFn: () => getSalaries(annee!),
    enabled: annee !== undefined,
  })
  const q = useQuery({
    queryKey: ['individuel-tous', annee, matricule, service, site],
    queryFn: () => getIndividuelTous({ annee: annee!, matricule, service, site }),
    enabled: annee !== undefined,
  })
  const d = q.data
  const rubriques = COLONNES
  const totalMois = (m: NonNullable<typeof d>['mois'][number]) =>
    somme(rubriques.map((r) => m.montants?.[r] ?? null)) ?? '0'
  const val = (v: Val | undefined) => v ?? '0'
  const totalRub = (r: string) => somme((d?.mois ?? []).map((m) => m.montants?.[r] ?? null)) ?? '0'
  const totalStaff = (r: string) => (d?.mois ?? []).reduce((n, m) => n + (m.staff?.[r] ?? 0), 0)

  return (
    <section className="page-ecran page-etroite rapport-excel individuel-excel">
      <h2 className="bandeau-titre">REPORTING INDIVIDUEL</h2>
      {f.filtres && (
        <div className="filtres" role="group" aria-label="Filtres">
          <label>
            Matricule
            <select value={matricule} onChange={(e) => setMatricule(e.target.value)}>
              <option value="">(Tous)</option>
              {salaries.data?.map((s) => (
                <option key={s.matricule} value={s.matricule}>
                  {s.matricule} — {s.nom}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nom
            <select value={matricule} onChange={(e) => setMatricule(e.target.value)}>
              <option value="">(Tous)</option>
              {salaries.data?.map((s) => (
                <option key={s.matricule} value={s.matricule}>
                  {s.nom}
                </option>
              ))}
            </select>
          </label>
          <label>
            Site
            <select value={site ?? ''} onChange={(e) => f.set({ site: e.target.value })}>
              <option value="">(Tous)</option>
              {f.sites.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Service
            <select value={service ?? ''} onChange={(e) => f.set({ service: e.target.value })}>
              <option value="">(Tous)</option>
              {f.services.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Année
            <select value={f.filtres.annee} onChange={(e) => f.set({ annee: e.target.value, mois: undefined })}>
              {f.annees.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {d && (
        <p className="note note-entete">
          {d.matricule
            ? `Employé retenu : ${d.nom} (${d.matricule})`
            : 'Aucun employé sélectionné — les listes ci-dessus restent toutes ouvertes.'}
        </p>
      )}
      {f.vide && <Etat type="vide" />}
      {q.isLoading && <Etat type="chargement" />}
      {q.error && <Etat type={etatErreur(q.error)} />}
      {d && (
        <Panneau titre="Reporting individuel">
          <table className="dense individuel">
            <thead>
              <tr>
                <th scope="col">Mois</th>
                {rubriques.map((r) => (
                  <th scope="col" key={r}>
                    {r}
                  </th>
                ))}
                <th scope="col">Total mensuel</th>
                <th scope="col">Total budget</th>
              </tr>
            </thead>
            <tbody>
              {d.mois.map((m) => (
                <Fragment key={m.mois}>
                  <tr className="groupe">
                    <th scope="row">{MOIS[m.mois - 1]}</th>
                    {rubriques.map((r) => (
                      <td className={cls(val(m.montants?.[r]))} key={r}>
                        {fcfa(val(m.montants?.[r]))}
                      </td>
                    ))}
                    <td className="num">{fcfa(totalMois(m))}</td>
                    <td className="num">{fcfa(val(m.budget ?? undefined))}</td>
                  </tr>
                  <tr className="sous">
                    <th scope="row">Staff</th>
                    {rubriques.map((r) => (
                      <td className="num" key={r}>
                        {m.staff?.[r] ?? 0}
                      </td>
                    ))}
                    <td />
                    <td />
                  </tr>
                </Fragment>
              ))}
              <tr className="total">
                <th scope="row">Total MS</th>
                {rubriques.map((r) => (
                  <td className="num" key={r}>
                    {fcfa(totalRub(r))}
                  </td>
                ))}
                <td className="num">{fcfa(somme(d.mois.map(totalMois)) ?? '0')}</td>
                <td className="num">{fcfa(somme(d.mois.map((m) => m.budget ?? null)) ?? '0')}</td>
              </tr>
              <tr className="total">
                <th scope="row">Total Staff</th>
                {rubriques.map((r) => (
                  <td className="num" key={r}>
                    {totalStaff(r)}
                  </td>
                ))}
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        </Panneau>
      )}
      {d && (
        <p className="note">
          Note : le TOTAL MENSUEL additionne les 12 postes affichés ci-dessus. La ligne « Brut Réel » du reporting global n’y figure pas.
        </p>
      )}
    </section>
  )
}
