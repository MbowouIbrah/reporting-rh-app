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
import { ChoixAnnee, ChoixCalendrier, ChoixEmploye, ChoixPoste, ChoixTypeSite, TitreFiltres } from '../components/FiltresPeriode'
import { useAttente } from '../hooks/useAttente'
import { useFiltres } from '../hooks/useFiltres'
import { useOrdreColonnes } from '../hooks/useOrdreColonnes'
import { useSalaries } from '../hooks/useSalaries'
import { cls, decimal2, fcfa, largeurEntete, matriculeAffiche, MOIS, somme } from '../lib/format'
import { type Calendrier, ordreMois } from '../lib/exercice'
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

type ColActivite = 'ventes' | 'clients' | 'productivite' | 'ca_individuel' | 'marge_individuelle'
/** Montants (CA, marge) en FCFA entiers ; nombres de ventes ou de clients et indice : deux décimales au plus. */
const texteActivite = (cle: ColActivite, v: string | null | undefined) => (cle === 'ca_individuel' || cle === 'marge_individuelle' ? fcfa(v) : decimal2(v))

const MODELE_VIDE: IndividuelTous = {
  annee: 0, matricule: null, nom: null, rubriques: COLONNES,
  exclues: ['Salaire brut garanti', 'Commission', 'Primes de productivité', 'Primes sur ventes', 'Primes sur résultats'],
  mois: [],
}
const modeleVide = (cal?: Calendrier): IndividuelTous => ({ ...MODELE_VIDE, mois: ordreMois(cal).map((m) => ({ mois: m, present: false })) })

