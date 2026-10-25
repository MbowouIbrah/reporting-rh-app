import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { getAnnuel } from '../api/rapports'
import type { Cell, Val } from '../api/types'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode from '../components/FiltresPeriode'
import { Variation } from '../components/Tuile'
import { useFiltres } from '../hooks/useFiltres'
import { cls, compact, fcfa, MOIS, MOIS_COURTS, pct, SEP, valeurBrute } from '../lib/format'
import { TitreRapport } from '../components/ExportPdf'

type Detail = [string, string][]

const NF2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
/** Bulles : une division par zéro est dite en clair, la case reste « — ». */
const NC = 'Non calculable'
const vide = (v: Val | undefined): v is null | undefined | 'n/a' => v == null || v === 'n/a'
/** Montant exact de l'API (3 décimales au plus), sans passer par un flottant. */
const exact = (v: Val | undefined) => {
  if (vide(v)) return v === 'n/a' ? NC : '—'
  const [e, d] = v.split('.')
  return `${valeurBrute(d ? `${e}.${d.slice(0, 3)}` : e)}${SEP}FCFA`
}
/** Effectifs moyens et taux : affichage seulement, deux décimales. */
const dec = (v: Val | undefined) => (vide(v) ? (v === 'n/a' ? NC : '—') : NF2.format(Number(v)).replace(/ /g, SEP))
const taux = (v: Val | undefined) => (vide(v) ? (v === 'n/a' ? NC : '—') : `${dec(String(Number(v) * 100))}${SEP}%`)
const comparaison = (c: Cell | undefined, an: string, n1: string): Detail => [
  [an, exact(c?.m)],
  [n1, exact(c?.m1)],
  ['Écart', exact(c?.var)],
  ['Évolution', taux(c?.var_pct)],
]
/** Une ligne de bulle par type de contrat : valeur et part du total. */
const parContrat = (d: Record<string, Cell & { part: Val }> | undefined, fmt: (v: Val | undefined) => string): Detail =>
  Object.entries(d ?? {}).map(([c, x]) => [c, `${fmt(x.m)} (${taux(x.part)})`])

