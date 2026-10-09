import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Fragment, useLayoutEffect, useRef } from 'react'
import { getIndividuelTous, getSalaries } from '../api/rapports'
import type { IndividuelTous, Val } from '../api/types'
import { Panneau } from '../components/BlocsRapport'
import BoutonReinitialiser from '../components/BoutonReinitialiser'
import Etat, { etatErreur } from '../components/Etat'
import { useFiltres } from '../hooks/useFiltres'
import { cls, fcfa, largeurEntete, matriculeAffiche, MOIS, somme } from '../lib/format'
import { plafonner } from '../lib/plafond'

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

const MODELE_VIDE: IndividuelTous = {
  annee: 0, matricule: null, nom: null, rubriques: COLONNES,
  mois: MOIS.map((_, i) => ({ mois: i + 1, present: false })),
}

/** Reporting individuel, calqué sur l'onglet REPORTING_RH_INDIVIDUEL : tous les employés par défaut. */
export default function Individuel() {
  const f = useFiltres({ avecMois: false })
  const matricule = f.partage.matricule ?? ''
  const setMatricule = (m: string) => f.set({ matricule: m })
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
    placeholderData: keepPreviousData,
  })
  // Premier chargement : le vrai tableau (colonnes et mois sont statiques) avec des valeurs vides,
  // que le squelette commun masque ; seules les valeurs chargent.
  const maj = q.isPlaceholderData || q.isLoading
  const d = q.data ?? (q.isLoading ? MODELE_VIDE : undefined)
  const rubriques = COLONNES
  const totalMois = (m: NonNullable<typeof d>['mois'][number]) =>
    somme(rubriques.map((r) => m.montants?.[r] ?? null)) ?? '0'
  const val = (v: Val | undefined) => v ?? '0'
  const totalRub = (r: string) => somme((d?.mois ?? []).map((m) => m.montants?.[r] ?? null)) ?? '0'
  const totalStaff = (r: string) => (d?.mois ?? []).reduce((n, m) => n + (m.staff?.[r] ?? 0), 0)

  // Le tableau s'étire sur la hauteur restante, sans dépasser la hauteur de ligne plafonnée
  const zone = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const poser = () => zone.current?.querySelectorAll<HTMLElement>(':scope > .panneau').forEach(plafonner)
    poser()
    window.addEventListener('resize', poser)
    return () => window.removeEventListener('resize', poser)
  })

  return (
    <section ref={zone} className={`page-ecran page-etroite rapport-excel individuel-excel${maj ? ' maj' : ''}`} aria-busy={maj || undefined}>
      <h2 className="bandeau-titre">REPORTING INDIVIDUEL</h2>
      {f.filtres && (
        <div className="filtres" role="group" aria-label="Filtres">
          <label>
            Matricule
            <select value={matricule} onChange={(e) => setMatricule(e.target.value)}>
              <option value="">(Tous)</option>
              {salaries.data?.map((s) => (
                <option key={s.matricule} value={s.matricule}>
                  {matriculeAffiche(s.matricule) ? `${matriculeAffiche(s.matricule)} — ` : ''}{s.nom}
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
            <select value={f.filtres.annee} onChange={(e) => f.set({ annee: e.target.value })}>
              {f.annees.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <BoutonReinitialiser
            actif={(['matricule', 'site', 'service', 'annee'] as const).some((k) => f.partage[k])}
            onClick={() => f.set({ matricule: undefined, site: undefined, service: undefined, annee: undefined })}
          />
        </div>
      )}
      {d && (
        <p className="note note-entete">
          {d.matricule
            ? <>Employé retenu : <span className="val">{d.nom}{matriculeAffiche(d.matricule) ? ` (${matriculeAffiche(d.matricule)})` : ''}</span></>
            : q.isLoading ? <span className="val">—</span> : 'Aucun employé sélectionné — les listes ci-dessus restent toutes ouvertes.'}
        </p>
      )}
      {f.vide && <Etat type="vide" />}
      {q.error &&
        (matricule && etatErreur(q.error) === '404' ? (
          <Etat type="404" titre="Matricule introuvable" aide="Cet employé n’a aucune donnée cette année dans votre périmètre." />
        ) : (
          <Etat type={etatErreur(q.error)} />
        ))}
      {d && (
        <Panneau titre="Reporting individuel" sansTitre>
          <table className="dense individuel">
            <thead>
              <tr>
                <th scope="col" className="fige-g">Mois</th>
                {rubriques.map((r) => (
                  <th scope="col" key={r} style={{ minWidth: largeurEntete(r) }}>
                    {r}
                  </th>
                ))}
                <th scope="col" className="num fige-d1">Total mensuel</th>
                <th scope="col" className="num fige-d2">Total budget</th>
              </tr>
            </thead>
            <tbody>
              {d.mois.map((m) => (
                <Fragment key={m.mois}>
                  <tr className="groupe">
                    <th scope="row" className="fige-g">{MOIS[m.mois - 1]}</th>
                    {rubriques.map((r) => (
                      <td className={cls(val(m.montants?.[r]))} key={r}>
                        {fcfa(val(m.montants?.[r]))}
                      </td>
                    ))}
                    <td className="num fige-d1">{fcfa(totalMois(m))}</td>
                    <td className="num fige-d2">{fcfa(val(m.budget ?? undefined))}</td>
                  </tr>
                  <tr className="sous">
                    <th scope="row" className="fige-g">Staff</th>
                    {rubriques.map((r) => (
                      <td className="num" key={r}>
                        {m.staff?.[r] ?? 0}
                      </td>
                    ))}
                    <td className="fige-d1" />
                    <td className="fige-d2" />
                  </tr>
                </Fragment>
              ))}
              <tr className="total">
                <th scope="row" className="fige-g">Total MS</th>
                {rubriques.map((r) => (
                  <td className="num" key={r}>
                    {fcfa(totalRub(r))}
                  </td>
                ))}
                <td className="num fige-d1">{fcfa(somme(d.mois.map(totalMois)) ?? '0')}</td>
                <td className="num fige-d2">{fcfa(somme(d.mois.map((m) => m.budget ?? null)) ?? '0')}</td>
              </tr>
              <tr className="total">
                <th scope="row" className="fige-g">Total Staff</th>
                {rubriques.map((r) => (
                  <td className="num" key={r}>
                    {totalStaff(r)}
                  </td>
                ))}
                <td className="fige-d1" />
                <td className="fige-d2" />
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
