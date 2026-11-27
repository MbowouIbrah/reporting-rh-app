import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import type { DimComparee, FiltresPage } from '../api/rapports'
import type { Periode } from '../api/types'
import ChoixSalarie, { type Salarie } from './ChoixSalarie'
import type { ClePartagee, Partage } from '../lib/filtresPartages'
import { libelleExercice } from '../lib/exercice'
import { MOIS_COURTS } from '../lib/format'
import {
  anneeDe, indice, libelle, lireTexte, longueur, moisDe, mois as moisSel, type PeriodeChoisie, texteMois, versTexte,
} from '../lib/periode'
import BoutonReinitialiser from './BoutonReinitialiser'
import ChoixFiltres, { FILTRES_PAR_DEFAUT, lireAffiches } from './ChoixFiltres'
import ChoixPeriode from './ChoixPeriode'
import { usePreference } from '../lib/preference'
import MultiChoix, { type ModeListe } from './MultiChoix'

type Comparer = Parameters<typeof MultiChoix>[0]['comparer']

type Patch = Record<string, string | number | undefined>

interface Props {
  filtres: FiltresPage
  /** Années ou exercices proposés (sélecteur d'année seul). */
  annees?: number[]
  /** Départements proposés ; absent : pas de filtre « Département ». */
  departements?: string[]
  services?: string[]
  sites?: string[]
  /** Types de site présents dans les données. */
  typesSite?: string[]
  postes?: string[]
  activites?: string[]
  typesContrat?: string[]
  /** Employés proposés ; absent sans le droit nominatif : le filtre « Employé » n'est pas affiché. */
  salaries?: Salarie[]
  avecMois?: boolean
  /** Sélecteur « Comparer à » : une période (annuel) ou un mois (mensuel). */
  comparaison?: 'annee' | 'periode'
  /** Choix « Année civile / Année fiscale » (sélecteur d'année seul). */
  avecCalendrier?: boolean
  periodes?: Periode[]
  /** Pages annuelles : période, comparaison et mois disponibles du calendrier. */
  periode?: PeriodeChoisie | null
  /** Champs supplémentaires, alignés sur la même ligne que les filtres. */
  children?: ReactNode
  onChange: (patch: Patch) => void
  /** Valeurs choisies (filtres partagés) : seules elles rendent Réinitialiser actif. */
  partage: Partage
  /** R9 : liste en mode « Comparer » (null : aucune) ; absent : page sans comparaison de sélections. */
  cmpDim?: DimComparee | null
  /** Filtres de profil des salariés (sexe, tranche d'âge, tranche d'ancienneté), filtrés côté serveur. */
  avecProfil?: boolean
}

const LIBELLE_DIM: Record<DimComparee, string> = {
  departement: 'Département', service: 'Service', site: 'Site', type_site: 'Type de site',
  activite: 'Activité', type_contrat: 'Contrat', poste: 'Poste',
}

type DimProfil = 'sexe' | 'age' | 'anciennete'

/** Filtres de profil : valeurs fixes (« nr » : non renseigné), sans mode Comparer. */
const PROFIL: { id: DimProfil; libelle: string; pluriel: string; valeurs: [string, string][] }[] = [
  { id: 'sexe', libelle: 'Sexe', pluriel: 'sexes', valeurs: [['H', 'Hommes'], ['F', 'Femmes'], ['nr', 'Non renseigné']] },
  { id: 'age', libelle: "Tranche d'âge", pluriel: 'tranches', valeurs: [
    ['<25', 'Moins de 25 ans'], ['25-34', '25 à 34 ans'], ['35-44', '35 à 44 ans'], ['45-54', '45 à 54 ans'],
    ['55+', '55 ans et plus'], ['nr', 'Non renseigné'],
  ] },
  { id: 'anciennete', libelle: "Tranche d'ancienneté", pluriel: 'tranches', valeurs: [
    ['<1', "Moins d'un an"], ['1-3', '1 à 3 ans'], ['3-5', '3 à 5 ans'], ['5-10', '5 à 10 ans'],
    ['10+', '10 ans et plus'], ['nr', 'Non renseigné'],
  ] },
]

/** Groupes du menu « Filtrer par », dans l'ordre des groupes d'indicateurs. */
const GROUPE: Record<DimComparee | DimProfil, string> = {
  activite: 'Activité et productivité', poste: 'Profil des salariés',
  departement: 'Effectif', service: 'Effectif', type_site: 'Effectif', site: 'Effectif', type_contrat: 'Effectif',
  sexe: 'Profil des salariés', age: 'Profil des salariés', anciennete: 'Profil des salariés',
}

/** Période précédant (annee, mois) : mois d'avant, décembre de l'année d'avant en janvier. */
export const moisPrecedent = (annee: number, mois: number) =>
  mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 }