function Case({
  titre,
  valeur,
  devise = true,
  libelle2,
  detail,
  children,
}: {
  titre: string
  valeur: string
  devise?: boolean
  /** Libellé de l'élément secondaire, à gauche sous le titre ; sa valeur (children) sous la valeur. */
  libelle2?: string
  /** Chiffres exacts affichés au survol (ou au focus clavier), comme les bulles des graphiques. */
  detail?: Detail
  children?: ReactNode
}) {
  return (
    <div className="tuile case" tabIndex={detail ? 0 : undefined}>
      <span className="micro">{titre}</span>
      <strong>
        {valeur}
        {devise && valeur !== '—' && <span className="devise"> FCFA</span>}
      </strong>
      {libelle2 && <span className="second-libelle">{libelle2}</span>}
      {children}
      {detail && (
        <div className="bulle" role="tooltip">
          {detail.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <span className="num">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Resume() {
  const f = useFiltres({ avecMois: false, comparaison: 'annee' })
  // Résumé annuel : cumul de l'année jusqu'au dernier mois saisi. Poste et employé ne s'appliquent pas ici.
  const base = f.filtres && {
    annee: f.filtres.annee,
    mois: f.filtres.mois,
    ref_annee: f.filtres.ref_annee,
    service: f.filtres.service,
    site: f.filtres.site,
    type_site: f.filtres.type_site,
    activite: f.filtres.activite,
    type_contrat: f.filtres.type_contrat,
  }
  // CA et marge n'existent qu'au global : masqués dès qu'un filtre restreint les salariés.
  const filtre = !!(base && (base.service || base.site || base.type_site || base.activite || base.type_contrat))
  const ann = useQuery({
    queryKey: ['annuel', base],
    queryFn: () => getAnnuel(base!),
    enabled: !!base,
    placeholderData: keepPreviousData,
  })
  const maj = ann.isPlaceholderData
  const an = f.filtres ? `${f.filtres.annee}` : ''
  const n1 = f.filtres ? `${f.filtres.ref_annee ?? f.filtres.annee - 1}` : ''
  const erreur = ann.error
  const a = ann.data
  const aCa = a !== undefined && a.serie_n.length > 0 && 'ca' in a.serie_n[0] && !filtre
  const montrer = (v: Val | undefined) => (v === undefined || v === null ? '—' : fcfa(v))
  const moisFin = a?.mois_fin ? MOIS_COURTS[a.mois_fin - 1] : ''
  const colonnes = [
    'MOIS', ...(aCa ? ['CA', 'MARGE', '% MARGE'] : []), 'MASSE SALARIALE', 'COMMISSIONS', 'PRIMES PROD.',
    'FRAIS DE MISSION', 'LOGEMENT SITE DÉPORTÉ',
  ]

  return (
    <section className={`page-ecran page-etroite resume-excel${maj ? ' maj' : ''}`} aria-busy={maj || ann.isLoading || undefined}>
      <TitreRapport titre="RÉSUMÉ DES INDICATEURS" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} comparaison="annee" filtres={f.filtres} annees={f.annees} services={f.services} sites={f.sites} typesSite={f.typesSite} activites={f.activites} typesContrat={f.typesContrat} partage={f.partage} onChange={f.set} />
      )}
      {f.vide && <Etat type="vide" />}
      {ann.isLoading && (
        // Premier chargement : cases et tableau à leur taille définitive, seules les valeurs en squelette.
        <>
          {[['Commissions', 'Masse salariale', 'MAD globaux'], ['Primes de productivité', 'Effectif global']].map((ligne) => (
            <div key={ligne[0]} className="cases">
              {ligne.map((t) => (
                <Case key={t} titre={t} valeur="—" devise={false} />
              ))}
            </div>
          ))}
          <h3 className="bandeau-titre">SUIVI MENSUEL</h3>
          <div className="table-scroll">
            <table className="dense suivi">
              <thead>
                <tr>{colonnes.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody aria-hidden="true">
                {MOIS.map((m) => (
                  <tr key={m}>
                    <th scope="row">{m}</th>
                    {colonnes.slice(1).map((c) => <td key={c} className="num" />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {erreur && <Etat type={etatErreur(erreur)} />}
      {a && (
        <>
          {/* Disposition du 16/10 : CA, commissions, masse salariale, MAD ; puis marge, primes,
              effectif global, CA par salarié. Effectifs = fin du dernier mois saisi. */}
          <div className="cases">
            {aCa && (
              <Case titre="Chiffre d’affaires" valeur={compact(a.ca_ytd)} libelle2={`Évolution par rapport à ${n1}`} detail={comparaison(a.ca_cumul, an, n1)}>
                <Variation v={a.ca_cumul?.var_pct} vs="" />
              </Case>
            )}
            <Case titre="Commissions" valeur={compact(a.commissions_ytd)} libelle2={`Évolution par rapport à ${n1}`} detail={comparaison(a.commissions_cumul, an, n1)}>
              <Variation v={a.commissions_cumul.var_pct} vs="" />
            </Case>
            <Case
              titre="Masse salariale"
              valeur={compact(a.cumul_ytd.m)}
              libelle2={`Évolution par rapport à ${n1}`}
              detail={parContrat(a.ms_contrat, exact)}
            >
              <Variation v={a.cumul_ytd.var_pct} vs="" />
            </Case>
            <Case titre="MAD globaux" valeur={montrer(a.mad_fin.m)} devise={false}
              libelle2="Pourcentage MAD sites déportés"
              detail={[
                [`MAD globaux ${moisFin} ${an}`, dec(a.mad_fin.m)],
                [`MAD globaux ${moisFin} ${n1}`, dec(a.mad_fin.m1)],
                ['MAD sites déportés', dec(a.mad_deportes_fin.m)],
                ['Part des MAD globaux', taux(a.mad_deportes_fin.part)],
                [`MAD sites déportés ${moisFin} ${n1}`, dec(a.mad_deportes_fin.m1)],
              ]}
            >
              <span className="second">
                {a.mad_deportes_fin.m == null
                  ? '—'
                  : `${dec(a.mad_deportes_fin.m)} · ${a.mad_deportes_fin.part == null ? '—' : pct(a.mad_deportes_fin.part)}`}
              </span>
            </Case>
          </div>
          <div className="cases">
            {aCa && (
              // Pas d'évolution sur la marge : le taux prend sa place, en second plan.
              <Case titre="Marge" valeur={compact(a.marge_ytd)} libelle2="Taux de marge"
                detail={[
                  ['Marge cumulée', exact(a.marge_ytd)],
                  ['CA des mois avec marge', exact(a.ca_avec_marge)],
                  ['Taux de marge', taux(a.taux_marge_ytd)],
                  ['Mois saisis', a.nb_mois_marge ? `${a.nb_mois_marge}` : '—'],
                ]}
              >
                <span className="second">{a.taux_marge_ytd == null ? '—' : pct(a.taux_marge_ytd)}</span>
              </Case>
            )}
            <Case titre="Primes de productivité" valeur={compact(a.primes_ytd)} libelle2={`Évolution par rapport à ${n1}`} detail={comparaison(a.primes_cumul, an, n1)}>
              <Variation v={a.primes_cumul.var_pct} vs="" />
            </Case>
            <Case titre="Effectif global" valeur={montrer(a.effectif_fin.m)} devise={false}
              libelle2={`Évolution par rapport à ${moisFin} ${n1}`}
              detail={parContrat(a.effectif_fin_contrat, dec)}
            >
              <Variation v={a.effectif_fin.var_pct} vs="" />
            </Case>
            {aCa && (
              <Case titre="CA par salarié" valeur={compact(a.ca_par_effectif?.m)} libelle2={`Évolution par rapport à ${n1}`}
                detail={[
                  ...comparaison(a.ca_par_effectif, an, n1),
                  ['CA cumulé', exact(a.ca_ytd)],
                  ['Effectif moyen', dec(a.effectif_moyen.m)],
                ]}
              >
                <Variation v={a.ca_par_effectif?.var_pct} vs="" />
              </Case>
            )}
          </div>
          {filtre && (
            <p className="regle">
              Le CA et la marge n’existent que pour l’ensemble de l’entreprise : ils ne s’affichent pas
              quand un service, un site, un type de site, une activité ou un contrat est choisi.
            </p>
          )}
        </>
      )}
      {a && (
        <>
          <div className="titre-ligne">
            <h3 className="bandeau-titre">SUIVI MENSUEL</h3>
            {aCa && (
              <button type="button" className="info" aria-label="À propos du suivi mensuel" aria-describedby="note-suivi">
                <Info aria-hidden="true" size={16} strokeWidth={2} />
                <span id="note-suivi" role="tooltip" className="info-bulle">
                  CA et marge saisis chaque mois par les RH ; % marge calculé sur les mois où les deux sont saisis.
                </span>
              </button>
            )}
          </div>
          <div className="table-scroll">
            <table className="dense suivi">
              <thead>
                <tr>{colonnes.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                {a.serie_n.map((l) => (
                  <tr key={l.mois}>
                    <th scope="row">{MOIS[l.mois - 1]}</th>
                    {aCa && <td className="num saisi">{montrer(l.ca)}</td>}
                    {aCa && <td className={`${cls(l.marge)} saisi`}>{montrer(l.marge)}</td>}
                    {aCa && <td className={cls(l.taux_marge)}>{l.taux_marge == null ? '—' : pct(l.taux_marge)}</td>}
                    <td className="num">{fcfa(l.ms)}</td>
                    <td className="num">{fcfa(l.commissions)}</td>
                    <td className="num">{fcfa(l.primes)}</td>
                    <td className="num">{fcfa(l.frais_mission)}</td>
                    <td className="num">{fcfa(l.logement)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">TOTAL</th>
                  {aCa && <td className="num">{montrer(a.ca_ytd)}</td>}
                  {aCa && <td className={cls(a.marge_ytd)}>{montrer(a.marge_ytd)}</td>}
                  {aCa && <td className={cls(a.taux_marge_ytd)}>{a.taux_marge_ytd == null ? '—' : pct(a.taux_marge_ytd)}</td>}
                  <td className="num">{fcfa(a.cumul_ytd.m)}</td>
                  <td className="num">{fcfa(a.commissions_ytd)}</td>
                  <td className="num">{fcfa(a.primes_ytd)}</td>
                  <td className="num">{fcfa(a.frais_mission_ytd)}</td>
                  <td className="num">{fcfa(a.logement_ytd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
