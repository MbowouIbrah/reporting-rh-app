import { ListFilter } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import type { FiltresPage } from '../api/rapports'
import type { Periode } from '../api/types'
import ChoixSalarie, { type Salarie } from './ChoixSalarie'
import type { ClePartagee, Partage } from '../lib/filtresPartages'
import { type Calendrier, libelleExercice } from '../lib/exercice'
import { MOIS_COURTS } from '../lib/format'
import {
  type Bornes, type Cmp, libelleBornes, libelleColonne, libelleComparee, lireCmp, lireVue, moisDeRang, rang, VUES,
} from '../lib/periode'
import BoutonReinitialiser from './BoutonReinitialiser'
import ChoixPeriode, { type OptionPeriode } from './ChoixPeriode'
import MultiChoix from './MultiChoix'

type Patch = Record<string, string | number | undefined>

interface Props {
  filtres: FiltresPage
  annees: number[]
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
  /** Sélecteur « Comparer à » : une année (annuel) ou une période (mensuel). */
  comparaison?: 'annee' | 'periode'
  /** Choix « Année civile / Année fiscale » (pages annuelles). */
  avecCalendrier?: boolean
  periodes?: Periode[]
  /** Pages annuelles : rang du dernier mois saisi de l'exercice (12 : exercice fini) ; borne les mois proposés. */
  derniere?: number
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
  if (mode === 'annee') return libelleComparee(f.annee, lireVue(f.vue), bornesDe(f), calDe(f), f.cmp ?? '', f.ref_annee)
  const p = f.ref_annee && f.ref_mois ? { annee: f.ref_annee, mois: f.ref_mois } : moisPrecedent(f.annee, f.mois)
  return libellePeriode(p)
}

