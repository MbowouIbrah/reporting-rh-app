import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { BulleCases, useBulleCase, type Carte, type Section } from '../components/BulleCases'
import { getAnnuel } from '../api/rapports'
import type { Annuel, Cell, SerieMois, Val } from '../api/types'
import { usePeut } from '../auth/AuthContext'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode, { libelleComparaison, libelleCourant } from '../components/FiltresPeriode'
import { Variation } from '../components/Tuile'
import { useAttente } from '../hooks/useAttente'
import { useGabarit } from '../lib/gabarit'
import { useFiltres } from '../hooks/useFiltres'
import { cls, compact, fcfa, MOIS, MOIS_COURTS, pct, SEP, valeurBrute } from '../lib/format'
import { ordreMois, type Calendrier } from '../lib/exercice'
import { anneeDe, indice, libelleTexte, lireMois, moisDe } from '../lib/periode'
import { TitreRapport } from '../components/ExportPdf'

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
/** Évolution en pourcentage avec sa flèche ; vert / rouge seulement quand `couleur` (CA, marge, CA par salarié), sinon neutre. */
const evolution = (v: Val | undefined, couleur: boolean): ReactNode => {
  if (vide(v)) return taux(v)
  const n = Number(v)
  const classe = !couleur || n === 0 ? 'bc-neutre' : n > 0 ? 'bc-bon' : 'bc-mal'
  return <span className={classe}>{n < 0 ? '▼' : n > 0 ? '▲' : '■'} {n > 0 ? '+' : ''}{taux(v)}</span>
}
/** Section commune « Comparaison » : période, comparaison, écart, évolution. */
const comparaison = (
  c: Cell | undefined, an: string, n1: string, couleur: boolean, f: (v: Val | undefined) => string = exact,
): Section => ({
  type: 'lignes',
  titre: 'Comparaison',
  lignes: [
    { k: an, v: f(c?.m), fort: true },
    { k: n1, v: f(c?.m1) },
    { k: 'Écart', v: f(c?.var), sep: true },
    { k: 'Évolution', v: evolution(c?.var_pct, couleur) },
  ],
})
/** Ratio (0 à 1) de l'API en pourcentage de 0 à 100, pour la largeur des barres de part. */
const enPourcent = (v: Val | undefined) => Number(v) * 100
/** Écart de taux en points ; null si l'un des deux taux manque. */
const ecartPoints = (t: Val | undefined, t1: Val | undefined) => (vide(t) || vide(t1) ? null : (Number(t) - Number(t1)) * 100)
const textePoints = (d: number) => `${d > 0 ? '+' : ''}${dec(String(d))}${SEP}pt`
const texteEcart = (d: number | null) => (d === null ? '—' : textePoints(d))
/** Écart de taux en points, avec flèche et couleur (vert en hausse, rouge en baisse). */
const evolutionPoints = (d: number | null): ReactNode =>
  d === null ? '—' : <span className={d === 0 ? 'bc-neutre' : d > 0 ? 'bc-bon' : 'bc-mal'}>{d < 0 ? '▼' : d > 0 ? '▲' : '■'} {textePoints(d)}</span>
/** Parts par type de contrat : valeur et part du total (les lignes sans part sont écartées). */
const partsContrat = (d: Record<string, Cell & { part: Val }> | undefined, fmt: (v: Val | undefined) => string) =>
  Object.entries(d ?? {})
    .filter(([, x]) => !vide(x.part))
    .map(([c, x]) => ({ nom: c, valeur: fmt(x.m), part: enPourcent(x.part) }))

function Case({
  titre,
  valeur,
  devise = true,
  libelle2,
  carte,
  partiel,
  children,
}: {
  titre: string
  valeur: string
  devise?: boolean
  /** Libellé de l'élément secondaire, à gauche sous le titre ; sa valeur (children) sous la valeur. */
  libelle2?: string
  /** Carte de détail affichée au survol, au focus clavier ou au toucher. */
  carte?: Carte
  /** Total incomplet : une case attendue n'est pas renseignée. */
  partiel?: boolean
  children?: ReactNode
}) {
  const bulle = useBulleCase(titre, carte)
  return (
    <div className="tuile case" tabIndex={carte ? 0 : undefined} {...bulle}>
      <span className="micro">
        {titre}
        {partiel && <span className="partiel-mention" title="Total incomplet : une case attendue n’est pas renseignée">partiel</span>}
      </span>
      <strong>
        {valeur}
        {devise && valeur !== '—' && <span className="devise"> FCFA</span>}
      </strong>
      {libelle2 && <span className="second-libelle">{libelle2}</span>}
      {children}
    </div>
  )
}

