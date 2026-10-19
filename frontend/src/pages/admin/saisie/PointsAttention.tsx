import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { appliquerDecisions, lireLigne, simulerDecisions, type AnomalieLot, type Decisions, type LigneLot, type Lot } from '../../../api/saisie'
import { Bouton } from '../../../components/Kit'
import { MOIS, valeurBrute } from '../../../lib/format'
import ListeChoix, { ID_LISTE, idOption } from './ListeChoix'
import Volet from './Volet'

type Niveau = 'corriger' | 'confirmer' | 'auto'

const NIVEAUX: Record<Niveau, { libelle: string; ton?: 'ko' | 'attention' }> = {
  corriger: { libelle: 'À corriger', ton: 'ko' },
  confirmer: { libelle: 'À confirmer', ton: 'attention' },
  auto: { libelle: 'Corrigé automatiquement' },
}

interface Groupe {
  id: string
  titre: string
  niveau: Niveau
  aide: string
  retenir: (a: AnomalieLot) => boolean
}

const codes = (...liste: string[]) => (a: AnomalieLot) => liste.includes(a.code)

/** Identifiant du volet des erreurs bloquantes, pour l'ouvrir d'office. */
export const VOLET_ERREURS = 'erreurs'

/** Chaque point tombe dans le premier groupe qui le retient ; un code inconnu va dans « Montants et référentiels ». */
const GROUPES: Groupe[] = [
  { id: VOLET_ERREURS, titre: 'Erreurs à corriger', niveau: 'corriger', aide: 'bloquent l’enregistrement',
    retenir: (a) => a.gravite === 'bloquant' },
  { id: 'noms', titre: 'Noms et matricules à vérifier', niveau: 'confirmer',
    aide: 'nom différent de celui connu, proche d’un autre employé, ou matricule douteux',
    retenir: (a) => codes('NOM_PROCHE', 'NOM_INCOHERENT', 'NOM_SIMILAIRE', 'MATRICULE_NUMERIQUE')(a)
      || (a.code === 'VALEUR_MANQUANTE' && a.colonne === 'Noms') },
  { id: 'affectation', titre: 'Changements d’affectation', niveau: 'confirmer',
    aide: 'service, site, contrat ou activité différents selon les mois : mutation ou erreur ?', retenir: codes('MUTATION') },
  { id: 'auto', titre: 'Valeurs corrigées automatiquement', niveau: 'auto',
    aide: 'espaces, casse, nombres en texte, arrondis, erreurs Excel lues comme vides, colonnes ignorées',
    retenir: codes('NORMALISE', 'TEXTE_CONVERTI', 'PRECISION_TRONQUEE', 'ERREUR_EXCEL', 'ENTETE_INCONNU', 'ENTETE_ALIAS') },
  { id: 'montants', titre: 'Montants et référentiels', niveau: 'confirmer', aide: 'montants négatifs, tirets ou formules lus comme vides, postes nouveaux ou vides',
    retenir: () => true },
]

/** Ordre d'affichage : à corriger, à confirmer, corrigé automatiquement. */
const ORDRE: Niveau[] = ['corriger', 'confirmer', 'auto']

export function repartir(anomalies: AnomalieLot[]) {
  const lignes = new Map(GROUPES.map((g) => [g.id, [] as AnomalieLot[]]))
  for (const a of anomalies) lignes.get(GROUPES.find((g) => g.retenir(a))!.id)!.push(a)
  return GROUPES.map((g) => ({ ...g, lignes: lignes.get(g.id)! }))
    .filter((g) => g.lignes.length > 0)
    .sort((x, y) => ORDRE.indexOf(x.niveau) - ORDRE.indexOf(y.niveau))
}

interface Props {
  anomalies: AnomalieLot[]
  /** Lot importé : permet de rouvrir la ligne du fichier. Absent pour une saisie en grille. */
  lotId?: number
  /** Lot renvoyé après l'enregistrement des corrections (contrôles relancés). */
  onLot?: (lot: Lot) => void
  /** Nombre de changements pas encore enregistrés. */
  onAttente?: (n: number) => void
  /** Numéro de ligne du fichier : sans objet pour une saisie en grille. */
  afficherLigne: boolean
  /** Volet ouvert, partagé avec le reste de l'aperçu : un seul à la fois. */
  ouvert: string | null
  onOuvrir: (id: string) => void
}

