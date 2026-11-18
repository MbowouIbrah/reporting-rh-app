import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FiltresPage } from '../api/rapports'
import type { Periode } from '../api/types'
import ChoixSalarie, { type Salarie } from './ChoixSalarie'
import type { ClePartagee, Partage } from '../lib/filtresPartages'
import { libelleExercice } from '../lib/exercice'
import { MOIS_COURTS } from '../lib/format'
import {
  anneeDe, indice, libelle, lireTexte, longueur, moisDe, mois as moisSel, type PeriodeChoisie, texteMois, versTexte,
} from '../lib/periode'
import BoutonReinitialiser from './BoutonReinitialiser'
import ChoixPeriode from './ChoixPeriode'
import MultiChoix from './MultiChoix'

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
function ChoixPeriodes({ periode, onChange }: { periode: PeriodeChoisie; onChange: (patch: Patch) => void }) {
  return (
    <>
      <ChoixPeriode
        titre="Période" valeur={periode.sel} min={periode.min} max={periode.max}
        onChange={(s) => onChange({ periode: versTexte(s), comparee: undefined })}
      />
      {FLECHE}
      <ChoixPeriode
        titre="Comparer à" valeur={periode.cmp} min={periode.min} max={periode.max}
        longueur={longueur(periode.sel)} modele={periode.sel}
        onChange={(s) => onChange({ comparee: versTexte(s) })}
      />
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

export function ChoixTypeSite({ valeur, types, tous = 'Tous', onChange }: {
  valeur: string
  types: string[]
  tous?: string
  onChange: (v: string) => void
}) {
  return (
    <MultiChoix
      libelle="Type de site" pluriel="types" tous={tous} options={types} valeur={valeur} onChange={onChange}
      nomOption={(t) => LIBELLE_TYPE_SITE[t] ?? t} souple={false}
    />
  )
}

export function ChoixPoste({ valeur, postes, tous = 'Tous', onChange }: {
  valeur: string
  postes: string[]
  tous?: string
  onChange: (v: string) => void
}) {
  return <MultiChoix libelle="Poste" pluriel="postes" tous={tous} options={postes} valeur={valeur} onChange={onChange} />
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
  periode, children, onChange, partage,
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
  ]
  return (
    <div className="filtres filtres-rapport" role="group" aria-label="Filtres">
      <TitreFiltres />
      {avecMois ? (
        <ChoixMois filtres={filtres} periodes={periodes ?? []} comparaison={comparaison === 'periode'} onChange={onChange} />
      ) : comparaison === 'annee' ? (
        periode && <ChoixPeriodes periode={periode} onChange={onChange} />
      ) : (
        <>
          {avecCalendrier && <ChoixCalendrier filtres={filtres} onChange={onChange} />}
          <ChoixAnnee filtres={filtres} annees={annees} onChange={onChange} />
        </>
      )}
      {departements && (
        <MultiChoix libelle="Département" pluriel="départements" options={departements} valeur={filtres.departement ?? ''} onChange={(v) => onChange({ departement: v })} />
      )}
      {services && (
        <MultiChoix libelle="Service" pluriel="services" options={services} valeur={filtres.service ?? ''} onChange={(v) => onChange({ service: v })} />
      )}
      {avecType && (
        <ChoixTypeSite valeur={filtres.type_site ?? ''} types={typesSite!} onChange={(v) => onChange({ type_site: v })} />
      )}
      {sites && (
        <MultiChoix libelle="Site" pluriel="sites" options={sites} valeur={filtres.site ?? ''} onChange={(v) => onChange({ site: v })} />
      )}
      {avecActivite && (
        <MultiChoix libelle="Activité" pluriel="activités" tous="Toutes" options={activites!} valeur={filtres.activite ?? ''} onChange={(v) => onChange({ activite: v })} />
      )}
      {avecContrat && (
        <MultiChoix libelle="Contrat" pluriel="contrats" options={typesContrat!} valeur={filtres.type_contrat ?? ''} onChange={(v) => onChange({ type_contrat: v })} souple={false} />
      )}
      {avecPoste && <ChoixPoste valeur={filtres.poste ?? ''} postes={postes!} onChange={(v) => onChange({ poste: v })} />}
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