/** Reporting individuel, calqué sur l'onglet REPORTING_RH_INDIVIDUEL : tous les employés par défaut. */
export default function Individuel() {
  const f = useFiltres({ avecMois: false, avecCalendrier: true })
  const matricule = f.partage.matricule ?? ''
  const setMatricule = (m: string) => f.set({ matricule: m })
  const annee = f.filtres?.annee
  const service = f.filtres?.service
  const site = f.filtres?.site
  const typeSite = f.filtres?.type_site
  const poste = f.filtres?.poste
  const calendrier = f.filtres?.calendrier
  const salaries = useSalaries(annee, calendrier)
  const q = useQuery({
    queryKey: ['individuel-tous', annee, matricule, service, site, typeSite, poste, calendrier],
    queryFn: () => getIndividuelTous({ annee: annee!, matricule, service, site, type_site: typeSite, poste, calendrier }),
    enabled: annee !== undefined,
    placeholderData: keepPreviousData,
  })
  // Premier chargement : le vrai tableau (colonnes et mois sont statiques) avec des valeurs vides,
  // que le squelette commun masque ; seules les valeurs chargent.
  const [maj, relais] = useAttente(q.isPlaceholderData || q.isLoading)
  const d = q.data ?? (q.isLoading ? modeleVide(calendrier) : undefined)
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
  // Mois sans données (pas encore importé ou hors périmètre) : « - », jamais 0 ; 0 reste un vrai zéro.
  const aucun = !(d?.mois ?? []).some((m) => m.present)
  const totalRub = (r: string) => somme((d?.mois ?? []).map((m) => m.montants?.[r] ?? null)) ?? '0'
  const totalStaff = (r: string) => (d?.mois ?? []).reduce((n, m) => n + (m.staff?.[r] ?? 0), 0)

  // Activité du périmètre : n'apparaît que si au moins un mois porte une valeur ; CA et marge individuels
  // seulement avec le droit marge (clés absentes sinon).
  const activites = (d?.mois ?? []).filter((m) => m.present && m.activite)
  const aActivite = activites.some((m) => Object.values(m.activite ?? {}).some((v) => v != null))
  const avecCaInd = activites.some((m) => m.activite && 'ca_individuel' in m.activite)
  // Total de l'année calculé par le serveur (productivité = moyenne des mois renseignés).
  const totalActivite = (cle: ColActivite) => d?.activite_total?.[cle] ?? null
  const colsActivite: { cle: ColActivite; titre: string }[] = [
    { cle: 'ventes', titre: 'Nombre de ventes' },
    { cle: 'clients', titre: 'Nombre de clients' },
    { cle: 'productivite', titre: 'Indice de productivité' },
    ...(avecCaInd
      ? [
          { cle: 'ca_individuel' as const, titre: 'CA individuel' },
          { cle: 'marge_individuelle' as const, titre: 'Marge individuelle' },
        ]
      : []),
  ]

  // Le tableau s'étire sur la hauteur restante, sans dépasser la hauteur de ligne plafonnée
  const zone = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const poser = () => zone.current?.querySelectorAll<HTMLElement>(':scope > .panneau').forEach(plafonner)
    poser()
    window.addEventListener('resize', poser)
    return () => window.removeEventListener('resize', poser)
  })

  return (
    <section ref={zone} className={`page-ecran page-etroite rapport-excel individuel-excel${maj ? ' maj' : ''}${relais ? ' relais' : ''}`} aria-busy={maj || undefined}>
      <TitreRapport titre="REPORTING INDIVIDUEL" />
      {f.filtres && (
        <div className="filtres filtres-rapport" role="group" aria-label="Filtres">
          <TitreFiltres />
          <ChoixCalendrier filtres={f.filtres} onChange={f.set} />
          <ChoixAnnee filtres={f.filtres} annees={f.annees} onChange={f.set} />
          <label className="souple">
            Service
            <select value={service ?? ''} onChange={(e) => f.set({ service: e.target.value })}>
              <option value="">Tous</option>
              {f.services.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {f.typesSite.length > 0 && (
            <ChoixTypeSite valeur={typeSite ?? ''} types={f.typesSite} onChange={(v) => f.set({ type_site: v })} />
          )}
          <label className="souple">
            Site
            <select value={site ?? ''} onChange={(e) => f.set({ site: e.target.value })}>
              <option value="">Tous</option>
              {f.sites.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {f.postes.length > 0 && (
            <ChoixPoste valeur={poste ?? ''} postes={f.postes} onChange={(v) => f.set({ poste: v })} />
          )}
          <ChoixEmploye salaries={salaries ?? []} valeur={matricule} onChange={setMatricule} />
          <div className="filtres-actions">
            <BoutonReinitialiser
              actif={(['matricule', 'site', 'service', 'type_site', 'poste', 'annee', 'calendrier', 'exercice'] as const).some((k) => f.partage[k])}
              onClick={() =>
                f.set({ matricule: undefined, site: undefined, service: undefined, type_site: undefined, poste: undefined, annee: undefined, exercice: undefined, calendrier: undefined })
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
                      <td className={(!m.present || sansObjet(r, m) ? 'num' : cls(val(m.montants?.[r]))) + classe(r)} key={r}>
                        {!m.present || sansObjet(r, m) ? '-' : fcfa(val(m.montants?.[r]))}
                      </td>
                    ))}
                    <td className="num fige-d1">{m.present ? fcfa(totalMois(m)) : '-'}</td>
                  </tr>
                  <tr className="sous">
                    <th scope="row" className="fige-g">Staff</th>
                    {rubriques.map((r) => (
                      <td className={'num' + classe(r)} key={r}>
                        {!m.present || sansObjet(r, m) ? '-' : (m.staff?.[r] ?? 0)}
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
                    {aucun || sansObjet(r) ? '-' : fcfa(totalRub(r))}
                  </td>
                ))}
                <td className="num fige-d1">{aucun ? '-' : fcfa(somme(d.mois.filter((m) => m.present).map(totalMois)) ?? '0')}</td>
              </tr>
              <tr className="total staff">
                <th scope="row" className="fige-g">Total Staff</th>
                {rubriques.map((r) => (
                  <td className={'num' + classe(r)} key={r}>
                    {aucun || sansObjet(r) ? '-' : totalStaff(r)}
                  </td>
                ))}
                <td className="fige-d1" />
              </tr>
            </tbody>
          </table>
        </Panneau>
      )}
      {d && aActivite && (
        <details className="section details-donnees">
          <summary>
            <span className="section-titre">Activité</span>
          </summary>
          <div className="section-corps">
            <div className="table-scroll">
              <table className="dense">
                <thead>
                  <tr>
                    <th scope="col">Mois</th>
                    {colsActivite.map((c) => <th key={c.cle} scope="col" className="num">{c.titre}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {activites.map((m) => (
                    <tr key={m.mois}>
                      <th scope="row">{MOIS[m.mois - 1]}</th>
                      {colsActivite.map((c) => (
                        <td key={c.cle} className="num">{texteActivite(c.cle, m.activite?.[c.cle])}</td>
                      ))}
                    </tr>
                  ))}
                  <tr className="total">
                    <th scope="row">Total</th>
                    {colsActivite.map((c) => (
                      <td key={c.cle} className="num">{texteActivite(c.cle, totalActivite(c.cle))}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </details>
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