const cle = (a: { ligne: number | null; colonne: string | null; code: string }) => `${a.ligne}|${a.colonne}|${a.code}`
const cellule = (a: AnomalieLot) => `${a.ligne}|${a.colonne}`

/** Changements en attente jusqu'à « Enregistrer » : cellules saisies, solution choisie par point, valeurs ignorées. */
interface Plan {
  modifs: Record<number, Record<string, string | null>>
  choix: Record<string, { index: number; decision: Decision; ligne: number }>
  /** Type de chaque nouveau site, par nom de site. */
  typeSite: Record<string, string>
  /** « ligne|colonne » : cellule laissée vide, point accepté. */
  ignores: string[]
}

const VIDE: Plan = { modifs: {}, choix: {}, typeSite: {}, ignores: [] }

function nombre(p: Plan) {
  return Object.keys(p.choix).length + p.ignores.length
    + Object.values(p.modifs).reduce((n, m) => n + Object.keys(m).length, 0)
}

/** Corps envoyé au serveur : valeurs par ligne (choix, puis saisies, puis cellules ignorées vidées). */
function corps(p: Plan): Decisions {
  const lignes: Decisions['lignes'] = {}
  const ajouts = new Map<string, Decisions['ajouts'][number]>()
  const retirees = new Set<number>()
  for (const { decision: d, ligne } of Object.values(p.choix)) {
    if (d.valeurs) lignes[ligne] = { ...lignes[ligne], ...d.valeurs }
    if (d.ajout) {
      const typeSite = d.ajout.dimension === 'site' ? p.typeSite[d.ajout.valeur] ?? null : null
      ajouts.set(`${d.ajout.dimension}|${d.ajout.valeur}`, { ...d.ajout, type_site: typeSite })
    }
    d.retirer?.forEach((n) => retirees.add(n))
  }
  for (const [n, m] of Object.entries(p.modifs)) lignes[+n] = { ...lignes[+n], ...m }
  for (const i of p.ignores) {
    const [n, col] = i.split('|')
    lignes[+n] = { ...lignes[+n], [col]: null }
  }
  for (const n of retirees) delete lignes[n]
  return { lignes, ajouts: [...ajouts.values()], retirees: [...retirees], ignores: p.ignores }
}

/** Ce que le détail d'un point lit et change dans le plan commun. */
interface Edition {
  plan: Plan
  lignes: Decisions['lignes']
  /** Clés des points encore présents (après vérification des changements en attente). */
  restants: Set<string>
  occupe: boolean
  setPlan: (f: (p: Plan) => Plan) => void
}

