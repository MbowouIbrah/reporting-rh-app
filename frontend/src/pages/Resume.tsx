import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { BulleCases, useBulleCase, type Carte, type Part, type Section } from '../components/BulleCases'
import { getAnnuel } from '../api/rapports'
import type { Annuel, Cell, Profil, RepartitionProfil, SerieMois, Val } from '../api/types'
import { usePeut } from '../auth/AuthContext'
import ChoixTypes, { GROUPES, lireMasques } from '../components/ChoixTypes'
import Etat, { etatErreur } from '../components/Etat'
import FiltresPeriode, { LIBELLE_TYPE_SITE, libelleComparaison, libelleCourant } from '../components/FiltresPeriode'
import { Variation } from '../components/Tuile'
import { useAttente } from '../hooks/useAttente'
import { useGabarit } from '../lib/gabarit'
import { usePreference } from '../lib/preference'
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
const pourcentOuNul = (v: Val | undefined) => (vide(v) ? null : enPourcent(v))
/** Écart de taux en points ; null si l'un des deux taux manque. */
const ecartPoints = (t: Val | undefined, t1: Val | undefined) => (vide(t) || vide(t1) ? null : (Number(t) - Number(t1)) * 100)
const textePoints = (d: number) => `${d > 0 ? '+' : ''}${dec(String(d))}${SEP}pt`
const texteEcart = (d: number | null) => (d === null ? '—' : textePoints(d))
/** Écart de taux en points, avec flèche et couleur (vert en hausse, rouge en baisse). */
const evolutionPoints = (d: number | null, couleur = true): ReactNode =>
  d === null ? '—' : <span className={d === 0 || !couleur ? 'bc-neutre' : d > 0 ? 'bc-bon' : 'bc-mal'}>{d < 0 ? '▼' : d > 0 ? '▲' : '■'} {textePoints(d)}</span>
/** Parts par type de contrat : valeur et part du total (les lignes sans part sont écartées). */
const partsContrat = (d: Record<string, Cell & { part: Val; part1?: Val }> | undefined, fmt: (v: Val | undefined) => string): Part[] =>
  Object.entries(d ?? {})
    .filter(([, x]) => !vide(x.part) || !vide(x.part1))
    .map(([c, x]) => ({
      nom: c, valeur: fmt(x.m), part: vide(x.part) ? 0 : enPourcent(x.part),
      valeur1: fmt(x.m1), part1: vide(x.part1) ? null : enPourcent(x.part1), ecart: pourcentOuNul(x.var_pct),
    }))

/** Profil servi avec ses chiffres (hors « sélection trop petite »). */
type ProfilOk = Exclude<Profil, { masque: true }>
const NF1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** Pourcentage de 0 à 100 sur une décimale. */
const pc = (x: number) => `${NF1.format(x).replace(/\u202f|\u00a0/g, SEP)}${SEP}%`
const nrTexte = (n: number) => `${n} non renseigné${n > 1 ? 's' : ''}`
const COULEUR_CONTRAT: Record<string, string> = { CDI: 'var(--data-1)', CDD: 'var(--data-2)', Autres: 'var(--data-6)' }
const TRANCHES_AGE: Record<string, string> = { '<25': '< 25 ans', '25-34': '25-34', '35-44': '35-44', '45-54': '45-54', '55+': '55 et +' }
const TRANCHES_ANCIENNETE: Record<string, string> = { '<1': '< 1 an', '1-3': '1-3 ans', '3-5': '3-5 ans', '5-10': '5-10 ans', '10+': '10 ans et +' }
/** Moyenne en années sur une décimale (« 38,4 »). */
const moyenneTexte = (r: RepartitionProfil | undefined) => (r?.moyenne == null ? '—' : NF1.format(Number(r.moyenne)))
/** Parts de 0 à 100 de chaque sexe (non renseignés compris dans l'effectif) ; null sans aucun sexe connu
 *  (« 0 % femmes » laisserait croire à un effectif sans femme). */