/** Période des paramètres « AAAA-MM » d'une page annuelle. */
const selDe = (du?: string, au?: string) => (du && au ? lireTexte(`${du}..${au}`) : null)

/** Libellé de la colonne de comparaison des tableaux : la période choisie, sinon le mois d'avant. */
export function libelleComparaison(f: FiltresPage, mode: 'annee' | 'periode') {
  if (mode === 'annee') {
    const s = selDe(f.cmp_du, f.cmp_au)
    return s ? libelle(s) : ''
  }
  const p = f.ref_annee && f.ref_mois ? { annee: f.ref_annee, mois: f.ref_mois } : moisPrecedent(f.annee, f.mois)
  return libellePeriode(p)
}

/** En-tête de la colonne de la période affichée (pages annuelles). */
export function libelleCourant(f: FiltresPage) {
  const s = selDe(f.du, f.au)
  return s ? libelle(s) : ''
}

/** Libellé court d'une période (« Juin 2026 ») : en-têtes de tableaux. */
export const libellePeriode = (p: { annee: number; mois: number }) => `${MOIS_COURTS[p.mois - 1]} ${p.annee}`

const FLECHE = <span className="fl" aria-hidden="true">↔</span>

/** Page mensuelle : un mois, comparé à un autre mois (par défaut le mois d'avant). */
function ChoixMois({ filtres: f, periodes, comparaison, onChange }: {
  filtres: FiltresPage
  periodes: Periode[]
  comparaison: boolean
  onChange: (patch: Patch) => void
}) {
  if (!periodes.length) return null
  const premier = periodes[0]
  const dernier = periodes[periodes.length - 1]
  const min = indice(premier.annee, premier.mois)
  const max = indice(dernier.annee, dernier.mois)
  const prec = moisPrecedent(f.annee, f.mois)
  const cmp = f.ref_annee && f.ref_mois ? indice(f.ref_annee, f.ref_mois) : indice(prec.annee, prec.mois)
  return (
    <>
      <ChoixPeriode
        titre="Période" moisSeul valeur={moisSel(indice(f.annee, f.mois))} min={min} max={max}
        onChange={(s) => onChange({ annee: anneeDe(s.d), mois: moisDe(s.d) })}
      />
      {comparaison && (
        <>
          {FLECHE}
          <ChoixPeriode
            titre="Comparer à" moisSeul valeur={moisSel(cmp)} min={min} max={max}
            onChange={(s) => onChange({ cmp_periode: texteMois(s.d) })}
          />
        </>
      )}
    </>
  )
}

/** Pages annuelles (R6) : période et comparaison dans un calendrier compact. */
function ChoixPeriodes({ periode, selectionB, onChange }: {
  periode: PeriodeChoisie
  /** R9 : nom de la sélection B ; la comparaison de période est alors suspendue. */
  selectionB?: string
  onChange: (patch: Patch) => void
}) {
  return (
    <>
      <ChoixPeriode
        titre="Période" valeur={periode.sel} min={periode.min} max={periode.max}
        onChange={(s) => onChange({ periode: versTexte(s), comparee: undefined })}
      />
      {FLECHE}
      {selectionB ? (
        <div className="filtre">
          <span id="cmp-sel-lib">Comparer à</span>
          <button type="button" className="multi-bouton" disabled aria-labelledby="cmp-sel-lib cmp-sel-val" title="Comparaison de deux sélections en cours : même période pour A et B">
            <span id="cmp-sel-val">Sélection B : {selectionB}</span>
          </button>
        </div>
      ) : <ChoixPeriode
        titre="Comparer à" valeur={periode.cmp} min={periode.min} max={periode.max}
        longueur={longueur(periode.sel)} modele={periode.sel}
        onChange={(s) => onChange({ comparee: versTexte(s) })}
      />}
    </>
  )
}

/** Année civile (janvier → décembre) ou fiscale (avril → mars). */
export function ChoixCalendrier({ filtres: f, onChange }: { filtres: FiltresPage; onChange: (patch: Patch) => void }) {
  return (
    <label>
      Calendrier
      <select value={f.calendrier ?? 'civil'} onChange={(e) => onChange({ calendrier: e.target.value === 'fiscal' ? 'fiscal' : undefined })}>
        <option value="civil">Année civile</option>
        <option value="fiscal">Année fiscale (avril → mars)</option>
      </select>
    </label>
  )
}

/** Année (civil) ou exercice « 2026-27 » (fiscal). */
export function ChoixAnnee({ filtres: f, annees, onChange }: {
  filtres: FiltresPage
  annees: number[]
  onChange: (patch: Patch) => void
}) {
  return (
    <label>
      {f.calendrier === 'fiscal' ? 'Exercice' : 'Année'}
      <select value={f.annee} onChange={(e) => onChange({ annee: e.target.value })}>
        {annees.map((a) => (
          <option key={a} value={a}>{libelleExercice(a, f.calendrier)}</option>
        ))}
      </select>
    </label>
  )
}