/** Points regroupés par nature et par niveau (à corriger, à confirmer, corrigé automatiquement). */
export default function PointsAttention({ anomalies, lotId, onLot, onAttente, afficherLigne, ouvert, onOuvrir }: Props) {
  const [plan, setPlan] = useState<Plan>(VIDE)
  const qc = useQueryClient()
  // Un point réglé reste affiché (en vert) : la liste ne bouge pas sous les yeux.
  const memoire = useRef<{ lot?: number; points: Map<string, AnomalieLot> }>({ lot: lotId, points: new Map() })
  if (memoire.current.lot !== lotId) memoire.current = { lot: lotId, points: new Map() }
  const vus = new Map<string, number>()
  for (const a of anomalies) {
    const k = cle(a)
    vus.set(k, (vus.get(k) ?? 0) + 1)
    memoire.current.points.set(`${k}#${vus.get(k)}`, a)
  }
  const tous = lotId != null ? [...memoire.current.points.values()] : anomalies
  const n = nombre(plan)
  const envoi = n > 0 ? corps(plan) : null
  // Vérification des changements en attente, un instant après la dernière saisie.
  const texte = JSON.stringify(envoi)
  const [verifie, setVerifie] = useState<Decisions | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setVerifie(JSON.parse(texte)), 300)
    return () => window.clearTimeout(t)
  }, [texte])
  const simulation = useQuery({
    queryKey: ['saisie', 'simulation', lotId, verifie], queryFn: () => simulerDecisions(lotId!, verifie!),
    enabled: lotId != null && verifie != null, placeholderData: keepPreviousData, retry: false,
  })
  const enregistrer = useMutation({
    mutationFn: () => appliquerDecisions(lotId!, envoi!),
    onSuccess: async (lot) => {
      onLot?.(lot)
      // Points relus avant de vider le plan : ceux réglés passent au vert sans repasser par le rouge.
      await qc.invalidateQueries({ queryKey: ['saisie'], predicate: (q) => q.queryKey[1] !== 'simulation' })
      setPlan(VIDE)
    },
  })
  useEffect(() => { onAttente?.(n) }, [n, onAttente])
  const restants = new Set((envoi && simulation.data ? simulation.data.anomalies : anomalies).map(cle))
  const occupe = enregistrer.isPending
  const sansType = envoi?.ajouts.some((a) => a.dimension === 'site' && !a.type_site) ?? false
  const edition: Edition = { plan, lignes: envoi?.lignes ?? {}, restants, occupe, setPlan }
  const erreur = enregistrer.error ?? (envoi ? simulation.error : null)
  return (
    <>
      {repartir(tous).map((g) => {
        const reste = g.lignes.filter((a) => restants.has(cle(a))).length
        return (
          <Volet key={g.id} titre={g.titre} valeur={reste} ton={reste === 0 ? 'ok' : NIVEAUX[g.niveau].ton}
            resume={<><span className="volet-niveau">{NIVEAUX[g.niveau].libelle}</span> : {g.aide}</>}
            ouvert={ouvert === g.id} onOuvrir={() => onOuvrir(g.id)}>
            <Tableau lignes={g.lignes} tous={tous} lotId={lotId} afficherLigne={afficherLigne}
              ton={NIVEAUX[g.niveau].ton} edition={lotId != null ? edition : undefined} />
          </Volet>
        )
      })}
      {lotId != null && afficherLigne && tous.length > 0 && (
        <div className="corrections-pied">
          <span className="muted" aria-live="polite">
            {n === 0 ? 'Aucun changement en attente.'
              : `${n} changement${n > 1 ? 's' : ''} en attente${sansType ? ' : choisir le type du nouveau site' : ''}`}
            {envoi && simulation.isFetching ? ' · vérification…' : ''}
          </span>
          {n > 0 && <Bouton variante="secondaire" disabled={occupe} onClick={() => setPlan(() => VIDE)}>Annuler les changements</Bouton>}
          <Bouton disabled={n === 0 || occupe || sansType} onClick={() => enregistrer.mutate()}>
            {occupe ? 'Enregistrement…' : 'Enregistrer'}
          </Bouton>
          {erreur && <p className="champ-erreur admin-erreur" role="alert">{erreur.message}</p>}
        </div>
      )}
    </>
  )
}

const ancrable = (a: AnomalieLot) => a.ligne != null && !a.code.startsWith('ENTETE_') && a.code !== 'LIGNES_IGNOREES'

function employe(a: AnomalieLot) {
  return [a.matricule, a.nom].filter(Boolean).join(' · ')
}

interface TableauProps {
  lignes: AnomalieLot[]
  tous: AnomalieLot[]
  lotId?: number
  afficherLigne: boolean
  /** Couleur de la bordure du détail déplié : celle du niveau du volet. */
  ton?: 'ko' | 'attention'
  /** Absent : saisie en grille, rien à corriger ici. */
  edition?: Edition
}