const partsSexe = (p: ProfilOk | null) => {
  const t = p ? p.sexe.H + p.sexe.F + p.sexe.nr : 0
  return p && p.sexe.H + p.sexe.F > 0 ? { H: p.sexe.H / t * 100, F: p.sexe.F / t * 100, nr: p.sexe.nr / t * 100 } : null
}
const ecartAnnees = (r: RepartitionProfil | undefined, r1: RepartitionProfil | undefined) =>
  r?.moyenne == null || r1?.moyenne == null ? null : Number(r.moyenne) - Number(r1.moyenne)
const lignesSexe = (titre: string, p: ProfilOk): Section => {
  const t = p.sexe.H + p.sexe.F + p.sexe.nr
  const v = (n: number) => `${n}${t > 0 ? ` · ${pc(n / t * 100)}` : ''}`
  return {
    type: 'lignes',
    titre,
    lignes: [
      { k: 'Hommes', v: v(p.sexe.H) },
      { k: 'Femmes', v: v(p.sexe.F) },
      ...(p.sexe.nr > 0 ? [{ k: 'Non renseigné', v: v(p.sexe.nr) }] : []),
      { k: 'Effectif', v: `${t}`, fort: true, sep: true },
    ],
  }
}
const lignesRepartition = (titre: string, r: RepartitionProfil, noms: Record<string, string>): Section => ({
  type: 'lignes',
  titre,
  lignes: [
    { k: 'Moyenne', v: `${moyenneTexte(r)}${SEP}ans`, fort: true },
    ...r.tranches.map((t) => ({ k: noms[t.cle] ?? t.cle, v: `${t.n}` })),
    ...(r.nr > 0 ? [{ k: 'Non renseigné', v: `${r.nr}` }] : []),
  ],
})

/** Écart neutre (jamais vert ni rouge) entre deux périodes : points de part ou années. */
function EcartNeutre({ d, unite, prefixe = '', annees = false }: { d: number | null; unite: string; prefixe?: string; annees?: boolean }) {
  if (d === null) return <span className="variation">—</span>
  const r = Math.round(d * 10) / 10
  const etat = r === 0 ? 'stable' : r > 0 ? 'hausse' : 'baisse'
  const mot = annees && Math.abs(r) >= 2 ? `${unite}s` : unite
  return (
    <span className="variation">
      {prefixe}<span aria-hidden="true">{etat === 'stable' ? '▬' : etat === 'baisse' ? '▼' : '▲'}</span> {r > 0 ? '+' : ''}
      {NF1.format(r)}{SEP}{mot}
      <span className="sr-only"> ({etat})</span>
    </span>
  )
}

/** Barre empilée de parts (0 à 100) avec sa légende ; `brut` : le nom est déjà le texte complet de la légende. */
function BarreParts({ parts }: { parts: { nom: string; pc: number; couleur: string; brut?: boolean }[] }) {
  const texte = (x: (typeof parts)[number]) => (x.brut ? x.nom : `${x.nom} ${pc(x.pc)}`)
  return (
    <>
      <div className="type-barre" role="img" aria-label={parts.map(texte).join(', ')}>
        {parts.map((x) => <i key={x.nom} style={{ width: `${Math.min(100, Math.max(0, x.pc))}%`, background: x.couleur }} />)}
      </div>
      <ul className="type-legende">
        {parts.map((x) => <li key={x.nom}><b style={{ background: x.couleur }} aria-hidden="true" />{texte(x)}</li>)}
      </ul>
    </>
  )
}

/** Effectif par tranche (âge ou ancienneté) : barres proportionnelles à la plus grande tranche. */
function Tranches({ r, noms }: { r: RepartitionProfil; noms: Record<string, string> }) {
  const max = Math.max(0, ...r.tranches.map((t) => t.n))
  return (
    <div className="type-bloc">
      {max > 0 && <div className="type-tranches">
        {r.tranches.map((t) => (
          <div key={t.cle} className="type-tranche">
            <span>{noms[t.cle] ?? t.cle}</span>
            <span className="type-t" aria-hidden="true"><i style={{ width: `${max > 0 ? Math.max(t.n / max * 100, t.n > 0 ? 2 : 0) : 0}%` }} /></span>
            <span className="type-v">{t.n}</span>
          </div>
        ))}
      </div>}
      {r.nr > 0 && <p className="type-nr">{nrTexte(r.nr)}</p>}
    </div>
  )
}

