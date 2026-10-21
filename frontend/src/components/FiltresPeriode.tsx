import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FiltresPage } from '../api/rapports'
import type { Periode } from '../api/types'
import ChoixSalarie, { type Salarie } from './ChoixSalarie'
import type { ClePartagee, Partage } from '../lib/filtresPartages'
import { MOIS_COURTS } from '../lib/format'
import BoutonReinitialiser from './BoutonReinitialiser'
import ChoixPeriode, { type OptionPeriode } from './ChoixPeriode'

type Patch = Record<string, string | number | undefined>

interface Props {
  filtres: FiltresPage
  annees: number[]
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
  /** Sélecteur « Comparer à » : une année (annuel) ou une période (mensuel). */
  comparaison?: 'annee' | 'periode'
  periodes?: Periode[]
  /** Champs supplémentaires, alignés sur la même ligne que les filtres. */
  children?: ReactNode
  onChange: (patch: Patch) => void
  /** Valeurs choisies (filtres partagés) : seules elles rendent Réinitialiser actif. */
  partage: Partage
}

/** Période précédant (annee, mois) : mois d'avant, décembre de l'année d'avant en janvier. */
const clePeriode = (p: { annee: number; mois: number }) => `${p.annee}-${String(p.mois).padStart(2, '0')}`

export const moisPrecedent = (annee: number, mois: number) =>
  mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 }

/** Libellé de la colonne de comparaison des tableaux : la période choisie, sinon le mois ou l'année d'avant. */
export function libelleComparaison(f: FiltresPage, mode: 'annee' | 'periode') {
  if (mode === 'annee') return `${f.ref_annee ?? f.annee - 1}`
  const p = f.ref_annee && f.ref_mois ? { annee: f.ref_annee, mois: f.ref_mois } : moisPrecedent(f.annee, f.mois)
  return libellePeriode(p)
}

/** Libellé court d'une période (« Juin 2026 ») : en-têtes de tableaux. */
export const libellePeriode = (p: { annee: number; mois: number }) => `${MOIS_COURTS[p.mois - 1]} ${p.annee}`

export function ChoixComparaison({ mode, filtres: f, annees, periodes = [], onChange }: {
  mode: 'annee' | 'periode'
  filtres: FiltresPage
  annees: number[]
  periodes?: Periode[]
  onChange: (patch: Patch) => void
}) {
  if (mode === 'annee') {
    const autres = annees.filter((a) => a !== f.annee && a !== f.annee - 1).sort((a, b) => b - a)
    return (
      <label>
        Comparer à
        <select value={f.ref_annee ?? ''} onChange={(e) => onChange({ cmp_annee: e.target.value })}>
          <option value="">{f.annee - 1}</option>
          {autres.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
    )
  }
  const prec = moisPrecedent(f.annee, f.mois)
  const exclues = new Set([clePeriode(f), clePeriode(prec)])
  const options: OptionPeriode[] = [
    { valeur: '', ...prec },
    ...periodes.filter((p) => !exclues.has(clePeriode(p))).map((p) => ({ valeur: clePeriode(p), annee: p.annee, mois: p.mois })),
  ].sort((x, y) => clePeriode(x).localeCompare(clePeriode(y)))
  const valeur = f.ref_annee && f.ref_mois ? clePeriode({ annee: f.ref_annee, mois: f.ref_mois }) : ''
  return <ChoixPeriode libelle="Comparer à" options={options} valeur={valeur} onChange={(v) => onChange({ cmp_periode: v })} />
}

/** Période étudiée (mensuel) : périodes importées en ordre chronologique, plus la période affichée si elle n'y est pas. */
function ChoixMoisAnnee({ filtres: f, periodes, onChange }: {
  filtres: FiltresPage
  periodes: Periode[]
  onChange: (patch: Patch) => void
}) {
  const valeur = clePeriode(f)
  const cles = new Set([valeur, ...periodes.map(clePeriode)])
  const options = [...cles].sort().map((c) => {
    const [annee, mois] = c.split('-').map(Number)
    return { valeur: c, annee, mois }
  })
  return (
    <ChoixPeriode
      libelle="Période"
      options={options}
      valeur={valeur}
      onChange={(v) => {
        const [annee, mois] = v.split('-').map(Number)
        onChange({ annee, mois })
      }}
    />
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
    <label>
      Type de site
      <select value={valeur} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tous}</option>
        {types.map((t) => (
          <option key={t} value={t}>{LIBELLE_TYPE_SITE[t] ?? t}</option>
        ))}
      </select>
    </label>
  )
}

export function ChoixPoste({ valeur, postes, tous = 'Tous', onChange }: {
  valeur: string
  postes: string[]
  tous?: string
  onChange: (v: string) => void
}) {
  return (
    <label className="souple">
      Poste
      <select value={valeur} onChange={(e) => onChange(e.target.value)}>
        <option value="">{tous}</option>
        {postes.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </label>
  )
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
  filtres, annees, services, sites, typesSite, postes, activites, typesContrat, salaries, avecMois = true, comparaison, periodes,
  children, onChange, partage,
}: Props) {
  const avecType = !!typesSite?.length
  const avecPoste = !!postes?.length
  const avecActivite = !!activites?.length
  const avecContrat = !!typesContrat?.length
  // Réinitialiser rend aux filtres affichés leur valeur par défaut (dernière période, période d'avant, tous).
  const cles: ClePartagee[] = [
    'annee',
    ...(avecMois ? (['mois'] as const) : []),
    ...(comparaison === 'annee' ? (['cmp_annee'] as const) : comparaison === 'periode' ? (['cmp_periode'] as const) : []),
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
        <ChoixMoisAnnee filtres={filtres} periodes={periodes ?? []} onChange={onChange} />
      ) : (
        <label>
          Année
          <select value={filtres.annee} onChange={(e) => onChange({ annee: e.target.value })}>
            {annees.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      )}
      {comparaison && (
        <ChoixComparaison mode={comparaison} filtres={filtres} annees={annees} periodes={periodes} onChange={onChange} />
      )}
      {services && (
        <label className="souple">
          Service
          <select value={filtres.service ?? ''} onChange={(e) => onChange({ service: e.target.value })}>
            <option value="">Tous</option>
            {services.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {avecType && (
        <ChoixTypeSite valeur={filtres.type_site ?? ''} types={typesSite!} onChange={(v) => onChange({ type_site: v })} />
      )}
      {sites && (
        <label className="souple">
          Site
          <select value={filtres.site ?? ''} onChange={(e) => onChange({ site: e.target.value })}>
            <option value="">Tous</option>
            {sites.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {avecActivite && (
        <label className="souple">
          Activité
          <select value={filtres.activite ?? ''} onChange={(e) => onChange({ activite: e.target.value })}>
            <option value="">Toutes</option>
            {activites!.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {avecContrat && (
        <label>
          Contrat
          <select value={filtres.type_contrat ?? ''} onChange={(e) => onChange({ type_contrat: e.target.value })}>
            <option value="">Tous</option>
            {typesContrat!.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
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