function Tableau({ lignes, tous, lotId, afficherLigne, ton, edition }: TableauProps) {
  const [deplie, setDeplie] = useState<string | null>(null)
  return (
    <table className={ton ? `dense points bord-${ton}` : 'dense points'}>
      <thead>
        <tr>
          {afficherLigne && <th scope="col" className="num">Ligne</th>}
          <th scope="col">Employé</th>
          <th scope="col">Colonne</th>
          <th scope="col">Valeur</th>
          <th scope="col">Détail</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((a, i) => {
          const k = `${cle(a)}|${i}`
          const depliable = afficherLigne && lotId != null && edition != null && ancrable(a)
          const ouvert = depliable && deplie === k
          const regle = edition != null && !edition.restants.has(cle(a))
          return (
            <Fragment key={k}>
              {/* Toute la ligne ouvre le détail ; le bouton ▸ reçoit le clic au clavier (il remonte jusqu'à la ligne). */}
              <tr className={[depliable && 'depliable', regle && 'point-regle'].filter(Boolean).join(' ') || undefined}
                onClick={depliable ? () => setDeplie(ouvert ? null : k) : undefined}>
                {afficherLigne && (
                  <td className={ouvert ? 'num ouvert' : 'num'}>
                    {depliable ? (
                      <button type="button" className="deplier" aria-expanded={ouvert} aria-label={`Détail de la ligne ${a.ligne}`}>
                        <span aria-hidden="true">{ouvert ? '▾' : '▸'}</span> {a.ligne}
                      </button>
                    ) : (a.ligne ?? '')}
                  </td>
                )}
                <td>{employe(a)}</td>
                <td>{a.colonne}</td>
                <td>{a.valeur}</td>
                <td>{regle && <span className="regle">Réglé · </span>}{a.message}</td>
              </tr>
              {ouvert && (
                <DetailLigne lotId={lotId!} num={a.ligne!} cible={a.colonne} point={a} edition={edition}
                  points={tous.filter((x) => x.ligne === a.ligne && edition.restants.has(cle(x)))} />
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

const ATTRIBUTS: [string, (l: LigneLot) => string | null][] = [
  ['ANNÉE', (l) => l.annee?.toString() ?? null],
  ['MOIS', (l) => (l.mois ? MOIS[l.mois - 1] : null)],
  ['MATRICULE', (l) => l.matricule],
  ['Noms', (l) => l.nom],
  ['Poste', (l) => l.poste],
  ['Type Contrat', (l) => l.type_contrat],
  ['Activité', (l) => l.activite],
  ['Site', (l) => l.site],
  ['Service', (l) => l.service],
]

/** ANNÉE, MOIS, MATRICULE, Noms restent visibles pendant le défilement. */
const FIGEES = 4
const sansAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

interface DetailProps {
  lotId: number
  num: number
  cible: string | null
  /** Point déplié : les décisions proposées dépendent de son code. */
  point: AnomalieLot
  /** Points encore présents sur la ligne : leurs cellules restent surlignées. */
  points: AnomalieLot[]
  edition: Edition
}

/** Liste du référentiel où ajouter une valeur inconnue, selon la colonne. */
const LISTES: Record<string, { dimension: string; pluriel: string }> = {
  Site: { dimension: 'site', pluriel: 'sites' },
  Service: { dimension: 'service', pluriel: 'services' },
  'Activité': { dimension: 'activite', pluriel: 'activités' },
  'Type Contrat': { dimension: 'type_contrat', pluriel: 'types de contrat' },
}

const TYPES_SITE = [['agence', 'Agence'], ['deporte', 'Site déporté'], ['principal', 'Siège / principal']]

/** Décision possible sur un point : ce qu'elle change dans la ligne, ajoute au référentiel ou retire du lot. */
interface Decision {
  libelle: string
  valeurs?: Record<string, string | null>
  ajout?: { dimension: string; valeur: string }
  retirer?: number[]
}

/** Question posée par la liste et décisions proposées, selon le code du point. Aucune n'est choisie d'office. */
function decisions(point: AnomalieLot, num: number): { question: string; choix: Decision[] } | null {
  const col = point.colonne ?? ''
  const prop = point.proposition
  const precedent: Decision[] = prop?.valeur
    ? [{ libelle: `Remplacer par la valeur de ${prop.periode} : « ${prop.valeur} »`, valeurs: { [col]: prop.valeur } }]
    : []
  const liste = LISTES[col]
  if (point.code === 'REFERENTIEL_INCONNU' && liste && point.valeur) {
    return {
      question: `${col} « ${point.valeur} » absent de la liste des ${liste.pluriel} : que faire ?`,
      choix: [{ libelle: `Ajouter « ${point.valeur} » à la liste des ${liste.pluriel}`,
        ajout: { dimension: prop?.dimension ?? liste.dimension, valeur: point.valeur } }, ...precedent],
    }
  }
  if (point.code === 'VALEUR_MANQUANTE' && precedent.length) return { question: `${col} vide : que faire ?`, choix: precedent }
  if (point.code === 'DOUBLON' && prop?.lignes && prop.lignes.length > 1) {
    return {
      question: 'Employé sur plusieurs lignes du même mois : quelle ligne garder ?',
      choix: prop.lignes.map((n) => {
        const autres = prop.lignes!.filter((x) => x !== n)
        return {
          libelle: `Garder la ligne ${n}${n === num ? ' (celle-ci)' : ''}, retirer ${autres.length > 1 ? 'les lignes' : 'la ligne'} ${autres.join(', ')}`,
          retirer: autres,
        }
      }),
    }
  }
  return null
}

/** Montants illisibles ou douteux : la cellule peut rester vide. */
const MONTANT_VIDE = ['ERREUR_EXCEL', 'FORMULE_SANS_VALEUR', 'SANS_MONTANT', 'NON_NUMERIQUE', 'MONTANT_HORS_BORNES']

/** Seules les cellules qui peuvent rester vides s'ignorent (montants, nom, poste) ; jamais une colonne obligatoire. */
function ignorable(a: AnomalieLot) {
  if (!a.colonne) return false
  if (MONTANT_VIDE.includes(a.code)) return !ATTRIBUTS.some(([n]) => n === a.colonne)
  return ['VALEUR_MANQUANTE', 'TEXTE_TROP_LONG'].includes(a.code) && ['Noms', 'Poste'].includes(a.colonne)
}

/** Sous le point, comme le détail par contrat : la ligne du fichier (en-tête et valeurs), cellules en cause surlignées. */
function DetailLigne({ lotId, num, cible, point, points, edition }: DetailProps) {
  const q = useQuery({ queryKey: ['saisie', 'ligne', lotId, num], queryFn: () => lireLigne(lotId, num) })
  const { plan, setPlan, occupe } = edition
  const k = cle(point)
  const c = cellule(point)
  const proposees = decisions(point, num)
  const choisi = plan.choix[k]
  const ignore = plan.ignores.includes(c)
  const nouveauSite = choisi?.decision.ajout?.dimension === 'site' ? choisi.decision.ajout.valeur : null
  const regle = !edition.restants.has(k) && choisi == null && !ignore
  // Choisir une solution annule « ignorer » sur la même cellule, et inversement.
  const choisir = (i: number) => setPlan((p) => ({
    ...p, ignores: p.ignores.filter((x) => x !== c),
    choix: { ...p.choix, [k]: { index: i, decision: proposees!.choix[i], ligne: num } },
  }))
  const basculer = () => setPlan((p) => {
    const choix = { ...p.choix }
    delete choix[k]
    return { ...p, choix, ignores: ignore ? p.ignores.filter((x) => x !== c) : [...p.ignores, c] }
  })
  // Revenir à la valeur du fichier efface la modification ; saisir une valeur annule « ignorer » sur la cellule.
  const modifier = (col: string, v: string | null) => setPlan((p) => {
    const ligne = { ...p.modifs[num] }
    delete ligne[col]
    if (v !== (q.data?.brut?.[col] ?? null)) ligne[col] = v
    const modifs = { ...p.modifs, [num]: ligne }
    if (!Object.keys(ligne).length) delete modifs[num]
    return { ...p, modifs, ignores: p.ignores.filter((x) => x !== `${num}|${col}`) }
  })
  return (
    <tr className="detail-contrat">
      <td colSpan={5}>
        {q.isSuccess ? (
          <>
            <LigneFichier l={q.data} num={num} cible={cible} points={points}
              modifs={edition.lignes[num]} onModifie={q.data.brut ? modifier : undefined} enCours={occupe} />
            {q.data.brut && (regle
              ? <p className="actions-point regle">Point réglé.</p>
              : (proposees || ignorable(point)) && (
                <div className="actions-point">
                  {proposees && (
                    <label className="decision">
                      <span>{proposees.question}</span>
                      <select value={choisi?.index ?? ''} disabled={occupe} onChange={(e) => choisir(Number(e.target.value))}>
                        <option value="" disabled>Choisir une solution…</option>
                        {proposees.choix.map((d, i) => <option key={d.libelle} value={i}>{d.libelle}</option>)}
                      </select>
                    </label>
                  )}
                  {nouveauSite && (
                    <label className="decision">
                      <span>Type du nouveau site</span>
                      <select value={plan.typeSite[nouveauSite] ?? ''} disabled={occupe}
                        onChange={(e) => setPlan((p) => ({ ...p, typeSite: { ...p.typeSite, [nouveauSite]: e.target.value } }))}>
                        <option value="" disabled>Choisir…</option>
                        {TYPES_SITE.map(([v, libelle]) => <option key={v} value={v}>{libelle}</option>)}
                      </select>
                    </label>
                  )}
                  {ignorable(point) && (
                    <Bouton variante="secondaire" aria-pressed={ignore} disabled={occupe} onClick={basculer}>
                      {ignore ? 'Ne plus ignorer' : 'Ignorer la valeur (laisser vide)'}
                    </Bouton>
                  )}
                </div>
              ))}
          </>
        )
          : <span className="muted">{q.isPending ? 'Chargement…' : 'Contenu indisponible.'}</span>}
      </td>
    </tr>
  )
}


interface LigneProps {
  l: LigneLot
  num: number
  cible: string | null
  points: AnomalieLot[]
  /** Valeurs changées, pas encore enregistrées. */
  modifs?: Record<string, string | null>
  /** Absent : ligne en lecture seule (lot analysé avant les corrections sur place). */
  onModifie?: (colonne: string, valeur: string | null) => void
  enCours?: boolean
}

function LigneFichier({ l, num, cible, points, modifs = {}, onModifie, enCours }: LigneProps) {
  const [edition, setEdition] = useState<{ col: string; valeur: string; actif: number } | null>(null)
  const [ancre, setAncre] = useState<HTMLElement | null>(null)
  const ouvrir = (n: string) => {
    ferme.current = false
    setEdition({ col: n, valeur: (n in modifs ? modifs[n] : l.brut?.[n]) ?? '', actif: -1 })
  }
  // Comme la grille de saisie : valeur vide ou connue, toutes les valeurs ; sinon celles qui la contiennent.
  const toutes = edition ? (edition.col === 'MOIS' ? MOIS : l.choix?.[edition.col]) ?? [] : []
  const tape = sansAccents(edition?.valeur.trim() ?? '')
  const options = !tape || toutes.some((o) => sansAccents(o) === tape) ? toutes : toutes.filter((o) => sansAccents(o).includes(tape))
  // Échap ou Entrée retire le champ, ce qui déclenche aussi sa perte de focus : une seule fermeture compte.
  const ferme = useRef(false)
  const fermer = (garder: boolean, choisie?: string) => {
    if (!edition || ferme.current) return
    ferme.current = true
    const v = (choisie ?? edition.valeur).trim()
    setEdition(null)
    if (garder) onModifie?.(edition.col, v || null)
  }
  const parColonne = new Map(points.map((p) => [p.colonne, p]))
  const rubriques = [...new Set([...Object.keys(l.montants), ...points.map((p) => p.colonne ?? '')])]
    .filter((c) => c && !ATTRIBUTS.some(([n]) => n === c))
  const cellules: [string, string | null][] = [
    ...ATTRIBUTS.map(([n, f]): [string, string | null] => [n, f(l)]),
    ...rubriques.map((r): [string, string | null] => [r, l.montants[r] != null ? valeurBrute(l.montants[r]) : null]),
  ]
  const cadre = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const div = cadre.current
    if (!div) return
    // Le tableau des points peut être plus large que son volet : la ligne du fichier se limite à la partie visible.
    const volet = div.closest<HTMLElement>('.volet-corps')
    if (volet) div.style.width = `${volet.clientWidth - 3}px`
    // Colonnes figées : chacune se cale à droite des précédentes.
    const entetes = [...div.querySelectorAll<HTMLElement>('thead th')]
    for (let i = 0; i < FIGEES; i++) {
      div.querySelectorAll<HTMLElement>(`tr > :nth-child(${i + 1})`).forEach((c) => { c.style.left = `${entetes[i].offsetLeft - entetes[0].offsetLeft}px` })
    }
    const gauche = entetes[FIGEES].offsetLeft - entetes[0].offsetLeft
    // Défilement horizontal animé jusqu'à centrer la cellule en cause dans la partie non figée.
    const td = div.querySelector<HTMLElement>('td.cellule-cible:not(.fige)')
    if (!td) return
    const visible = div.clientWidth - gauche
    const doux = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const minuterie = window.setTimeout(() => div.scrollTo?.({
      left: td.offsetLeft - gauche - (visible - td.offsetWidth) / 2, behavior: doux ? 'smooth' : 'auto',
    }), doux ? 250 : 0)
    return () => window.clearTimeout(minuterie)
  }, [])
  return (
    <div className="ligne-fichier" ref={cadre}>
      <table className="dense points" aria-label={`Ligne ${num} du fichier`}>
        <thead>
          <tr>{cellules.map(([n], i) => <th key={n} scope="col" className={i < FIGEES ? 'fige' : undefined}>{n}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            {cellules.map(([n, brute], i) => {
              const change = n in modifs
              const v = change ? modifs[n] : brute
              const p = parColonne.get(n)
              const classe = [p && !change && (p.gravite === 'bloquant' ? 'cellule-ko' : 'cellule-attention'), change && 'cellule-modifiee',
                n === cible && 'cellule-cible', i < FIGEES && 'fige']
                .filter(Boolean).join(' ')
              const modifiable = onModifie != null && l.brut != null && n in l.brut && !enCours
              if (edition?.col === n) {
                const ouverte = options.length > 0
                const touche = (e: KeyboardEvent) => {
                  // Liste ouverte : les flèches parcourent les valeurs, Entrée retient celle en surbrillance.
                  if (ouverte && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                    e.preventDefault()
                    const k = options.length, pas = e.key === 'ArrowDown' ? 1 : -1
                    setEdition({ ...edition, actif: edition.actif < 0 && pas < 0 ? k - 1 : (edition.actif + pas + k) % k })
                  } else if (e.key === 'Enter') fermer(true, ouverte && edition.actif >= 0 ? options[edition.actif] : undefined)
                  else if (e.key === 'Escape') fermer(false)
                }
                return (
                  <td key={n} ref={setAncre} className={[classe, 'en-saisie'].filter(Boolean).join(' ')} title={p?.message}>
                    {/* Valeur gardée, invisible : la cellule garde sa taille, le champ se pose dessus. */}
                    <span className="fantome" aria-hidden="true">{change ? v : v ?? p?.valeur ?? ''}</span>
                    <input autoFocus aria-label={`${n}, ligne ${num}`} value={edition.valeur}
                      {...(toutes.length ? {
                        role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': ouverte,
                        'aria-controls': ouverte ? ID_LISTE : undefined,
                        'aria-activedescendant': ouverte && edition.actif >= 0 ? idOption(edition.actif) : undefined,
                      } : {})}
                      onChange={(e) => setEdition({ col: n, valeur: e.target.value, actif: -1 })} onBlur={() => fermer(true)}
                      onKeyDown={touche} />
                    {ouverte && ancre && (
                      <ListeChoix ancre={ancre} options={options} actif={edition.actif} valeur={edition.valeur}
                        onChoisir={(o) => fermer(true, o)} onSurvol={(k) => setEdition({ ...edition, actif: k })} />
                    )}
                  </td>
                )
              }
              return (
                <td key={n} className={[classe, modifiable && 'modifiable'].filter(Boolean).join(' ') || undefined} title={p?.message}
                  onClick={modifiable ? () => ouvrir(n) : undefined}>{change ? v : v ?? p?.valeur ?? ''}</td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