const TropPetite = () => <div className="type-petite">Sélection trop petite (moins de 3 personnes)</div>

/** Un type d'indicateurs : son titre et ses trois cartes sur une même ligne. */
function Groupe({ id, nom, neuf = false, children }: { id: string; nom: string; neuf?: boolean; children: ReactNode }) {
  return (
    <section className="type-groupe" aria-labelledby={`type-${id}`}>
      <h2 id={`type-${id}`}>
        {nom}
        {neuf && <span className="type-neuf">nouveau</span>}
      </h2>
      <div className="cases type-cases">{children}</div>
    </section>
  )
}

function Case({
  titre,
  valeur,
  devise = true,
  unite,
  libelle2,
  carte,
  partiel,
  children,
}: {
  titre: string
  valeur: string
  devise?: boolean
  /** Unité courte après la valeur (« femmes », « ans »). */
  unite?: string
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
        {unite && valeur !== '—' && <span className="devise"> {unite}</span>}
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
    profil: { m: null, m1: null }, contrat_fin: {},
  } as unknown as Annuel
}

export default function Resume() {
  const f = useFiltres({ avecMois: false, comparaison: 'annee', avecCalendrier: true, selections: true })
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
    cmp_dim: f.filtres.cmp_dim,
    cmp_val: f.filtres.cmp_val,
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
  // R9 : deux sélections comparées sur la même période : A et B remplacent les deux périodes.
  const sel = f.selection
  const nomSel = (v: string) => (sel?.dim === 'type_site' ? LIBELLE_TYPE_SITE[v] ?? v : v)
  const periodeSel = f.filtres ? libelleCourant(f.filtres) : ''
  const an = sel ? nomSel(sel.a) : periodeSel
  const n1 = sel ? nomSel(sel.b) : f.filtres ? libelleComparaison(f.filtres, 'annee') : ''
  const erreur = premier ? null : ann.error
  const peutCa = usePeut('marge:read')
  // Types d'indicateurs masqués : réglage d'affichage propre au compte (liste des identifiants masqués).
  const [masques, setMasques] = usePreference('graphes.resume_types', lireMasques, [] as string[])
  const vis = (id: string) => !masques.includes(id)
  const nomsMasques = GROUPES.filter((g) => masques.includes(g.id)).map((g) => g.nom)
  const aucunType = GROUPES.every((g) => masques.includes(g.id))
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
  // Groupe Activité : présent avec le droit marge:read, y compris ses cartes « non disponible » sous filtre.
  const groupeActivite = vis('activite') && droitCa && (aCa || sansCa || sansMarge || sansCaEff)
  const fb = a?.front_back && a.front_back.total > 0 ? a.front_back : null
  const fb1 = fb && a?.front_back1 && a.front_back1.total > 0 ? a.front_back1 : null
  // R9 : front / back office sur la masse salariale, le CA et la marge (3e ligne, détail au survol).
  const msFb = a?.ms_front_back && !vide(a.ms_front_back.front_pct) ? a.ms_front_back : null
  // 34-f : en comparaison, montants abrégés pour tenir dans les colonnes du tableau de la carte.
  const msFmt = Object.values(a?.ms_contrat ?? {}).some((x) => !vide(x.part1)) || !vide(msFb?.front_pct1) ? compact : exact
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
  const finAn = finN ? `${finN}` : periodeSel
  // Fin de la période comparée : le dernier mois saisi, décalé comme la comparaison l'est de la période.
  const du = lireMois(f.filtres?.du)
  const cmpDu = lireMois(f.filtres?.cmp_du)
  const iFinCmp = finN && a?.mois_fin && du !== null && cmpDu !== null ? indice(finN, a.mois_fin) + cmpDu - du : null
  const finCmp = sel ? n1 : iFinCmp !== null ? `${MOIS_COURTS[moisDe(iFinCmp) - 1]} ${anneeDe(iFinCmp)}` : n1
  const parRapport = (x: string) => (sel ? `Écart avec ${x}` : `Évolution par rapport à ${x}`)
  // Suivi mensuel (réunion du 23/11) : les mois du cadre, ceux hors période grisés ; chaque mois
  // porte son année (mois en trois lettres dans une case de largeur fixe, années alignées).
  const iDu = lireMois(a?.du ?? f.filtres?.du)
  const iAu = lireMois(a?.au ?? f.filtres?.au)
  const dansPeriode = (l: SerieMois) =>
    l.annee == null || iDu === null || iAu === null || (indice(l.annee, l.mois) >= iDu && indice(l.annee, l.mois) <= iAu)
  const horsPeriode = !!a?.serie_n.some((l) => !dansPeriode(l))
  // Répartition front / back affichée seulement si elle apprend quelque chose (0 % / 100 % = sélection
  // d'un seul côté, ex. Activité = Back Office) : la ligne de plus réduisait le tableau sans rien dire.
  const partageUtile = (p: Val) => { const n = Number(p); return p !== null && p !== 'n/a' && n > 0 && n < 1 }
  const nomLigne = (annee: number | undefined, m: number) => (annee
    ? <><span className="mois-3">{MOIS_3[m - 1]}</span> {annee}</>
    : MOIS[m - 1])
  const titrePeriode = sel ? (
    <>Chiffres de <strong>{an}</strong> comparés à <strong>{n1}</strong>{periodeSel && <>, {periodeSel}</>}</>
  ) : an && (
    <>Chiffres de <strong>{an}</strong>{n1 && <>, évolution par rapport à <strong>{n1}</strong></>}</>
  )
  const perTab = libelleTexte(a?.du, a?.au) || periodeSel
  const perCmp = sel ? n1 : libelleTexte(a?.cmp_du, a?.cmp_au) || n1
  const totTab = sel ? an : perTab
  /** Écart de taux de marge, en points. */
  const ecartPts = (t: Val | undefined, t1: Val | undefined) => {
    const d = ecartPoints(t, t1)
    if (d === null) return <td className="num">—</td>
    return <td className={d < 0 && !sel ? 'num neg' : 'num'}>{textePoints(d)}</td>
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
  /** 34-f : en comparaison, la répartition s'affiche en tableau A / B (ou période / période comparée). */
  const cotes = (a1: string, b1: string) => (sel ? { a: 'A', sa: nomSel(sel.a), b: 'B', sb: nomSel(sel.b) } : { a: a1, b: b1 })
  type CoteFB = { v: string; pct: Val | undefined }
  /** Parts front / back office (0 à 100) d'un montant ou d'un effectif, avec le côté comparé s'il existe. */
  const partsFrontBack = (f0: CoteFB, b0: CoteFB, f1?: CoteFB, b1?: CoteFB, ecarts?: [Val | undefined, Val | undefined],
    libs: [string, string] = [an, n1]): Section[] => {
    if (vide(f0.pct) || vide(b0.pct)) return []
    const avec = !!f1 && !!b1 && !vide(f1.pct) && !vide(b1.pct)
    const ligne = (nom: string, x: CoteFB, x1: CoteFB | undefined, e: Val | undefined, bo?: boolean): Part => ({
      nom, valeur: x.v, part: enPourcent(x.pct), bo,
      ...(avec && x1 ? { valeur1: x1.v, part1: enPourcent(x1.pct), ecart: pourcentOuNul(e) } : {}),
    })
    return [{
      type: 'parts',
      titre: 'Front / back office',
      ...(avec ? { cmp: cotes(...libs) } : {}),
      parts: [ligne('Front office', f0, f1, ecarts?.[0]), ligne('Back office', b0, b1, ecarts?.[1], true)],
    }]
  }
  const sectionContrats = (titre: string, parts: Part[], libs: [string, string] = [an, n1]): Section[] =>
    parts.length ? [{ type: 'parts', titre, ...(parts.some((p) => p.part1 != null) ? { cmp: cotes(...libs) } : {}), parts }] : []
  const evol = (c: Cell | undefined) => <td className="num"><Variation v={c?.var_pct} neutre={!!sel} /></td>
  // Colonnes du suivi mensuel : celles des types cochés (Effectif et Profil n'en ont pas).
  const colCa = aCa && vis('activite')
  const colMs = vis('masse')
  const colonnes = [
    'MOIS', ...(colCa ? ['CA', 'MARGE', '% MARGE'] : []),
    ...(colMs ? ['MASSE SALARIALE', 'COMMISSIONS', 'PRIMES PROD.', 'FRAIS DE MISSION', 'LOGEMENT SITE DÉPORTÉ'] : []),
  ]
  const sansColonne = !colCa && !colMs
  // Profil des salariés et type de contrat : valeurs de fin de période, comparées à celles de la fin de la période comparée.
  const p0 = a?.profil?.m ?? null
  const p1 = a?.profil?.m1 ?? null
  const p0ok = p0 && !p0.masque ? p0 : null
  const p1ok = p0ok && p1 && !p1.masque ? p1 : null
  const petite = !!p0 && !!p0.masque
  const cmpProfil = !!p1ok
  const sexe0 = partsSexe(p0ok)
  const sexe1 = partsSexe(p1ok)
  const partF0 = sexe0 ? sexe0.F : null
  const partF1 = sexe1 ? sexe1.F : null
  const partH0 = sexe0 ? sexe0.H : 0
  const partNr0 = sexe0 ? sexe0.nr : 0
  const periodesFin = `Fin ${moisFin} ${finAn} · comparé à ${finCmp}`
  const cf = a?.contrat_fin?.CDI ? a.contrat_fin : null
  const partsC = cf ? partsContrat({ CDI: cf.CDI, CDD: cf.CDD, Autres: cf.autres }, dec) : []
  const cmpContrat = !!cf && !vide(cf.CDI.part1)

  return (
    <section className={`page-ecran page-etroite resume-excel${maj ? ' maj' : ''}${relais || relaisMaj ? ' relais' : ''}${premier ? ' chargement' : ''}`} aria-busy={maj || premier || undefined}>
      <BulleCases inactif={premier || maj}>
      <TitreRapport titre="BUDGET RÉALISÉ" />
      {f.filtres && (
        <FiltresPeriode avecMois={false} comparaison="annee" filtres={f.filtres} departements={f.departements} services={f.services} sites={f.sites} typesSite={f.typesSite} activites={f.activites} typesContrat={f.typesContrat} partage={f.partage} periode={f.periode} cmpDim={f.cmpDim} onChange={f.set}
          extra={<ChoixTypes masques={masques} onChange={setMasques} />} />
      )}
      {nomsMasques.length > 0 && (
        <p className="type-rappel">
          {nomsMasques.length} type{nomsMasques.length > 1 ? 's' : ''} d’indicateurs masqué{nomsMasques.length > 1 ? 's' : ''} ({nomsMasques.join(', ')}) ·{' '}
          <button type="button" className="btn-link" onClick={() => setMasques([])}>Tout afficher</button>
        </p>
      )}
      {/* Seul le corps défile : titre et filtres restent figés, l’en-tête du tableau colle en haut du corps. */}
      <div className="resume-corps">
      {f.erreur ? <Etat type={etatErreur(f.erreur)} onRetry={f.relancer} /> : f.vide && <Etat type="vide" />}
      {erreur && <Etat type={etatErreur(erreur)} onRetry={() => ann.refetch()} />}
      {a && (
        <>
          {/* Quatre types d'indicateurs, trois cartes chacun. Effectifs et profil = fin du dernier mois saisi. */}
          {titrePeriode && <p className="periode-titre">{titrePeriode}</p>}
          {aucunType && (
            <div className="type-aucun">
              Aucun type d’indicateurs coché. <button type="button" className="btn-link" onClick={() => setMasques([])}>Tout afficher</button>
            </div>
          )}
          {groupeActivite && (
            <Groupe id="activite" nom="Activité et productivité">
              {sansCa && indispo('Chiffre d’affaires')}
              {aCa && !sansCa && (
                <Case titre="Chiffre d’affaires" partiel={a.lignes_ca_marge?.ca.partiel} valeur={compact(a.ca_ytd)} libelle2={parRapport(n1)}
                  carte={{
                    titre: 'Chiffre d’affaires',
                    periodes,
                    sections: [
                      comparaison(a.ca_cumul, an, n1, !sel),
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
                  <Variation v={a.ca_cumul?.var_pct} vs="" neutre={!!sel} />
                  {ligneFront(a.ca_par_front)}
                </Case>
              )}
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
                          { k: 'Écart de taux', v: evolutionPoints(ecartPoints(a.taux_marge_ytd, a.taux_marge_cmp), !sel), sep: true },
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
              {sansCaEff && indispo('CA par salarié')}
              {aCa && !sansCaEff && (
                <Case titre="CA par salarié" valeur={compact(a.ca_par_effectif?.m)} libelle2={parRapport(n1)}
                  carte={{
                    titre: 'CA par salarié',
                    periodes,
                    sections: [
                      comparaison(a.ca_par_effectif, an, n1, !sel),
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
                  <Variation v={a.ca_par_effectif?.var_pct} vs="" neutre={!!sel} />
                </Case>
              )}
            </Groupe>
          )}
          {vis('masse') && (
            <Groupe id="masse" nom="Masse salariale">
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
                    ...sectionContrats('Par type de contrat', partsContrat(a.ms_contrat, msFmt)),
                    ...(msFb ? partsFrontBack(
                      { v: msFmt(msFb.front), pct: msFb.front_pct }, { v: msFmt(msFb.back), pct: msFb.back_pct },
                      { v: msFmt(msFb.front1), pct: msFb.front_pct1 }, { v: msFmt(msFb.back1), pct: msFb.back_pct1 },
                      [msFb.front_var_pct, msFb.back_var_pct]) : []),
                    { type: 'calcul', texte: `Somme des masses salariales mensuelles. Moyenne par mois : ${exact(a.moyenne_mensuelle?.m)}.` },
                  ],
                }}
              >
                <Variation v={a.cumul_ytd.var_pct} vs="" neutre={!!sel} />
                {msFb && partageUtile(msFb.front_pct) && <span className="ratio-fb">Front office {pct(msFb.front_pct)} · Back office {pct(msFb.back_pct)}</span>}
              </Case>
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
                <Variation v={a.commissions_cumul.var_pct} vs="" neutre={!!sel} />
              </Case>
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
                <Variation v={a.primes_cumul.var_pct} vs="" neutre={!!sel} />
              </Case>
            </Groupe>
          )}
          {vis('effectif') && (
            <Groupe id="effectif" nom="Effectif">
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
                    ...(fb ? partsFrontBack(
                      { v: dec(String(fb.front)), pct: fb.front_pct }, { v: dec(String(fb.back)), pct: fb.back_pct },
                      fb1 ? { v: dec(String(fb1.front)), pct: fb1.front_pct } : undefined,
                      fb1 ? { v: dec(String(fb1.back)), pct: fb1.back_pct } : undefined,
                      [a.front_back_var?.front, a.front_back_var?.back], [`Fin ${moisFin} ${finAn}`, finCmp]) : []),
                    { type: 'calcul', texte: `Salariés présents à la fin du dernier mois saisi (${moisFin} ${finAn}). Effectif moyen de la période : ${dec(a.effectif_moyen.m)}.` },
                  ],
                }}
              >
                <Variation v={a.effectif_fin.var_pct} vs="" neutre={!!sel} />
                {/* Productif / administratif : part de l'effectif de fin en front et en back office. */}
                {fb && partageUtile(fb.front_pct) && <span className="ratio-fb">Front office {pct(fb.front_pct)} · Back office {pct(fb.back_pct)}</span>}
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
              <Case titre="Type de contrat" valeur={montrer(a.effectif_fin.m)} devise={false}
                libelle2={cmpContrat ? parRapport(finCmp) : 'En fin de période'}
                carte={partsC.length ? {
                  titre: 'Type de contrat',
                  periodes: `Fin ${moisFin} ${finAn} · comparé à ${finCmp}`,
                  sections: [
                    ...sectionContrats('Effectif de fin par type de contrat', partsC, [`Fin ${moisFin} ${finAn}`, finCmp]),
                    { type: 'calcul', texte: 'Salariés présents à la fin du dernier mois saisi, répartis par type de contrat. CDI et CDD : contrats du même nom ; Autres : tout le reste (mise à disposition, stagiaires…).' },
                  ],
                } : undefined}
              >
                {cmpContrat && <EcartNeutre d={ecartPoints(cf!.CDI.part, cf!.CDI.part1)} unite="pt" prefixe="CDI " />}
                {partsC.length > 0 && (
                  <div className="type-bloc">
                    <BarreParts parts={partsC.map((x) => ({ nom: x.nom, pc: x.part, couleur: COULEUR_CONTRAT[x.nom] }))} />
                  </div>
                )}
              </Case>
            </Groupe>
          )}
          {vis('profil') && (
            <Groupe id="profil" nom="Profil des salariés" neuf>
              <Case titre="Sexe" valeur={partF0 === null ? '—' : pc(partF0)} unite="femmes" devise={false}
                libelle2={cmpProfil ? parRapport(finCmp) : 'En fin de période'}
                carte={p0ok ? {
                  titre: 'Sexe',
                  periodes: periodesFin,
                  sections: [
                    lignesSexe(`Fin ${moisFin} ${finAn}`, p0ok),
                    ...(p1ok ? [lignesSexe(finCmp, p1ok)] : []),
                    { type: 'calcul', texte: 'Femmes ÷ effectif de fin de période, personnes dont le sexe n’est pas renseigné comprises.' },
                  ],
                } : undefined}
              >
                {petite && <TropPetite />}
                {cmpProfil && <EcartNeutre d={partF0 === null || partF1 === null ? null : partF0 - partF1} unite="pt" />}
                {p0ok && !sexe0 && p0ok.sexe.nr > 0 && <div className="type-bloc"><p className="type-nr">{nrTexte(p0ok.sexe.nr)}</p></div>}
                {p0ok && sexe0 && (
                  <div className="type-bloc">
                    <BarreParts parts={[
                      { nom: 'Hommes', pc: partH0, couleur: 'var(--data-1)' },
                      { nom: 'Femmes', pc: partF0 ?? 0, couleur: 'var(--data-3)' },
                      ...(p0ok.sexe.nr > 0 ? [{ nom: nrTexte(p0ok.sexe.nr), pc: partNr0, couleur: 'var(--data-6)', brut: true }] : []),
                    ]} />
                  </div>
                )}
              </Case>
              <Case titre="Âge" valeur={moyenneTexte(p0ok?.age)} unite="ans" devise={false}
                libelle2={cmpProfil ? parRapport(finCmp) : 'Moyenne en fin de période'}
                carte={p0ok ? {
                  titre: 'Âge',
                  periodes: periodesFin,
                  sections: [
                    lignesRepartition(`Fin ${moisFin} ${finAn}`, p0ok.age, TRANCHES_AGE),
                    ...(p1ok ? [lignesRepartition(finCmp, p1ok.age, TRANCHES_AGE)] : []),
                    { type: 'calcul', texte: 'Moyenne des âges à la fin de la période, sur les salariés dont la date de naissance est renseignée.' },
                  ],
                } : undefined}
              >
                {petite && <TropPetite />}
                {cmpProfil && <EcartNeutre d={ecartAnnees(p0ok?.age, p1ok?.age)} unite="an" annees />}
                {p0ok && <Tranches r={p0ok.age} noms={TRANCHES_AGE} />}
              </Case>
              <Case titre="Ancienneté" valeur={moyenneTexte(p0ok?.anciennete)} unite="ans" devise={false}
                libelle2={cmpProfil ? parRapport(finCmp) : 'Moyenne en fin de période'}
                carte={p0ok ? {
                  titre: 'Ancienneté',
                  periodes: periodesFin,
                  sections: [
                    lignesRepartition(`Fin ${moisFin} ${finAn}`, p0ok.anciennete, TRANCHES_ANCIENNETE),
                    ...(p1ok ? [lignesRepartition(finCmp, p1ok.anciennete, TRANCHES_ANCIENNETE)] : []),
                    { type: 'calcul', texte: 'Moyenne des anciennetés à la fin de la période, sur les salariés dont la date d’embauche est renseignée.' },
                  ],
                } : undefined}
              >
                {petite && <TropPetite />}
                {cmpProfil && <EcartNeutre d={ecartAnnees(p0ok?.anciennete, p1ok?.anciennete)} unite="an" annees />}
                {p0ok && <Tranches r={p0ok.anciennete} noms={TRANCHES_ANCIENNETE} />}
              </Case>
            </Groupe>
          )}
        </>
      )}
      {a && (
        <>
          <div className="titre-ligne">
            <h3 className="bandeau-titre">SUIVI MENSUEL{perTab && ` · ${perTab.toUpperCase()}`}</h3>
            {vis('activite') && (aCa || sansCa || sansMarge) && (
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
            {horsPeriode && <span className="periode-legende">Mois grisés : hors période, non comptés dans les totaux.</span>}
          </div>
          {sansColonne ? (
            <p className="type-vide-tab">Pas de colonne pour les types cochés.</p>
          ) : (
          <div className="table-scroll">
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
                    {colCa && <td className="num saisi">{montrer(l.ca)}</td>}
                    {colCa && <td className={`${cls(l.marge)} saisi`}>{montrer(l.marge)}</td>}
                    {colCa && <td className={cls(l.taux_marge)}>{l.taux_marge == null ? '—' : pct(l.taux_marge)}</td>}
                    {colMs && (
                      <>
                        <td className="num">{fcfa(l.ms)}</td>
                        <td className="num">{fcfa(l.commissions)}</td>
                        <td className="num">{fcfa(l.primes)}</td>
                        <td className="num">{fcfa(l.frais_mission)}</td>
                        <td className="num">{fcfa(l.logement)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" title={sel ? `Total de la sélection A, ${perTab}` : 'Total de la période choisie'}>TOTAL {totTab.toUpperCase()}</th>
                  {colCa && <td className="num">{montrer(a.ca_ytd)}</td>}
                  {colCa && <td className={cls(a.marge_ytd)}>{montrer(a.marge_ytd)}</td>}
                  {colCa && <td className={cls(a.taux_marge_ytd)}>{a.taux_marge_ytd == null ? '—' : pct(a.taux_marge_ytd)}</td>}
                  {colMs && (
                    <>
                      <td className="num">{fcfa(a.cumul_ytd.m)}</td>
                      <td className="num">{fcfa(a.commissions_ytd)}</td>
                      <td className="num">{fcfa(a.primes_ytd)}</td>
                      <td className="num">{fcfa(a.frais_mission_ytd)}</td>
                      <td className="num">{fcfa(a.logement_ytd)}</td>
                    </>
                  )}
                </tr>
                {perCmp && (
                  <tr className="cmp">
                    <th scope="row" title={sel ? `Total de la sélection B, ${perTab}` : 'Total de la période comparée'}>TOTAL {perCmp.toUpperCase()}</th>
                    {colCa && <td className="num">{montrer(a.ca_cumul?.m1)}</td>}
                    {colCa && <td className={cls(a.lignes_ca_marge?.marge.m1)}>{montrer(a.lignes_ca_marge?.marge.m1)}</td>}
                    {colCa && <td className={cls(a.taux_marge_cmp)}>{vide(a.taux_marge_cmp) ? '—' : pct(a.taux_marge_cmp)}</td>}
                    {colMs && (
                      <>
                        <td className="num">{montrer(a.cumul_ytd.m1)}</td>
                        <td className="num">{montrer(a.commissions_cumul.m1)}</td>
                        <td className="num">{montrer(a.primes_cumul.m1)}</td>
                        <td className="num">{montrer(a.frais_mission?.m1)}</td>
                        <td className="num">{montrer(a.logement_cumul?.m1)}</td>
                      </>
                    )}
                  </tr>
                )}
                {perCmp && (
                  <tr className="evol">
                    <th scope="row" title={sel ? `Écart de ${an} par rapport à ${n1}` : `Évolution de ${perTab} par rapport à ${perCmp}`}>{sel ? 'ÉCART' : 'ÉVOLUTION'}</th>
                    {colCa && evol(a.ca_cumul)}
                    {colCa && evol(a.lignes_ca_marge?.marge)}
                    {colCa && ecartPts(a.taux_marge_ytd, a.taux_marge_cmp)}
                    {colMs && (
                      <>
                        {evol(a.cumul_ytd)}
                        {evol(a.commissions_cumul)}
                        {evol(a.primes_cumul)}
                        {evol(a.frais_mission)}
                        {evol(a.logement_cumul)}
                      </>
                    )}
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          )}
        </>
      )}
      </div>
      </BulleCases>
    </section>
  )
}