const calDe = (f: FiltresPage): Calendrier => f.calendrier ?? 'civil'
/** Bornes (rangs de l'exercice) de la période affichée par une page annuelle. */
export const bornesDe = (f: FiltresPage): Bornes => ({
  debut: f.debut ? rang(f.debut, calDe(f)) : 1,
  fin: rang(f.mois, calDe(f)),
})
/** En-tête de la colonne de la période affichée (pages annuelles). */
export const libelleCourant = (f: FiltresPage) => libelleColonne(f.annee, lireVue(f.vue), bornesDe(f), calDe(f))

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
    const lc = (cmp: Cmp, ref?: number) => libelleComparee(f.annee, lireVue(f.vue), bornesDe(f), calDe(f), cmp, ref)
    const valeur = f.cmp ?? (f.ref_annee ? String(f.ref_annee) : '')
    return (
      <label>
        Comparer à
        <select
          value={valeur}
          onChange={(e) => {
            const v = e.target.value
            const cmp = lireCmp(v)
            onChange({ cmp: cmp || undefined, cmp_annee: cmp || !v ? undefined : v })
          }}
        >
          <option value="">Même période N-1 ({lc('')})</option>
          {autres.map((a) => (
            <option key={a} value={a}>Même période {a < f.annee ? `N-${f.annee - a}` : `N+${a - f.annee}`} ({lc('', a)})</option>
          ))}
          <option value="prec">Période précédente ({lc('prec')})</option>
          <option value="aucune">Aucune</option>
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

const nomMois = (r: number, cal: Calendrier) => MOIS_COURTS[moisDeRang(r, cal) - 1]
const rangs = (de: number, a: number) => Array.from({ length: Math.max(a - de + 1, 0) }, (_, i) => de + i)

/** Menu « Période » des pages annuelles (R6, variante A) : raccourcis, exercice, mois de la période,
 *  calendrier civil ou fiscal. Une période reste dans un exercice. */
export function ChoixPeriodeAnnuelle({ filtres: f, annees, derniere = 12, onChange }: {
  filtres: FiltresPage
  annees: number[]
  derniere?: number
  onChange: (patch: Patch) => void
}) {
  const id = useId()
  const racine = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const [ouvert, setOuvert] = useState(false)
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])

  const cal = calDe(f)
  const vue = lireVue(f.vue)
  const b = bornesDe(f)
  const max = Math.min(Math.max(derniere, 1), 12)
  const fin = (r: number) => ({ fin: moisDeRang(Math.min(r, max), cal) })
  const choixMois = (r: number, de = 1, a = max) => (
    <select value={r} onChange={(e) => onChange(fin(Number(e.target.value)))}>
      {rangs(de, a).map((x) => <option key={x} value={x}>{nomMois(x, cal)}</option>)}
    </select>
  )
  return (
    <div
      className="filtre multi-choix"
      ref={racine}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ouvert) {
          e.stopPropagation()
          setOuvert(false)
          bouton.current?.focus()
        }
      }}
    >
      <span id={`${id}-lib`}>Période</span>
      <button
        ref={bouton}
        type="button"
        className="multi-bouton periode-bouton"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-controls={`${id}-menu`}
        aria-labelledby={`${id}-lib ${id}-val`}
        onClick={() => setOuvert(!ouvert)}
      >
        <span id={`${id}-val`}>{libelleBornes(f.annee, b, cal)}</span>
      </button>
      {ouvert && (
        <div id={`${id}-menu`} className="multi-menu periode-menu" role="group" aria-labelledby={`${id}-lib`}>
          <fieldset>
            <legend>Afficher</legend>
            {VUES.map((v) => (
              <label key={v.vue} className="periode-radio">
                <input
                  type="radio" name={`${id}-vue`} checked={vue === v.vue}
                  onChange={() => onChange({ vue: v.vue === 'cumul' ? undefined : v.vue })}
                />
                {v.libelle}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Choix</legend>
            <label>
              {cal === 'fiscal' ? 'Exercice' : 'Année'}
              <select value={f.annee} onChange={(e) => onChange({ annee: e.target.value })}>
                {annees.map((a) => <option key={a} value={a}>{libelleExercice(a, f.calendrier)}</option>)}
              </select>
            </label>
            {vue === 'mois' && <label>Mois{choixMois(b.fin)}</label>}
            {vue === 'cumul' && <label>Jusqu’à{choixMois(b.fin)}</label>}
            {vue === 'trimestre' && (
              <label>
                Trimestre
                <select value={Math.ceil(b.fin / 3)} onChange={(e) => onChange(fin(3 * Number(e.target.value)))}>
                  {rangs(1, Math.ceil(max / 3)).map((q) => (
                    <option key={q} value={q}>T{q} · {nomMois(3 * q - 2, cal)} → {nomMois(3 * q, cal).toLowerCase()}</option>
                  ))}
                </select>
              </label>
            )}
            {vue === 'plage' && (
              <>
                <label>
                  Du
                  <select value={b.debut} onChange={(e) => onChange({ debut: moisDeRang(Number(e.target.value), cal) })}>
                    {rangs(1, b.fin).map((x) => <option key={x} value={x}>{nomMois(x, cal)}</option>)}
                  </select>
                </label>
                <label>Au{choixMois(b.fin, b.debut)}</label>
              </>
            )}
          </fieldset>
          <fieldset>
            <legend>Calendrier</legend>
            <label className="periode-radio">
              <input type="radio" name={`${id}-cal`} checked={cal === 'civil'} onChange={() => onChange({ calendrier: undefined })} />
              Année civile (janvier → décembre)
            </label>
            <label className="periode-radio">
              <input type="radio" name={`${id}-cal`} checked={cal === 'fiscal'} onChange={() => onChange({ calendrier: 'fiscal' })} />
              Année fiscale (avril → mars)
            </label>
          </fieldset>
          <p className="periode-note">Une période reste dans un exercice ; seuls les mois saisis sont proposés.</p>
        </div>
      )}
    </div>
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
  filtres, annees, departements, services, sites, typesSite, postes, activites, typesContrat, salaries, avecMois = true, comparaison, avecCalendrier, periodes,
  derniere, children, onChange, partage,
}: Props) {
  const avecType = !!typesSite?.length
  const avecPoste = !!postes?.length
  const avecActivite = !!activites?.length
  const avecContrat = !!typesContrat?.length
  // Réinitialiser rend aux filtres affichés leur valeur par défaut (dernière période, période d'avant, tous).
  const cles: ClePartagee[] = [
    ...(avecCalendrier ? (['calendrier', 'exercice'] as const) : []),
    ...(avecCalendrier && comparaison === 'annee' ? (['vue', 'debut', 'fin', 'cmp'] as const) : []),
    'annee',
    ...(avecMois ? (['mois'] as const) : []),
    ...(comparaison === 'annee' ? (['cmp_annee'] as const) : comparaison === 'periode' ? (['cmp_periode'] as const) : []),
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
        <ChoixMoisAnnee filtres={filtres} periodes={periodes ?? []} onChange={onChange} />
      ) : avecCalendrier && comparaison === 'annee' ? (
        <ChoixPeriodeAnnuelle filtres={filtres} annees={annees} derniere={derniere} onChange={onChange} />
      ) : (
        <>
          {avecCalendrier && <ChoixCalendrier filtres={filtres} onChange={onChange} />}
          <ChoixAnnee filtres={filtres} annees={annees} onChange={onChange} />
        </>
      )}
      {comparaison && (
        <ChoixComparaison mode={comparaison} filtres={filtres} annees={annees} periodes={periodes} onChange={onChange} />
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
