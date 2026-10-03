import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { getIndividuel, getSalaries } from '../api/rapports'
import { Panneau } from '../components/BlocsRapport'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import { useFiltres } from '../hooks/useFiltres'
import { cls, entier, fcfa, MOIS } from '../lib/format'

export default function Individuel() {
  const f = useFiltres()
  const [saisie, setSaisie] = useState('')
  const annee = f.filtres?.annee
  const salaries = useQuery({
    queryKey: ['salaries', annee],
    queryFn: () => getSalaries(annee!),
    enabled: annee !== undefined,
  })
  const matricule = salaries.data?.find((s) => s.matricule.toLowerCase() === saisie.trim().toLowerCase())?.matricule
  const q = useQuery({
    queryKey: ['individuel', annee, matricule],
    queryFn: () => getIndividuel(annee!, matricule!),
    enabled: annee !== undefined && !!matricule,
  })
  const rubriques = [...new Set(q.data?.mois.flatMap((m) => Object.keys(m.rubriques ?? {})))]

  return (
    <section className="page-ecran page-etroite rapport-excel">
      <h2 className="bandeau-titre">FICHE INDIVIDUELLE — Charges RH par salarié</h2>
      {f.filtres && (
        <FiltresPeriode filtres={f.filtres} annees={f.annees} avecMois={false} onChange={f.set}>
          <label>
            Matricule
            <select value={saisie} onChange={(e) => setSaisie(e.target.value)}>
              <option value="">Choisir…</option>
              {salaries.data?.map((s) => (
                <option key={s.matricule} value={s.matricule}>
                  {s.matricule} — {s.nom}
                </option>
              ))}
            </select>
          </label>
        </FiltresPeriode>
      )}
      <p className="note note-entete">La consultation d’une fiche nominative est enregistrée dans le journal d’audit.</p>
      {!matricule && (
        <div className="vide-guide">
          <strong>Sélectionnez un employé</strong>
          <span className="note">
            Choisissez un matricule dans la liste.
          </span>
        </div>
      )}
      {q.isLoading && <Etat type="chargement" />}
      {q.error && <Etat type={etatErreur(q.error)} />}
      {q.data && (
        <>
          <Panneau titre={`${q.data.nom} (${q.data.matricule})`}>
            <table className="dense">
              <thead>
                <tr>
                  <th scope="col">Mois</th>
                  <th scope="col">Service</th>
                  <th scope="col">Site</th>
                  <th scope="col">Contrat</th>
                  {rubriques.map((r) => (
                    <th scope="col" key={r}>
                      {r}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {q.data.mois.map((m) => (
                  <tr key={m.mois}>
                    <th scope="row">{MOIS[m.mois - 1]}</th>
                    <td>{m.service ?? '—'}</td>
                    <td>{m.site ?? '—'}</td>
                    <td>{m.contrat ?? '—'}</td>
                    {rubriques.map((r) => (
                      <td className={cls(m.rubriques?.[r])} key={r}>
                        {fcfa(m.rubriques?.[r])}
                      </td>
                    ))}
                    <td className="num">{fcfa(m.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4 + rubriques.length}>
                    Cumul ({entier(q.data.nb_mois)} mois) · moyenne {fcfa(q.data.moyenne)}
                  </th>
                  <td className="num">{fcfa(q.data.cumul)}</td>
                </tr>
              </tfoot>
            </table>
          </Panneau>
        </>
      )}
    </section>
  )
}
