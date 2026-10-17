import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Fragment, useLayoutEffect, useRef } from 'react'
import { useEnregistrerColonnes } from '../api/admin'
import { getIndividuelTous } from '../api/rapports'
import type { IndividuelTous, Val } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { Panneau } from '../components/BlocsRapport'
import BoutonReinitialiser from '../components/BoutonReinitialiser'
import ConfirmerColonne from '../components/ConfirmerColonne'
import Etat, { etatErreur } from '../components/Etat'
import { ChoixEmploye, ChoixPoste, ChoixTypeSite, TitreFiltres } from '../components/FiltresPeriode'
import { useFiltres } from '../hooks/useFiltres'
import { useOrdreColonnes } from '../hooks/useOrdreColonnes'
import { useSalaries } from '../hooks/useSalaries'
import { cls, fcfa, largeurEntete, matriculeAffiche, MOIS, somme } from '../lib/format'
import { plafonner } from '../lib/plafond'
import { TitreRapport } from '../components/ExportPdf'

/** Colonnes du reporting individuel, dans l'ordre demandé (servies aussi par l'API). */
const COLONNES = [
  'Salaire brut garanti',
  'Commission',
  'Primes de productivité',
  'Brut réel',
  'Bonus',
  'Primes sur ventes',
  'Primes sur résultats',
  'Marge MAD + TVA',
  'Crédit téléphonique',
  'Frais de mission',
  'Primes exceptionnelles',
  'Logement site déporté',
  'Carburant véhicule service',
]
const LOGEMENT = 'Logement site déporté'