export const LIBELLE_TYPE_SITE: Record<string, string> = {
  principal: 'Principal',
  agence: 'Agence',
  deporte: 'Déporté',
}

export function ChoixTypeSite({ valeur, types, tous = 'Tous', onChange, comparer }: {
  comparer?: Comparer
  valeur: string
  types: string[]
  tous?: string
  onChange: (v: string) => void
}) {
  return (
    <MultiChoix
      libelle="Type de site" pluriel="types" tous={tous} options={types} valeur={valeur} onChange={onChange}
      nomOption={(t) => LIBELLE_TYPE_SITE[t] ?? t} souple={false} comparer={comparer}
    />
  )
}

export function ChoixPoste({ valeur, postes, tous = 'Tous', onChange, comparer }: {
  comparer?: Comparer
  valeur: string
  postes: string[]
  tous?: string
  onChange: (v: string) => void
}) {
  return <MultiChoix libelle="Poste" pluriel="postes" tous={tous} options={postes} valeur={valeur} onChange={onChange} comparer={comparer} />
}

/** Titre de la barre : dit au premier coup d'œil que ce qui suit sont des filtres. */
export function TitreFiltres() {
  return (
    <span className="filtres-titre">
      <ListFilter size={14} aria-hidden="true" />
      Filtres
    </span>
  )
}

/** Pas de <label> englobant : un clic sur une option rouvrirait la liste. */
export function ChoixEmploye({ salaries, valeur, onChange }: {
  salaries: Salarie[]
  valeur: string
  onChange: (matricule: string) => void
}) {
  return (
    <div className="filtre souple">
      <span aria-hidden="true">Employé</span>
      <ChoixSalarie salaries={salaries} valeur={valeur} onChange={onChange} />
    </div>
  )
}