/** Réponse sans valeurs, dessinée par le rendu normal au tout premier chargement (pas encore de gabarit) :
 *  mêmes cases, libellés, mois et ligne TOTAL que la page chargée. CA et marge selon le droit « marge:read ». */
const MOIS_3 = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

function reponseVide(avecCa: boolean, calendrier: Calendrier | undefined): Annuel {
  const cell = { m: null, m1: null, var: null, var_pct: null }
  const ca = avecCa ? { ca_ytd: null, marge_ytd: null, taux_marge_ytd: null, ca_cumul: cell, ca_par_effectif: cell } : {}
  return {
    ...ca,
    serie_n: ordreMois(calendrier).map((mois) => ({ mois, ...(avecCa ? { ca: null, marge: null, taux_marge: null } : {}) })),
    commissions_cumul: cell, primes_cumul: cell, cumul_ytd: cell, effectif_fin: cell, effectif_moyen: cell,
    effectif_moyen_mad: cell, part_mad: { m: null, m1: null }, mad_fin: cell, mad_deportes_fin: { ...cell, part: null }, ms_contrat: {}, effectif_fin_contrat: {},
  } as unknown as Annuel
}

export default function Resume() {
  const f = useFiltres({ avecMois: false, comparaison: 'annee', avecCalendrier: true })
  // Résumé annuel : cumul de l'année jusqu'au dernier mois saisi. Poste et employé ne s'appliquent pas ici.
  const base = f.filtres && {
    annee: f.filtres.annee,
    mois: f.filtres.mois,
    du: f.filtres.du,
    au: f.filtres.au,
    cmp_du: f.filtres.cmp_du,
    cmp_au: f.filtres.cmp_au,
    departement: f.filtres.departement,
    service: f.filtres.service,
    site: f.filtres.site,
    type_site: f.filtres.type_site,
    activite: f.filtres.activite,
    type_contrat: f.filtres.type_contrat,
  }
  // Sous filtre, le serveur renvoie le CA et la marge s'ils existent à ce niveau (site, service, employés) ; sinon null.
  const filtre = !!(base && (base.departement || base.service || base.site || base.type_site || base.activite || base.type_contrat))
  const ann = useQuery({
    queryKey: ['annuel', base],
    queryFn: () => getAnnuel(base!),
    enabled: !!base,
    placeholderData: keepPreviousData,
  })
  const [premier, relais] = useAttente(ann.isLoading)
  const [maj, relaisMaj] = useAttente(ann.isPlaceholderData)
  const gab = useGabarit('annuel', ann.data, !ann.isPlaceholderData)
  const an = f.filtres ? libelleCourant(f.filtres) : ''
  const n1 = f.filtres ? libelleComparaison(f.filtres, 'annee') : ''
  const erreur = premier ? null : ann.error
  const peutCa = usePeut('marge:read')
  // Premier chargement : la page à la forme de la dernière réponse (sinon d'une réponse vide), valeurs en squelette.
  const a = premier ? (gab ?? (f.filtres ? reponseVide(peutCa, f.filtres.calendrier) : undefined)) : ann.data
  // Clés absentes de la réponse sans le droit « marge » ; présentes mais null quand le filtre n'a pas de CA.
  const droitCa = a !== undefined && 'ca_ytd' in a
  const aCa = droitCa && a.serie_n.length > 0 && 'ca' in a.serie_n[0] && (!filtre || premier || a.ca_ytd != null || a.serie_n.some((m) => m.ca != null))
  // Tuile indisponible : sous filtre seulement, quand la valeur est null (inconnu pendant le premier chargement).
  const indef = droitCa && filtre && !premier
  const sansCa = indef && a.ca_ytd == null
  const sansMarge = indef && a.marge_ytd == null
  const sansCaEff = indef && a.ca_par_effectif?.m == null
  const indispo = (titre: string) => (
    <Case titre={titre} valeur="—" devise={false} libelle2="Non disponible pour ces filtres" />
  )
  const fb = a?.front_back && a.front_back.total > 0 ? a.front_back : null
  // R9 : front / back office sur la masse salariale, le CA et la marge (3e ligne, détail au survol).
  const msFb = a?.ms_front_back && !vide(a.ms_front_back.front_pct) ? a.ms_front_back : null
  const parFront = (titre: string, v: Val | undefined): Section[] => vide(v) ? [] : [{
    type: 'lignes',
    titre: 'Front office',
    lignes: [
      { k: `${titre} par employé front office`, v: exact(v) },
      { k: 'Effectif moyen front office', v: dec(a?.effectif_moyen_front) },
    ],
  }]
  const ligneFront = (v: Val | undefined) => !vide(v) && <span className="ratio-fb">Par employé front office {compact(v)}</span>
  const montrer = (v: Val | undefined) => (v === undefined || v === null ? '—' : fcfa(v))
  // Dernier mois saisi avec sa vraie année (en fiscal, l'exercice 2025-26 finit en 2026).
  const finN = f.filtres && a?.mois_fin ? (a.annee_fin ?? f.filtres.annee) : undefined
  const moisFin = finN && a?.mois_fin ? MOIS_COURTS[a.mois_fin - 1] : ''
  const finAn = finN ? `${finN}` : an
  // Fin de la période comparée : le dernier mois saisi, décalé comme la comparaison l'est de la période.
  const du = lireMois(f.filtres?.du)
  const cmpDu = lireMois(f.filtres?.cmp_du)
  const iFinCmp = finN && a?.mois_fin && du !== null && cmpDu !== null ? indice(finN, a.mois_fin) + cmpDu - du : null
  const finCmp = iFinCmp !== null ? `${MOIS_COURTS[moisDe(iFinCmp) - 1]} ${anneeDe(iFinCmp)}` : n1
  const parRapport = (x: string) => `Évolution par rapport à ${x}`
  // Suivi mensuel (réunion du 23/11) : les mois du cadre, ceux hors période grisés ; chaque mois
  // porte son année (mois en trois lettres dans une case de largeur fixe, années alignées).
  const iDu = lireMois(a?.du ?? f.filtres?.du)
  const iAu = lireMois(a?.au ?? f.filtres?.au)
  const dansPeriode = (l: SerieMois) =>
    l.annee == null || iDu === null || iAu === null || (indice(l.annee, l.mois) >= iDu && indice(l.annee, l.mois) <= iAu)
  const horsPeriode = !!a?.serie_n.some((l) => !dansPeriode(l))
  const nomLigne = (annee: number | undefined, m: number) => (annee
    ? <><span className="mois-3">{MOIS_3[m - 1]}</span> {annee}</>
    : MOIS[m - 1])
  const titrePeriode = an && (
    <>Chiffres de <strong>{an}</strong>{n1 && <>, évolution par rapport à <strong>{n1}</strong></>}</>
  )
  const perTab = libelleTexte(a?.du, a?.au) || an
  const perCmp = libelleTexte(a?.cmp_du, a?.cmp_au) || n1
  /** Écart de taux de marge, en points. */
  const ecartPts = (t: Val | undefined, t1: Val | undefined) => {
    const d = ecartPoints(t, t1)
    if (d === null) return <td className="num">—</td>
    return <td className={d < 0 ? 'num neg' : 'num'}>{textePoints(d)}</td>
  }
  const periodes = `${an} · comparé à ${n1}`
  /** Mini-courbe d'un indicateur mensuel : mois de la période, valeurs brutes de la série (Number() pour tracer seulement). */
  const courbe = (x: Annuel, champ: 'ca' | 'marge' | 'ms' | 'commissions' | 'primes' | 'effectif'): Section => {
    const idx = x.serie_n.flatMap((l, i) => (dansPeriode(l) ? [i] : []))
    const valeur = (l: SerieMois | undefined) => {
      const v = l?.[champ]
      return v == null || v === 'n/a' ? null : Number(v)
    }
    return {
      type: 'courbe',
      mois: idx.map((i) => MOIS[x.serie_n[i].mois - 1][0]),
      n: idx.map((i) => valeur(x.serie_n[i])),
      n1: idx.map((i) => valeur(x.serie_n1?.[i])),
      legendeN: an,
      legendeN1: n1,
    }
  }
  /** Parts front / back office (0 à 100) d'un montant ou d'un effectif. */
  const partsFrontBack = (front: string, back: string, fpct: Val | undefined, bpct: Val | undefined): Section[] =>
    vide(fpct) || vide(bpct) ? [] : [{
      type: 'parts',
      titre: 'Front / back office',
      parts: [
        { nom: 'Front office', valeur: front, part: enPourcent(fpct) },
        { nom: 'Back office', valeur: back, part: enPourcent(bpct), bo: true },
      ],
    }]
  const sectionContrats = (titre: string, parts: ReturnType<typeof partsContrat>): Section[] =>
    parts.length ? [{ type: 'parts', titre, parts }] : []
  const evol = (c: Cell | undefined) => <td className="num"><Variation v={c?.var_pct} /></td>
  // Le premier mois de la période en haut du tableau : jamais caché sous les totaux figés
  const defile = useRef<HTMLDivElement>(null)
  const cle = `${a?.du ?? ''}-${a?.serie_n[0]?.annee ?? ''}-${a?.serie_n[0]?.mois ?? ''}`
  useEffect(() => {
    const zone = defile.current
    const ligne = zone?.querySelector<HTMLElement>('tbody tr.en-periode')
    if (!zone || !ligne) return
    const entete = zone.querySelector('thead')?.getBoundingClientRect().height ?? 0
    zone.scrollTop = ligne.offsetTop - entete
  }, [cle])
  const colonnes = [
    'MOIS', ...(aCa ? ['CA', 'MARGE', '% MARGE'] : []), 'MASSE SALARIALE', 'COMMISSIONS', 'PRIMES PROD.',
    'FRAIS DE MISSION', 'LOGEMENT SITE DÉPORTÉ',
  ]

  return (
    <section className={`page-ecran page-etroite resume-excel${maj ? ' maj' : ''}${relais || relaisMaj ? ' relais' : ''}${premier ? ' chargement' : ''}`} aria-busy={maj || premier || undefined}>
      <BulleCases>
      <TitreRapport titre="BUDGET RÉALISÉ" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} comparaison="annee" filtres={f.filtres} departements={f.departements} services={f.services} sites={f.sites} typesSite={f.typesSite} activites={f.activites} typesContrat={f.typesContrat} partage={f.partage} periode={f.periode} onChange={f.set} />
      )}
      {f.erreur ? <Etat type={etatErreur(f.erreur)} onRetry={f.relancer} /> : f.vide && <Etat type="vide" />}
      {erreur && <Etat type={etatErreur(erreur)} onRetry={() => ann.refetch()} />}
      {a && (
        <>
          {/* Disposition du 16/10 : CA, commissions, masse salariale, MAD ; puis marge, primes,
              effectif global, CA par salarié. Effectifs = fin du dernier mois saisi. */}
          {titrePeriode && <p className="periode-titre">{titrePeriode}</p>}
          <div className="cases">
            {sansCa && indispo('Chiffre d’affaires')}
            {aCa && !sansCa && (
              <Case titre="Chiffre d’affaires" partiel={a.lignes_ca_marge?.ca.partiel} valeur={compact(a.ca_ytd)} libelle2={parRapport(n1)}
                carte={{
                  titre: 'Chiffre d’affaires',
                  periodes,
                  sections: [
                    comparaison(a.ca_cumul, an, n1, true),
                    courbe(a, 'ca'),
                    ...parFront('CA', a.ca_par_front),
                    {
                      type: 'calcul',
                      texte: 'Somme des CA saisis sur les mois de la période.',
                      mention: a.lignes_ca_marge?.ca.partiel ? 'Total incomplet : une case attendue n’est pas renseignée' : undefined,
                    },
                  ],
                }}
              >
                <Variation v={a.ca_cumul?.var_pct} vs="" />
                {ligneFront(a.ca_par_front)}
              </Case>
            )}
            <Case titre="Commissions" valeur={compact(a.commissions_ytd)} libelle2={parRapport(n1)}
              carte={{
                titre: 'Commissions',
                periodes,
                sections: [
                  comparaison(a.commissions_cumul, an, n1, false),
                  courbe(a, 'commissions'),
                  { type: 'calcul', texte: 'Somme des commissions des fichiers de paie de la période.' },
                ],
              }}
            >
              <Variation v={a.commissions_cumul.var_pct} vs="" />
            </Case>
            <Case
              titre="Masse salariale"
              valeur={compact(a.cumul_ytd.m)}
              libelle2={parRapport(n1)}
              carte={{
                titre: 'Masse salariale',
                periodes,
                sections: [
                  comparaison(a.cumul_ytd, an, n1, false),
                  courbe(a, 'ms'),
                  ...sectionContrats('Par type de contrat', partsContrat(a.ms_contrat, exact)),
                  ...(msFb ? partsFrontBack(exact(msFb.front), exact(msFb.back), msFb.front_pct, msFb.back_pct) : []),
                  { type: 'calcul', texte: `Somme des masses salariales mensuelles. Moyenne par mois : ${exact(a.moyenne_mensuelle?.m)}.` },
                ],
              }}
            >
              <Variation v={a.cumul_ytd.var_pct} vs="" />
              {msFb && <span className="ratio-fb">Front office {pct(msFb.front_pct)} · Back office {pct(msFb.back_pct)}</span>}
            </Case>
            <Case titre="Part des MAD" valeur={vide(a.part_mad.m) ? '—' : taux(a.part_mad.m)} devise={false}
              libelle2="Pourcentage MAD sites déportés"
              carte={{
                titre: 'Part des MAD',
                periodes,
                sections: [
                  {
                    type: 'lignes',
                    titre: 'Part des MAD dans l’effectif moyen',
                    lignes: [
                      { k: an, v: taux(a.part_mad.m), fort: true },
                      { k: n1, v: taux(a.part_mad.m1) },
                      { k: 'Écart', v: texteEcart(ecartPoints(a.part_mad.m, a.part_mad.m1)), sep: true },
                    ],
                  },
                  {
                    type: 'lignes',
                    titre: `Effectifs moyens (${an})`,
                    lignes: [
                      { k: 'MAD', v: dec(a.effectif_moyen_mad.m) },
                      { k: 'Total', v: dec(a.effectif_moyen.m) },
                    ],
                  },
                  {
                    type: 'lignes',
                    titre: 'Fin de période',
                    lignes: [
                      { k: '', v: <><b>{moisFin} {finAn}</b> · {finCmp}</> },
                      { k: 'MAD globaux', v: <><b>{dec(a.mad_fin.m)}</b> · {dec(a.mad_fin.m1)}</> },
                      { k: 'dont sites déportés', v: <><b>{dec(a.mad_deportes_fin.m)}</b> · {dec(a.mad_deportes_fin.m1)}</> },
                      { k: 'Part des sites déportés', v: <b>{taux(a.mad_deportes_fin.part)}</b> },
                    ],
                  },
                  { type: 'calcul', texte: 'Effectif moyen MAD ÷ effectif moyen total.' },
                ],
              }}
            >
              <span className="second">
                {a.mad_deportes_fin.m == null
                  ? '—'
                  : `${dec(a.mad_deportes_fin.m)} · ${a.mad_deportes_fin.part == null ? '—' : pct(a.mad_deportes_fin.part)}`}
              </span>
            </Case>
          </div>
          <div className="cases">
            {sansMarge && indispo('Marge')}
            {aCa && !sansMarge && (
              // Pas d'évolution sur la marge : le taux prend sa place, en second plan.
              <Case titre="Marge" partiel={a.lignes_ca_marge?.marge.partiel} valeur={compact(a.marge_ytd)} libelle2="Taux de marge"
                carte={{
                  titre: 'Marge',
                  periodes,
                  sections: [
                    {
                      type: 'lignes',
                      titre: 'Comparaison',
                      lignes: [
                        { k: `Marge ${an}`, v: exact(a.marge_ytd), fort: true },
                        { k: `Taux de marge ${an}`, v: taux(a.taux_marge_ytd), fort: true },
                        { k: `Taux de marge ${n1}`, v: taux(a.taux_marge_cmp) },
                        { k: 'Écart de taux', v: evolutionPoints(ecartPoints(a.taux_marge_ytd, a.taux_marge_cmp)), sep: true },
                      ],
                    },
                    courbe(a, 'marge'),
                    {
                      type: 'lignes',
                      titre: 'Base',
                      lignes: [
                        { k: 'CA des mois avec marge', v: exact(a.ca_avec_marge) },
                        { k: 'Mois saisis', v: a.nb_mois_marge ? `${a.nb_mois_marge}` : '—' },
                        ...(vide(a.marge_par_front) ? [] : [{ k: 'Marge par employé front office', v: exact(a.marge_par_front) }]),
                      ],
                    },
                    { type: 'calcul', texte: 'Taux = marge cumulée ÷ CA des mois où la marge est saisie.' },
                  ],
                }}
              >
                <span className="second">{a.taux_marge_ytd == null ? '—' : pct(a.taux_marge_ytd)}</span>
                {ligneFront(a.marge_par_front)}
              </Case>
            )}
            <Case titre="Primes de productivité" valeur={compact(a.primes_ytd)} libelle2={parRapport(n1)}
              carte={{
                titre: 'Primes de productivité',
                periodes,
                sections: [
                  comparaison(a.primes_cumul, an, n1, false),
                  courbe(a, 'primes'),
                  { type: 'calcul', texte: 'Somme des primes de productivité des fichiers de paie de la période.' },
                ],
              }}
            >
              <Variation v={a.primes_cumul.var_pct} vs="" />
            </Case>
            <Case titre="Effectif global" valeur={montrer(a.effectif_fin.m)} devise={false}
              libelle2={parRapport(finCmp)}
              carte={{
                titre: 'Effectif global',
                periodes: `Fin ${moisFin} ${finAn} · comparé à ${finCmp}`,
                sections: [
                  comparaison(a.effectif_fin, `Fin ${moisFin} ${finAn}`, finCmp, false, dec),
                  courbe(a, 'effectif'),
                  // R9 : chaque contrat avec sa répartition front / back office.
                  ...(Object.keys(a.effectif_fin_contrat).length ? [{
                    type: 'lignes' as const,
                    titre: 'Par type de contrat',
                    lignes: [
                      { k: '', v: 'Total · FO · BO' },
                      ...Object.entries(a.effectif_fin_contrat).map(([c, x]) => {
                        const r = fb?.par_contrat?.[c]
                        return { k: c, v: r ? <><b>{dec(x.m)}</b> · {r.front} · {r.back}</> : <b>{dec(x.m)}</b> }
                      }),
                    ],
                  }] : []),
                  ...(fb ? partsFrontBack(dec(String(fb.front)), dec(String(fb.back)), fb.front_pct, fb.back_pct) : []),
                  { type: 'calcul', texte: `Salariés présents à la fin du dernier mois saisi (${moisFin} ${finAn}). Effectif moyen de la période : ${dec(a.effectif_moyen.m)}.` },
                ],
              }}
            >
              <Variation v={a.effectif_fin.var_pct} vs="" />
              {/* Productif / administratif : part de l'effectif de fin en front et en back office. */}
              {fb && <span className="ratio-fb">Front office {pct(fb.front_pct)} · Back office {pct(fb.back_pct)}</span>}
            </Case>
            {sansCaEff && indispo('CA par salarié')}
            {aCa && !sansCaEff && (
              <Case titre="CA par salarié" valeur={compact(a.ca_par_effectif?.m)} libelle2={parRapport(n1)}
                carte={{
                  titre: 'CA par salarié',
                  periodes,
                  sections: [
                    comparaison(a.ca_par_effectif, an, n1, true),
                    {
                      type: 'lignes',
                      titre: 'Calcul',
                      lignes: [
                        { k: 'CA cumulé', v: exact(a.ca_ytd) },
                        { k: '÷ Effectif moyen', v: dec(a.effectif_moyen.m) },
                        { k: '= CA par salarié', v: exact(a.ca_par_effectif?.m), fort: true, sep: true },
                      ],
                    },
                  ],
                }}
              >
                <Variation v={a.ca_par_effectif?.var_pct} vs="" />
              </Case>
            )}
          </div>
        </>
      )}
      {a && (
        <>
          <div className="titre-ligne">
            <h3 className="bandeau-titre">SUIVI MENSUEL{perTab && ` · ${perTab.toUpperCase()}`}</h3>
            {(aCa || sansCa || sansMarge) && (
              <button type="button" className="info" aria-label="À propos du suivi mensuel" aria-describedby="note-suivi">
                <Info aria-hidden="true" size={16} strokeWidth={2} />
                <span id="note-suivi" role="tooltip" className="info-bulle">
                  {aCa && <span className="info-ligne">CA et marge saisis chaque mois par les RH ; % marge calculé sur les mois où les deux sont saisis.</span>}
                  {(sansCa || sansMarge) && (
                    <span className="info-ligne">
                      {sansCa && sansMarge ? 'Le CA et la marge ne sont pas disponibles' : sansCa ? 'Le CA n’est pas disponible' : 'La marge n’est pas disponible'}
                      {' '}pour ces filtres : {sansCa && sansMarge ? 'ils n’existent' : 'il n’existe'} que s’{sansCa && sansMarge ? 'ils sont saisis' : 'il est saisi'}
                      {' '}à ce niveau (site, service) ou renseigné{sansCa && sansMarge ? 's' : ''} par employé.
                    </span>
                  )}
                </span>
              </button>
            )}
          </div>
          <div className="table-scroll" ref={defile}>
            <table className="dense suivi">
              <thead>
                <tr>{colonnes.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              <tbody>
                {a.serie_n.map((l) => (
                  <tr key={`${l.annee ?? ''}-${l.mois}`} className={dansPeriode(l) ? (horsPeriode ? 'en-periode' : undefined) : 'hors-periode'}>
                    <th scope="row">
                      {nomLigne(l.annee, l.mois)}
                      {!dansPeriode(l) && <span className="sr-only"> (hors période)</span>}
                    </th>
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
                  <th scope="row" title="Total de la période choisie">TOTAL {perTab.toUpperCase()}</th>
                  {aCa && <td className="num">{montrer(a.ca_ytd)}</td>}
                  {aCa && <td className={cls(a.marge_ytd)}>{montrer(a.marge_ytd)}</td>}
                  {aCa && <td className={cls(a.taux_marge_ytd)}>{a.taux_marge_ytd == null ? '—' : pct(a.taux_marge_ytd)}</td>}
                  <td className="num">{fcfa(a.cumul_ytd.m)}</td>
                  <td className="num">{fcfa(a.commissions_ytd)}</td>
                  <td className="num">{fcfa(a.primes_ytd)}</td>
                  <td className="num">{fcfa(a.frais_mission_ytd)}</td>
                  <td className="num">{fcfa(a.logement_ytd)}</td>
                </tr>
                {perCmp && (
                  <tr className="cmp">
                    <th scope="row" title="Total de la période comparée">TOTAL {perCmp.toUpperCase()}</th>
                    {aCa && <td className="num">{montrer(a.ca_cumul?.m1)}</td>}
                    {aCa && <td className={cls(a.lignes_ca_marge?.marge.m1)}>{montrer(a.lignes_ca_marge?.marge.m1)}</td>}
                    {aCa && <td className={cls(a.taux_marge_cmp)}>{vide(a.taux_marge_cmp) ? '—' : pct(a.taux_marge_cmp)}</td>}
                    <td className="num">{montrer(a.cumul_ytd.m1)}</td>
                    <td className="num">{montrer(a.commissions_cumul.m1)}</td>
                    <td className="num">{montrer(a.primes_cumul.m1)}</td>
                    <td className="num">{montrer(a.frais_mission?.m1)}</td>
                    <td className="num">{montrer(a.logement_cumul?.m1)}</td>
                  </tr>
                )}
                {perCmp && (
                  <tr className="evol">
                    <th scope="row" title={`Évolution de ${perTab} par rapport à ${perCmp}`}>ÉVOLUTION</th>
                    {aCa && evol(a.ca_cumul)}
                    {aCa && evol(a.lignes_ca_marge?.marge)}
                    {aCa && ecartPts(a.taux_marge_ytd, a.taux_marge_cmp)}
                    {evol(a.cumul_ytd)}
                    {evol(a.commissions_cumul)}
                    {evol(a.primes_cumul)}
                    {evol(a.frais_mission)}
                    {evol(a.logement_cumul)}
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          {horsPeriode && (
            <p className="periode-titre periode-pied">
              Mois grisés : hors période, non comptés dans les totaux.
            </p>
          )}
        </>
      )}
      </BulleCases>
    </section>
  )
}