const MODELE_VIDE: IndividuelTous = {
  annee: 0, matricule: null, nom: null, rubriques: COLONNES,
  exclues: ['Salaire brut garanti', 'Commission', 'Primes de productivité', 'Primes sur ventes', 'Primes sur résultats'],
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
  const typeSite = f.filtres?.type_site
  const poste = f.filtres?.poste
  const salaries = useSalaries(annee)
  const q = useQuery({
    queryKey: ['individuel-tous', annee, matricule, service, site, typeSite, poste],
    queryFn: () => getIndividuelTous({ annee: annee!, matricule, service, site, type_site: typeSite, poste }),
    enabled: annee !== undefined,
    placeholderData: keepPreviousData,
  })
  // Premier chargement : le vrai tableau (colonnes et mois sont statiques) avec des valeurs vides,
  // que le squelette commun masque ; seules les valeurs chargent.
  const maj = q.isPlaceholderData || q.isLoading
  const d = q.data ?? (q.isLoading ? MODELE_VIDE : undefined)
  // Comme DONNEES : colonnes exclues du total (hachurées) d'abord, juste après le mois, puis les
  // colonnes comptées dans le TOTAL MENSUEL (servi par le serveur, sans les hachurées).
  // Ordre global (serveur, commun avec DONNEES), modifiable en glissant les en-têtes par qui a le droit ;
  // chaque colonne affichée est enregistrée par ses rubriques sources.
  const { can } = useAuth()
  const ecrire = useEnregistrerColonnes()
  const colonnes = useOrdreColonnes(d?.rubriques ?? COLONNES, new Set(d?.exclues), {
    modifiable: can('referentiel:write') && !maj,
    enregistrer: (l) =>
      ecrire.mutateAsync(l.flatMap((x) => (d?.sources?.[x.colonne] ?? [x.colonne]).map((r) => ({ rubrique: r, exclu: x.exclu })))),
  })
  const { ordre: rubriques, exclues } = colonnes
  const classe = (r: string) => (exclues.has(r) ? ' exclu' : '')
  type Mois = NonNullable<typeof d>['mois'][number]
  const totalMois = (m: Mois) => m.total ?? '0'
  // Logement site déporté : sans objet (« - ») quand aucun site déporté ne figure dans le mois.
  const sansObjet = (r: string, m?: Mois) =>
    r === LOGEMENT && (m ? m.present && !m.deporte : !(d?.mois ?? []).some((x) => x.deporte))
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
      <TitreRapport titre="REPORTING INDIVIDUEL" />
      {f.filtres && (
        <div className="filtres filtres-rapport" role="group" aria-label="Filtres">
          <TitreFiltres />
          <ChoixEmploye salaries={salaries ?? []} valeur={matricule} onChange={setMatricule} />
          {f.typesSite.length > 0 && (
            <ChoixTypeSite valeur={typeSite ?? ''} types={f.typesSite} tous="(Tous)" onChange={(v) => f.set({ type_site: v })} />
          )}
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
          {f.postes.length > 0 && (
            <ChoixPoste valeur={poste ?? ''} postes={f.postes} tous="(Tous)" onChange={(v) => f.set({ poste: v })} />
          )}
          <label>
            Année
            <select value={f.filtres.annee} onChange={(e) => f.set({ annee: e.target.value })}>
              {f.annees.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <div className="filtres-actions">
            <BoutonReinitialiser
              actif={(['matricule', 'site', 'service', 'type_site', 'poste', 'annee'] as const).some((k) => f.partage[k])}
              onClick={() =>
                f.set({ matricule: undefined, site: undefined, service: undefined, type_site: undefined, poste: undefined, annee: undefined })
              }
            />
          </div>
        </div>
      )}
      {d && (
        <p className="note note-entete">
          {d.matricule
            ? <>Employé retenu : <span className="val">{d.nom}{matriculeAffiche(d.matricule) ? ` (${matriculeAffiche(d.matricule)})` : ''}</span></>
            : q.isLoading ? <span className="val">—</span> : 'Aucun employé sélectionné : cumul de tous les employés du périmètre.'}
        </p>
      )}
      {f.vide && <Etat type="vide" />}
      {q.error &&
        (matricule && etatErreur(q.error) === '404' ? (
          <Etat type="404" titre="Matricule introuvable" aide="Cet employé n’a aucune donnée cette année dans votre périmètre." />
        ) : (
          <Etat type={etatErreur(q.error)} />
        ))}
      <ConfirmerColonne {...colonnes} />
      {d && (
        <Panneau titre="Reporting individuel" sansTitre>
          <table className="dense individuel">
            <thead>
              <tr>
                <th scope="col" className="fige-g">Mois</th>
                {rubriques.map((r) => (
                  <th scope="col" key={r} {...colonnes.entete(r)} className={classe(r).trim() || undefined} style={{ minWidth: Math.round(largeurEntete(r) * 0.68) }}>
                    {r}
                  </th>
                ))}
                <th scope="col" className="num fige-d1">Total mensuel</th>
              </tr>
            </thead>
            <tbody>
              {d.mois.map((m) => (
                <Fragment key={m.mois}>
                  <tr className="groupe">
                    <th scope="row" className="fige-g">{MOIS[m.mois - 1]}</th>
                    {rubriques.map((r) => (
                      <td className={(sansObjet(r, m) ? 'num' : cls(val(m.montants?.[r]))) + classe(r)} key={r}>
                        {sansObjet(r, m) ? '-' : fcfa(val(m.montants?.[r]))}
                      </td>
                    ))}
                    <td className="num fige-d1">{fcfa(totalMois(m))}</td>
                  </tr>
                  <tr className="sous">
                    <th scope="row" className="fige-g">Staff</th>
                    {rubriques.map((r) => (
                      <td className={'num' + classe(r)} key={r}>
                        {sansObjet(r, m) ? '-' : (m.staff?.[r] ?? 0)}
                      </td>
                    ))}
                    <td className="fige-d1" />
                  </tr>
                </Fragment>
              ))}
              <tr className="total">
                <th scope="row" className="fige-g">Total MS</th>
                {rubriques.map((r) => (
                  <td className={'num' + classe(r)} key={r}>
                    {sansObjet(r) ? '-' : fcfa(totalRub(r))}
                  </td>
                ))}
                <td className="num fige-d1">{fcfa(somme(d.mois.map(totalMois)) ?? '0')}</td>
              </tr>
              <tr className="total">
                <th scope="row" className="fige-g">Total Staff</th>
                {rubriques.map((r) => (
                  <td className={'num' + classe(r)} key={r}>
                    {sansObjet(r) ? '-' : totalStaff(r)}
                  </td>
                ))}
                <td className="fige-d1" />
              </tr>
            </tbody>
          </table>
        </Panneau>
      )}
      {d && (
        <p className="note">
          Note : le TOTAL MENSUEL additionne les colonnes ci-dessus, hors{' '}
          <span className="legende-exclu">colonnes hachurées</span> (exclues du total).
        </p>
      )}
    </section>
  )
}