export default function FiltresPeriode({
  filtres, annees = [], departements, services, sites, typesSite, postes, activites, typesContrat, salaries, avecMois = true, comparaison, avecCalendrier, periodes,
  periode, children, onChange, partage, cmpDim, avecProfil,
}: Props) {
  const avecType = !!typesSite?.length
  const avecPoste = !!postes?.length
  const avecActivite = !!activites?.length
  const avecContrat = !!typesContrat?.length
  // Réinitialiser rend aux filtres affichés leur valeur par défaut (dernière période, période d'avant, tous).
  const cles: ClePartagee[] = [
    ...(avecCalendrier || comparaison === 'annee' ? (['calendrier', 'exercice'] as const) : []),
    ...(comparaison === 'annee' ? (['periode', 'comparee', 'vue', 'debut', 'fin', 'cmp', 'cmp_annee'] as const) : []),
    'annee',
    ...(avecMois ? (['mois'] as const) : []),
    ...(comparaison === 'periode' ? (['cmp_periode'] as const) : []),
    ...(departements ? (['departement'] as const) : []),
    ...(services ? (['service'] as const) : []),
    ...(sites ? (['site'] as const) : []),
    ...(avecType ? (['type_site'] as const) : []),
    ...(avecActivite ? (['activite'] as const) : []),
    ...(avecContrat ? (['type_contrat'] as const) : []),
    ...(avecPoste ? (['poste'] as const) : []),
    ...(salaries ? (['matricule'] as const) : []),
    ...(cmpDim !== undefined ? (['cmp_dim'] as const) : []),
    ...(avecProfil ? (['sexe', 'age', 'anciennete'] as const) : []),
  ]
  // R9 : la liste comparée montre A et B ; les filtres envoyés au serveur n'ont que A dans la dimension.
  const val = (d: DimComparee) =>
    (cmpDim === d && filtres.cmp_val ? `${filtres[d] ?? ''}|${filtres.cmp_val}` : filtres[d]) ?? ''
  const comparer = (d: DimComparee): Comparer => cmpDim === undefined ? undefined : {
    actif: cmpDim === d,
    autre: cmpDim && cmpDim !== d ? LIBELLE_DIM[cmpDim] : undefined,
    onMode: (m: ModeListe) => onChange(
      m === 'comparer' ? { ...(cmpDim && { [cmpDim]: undefined }), cmp_dim: d, [d]: val(d).split('|').filter(Boolean).slice(0, 2).join('|') || undefined }
      : m === 'cumuler' ? { cmp_dim: undefined }
      : { [d]: undefined, ...(cmpDim === d && { cmp_dim: undefined }) },
    ),
  }
  // Filtre de filtres : seuls les filtres choisis sont montrés ; un filtre qui porte une valeur reste visible.
  const [affiches, setAffiches] = usePreference('graphes.filtres_affiches', lireAffiches, FILTRES_PAR_DEFAUT)
  const dispo = ([
    [avecActivite, 'activite', LIBELLE_DIM.activite],
    [!!departements, 'departement', LIBELLE_DIM.departement], [!!services, 'service', LIBELLE_DIM.service],
    [avecType, 'type_site', LIBELLE_DIM.type_site], [!!sites, 'site', LIBELLE_DIM.site],
    [avecContrat, 'type_contrat', LIBELLE_DIM.type_contrat], [avecPoste, 'poste', LIBELLE_DIM.poste],
    ...PROFIL.map((f) => [!!avecProfil, f.id, f.libelle] as const),
  ] as const).filter(([ok]) => ok).map(([, d, nom]) => ({ id: d, nom, groupe: GROUPE[d] }))
  const voir = (d: DimComparee | DimProfil) => affiches.includes(d) || !!filtres[d] || cmpDim === d
  const basculer = (d: string, afficher: boolean) => {
    setAffiches(afficher ? [...affiches, d] : affiches.filter((x) => x !== d))
    const dim = d as DimComparee | DimProfil
    if (!afficher && (filtres[dim] || cmpDim === dim)) onChange({ [dim]: undefined, ...(cmpDim === dim && { cmp_dim: undefined }) })
  }
  const selectionB = cmpDim && filtres.cmp_val
    ? (cmpDim === 'type_site' ? LIBELLE_TYPE_SITE[filtres.cmp_val] ?? filtres.cmp_val : filtres.cmp_val)
    : undefined
  return (
    <div className="filtres filtres-rapport" role="group" aria-label="Filtres">
      <TitreFiltres />
      {avecMois ? (
        <ChoixMois filtres={filtres} periodes={periodes ?? []} comparaison={comparaison === 'periode'} onChange={onChange} />
      ) : comparaison === 'annee' ? (
        periode && <ChoixPeriodes periode={periode} selectionB={selectionB} onChange={onChange} />
      ) : (
        <>
          {avecCalendrier && <ChoixCalendrier filtres={filtres} onChange={onChange} />}
          <ChoixAnnee filtres={filtres} annees={annees} onChange={onChange} />
        </>
      )}
      {dispo.length > 0 && (
        <div className="filtres-choix">
          <ChoixFiltres dispo={dispo} affiches={affiches} onChange={basculer} />
        </div>
      )}
      {departements && voir('departement') && (
        <MultiChoix libelle="Département" pluriel="départements" options={departements} valeur={val('departement')} onChange={(v) => onChange({ departement: v })} comparer={comparer('departement')} />
      )}
      {services && voir('service') && (
        <MultiChoix libelle="Service" pluriel="services" options={services} valeur={val('service')} onChange={(v) => onChange({ service: v })} comparer={comparer('service')} />
      )}
      {avecType && voir('type_site') && (
        <ChoixTypeSite comparer={comparer('type_site')} valeur={val('type_site')} types={typesSite!} onChange={(v) => onChange({ type_site: v })} />
      )}
      {sites && voir('site') && (
        <MultiChoix libelle="Site" pluriel="sites" options={sites} valeur={val('site')} onChange={(v) => onChange({ site: v })} comparer={comparer('site')} />
      )}
      {avecActivite && voir('activite') && (
        <MultiChoix libelle="Activité" pluriel="activités" tous="Toutes" options={activites!} valeur={val('activite')} onChange={(v) => onChange({ activite: v })} comparer={comparer('activite')} />
      )}
      {avecContrat && voir('type_contrat') && (
        <MultiChoix libelle="Contrat" pluriel="contrats" options={typesContrat!} valeur={val('type_contrat')} onChange={(v) => onChange({ type_contrat: v })} souple={false} comparer={comparer('type_contrat')} />
      )}
      {avecPoste && voir('poste') && <ChoixPoste comparer={comparer('poste')} valeur={val('poste')} postes={postes!} onChange={(v) => onChange({ poste: v })} />}
      {avecProfil && PROFIL.filter((f) => voir(f.id)).map((f) => (
        <MultiChoix
          key={f.id} libelle={f.libelle} pluriel={f.pluriel} options={f.valeurs.map(([v]) => v)}
          nomOption={(v) => f.valeurs.find(([c]) => c === v)?.[1] ?? v}
          valeur={filtres[f.id] ?? ''} onChange={(v) => onChange({ [f.id]: v })} souple={false}
        />
      ))}
      {salaries && (
        <ChoixEmploye salaries={salaries} valeur={filtres.matricule ?? ''} onChange={(m) => onChange({ matricule: m })} />
      )}
      <div className="filtres-actions">
        <BoutonReinitialiser
          actif={cles.some((k) => partage[k])}
          onClick={() => onChange(Object.fromEntries(cles.map((k) => [k, undefined])))}
        />
        {children}
      </div>
    </div>
  )
}
