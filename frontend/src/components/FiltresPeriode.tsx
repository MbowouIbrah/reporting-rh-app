import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FiltresPage } from '../api/rapports'
import type { Periode } from '../api/types'
import ChoixSalarie, { type Salarie } from './ChoixSalarie'
import type { ClePartagee, Partage } from '../lib/filtresPartages'
import { MOIS, MOIS_COURTS } from '../lib/format'
import BoutonReinitialiser from './BoutonReinitialiser'

type Patch = Record<string, string | number | undefined>

interface Props {
  filtres: FiltresPage
  annees: number[]
  services?: string[]
  sites?: string[]
  /** Types de site présents dans les données. */
  typesSite?: string[]
  postes?: string[]
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

/** Période précédant (annee, mois) : M-1, décembre de l'année d'avant en janvier. */
export const moisPrecedent = (annee: number, mois: number) =>
  mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 }

/** Libellé de la colonne de comparaison des tableaux : M-1 / N-1 par défaut, sinon la période choisie. */
export function libelleComparaison(f: FiltresPage, mode: 'annee' | 'periode') {
  if (mode === 'annee') return `${f.ref_annee ?? f.annee - 1}`
  return f.ref_annee && f.ref_mois ? `${MOIS_COURTS[f.ref_mois - 1]} ${f.ref_annee}` : 'M-1'
}

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
          <option value="">{f.annee - 1} (N-1)</option>
          {autres.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
    )
  }
  const prec = moisPrecedent(f.annee, f.mois)
  const cle = (p: Periode) => `${p.annee}-${String(p.mois).padStart(2, '0')}`
  const exclues = new Set([cle(f), cle(prec)])
  const autres = periodes.filter((p) => !exclues.has(cle(p))).sort((a, b) => cle(b).localeCompare(cle(a)))
  const valeur = f.ref_annee && f.ref_mois ? cle({ annee: f.ref_annee, mois: f.ref_mois }) : ''
  return (
    <label>
      Comparer à
      <select value={valeur} onChange={(e) => onChange({ cmp_periode: e.target.value })}>
        <option value="">{MOIS[prec.mois - 1]} {prec.annee} (M-1)</option>
        {autres.map((p) => (
          <option key={cle(p)} value={cle(p)}>{MOIS[p.mois - 1]} {p.annee}</option>
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
  filtres, annees, services, sites, typesSite, postes, salaries, avecMois = true, comparaison, periodes,
  children, onChange, partage,
}: Props) {
  const avecType = !!typesSite?.length
  const avecPoste = !!postes?.length
  // Réinitialiser rend aux filtres affichés leur valeur par défaut (dernière période, N-1/M-1, tous).
  const cles: ClePartagee[] = [
    'annee',
    ...(avecMois ? (['mois'] as const) : []),
    ...(comparaison === 'annee' ? (['cmp_annee'] as const) : comparaison === 'periode' ? (['cmp_periode'] as const) : []),
    ...(services ? (['service'] as const) : []),
    ...(sites ? (['site'] as const) : []),
    ...(avecType ? (['type_site'] as const) : []),
    ...(avecPoste ? (['poste'] as const) : []),
    ...(salaries ? (['matricule'] as const) : []),
  ]
  return (
    <div className="filtres filtres-rapport" role="group" aria-label="Filtres">
      <TitreFiltres />
      <label>
        Année
        <select value={filtres.annee} onChange={(e) => onChange({ annee: e.target.value })}>
          {annees.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      {avecMois && (
        <label>
          Mois
          <select value={filtres.mois} onChange={(e) => onChange({ mois: e.target.value })}>
            {MOIS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
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
